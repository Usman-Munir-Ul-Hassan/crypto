"use client";

// Toaster — app-wide toast notifications (toastify-style, zero dependencies).
// Mounted ONCE in the (app) layout so every page shares a single stack; pages
// fire toasts through the useToast() hook: toast("success", "Bitcoin added").
// Green left-bar + ✓ for success, red + ✕ for errors — the same danger/positive
// color language as the alerts feed. Auto-dismisses after 3.5s, click to close.
// Tactical Terminal spec — token classes only, no raw hex.

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastKind = "success" | "error";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type PushToast = (kind: ToastKind, message: string) => void;

const ToastContext = createContext<PushToast | null>(null);

// Pages call this to fire a toast. Throws loudly if the provider is missing —
// a silent no-op would just look like a broken feature.
export function useToast(): PushToast {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

const AUTO_DISMISS_MS = 3500;
const MAX_STACK = 4; // oldest drops off if a click-spree fires more

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (kind, message) => {
      const id = ++nextId.current;
      setToasts((prev) => [...prev.slice(-(MAX_STACK - 1)), { id, kind, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}

      {/* Fixed stack, bottom-right, above everything */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2 sm:max-w-sm">
        {toasts.map((t) => {
          const success = t.kind === "success";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className={`animate-toast-in pointer-events-auto flex w-full cursor-pointer items-center gap-3 rounded-lg border border-l-4 bg-surface p-3 text-left shadow-glow ${
                success ? "border-primary/40 border-l-primary" : "border-danger/40 border-l-danger"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold ${
                  success ? "bg-primary/20 text-primary" : "bg-danger/20 text-danger"
                }`}
              >
                {success ? "✓" : "✕"}
              </span>
              <span className="min-w-0">
                <span
                  className={`block font-mono text-[8px] font-bold uppercase tracking-[0.25em] ${
                    success ? "text-primary" : "text-danger"
                  }`}
                >
                  {success ? "// Confirmed" : "// Failed"}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-foreground">
                  {t.message}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
