import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createLogger } from "@/app/lib/logger";

const log = createLogger("watchlist");

// DELETE /api/watchlist/[id] -> { success: true }
// [id] is the CoinGecko asset id (e.g. "bitcoin") — that's what the market
// table actually knows about a coin; the row's cuid never leaves the server.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // deleteMany scoped to the session user: can never touch another user's row,
  // and un-starring something that's already gone is a no-op, not a P2025 crash.
  // Guarded so a DB failure logs with context and returns a clean 500 the
  // client's optimistic rollback can react to.
  try {
    await prisma.watchlist.deleteMany({
      where: { user_id: session.user.id, asset_id: params.id },
    });
  } catch (err) {
    log.error("watchlist remove failed", {
      userId: session.user.id,
      assetId: params.id,
      error: err,
    });
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
