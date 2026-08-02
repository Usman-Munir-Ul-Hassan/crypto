import { NextResponse } from "next/server";
import { fetchMarkets } from "@/app/lib/coingecko";

// GET /api/markets -> { coins: Coin[], status: FetchStatus, stale?: boolean }
// The market table's 10s refresh target. Same fetch the server render uses on
// load — this just lets the client re-pull it without a full page navigation.
// `stale` is true when CoinGecko was unreachable and we served the last good
// snapshot, so the client can warn the user prices are delayed.
// Public (no auth): the market index isn't user-specific.

export const dynamic = "force-dynamic";

export async function GET() {
  console.time('DB Query');
  const data = await fetchMarkets();

  const { coins, status, stale } = data;
  console.timeEnd('DB Query');
  return NextResponse.json({ coins, status, stale: stale ?? false });

}
