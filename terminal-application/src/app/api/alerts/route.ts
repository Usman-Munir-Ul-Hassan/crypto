import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createLogger } from "@/app/lib/logger";

const log = createLogger("alerts-api");

// GET /api/alerts -> { alerts: AlertRow[] }
// The alerts page's poll target. The detector writes CryptoAlert rows globally
// (one per crashing asset), but an operator only cares about the coins THEY watch
// — so we scope the feed to this user's watchlist asset_ids, newest first.
//
// Self-guarded (401 JSON) rather than a middleware redirect: this is called by
// fetch(), which should get data or a clean error, never an HTML login page.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // WHICH coins this operator watches -> only surface alerts for those.
  // Guarded: a DB hiccup logs with context and returns a clean 500 the client's
  // poll loop can shrug off (section 19.1 — log and degrade, never crash).
  try {
    const watched = await prisma.watchlist.findMany({
      where: { user_id: session.user.id },
      select: { asset_id: true },
    });
    const ids = watched.map((w) => w.asset_id);
    if (ids.length === 0) return NextResponse.json({ alerts: [] });

    const rows = await prisma.cryptoAlert.findMany({
      where: { asset_id: { in: ids } },
      orderBy: { detected_at: "desc" },
      take: 50, // most recent 50 — enough for the feed, bounded query cost
    });

    return NextResponse.json({
      alerts: rows.map((r) => ({
        id: r.id,
        asset_id: r.asset_id,
        asset_name: r.asset_name,
        price_at_drop: r.price_at_drop,
        drop_percentage: r.drop_percentage,
        detected_at: r.detected_at.toISOString(),
      })),
    });
  } catch (err) {
    log.error("alert feed query failed", { userId: session.user.id, error: err });
    return NextResponse.json({ error: "Failed to load alerts" }, { status: 500 });
  }
}

// DELETE /api/alerts -> { cleared: number }
// Powers the alerts page "Clear" button. Removes the CryptoAlert rows for the
// coins THIS operator watches — the same scope the GET feed surfaces — so the
// user wipes exactly what they can see. Same 401-JSON + try/catch contract as GET.
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const watched = await prisma.watchlist.findMany({
      where: { user_id: session.user.id },
      select: { asset_id: true },
    });
    const ids = watched.map((w) => w.asset_id);
    if (ids.length === 0) return NextResponse.json({ cleared: 0 });

    const { count } = await prisma.cryptoAlert.deleteMany({
      where: { asset_id: { in: ids } },
    });
    log.info("alerts cleared", { userId: session.user.id, cleared: count });
    return NextResponse.json({ cleared: count });
  } catch (err) {
    log.error("alert clear failed", { userId: session.user.id, error: err });
    return NextResponse.json({ error: "Failed to clear alerts" }, { status: 500 });
  }
}
