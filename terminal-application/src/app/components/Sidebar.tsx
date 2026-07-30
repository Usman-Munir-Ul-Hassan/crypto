"use client";

// Shared app sidebar — the single source of nav chrome for every in-app page.
// Active item is derived from the URL (usePathname), so no page needs to pass
// an `active` flag. Keeps the OperatorGuide spotlight IDs alive (nav-alerts,
// profile-menu). Token classes only — no raw hex.

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import LogoutButton from "./LogoutButton";
import { operatorName, operatorInitials } from "@/app/lib/user-display";
import { Icon, type IconName } from "./icons";

// href "#" == route not built yet (won't 404, never highlights).
const NAV_ITEMS: { label: string; href: string; icon: IconName; id?: string }[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Watchlist", href: "/watchlist", icon: "watchlist" },
  { label: "Alerts", href: "/alerts", icon: "alerts", id: "nav-alerts" },
  { label: "Market Data", href: "/market", icon: "market" },
  { label: "Profile", href: "/profile", icon: "profile" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  // Live session -> real operator identity instead of hardcoded placeholders.
  const { data: session } = useSession();
  const name = operatorName(session?.user);
  const email = session?.user?.email ?? "—";
  const initials = operatorInitials(name);

  return (
    <aside className="flex w-full flex-col border-b border-line lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-3 border-b border-line p-4 lg:p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-black">
          <Icon name="shield" size={18} />
        </span>
        <div>
          <p className="font-display text-sm font-bold tracking-widest">BITBASH</p>
          <p className="font-mono text-[8px] uppercase tracking-[0.4em] text-muted">Sentry V4</p>
        </div>
      </div>

      <nav className="flex flex-row gap-1 overflow-x-auto p-3 font-mono text-[11px] uppercase tracking-[0.2em] lg:flex-col lg:overflow-x-visible">
        {NAV_ITEMS.map((item) => {
          const active = item.href !== "#" && pathname === item.href;
          return (
            <a
              key={item.label}
              id={item.id}
              href={item.href}
              className={
                active
                  ? "flex items-center gap-2.5 whitespace-nowrap rounded-md border border-primary/40 bg-primary/10 px-3.5 py-2.5 text-primary shadow-glow"
                  : "flex items-center gap-2.5 whitespace-nowrap rounded-md border border-transparent px-3.5 py-2.5 text-muted transition hover:bg-surface hover:text-foreground"
              }
            >
              <Icon name={item.icon} size={15} className="shrink-0" />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div id="profile-menu" className="border-t border-line p-4 lg:mt-auto">
        <div className="flex items-center gap-3 rounded-lg bg-surface p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[10px] font-bold uppercase tracking-widest">{name}</p>
            <p className="truncate font-mono text-[9px] text-muted">{email}</p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
