// scripts/test-detector.ts — temporary verification harness (run: npx tsx scripts/test-detector.ts)
// Proves, against the REAL detector + REAL database:
//   1. a -3% move creates a CRASH alert (WARN log + DB row, negative %)
//   2. a +3% move creates a SURGE alert (WARN log + DB row, positive %)
//   3. the 60s cooldown blocks a duplicate alert in the same direction
//   4. simulated CoinGecko failures (429 / 500 / network) hit the structured logger
// Cleans up its own test rows at the end (asset_id "qa-test-coin").

import { seedBaseline, detectCrashes } from "../src/app/lib/detector";
import { fetchMarkets, fetchGlobal } from "../src/app/lib/coingecko";
import { prisma } from "../src/app/lib/prisma";
import type { Coin } from "../src/app/lib/coingecko";

const TEST_ID = "qa-test-coin";

function coin(price: number): Coin {
  return {
    rank: 999,
    id: TEST_ID,
    name: "QA Test Coin",
    symbol: "QAT",
    image: "",
    price,
    change: 0,
    marketCap: 0,
  };
}

async function main() {
  // Start from a clean slate so an aborted previous run can't trip the DB dedup.
  await prisma.cryptoAlert.deleteMany({ where: { asset_id: TEST_ID } });

  console.log("\n=== 1. CRASH — baseline $100, price drops to $97 (-3.00%) ===");
  seedBaseline(TEST_ID, 100); // point zero
  let active = await detectCrashes([coin(97)]);
  console.log("-> active sets:", JSON.stringify(active));

  console.log("\n=== 2. SURGE — baseline rolled to $97, price jumps to $100 (+3.09%) ===");
  active = await detectCrashes([coin(100)]);
  console.log("-> active sets:", JSON.stringify(active));

  console.log("\n=== 3. COOLDOWN — drops to $97 again (-3%) within 60s -> NO new row ===");
  active = await detectCrashes([coin(97)]);
  console.log("-> active sets:", JSON.stringify(active));

  console.log("\n=== 4. DB rows written for", TEST_ID, "===");
  const rows = await prisma.cryptoAlert.findMany({
    where: { asset_id: TEST_ID },
    orderBy: { detected_at: "asc" },
  });
  for (const r of rows) {
    console.log(
      `   ${r.drop_percentage > 0 ? "SURGE" : "CRASH"}  ${r.drop_percentage.toFixed(2)}%  @ $${r.price_at_drop}`
    );
  }
  console.log(`   total rows: ${rows.length} (expected 2: one crash, one surge)`);

  console.log("\n=== 5. ERROR LOGGING — simulated CoinGecko failures ===");
  const realFetch = globalThis.fetch;

  console.log("\n--- 5a. HTTP 429 (rate limit) -> expect [coingecko] WARN ---");
  globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
  console.log("-> fetchMarkets status:", (await fetchMarkets()).status);

  console.log("\n--- 5b. HTTP 500 (service down) -> expect [coingecko] ERROR ---");
  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  console.log("-> fetchGlobal status:", (await fetchGlobal()).status);

  console.log("\n--- 5c. network throw -> expect [coingecko] ERROR ---");
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED (simulated)");
  }) as typeof fetch;
  console.log("-> fetchMarkets status:", (await fetchMarkets()).status);

  globalThis.fetch = realFetch;

  console.log("\n=== 6. CLEANUP — deleting test rows ===");
  const del = await prisma.cryptoAlert.deleteMany({ where: { asset_id: TEST_ID } });
  console.log("-> deleted:", del.count);

  await prisma.$disconnect();
  console.log("\nDONE.");
}

main().catch(async (err) => {
  console.error("TEST HARNESS FAILED:", err);
  await prisma.$disconnect();
  process.exit(1);
});
