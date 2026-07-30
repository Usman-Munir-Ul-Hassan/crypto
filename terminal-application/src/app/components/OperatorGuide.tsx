"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";

// Each step points at a DOM id that must exist on the dashboard.
const STEPS = [
  {
    targetId: "dashboard-stats",
    title: "Market Overview",
    text: "Global market cap, 24h volume and market change — your situational awareness panel.",
  },
  {
    targetId: "nav-alerts",
    title: "Alerts",
    text: "Create price alerts here. Sentry pings you the moment a target price is crossed.",
  },
  {
    targetId: "watchlist-button",
    title: "Watchlist",
    text: "Star any asset to pin it to your personal watchlist for quick access.",
  },
  {
    targetId: "market-search",
    title: "Market Search",
    text: "Search assets, protocols or TX IDs from anywhere on the terminal.",
  },
  {
    targetId: "profile-menu",
    title: "Profile",
    text: "Your operator identity and account settings live down here.",
  },
];

// Position + size of the element currently being spotlighted.
type Box = { top: number; left: number; width: number; height: number };

export default function OperatorGuide() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // localStorage is per-BROWSER but the flag is per-ACCOUNT: scope every key
  // by user id, or user B on a shared machine inherits user A's "completed".
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const completedKey = `guide_completed:${userId}`;
  const stepKey = `guide_step:${userId}`;

  const finish = useCallback(() => {
    // Local cache (fast, per-device) + clear the saved resume point...
    localStorage.setItem(completedKey, "true");
    localStorage.removeItem(stepKey);
    // ...and persist to the DATABASE so it follows the user across devices.
    fetch("/api/tutorial", { method: "POST" }).catch(() => {});
    setActive(false);
  }, [completedKey, stepKey]);

  // Mount: decide whether this operator still needs the tour.
  useEffect(() => {
    // Session not resolved yet -> we don't know WHO this is; wait for the
    // effect to re-run once userId arrives instead of guessing.
    if (!userId) return;
    // Fast path — THIS user already finished on THIS browser, skip the network call.
    if (localStorage.getItem(completedKey) === "true") return;
    // Otherwise ask the database (source of truth, set false at registration).
    fetch("/api/tutorial")
      .then((r) => r.json())
      .then((data) => {
        if (data.completed) {
          localStorage.setItem(completedKey, "true"); // cache for next time
          return;
        }
        // New operator: resume at the saved step if they refreshed mid-tour.
        setStep(Number(localStorage.getItem(stepKey)) || 0);
        setActive(true);
      })
      .catch(() => {}); // network hiccup -> just don't show the tour
  }, [userId, completedKey, stepKey]);

  // Persist the current step so a refresh mid-tour resumes where they left off.
  useEffect(() => {
    if (active) localStorage.setItem(stepKey, String(step));
  }, [active, step, stepKey]);

  // Every step change: measure the target element and move the spotlight to it.
  useEffect(() => {
    if (!active) return;
    const el = document.getElementById(STEPS[step].targetId);
    if (!el) {
      // Target not rendered yet — skip it, or finish if it was the last step.
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else finish();
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    // Stacked (mobile/tablet) layouts push most targets below the fold —
    // bring the target on-screen FIRST, then measure once the scroll landed.
    el.scrollIntoView({ block: "center", inline: "center" });
    requestAnimationFrame(() => {
      measure();
      // Focus the dialog so keyboard users + screen readers land on the new step.
      requestAnimationFrame(() => dialogRef.current?.focus());
    });
    // Keep the spotlight glued to the target if the viewport changes mid-tour.
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step, finish]);

  const last = step === STEPS.length - 1;
  // Tooltip goes below the target, unless that would push it off-screen.
  // (box-dependent math is guarded: box is null until the first measure.)
  const fitsBelow = box ? box.top + box.height + 190 < window.innerHeight : true;
  const tooltipLeft = box ? Math.min(Math.max(box.left, 16), window.innerWidth - 340) : 0;

  return (
    <AnimatePresence>
      {/* AnimatePresence must stay mounted while the child comes and goes,
          otherwise the exit fade never gets a chance to play. */}
      {active && box && (
        <motion.div
          key="operator-guide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onKeyDown={(e) => e.key === "Escape" && finish()}
        >
        {/* Invisible click-catcher: clicking outside the tooltip dismisses the guide. */}
        <div className="fixed inset-0 z-40" onClick={finish} />
        {/* The spotlight: one div whose giant box-shadow dims EVERYTHING except itself.
            Spring-animated so it GLIDES between targets instead of teleporting. */}
        <motion.div
          className="pointer-events-none fixed z-50 rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.75)]"
          initial={false}
          animate={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />

        {/* Tooltip explaining the highlighted feature. Keyed by step so each
            step re-enters with its own fade + slide-up. */}
        <motion.div
          key={step}
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-labelledby="guide-title"
          aria-label={STEPS[step].title}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed z-50 w-80 rounded-lg border border-line bg-surface p-5 shadow-glow outline-none"
          style={{
            left: tooltipLeft,
            top: fitsBelow ? box.top + box.height + 16 : undefined,
            bottom: fitsBelow ? undefined : window.innerHeight - box.top + 16,
          }}
        >
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">
          Step {step + 1} / {STEPS.length}
        </p>
        <h2
          id="guide-title"
          className="mt-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground"
        >
          {STEPS[step].title}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{STEPS[step].text}</p>

        {/* row-reverse keeps the visual order (Skip left, Next right) while
            putting Next FIRST in the DOM -> first Tab stop from the dialog. */}
        <div className="mt-5 flex flex-row-reverse items-center justify-between">
          <div className="flex flex-row-reverse gap-2">
            <button
              type="button"
              onClick={() => (last ? finish() : setStep(step + 1))}
              className="cursor-pointer rounded bg-primary px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-black transition hover:opacity-90"
            >
              {last ? "Finish" : "Next"}
            </button>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="cursor-pointer rounded border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-foreground transition hover:border-primary/40"
              >
                Previous
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={finish}
            className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted transition hover:text-foreground"
          >
            Skip
          </button>
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
