// Next.js runs register() ONCE when the server process boots. This is where we
// light Lane 1's poller so it starts polling the moment the app comes up — no
// user request needed to kick it off.
//
// The NEXT_RUNTIME guard matters: this hook also fires in the Edge runtime,
// which has no setInterval/Prisma. We only start the poller in the Node.js
// runtime (our single persistent process).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("@/app/lib/poller");
    startPoller();
    // Keeps the disposable-email blocklist current (boot + daily) so new
    // burner domains are blocked without any manual maintenance.
    const { startDisposableRefresh } = await import("@/app/lib/email-guard");
    startDisposableRefresh();
  }
}
