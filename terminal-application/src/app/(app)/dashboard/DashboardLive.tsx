"use client";

// Dashboard — CLIENT half. Renders Row 1 (Market Overview + price cards + System
// Alerts) AND Row 2 (Sentry Analytics + 24h Market Change trend), keeping both
// live. Seeded by the server for a flash-free first paint, then polls two feeds:
//   • /api/overview every 15s — global market totals + top-2 coins. Reads the
//     shared 30s Lane 2 snapshot (same source as the market table), so the
//     dashboard's percentages never diverge from those views (single-source parity).
//   • /api/alerts   every 10s — this operator's crash alerts (matches the alerts page)
// Row 2's sentiment + trend chart are DERIVED from the same live `global` totals,
// so they agree with Market Overview instead of showing hardcoded values.
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useState } from "react";
import type { Coin, FetchStatus, GlobalStats } from "@/app/lib/coingecko";
import type { AlertRow } from "../alerts/AlertsView";

const FALLBACK_COINS: Coin[] = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", price: 65420.0, change: 0, marketCap: 0, rank: 1, image: "" },
  { id: "ethereum", name: "Ethereum", symbol: "ETH", price: 3450.0, change: 0, marketCap: 0, rank: 2, image: "" },
];

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

// "3m ago" style relative time for the alert rows (recomputed each 10s poll).
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
function PriceCard({ coin, starId, status }: { coin?: Coin; starId?: string; status?: FetchStatus }) {
  const up = (coin?.change ?? 0) >= 0;
  const isRateLimited = status === "rate_limit";
  
  return (
    <div className={`rounded-xl border border-line bg-surface p-5 relative overflow-hidden ${isRateLimited ? "border-danger/30" : ""}`}>
      {isRateLimited && (
        <div className="absolute inset-0 bg-danger/5 bg-diagonal-stripes opacity-20 pointer-events-none" />
      )}
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className={`font-mono text-[9px] uppercase tracking-[0.3em] ${isRateLimited ? "text-danger" : "text-muted"}`}>
            {coin?.name ?? (isRateLimited ? "API PAUSED" : "—")}
          </p>
          <p className={`mt-1 font-display text-lg font-bold ${isRateLimited ? "text-muted" : ""}`}>
            {coin ? `${coin.symbol}/USD` : (isRateLimited ? "RATE LIMIT ACTIVE" : "···/USD")}
          </p>
        </div>
        {starId && (
          <button
            id={starId}
            type="button"
            disabled={isRateLimited}
            aria-label={coin ? `Add ${coin.name} to watchlist` : "Add to watchlist"}
            className="cursor-pointer rounded-md border border-line px-2 py-1 text-sm text-muted transition hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ☆
          </button>
        )}
      </div>
      <p className={`relative z-10 mt-3 font-mono text-3xl font-bold tracking-tight ${isRateLimited ? "text-danger/70" : ""}`}>
        {coin ? fmtPrice(coin.price) : (isRateLimited ? "WAITING..." : "—")}{" "}
        {coin && (
          <span className={`text-sm ${up ? "text-primary" : "text-danger"}`}>
            {up ? "▴" : "▾"}
          </span>
        )}
      </p>
      <div className="relative z-10 mt-4 h-8 flex flex-col justify-center">
        {isRateLimited ? (
          <div className="w-full border-t-2 border-dashed border-danger/30"></div>
        ) : (
          <Sparkline up={up} />
        )}
      </div>
      <div className="relative z-10 mt-4 flex items-center justify-between">
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] ${
            coin ? (up ? "border-primary/40 text-primary" : "border-danger/40 text-danger") 
                 : (isRateLimited ? "border-danger/40 text-danger" : "border-line text-muted")
          }`}
        >
          {coin ? `${up ? "▲" : "▼"} ${Math.abs(coin.change).toFixed(2)}%` : (isRateLimited ? "COOLDOWN" : "···")}
        </span>
        <span className={`font-mono text-[8px] uppercase tracking-[0.2em] ${isRateLimited ? "text-danger animate-pulse" : "text-muted"}`}>
          {isRateLimited ? "Data Feed Blocked" : "Real-time data feed"}
        </span>
      </div>
    </div>
  );
}

type Props = {
  initialGlobal: GlobalStats | null;
  initialCoins: Coin[];
  initialAlerts: AlertRow[];
  initialStatus?: FetchStatus;
};

export default function DashboardLive({ initialGlobal, initialCoins, initialAlerts, initialStatus = "ok" }: Props) {
  const [global, setGlobal] = useState<GlobalStats | null>(initialGlobal);
  const [coins, setCoins] = useState<Coin[]>(initialCoins);
  const [alerts, setAlerts] = useState<AlertRow[]>(initialAlerts);
  const [status, setStatus] = useState<FetchStatus>(initialStatus);
  const [feedStale, setFeedStale] = useState(initialCoins.length === 0 && initialStatus !== "ok");
  // Relative timestamps use Date.now(), which differs between the server render
  // and client hydration ("15s ago" vs "16s ago") — a React hydration mismatch.
  // Gate them behind a mounted flag so the first client render matches the server
  // byte-for-byte, then fill in real relative times immediately after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Market feed — global totals + top coins, every 15s (reads the shared 30s
  // Lane 2 snapshot — each new snapshot is picked up within one poll). Server
  // already seeded us, so the first fetch is a full interval away.
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
          stale?: boolean;
        };
        if (cancelled) return;
        setStatus(json.status);
        if (json.status !== "ok" || json.coins.length === 0) {
          setFeedStale(true);
          return;
        }
        setGlobal(json.global);
        setCoins(json.coins);
        setFeedStale(Boolean(json.stale));
      } catch {
        // network hiccup — next tick catches up.
      }
    }
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Alert feed — this operator's crashes, every 10s (matches the alerts page).
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
      {feedStale && (
        <div className="mt-4 mx-4 sm:mx-6 lg:mx-8 flex items-center gap-2.5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
            {"// Live prices delayed — feed temporarily unreachable. Showing last known values."}
          </p>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
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
        <PriceCard coin={coins[0] ?? FALLBACK_COINS[0]} starId="watchlist-button" status={status} />
      </div>
      <div className="xl:col-span-3">
        <PriceCard coin={coins[1] ?? FALLBACK_COINS[1]} status={status} />
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
