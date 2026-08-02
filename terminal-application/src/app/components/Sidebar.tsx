"use client";

// Shared app sidebar — the single source of nav chrome for every in-app page.
// Active item is derived from the URL (usePathname), so no page needs to pass
// an `active` flag. Keeps the OperatorGuide spotlight IDs alive (nav-alerts,
// profile-menu). Token classes only — no raw hex.
// The Alerts item carries a Slack-style unread dot: a 10s /api/alerts poll
// compares the newest detected_at against a localStorage "last seen" stamp,
// and visiting /alerts marks everything seen.
// The beep lives HERE (not in AlertsView) so it fires on EVERY page.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import LogoutButton from "./LogoutButton";
import { operatorName, operatorInitials } from "@/app/lib/user-display";
import { Icon, type IconName } from "./icons";

// ─── Alert beep (two-tone, plays on ANY page) ───────────────────────────────
// Reuse one AudioContext for the lifetime of the tab.
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === "closed") {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      _audioCtx = new Ctor();
    }
    return _audioCtx;
  } catch {
    return null;
  }
}

function playBeep(surge = false) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // Resume if the browser auto-suspended the context (autoplay policy).
  if (ctx.state === "suspended") ctx.resume().catch(() => { });

  const now = ctx.currentTime;
  // Two tones — ascending for surge, descending for crash
  const tones = surge ? [660, 880] : [440, 330];
  tones.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle"; // Cuts through much better than sine
    osc.frequency.setValueAtTime(freq, now + i * 0.3);
    gain.gain.setValueAtTime(0, now + i * 0.3);
    gain.gain.linearRampToValueAtTime(1.0, now + i * 0.3 + 0.05); // 100% volume, fast attack
    gain.gain.linearRampToValueAtTime(0, now + i * 0.3 + 0.28); // Slower decay
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.3);
    osc.stop(now + i * 0.3 + 0.3);
  });
}

// href "#" == route not built yet (won't 404, never highlights).
const NAV_ITEMS: { label: string; href: string; icon: IconName; id?: string }[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Watchlist", href: "/watchlist", icon: "watchlist" },
  { label: "Alerts", href: "/alerts", icon: "alerts", id: "nav-alerts" },
  { label: "Market Data", href: "/market", icon: "market" },
  { label: "Profile", href: "/profile", icon: "profile" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

// localStorage key for "I've seen alerts up to this timestamp" (per browser).
const ALERTS_SEEN_KEY = "bitbash-alerts-seen-at";
// localStorage key: the newest alert ID we've already beeped for.
const ALERTS_BEEPED_KEY = "bitbash-alerts-beeped-id";

export default function Sidebar() {
  const pathname = usePathname();
  // Live session -> real operator identity instead of hardcoded placeholders.
  const { data: session } = useSession();
  const name = operatorName(session?.user);
  const email = session?.user?.email ?? "—";
  const initials = operatorInitials(name);
  // True when an alert newer than the last /alerts visit exists — drives the
  // unread dot on the Alerts nav item. Starts false so SSR/hydration match.
  const [hasUnseen, setHasUnseen] = useState(false);
  // Track the newest alert timestamp we've already beeped for so we don't repeat.
  const lastBeepedRef = useRef<number>(
    typeof window !== "undefined"
      ? Number(localStorage.getItem(ALERTS_BEEPED_KEY)) || Date.now()
      : Date.now()
  );

  // Initialize audio context on first user interaction to bypass autoplay restrictions
  useEffect(() => {
    const initAudio = () => {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => { });
      }
      window.removeEventListener("click", initAudio);
      window.removeEventListener("keydown", initAudio);
    };
    window.addEventListener("click", initAudio);
    window.addEventListener("keydown", initAudio);
    return () => {
      window.removeEventListener("click", initAudio);
      window.removeEventListener("keydown", initAudio);
    };
  }, []);

  // Standing on /alerts = reading them. Stamp "seen up to now" and clear the
  // dot; the poll below keeps re-stamping while the user stays on the page.
  useEffect(() => {
    if (pathname !== "/alerts") return;
    localStorage.setItem(ALERTS_SEEN_KEY, String(Date.now()));
    setHasUnseen(false);
  }, [pathname]);

  // 10s alert poll (same cadence as the alert feeds). Reads the newest
  // detected_at and lights the dot only if it's newer than the seen-stamp.
  // Also plays a beep when a genuinely new alert arrives (on ANY page).
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        console.time("Sidebar")
        const res = await fetch("/api/alerts");
        console.timeEnd("Sidebar")
        if (!res.ok) return;
        const json = (await res.json()) as {
          alerts: { id?: string; detected_at: string; drop_percentage?: number }[];
        };
        console.log("Sidebar", json)
        if (cancelled) return;

        const alertList = json.alerts ?? [];

        // ── Beep logic (fires on every page) ────────────────────────
        if (alertList.length > 0) {
          const newAlerts = alertList.filter(
            (a) => new Date(a.detected_at).getTime() > lastBeepedRef.current
          );

          if (newAlerts.length > 0) {
            let maxTime = lastBeepedRef.current;

            // Sort oldest to newest so they beep in order
            newAlerts.sort((a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());

            newAlerts.forEach((a, index) => {
              const alertTime = new Date(a.detected_at).getTime();
              if (alertTime > maxTime) maxTime = alertTime;

              // Stagger the beeps by 800ms if multiple alerts hit at once
              setTimeout(() => {
                playBeep((a.drop_percentage ?? 0) > 0);
              }, index * 800);
            });

            lastBeepedRef.current = maxTime;
            localStorage.setItem(ALERTS_BEEPED_KEY, String(maxTime));
          }
        }

        // ── Unread-dot logic ────────────────────────────────────────
        if (pathname === "/alerts") {
          // Already looking at the feed — whatever just arrived counts as seen.
          localStorage.setItem(ALERTS_SEEN_KEY, String(Date.now()));
          setHasUnseen(false);
          return;
        }
        const newest = alertList.reduce(
          (max, a) => Math.max(max, new Date(a.detected_at).getTime()),
          0
        );
        const seenAt = Number(localStorage.getItem(ALERTS_SEEN_KEY) ?? 0);
        setHasUnseen(newest > seenAt);
      } catch {
        // network hiccup — keep the current dot state, next tick catches up.
      }
    }
    void poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pathname]);

  return (
    <aside className="flex w-full flex-col border-b border-line lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-3 border-b border-line p-4 lg:p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-black">
          <Icon name="shield" size={18} />
        </span>
        <div
          onClick={() => playBeep(true)}
          className="cursor-pointer transition-opacity hover:opacity-70"
          title="Click to test alert sound"
        >
          <p className="font-display text-sm font-bold tracking-widest">BITBASH</p>
          <p className="font-mono text-[8px] uppercase tracking-[0.4em] text-muted">Sentry V4</p>
        </div>
      </div>

      <nav className="flex flex-row gap-1 overflow-x-auto p-3 font-mono text-[11px] uppercase tracking-[0.2em] lg:flex-col lg:overflow-x-visible">
        {NAV_ITEMS.map((item) => {
          const active = item.href !== "#" && pathname === item.href;
          return (
            <Link
              key={item.label}
              id={item.id}
              href={item.href}
              className={
                active
                  ? "flex items-center gap-2.5 whitespace-nowrap rounded-md border border-primary/40 bg-primary/10 px-3.5 py-2.5 text-primary shadow-glow"
                  : "flex items-center gap-2.5 whitespace-nowrap rounded-md border border-transparent px-3.5 py-2.5 text-muted transition hover:bg-surface hover:text-foreground"
              }
            >
              {/* Icon wrapped so the unread dot can pin to its corner — same
                  visual grammar as Slack/WhatsApp badges. */}
              <span className="relative shrink-0">
                <Icon name={item.icon} size={15} />
                {item.href === "/alerts" && hasUnseen && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-danger" />
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div id="profile-menu" className="border-t border-line p-4 lg:mt-auto">
        <div className="flex items-center gap-3 rounded-lg bg-surface p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[10px] font-bold uppercase tracking-widest">{name}</p>
            <p className="truncate font-mono text-[9px] text-muted">{email}</p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

