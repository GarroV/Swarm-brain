import { COUNTRY_NAMES, countryCode } from "./countries";

export const COCKPIT_MAX_COUNTRIES = 8;
export const COCKPIT_BLOCKS = ["reminders", "meetings", "tasks", "quality", "units"] as const;
export type CockpitBlock = typeof COCKPIT_BLOCKS[number];
export type CockpitPreferences = Record<CockpitBlock, boolean>;
export const DEFAULT_COCKPIT_PREFERENCES: CockpitPreferences = {
  reminders: true, meetings: true, tasks: true, quality: true, units: true,
};

/** Keep the existing demo market; real selectable countries come from the canonical registry. */
export function cockpitCountries(values: readonly string[]): string[] {
  return [...new Set(values.map(countryCode).filter((code) => Object.hasOwn(COUNTRY_NAMES, code) || code === "XD"))].slice(0, COCKPIT_MAX_COUNTRIES);
}

const key = (owner: string) => `roy_home_cockpit_v1:${owner}`;

export function loadCockpitPreferences(owner: string | null): CockpitPreferences {
  if (!owner || typeof window === "undefined") return { ...DEFAULT_COCKPIT_PREFERENCES };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? "null");
    if (!saved || typeof saved !== "object") return { ...DEFAULT_COCKPIT_PREFERENCES };
    return Object.fromEntries(COCKPIT_BLOCKS.map((block) => [block,
      typeof (saved as Record<string, unknown>)[block] === "boolean"
        ? (saved as CockpitPreferences)[block] : true,
    ])) as CockpitPreferences;
  } catch { return { ...DEFAULT_COCKPIT_PREFERENCES }; }
}

/** Per workspace and signed-in person; never persist an anonymous profile. */
export function saveCockpitPreferences(owner: string | null, preferences: CockpitPreferences): void {
  if (!owner || typeof window === "undefined") return;
  try { localStorage.setItem(key(owner), JSON.stringify(preferences)); } catch { /* The current session still works. */ }
}
