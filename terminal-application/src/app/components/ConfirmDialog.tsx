"use client";

// ConfirmDialog — a themed replacement for the browser's native window.confirm().
// Controlled by the parent: render it with `open`, and it calls onConfirm/onCancel.
// Backdrop click + Esc both cancel; the confirm button auto-focuses so Enter works.
// `danger` paints the confirm button red for destructive actions (default true).
// Tactical Terminal spec — token classes only, no raw hex.

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean; // disables buttons while the confirmed action is in flight
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Esc closes, and focus lands on the confirm button so Enter works too.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop — click to cancel (unless the action is running) */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0 cursor-default bg-background/80 backdrop-blur-sm"
      />

      {/* Card */}
      <div className="animate-toast-in relative w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-glow">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg ${
              danger ? "bg-danger/15 text-danger" : "bg-primary/15 text-primary"
            }`}
          >
            {danger ? "⚠" : "?"}
          </span>
          <h2 className="font-display text-lg font-black italic tracking-wide">{title}</h2>
        </div>

        <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">{message}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-md border border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`cursor-pointer rounded-md border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition disabled:opacity-50 ${
              danger
                ? "border-danger/60 bg-danger/10 text-danger hover:bg-danger/20"
                : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
