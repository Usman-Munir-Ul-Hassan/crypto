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
  change: number; // 24h %
  marketCap: number;
};

// Outcome of a fetch attempt — lets the UI show the RIGHT message + a retry.
export type FetchStatus = "ok" | "rate_limit" | "down" | "network";

// Whole-market snapshot for the dashboard's "Market Overview" panel.
export type GlobalStats = {
  marketCap: number; // total crypto market cap, USD
  volume24h: number; // total 24h trading volume, USD
  marketChangePct: number; // 24h market-cap change, %
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
  "&sparkline=false&price_change_percentage=24h";

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

async function fetchMarketsUpstream(): Promise<{ coins: Coin[]; status: FetchStatus }> {
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

// ---- Lane 2 micro-cache ----------------------------------------------------
// CoinGecko's keyless public tier allows only ~5-15 calls/min per IP — shared
// across EVERYTHING this machine sends. Without a cache, every open tab hits
// CoinGecko through /api/markets (15s) and /api/overview (30s) on top of the
// poller's 4/min, so two tabs already blow the budget and 429s start. Fix:
// process-wide snapshots pinned to globalThis (survives dev HMR, same trick as
// Lane 1's cache). All tabs share ONE upstream call per TTL window, concurrent
// requests share the in-flight promise, and an upstream failure serves the
// last good snapshot instead of an error screen.
const MARKETS_TTL_MS = 15_000; // matches the market table's 15s browser poll
const GLOBAL_TTL_MS = 30_000; // matches the dashboard's 30s overview poll

type MarketsResult = { coins: Coin[]; status: FetchStatus; stale?: boolean };
type GlobalResult = { global: GlobalStats | null; status: FetchStatus; stale?: boolean };

const gcache = globalThis as unknown as {
  __marketsSnap?: { value: MarketsResult; fetchedAt: number };
  __marketsInflight?: Promise<MarketsResult> | null;
  __globalSnap?: { value: GlobalResult; fetchedAt: number };
  __globalInflight?: Promise<GlobalResult> | null;
};

export async function fetchMarkets(): Promise<MarketsResult> {
  const snap = gcache.__marketsSnap;
  // Fresh snapshot — serve it, zero upstream calls (this is the 429 fix).
  if (snap && Date.now() - snap.fetchedAt < MARKETS_TTL_MS) return snap.value;
  // Someone is already fetching — piggyback on their request instead of
  // firing a duplicate at CoinGecko.
  if (gcache.__marketsInflight) return gcache.__marketsInflight;

  const inflight = (async () => {
    const result = await fetchMarketsUpstream();
    if (result.status === "ok") {
      gcache.__marketsSnap = { value: result, fetchedAt: Date.now() };
      return result;
    }
    // Upstream failed (429/down/network). Stale beats an error page for a
    // browse view — serve the last good snapshot and log the substitution.
    if (snap) {
      log.warn("serving stale markets snapshot — upstream failed", {
        reason: result.status,
        ageMs: Date.now() - snap.fetchedAt,
      });
      // Flag it stale so the client can warn the user the feed is delayed —
      // the cached value's own status stays "ok" (the data itself is valid).
      return { ...snap.value, stale: true };
    }
    return result; // no snapshot yet — surface the honest error status
  })().finally(() => {
    gcache.__marketsInflight = null;
  });
  gcache.__marketsInflight = inflight;
  return inflight;
}

// Lane 1's batched price fetch. The union of every watchlisted coin id is
// split into batches of ≤100 ids (CoinGecko's per_page cap for one call) and
// each batch is pulled with ONE /coins/markets call filtered by ?ids= — this
// returns name + symbol + logo + price + 24h change together, so the cards
// need no second lookup. Every batch logs what it fetched (asset names) so the
// log file is a full fetch audit trail. Called by the 15s poller, never by the
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
      "&sparkline=false&price_change_percentage=24h";

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

// Whole-market totals for the dashboard's Market Overview panel. Same guarded
// fetch pattern as the markets call (timeout + honest status), reading
// CoinGecko's /global summary. Returns null global on any failure so the UI
// can show "—".
async function fetchGlobalUpstream(): Promise<{ global: GlobalStats | null; status: FetchStatus }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global", {
      cache: "no-store",
      signal: controller.signal,
      headers: API_HEADERS,
    });

    if (!res.ok) {
      if (res.status === 429) {
        log.warn("global stats fetch rate-limited (429)", { endpoint: "/global" });
        return { global: null, status: "rate_limit" };
      }
      log.error("global stats fetch failed — service unavailable", {
        endpoint: "/global",
        httpStatus: res.status,
      });
      return { global: null, status: "down" };
    }

    const json = (await res.json()) as {
      data: {
        total_market_cap: { usd: number | null };
        total_volume: { usd: number | null };
        market_cap_change_percentage_24h_usd: number | null;
      };
    };
    const d = json.data;
    return {
      global: {
        marketCap: d.total_market_cap?.usd ?? 0,
        volume24h: d.total_volume?.usd ?? 0,
        marketChangePct: d.market_cap_change_percentage_24h_usd ?? 0,
      },
      status: "ok",
    };
  } catch (err) {
    log.error("global stats fetch failed — timeout/network", { endpoint: "/global", error: err });
    return { global: null, status: "network" };
  } finally {
    clearTimeout(timer);
  }
}

// Cached wrapper — same micro-cache pattern as fetchMarkets, so N dashboard
// tabs cost ONE /global call per 30s window instead of N.
export async function fetchGlobal(): Promise<GlobalResult> {
  const snap = gcache.__globalSnap;
  if (snap && Date.now() - snap.fetchedAt < GLOBAL_TTL_MS) return snap.value;
  if (gcache.__globalInflight) return gcache.__globalInflight;

  const inflight = (async () => {
    const result = await fetchGlobalUpstream();
    if (result.status === "ok") {
      gcache.__globalSnap = { value: result, fetchedAt: Date.now() };
      return result;
    }
    if (snap) {
      log.warn("serving stale global snapshot — upstream failed", {
        reason: result.status,
        ageMs: Date.now() - snap.fetchedAt,
      });
      return { ...snap.value, stale: true };
    }
    return result;
  })().finally(() => {
    gcache.__globalInflight = null;
  });
  gcache.__globalInflight = inflight;
  return inflight;
}
