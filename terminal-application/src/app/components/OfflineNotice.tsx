// OfflineNotice — server-safe fallback rendered when a page's required DB read
// fails. Our database is remote (Supabase), so losing internet makes Server
// Component queries throw; pages catch that and render this instead of crashing
// with an unhandled runtime error. No client JS — the ↻ link re-navigates,
// which re-runs the server render (and succeeds once the connection is back).
// Tactical Terminal spec — token classes only, no raw hex.

import Link from "next/link";

export default function OfflineNotice({
  retryHref,
  title = "Connection lost",
}: {
  retryHref: string;
  title?: string;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-danger/15 text-2xl text-danger">
        ⚠
      </span>
      <div>
        <h1 className="font-display text-2xl font-black italic tracking-wide">{title}</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
          {"// Can't reach the server — check your internet connection"}
        </p>
      </div>
      <Link
        href={retryHref}
        className="cursor-pointer rounded-md border border-primary/60 bg-primary/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/20"
      >
        ↻ Retry
      </Link>
    </main>
  );
}
