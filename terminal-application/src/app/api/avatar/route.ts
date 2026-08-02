import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import fs from "fs/promises";
import path from "path";

// POST /api/avatar  { image: dataUrl } -> { success: true, avatarUrl: string }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let image: string;
  try {
    ({ image } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Extract the base64 part and the extension
  const match = image.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) {
    return NextResponse.json(
      { error: "Image must be a png/jpeg/webp data-URL" },
      { status: 400 }
    );
  }

  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const base64Data = match[2];
  
  // Convert base64 to binary buffer
  const buffer = Buffer.from(base64Data, "base64");
  
  // Ensure the public/avatars directory exists
  const avatarsDir = path.join(process.cwd(), "public", "avatars");
  await fs.mkdir(avatarsDir, { recursive: true });
  
  // Save the file as the user's ID to keep it short and clean
  const fileName = `${session.user.id}.${extension}`;
  const filePath = path.join(avatarsDir, fileName);
  await fs.writeFile(filePath, buffer);
  
  // Create a short URL for the database, adding a timestamp to bypass browser cache
  const avatarUrl = `/avatars/${fileName}?t=${Date.now()}`;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatar: avatarUrl },
  });

  return NextResponse.json({ success: true, avatarUrl });
}

// DELETE /api/avatar -> { success: true }  (back to the initials fallback)
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatar: null },
  });

  return NextResponse.json({ success: true });
}
