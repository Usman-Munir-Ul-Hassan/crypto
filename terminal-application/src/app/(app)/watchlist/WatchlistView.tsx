"use client";

// Watchlist — CLIENT half of Lane 1's live view. Seeded by the server with the
// user's coins (already-priced where the cache had them), then it polls
// /api/prices every 5s and merges fresh prices in by id. The 5s poll reads the
// RAM cache only — the real CoinGecko call happens on the server's 15s poller.
// Removing a coin hits DELETE /api/watchlist/[id] (Lane 2's write path).
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Coin } from "@/app/lib/coingecko";
import { useToast } from "@/app/components/Toaster";

function fmtPrice(n: number): string {
  const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 8;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export default function WatchlistView({ initialCoins }: { initialCoins: Coin[] }) {
  const [coins, setCoins] = useState<Coin[]>(initialCoins);
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
        const json = (await res.json()) as { data: Coin[]; alerts?: string[]; surges?: string[] };
        if (cancelled) return;

        // Index fresh prices by id, then update ONLY the coins on this user's
        // list — leaving a card untouched if the cache doesn't have it yet.
        const byId = new Map(json.data.map((c) => [c.id, c]));
        setCoins((prev) =>
          prev.map((c) => byId.get(c.id) ?? c)
        );
        setAlerts(new Set(json.alerts ?? []));
        setSurges(new Set(json.surges ?? []));
      } catch {
        // Network hiccup — ignore this tick, the next one will catch up.
      }
    }

    const interval = setInterval(poll, 5000); // don't refetch immediately — server already seeded us
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

      {coins.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            {"// No assets on watch"}
          </p>
          <a
            href="/market"
            className="cursor-pointer rounded-md border border-primary/60 bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/20"
          >
            ⌕ Browse Market
          </a>
        </div>
      ) : (
        <div className="mt-8 grid max-h-[calc(100vh-14rem)] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {coins.map((c) => {
            const negative = c.change < 0;
            const pending = c.price === 0 && !c.symbol; // not yet fetched by poller
            const isRemoving = removing.has(c.id);
            const crashing = alerts.has(c.id); // detector flagged an active flash crash
            // Active +2% spike — crash wins the border if both fire in one window.
            const surging = !crashing && surges.has(c.id);
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
                          aria-label={crashing ? "Flash crash detected" : surging ? "Price surge detected" : "Stable"}
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

                {/* Price + 24h delta */}
                <p className="mt-4 font-mono text-3xl font-bold tracking-tight">
                  {pending ? "—" : fmtPrice(c.price)}
                </p>
                {!pending && (
                  <p
                    className={`mt-1 font-mono text-xs font-bold ${
                      negative ? "text-danger" : "text-primary"
                    }`}
                  >
                    {negative ? "▾" : "▴"} {Math.abs(c.change).toFixed(2)}%
                  </p>
                )}

                {/* Flash-crash banner — only while the detector's alert is active */}
                {crashing && (
                  <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-danger">
                    ⚠ Flash crash detected
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
        {"// Live feed · server polls CoinGecko every 15s · browser refreshes every 5s"}
      </p>
    </main>
  );
}
