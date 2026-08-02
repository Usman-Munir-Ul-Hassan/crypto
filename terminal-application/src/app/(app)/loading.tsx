// Shared navigation skeleton for the whole (app) route group. Next.js shows
// this INSTANTLY the moment you click a sidebar link, because it lives inside
// (app)/layout.tsx — so the sidebar stays put and only this content area swaps
// to a skeleton while the Server Component finishes its awaits (session +
// remote Prisma in Seoul + CoinGecko). Without it the browser froze on the OLD
// page until all that resolved, which is what made navigation feel slow.
// One file covers every page: dashboard, market, watchlist, alerts, profile,
// settings. Tactical Terminal spec — token classes only, animate-pulse shimmer.

function Block({ className }: { className: string }) {
  return <div className={`rounded-lg bg-surface ${className}`} />;
}

export default function AppLoading() {
  return (
    <div className="flex-1 animate-pulse p-4 sm:p-6 lg:p-8" aria-busy="true">
      {/* Page-title row — icon tile + two text bars */}
      <div className="flex items-center gap-4">
        <Block className="h-11 w-11 shrink-0" />
        <div className="flex-1 space-y-2">
          <Block className="h-6 w-52" />
          <Block className="h-3 w-72 max-w-full" />
        </div>
      </div>

      {/* Stat / card grid — three tiles */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="h-24" />
      </div>

      {/* Content rows — list/table placeholder */}
      <div className="mt-4 space-y-3">
        <Block className="h-16" />
        <Block className="h-16" />
        <Block className="h-16" />
        <Block className="h-16" />
      </div>

      <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
        ● Establishing secure link…
      </p>
    </div>
  );
}
