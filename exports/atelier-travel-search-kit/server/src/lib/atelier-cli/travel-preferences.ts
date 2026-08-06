/**
 * Task #744 — requester travel preferences for the chat travel tools.
 *
 * DB-FREE indirection: `travel-capabilities.ts` stays importable with no
 * database (the offline travel probe depends on that), so it reads the
 * requester's saved preferences through this tiny registry. The real,
 * DB-backed resolver lives in `travel-preferences-db.ts` and is
 * registered by `bootstrap-capabilities.ts` at server boot. When no
 * resolver is registered (offline probe) or the lookup fails, tools
 * simply run without preference context — never a hard failure.
 */

import type { ToolContext } from "./index.js";

/** Lightweight preference context the travel tools consume. */
export interface TravelPrefsContext {
  preferredAirlines: string[];
  preferredHotelChains: string[];
  cabinClass: string | null;
  seatPreference: string | null;
  mealPreference: string | null;
  departureTimeWindow: string | null;
  arrivalTimeWindow: string | null;
  notes: string | null;
}

type Resolver = (ctx: ToolContext) => Promise<TravelPrefsContext | null>;

let resolver: Resolver | null = null;

export function setTravelPreferencesResolver(fn: Resolver | null): void {
  resolver = fn;
}

/**
 * Best-effort lookup of the requester's saved travel preferences.
 * Returns null when unset, on error, or when no resolver is registered.
 */
export async function resolveTravelPreferences(
  ctx: ToolContext,
): Promise<TravelPrefsContext | null> {
  if (!resolver) return null;
  try {
    return await resolver(ctx);
  } catch {
    // Preferences are advisory context — a lookup failure must never
    // break a live search.
    return null;
  }
}

/** Human-readable one-liner for result payloads (model + card context). */
export function travelPrefsNote(
  prefs: TravelPrefsContext,
  kind: "flights" | "stays",
): string | null {
  const bits: string[] = [];
  if (kind === "flights") {
    if (prefs.preferredAirlines.length > 0)
      bits.push(`preferred airlines: ${prefs.preferredAirlines.join(", ")}`);
    if (prefs.cabinClass) bits.push(`usual cabin: ${prefs.cabinClass.replace("_", " ")}`);
    if (prefs.seatPreference && prefs.seatPreference !== "no_preference")
      bits.push(`seat: ${prefs.seatPreference}`);
    if (prefs.departureTimeWindow) bits.push(`prefers departures ${prefs.departureTimeWindow}`);
    if (prefs.arrivalTimeWindow) bits.push(`prefers arrivals ${prefs.arrivalTimeWindow}`);
  } else {
    if (prefs.preferredHotelChains.length > 0)
      bits.push(`preferred hotel chains: ${prefs.preferredHotelChains.join(", ")}`);
  }
  if (prefs.notes) bits.push(`notes: ${prefs.notes}`);
  if (bits.length === 0) return null;
  return `Requester's saved travel preferences — ${bits.join("; ")}. Mention when relevant; do not silently exclude other options.`;
}
