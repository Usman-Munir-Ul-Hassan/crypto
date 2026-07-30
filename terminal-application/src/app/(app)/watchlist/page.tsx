// Watchlist — SERVER half of Lane 1's live view. Runs on the server during
// render and does two reads that are just function/DB calls (no HTTP hop):
//   1. this user's watchlist rows from Postgres (WHICH coins to show)
//   2. the RAM cache the poller fills (their latest PRICES)
// It merges them so the page paints real cards instantly, then hands off to the
// client half which polls /api/prices every 5s to keep them live.

import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getCache } from "@/app/lib/cache";
import type { Coin } from "@/app/lib/coingecko";
import WatchlistView from "./WatchlistView";

export const dynamic = "force-dynamic"; // always render fresh — never a stale cache

// DB read isolated + guarded: our database is remote, so an offline user makes
// this throw. Degrade to an empty list (the page still paints, and the app-wide
// offline banner explains why) instead of crashing the whole render.
async function getWatchlistRows(userId: string) {
  try {
    return await prisma.watchlist.findMany({
      where: { user_id: userId },
      orderBy: { added_at: "desc" },
      select: { asset_id: true, asset_name: true },
    });
  } catch {
    return [];
  }
}

export default async function WatchlistPage() {
  const session = await getServerSession(authOptions);
  // Guarded by middleware too, but be defensive: no session -> nothing to show.
  const userId = session?.user?.id;

  const rows = userId ? await getWatchlistRows(userId) : [];

  // Index the poller's snapshot by id so we can enrich each watchlist row.
  const priceById = new Map(getCache().data.map((c) => [c.id, c]));

  // Build one card per watchlisted coin. If the poller has already fetched it,
  // use the live data; otherwise seed a placeholder (name from DB, price 0) that
  // the 5s client poll will fill within the next 30s tick.
  const initialCoins: Coin[] = rows.map((r) => {
    const live = priceById.get(r.asset_id);
    return (
      live ?? {
        rank: 0,
        id: r.asset_id,
        name: r.asset_name,
        symbol: "",
        image: "",
        price: 0,
        change: 0,
        marketCap: 0,
      }
    );
  });

  return <WatchlistView initialCoins={initialCoins} />;
}
