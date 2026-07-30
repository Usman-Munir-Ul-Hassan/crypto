// Lane 1's heartbeat. Every 15s this: (1) re-reads the Watchlist table to learn
// which coins ANY user cares about, (2) pulls their live prices in one batched
// CoinGecko call, (3) writes the snapshot to the RAM cache. The browser never
// calls this — it only reads the cache via /api/prices.
//
// This file is THE one connection point between the two lanes: it reads the same
// Watchlist table that Lane 2 (the /market star button) writes to. That's the
// entire coupling — a newly-starred coin shows up here within 15s, no direct call.

import { prisma } from "./prisma";
import { fetchMarkets, fetchWatchlistPrices } from "./coingecko";
import { setCache } from "./cache";
import { detectCrashes, type DetectionResult } from "./detector";
import { createLogger } from "./logger";
import type { Coin } from "./coingecko";

const log = createLogger("poller");

const POLL_INTERVAL_MS = 15_000;

// The batch id list: every DISTINCT coin across all users' watchlists. distinct
// means if 50 users all watch bitcoin, it's still ONE id in the CoinGecko call.
async function getCoinsToTrack(): Promise<string[]> {
  const rows = await prisma.watchlist.findMany({
    select: { asset_id: true },
    distinct: ["asset_id"],
  });
  return rows.map((r) => r.asset_id);
}

// One tick: DB -> CoinGecko -> detect crashes/surges -> cache. Wrapped so a
// single failed fetch (rate limit, network blip) just skips this tick instead of
// killing the interval. Detection is nested in its own try so a DB hiccup there
// still lets the fresh prices reach the cache (section 15.4).
//
// SINGLE-SOURCE PARITY: watched coins are lifted out of the SAME top-100
// /coins/markets snapshot the market table serves (via fetchMarkets' shared
// micro-cache), so a coin's price and 24h % are IDENTICAL on /market and the
// watchlist — no more "pepe says 2.43 here, 2.8 there" from two separate
// CoinGecko calls seconds apart. Only watched coins OUTSIDE the top 100 get a
// direct batched ?ids= fetch. Side bonus: when every watched coin is in the
// top 100 (the common case), a tick costs ZERO extra CoinGecko calls.
async function pollOnce(): Promise<void> {
  try {
    const ids = await getCoinsToTrack();

    let coins: Coin[] = [];
    if (ids.length > 0) {
      const { coins: market, status } = await fetchMarkets();
      const byId = new Map(market.map((c) => [c.id, c] as const));
      const fromSnapshot = ids.flatMap((id) => {
        const c = byId.get(id);
        return c ? [c] : [];
      });
      const missingIds = ids.filter((id) => !byId.has(id));
      // Coins beyond the top 100 (or everything, if the snapshot came back
      // empty on a hard failure) still get the direct batched fetch.
      const fetchedDirect = missingIds.length > 0 ? await fetchWatchlistPrices(missingIds) : [];
      coins = [...fromSnapshot, ...fetchedDirect];
      log.info("watchlist tick sourced", {
        fromSharedSnapshot: fromSnapshot.length,
        fetchedDirect: fetchedDirect.length,
        snapshotStatus: status,
      });
    }

    let detection: DetectionResult = { crashes: [], surges: [] };
    try {
      detection = await detectCrashes(coins);
    } catch (err) {
      log.error("detection failed — caching prices without alerts", { error: err });
    }

    setCache(coins, detection.crashes, detection.surges);
  } catch (err) {
    // CoinGecko/DB failed. Keep the last good snapshot; retry next cycle (15s)
    // (section 19.1 graceful degradation — the engine logs and waits, never crashes).
    log.error("poll tick failed — keeping previous cache, retrying next cycle", { error: err });
  }
}

// Guard against double-start: HMR in dev, or the hook firing twice, must not
// spawn two intervals hammering CoinGecko. Pin the flag to globalThis.
const globalForPoller = globalThis as unknown as { __pollerStarted?: boolean };

export function startPoller(): void {
  if (globalForPoller.__pollerStarted) return;
  globalForPoller.__pollerStarted = true;

  // Run once immediately so the cache isn't empty for the first 15s after boot,
  // then settle into the steady 15s rhythm.
  void pollOnce();
  setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  log.info("poller started", { intervalMs: POLL_INTERVAL_MS });
}
