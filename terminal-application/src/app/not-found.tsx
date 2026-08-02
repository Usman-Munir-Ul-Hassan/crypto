// Global 404 — Next.js App Router renders this for ANY URL that matches no
// route (e.g. /dashboardss, /marketz). No wiring needed: a root not-found.tsx
// is the framework's catch-all. Styled as a "signal lost" terminal screen so a
// bad link still feels like part of the Tactical Terminal, not a browser error.
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        {/* Broken-signal badge — danger-tinted mirror of the auth shield badge */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-danger/70 bg-surface">
          <svg
            className="h-6 w-6 text-danger"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <p className="mt-6 font-display text-7xl font-black italic tracking-tight text-danger">
          404
        </p>
        <h1 className="mt-2 font-display text-2xl font-black italic uppercase tracking-tight text-foreground">
          Signal Lost
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
          Sector not found / BitBash Sentry
        </p>
        <p className="mt-4 font-mono text-sm text-muted">
          The coordinates you requested do not exist on this terminal. The link
          may be broken or the sector was decommissioned.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="cursor-pointer rounded-md border border-primary/70 bg-surface px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary shadow-glow transition-colors hover:bg-primary hover:text-black"
          >
            Return to Dashboard
          </Link>
          <Link
            href="/market"
            className="cursor-pointer rounded-md border border-line bg-surface px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted transition-colors hover:border-primary/70 hover:text-foreground"
          >
            View Market
          </Link>
        </div>
      </div>
    </main>
  );
}
