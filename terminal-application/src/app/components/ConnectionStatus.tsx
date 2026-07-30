"use client";

// ConnectionStatus — app-wide connectivity banner. The server poller logs when
// CoinGecko is unreachable, but the browser gave the user no signal that prices
// went stale. This watches the BROWSER's own connection (navigator.onLine +
// the online/offline events) and drops a fixed banner the moment the network
// drops — even on localhost, killing wifi flips onLine to false. Shows a brief
// green "back online" confirmation when the connection returns.
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useRef, useState } from "react";

export default function ConnectionStatus() {
  // Start "online" so the server render and first client render agree (avoids a
  // hydration mismatch); the effect syncs the real state right after mount.
  const [online, setOnline] = useState(true);
  const [showBack, setShowBack] = useState(false);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine); // could already be offline on load

    function goOnline() {
      setOnline(true);
      setShowBack(true); // flash a "back online" confirmation, then hide it
      if (backTimer.current) clearTimeout(backTimer.current);
      backTimer.current = setTimeout(() => setShowBack(false), 3000);
    }
    function goOffline() {
      setOnline(false);
      setShowBack(false);
    }

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      if (backTimer.current) clearTimeout(backTimer.current);
    };
  }, []);

  // Nothing to show while healthy.
  if (online && !showBack) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-3"
    >
      <div
        className={`animate-toast-in flex items-center gap-2.5 rounded-full border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] shadow-glow ${
          online
            ? "border-primary/50 bg-primary/15 text-primary"
            : "border-danger/50 bg-danger/15 text-danger"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            online ? "bg-primary" : "animate-pulse bg-danger"
          }`}
        />
        {online
          ? "✓ Back online — live feed resumed"
          : "⚠ You're offline — showing last known data, reconnecting…"}
      </div>
    </div>
  );
}
