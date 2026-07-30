import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

// Auth-required, but guarded HERE (not in middleware): an API call should get
// a 401 JSON, not a 307 redirect to an HTML login page. getServerSession also
// tells us WHO is asking, so we read/write that specific user's row.

// GET /api/tutorial -> { completed: boolean }  (has this account finished the tour?)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { tutorial_completed: true },
  });

  return NextResponse.json({ completed: user?.tutorial_completed ?? false });
}

// POST /api/tutorial -> { success: true }  (mark the tour done for this account)
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { tutorial_completed: true },
  });

  return NextResponse.json({ success: true });
}
