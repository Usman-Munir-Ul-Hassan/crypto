"use client";

// Watchlist — CLIENT half of Lane 1's live view. Seeded by the server with the
// user’s coins (already‑priced where the cache had them), then it polls
// /api/prices every 30s (same cadence as the detector) so the list stays live
// without flooding the server. The 30s poll reads the
// RAM cache only — the real CoinGecko call happens on the server's 30s poller.
// Removing a coin hits DELETE /api/watchlist/[id] (Lane 2's write path).
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { LiveCoin } from "@/app/lib/cache";
import { useToast } from "@/app/components/Toaster";

function fmtPrice(n: number): string {
  const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 8;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// "14:32:05" — wall-clock moment the snapshot was fetched. Rendered only after
// mount (see `mounted`) so the server's timezone never leaks into the first
// paint and causes a hydration mismatch.
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

export default function WatchlistView({
  initialCoins,
  initialUpdatedAt,
  initialPrevUpdatedAt,
}: {
  initialCoins: LiveCoin[];
  initialUpdatedAt: number;
  initialPrevUpdatedAt: number;
}) {
  const [coins, setCoins] = useState<LiveCoin[]>(initialCoins);
  // When the current snapshot was fetched, and when the one before it was —
  // their gap IS the real fetch interval (measured, not the configured 30s).
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [prevUpdatedAt, setPrevUpdatedAt] = useState(initialPrevUpdatedAt);
  // Hydration guard: clock strings only render client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [threshold, setThreshold] = useState<number | null>(null);
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setThreshold(data.threshold);
        }
      } catch (err) {
        console.error('Failed to load alert threshold:', err);
      }
    }
    load();
  }, []);
  const toast = useToast();
  // Ids being removed — disables that card's trash button mid-request.
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  // Asset_ids the detector flagged as actively crashing (alert in last 60s).
  // Drives the red status dot; everything else shows green (stable).
  const [alerts, setAlerts] = useState<Set<string>>(new Set());
  // Asset_ids actively surging +2% — drives the pulsing green surge state.
  const [surges, setSurges] = useState<Set<string>>(new Set());
  // Keep the live id set in a ref so the poll callback always sees the latest
  // without re-subscribing the interval on every render.
  const idsRef = useRef<string[]>(initialCoins.map((c) => c.id));

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/prices");
        if (!res.ok) return; // transient blip — keep showing the last snapshot
        const json = (await res.json()) as {
          data: LiveCoin[];
          alerts?: string[];
          surges?: string[];
          updatedAt?: number;
          prevUpdatedAt?: number;
        };
        if (cancelled) return;

        // Index fresh prices by id, then update ONLY the coins on this user's
        // list — leaving a card untouched if the cache doesn't have it yet.
        const byId = new Map(json.data.map((c) => [c.id, c]));
        setCoins((prev) =>
          prev.map((c) => byId.get(c.id) ?? c)
        );
        setAlerts(new Set(json.alerts ?? []));
        setSurges(new Set(json.surges ?? []));
        setUpdatedAt(json.updatedAt ?? 0);
        setPrevUpdatedAt(json.prevUpdatedAt ?? 0);
      } catch {
        // Network hiccup — ignore this tick, the next one will catch up.
      }
    }

    const interval = setInterval(poll, 30000); // server already seeded the first paint, now matching 30‑second detection cycle
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function remove(id: string) {
    if (removing.has(id)) return;
    setRemoving((prev) => new Set(prev).add(id));

    // Optimistic: drop the card now, restore it if the request fails.
    const snapshot = coins;
    const name = snapshot.find((c) => c.id === id)?.name ?? "Asset";
    setCoins((prev) => prev.filter((c) => c.id !== id));
    idsRef.current = idsRef.current.filter((x) => x !== id);

    try {
      const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`remove failed: ${res.status}`);
      toast("success", `${name} removed from watchlist`);
    } catch {
      setCoins(snapshot); // rollback
      idsRef.current = snapshot.map((c) => c.id);
      toast("error", `Couldn't remove ${name} — try again`);
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Seconds between the last two cache writes — shown as "Xs ago" next to the
  // baseline price. 0/negative gaps (fresh boot: prevUpdatedAt=0) -> unknown.
  const tickSecs =
    prevUpdatedAt > 0 && updatedAt > prevUpdatedAt
      ? Math.round((updatedAt - prevUpdatedAt) / 1000)
      : null;

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-lg text-primary">
          ★
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-black italic tracking-wide sm:text-3xl">
            MY WATCHLIST
          </h1>
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-muted">
            {"// Priority operational targets"}
          </p>
        </div>
      </div>

      {threshold !== null && (
          <div className="mt-4 rounded-md bg-gray-200 p-2 font-mono text-[10px] uppercase tracking-wider text-black">
            Alert Sensitivity: {threshold.toFixed(2)}%
          </div>
        )}


      {coins.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            {"// No assets on watch"}
          </p>
          <Link
            href="/market"
            className="cursor-pointer rounded-md border border-primary/60 bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/20"
          >
            ⌕ Browse Market
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid max-h-[calc(100vh-14rem)] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {coins.map((c) => {
            const pending = c.price === 0 && !c.symbol; // not yet fetched by poller
            const isRemoving = removing.has(c.id);
            const crashing = alerts.has(c.id); // detector flagged an active flash crash
            // Active +2% spike — crash wins the border if both fire in one window.
            const surging = !crashing && surges.has(c.id);
            // Tick-to-tick move: current vs the price one poll earlier (~30s ago).
            // null prevPrice (fresh boot / newly starred) -> strip stays hidden.
            const tickPct =
              c.prevPrice !== null && c.prevPrice > 0
                ? ((c.price - c.prevPrice) / c.prevPrice) * 100
                : null;
            // Direction is judged on the ROUNDED label, not the raw float — a
            // −0.0009% move displays as "0.00%", so painting it as a red drop
            // would contradict what the user can actually see. Flat = muted.
            const tickLabel = tickPct !== null ? Math.abs(tickPct).toFixed(2) : null;
            const tickFlat = tickLabel === "0.00";
            const tickDown = !tickFlat && tickPct !== null && tickPct < 0;
            return (
              <div
                key={c.id}
                className={`rounded-xl border bg-surface p-5 transition ${
                  crashing ? "border-danger/60" : surging ? "border-primary/60" : "border-line"
                }`}
              >
                {/* Card header — logo + name + remove */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {c.image ? (
                      <Image
                        src={c.image}
                        alt={c.name}
                        width={32}
                        height={32}
                        className="shrink-0 rounded-full"
                        unoptimized
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary">
                        {c.name.charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {/* Status dot — red = crash, pulsing green = surge, green = stable */}
                        <span
                          aria-label={crashing ? "Price drop detected" : surging ? "Price surge detected" : "Stable"}
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            crashing ? "animate-pulse bg-danger" : surging ? "animate-pulse bg-primary" : "bg-primary"
                          }`}
                        />
                        <p className="font-display text-base font-bold">{c.name}</p>
                      </div>
                      <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted">
                        {c.symbol || "—"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={isRemoving}
                    aria-label={`Remove ${c.name} from watchlist`}
                    className="cursor-pointer rounded-md border border-line px-2 py-1 text-sm text-muted transition hover:border-danger/50 hover:text-danger disabled:opacity-50"
                  >
                    🗑
                  </button>
                </div>

                {/* Price + tick delta — (current − baseline) / baseline × 100,
                    the SAME formula the detector runs, recomputed every update.
                    No 24h figure here: we only compare against the last tick. */}
                <p className="mt-4 font-mono text-3xl font-bold tracking-tight">
                  {pending ? "—" : fmtPrice(c.price)}
                </p>
                {!pending && tickPct !== null && (
                  <p
                    className={`mt-1 font-mono text-xs font-bold ${
                      tickFlat ? "text-muted" : tickDown ? "text-danger" : "text-primary"
                    }`}
                  >
                    {/* Flat = no glyph (a leading dash reads as a minus sign on
                        a zero); muted grey already signals "no move". */}
                    {tickFlat ? "" : tickDown ? "▾ " : "▴ "}{tickLabel}%{" "}
                    <span className="font-normal text-muted">since last tick</span>
                  </p>
                )}

                {/* Tick strip — LEFT: baseline price from the previous fetch,
                    labelled with the REAL measured interval. RIGHT: the new
                    price and the clock time it was fetched. No percentage here —
                    the delta lives under the big price. */}
                {!pending && tickPct !== null && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line bg-background px-2.5 py-1.5 font-mono text-[10px]">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[8px] uppercase tracking-[0.2em] text-muted">
                        {tickSecs !== null ? `${tickSecs}s ago` : "Prev tick"}
                      </span>
                      <span className="truncate text-foreground/80">{fmtPrice(c.prevPrice as number)}</span>
                    </span>
                    <span className="shrink-0 text-muted">→</span>
                    <span className="flex min-w-0 flex-col items-end text-right">
                      <span className="text-[8px] uppercase tracking-[0.2em] text-muted">
                        {mounted && updatedAt > 0 ? `at ${fmtTime(updatedAt)}` : "Now"}
                      </span>
                      <span className="truncate font-bold text-foreground">{fmtPrice(c.price)}</span>
                    </span>
                  </div>
                )}

                {/* Flash-crash banner — only while the detector's alert is active */}
                {crashing && (
                  <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-danger">
                    ⚠ Price drop detected
                  </p>
                )}

                {/* Surge banner — the mirror alert: price jumped ≥ +2% in a window */}
                {surging && (
                  <p className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-primary">
                    ▲ Price surge detected
                  </p>
                )}

                {/* Full analysis link */}
                <a
                  href={`https://www.coingecko.com/en/coins/${c.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-center rounded-md border border-line bg-background py-2 font-mono text-[9px] uppercase tracking-[0.25em] text-muted transition hover:border-primary/40 hover:text-primary"
                >
                  Full Analysis ↗
                </a>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 font-mono text-[8px] uppercase tracking-[0.3em] text-muted">
        {"// Live feed · server polls CoinGecko every 5s · browser refreshes every 5s"}
      </p>
    </main>
  );
}
