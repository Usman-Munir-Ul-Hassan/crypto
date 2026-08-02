"use client";

// Alerts — CLIENT half of the crash + surge feed. Seeded by the server with this
// operator's alert history, then polls /api/alerts every 10s so new moves the
// detector logs appear without a manual refresh. Read-only view: alerts are
// created by the server-side detector, never from here. The SIGN of
// drop_percentage is the direction: negative = price drop, positive = surge.
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/app/components/Toaster";
import ConfirmDialog from "@/app/components/ConfirmDialog";

// Reuse one AudioContext for the lifetime of the page (browsers allow only a
// limited number of them). Created lazily on first beep so we stay inside the
// "must be triggered by user gesture" rule — the poll only fires after the page
// has already rendered and the user has navigated here.
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === "closed") {
      const AudioCtxClass = window.AudioContext;
      if (!AudioCtxClass) return null;
      _audioCtx = new AudioCtxClass();
    }
    return _audioCtx;
  } catch {
    return null;
  }
}

// Plays a quick two-tone beep.
// surge = true  → rising pair (positive news)
// surge = false → falling pair (drop warning, lower frequency)
function playBeep(surge = false) {
  const ctx = getAudioCtx();
  if (!ctx) return;

  // Resume context if it was suspended (browser autoplay policy).
  if (ctx.state === "suspended") ctx.resume().catch(() => { });

  const now = ctx.currentTime;
  // Two tones — spaced 0.15 s apart so it sounds like a double-beep.
  const tones = surge
    ? [660, 880]   // ascending: C5 → A5 (positive)
    : [440, 330];  // descending: A4 → E4 (warning)

  tones.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + i * 0.18);

    gain.gain.setValueAtTime(0, now + i * 0.18);
    gain.gain.linearRampToValueAtTime(0.12, now + i * 0.18 + 0.01);  // fast attack
    gain.gain.linearRampToValueAtTime(0, now + i * 0.18 + 0.14);  // smooth decay

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.15);
  });
}

export type AlertRow = {
  id: string;
  asset_id: string;
  asset_name: string;
  price_at_drop: number;
  drop_percentage: number;
  detected_at: string; // ISO string
};


// "3m ago" style relative time — drops are recent, so relative reads better
// than a full timestamp. Falls back to a date once it's older than a day.
function fmtAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Still inside the detector's 60s cooldown window — this move is happening NOW,
// so the card earns a pulsing LIVE tag.
function isActive(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 60_000;
}

export default function AlertsView({ initialAlerts }: { initialAlerts: AlertRow[] }) {
  const [alerts, setAlerts] = useState<AlertRow[]>(initialAlerts);
  const toast = useToast();
  // True while the clear request is in flight — disables the button.
  const [clearing, setClearing] = useState(false);
  // Whether the themed "clear all?" confirm modal is showing.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Re-render every 30s so the "Xm ago" labels stay honest even between polls.
  const [, setTick] = useState(0);
  // fmtAgo/isActive read Date.now(), which differs between the server render and
  // client hydration — gate them behind a mounted flag to avoid a hydration
  // mismatch, then show real relative times right after mount.
  const [mounted, setMounted] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    cancelledRef.current = false;

    async function poll() {
      try {
        const res = await fetch("/api/alerts");
        if (!res.ok) return; // transient blip — keep the last feed
        const json = (await res.json()) as { alerts: AlertRow[] };
        if (!cancelledRef.current) {
          setAlerts((prev) => {
            const newAlerts = json.alerts.filter((a) => !prev.some((p) => p.id === a.id));
            if (newAlerts.length > 0) {
              // Play a surge or drop beep based on the first new alert's direction.
              const isSurge = newAlerts[0].drop_percentage > 0;
              playBeep(isSurge);
            }
            return json.alerts;
          });
        }
      } catch {
        // Network hiccup — ignore, next tick catches up.
      }
    }

    const feed = setInterval(poll, 5000); // don't refetch now — server seeded us
    const clock = setInterval(() => setTick((t) => t + 1), 30000);
    return () => {
      cancelledRef.current = true;
      clearInterval(feed);
      clearInterval(clock);
    };
  }, []);

  // Header stat strip — red column vs green column, instant danger/positivity read.
  const crashCount = alerts.filter((a) => a.drop_percentage < 0).length;
  const surgeCount = alerts.length - crashCount;

  // Wipe this operator's alert history. The button opens a themed confirm modal
  // (not the native window.confirm); confirming runs the delete: drop the feed
  // optimistically, then roll back with an error toast if the write fails.
  async function clearAlerts() {
    setConfirmOpen(false);
    if (clearing || alerts.length === 0) return;

    const snapshot = alerts;
    setClearing(true);
    setAlerts([]); // optimistic
    try {
      const res = await fetch("/api/alerts", { method: "DELETE" });
      if (!res.ok) throw new Error(`clear failed: ${res.status}`);
      const { cleared } = (await res.json()) as { cleared: number };
      toast("success", cleared > 0 ? `Cleared ${cleared} alert${cleared === 1 ? "" : "s"}` : "No alerts to clear");
    } catch {
      setAlerts(snapshot); // rollback — the poll would also restore them within 5s
      toast("error", "Couldn't clear alerts — try again");
    } finally {
      setClearing(false);
    }
  }

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-200 text-black text-xl shadow-inner transition-transform duration-300 group-hover:scale-110">
            ⚠
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-black italic tracking-wide sm:text-4xl bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted">
              PRICE MOVE ALERTS
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-muted">
              {"// Price drop & surge feed on watched assets"}
            </p>
          </div>
        </div>

        {/* Clear history */}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={clearing || alerts.length === 0}
          className="shrink-0 cursor-pointer rounded-lg border border-danger/50 bg-gradient-to-r from-danger/20 to-danger/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-danger transition-all hover:bg-danger/20 hover:shadow-[0_0_10px_rgba(255,69,69,0.3)] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          {clearing ? "Clearing…" : "✕ Clear History"}
        </button>
      </div>

      {/* Drop vs surge tally */}
      <div className="mt-8 flex gap-4">
        <div className="flex-1 rounded-2xl border border-primary/40 bg-primary/10 p-5 backdrop-blur-md shadow-[0_0_20px_rgba(43,255,69,0.1)] transition-transform hover:scale-[1.02]">
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/20 blur-2xl"></div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-green-400">Price Surges</p>
          <p className="mt-2 font-display text-4xl font-black text-green-500 drop-shadow-md">▴ {surgeCount}</p>
        </div>
        <div className="flex-1 rounded-2xl border border-danger/40 bg-danger/10 p-5 backdrop-blur-md shadow-[0_0_20px_rgba(255,69,69,0.1)] transition-transform hover:scale-[1.02]">
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-danger/20 blur-2xl"></div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-red-400">Price Drops</p>
          <p className="mt-2 font-display text-4xl font-black text-red-500 drop-shadow-md">▾ {crashCount}</p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="mt-20 flex flex-col items-center gap-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="rounded-full bg-surface/50 p-6 shadow-[0_0_30px_rgba(255,255,255,0.03)] backdrop-blur-sm border border-line">
            <span className="text-4xl text-muted/50">✨</span>
          </div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            {"// No drops or surges detected — all watched assets stable"}
          </p>
          <Link
            href="/watchlist"
            className="group cursor-pointer rounded-lg border border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-primary transition-all hover:border-primary/80 hover:bg-primary/20 hover:shadow-[0_0_15px_rgba(43,255,69,0.2)]"
          >
            <span className="inline-block transition-transform group-hover:scale-110">★</span> View Watchlist
          </Link>
        </div>
      ) : (
        /* Alerts list */
        <div className="mt-8 w-full grid grid-cols-2 gap-4 overflow-y-auto pr-2">
          {alerts.map((a) => {
            // Positive % = surge (green/up), negative = drop (red/down).
            const surge = a.drop_percentage > 0;
            const active = mounted && isActive(a.detected_at);
            return (
              <div
                key={a.id}
                className={`relative overflow-hidden rounded-2xl border ${surge ? "border-primary/40 bg-primary/10 text-primary" : "border-danger/40 bg-danger/10 text-danger"} p-5 shadow-lg`}
              >
                <span className="absolute top-2 left-2 text-xs font-mono text-white">{mounted ? fmtAgo(a.detected_at) : "…"}</span>
                <div className="flex items-center justify-between gap-4 pl-2">
                  <div className="flex min-w-0 items-center gap-4">
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl shadow-inner transition-transform duration-300 group-hover:scale-110 ${surge
                        ? "bg-primary/20 text-green-500" : "bg-danger/20 text-red-500"
                        }`}
                    >
                      {surge ? "▲" : "▼"}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-display text-lg font-bold tracking-tight text-white">{a.asset_name}</p>
                        {active && (
                          <span
                            className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] ${surge ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
                          >
                            <span className={`h-1.5 w-1.5 animate-ping rounded-full ${surge ? "bg-primary" : "bg-danger"}`} />
                            Live
                          </span>
                        )}
                      </div>
                      <p className={`mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.25em] ${surge ? "text-green-500" : "text-red-500"}`}>{surge ? "Price surge" : "Price drop"}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-mono text-3xl font-black drop-shadow-sm ${surge ? "text-green-500" : "text-red-500"}`}>{surge ? "+" : "−"}{Math.abs(a.drop_percentage).toFixed(2)}%</p>
                    <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.2em] text-foreground/70">{surge ? "▴ since last scan" : "▾ since last scan"}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-8 border-t border-line/50 pt-4 font-mono text-[8px] uppercase tracking-[0.3em] text-muted/70">
        {"// Live feed · detector scans every 5s · one alert per asset per direction per 60s"}
      </p>

      <ConfirmDialog
        open={confirmOpen}
        title="Clear all alerts?"
        message="This permanently deletes your alert history for every watched asset. This action cannot be undone."
        confirmLabel="Clear alerts"
        busy={clearing}
        onConfirm={clearAlerts}
        onCancel={() => setConfirmOpen(false)}
      />
    </main>
  );
}

