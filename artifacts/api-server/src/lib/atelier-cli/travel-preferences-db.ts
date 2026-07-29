/**
 * Task #744 — DB-backed travel-preferences resolver.
 *
 * Kept OUT of `travel-capabilities.ts` so that module stays DB-free for
 * the offline travel probe. Imported (side-effect) by
 * `bootstrap-capabilities.ts` at server boot; resolves the requester's
 * own employee row from the session persona (never model input) and
 * exposes only preference fields — loyalty membership numbers are never
 * surfaced to the model.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierEmployees } from "@workspace/db";
import { travelProfileToWire } from "../atelier-travel-profile.js";
import { setTravelPreferencesResolver } from "./travel-preferences.js";

setTravelPreferencesResolver(async (ctx) => {
  const [emp] = await db
    .select({ travelProfile: atelierEmployees.travelProfile })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, ctx.persona.orgId),
        eq(atelierEmployees.userId, ctx.persona.id),
        isNull(atelierEmployees.deletedAt),
      ),
    )
    .limit(1);
  const wire = emp ? travelProfileToWire(emp.travelProfile) : null;
  if (!wire) return null;
  const p = wire.preferences;
  const hasAny =
    p.preferredAirlines.length > 0 ||
    p.preferredHotelChains.length > 0 ||
    !!p.cabinClass ||
    !!p.seatPreference ||
    !!p.mealPreference ||
    !!p.departureTimeWindow ||
    !!p.arrivalTimeWindow ||
    !!p.notes;
  if (!hasAny) return null;
  return {
    preferredAirlines: p.preferredAirlines,
    preferredHotelChains: p.preferredHotelChains,
    cabinClass: p.cabinClass ?? null,
    seatPreference: p.seatPreference ?? null,
    mealPreference: p.mealPreference ?? null,
    departureTimeWindow: p.departureTimeWindow ?? null,
    arrivalTimeWindow: p.arrivalTimeWindow ?? null,
    notes: p.notes ?? null,
  };
});
