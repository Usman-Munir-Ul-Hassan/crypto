"use client";

import { signOut } from "next-auth/react";
import { Icon } from "./icons";

// Logout must be a client component: signOut() runs in the browser —
// it POSTs to /api/auth/signout (CSRF-protected), which clears the
// session cookie, then redirects wherever callbackUrl points.
// variant "icon" = compact sidebar button; "full" = the profile page's
// TERMINATE SESSION bar. Same signOut logic, two skins.
export default function LogoutButton({
  variant = "icon",
}: {
  variant?: "icon" | "full";
}) {
  const logout = () => signOut({ callbackUrl: "/login" });

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={logout}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-danger transition hover:bg-danger/20"
      >
        <Icon name="power" size={14} />
        Terminate Session
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label="Log out"
      title="Log out"
      onClick={logout}
      className="flex cursor-pointer items-center justify-center rounded-md border border-line p-1.5 text-muted transition hover:border-danger/40 hover:text-danger"
    >
      <Icon name="power" size={15} />
    </button>
  );
}
