// Alerts — SERVER half. Reads this operator's flash-crash history straight from
// Postgres (no HTTP hop) so the page paints instantly, then hands off to the
// client half which polls /api/alerts to keep the feed live. Scoped to the
// user's watchlist assets, newest first — same contract as /api/alerts.

import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import AlertsView, { type AlertRow } from "./AlertsView";

export const dynamic = "force-dynamic"; // always fresh — alerts are time-sensitive

// DB reads isolated + guarded: the database is remote, so an offline user makes
// these throw. Degrade to an empty feed (page still paints; the app-wide offline
// banner explains why) rather than crashing the render.
async function getInitialAlerts(userId: string): Promise<AlertRow[]> {
  try {
    const watched = await prisma.watchlist.findMany({
      where: { user_id: userId },
      select: { asset_id: true },
    });
    const ids = watched.map((w) => w.asset_id);
    if (ids.length === 0) return [];

    const rows = await prisma.cryptoAlert.findMany({
      where: { asset_id: { in: ids } },
      orderBy: { detected_at: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      asset_id: r.asset_id,
      asset_name: r.asset_name,
      price_at_drop: r.price_at_drop,
      drop_percentage: r.drop_percentage,
      detected_at: r.detected_at.toISOString(),
    }));
  } catch {
    return [];
  }
}

export default async function AlertsPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const initialAlerts = userId ? await getInitialAlerts(userId) : [];

  return <AlertsView initialAlerts={initialAlerts} />;
}
