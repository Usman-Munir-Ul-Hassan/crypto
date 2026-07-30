// Structured logger (section 19.2). Dependency-free — a thin wrapper over console
// that stamps every line with an ISO 8601 timestamp, a level, the component that
// emitted it, and structured context. This makes logs greppable and parseable
// instead of ad-hoc `console.log` strings.
//
//   dev  → human-readable, matching the spec's example:
//     [2026-01-26T14:32:11.523Z] [ERROR] [detector] alert creation failed | assetId: bitcoin | price: 45231
//   prod → one JSON object per line (NODE_ENV=production), for log aggregators.
//
// Every line ALSO lands in a daily log file (logs/app-YYYY-MM-DD.log) so fetch
// history / per-asset price moves survive a terminal scrollback or a restart.
// The logger only runs on the server (client files import coingecko types only),
// so node:fs is safe here.
//
// If we outgrow this, swap the body of emit() for Pino/Winston — the call sites
// (log.info / log.warn / log.error / log.fatal) don't change.

import fs from "node:fs";
import path from "node:path";

type Level = "INFO" | "WARN" | "ERROR" | "FATAL";
type Context = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";

// Daily file under <project>/logs — one file per day keeps them greppable and
// small instead of one endless append-only blob.
const LOG_DIR = path.join(process.cwd(), "logs");

function writeToFile(line: string): void {
  // Belt-and-suspenders: never let a full disk / locked file / weird runtime
  // kill the request that was just trying to log something. The console copy
  // already went out above.
  try {
    if (typeof window !== "undefined") return; // server-only sink
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(file, line + "\n");
  } catch {
    // swallow — logging must never crash the app
  }
}

// Errors don't serialize usefully (JSON.stringify(err) === "{}"), so pull the
// message out. Everything else is left as-is so numbers stay numbers in JSON.
function normalize(context?: Context): Context | undefined {
  if (!context) return undefined;
  const out: Context = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = v instanceof Error ? v.message : v;
  }
  return out;
}

function renderValue(v: unknown): string {
  if (v instanceof Error) return v.message;
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function renderContext(context?: Context): string {
  if (!context) return "";
  const parts = Object.entries(context).map(([k, v]) => `${k}: ${renderValue(v)}`);
  return parts.length ? ` | ${parts.join(" | ")}` : "";
}

function emit(level: Level, component: string, message: string, context?: Context): void {
  const timestamp = new Date().toISOString();

  const line = isProd
    ? JSON.stringify({ timestamp, level, component, message, ...normalize(context) })
    : `[${timestamp}] [${level}] [${component}] ${message}${renderContext(context)}`;

  // Route to the matching console method so severity filters / dev tools work.
  if (level === "ERROR" || level === "FATAL") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);

  // Same line into today's log file — the on-disk audit trail.
  writeToFile(line);
}

// A logger bound to one component id. Usage:
//   const log = createLogger("detector");
//   log.error("alert creation failed", { assetId, price, error });
export function createLogger(component: string) {
  return {
    info: (message: string, context?: Context) => emit("INFO", component, message, context),
    warn: (message: string, context?: Context) => emit("WARN", component, message, context),
    error: (message: string, context?: Context) => emit("ERROR", component, message, context),
    fatal: (message: string, context?: Context) => emit("FATAL", component, message, context),
  };
}
