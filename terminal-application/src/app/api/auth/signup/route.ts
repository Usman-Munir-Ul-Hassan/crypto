import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

// Server-side mirror of the register form's passkey rules —
// the form can be bypassed (DevTools/curl), this cannot.
const passkeyStrong = (p: string) =>
  p.length >= 8 &&
  /[A-Z]/.test(p) &&
  /[a-z]/.test(p) &&
  /[0-9]/.test(p) &&
  /[^A-Za-z0-9]/.test(p);

const emailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !emailValid(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!password || !passkeyStrong(password)) {
    return NextResponse.json(
      { error: "Weak passkey — must satisfy all requirements" },
      { status: 400 }
    );
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      // Google-only account: password-setting must happen behind an
      // authenticated account-settings flow, never via this public form.
      if (existing.google_id && !existing.password_hash) {
        return NextResponse.json(
          {
            error:
              "This email is linked to a Google account. Sign in with Google.",
          },
          { status: 400 }
        );
      }
      // Already has a password -> genuine duplicate registration.
      return NextResponse.json(
        { error: "Account already exists, please log in" },
        { status: 400 }
      );
    }

    // Brand-new manual user (google_id stays null until they link it).
    const password_hash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { email, password_hash } });
    return NextResponse.json({ message: "Account created" }, { status: 201 });
  } catch (err) {
    // Race condition: two signups with the same email at once — the DB's
    // unique constraint is the final safeguard; route into the normal
    // "already exists" flow instead of a raw 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Account already exists, please log in" },
        { status: 400 }
      );
    }
    console.error("Signup failed:", err);
    return NextResponse.json({ error: "Enrollment failed" }, { status: 500 });
  }
}
