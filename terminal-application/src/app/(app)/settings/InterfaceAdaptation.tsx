"use client";

// Interface Adaptation — a per-browser display preference (like a theme
// toggle), so it lives in localStorage, not the database. Selecting a mode
// stamps data-density on <html>; globals.css maps that to a root font-size,
// and since Tailwind sizes are rem-based, the whole UI scales with it.
// UiDensity (mounted in the app layout) re-applies the choice on every page.

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/app/components/icons";
import { DENSITY_KEY, type Density, applyDensity } from "@/app/lib/ui-density";

const MODES: { value: Density; label: string; hint: string; icon: IconName }[] = [
  { value: "compact", label: "Compact UI", hint: "Dense terminal layout", icon: "smartphone" },
  { value: "expanded", label: "Expanded View", hint: "Larger type & spacing", icon: "monitor" },
];

export default function InterfaceAdaptation() {
  const [density, setDensity] = useState<Density>("compact");

  // Read the saved choice AFTER mount — localStorage doesn't exist during SSR.
  useEffect(() => {
    if (localStorage.getItem(DENSITY_KEY) === "expanded") setDensity("expanded");
  }, []);

  function choose(next: Density) {
    setDensity(next);
    localStorage.setItem(DENSITY_KEY, next);
    applyDensity(next); // takes effect instantly, no reload
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
        <Icon name="eye" size={13} />
        Interface Adaptation
      </h2>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((mode) => {
          const selected = density === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => choose(mode.value)}
              aria-pressed={selected}
              className={
                selected
                  ? "flex cursor-pointer items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4 text-left shadow-glow"
                  : "flex cursor-pointer items-center gap-3 rounded-lg border border-line p-4 text-left transition hover:border-primary/30"
              }
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                  selected ? "bg-primary/15 text-primary" : "bg-background text-muted"
                }`}
              >
                <Icon name={mode.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block font-mono text-[11px] font-bold uppercase tracking-[0.15em] ${
                    selected ? "text-primary" : "text-foreground"
                  }`}
                >
                  {mode.label}
                </span>
                <span className="block truncate font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
                  {mode.hint}
                </span>
              </span>
              {selected && <Icon name="check" size={14} className="shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
