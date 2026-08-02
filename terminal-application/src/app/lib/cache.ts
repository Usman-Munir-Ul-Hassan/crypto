// Lane 1's in-memory price cache — the "shared whiteboard" the poller writes to
// and /api/prices reads from. Lives in the single Node process (per our
// single-process runtime), so reads are a plain function call, not a network hop.
//
// Why globalThis: in dev, Next.js hot-reloads modules on every edit, which would
// wipe a normal module-level variable (and could spawn duplicate pollers). Pinning
// the store to globalThis lets it survive HMR so we keep ONE cache + ONE poller.

import type { Coin, LiveCoin } from "./coingecko";

// LiveCoin (Coin + prevPrice) is defined next to Coin in coingecko.ts so the
// /market micro-cache can carry the same shape. Re-exported here because the
// watchlist UI + page import it from "@/app/lib/cache".
export type { LiveCoin };

type PriceStore = {
  data: LiveCoin[]; // latest snapshot of every tracked coin (+ last tick's price)
  alerts: string[]; // asset_ids currently crashing (active alert in last 60s)
  surges: string[]; // asset_ids currently surging +2% (active alert in last 60s)
  updatedAt: number; // epoch ms of the last successful poll (0 = never)
  prevUpdatedAt: number; // epoch ms of the poll BEFORE that (0 = none) — the
  // updatedAt/prevUpdatedAt gap is the REAL tick interval the UI displays,
  // measured, not assumed (a slow CoinGecko response stretches it honestly).
};

// Reuse the same object across HMR reloads instead of re-creating it.
const globalForCache = globalThis as unknown as { __priceStore?: PriceStore };

const store: PriceStore =
  globalForCache.__priceStore ??
  (globalForCache.__priceStore = {
    data: [],
    alerts: [],
    surges: [],
    updatedAt: 0,
    prevUpdatedAt: 0,
  });

// Read the whole snapshot (used by the /watchlist server render AND /api/prices).
export function getCache(): PriceStore {
  return store;
}

// Overwrite the snapshot after a successful poll. We replace the array wholesale
// (not merge) so a coin that left every watchlist naturally drops out. alerts /
// surges are the detector's active crash + surge sets for this cycle. Before
// overwriting, each coin adopts the OUTGOING snapshot's price as its prevPrice —
// that's the "~30s ago" reference the watchlist cards display.
export function setCache(data: Coin[], alerts: string[], surges: string[]): void {
  const lastPriceById = new Map(store.data.map((c) => [c.id, c.price] as const));
  store.data = data.map((c) => {
    const last = lastPriceById.get(c.id);
    // Only a real positive price is a usable reference — a 0 placeholder would
    // fake a +∞% move on the very next tick.
    return { ...c, prevPrice: last !== undefined && last > 0 ? last : null };
  });
  store.alerts = alerts;
  store.surges = surges;
  store.prevUpdatedAt = store.updatedAt; // the outgoing write time becomes "the tick before"
  store.updatedAt = Date.now();
}
