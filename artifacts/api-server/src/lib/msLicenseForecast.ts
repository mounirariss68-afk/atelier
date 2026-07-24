/**
 * Task #632 — Microsoft 365 license seat forecast.
 *
 * A missing seat used to be discovered only at provisioning time (the row
 * parks as pending_license). This daily check compares UPCOMING joiner
 * start dates (employees + contractors) against the spare license seats in
 * the tenant and warns founders/HR AHEAD of day one, so seats can be
 * bought in the GoDaddy portal in time.
 *
 * Invariants:
 *   - Skips cleanly when admin credentials are missing or admin consent is
 *     absent (listSubscribedSkus throws admin-consent-required) — never
 *     surfaces spam when the tenant is not wired up.
 *   - Notifies ONCE per distinct shortfall situation: an audit row stores
 *     a signature of (joiners needing seats + spare seat count); the same
 *     signature never re-notifies. When the situation changes (new joiner,
 *     seats bought but still short), a fresh alert goes out.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import {
  db,
  atelierEmployees,
  atelierContractors,
  atelierMsProvisioning,
  atelierAuditEvents,
} from "@workspace/db";
import {
  MsAdminError,
  msAdminConfigured,
  listSubscribedSkus,
  skuHasSpareUnit,
} from "./msGraphAdmin";
import { notifyMsAdmins } from "./atelier-ms-provisioning";
import { logger } from "./logger";

const AUDIT_ENTITY_TYPE = "ms_license_forecast";
const AUDIT_ACTION = "ms.license.seat_shortfall";

/** Statuses that mean the person already holds (or is linked to) a license. */
const SEATED_STATUSES = ["provisioned", "linked_existing"];

export interface SeatForecastResult {
  checked: boolean;
  /** Reason when checked=false (not-configured | admin-consent-required | …). */
  skippedReason?: string;
  upcomingJoiners: number;
  needingSeats: number;
  spareSeats: number;
  shortfall: number;
  notified: boolean;
}

interface UpcomingJoiner {
  orgId: string;
  personId: string;
  personType: "employee" | "contractor";
  fullName: string;
  email: string;
  startDate: string; // ISO date
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadUpcomingJoiners(
  today: string,
  horizonEnd: string,
): Promise<UpcomingJoiner[]> {
  const emps = await db
    .select({
      orgId: atelierEmployees.orgId,
      id: atelierEmployees.id,
      fullName: atelierEmployees.fullName,
      email: atelierEmployees.email,
      startDate: atelierEmployees.startDate,
    })
    .from(atelierEmployees)
    .where(
      and(
        isNull(atelierEmployees.deletedAt),
        gt(atelierEmployees.startDate, today),
        lte(atelierEmployees.startDate, horizonEnd),
      ),
    );
  const cts = await db
    .select({
      orgId: atelierContractors.orgId,
      id: atelierContractors.id,
      fullName: atelierContractors.fullName,
      email: atelierContractors.email,
      startDate: atelierContractors.startDate,
      status: atelierContractors.status,
    })
    .from(atelierContractors)
    .where(and(isNull(atelierContractors.deletedAt), gt(atelierContractors.startDate, today), lte(atelierContractors.startDate, horizonEnd)));
  const out: UpcomingJoiner[] = [];
  for (const e of emps) {
    out.push({
      orgId: e.orgId,
      personId: e.id,
      personType: "employee",
      fullName: e.fullName,
      email: e.email,
      startDate: e.startDate!,
    });
  }
  for (const c of cts) {
    if (c.status === "offboarded") continue;
    out.push({
      orgId: c.orgId,
      personId: c.id,
      personType: "contractor",
      fullName: c.fullName,
      email: c.email,
      startDate: c.startDate!,
    });
  }
  return out;
}

/** Filter to joiners who do NOT already hold a Microsoft license seat. */
async function filterNeedingSeats(
  joiners: UpcomingJoiner[],
): Promise<UpcomingJoiner[]> {
  if (joiners.length === 0) return [];
  const rows = await db
    .select({
      personId: atelierMsProvisioning.personId,
      status: atelierMsProvisioning.status,
      licenseFreed: atelierMsProvisioning.licenseFreed,
    })
    .from(atelierMsProvisioning)
    .where(
      inArray(
        atelierMsProvisioning.personId,
        joiners.map((j) => j.personId),
      ),
    );
  const seated = new Set(
    rows
      .filter((r) => SEATED_STATUSES.includes(r.status) && r.licenseFreed !== "yes")
      .map((r) => r.personId),
  );
  return joiners.filter((j) => !seated.has(j.personId));
}

function shortfallSignature(needing: UpcomingJoiner[], spareSeats: number): string {
  const ids = needing
    .map((j) => `${j.personId}:${j.startDate}`)
    .sort()
    .join(",");
  return `spare=${spareSeats};joiners=${ids}`;
}

async function alreadyNotified(orgId: string, signature: string): Promise<boolean> {
  const [last] = await db
    .select({ payload: atelierAuditEvents.payload })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityType, AUDIT_ENTITY_TYPE),
        eq(atelierAuditEvents.entityId, orgId),
        eq(atelierAuditEvents.action, AUDIT_ACTION),
      ),
    )
    .orderBy(desc(atelierAuditEvents.createdAt))
    .limit(1);
  const prev = last?.payload as { signature?: string } | undefined;
  return prev?.signature === signature;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Daily seat forecast. Looks `horizonDays` ahead (default 30), counts
 * upcoming joiners without an existing seat vs spare units in the tenant,
 * and notifies founders/HR once per distinct shortfall.
 */
export async function runMsLicenseSeatForecast(opts?: {
  horizonDays?: number;
}): Promise<SeatForecastResult> {
  const base: SeatForecastResult = {
    checked: false,
    upcomingJoiners: 0,
    needingSeats: 0,
    spareSeats: 0,
    shortfall: 0,
    notified: false,
  };
  if (!msAdminConfigured()) {
    return { ...base, skippedReason: "not-configured" };
  }
  const today = isoToday();
  const horizonEnd = isoPlusDays(today, opts?.horizonDays ?? 30);

  const joiners = await loadUpcomingJoiners(today, horizonEnd);
  base.upcomingJoiners = joiners.length;
  if (joiners.length === 0) return { ...base, checked: true };

  const needing = await filterNeedingSeats(joiners);
  base.needingSeats = needing.length;
  if (needing.length === 0) return { ...base, checked: true };

  let spareSeats = 0;
  try {
    const skus = await listSubscribedSkus();
    for (const sku of skus) {
      if (!skuHasSpareUnit(sku)) continue;
      spareSeats += Math.max(0, sku.prepaidUnits.enabled - sku.consumedUnits);
    }
  } catch (err) {
    // Admin consent missing / tenant blocked / transient Graph failure:
    // skip cleanly (never a founder-facing alert about our own plumbing).
    const code = err instanceof MsAdminError ? err.code : "graph-failed";
    logger.warn({ err, code }, "[ms-license-forecast] sku listing unavailable, skipping");
    return { ...base, skippedReason: code };
  }
  base.spareSeats = spareSeats;

  const shortfall = needing.length - spareSeats;
  base.shortfall = Math.max(0, shortfall);
  if (shortfall <= 0) return { ...base, checked: true };

  const short = needing
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const perOrg = new Map<string, UpcomingJoiner[]>();
  for (const j of short) {
    const list = perOrg.get(j.orgId) ?? [];
    list.push(j);
    perOrg.set(j.orgId, list);
  }

  let notified = false;
  for (const [orgId, orgJoiners] of perOrg) {
    const signature = shortfallSignature(orgJoiners, spareSeats);
    if (await alreadyNotified(orgId, signature)) continue;

    const orgShortfall = Math.max(0, orgJoiners.length - spareSeats);
    if (orgShortfall <= 0) continue;
    const names = orgJoiners
      .map((j) => `${j.fullName} (starts ${fmtDate(j.startDate)})`)
      .join(", ");
    await notifyMsAdmins({
      orgId,
      title: "Microsoft 365 seats will run out before upcoming start dates",
      body:
        `${orgJoiners.length} upcoming joiner(s) need a Microsoft 365 seat but only ` +
        `${spareSeats} spare seat(s) exist in the tenant — ${orgShortfall} more seat(s) needed. ` +
        `Buy seats in the GoDaddy portal before day one. Joiners: ${names}.`,
      href: "/roster/people",
    });
    try {
      await db.insert(atelierAuditEvents).values({
        id: `audit_${randomUUID()}`,
        entityType: AUDIT_ENTITY_TYPE,
        entityId: orgId,
        actorType: "system",
        actorId: "system",
        actorLabel: "System",
        action: AUDIT_ACTION,
        payload: {
          signature,
          spareSeats,
          shortfall: orgShortfall,
          joiners: orgJoiners.map((j) => ({
            personId: j.personId,
            personType: j.personType,
            email: j.email,
            startDate: j.startDate,
          })),
        },
        payloadSummary: `Seat forecast: ${orgJoiners.length} upcoming joiner(s), ${spareSeats} spare seat(s) — ${orgShortfall} seat(s) short`,
      });
    } catch (err) {
      logger.warn({ err }, "[ms-license-forecast] audit write failed");
    }
    notified = true;
  }
  return { ...base, checked: true, notified };
}
