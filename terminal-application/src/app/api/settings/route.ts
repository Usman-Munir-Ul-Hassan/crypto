import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

// GET the current user's alert threshold
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    let setting = await prisma.systemSetting.findUnique({ where: { user_id: session.user.id } });
    if (!setting) {
      setting = await prisma.systemSetting.create({
        data: { user_id: session.user.id, alert_threshold: 0.5 },
      });
    }
    return NextResponse.json({ threshold: setting.alert_threshold });
  } catch (err) {
    return new NextResponse("Internal Server Error" + err, { status: 500 });
  }
}

// POST to update the current user's alert threshold
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const { threshold } = await req.json();
    if (typeof threshold !== "number" || threshold <= 0 || threshold > 10) {
      return new NextResponse("Invalid threshold", { status: 400 });
    }

    const setting = await prisma.systemSetting.upsert({
      where: { user_id: session.user.id },
      update: { alert_threshold: threshold },
      create: { user_id: session.user.id, alert_threshold: threshold },
    });

    return NextResponse.json({ threshold: setting.alert_threshold });
  } catch (err) {
    return new NextResponse("Internal Server Error" + err, { status: 500 });
  }
}
