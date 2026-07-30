import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

// The authenticated account-settings flow that signup/route.ts points at:
// Google-only users SET a password here (no current password exists to check),
// password users CHANGE it (current password required, verified via bcrypt).
// Identity comes from the session cookie only — never from the request body.

// Same server-side passkey rules as signup — one contract, two doors.
const passkeyStrong = (p: string) =>
  p.length >= 8 &&
  /[A-Z]/.test(p) &&
  /[a-z]/.test(p) &&
  /[0-9]/.test(p) &&
  /[^A-Za-z0-9]/.test(p);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;
  if (!newPassword || !passkeyStrong(newPassword)) {
    return NextResponse.json(
      { error: "Weak passkey — must satisfy all requirements" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // CHANGE flow: an existing hash must be re-proven before it's replaced —
  // a stolen session alone must not be enough to take over the account.
  if (user.password_hash) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current passkey required" },
        { status: 400 }
      );
    }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current passkey incorrect" },
        { status: 400 }
      );
    }
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New passkey must differ from the current one" },
        { status: 400 }
      );
    }
  }
  // SET flow (password_hash null): the Google session IS the proof of identity.

  const password_hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password_hash },
  });

  return NextResponse.json({
    message: user.password_hash ? "Passkey updated" : "Passkey set",
  });
}
