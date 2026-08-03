# Email Detection — Spam-Email Prevention Strategy

## 1. Purpose

Stop fake/spam emails from registering at signup. The gate runs **entirely
server-side, instantly, before any database write** — no email is ever sent to
the person registering, and no verification step exists.

Examples of what gets blocked:

- `test@gmail.com` (spam-trap/role pattern)
- `qwerasdf@leeching.net` (temp-mail.org pool domain)
- `nobody@totallymadeup123.com` (domain that exists nowhere)

## 2. Flow

```
User submits register form (email + password)
            │
            ▼
  1. Syntax check (valid email shape?)
  2. Password check (strong?)
  3. Spam username check (test@, admin@…)
  4. Burner-domain check (75k list)
  5. Mail-server check (DNS: MX / A / AAAA records)
            │
   any check fails → 400 "This email can't receive mail —
            │        use a personal, working inbox."
            │        → NOTHING is saved to the database
            │
   all checks pass → account is created normally
```

The gate sits before the database: a rejected email leaves zero trace.

## 3. The five layers

| # | Layer | What it catches | Example |
|---|---|---|---|
| 1 | Syntax check | Garbage that isn't an email | `abc@@gmail..com` |
| 2 | Spam username check | Role/spam-trap usernames | `test@`, `admin@`, `spam@`, `info@` |
| 3 | Burner-domain check | Known throwaway services | `@mailinator.com`, `@leeching.net`, temp-mail pool domains |
| 4 | Mail-server check | Made-up domains | `@totallyfake123.com` (no MX/A/AAAA records) |
| 5 | Password check | Weak accounts (existing rule) | 8+ chars, upper/lower/number/symbol |

## 4. Hardening tricks

- **Normalization (layer 2):** dots and `+alias` stripped before matching —
  `t.e.s.t@gmail.com` and `test+spam@gmail.com` collapse to `test` and are
  blocked, exactly like Gmail treats them.
- **Subdomain matching (layer 3):** the last two labels of the domain are also
  checked — `sub.mailinator.com` matches `mailinator.com`.
- **In-memory hash table:** the 75,689 domains are loaded once into a `Set` at
  first signup (cached forever, pinned to `globalThis`). A `Set` lookup is
  O(1) — checking one email against 75k domains takes **microseconds**.
- **Offline fallback:** a vendored copy of the list lives in the repo
  (`src/app/lib/data/disposable-domains.txt`), so signup works even with no
  internet.
- **Auto-refresh:** the list re-downloads at server boot and every 24 hours
  (`startDisposableRefresh()` in `src/instrumentation.ts`) — new burner
  domains are blocked automatically, no manual maintenance.

## 5. Policy rules

- **Fail closed on evidence:** blocklist hit or no mail records → always reject.
- **Fail open on our own hiccups:** DNS timeout or refresh/download failure →
  let the user through and log it. Real users are never punished for our
  technical problems.
- **One generic message:** every rejection returns the same wording, so
  spammers cannot learn which rule caught them and adapt.

## 6. Where the list comes from

```
5 community-maintained blocklists (CC0 / MIT / BSD)
   • disposable-email-domains (CC0 — used by PyPI)
   • 7c/fakefilter (BSD-3-Clause)
   • wesbos/burner-email-providers (MIT)
   • Propaganistas/Laravel-Disposable-Email (MIT)
   • disposable.github.io (MIT)
            │ merged daily by
            ▼
stefanpejcic/disposable-email-domains (one aggregated list, GitHub Pages)
   https://stefanpejcic.github.io/disposable-email-domains/domains.txt
            │ downloaded at boot + every 24h
            ▼
src/app/lib/data/disposable-domains.txt (vendored fallback, ~75,689 domains)
```

Manual refresh (optional):

```
# overwrite the vendored file, keeping the 7-line header
Invoke-WebRequest https://stefanpejcic.github.io/disposable-email-domains/domains.txt
```

## 7. Honest limitations

- A burner domain registered **today** isn't in any list yet — it can slip
  through for up to ~24h until the daily refresh picks it up. Only a live paid
  API closes that gap instantly (deliberately skipped — see §8).
- No server-side check can *prove* a specific mailbox exists (Gmail answers
  "yes" to every SMTP probe on purpose). We reject by **pattern and policy**,
  not by proof.
- Role-style usernames (`test@`, `admin@`) are blocked as a policy rule even
  though such a mailbox might technically exist and receive mail.

## 8. Why not other approaches (design decisions)

| Option | Verdict | Reason |
|---|---|---|
| Verification email + code | Rejected | User must not receive/confirm email |
| deep-email-validator package | Uninstalled | Unused; our own checks replace it |
| SMTP mailbox probe | Would not work | Gmail answers "valid" for every address (anti-enumeration) |
| Arcjet `validateEmail` | Rejected | Its rule set has no role/spam-trap check — only `DISPOSABLE`, `FREE`, `NO_GRAVATAR`, `NO_MX_RECORDS`, `INVALID`. `test@gmail.com` passes all five |
| Paid verification APIs (ZeroBounce, mailboxlayer…) | Skipped | Cost + API key; the only thing that catches brand-new burner domains instantly |

Why email checkers report `test@gmail.com` as "valid" while we block it: they
answer *"can this address receive mail?"* (technically yes → "valid"), we
answer *"would a real person use this for signup?"* (no → blocked). Same
address, different question — both correct.

## 9. Testing notes

Verified live against the dev server (all without leaving test rows behind):

| Case | Result |
|---|---|
| `test@gmail.com` | 400 blocked |
| `t.e.s.t@gmail.com`, `test+spam@gmail.com` | 400 blocked (normalization) |
| `qwerasdf@leeching.net` (temp-mail pool) | 400 blocked |
| `qwerasdf@mailinator.com`, `@10minutemail.com`, `@guerrillamail.com` | 400 blocked |
| `nobody@definitelynotarealdomain123xyz.com` | 400 blocked (no mail records) |
| Legit `guardtest#####@gmail.com` | 201 passed (row deleted after) |

Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
