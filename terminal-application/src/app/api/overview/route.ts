import { NextResponse } from "next/server";
import { fetchMarkets, fetchGlobal } from "@/app/lib/coingecko";

// GET /api/overview -> { global, coins, status }
// The dashboard's live market feed. Bundles two public CoinGecko reads into one
// call so the client polls a single endpoint every 15s:
//   • global — total market cap / 24h volume / 24h change (Market Overview panel)
//   • coins  — top coins by market cap, sliced to the 2 price cards
// Public (no auth): whole-market data, not user-specific. The dashboard PAGE is
// still auth-guarded by middleware; this endpoint just feeds it.

export const dynamic = "force-dynamic"; // never cache — each poll wants a fresh quote

export async function GET() {
  // Both feeds come from the ONE shared Lane 2 snapshot (single 30s clock),
  // so these two awaits cost at most one combined upstream refresh.
  const [markets, globalRes] = await Promise.all([fetchMarkets(), fetchGlobal()]);

  // One honest status for the client: ok only if BOTH succeeded, else surface
  // whichever failed (markets first) so the UI can show the right message.
  const status =
    markets.status === "ok" && globalRes.status === "ok"
      ? "ok"
      : markets.status !== "ok"
      ? markets.status
      : globalRes.status;

  return NextResponse.json({
    global: globalRes.global,
    coins: markets.coins.slice(0, 2), // top 2 -> the two price cards
    status,
  });
}
