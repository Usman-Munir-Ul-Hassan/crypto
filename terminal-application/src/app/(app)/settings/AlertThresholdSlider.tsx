"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/app/components/Toaster";

export default function AlertThresholdSlider() {
  const [threshold, setThreshold] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setThreshold(data.threshold);
        }
      } catch (err) {
        console.error("Failed to load threshold:", err);
      }
    }
    load();
  }, []);

  async function saveThreshold(newThreshold: number) {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: newThreshold }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast("success", `Alert threshold updated to ${newThreshold.toFixed(2)}%`);
    } catch (err) {
      toast("error", "Failed to update alert threshold" + err);
    } finally {
      setIsSaving(false);
    }
  }

  if (threshold === null)
    return (
      <section className="rounded-xl border border-line bg-surface p-5 sm:p-6 animate-pulse">
        <div className="h-4 w-48 rounded bg-muted/20" />
        <div className="mt-2 h-3 w-full rounded bg-muted/10" />
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 rounded bg-muted/20" />
            <div className="h-6 w-16 rounded bg-muted/20" />
            <div className="h-3 w-24 rounded bg-muted/20" />
          </div>
          <div className="h-2 w-full rounded-full bg-muted/20" />
          <div className="flex justify-between">
            <div className="h-2 w-10 rounded bg-muted/10" />
            <div className="h-2 w-10 rounded bg-muted/10" />
          </div>
        </div>
      </section>
    );

  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/20 text-xs">⎚</span>
        Alert Sensitivity Threshold
      </h2>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
        {"// Configure the global price movement percentage required to trigger a drop or surge alert."}
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-widest text-muted">Low Sensitivity</span>
          <span className="font-mono text-xl font-bold text-primary">{threshold.toFixed(2)}%</span>
          <span className="font-mono text-xs uppercase tracking-widest text-muted">High Sensitivity</span>
        </div>

        <input
          type="range"
          min="0.05"
          max="10.0"
          step="0.05"
          value={threshold}
          disabled={isSaving}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          onMouseUp={(e) => saveThreshold(parseFloat((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => saveThreshold(parseFloat((e.target as HTMLInputElement).value))}
          className="w-full cursor-pointer accent-primary disabled:opacity-50"
        />

        <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.15em] text-muted/60">
          <span>{threshold.toFixed(2)}%</span>
          <span>{threshold.toFixed(2)}%</span>
        </div>
      </div>
    </section>
  );
}
