// Lane 1's heartbeat. Every 30s this: (1) re-reads the Watchlist table to learn


import { prisma } from "./prisma";
import { fetchMarkets, fetchWatchlistPrices } from "./coingecko";
import { setCache } from "./cache";
import { detectCrashes, type DetectionResult } from "./detector";
import { createLogger } from "./logger";
import type { Coin } from "./coingecko";

const log = createLogger("poller");

const POLL_INTERVAL_MS = 30_000;

// The batch id list: every DISTINCT coin across all users' watchlists. distinct
// means if 50 users all watch bitcoin, it's still ONE id in the CoinGecko call.
async function getCoinsToTrack(): Promise<string[]> {
  const rows = await prisma.watchlist.findMany({
    select: { asset_id: true },
    distinct: ["asset_id"],
  });
  return rows.map((r) => r.asset_id);
}


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
    // CoinGecko/DB failed. Keep the last good snapshot; retry next cycle (30s)
    // (section 19.1 graceful degradation — the engine logs and waits, never crashes).
    log.error("poll tick failed — keeping previous cache, retrying next cycle", { error: err });
  }
}


const globalForPoller = globalThis as unknown as { __pollerStarted?: boolean };

export function startPoller(): void {
  if (globalForPoller.__pollerStarted) return;
  globalForPoller.__pollerStarted = true;

  // Run once immediately so the cache isn't empty for the first 30s after boot,
  // then settle into the steady 30s rhythm.
  void pollOnce();
  setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  log.info("poller started", { intervalMs: POLL_INTERVAL_MS });
}
