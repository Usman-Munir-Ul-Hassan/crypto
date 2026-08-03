// Email deliverability gate for manual registration — the "no spam-trap
// signups" rule. Runs entirely server-side at the signup step: no email is
// ever sent and no verification step exists. A signup passes only if the
// address does not look like spam, which is decided by three local checks:
//
//   1. spam local parts  -> test@, spam@, admin@ ... (test@gmail.com is the
//      canonical example: Gmail refuses to hand out that username)
//   2. disposable domains -> mailinator, 10minutemail ... (burner inboxes),
//      checked against a ~75k-domain blocklist (data/disposable-domains.txt)
//      that auto-refreshes from the public daily-aggregated source
//   3. mail records       -> the domain must have MX or A/AAAA records, i.e.
//      some mail infrastructure at all (example.com, made-up domains fail)
//
// Honest limitation: no server-side check can prove a mailbox literally
// exists — Gmail answers "yes" to SMTP probes for every address
// (anti-enumeration). So this rejects the PATTERNS spammers use, by policy.
// Brand-new disposable domains appear in the list within ~24h via the daily
// refresh (started in instrumentation.ts); until then they can slip through.

import { promises as dns } from "dns";
import { readFileSync } from "fs";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("email-guard");

// Daily-aggregated disposable-domain list (CC0/MIT/BSD sources — see the
// header of data/disposable-domains.txt for attribution).
const DISPOSABLE_LIST_URL =
  "https://stefanpejcic.github.io/disposable-email-domains/domains.txt";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

// Reserved / role-based local parts: spam-traps (test@, spam@) or shared
// roles (admin@, info@) that no single real person owns alone. Gmail
// reserves "test" as a username, so test@gmail.com can never be a real
// personal inbox — a guaranteed bounce.
const SPAM_LOCAL_PARTS = new Set([
  "test", "testing", "testuser", "tests", "test1", "test123",
  "spam", "spammy", "spammer", "junk", "trash", "garbage",
  "mail", "mailer", "mailbox", "inbox", "outbox",
  "admin", "administrator", "root", "postmaster", "webmaster",
  "info", "contact", "support", "help", "sales", "marketing",
  "noreply", "no-reply", "abuse", "hostmaster", "usenet", "uucp",
  "user", "user1", "guest", "demo", "example", "sample",
  "foo", "bar", "foobar", "asdf", "qwerty", "abc", "xyz",
  "a", "b", "c", "m", "x", "zzz", "00", "01", "1234",
  "itsme", "temp", "temporary", "placeholder",
]);

// Error is polite but non-revealing — never say WHICH rule tripped, so bots
// can't fingerprint the filter. Real users with a typo'd role name see this
// too; the message tells them to use a personal inbox.
const REJECT_MESSAGE =
  "This email can't receive mail — use a personal, working inbox.";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Disposable-domain list loading + auto-refresh
//
// The list lives in two places: the vendored copy on disk (cold start) and a
// memory cache. refresh() downloads the latest list and atomically swaps the
// cached Set — a refresh failure leaves the old list in place and only logs.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  __disposableDomains?: Set<string>;
  __disposableRefreshStarted?: boolean;
};

const LIST_FILE = path.join(
  process.cwd(),
  "src",
  "app",
  "lib",
  "data",
  "disposable-domains.txt"
);

// Pinned to globalThis like the mailer transporter so dev HMR never reloads
// the 1.2MB file or starts a second refresh timer.
function getDisposableDomains(): Set<string> {
  if (!g.__disposableDomains) {
    g.__disposableDomains = new Set<string>();
    try {
      for (const line of readFileSync(LIST_FILE, "utf8").split(/\r?\n/)) {
        const domain = line.trim().toLowerCase();
        if (domain && !domain.startsWith("#")) g.__disposableDomains.add(domain);
      }
      log.info("disposable list loaded from disk", {
        domains: g.__disposableDomains.size,
      });
    } catch (err) {
      log.error("disposable list load failed", { error: err });
    }
  }
  return g.__disposableDomains;
}

export async function refreshDisposableDomains(): Promise<void> {
  try {
    const res = await fetch(DISPOSABLE_LIST_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const fresh = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      const domain = line.trim().toLowerCase();
      if (domain && !domain.startsWith("#")) fresh.add(domain);
    }
    if (fresh.size < 10_000) {
      // Suspiciously small -> the upstream source changed shape; keep the
      // current list rather than swapping in a gutted one.
      log.warn("disposable list refresh ignored — implausibly small", {
        domains: fresh.size,
      });
      return;
    }

    g.__disposableDomains = fresh;
    log.info("disposable list refreshed", { domains: fresh.size });
  } catch (err) {
    log.warn("disposable list refresh failed — keeping current list", {
      error: err,
    });
  }
}

// Boot-time + daily refresh. Idempotent across dev HMR.
export function startDisposableRefresh(): void {
  if (g.__disposableRefreshStarted) return;
  g.__disposableRefreshStarted = true;
  void refreshDisposableDomains();
  setInterval(() => void refreshDisposableDomains(), REFRESH_INTERVAL_MS);
  log.info("disposable list auto-refresh scheduled", {
    intervalHours: REFRESH_INTERVAL_MS / 3_600_000,
  });
}

// The list is normalized mostly to second-level domains, so subdomains match
// via their last two labels: sub.mailinator.com -> mailinator.com.
function isDisposableDomain(domain: string): boolean {
  const list = getDisposableDomains();
  if (list.has(domain)) return true;
  const labels = domain.split(".");
  if (labels.length > 2) {
    return list.has(labels.slice(-2).join("."));
  }
  return false;
}

// ---------------------------------------------------------------------------
// The three checks
// ---------------------------------------------------------------------------

// Normalize the local part before matching so evasion tricks don't help:
// Gmail ignores dots and +suffixes, and so do we — t.e.s.t@gmail.com and
// test+spam@gmail.com both resolve to the same "test" local part.
function normalizedLocalPart(email: string): string {
  const raw = email.split("@")[0];
  return raw.replace(/\./g, "").split("+")[0].toLowerCase();
}

// The domain must have SOME mail infrastructure — an MX record, or (when MX
// is absent, per RFC 5321 fallback) an A/AAAA record. No records means no
// server could ever receive mail for the address.
async function hasMailRecords(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length > 0) return true;
  } catch {
    // ENOTFOUND/ENODATA etc. -> fall through to the A/AAAA probe.
  }
  try {
    await dns.resolve4(domain);
    return true;
  } catch {
    /* fall through to the IPv6 probe */
  }
  try {
    await dns.resolve6(domain);
    return true;
  } catch {
    return false;
  }
}

export async function guardEmail(email: string): Promise<GuardResult> {
  const local = normalizedLocalPart(email);
  const domain = email.split("@")[1].toLowerCase();

  if (SPAM_LOCAL_PARTS.has(local)) {
    log.info("spam local part rejected", { local, email });
    return { ok: false, reason: REJECT_MESSAGE };
  }

  if (isDisposableDomain(domain)) {
    log.info("disposable domain rejected", { domain, email });
    return { ok: false, reason: REJECT_MESSAGE };
  }

  try {
    const reachable = await hasMailRecords(domain);
    if (!reachable) {
      log.info("domain without mail records rejected", { domain, email });
      return { ok: false, reason: REJECT_MESSAGE };
    }
  } catch (err) {
    // DNS itself errored (timeout, resolver misconfig). Fail OPEN: never
    // block a real user because the resolver hiccuped. The blocklists above
    // already caught the obvious junk.
    log.warn("DNS check failed — allowing signup through", { domain, error: err });
  }

  return { ok: true };
}
