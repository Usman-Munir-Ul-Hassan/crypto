// Shared CoinGecko access for the browse page (Lane 2). Used by the server
// render (market/page.tsx) to fetch page 1 ONCE on load. One source of truth
// for the URL + the raw→clean shape translation.

import { createLogger } from "./logger";

// Structured logger (section 19.2) — every degraded fetch leaves an evidence
// trail instead of failing silently behind an "honest status" return.
const log = createLogger("coingecko");

export type Coin = {
  rank: number;
  id: string;
  name: string;
  symbol: string;
  image: string; // CoinGecko logo URL
  price: number;
  change: number; // 24h price change % (price_change_percentage_24h)
  marketCap: number;
};

// A coin plus the price it had on the PREVIOUS snapshot (~30s earlier). Both the
// watchlist cache and the /market micro-cache carry this so the two pages can
// show the SAME tick-over-tick delta — (price − prevPrice) / prevPrice × 100 —
// instead of one showing 24h change and the other the last-tick move. null =
// first time we've seen this coin (fresh boot), so there's nothing to compare.
export type LiveCoin = Coin & { prevPrice: number | null };

// Outcome of a fetch attempt — lets the UI show the RIGHT message + a retry.
export type FetchStatus = "ok" | "rate_limit" | "down" | "network";

// Market totals for the dashboard's "Market Overview" panel — straight from
// CoinGecko's /global endpoint (whole-market numbers across all ~17k coins,
// not a top-100 approximation).
export type GlobalStats = {
  marketCap: number; // total market cap, USD
  volume24h: number; // 24h trading volume, USD
  marketChangePct: number; // 24h market cap change, %
};

// Bounded wait so a hung request can't stall the render into an endless spinner.
const REQUEST_TIMEOUT_MS = 8000;

// Optional free "Demo" API key (coingecko.com → Developers Dashboard). Keyless
// access is throttled to roughly 5-15 calls/min per IP; a demo key lifts that
// to ~30/min. Drop COINGECKO_API_KEY=CG-xxxx into .env to activate — no code
// change needed. Absent key = no header, exactly the old behavior.
const API_KEY = process.env.COINGECKO_API_KEY;
const API_HEADERS: HeadersInit | undefined = API_KEY
  ? { "x-cg-demo-api-key": API_KEY }
  : undefined;

// Top coins by market cap. One call maxes at per_page=250; we take 100.
const MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets" +
  "?vs_currency=usd&order=market_cap_desc&per_page=100&page=1" +
  "&sparkline=false"; // price_change_percentage_24h ships in the default response

// Raw shape of the fields we read from each /coins/markets entry.
type MarketEntry = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  price_change_percentage_24h: number | null;
};

// One place to turn a raw /coins/markets entry into our clean Coin shape.
function toCoin(c: MarketEntry): Coin {
  return {
    rank: c.market_cap_rank ?? 0,
    id: c.id,
    name: c.name,
    symbol: c.symbol.toUpperCase(),
    image: c.image,
    price: c.current_price ?? 0,
    change: c.price_change_percentage_24h ?? 0,
    marketCap: c.market_cap ?? 0,
  };
}

// Dashboard totals endpoint — whole-market cap/volume/24h-change in one call.
const GLOBAL_URL = "https://api.coingecko.com/api/v3/global";

// Raw shape of the /global response fields we read.
type GlobalRaw = {
  data: {
    total_market_cap: { usd?: number };
    total_volume: { usd?: number };
    market_cap_change_percentage_24h_usd: number | null;
  };
};

async function fetchMarketsUpstream(): Promise<{
  coins: Coin[];
  status: FetchStatus;
}> {
  // Abort the outbound request if CoinGecko hangs, so the server render can't
  // stall and leave the user staring at a spinner forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // no-store: fetch fresh on each page load (Next.js must not cache this).
    const res = await fetch(MARKETS_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: API_HEADERS,
    });

    if (!res.ok) {
      // Distinguish the failure so the UI can be honest about which one it is.
      if (res.status === 429) {
        log.warn("markets fetch rate-limited (429)", { endpoint: "/coins/markets" });
        return { coins: [], status: "rate_limit" };
      }
      log.error("markets fetch failed — service unavailable", {
        endpoint: "/coins/markets",
        httpStatus: res.status,
      });
      return { coins: [], status: "down" };
    }

    const data = (await res.json()) as MarketEntry[];
    const coins = data.map(toCoin);
    // Fetch audit line — only real upstream pulls land here (cache hits don't).
    log.info("markets fetched", {
      endpoint: "/coins/markets",
      count: coins.length,
      assets: coins.slice(0, 5).map((c) => c.name).join(", ") + (coins.length > 5 ? ", ..." : ""),
    });
    return { coins, status: "ok" };
  } catch (err) {
    // Timeout (abort) or a genuine network failure both land here.
    log.error("markets fetch failed — timeout/network", { endpoint: "/coins/markets", error: err });
    return { coins: [], status: "network" };
  } finally {
    clearTimeout(timer);
  }
}

// Direct /global pull — the dashboard's whole-market totals. Same timeout,
// same honest-status contract as the markets fetch; never throws.
async function fetchGlobalUpstream(): Promise<{
  global: GlobalStats | null;
  status: FetchStatus;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(GLOBAL_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: API_HEADERS,
    });

    if (!res.ok) {
      if (res.status === 429) {
        log.warn("global fetch rate-limited (429)", { endpoint: "/global" });
        return { global: null, status: "rate_limit" };
      }
      log.error("global fetch failed — service unavailable", {
        endpoint: "/global",
        httpStatus: res.status,
      });
      return { global: null, status: "down" };
    }

    const raw = (await res.json()) as GlobalRaw;
    const global: GlobalStats = {
      marketCap: raw.data.total_market_cap.usd ?? 0,
      volume24h: raw.data.total_volume.usd ?? 0,
      marketChangePct: raw.data.market_cap_change_percentage_24h_usd ?? 0,
    };
    log.info("global stats fetched", { endpoint: "/global", marketCap: global.marketCap });
    return { global, status: "ok" };
  } catch (err) {
    log.error("global fetch failed — timeout/network", { endpoint: "/global", error: err });
    return { global: null, status: "network" };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Lane 2 micro-cache ----------------------------------------------------
// CoinGecko's keyless public tier allows only ~5-15 calls/min per IP — shared
// across EVERYTHING this machine sends. Without a cache, every open tab hits
// CoinGecko through /api/markets (10s) and /api/overview (15s) on top of
// the poller's ~2/min, so two tabs already blow the budget and 429s start. Fix: ONE
// process-wide snapshot pinned to globalThis (survives dev HMR, same trick as
// Lane 1's cache) that carries BOTH Lane 2 feeds — the top-100 markets list AND
// the /global dashboard totals — refreshed together on a single 30s clock (two
// parallel calls per refresh). All tabs share
// ONE refresh per TTL window, concurrent requests share the in-flight promise,
// and an upstream failure serves the last good snapshot instead of an error
// screen.
const SNAPSHOT_TTL_MS = 30_000; // shared 30s snapshot window: keeps the market
// Delta's baseline the SAME ~30s reference the watchlist uses (parity) AND caps
// upstream at ~4/min total (markets + global per refresh). The browser polls
// every 10s but reads THIS
// cache, so the faster poll costs zero extra CoinGecko calls. Do NOT drop this
// to 10s or lower: every browser poll would then miss the cache and hit
// CoinGecko (~6+/min -> 429s), and the delta window would diverge from the
// watchlist's.

type MarketsResult = { coins: LiveCoin[]; status: FetchStatus; stale?: boolean };
type GlobalResult = { global: GlobalStats | null; status: FetchStatus; stale?: boolean };
// The one Lane 2 snapshot. fetchedAt = last refresh ATTEMPT (drives the TTL
// retry pacing); dataAt = when the coins were actually pulled from CoinGecko
// (drives the stale banner — failed attempts must not make old data look fresh).
type Lane2Snapshot = {
  markets: MarketsResult;
  global: GlobalResult;
  fetchedAt: number;
  dataAt: number;
};

// Keyless CoinGecko puts a 429ing IP in a penalty window — retrying every 30s
// keeps the penalty alive (retry storm). Circuit breaker: after a 429, go
// SILENT for a full 60s (serve the snapshot, zero upstream calls) so the IP
// can cool off, then try again.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
// Grace before the UI calls the feed "delayed": one missed refresh leaves data
// only ~30s old — not worth alarming the user. Three windows (90s) is real lag.
const STALE_GRACE_MS = SNAPSHOT_TTL_MS * 3;

const gcache = globalThis as unknown as {
  __lane2Snap?: Lane2Snapshot;
  __lane2Inflight?: Promise<Lane2Snapshot> | null;
  __rateLimitedUntil?: number; // circuit breaker: no upstream calls before this
};

// The single refresh path both fetchMarkets and fetchGlobal funnel through.
async function getLane2Snapshot(): Promise<Lane2Snapshot> {
  const snap = gcache.__lane2Snap;
  // Fresh snapshot — serve it, zero upstream calls (this is the 429 fix).
  if (snap && Date.now() - snap.fetchedAt < SNAPSHOT_TTL_MS) return snap;
  // Circuit breaker open (recent 429): DON'T knock on a door that just said
  // "too many requests" — that resets the penalty. Serve the snapshot silently;
  // flag it stale only once it's genuinely old (past the grace window).
  if (snap && gcache.__rateLimitedUntil && Date.now() < gcache.__rateLimitedUntil) {
    if (Date.now() - snap.dataAt >= STALE_GRACE_MS && !snap.markets.stale) {
      gcache.__lane2Snap = {
        ...snap,
        markets: { ...snap.markets, stale: true },
        global: snap.global.global ? { ...snap.global, stale: true } : snap.global,
      };
      return gcache.__lane2Snap;
    }
    return snap;
  }
  // Someone is already fetching — piggyback on their request instead of
  // firing a duplicate at CoinGecko.
  if (gcache.__lane2Inflight) return gcache.__lane2Inflight;

  const inflight = (async () => {
    // ONE refresh pulls both Lane 2 feeds in parallel: /coins/markets for the
    // table + /global for the dashboard totals — two calls on the same 30s clock.
    const [marketsUp, globalUp] = await Promise.all([
      fetchMarketsUpstream(),
      fetchGlobalUpstream(),
    ]);

    // 429 on EITHER endpoint ⇒ open the circuit: every caller for the next 60s
    // is served from the snapshot without even attempting CoinGecko (both calls
    // share one IP budget, so one 429 means the other is next). Logged once.
    if (marketsUp.status === "rate_limit" || globalUp.status === "rate_limit") {
      gcache.__rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      log.warn("circuit breaker open — pausing CoinGecko calls", {
        cooldownMs: RATE_LIMIT_COOLDOWN_MS,
      });
    } else {
      gcache.__rateLimitedUntil = 0; // any non-429 outcome closes the breaker
    }

    let markets: MarketsResult;
    if (marketsUp.status === "ok") {
      // Stamp each coin with its price from the OUTGOING snapshot as prevPrice —
      // the "~30s ago" reference the market table's Delta compares against, the
      // same tick-over-tick formula the watchlist cards run. Only a real positive
      // price is a usable reference (a 0 would fake a +∞% jump).
      const lastPriceById = new Map(
        (snap?.markets.coins ?? []).map((c) => [c.id, c.price] as const)
      );
      const coins: LiveCoin[] = marketsUp.coins.map((c) => {
        const last = lastPriceById.get(c.id);
        // Cold start (no prior snapshot) or a coin new to the top-100 has no
        // previous tick. Seed its baseline to its OWN price so the Delta reads a
        // clean 0.00% for one cycle instead of "—" — the same cold-start baseline
        // convention used for newly-starred coins. The next tick swaps in the
        // real prior price, so the seed never distorts an actual move. A 0 price
        // is still unusable (would fake +∞%), so fall back to null there.
        const prevPrice =
          last !== undefined && last > 0 ? last : c.price > 0 ? c.price : null;
        return { ...c, prevPrice };
      });
      markets = { coins, status: "ok" };
    } else if (snap) {
      // Upstream failed (429/down/network). Stale beats an error page for a
      // browse view — serve the last good snapshot and log the substitution.
      // The banner only fires past the grace window: data ~30s late is normal
      // keyless turbulence, not something to alarm the user about.
      const dataAgeMs = Date.now() - snap.dataAt;
      log.warn("serving stale markets snapshot — upstream failed", {
        reason: marketsUp.status,
        dataAgeMs,
      });
      markets = { ...snap.markets, stale: dataAgeMs >= STALE_GRACE_MS };
    } else {
      markets = { coins: [], status: marketsUp.status }; // no snapshot yet — honest error status
    }

    // Same stale-fallback treatment for the totals: fresh /global result wins;
    // a failed fetch falls back to the previous totals or an honest null.
    let global: GlobalResult;
    if (globalUp.status === "ok" && globalUp.global) {
      global = { global: globalUp.global, status: "ok" };
    } else if (snap && snap.global.global) {
      const dataAgeMs = Date.now() - snap.dataAt;
      log.warn("serving stale global snapshot — upstream failed", {
        reason: globalUp.status,
        dataAgeMs,
      });
      global = { ...snap.global, stale: dataAgeMs >= STALE_GRACE_MS };
    } else {
      global = { global: null, status: globalUp.status }; // never had good totals — honest null + error status
    }

    // fetchedAt advances even on failure: a dead upstream gets ONE retry per 30s
    // window instead of a hammering retry from every 10s browser poll — kinder to
    // an already-429ing CoinGecko, and the stale snapshot covers the gap. dataAt
    // only advances on a REAL fetch, so the stale-grace clock keeps honest time.
    const next: Lane2Snapshot = {
      markets,
      global,
      fetchedAt: Date.now(),
      dataAt: marketsUp.status === "ok" ? Date.now() : snap?.dataAt ?? Date.now(),
    };
    gcache.__lane2Snap = next;
    return next;
  })().finally(() => {
    gcache.__lane2Inflight = null;
  });
  gcache.__lane2Inflight = inflight;
  return inflight;
}

export async function fetchMarkets(): Promise<MarketsResult> {
  return (await getLane2Snapshot()).markets;
}

// Lane 1's batched price fetch. The union of every watchlisted coin id is
// split into batches of ≤100 ids (CoinGecko's per_page cap for one call) and
// each batch is pulled with ONE /coins/markets call filtered by ?ids= — this
// returns name + symbol + logo + price + 24h change together, so the cards
// need no second lookup. Every batch logs what it fetched (asset names) so the
// log file is a full fetch audit trail. Called by the 30s poller, never by the
// browser. If ANY batch fails the whole tick throws — the poller then keeps
// the previous complete snapshot instead of caching a half-empty watchlist.
const WATCHLIST_BATCH_SIZE = 100;

export async function fetchWatchlistPrices(ids: string[]): Promise<Coin[]> {
  if (ids.length === 0) return []; // nobody's watching anything -> skip the call

  // Chunk the id list into CoinGecko-sized batches.
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += WATCHLIST_BATCH_SIZE) {
    batches.push(ids.slice(i, i + WATCHLIST_BATCH_SIZE));
  }

  const all: Coin[] = [];
  for (let b = 0; b < batches.length; b++) {
    const batchIds = batches[b];
    const batchTag = `${b + 1}/${batches.length}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const url =
      "https://api.coingecko.com/api/v3/coins/markets" +
      `?vs_currency=usd&ids=${encodeURIComponent(batchIds.join(","))}` +
      `&order=market_cap_desc&per_page=${WATCHLIST_BATCH_SIZE}` +
      "&sparkline=false";

    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: API_HEADERS,
      });
      if (!res.ok) {
        if (res.status === 429) {
          log.warn("watchlist batch rate-limited (429)", { batch: batchTag, assets: batchIds.join(", ") });
        } else {
          log.error("watchlist batch fetch failed — service unavailable", {
            batch: batchTag,
            httpStatus: res.status,
            assets: batchIds.join(", "),
          });
        }
        throw new Error(`coins/markets ${res.status}`);
      }
      const data = (await res.json()) as MarketEntry[];
      const coins = data.map(toCoin);
      // Fetch audit line: which batch, how many, and WHICH assets came back.
      log.info("watchlist batch fetched", {
        batch: batchTag,
        count: coins.length,
        assets: coins.map((c) => c.name).join(", "),
      });
      all.push(...coins);
    } catch (err) {
      // HTTP failures were already logged above — only log the timeout/network
      // flavor here, then rethrow either way so the poller keeps the old snapshot.
      if (!(err instanceof Error && err.message.startsWith("coins/markets"))) {
        log.error("watchlist batch fetch failed — timeout/network", {
          batch: batchTag,
          assets: batchIds.join(", "),
          error: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return all;
}

// Dashboard totals — reads the SAME shared Lane 2 snapshot as fetchMarkets.
// The numbers are derived from the top-100 payload (deriveGlobalStats), so N
// dashboard tabs cost ZERO extra CoinGecko calls: /global is gone entirely.
export async function fetchGlobal(): Promise<GlobalResult> {
  return (await getLane2Snapshot()).global;
}
