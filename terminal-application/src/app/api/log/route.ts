import { NextResponse } from "next/server";
import { createLogger } from "@/app/lib/logger";

const log = createLogger("client");

export async function POST(req: Request) {
  try {
    const { level = "error", message, context } = await req.json();
    
    if (level === "error") {
      log.error(message, context);
    } else if (level === "warn") {
      log.warn(message, context);
    } else {
      log.info(message, context);
    }
    
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
