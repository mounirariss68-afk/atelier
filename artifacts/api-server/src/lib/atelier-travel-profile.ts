/**
 * Task #744 — employee travel loyalty programs & preferences.
 *
 * Shared shape/validation/redaction helpers for the employee
 * `travelProfile` jsonb column. EMPLOYEES ONLY — contractors and
 * partner-firm resources never carry this data; write surfaces reject it
 * for those worker types.
 *
 * Amadeus-readiness: airline programs are keyed by the operating
 * airline's 2-letter IATA code + membership id, hotel programs by chain
 * code, tier as a label — so a future mapper can emit Amadeus
 * `loyaltyPrograms` entries without a data migration.
 *
 * Membership numbers are personal data: `redactTravelProfile` masks them
 * for viewers who are neither the person themself nor holders of the
 * sensitive-people gate.
 */

import { z } from "zod";

const zTier = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((s) => (s ? s : null));

const zAirlineProgram = z.object({
  // 2-letter IATA carrier code, upper-cased (e.g. "EK").
  airlineIata: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2}$/, "2-character IATA airline code")
    .transform((s) => s.toUpperCase()),
  programName: z.string().trim().min(1).max(120),
  membershipNumber: z.string().trim().min(1).max(60),
  tier: zTier,
});

const zHotelProgram = z.object({
  // Hotel chain code (e.g. "MC" Marriott, "HH" Hilton, "EH" — 2-3 chars).
  chainCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,3}$/, "2-3 character chain code")
    .transform((s) => s.toUpperCase()),
  programName: z.string().trim().min(1).max(120),
  membershipNumber: z.string().trim().min(1).max(60),
  tier: zTier,
});

export const CABIN_CLASSES = [
  "economy",
  "premium_economy",
  "business",
  "first",
] as const;
export const SEAT_PREFERENCES = [
  "aisle",
  "window",
  "middle",
  "no_preference",
] as const;

const zNullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((s) => {
      const t = (s ?? "").trim();
      return t ? t : null;
    });

const zPreferences = z.object({
  preferredAirlines: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  preferredHotelChains: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  cabinClass: z.enum(CABIN_CLASSES).nullish().transform((v) => v ?? null),
  seatPreference: z.enum(SEAT_PREFERENCES).nullish().transform((v) => v ?? null),
  mealPreference: zNullableText(120),
  departureTimeWindow: zNullableText(120),
  arrivalTimeWindow: zNullableText(120),
  notes: zNullableText(2000),
});

export const zTravelProfile = z.object({
  airlinePrograms: z.array(zAirlineProgram).max(20).default([]),
  hotelPrograms: z.array(zHotelProgram).max(20).default([]),
  preferences: zPreferences.default({}),
});

export type TravelProfile = z.infer<typeof zTravelProfile>;

export const EMPTY_TRAVEL_PREFERENCES: TravelProfile["preferences"] = {
  preferredAirlines: [],
  preferredHotelChains: [],
  cabinClass: null,
  seatPreference: null,
  mealPreference: null,
  departureTimeWindow: null,
  arrivalTimeWindow: null,
  notes: null,
};

export const MEMBERSHIP_NUMBER_REDACTED = "•••• (restricted)";

/**
 * Normalize a stored (possibly legacy/partial) jsonb value into the full
 * wire shape. Returns null when nothing is stored.
 */
export function travelProfileToWire(v: unknown): TravelProfile | null {
  if (!v || typeof v !== "object") return null;
  const parsed = zTravelProfile.safeParse(v);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Mask membership numbers for viewers without the sensitive-people gate
 * (and who aren't the person themself). Program names, codes and tiers
 * stay visible — only the membership id is personal data.
 */
export function redactTravelProfile(p: TravelProfile): TravelProfile {
  const mask = (n: string) =>
    n.length > 3 ? `••••${n.slice(-3)}` : MEMBERSHIP_NUMBER_REDACTED;
  return {
    ...p,
    airlinePrograms: p.airlinePrograms.map((a) => ({
      ...a,
      membershipNumber: mask(a.membershipNumber),
    })),
    hotelPrograms: p.hotelPrograms.map((h) => ({
      ...h,
      membershipNumber: mask(h.membershipNumber),
    })),
  };
}
