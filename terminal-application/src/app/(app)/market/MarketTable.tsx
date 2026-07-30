"use client";

// Market table — CLIENT half of the browse page (Lane 2). Seeded with the coins
// fetched on the server for a fast first paint, then re-pulls /api/markets every
// 15s (same cadence as the watchlist poller) so the table is live. The Delta
// column shows CoinGecko's 24h change — the SAME field the watchlist cards
// display — refreshed with every 15s pull, so both views always agree. Owns the
// interactive bits: search filter + star toggle wired to /api/watchlist (POST
// to star, DELETE to un-star). This is Lane 2's single connection to Lane 1: a
// starred coin lands in Postgres, and Lane 1's poller picks it up on its next
// tick. On a fetch failure it shows a status-specific message + a Retry button
// that re-runs the Server Component via router.refresh().
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Coin, FetchStatus } from "@/app/lib/coingecko";
import { useToast } from "@/app/components/Toaster";

// Honest, failure-specific copy — users forgive "try again shortly" far more
// than a generic broken-looking error.
const FEED_ERROR: Record<Exclude<FetchStatus, "ok">, string> = {
  rate_limit: "Too many requests — feed rate-limited. Try again shortly.",
  down: "CoinGecko service unavailable. Try again in a moment.",
  network: "Couldn't reach the price feed (timeout/network). Try again.",
};

function fmtPrice(n: number): string {
  // Sub-penny coins (e.g. SHIB) need more precision than blue chips.
  const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 8;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US")}`;
}

export default function MarketTable({
  coins,
  status,
  initialStarred,
}: {
  coins: Coin[];
  status: FetchStatus;
  initialStarred: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  // isPending shows a "Retrying…" state while the Server Component re-fetches.
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  // Seeded from the server (this user's watchlist) so stars paint filled on
  // first render — no client-side GET needed.
  const [starred, setStarred] = useState<Set<string>>(() => new Set(initialStarred));
  // Coins mid-request — disables the button so a double-click can't fire two
  // conflicting calls.
  const [pendingStars, setPendingStars] = useState<Set<string>>(new Set());
  // Live copy of the table data — seeded from the server render, then replaced
  // wholesale by the 15s /api/markets poll (only on a clean "ok" response, so a
  // rate-limited tick keeps the last good snapshot instead of blanking the table).
  const [liveCoins, setLiveCoins] = useState<Coin[]>(coins);
  // True when the server served a STALE snapshot (CoinGecko unreachable) or a
  // poll couldn't reach the server at all — the numbers on screen are the last
  // known good ones, so we warn the user rather than pretend they're live.
  const [feedStale, setFeedStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok) {
          if (!cancelled) setFeedStale(true);
          return;
        }
        const json = (await res.json()) as { coins: Coin[]; status: FetchStatus; stale?: boolean };
        if (cancelled) return;
        if (json.status !== "ok" || json.coins.length === 0) {
          setFeedStale(true);
          return;
        }
        setLiveCoins(json.coins);
        setFeedStale(Boolean(json.stale)); // fresh = clears the warning
      } catch {
        // Couldn't reach the server (often the browser itself is offline —
        // ConnectionStatus shows the global banner; we flag the table too).
        if (!cancelled) setFeedStale(true);
      }
    }
    const id = setInterval(poll, 15000); // server already seeded the first paint
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Retry = re-run the Server Component (re-fetches page 1 on the server).
  function retry() {
    startTransition(() => router.refresh());
  }

  // Optimistic star toggle: flip the UI first, persist to /api/watchlist, and
  // roll back only if the request fails. A 401 (session expired) sends the user
  // to login — /market is public, but writing to a watchlist is not.
  async function toggleStar(coin: Coin) {
    const id = coin.id;
    if (pendingStars.has(id)) return; // already in flight — ignore repeat clicks
    const wasStarred = starred.has(id);

    setStarred((prev) => {
      const next = new Set(prev);
      if (wasStarred) next.delete(id);
      else next.add(id);
      return next;
    });
    setPendingStars((prev) => new Set(prev).add(id));

    try {
      const res = wasStarred
        ? await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" })
        : await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asset_id: id, name: coin.name }),
          });

      if (res.status === 401) {
        router.push("/login?callbackUrl=/market");
        return;
      }
      if (!res.ok) throw new Error(`watchlist write failed: ${res.status}`);
      // Persisted cleanly — confirm to the user which way it went.
      toast("success", wasStarred ? `${coin.name} removed from watchlist` : `${coin.name} added to watchlist`);
    } catch {
      // Roll the optimistic flip back so the star reflects real DB state.
      setStarred((prev) => {
        const next = new Set(prev);
        if (wasStarred) next.add(id);
        else next.delete(id);
        return next;
      });
      toast("error", `Couldn't ${wasStarred ? "remove" : "add"} ${coin.name} — try again`);
    } finally {
      setPendingStars((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return liveCoins;
    return liveCoins.filter(
      (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)
    );
  }, [liveCoins, query]);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:gap-6 sm:px-8">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="⌕  SEARCH INDEX..."
          className="w-full min-w-0 max-w-md flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 font-mono text-[10px] tracking-[0.15em] text-foreground placeholder:text-muted focus:border-primary/40 focus:outline-none"
        />
        <div className="ml-auto hidden shrink-0 text-right sm:block">
          <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-muted">Tracked Assets</p>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary">
            ● {starred.size} On Watch
          </p>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        {/* Page header */}
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-lg text-primary">
            ▤
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-black italic tracking-wide sm:text-3xl">
              MARKET EXPLORER
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-muted">
              {`// Asset index & liquidity map — ${liveCoins.length} assets`}
            </p>
          </div>
        </div>

        {/* Feed-delayed warning — data is showing but it's the last good snapshot */}
        {feedStale && liveCoins.length > 0 && (
          <div className="mt-6 flex items-center gap-2.5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
              {"// Live prices delayed — feed temporarily unreachable. Showing last known values."}
            </p>
          </div>
        )}

        {/* Table */}
        <div className="mt-8 overflow-hidden rounded-xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[8px] uppercase tracking-[0.3em] text-muted">
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 text-right font-medium">Last Quote</th>
                  <th className="px-5 py-3 text-right font-medium">Delta</th>
                  <th className="px-5 py-3 text-right font-medium">Market Cap</th>
                  <th className="px-5 py-3 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  // Same field the watchlist cards render (c.change = 24h %),
                  // so an asset never disagrees between the two views.
                  const negative = c.change < 0;
                  const isStarred = starred.has(c.id);
                  const isSaving = pendingStars.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-line/60 transition last:border-b-0 hover:bg-background"
                    >
                      {/* Asset */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Image
                            src={c.image}
                            alt={c.name}
                            width={28}
                            height={28}
                            className="shrink-0 rounded-full"
                            unoptimized
                          />
                          <div className="min-w-0">
                            <p className="font-display text-sm font-bold">{c.name}</p>
                            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted">
                              {c.symbol}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Last quote */}
                      <td className="px-5 py-4 text-right font-mono text-sm font-bold tracking-tight">
                        {fmtPrice(c.price)}
                      </td>

                      {/* Delta — 24h change, identical to the watchlist cards */}
                      <td className="px-5 py-4 text-right">
                        <span
                          className={`font-mono text-xs font-bold ${
                            negative ? "text-danger" : "text-primary"
                          }`}
                        >
                          {negative ? "▾" : "▴"} {Math.abs(c.change).toFixed(2)}%
                        </span>
                      </td>

                      {/* Market cap */}
                      <td className="px-5 py-4 text-right font-mono text-[10px] uppercase tracking-widest text-muted">
                        {fmtCap(c.marketCap)}
                      </td>

                      {/* Actions — star toggle */}
                      <td className="px-5 py-4">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleStar(c)}
                            disabled={isSaving}
                            aria-label={
                              isStarred
                                ? `Remove ${c.name} from watchlist`
                                : `Add ${c.name} to watchlist`
                            }
                            aria-pressed={isStarred}
                            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-sm transition disabled:opacity-50 ${
                              isStarred
                                ? "border-primary/60 bg-primary/10 text-primary shadow-glow"
                                : "border-line text-muted hover:border-primary/40 hover:text-primary"
                            }`}
                          >
                            {isStarred ? "★" : "☆"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center">
                      {status !== "ok" ? (
                        <div className="flex flex-col items-center gap-4">
                          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-danger">
                            {`// ${FEED_ERROR[status]}`}
                          </p>
                          <button
                            type="button"
                            onClick={retry}
                            disabled={isPending}
                            className="cursor-pointer rounded-md border border-primary/60 bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/20 disabled:opacity-50"
                          >
                            {isPending ? "Retrying…" : "↻ Retry"}
                          </button>
                        </div>
                      ) : (
                        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                          {"// No assets match query"}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-4 font-mono text-[8px] uppercase tracking-[0.3em] text-muted">
          {"// CoinGecko /coins/markets · refreshes every 15s · delta = 24h change, same as watchlist"}
        </p>
      </main>
    </>
  );
}
