// Market Explorer — SERVER half of the browse page (Lane 2). Runs fetchMarkets()
// ONCE on the server for a fast first paint, then hands the data to the client
// table. On-demand only — no polling (the 30s loop belongs to Lane 1's poller).
// Same first-paint rule for the stars: read this user's watchlist straight
// from Postgres here (a function call away — same process), so already-starred
// coins render filled immediately instead of after a client-side GET.

import { getServerSession } from "next-auth";
import MarketTable from "./MarketTable";
import { fetchMarkets } from "@/app/lib/coingecko";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

// DB read isolated + guarded: the database is remote, so an offline user makes
// this throw. Degrade to no stars (the coin table still renders and the app-wide
// offline banner explains why) instead of crashing the render.
async function getStarredIds(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.watchlist.findMany({
      where: { user_id: userId },
      select: { asset_id: true },
    });
    return rows.map((r) => r.asset_id);
  } catch {
    return [];
  }
}

export default async function MarketPage() {
  // Coins and session don't depend on each other — fetch both at once.
  const [{ coins, status }, session] = await Promise.all([
    fetchMarkets(),
    getServerSession(authOptions),
  ]);

  // /market is public: no session -> empty stars (clicking one sends to login).
  const starred = session?.user?.id ? await getStarredIds(session.user.id) : [];

  return <MarketTable coins={coins} status={status} initialStarred={starred} />;
}
