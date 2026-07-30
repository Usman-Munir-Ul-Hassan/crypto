// Shared shell for all in-app pages. The "(app)" folder is a route GROUP —
// parentheses mean it groups routes under this layout WITHOUT adding a URL
// segment, so /dashboard and /market keep their paths. Public pages (home,
// login, register) live outside this group and never get the sidebar.

import Sidebar from "@/app/components/Sidebar";
import UiDensity from "@/app/components/UiDensity";
import ToastProvider from "@/app/components/Toaster";
import ConnectionStatus from "@/app/components/ConnectionStatus";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
        {/* Re-applies the saved Interface Adaptation choice on every app page. */}
        <UiDensity />
        {/* App-wide offline / reconnected banner. */}
        <ConnectionStatus />
        <Sidebar />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </ToastProvider>
  );
}
