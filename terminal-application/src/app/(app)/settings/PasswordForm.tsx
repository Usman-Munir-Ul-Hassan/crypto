"use client";

// Passkey card, both doors of the API contract:
//   hasPassword=true  -> CHANGE: current passkey + new passkey
//   hasPassword=false -> SET: new passkey only (Google session is the proof)
// Mirrors the register form's strength rules so failures happen client-side
// first; the server re-checks everything anyway.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/icons";

// Same rules as the register page + /api/password — one contract everywhere.
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "8+ characters", test: (p) => p.length >= 8 },
  { label: "Uppercase", test: (p) => /[A-Z]/.test(p) },
  { label: "Lowercase", test: (p) => /[a-z]/.test(p) },
  { label: "Number", test: (p) => /[0-9]/.test(p) },
  { label: "Symbol", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const INPUT_CLASS =
  "w-full rounded-lg border border-line bg-background px-4 py-3 font-mono text-xs text-foreground outline-none transition placeholder:text-muted focus:border-primary/60";

export default function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const strong = RULES.every((r) => r.test(next));
  const ready = strong && (!hasPassword || current.length > 0) && !loading;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError("");
    setDone("");
    setLoading(true);
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          hasPassword
            ? { currentPassword: current, newPassword: next }
            : { newPassword: next }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Update failed");
        return;
      }
      setDone(typeof data?.message === "string" ? data.message : "Saved");
      setCurrent("");
      setNext("");
      // Re-run the server component so a fresh SET flips this card into
      // CHANGE mode (hasPassword comes from the DB, not client state).
      router.refresh();
    } catch {
      setError("Link failure — server unreachable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
        <Icon name="key" size={13} />
        {hasPassword ? "Change Passkey" : "Set Passkey"}
      </h2>
      {!hasPassword && (
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
          Google-linked account — add a passkey to enable credential sign-in too.
        </p>
      )}

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        {hasPassword && (
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="CURRENT PASSKEY"
            autoComplete="current-password"
            className={INPUT_CLASS}
          />
        )}
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="NEW PASSKEY"
          autoComplete="new-password"
          className={INPUT_CLASS}
        />

        {/* Live strength checklist — turns primary as each rule passes. */}
        <div className="flex flex-wrap gap-2">
          {RULES.map((rule) => {
            const ok = rule.test(next);
            return (
              <span
                key={rule.label}
                className={`flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] ${
                  ok ? "border-primary/40 text-primary" : "border-line text-muted"
                }`}
              >
                {ok && <Icon name="check" size={10} />}
                {rule.label}
              </span>
            );
          })}
        </div>

        {error && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
            {error}
          </p>
        )}
        {done && (
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            <Icon name="check" size={12} />
            {done}
          </p>
        )}

        <button
          type="submit"
          disabled={!ready}
          className="mt-1 flex cursor-pointer items-center justify-center gap-2 self-end rounded-lg bg-primary px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="key" size={12} />
          {loading ? "Committing…" : hasPassword ? "Commit Change" : "Commit Passkey"}
        </button>
      </form>
    </section>
  );
}
