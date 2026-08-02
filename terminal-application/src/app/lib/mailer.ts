// Alert email dispatch — Lane 1's outbound notification channel. The detector
// calls notifyWatchers() right after it CREATES an alert row; this file finds
// every user watching that asset and emails them. It never blocks or crashes
// the detection cycle: no SMTP config -> log once and skip, a failed send ->
// log and carry on (same graceful-degradation contract as the logger/detector).
//
// Transport: plain SMTP via nodemailer, driven entirely by .env:
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM
// (Gmail works with an App Password; any SMTP provider slots in unchanged.)
//
// Spam control is inherited for free: recordAlert only calls us when a NEW
// alert row is created, and the 60s per-asset per-direction cooldown already
// gates that — so a user gets at most one email per asset per direction per
// cooldown window.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { prisma } from "./prisma";
import { createLogger } from "./logger";

const log = createLogger("mailer");

// Pinned to globalThis like the cache/poller/detector state — one transporter
// (with its connection pool) per process, surviving dev HMR.
const g = globalThis as unknown as {
  __mailTransporter?: Transporter | null;
};

// Lazily build the transporter on first send. Returns null (and remembers it)
// when SMTP env vars are missing — email is an OPTIONAL feature, never a crash.
function getTransporter(): Transporter | null {
  if (g.__mailTransporter !== undefined) return g.__mailTransporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    log.warn("SMTP not configured — alert emails disabled", {
      hint: "set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM in .env",
    });
    g.__mailTransporter = null;
    return null;
  }

  const port = Number(SMTP_PORT ?? 587);
  g.__mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  log.info("SMTP transporter ready", { host: SMTP_HOST, port });
  return g.__mailTransporter;
}

export type AlertEmailPayload = {
  assetId: string;
  assetName: string;
  direction: "crash" | "surge";
  price: number;
  baseline: number;
  movePct: number; // signed, e.g. -2.31 or +3.05
};

// Dark, inline-styled HTML (email clients ignore external CSS) that mirrors the
// Tactical Terminal look: mono type, green for surge, red for crash.
function renderHtml(p: AlertEmailPayload): string {
  const isCrash = p.direction === "crash";
  const accent = isCrash ? "#ff4545" : "#2bff45";
  const label = isCrash ? "PRICE DROP" : "PRICE SURGE";
  const signed = `${p.movePct >= 0 ? "+" : ""}${p.movePct.toFixed(2)}%`;
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 8 });

  return `
  <div style="background:#0a0a0a;padding:32px 16px;font-family:'JetBrains Mono',Consolas,monospace;">
    <div style="max-width:520px;margin:0 auto;background:#161616;border:1px solid #262626;border-radius:8px;overflow:hidden;">
      <div style="padding:20px 24px;border-bottom:1px solid #262626;">
        <span style="color:${accent};font-size:11px;letter-spacing:4px;">&#9650; BITBASH SENTRY</span>
      </div>
      <div style="padding:24px;">
        <p style="margin:0;color:${accent};font-size:22px;font-weight:bold;letter-spacing:2px;">${label}</p>
        <p style="margin:8px 0 20px;color:#f5f5f5;font-size:16px;">${p.assetName} moved <b style="color:${accent};">${signed}</b> since the last check.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr>
            <td style="padding:8px 0;color:#8a8a8a;">CURRENT PRICE</td>
            <td style="padding:8px 0;color:#f5f5f5;text-align:right;">${fmt(p.price)}</td>
          </tr>
          <tr style="border-top:1px solid #262626;">
            <td style="padding:8px 0;color:#8a8a8a;">PREVIOUS BASELINE</td>
            <td style="padding:8px 0;color:#f5f5f5;text-align:right;">${fmt(p.baseline)}</td>
          </tr>
          <tr style="border-top:1px solid #262626;">
            <td style="padding:8px 0;color:#8a8a8a;">MOVE</td>
            <td style="padding:8px 0;color:${accent};text-align:right;font-weight:bold;">${signed}</td>
          </tr>
        </table>
        <a href="${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/alerts"
           style="display:inline-block;margin-top:24px;padding:10px 20px;border:1px solid ${accent};border-radius:6px;color:${accent};text-decoration:none;font-size:11px;letter-spacing:2px;">
          OPEN ALERTS TERMINAL
        </a>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #262626;color:#8a8a8a;font-size:10px;letter-spacing:1px;">
        You receive this because ${p.assetName} is on your watchlist.
      </div>
    </div>
  </div>`;
}

// Email every user who has this asset starred. Fire-and-forget from the
// detector's point of view — all failures are logged, none are thrown.
export async function notifyWatchers(payload: AlertEmailPayload): Promise<void> {
  try {
    const transporter = getTransporter();
    if (!transporter) return; // SMTP not configured — feature is off

    // Recipients = watchers of this asset (watchlist is the subscription).
    const watchers = await prisma.watchlist.findMany({
      where: { asset_id: payload.assetId },
      select: { user: { select: { email: true } } },
    });
    const recipients = Array.from(new Set(watchers.map((w) => w.user.email)));
    if (recipients.length === 0) return;

    const signed = `${payload.movePct >= 0 ? "+" : ""}${payload.movePct.toFixed(2)}%`;
    const subject =
      payload.direction === "crash"
        ? `🔻 Price drop: ${payload.assetName} ${signed}`
        : `🔺 Price surge: ${payload.assetName} ${signed}`;
    const html = renderHtml(payload);
    const from = process.env.EMAIL_FROM ?? process.env.SMTP_USER!;

    // One mail per user (no shared To/CC — recipients never see each other).
    // allSettled so one bad mailbox can't sink the rest of the batch.
    const results = await Promise.allSettled(
      recipients.map((to) => transporter.sendMail({ from, to, subject, html }))
    );
    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - sent;
    log.info("alert emails dispatched", {
      asset: payload.assetName,
      direction: payload.direction,
      sent,
      failed,
    });
    results.forEach((r, i) => {
      if (r.status === "rejected")
        log.error("alert email failed", { to: recipients[i], error: r.reason });
    });
  } catch (err) {
    // DB lookup or transport blew up — log it, never break the detection cycle.
    log.error("alert email dispatch failed", { asset: payload.assetName, error: err });
  }
}
