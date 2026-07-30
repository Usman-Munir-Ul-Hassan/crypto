"use client";

// Dashboard — CLIENT half. Renders Row 1 (Market Overview + price cards + System
// Alerts) AND Row 2 (Sentry Analytics + 24h Market Change trend), keeping both
// live. Seeded by the server for a flash-free first paint, then polls two feeds:
//   • /api/overview every 15s — global market totals + top-2 coins. 15s matches
//     the watchlist poller AND the market table, so the dashboard's percentages
//     never lag behind those two views (single-source parity across the app).
//   • /api/alerts   every 5s  — this operator's crash alerts (matches the alerts page)
// Row 2's sentiment + trend chart are DERIVED from the same live `global` totals,
// so they agree with Market Overview instead of showing hardcoded values.
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useState } from "react";
import type { Coin, FetchStatus, GlobalStats } from "@/app/lib/coingecko";
import type { AlertRow } from "../alerts/AlertsView";

// Relative bar heights for the 24h change trend chart — the SHAPE is decorative
// (we don't fetch historical points), but its COLOR now tracks the real market.
const BARS = ["h-3", "h-5", "h-4", "h-7", "h-6", "h-9", "h-5", "h-8", "h-10", "h-12"];

// Full price, e.g. "$89,275.00" — more precision for sub-$1 coins.
function fmtPrice(n: number): string {
  const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 8;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// Compact big-money, e.g. "$3.1T" / "$110.97B" — for the market totals.
function fmtCompact(n: number): string {
  return `$${n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`;
}

// Signed percent, e.g. "+1.24%" / "-0.39%".
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// "3m ago" style relative time for the alert rows (recomputed each 5s poll).
function fmtAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Sparkline({ up = true }: { up?: boolean }) {
  // Decorative — we don't fetch historical points, so the SHAPE is fixed.
  // The base shape trends UP (in SVG coords a smaller y sits higher). When the
  // coin is DOWN, mirror each point vertically (y -> 32 - y) so the line
  // descends, and paint it red so the curve matches the price direction.
  const base: [number, number][] = [
    [0, 26], [14, 24], [26, 27], [38, 20], [50, 22],
    [62, 14], [74, 16], [86, 9], [100, 12], [120, 6],
  ];
  const points = base.map(([x, y]) => `${x},${up ? y : 32 - y}`).join(" ");
  return (
    <svg viewBox="0 0 120 32" className={`h-8 w-full ${up ? "text-primary" : "text-danger"}`} aria-hidden="true">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}

// One live price card. `coin` may be undefined before data lands (or on a failed
// fetch) — render "—" but always keep the star button so its onboarding-tour id
// stays in the DOM.
function PriceCard({ coin, starId }: { coin?: Coin; starId?: string }) {
  const up = (coin?.change ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
            {coin?.name ?? "—"}
          </p>
          <p className="mt-1 font-display text-lg font-bold">
            {coin ? `${coin.symbol}/USD` : "···/USD"}
          </p>
        </div>
        {starId && (
          <button
            id={starId}
            type="button"
            aria-label={coin ? `Add ${coin.name} to watchlist` : "Add to watchlist"}
            className="cursor-pointer rounded-md border border-line px-2 py-1 text-sm text-muted transition hover:border-primary/40 hover:text-primary"
          >
            ☆
          </button>
        )}
      </div>
      <p className="mt-3 font-mono text-3xl font-bold tracking-tight">
        {coin ? fmtPrice(coin.price) : "—"}{" "}
        {coin && (
          <span className={`text-sm ${up ? "text-primary" : "text-danger"}`}>
            {up ? "▴" : "▾"}
          </span>
        )}
      </p>
      <div className="mt-4">
        <Sparkline up={up} />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] ${
            up ? "border-primary/40 text-primary" : "border-danger/40 text-danger"
          }`}
        >
          {coin ? `${up ? "▲" : "▼"} ${Math.abs(coin.change).toFixed(2)}%` : "···"}
        </span>
        <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted">
          Real-time data feed
        </span>
      </div>
    </div>
  );
}

type Props = {
  initialGlobal: GlobalStats | null;
  initialCoins: Coin[];
  initialAlerts: AlertRow[];
};

export default function DashboardLive({ initialGlobal, initialCoins, initialAlerts }: Props) {
  const [global, setGlobal] = useState<GlobalStats | null>(initialGlobal);
  const [coins, setCoins] = useState<Coin[]>(initialCoins);
  const [alerts, setAlerts] = useState<AlertRow[]>(initialAlerts);
  // Relative timestamps use Date.now(), which differs between the server render
  // and client hydration ("15s ago" vs "16s ago") — a React hydration mismatch.
  // Gate them behind a mounted flag so the first client render matches the server
  // byte-for-byte, then fill in real relative times immediately after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Market feed — global totals + top coins, every 30s. Server already seeded us,
  // so the first fetch is a full interval away.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/overview");
        if (!res.ok) return; // transient blip — keep the last snapshot
        const json = (await res.json()) as {
          global: GlobalStats | null;
          coins: Coin[];
          status: FetchStatus;
        };
        if (cancelled || json.status !== "ok") return;
        setGlobal(json.global);
        setCoins(json.coins);
      } catch {
        // network hiccup — next tick catches up.
      }
    }
    const id = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Alert feed — this operator's crashes, every 5s (matches the alerts page).
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/alerts");
        if (!res.ok) return;
        const json = (await res.json()) as { alerts: AlertRow[] };
        if (cancelled) return;
        setAlerts(json.alerts ?? []);
      } catch {
        // ignore — next tick catches up.
      }
    }
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Market Overview rows — live totals, or "—" until the first snapshot lands.
  const stats: [string, string, boolean?][] = global
    ? [
        ["Global Market Cap", fmtCompact(global.marketCap)],
        ["24h Volume", fmtCompact(global.volume24h)],
        ["Market Change", fmtPct(global.marketChangePct), global.marketChangePct < 0],
      ]
    : [
        ["Global Market Cap", "—"],
        ["24h Volume", "—"],
        ["Market Change", "—"],
      ];

  // Row 2 is derived from the SAME live `global` totals as Market Overview —
  // so the sentiment word, the headline %, and the bar color all agree with the
  // number shown above instead of the old hardcoded "-0.39% / BULLISH".
  const marketChangePct = global?.marketChangePct ?? 0;
  const marketUp = marketChangePct >= 0;
  // The bar heights ascend by default. When the market is DOWN, reverse them so
  // the sparkline visibly descends instead of climbing in red (misleading).
  const bars = marketUp ? BARS : [...BARS].reverse();

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
      <section
        id="dashboard-stats"
        className="rounded-xl border border-line bg-surface p-5 sm:col-span-2 xl:col-span-4"
      >
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-foreground">
          ◉ Market Overview
        </h2>
        <div className="mt-5 flex flex-col gap-5">
          {stats.map(([label, value, negative]) => (
            <div key={label} className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-xs text-primary">
                ▤
              </span>
              <div>
                <p className="font-mono text-[8px] uppercase tracking-[0.25em] text-muted">
                  {label}
                </p>
                <p
                  className={`font-mono text-base font-bold ${
                    negative ? "text-danger" : "text-foreground"
                  }`}
                >
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="xl:col-span-3">
        <PriceCard coin={coins[0]} starId="watchlist-button" />
      </div>
      <div className="xl:col-span-3">
        <PriceCard coin={coins[1]} />
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 sm:col-span-2 xl:col-span-2">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
          ⚠ System Alerts
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-8 text-center font-mono text-[9px] italic text-muted">
            No alerts triggered
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {alerts.slice(0, 4).map((a) => {
              // Positive % = surge (green), negative = crash (red).
              const surge = a.drop_percentage > 0;
              return (
                <li
                  key={a.id}
                  className={`rounded-md border px-2.5 py-1.5 ${
                    surge ? "border-primary/40 bg-primary/5" : "border-danger/40 bg-danger/5"
                  }`}
                >
                  <p
                    className={`truncate font-mono text-[10px] font-bold ${
                      surge ? "text-primary" : "text-danger"
                    }`}
                  >
                    {a.asset_name}
                  </p>
                  <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted">
                    {surge ? "+" : ""}{a.drop_percentage.toFixed(2)}% · {mounted ? fmtAgo(a.detected_at) : "…"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </div>

      {/* Row 2 — LIVE market trend, derived from the same `global` snapshot. */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="rounded-xl border border-line bg-surface p-5 xl:col-span-7">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
            ↗ Sentry Analytics
          </h2>
          <p className="mt-3 text-xs italic leading-relaxed text-muted">
            Live market sentiment reads{" "}
            <span className={`font-bold not-italic ${marketUp ? "text-primary" : "text-danger"}`}>
              {marketUp ? "BULLISH" : "BEARISH"}
            </span>{" "}
            — global cap is {marketUp ? "up" : "down"} {Math.abs(marketChangePct).toFixed(2)}% over 24h.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-background p-4">
              <p className="font-mono text-[8px] uppercase tracking-[0.25em] text-muted">
                24h Volume
              </p>
              <p className="mt-1 font-mono text-sm font-bold">
                {global ? fmtCompact(global.volume24h) : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-background p-4">
              <p className="font-mono text-[8px] uppercase tracking-[0.25em] text-muted">
                Market Direction
              </p>
              <p className={`mt-1 font-mono text-sm font-bold ${marketUp ? "text-primary" : "text-danger"}`}>
                {marketUp ? "▲ RISING" : "▼ FALLING"}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 xl:col-span-5">
          <p className="font-mono text-[8px] uppercase tracking-[0.25em] text-muted">
            24h Market Change
          </p>
          <p className={`mt-1 font-mono text-xl font-bold ${marketUp ? "text-primary" : "text-danger"}`}>
            {global ? fmtPct(marketChangePct) : "—"}
          </p>
          <div className="mt-6 flex items-end gap-2">
            {bars.map((h, i) => (
              <span
                key={i}
                className={`w-4 rounded-sm ${marketUp ? "bg-primary/70" : "bg-danger/70"} ${h}`}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
