"use client";

// Invisible helper mounted once in the (app) layout: re-applies the saved
// Interface Adaptation choice on every in-app page, so the preference set
// on /settings survives navigation and reloads. Renders nothing.

import { useEffect } from "react";
import { applyDensity, loadDensity } from "@/app/lib/ui-density";

export default function UiDensity() {
  useEffect(() => {
    applyDensity(loadDensity());
  }, []);

  return null;
}
