/**
 * Task #606 — DB access for HR holiday-review decisions over the curated
 * TR/MENA dataset (see atelierHolidays.ts, table atelier_holiday_overrides).
 * Kept out of atelierHolidays.ts so that module stays pure/synchronous.
 */
import { eq } from "drizzle-orm";
import { db, atelierHolidayOverrides } from "@workspace/db";
import type { HolidayOverride } from "./atelierHolidays.js";

export type HolidayOverrideRow = typeof atelierHolidayOverrides.$inferSelect;

export async function loadHolidayOverrideRows(orgId: string): Promise<HolidayOverrideRow[]> {
  return db
    .select()
    .from(atelierHolidayOverrides)
    .where(eq(atelierHolidayOverrides.orgId, orgId));
}

export function toHolidayOverrides(rows: readonly HolidayOverrideRow[]): HolidayOverride[] {
  return rows.map((r) => ({
    holidayKey: r.holidayKey,
    status: r.status === "adjusted" ? "adjusted" : "confirmed",
    date: r.date,
    endDate: r.endDate,
  }));
}

export async function loadHolidayOverrides(orgId: string): Promise<HolidayOverride[]> {
  return toHolidayOverrides(await loadHolidayOverrideRows(orgId));
}
