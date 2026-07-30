"use client";

// Alerts — CLIENT half of the crash + surge feed. Seeded by the server with this
// operator's alert history, then polls /api/alerts every 5s so new moves the
// detector logs appear without a manual refresh. Read-only view: alerts are
// created by the server-side detector, never from here. The SIGN of
// drop_percentage is the direction: negative = flash crash, positive = surge.
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/app/components/Toaster";
import ConfirmDialog from "@/app/components/ConfirmDialog";

export type AlertRow = {
  id: string;
  asset_id: string;
  asset_name: string;
  price_at_drop: number;
  drop_percentage: number;
  detected_at: string; // ISO string
};

function fmtPrice(n: number): string {
  const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 8;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// "3m ago" style relative time — crashes are recent, so relative reads better
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
        if (!cancelledRef.current) setAlerts(json.alerts);
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
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-lg text-danger">
          ⚠
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-black italic tracking-wide sm:text-3xl">
            PRICE MOVE ALERTS
          </h1>
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-muted">
            {"// Crash & surge feed on watched assets"}
          </p>
        </div>

        {/* Clear history — top corner, only useful when there's something to clear */}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={clearing || alerts.length === 0}
          className="ml-auto shrink-0 cursor-pointer rounded-md border border-danger/50 bg-danger/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-danger transition hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {clearing ? "Clearing…" : "✕ Clear"}
        </button>
      </div>

      {/* Crash vs surge tally — the page's danger/positivity scoreboard */}
      {alerts.length > 0 && (
        <div className="mt-6 grid max-w-md grid-cols-2 gap-3">
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3">
            <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-muted">Flash crashes</p>
            <p className="mt-1 font-display text-2xl font-black text-danger">▾ {crashCount}</p>
          </div>
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-3">
            <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-muted">Price surges</p>
            <p className="mt-1 font-display text-2xl font-black text-primary">▴ {surgeCount}</p>
          </div>
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            {"// No crashes or surges detected — all watched assets stable"}
          </p>
          <a
            href="/watchlist"
            className="cursor-pointer rounded-md border border-primary/60 bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/20"
          >
            ★ View Watchlist
          </a>
        </div>
      ) : (
        <div className="mt-6 grid max-h-[calc(100vh-16rem)] grid-cols-1 gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
          {alerts.map((a) => {
            // Positive % = surge (green/up), negative = crash (red/down).
            const surge = a.drop_percentage > 0;
            const active = mounted && isActive(a.detected_at);
            return (
              <div
                key={a.id}
                className={`relative overflow-hidden rounded-xl border border-l-4 p-4 ${
                  surge
                    ? "border-primary/40 border-l-primary bg-primary/10"
                    : "border-danger/40 border-l-danger bg-danger/10"
                }`}
              >
                {/* Right-edge glow toward the % — pulls the eye to the number */}
                <div
                  className={`pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l to-transparent ${
                    surge ? "from-primary/15" : "from-danger/15"
                  }`}
                />
                <div className="relative flex items-center justify-between gap-4">
                  {/* Direction tile + asset identity */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl ${
                        surge ? "bg-primary/20 text-primary" : "bg-danger/20 text-danger"
                      }`}
                    >
                      {surge ? "▲" : "▼"}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-display text-base font-bold">{a.asset_name}</p>
                        {active && (
                          <span
                            className={`flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.15em] text-background ${
                              surge ? "bg-primary" : "bg-danger"
                            }`}
                          >
                            <span className="h-1 w-1 animate-ping rounded-full bg-background" />
                            Live
                          </span>
                        )}
                      </div>
                      <p
                        className={`mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.25em] ${
                          surge ? "text-primary" : "text-danger"
                        }`}
                      >
                        {surge ? "Price surge" : "Flash crash"}
                      </p>
                      <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.2em] text-muted">
                        {mounted ? fmtAgo(a.detected_at) : "…"} · @ {fmtPrice(a.price_at_drop)}
                      </p>
                    </div>
                  </div>

                  {/* The number that matters — big, signed, colored */}
                  <div className="shrink-0 text-right">
                    <p className={`font-mono text-2xl font-black ${surge ? "text-primary" : "text-danger"}`}>
                      {surge ? "+" : "−"}
                      {Math.abs(a.drop_percentage).toFixed(2)}%
                    </p>
                    <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted">
                      {surge ? "▴ since last scan" : "▾ since last scan"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 font-mono text-[8px] uppercase tracking-[0.3em] text-muted">
        {"// Live feed · detector scans every 15s · one alert per asset per direction per 60s"}
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
