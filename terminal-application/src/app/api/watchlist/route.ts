import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { fetchWatchlistPrices } from "@/app/lib/coingecko";
import { seedBaseline } from "@/app/lib/detector";
import { createLogger } from "@/app/lib/logger";

const log = createLogger("watchlist");

// Watchlist — Lane 2's ONLY write path. A star click on /market lands here and
// persists to Postgres. Nothing else happens on purpose: Lane 1's poller
// re-reads this table on its own 30s tick, so the two lanes stay decoupled.
//
// Middleware already gates these routes, but we ALSO guard here so a raw API
// call gets a 401 JSON (not a 307 redirect to an HTML login page) — and
// getServerSession tells us WHOSE watchlist to touch.

// GET /api/watchlist -> [{ id, name, added_at }]  (id = CoinGecko asset id)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.watchlist.findMany({
    where: { user_id: session.user.id },
    orderBy: { added_at: "desc" },
  });

  return NextResponse.json(
    rows.map((r) => ({ id: r.asset_id, name: r.asset_name, added_at: r.added_at }))
  );
}

// POST /api/watchlist  body { asset_id, name } -> { success: true }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Malformed JSON body -> clean 400, not a 500 stack trace.
  let body: { asset_id?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const asset_id = typeof body.asset_id === "string" ? body.asset_id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!asset_id || !name) {
    return NextResponse.json(
      { error: "asset_id and name are required" },
      { status: 400 }
    );
  }

  // Upsert on the (user_id, asset_id) unique pair -> starring twice (double
  // click, retry after a timeout) is a harmless no-op, never a P2002 crash.
  await prisma.watchlist.upsert({
    where: { user_id_asset_id: { user_id: session.user.id, asset_id } },
    update: {},
    create: { user_id: session.user.id, asset_id, asset_name: name },
  });

  // Point zero: snapshot this coin's price NOW so the detector can compare on the
  // VERY NEXT poll, instead of burning a full 30s cycle just to establish a
  // baseline. One-off CoinGecko call, best-effort — if it fails, the poller seeds
  // the baseline on its next tick as before, so the star still succeeds.
  try {
    const [coin] = await fetchWatchlistPrices([asset_id]);
    if (coin) seedBaseline(asset_id, coin.price);
  } catch (err) {
    log.error("baseline seed failed", { assetId: asset_id, error: err });
  }

  return NextResponse.json({ success: true });
}
