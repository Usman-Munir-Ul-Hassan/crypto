// Single source of truth for the Interface Adaptation preference.
// One storage key + one applier shared by the settings card (writes) and
// UiDensity in the app layout (re-applies on every page load).

export const DENSITY_KEY = "ui_density";

export type Density = "compact" | "expanded";

export function applyDensity(density: Density) {
  // globals.css reacts to this attribute with a root font-size change;
  // rem-based Tailwind sizes make the whole UI follow.
  document.documentElement.dataset.density = density;
}

export function loadDensity(): Density {
  return localStorage.getItem(DENSITY_KEY) === "expanded" ? "expanded" : "compact";
}
