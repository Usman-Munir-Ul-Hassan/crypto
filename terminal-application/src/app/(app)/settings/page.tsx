// System Settings. SERVER Component shell: reads the session + one DB flag
// (does this account have a password?) and hands both to the client cards.
// "Interface Adaptation" is a per-browser UI preference (localStorage);
// the passkey card talks to POST /api/password. Tactical Terminal, tokens only.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { Icon } from "@/app/components/icons";
import OfflineNotice from "@/app/components/OfflineNotice";
import InterfaceAdaptation from "./InterfaceAdaptation";
import PasswordForm from "./PasswordForm";
import AlertThresholdSlider from "./AlertThresholdSlider";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  // The DB is remote: an offline user makes this throw. A thrown error is NOT
  // "not logged in", so we must not redirect to /login — show the offline
  // fallback (with a retry) instead. `undefined` = query failed.
  let user: { password_hash: string | null } | null | undefined;
  try {
    user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { password_hash: true },
    });
  } catch {
    user = undefined;
  }
  if (user === undefined) return <OfflineNotice retryHref="/settings" />;
  if (!user) redirect("/login");

  const hasPassword = Boolean(user.password_hash);

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Icon name="settings" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-black italic tracking-wide sm:text-3xl">
            SYSTEM SETTINGS
          </h1>
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-muted">
            {"// Global protocol configurations"}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-2xl flex-col gap-4">
        <AlertThresholdSlider />
        <InterfaceAdaptation />
        <PasswordForm hasPassword={hasPassword} />
      </div>
    </main>
  );
}
