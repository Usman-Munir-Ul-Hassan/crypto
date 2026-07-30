// Agent Profile (Lane-agnostic account page). SERVER Component: reads the
// session, looks up the real User row, and renders identity from actual data —
// email, auth method (Google vs password), join date, tracked-asset count and
// onboarding status. No fabricated fields. Tactical Terminal spec, token classes only.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { operatorName, operatorInitials } from "@/app/lib/user-display";
import LogoutButton from "@/app/components/LogoutButton";
import { Icon, type IconName } from "@/app/components/icons";
import OfflineNotice from "@/app/components/OfflineNotice";

// Isolated so we can borrow its return type below without re-typing the select.
function getProfileUser(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      created_at: true,
      google_id: true,
      password_hash: true,
      tutorial_completed: true,
      _count: { select: { watchlists: true } },
    },
  });
}

function Row({
  icon,
  label,
  value,
  accent,
  normalCase,
}: {
  icon: IconName;
  label: string;
  value: string;
  accent?: boolean;
  normalCase?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-muted">
        <Icon name={icon} size={13} className="shrink-0" />
        {label}
      </span>
      <span
        className={`truncate font-bold ${normalCase ? "normal-case" : ""} ${
          accent ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Badge({ ok, okText, offText }: { ok: boolean; okText: string; offText: string }) {
  return (
    <span
      className={`rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] ${
        ok ? "border-primary/40 bg-primary/10 text-primary" : "border-line text-muted"
      }`}
    >
      {ok ? okText : offText}
    </span>
  );
}

function StatTile({
  icon,
  label,
  value,
  ok,
}: {
  icon: IconName;
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 transition hover:border-primary/30">
      <div className="flex items-center gap-2 text-muted">
        <Icon name={icon} size={14} className="shrink-0" />
        <span className="font-mono text-[9px] uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p
        className={`mt-2 font-display text-xl font-black ${
          ok ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  // The DB is remote: an offline user makes this throw. A thrown error is NOT
  // "not logged in", so we must not redirect to /login — show the offline
  // fallback (with a retry) instead. `undefined` = query failed.
  let user: Awaited<ReturnType<typeof getProfileUser>> | undefined;
  try {
    user = await getProfileUser(session.user.email);
  } catch {
    user = undefined;
  }
  if (user === undefined) return <OfflineNotice retryHref="/profile" />;
  if (!user) redirect("/login");

  const name = operatorName({ name: session.user.name, email: user.email });
  const initials = operatorInitials(name);
  const isGoogle = Boolean(user.google_id);
  const hasPassword = Boolean(user.password_hash);
  const tracked = user._count.watchlists;
  const clearanceGranted =
    user.created_at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const nodeId = `${user.id.slice(0, 12)}…`;

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      {/* Hero banner — avatar overlaps a token-tinted gradient strip */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="relative h-28 bg-gradient-to-r from-primary/20 via-primary/5 to-transparent">
          <span className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Operational
          </span>
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className="-mt-10 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-2 border-background bg-primary/15 font-display text-2xl font-black text-primary ring-1 ring-primary/30">
              {initials}
            </span>
            <div className="min-w-0 pb-1">
              <h1 className="truncate font-display text-2xl font-black italic uppercase tracking-wide sm:text-3xl">
                {name}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.3em] text-muted">
                <Icon name={isGoogle ? "shield" : "user"} size={11} />
                {isGoogle ? "OAuth Operative" : "Standard Operative"}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-52 sm:pb-1">
            <LogoutButton variant="full" />
          </div>
        </div>
      </section>

      {/* Quick-glance stat tiles */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile icon="target" label="Tracked Assets" value={String(tracked)} ok={tracked > 0} />
        <StatTile
          icon="check"
          label="Onboarding"
          value={user.tutorial_completed ? "Complete" : "Pending"}
          ok={user.tutorial_completed}
        />
        <StatTile
          icon="key"
          label="Access Method"
          value={isGoogle ? "Google" : "Password"}
          ok={isGoogle}
        />
      </div>

      {/* Detail cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
            <Icon name="user" size={13} />
            Operative Intel
          </h2>
          <div className="mt-5 flex flex-col gap-3 font-mono text-[10px] uppercase tracking-[0.2em]">
            <Row icon="user" label="Callsign" value={name} />
            <Row icon="mail" label="Comms Channel" value={user.email} normalCase />
            <Row icon="target" label="Tracked Assets" value={String(tracked)} accent />
            <Row icon="hash" label="Node ID" value={nodeId} normalCase />
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
            <Icon name="shield" size={13} />
            Security Link
          </h2>
          <div className="mt-5 flex flex-col gap-3 font-mono text-[10px] uppercase tracking-[0.2em]">
            <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
              <span className="flex items-center gap-2 text-muted">
                <Icon name="key" size={13} className="shrink-0" />
                Access Method
              </span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-foreground">
                  {isGoogle ? "Google OAuth" : "Password"}
                </span>
                <Badge ok={isGoogle} okText="Verified" offText="Local" />
              </span>
            </div>
            <Row icon="shield" label="Password Set" value={hasPassword ? "Yes" : "No"} />
            <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
              <span className="flex items-center gap-2 text-muted">
                <Icon name="check" size={13} className="shrink-0" />
                Onboarding
              </span>
              <Badge ok={user.tutorial_completed} okText="Complete" offText="Pending" />
            </div>
            <Row icon="clock" label="Clearance Granted" value={clearanceGranted} normalCase />
          </div>
        </section>
      </div>
    </main>
  );
}
