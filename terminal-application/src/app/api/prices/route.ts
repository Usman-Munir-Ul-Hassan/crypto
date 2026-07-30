import { NextResponse } from "next/server";
import { getCache } from "@/app/lib/cache";

// GET /api/prices -> { data: Coin[], alerts: string[], surges: string[], updatedAt: number }
// The browser's 5s poll target. It does NOT call CoinGecko — it just hands back
// whatever the 15s poller last wrote to the RAM cache, so it's near-instant and
// costs zero external API calls no matter how many clients are polling. alerts is
// the detector's active-crash set (red), surges the active +2% spike set (green pulse).
//
// Public (no auth): prices aren't user-specific. The /watchlist page decides
// which of these coins to actually show, based on that user's watchlist rows.

// Never let Next.js cache this response — the whole point is fresh cache reads.
export const dynamic = "force-dynamic";

export function GET() {
  const { data, alerts, surges, updatedAt } = getCache();
  return NextResponse.json({ data, alerts, surges, updatedAt });
}
