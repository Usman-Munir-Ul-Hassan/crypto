// Lane 1's intelligence core — flash-crash AND price-surge detection. It does
// NOT poll or fetch; the poller hands it the SAME price snapshot it just pulled
// each 15s tick, and this file decides which coins are crashing or spiking.
//
// The model (section 15.1, extended): compare each coin's current price to the
// baseline we saved last tick. Drop <= -2% -> flash crash. Rise >= +2% -> price
// surge. After every coin is processed, the current price BECOMES the new
// baseline for the next cycle.
//
// In-memory state (section 15.3), pinned to globalThis so it survives dev HMR
// (same trick as the cache/poller — one process, one source of truth):
//   • baselinePrices  Map<id, price>  — the "last tick" price to compare against
//   • baselineSetAt   Map<id, epochMs> — "point zero": when this coin's baseline
//       tracking began (star-time seed, or first poll that saw it)
//   • lastCrashTime   Map<id, epochMs> — last CRASH alert (cooldown + active set)
//   • lastSurgeTime   Map<id, epochMs> — last SURGE alert (its own cooldown, so a
//       crash can't silence a rebound spike and vice versa)

import { prisma } from "./prisma";
import type { Coin } from "./coingecko";
import { createLogger } from "./logger";

// Component-tagged structured logger (section 19.2) — every line gets an ISO
// timestamp, level, [detector] tag, and structured context.
const log = createLogger("detector");

// A drop of this % or worse (more negative) is a crash. -2.0 per the spec.
// TEST MODE: temporarily -0.01 so ANY real dip fires an alert (not exactly 0 —
// pct <= 0 would fire on perfectly flat prices too). Restore to -2.0 after.
const CRASH_THRESHOLD_PCT = -0.01;
// A rise of this % or better is a surge — the mirror alert of a crash.
// TEST MODE: temporarily 0.01 (spec value: 2.0). Restore after testing.
const SURGE_THRESHOLD_PCT = 0.01;
// One alert per asset per direction per this window — stops a sustained move
// spamming an alert every tick (section 15.2 "Alert Cooldown Period"). After it
// lapses, a still-moving price earns a fresh alert.
const COOLDOWN_MS = 60_000;

const g = globalThis as unknown as {
  __baselinePrices?: Map<string, number>;
  __baselineSetAt?: Map<string, number>;
  __lastAlertTime?: Map<string, number>;
  __lastSurgeTime?: Map<string, number>;
};
const baselinePrices = g.__baselinePrices ?? (g.__baselinePrices = new Map<string, number>());
const baselineSetAt = g.__baselineSetAt ?? (g.__baselineSetAt = new Map<string, number>());
// Kept under the original __lastAlertTime key — it's the crash-direction map.
const lastCrashTime = g.__lastAlertTime ?? (g.__lastAlertTime = new Map<string, number>());
const lastSurgeTime = g.__lastSurgeTime ?? (g.__lastSurgeTime = new Map<string, number>());

// Seed a baseline the MOMENT a coin is first watched, instead of waiting for the
// poller to notice it (which costs up to a full poll cycle before there's even a
// baseline, then another before the first comparison). Called from the watchlist
// POST with a one-off price fetch — this is "point zero" for the coin.
//
// Only seeds if the coin has NO baseline yet: baselines are GLOBAL (keyed by
// asset_id, shared across every user's watchlist), so a second user starring an
// already-tracked coin must NOT reset a live baseline mid-window and mask an
// in-progress crash.
export function seedBaseline(assetId: string, price: number): void {
  if (!(price > 0)) return; // ignore bad data — never poison the baseline
  if (baselinePrices.has(assetId)) return; // already tracked — keep the live baseline
  const now = Date.now();
  baselinePrices.set(assetId, price);
  baselineSetAt.set(assetId, now);
  log.info("baseline seeded (point zero)", { assetId, price });
}

// What the poller stashes in the cache each cycle: asset_ids with an ACTIVE
// alert (created in the last 60s) in each direction, so the UI can paint
// red (crash) / green-pulse (surge) status per card.
export type DetectionResult = {
  crashes: string[];
  surges: string[];
};

type Direction = "crash" | "surge";

// Create one alert row for a crash OR a surge, with the same three guards the
// crash path always had: in-memory cooldown (per direction), DB dedup across
// restarts, and a try/catch so a failed write never stops the cycle.
// Surges reuse the CryptoAlert table — the SIGN of drop_percentage is the
// direction (negative = crash, positive = surge), so no schema change needed.
async function recordAlert(
  coin: Coin,
  current: number,
  baseline: number,
  pct: number,
  now: number,
  direction: Direction
): Promise<void> {
  const times = direction === "crash" ? lastCrashTime : lastSurgeTime;
  const last = times.get(coin.id) ?? 0;

  // In-memory cooldown gate: we alerted within the last 60s for THIS direction,
  // so this is the same ongoing move — skip the DB entirely (fast path).
  if (now - last < COOLDOWN_MS) return;

  try {
    // Belt-and-suspenders across restarts: the map is empty after a reboot,
    // but the DB remembers. Don't double-log a move we already recorded.
    // The sign filter keeps the two directions from deduping each other.
    const existing = await prisma.cryptoAlert.findFirst({
      where: {
        asset_id: coin.id,
        detected_at: { gte: new Date(now - COOLDOWN_MS) },
        drop_percentage: direction === "crash" ? { lt: 0 } : { gt: 0 },
      },
      select: { detected_at: true },
    });

    if (existing) {
      // A recent alert already exists (survived a restart) — adopt its time
      // so the cooldown/active set is correct, but don't create a duplicate.
      times.set(coin.id, existing.detected_at.getTime());
      log.info("recent alert exists — adopting its time, no duplicate", {
        asset: coin.name,
        assetId: coin.id,
        direction,
      });
    } else {
      await prisma.cryptoAlert.create({
        data: {
          asset_id: coin.id,
          asset_name: coin.name,
          price_at_drop: current,
          drop_percentage: pct,
        },
      });
      times.set(coin.id, now);
      // Alert event: asset, current price, baseline, move %, creation result
      // (section 19.1 "When a crash is detected, the log includes...").
      log.warn(direction === "crash" ? "flash crash detected" : "price surge detected", {
        asset: coin.name,
        assetId: coin.id,
        price: current,
        baseline,
        movePct: `${pct.toFixed(2)}%`,
        alert: "created",
      });
    }
  } catch (err) {
    // A failed write must not stop us processing the other coins — log with
    // full context (section 19.1 graceful degradation) and carry on.
    log.error("alert creation failed", {
      assetId: coin.id,
      direction,
      price: current,
      movePct: `${pct.toFixed(2)}%`,
      error: err,
    });
  }
}

// Run one detection pass over the poller's fresh snapshot. Returns the active
// crash + surge sets so the poller can stash them in the cache and the UI can
// paint per-card status.
export async function detectCrashes(coins: Coin[]): Promise<DetectionResult> {
  const now = Date.now();
  let processed = 0;
  let crashes = 0;
  let surges = 0;

  for (const coin of coins) {
    const current = coin.price;

    // Guard bad data — a 0/negative/NaN price would fake a -100% crash. Skip it
    // entirely (don't even overwrite the baseline with garbage).
    if (!(current > 0)) continue;
    processed++;

    const baseline = baselinePrices.get(coin.id);

    // First time we've ever seen this coin AND it wasn't seeded at star-time: no
    // baseline to compare to. Record point zero and move on — comparison starts
    // next cycle (section 15.3 "first polling cycle").
    if (baseline === undefined) {
      baselinePrices.set(coin.id, current);
      baselineSetAt.set(coin.id, now);
      continue;
    }

    // Corrupt/missing baseline (0, negative, NaN): reset to current and continue,
    // don't divide by it (section 15.4 "Graceful Degradation").
    if (!(baseline > 0)) {
      baselinePrices.set(coin.id, current);
      continue;
    }

    const pct = ((current - baseline) / baseline) * 100;

    // EVERY asset, EVERY tick: log its move since last cycle — even a boring
    // +0.30% — so the log file is a full price-move trail per asset, not just
    // the ±2% alert moments. Signed pct: "+1.12%" up, "-0.87%" down.
    log.info("price checked", {
      asset: coin.name,
      assetId: coin.id,
      price: current,
      baseline,
      movePct: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      direction: pct >= 0 ? "up" : "down",
    });

    if (pct <= CRASH_THRESHOLD_PCT) {
      crashes++;
      await recordAlert(coin, current, baseline, pct, now, "crash");
    } else if (pct >= SURGE_THRESHOLD_PCT) {
      surges++;
      await recordAlert(coin, current, baseline, pct, now, "surge");
    }

    // Every coin, crash or not: current price is the baseline for the next cycle.
    baselinePrices.set(coin.id, current);
  }

  // Active sets = assets whose LAST created alert (per direction) is still inside
  // the cooldown window. Everything else is considered stable by the UI.
  const activeCrashes: string[] = [];
  lastCrashTime.forEach((ts, id) => {
    if (now - ts < COOLDOWN_MS) activeCrashes.push(id);
  });
  const activeSurges: string[] = [];
  lastSurgeTime.forEach((ts, id) => {
    if (now - ts < COOLDOWN_MS) activeSurges.push(id);
  });

  // Per-cycle summary (section 19.1 monitoring): start time, counts, active sets.
  log.info("detection cycle complete", {
    cycleStart: new Date(now).toISOString(),
    processed,
    crashes,
    surges,
    activeCrashes: activeCrashes.length,
    activeSurges: activeSurges.length,
  });

  return { crashes: activeCrashes, surges: activeSurges };
}
