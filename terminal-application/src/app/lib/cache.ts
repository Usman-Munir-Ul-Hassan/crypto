// Lane 1's in-memory price cache — the "shared whiteboard" the poller writes to
// and /api/prices reads from. Lives in the single Node process (per our
// single-process runtime), so reads are a plain function call, not a network hop.
//
// Why globalThis: in dev, Next.js hot-reloads modules on every edit, which would
// wipe a normal module-level variable (and could spawn duplicate pollers). Pinning
// the store to globalThis lets it survive HMR so we keep ONE cache + ONE poller.

import type { Coin } from "./coingecko";

type PriceStore = {
  data: Coin[]; // latest snapshot of every tracked coin
  alerts: string[]; // asset_ids currently crashing (active alert in last 60s)
  surges: string[]; // asset_ids currently surging +2% (active alert in last 60s)
  updatedAt: number; // epoch ms of the last successful poll (0 = never)
};

// Reuse the same object across HMR reloads instead of re-creating it.
const globalForCache = globalThis as unknown as { __priceStore?: PriceStore };

const store: PriceStore =
  globalForCache.__priceStore ??
  (globalForCache.__priceStore = { data: [], alerts: [], surges: [], updatedAt: 0 });

// Read the whole snapshot (used by the /watchlist server render AND /api/prices).
export function getCache(): PriceStore {
  return store;
}

// Overwrite the snapshot after a successful poll. We replace the array wholesale
// (not merge) so a coin that left every watchlist naturally drops out. alerts /
// surges are the detector's active crash + surge sets for this cycle.
export function setCache(data: Coin[], alerts: string[], surges: string[]): void {
  store.data = data;
  store.alerts = alerts;
  store.surges = surges;
  store.updatedAt = Date.now();
}
