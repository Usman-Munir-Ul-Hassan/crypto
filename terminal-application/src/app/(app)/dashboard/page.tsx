import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { fetchMarkets, fetchGlobal } from "@/app/lib/coingecko";
import OperatorGuide from "@/app/components/OperatorGuide";
import DashboardLive from "./DashboardLive";
import type { AlertRow } from "../alerts/AlertsView";

// DB reads isolated + guarded: the database is remote, so an offline operator
// makes these throw. Degrade to an empty alert feed (the page still paints and
// the app-wide offline banner explains why) instead of crashing the render.
async function getInitialAlerts(userId: string): Promise<AlertRow[]> {
  try {
    const watched = await prisma.watchlist.findMany({
      where: { user_id: userId },
      select: { asset_id: true },
    });
    const ids = watched.map((w) => w.asset_id);
    if (ids.length === 0) return [];

    const rows = await prisma.cryptoAlert.findMany({
      where: { asset_id: { in: ids } },
      orderBy: { detected_at: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      asset_id: r.asset_id,
      asset_name: r.asset_name,
      price_at_drop: r.price_at_drop,
      drop_percentage: r.drop_percentage,
      detected_at: r.detected_at.toISOString(),
    }));
  } catch {
    return [];
  }
}

// Dashboard — SERVER shell. Fetches the first snapshot (market totals + top coins
// + this operator's alerts) so Row 1 paints instantly, then hands it to the
// client <DashboardLive> which keeps it live. Row 2 and its panels are decorative
// (no honest live source) and stay static on purpose.
// Spotlight tour anchors: market-search (here) + dashboard-stats / watchlist-button
// (inside DashboardLive) + nav-alerts / profile-menu (sidebar).

export const dynamic = "force-dynamic"; // live data + session — never statically cache

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  // Market data (public) in parallel — top 2 coins feed the price cards.
  const [markets, globalRes] = await Promise.all([fetchMarkets(), fetchGlobal()]);

  // This operator's recent crash alerts — same scope as GET /api/alerts, so the
  // System Alerts panel is correct on first paint before polling kicks in.
  const initialAlerts: AlertRow[] = session?.user?.id
    ? await getInitialAlerts(session.user.id)
    : [];

  return (
    <>
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:gap-6 sm:px-8">
        <input
          id="market-search"
          type="search"
          placeholder="⌕  SEARCH ASSETS, PROTOCOLS OR TX IDS..."
          className="w-full min-w-0 max-w-md flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 font-mono text-[10px] tracking-[0.15em] text-foreground placeholder:text-muted focus:border-primary/40 focus:outline-none"
        />
        <div className="ml-auto hidden shrink-0 text-right sm:block">
          <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-muted">
            Network Status
          </p>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary">
            ● Mainnet Operational
          </p>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        {/* Page header */}
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-lg text-primary">
            ▚
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-black italic tracking-wide sm:text-3xl">
              TERMINAL ONE
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-muted">
              {"// Real-time intelligence aggregate V4.2.0"}
            </p>
          </div>
        </div>

        {/* Row 1 + Row 2 — LIVE: market overview, price cards, alerts, and the
            derived market-trend panels all live inside DashboardLive now. */}
        <DashboardLive
          initialGlobal={globalRes.global}
          initialCoins={markets.coins.slice(0, 2)}
          initialAlerts={initialAlerts}
          initialStatus={markets.status}
        />
      </main>

      {/* Spotlight onboarding — self-activates for first-time operators */}
      <OperatorGuide />
    </>
  );
}
