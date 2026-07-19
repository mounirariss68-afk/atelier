/**
 * Atelier — Finance Comply read routes (Task #419, Wave 7).
 *
 * Demo-only seed data describing the four Comply registers that sit
 * alongside the existing tax-filings calendar (which lives on the
 * entities backbone, Task #372):
 *
 *   - Internal controls catalogue (SOX-lite — controls + cadence +
 *     last-tested + exceptions, plus a SoD matrix mapped onto the
 *     atelier role model).
 *   - Statutory filings register (per entity — annual accounts,
 *     beneficial ownership, country-by-country, MISA / DIFC / ADGM,
 *     payroll year-end).
 *   - Transfer-pricing register (one row per inter-company link,
 *     pulling the TP method already set on the entity model; master
 *     and local file slots with version history; related-party
 *     transactions schedule).
 *   - Insurance register (PI / D&O / employer's liability / cyber).
 *
 * All four feed the FinanceHome compliance-calendar tile and the
 * "Next action for you" inbox alongside the existing tax / licence
 * / close items.
 *
 * Persona gating mirrors financeEntitiesRoutes: recruiter is denied
 * (it is /studio-only firm-wide). Real document storage and
 * automated control testing are out of scope; everything here is
 * static seed.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, atelierUsers, atelierFinanceComplianceEntries } from "@workspace/db";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({
      error: "recruiter-scope",
      message: "Recruiter persona may only access /studio surfaces.",
    });
    return true;
  }
  return false;
}

/* ============================================================
   Internal controls catalogue
   ============================================================ */
export type ControlFrequency =
  | "per_transaction"
  | "daily"
  | "monthly"
  | "quarterly"
  | "annual";
export type ControlResult = "pass" | "fail" | "exception" | "not_tested";
export type ControlArea =
  | "revenue"
  | "ar"
  | "cash"
  | "ap"
  | "payroll"
  | "journals"
  | "itgc";

export interface InternalControl {
  id: string;
  title: string;
  description: string;
  area: ControlArea;
  owner: string;
  ownerRole: string;
  frequency: ControlFrequency;
  evidenceCadence: string;
  lastTestedOn: string;
  lastResult: ControlResult;
  exceptionsOpen: number;
  remediation: string | null;
  appliesToEntities: string[];
}

// Fabricated demo controls removed per the no-demo-data policy; the
// controls register renders an honest empty state until real controls exist.


/* ============================================================
   Segregation-of-duties matrix
   ============================================================ */
export interface SoDConflict {
  id: string;
  title: string;
  description: string;
  rolesA: string[];
  rolesB: string[];
  severity: "high" | "medium" | "low";
  currentlyViolatingPeople: { name: string; role: string }[];
  mitigation: string;
  linkedControlIds: string[];
}

// Fabricated demo SoD conflicts removed per the no-demo-data policy.


/* ============================================================
   Statutory filings register
   ============================================================ */
export type FilingStatus = "not_started" | "in_progress" | "filed" | "overdue";

export interface StatutoryFiling {
  id: string;
  entityId: string;
  kind: string;
  authority: string;
  description: string;
  dueOn: string;
  status: FilingStatus;
  owner: string;
  evidenceUrl: string | null;
  notes: string;
}

// Fabricated demo statutory filings removed per the no-demo-data policy.


/* ============================================================
   Transfer-pricing register
   ============================================================ */
export interface TpFileVersion {
  version: string;
  publishedOn: string;
  author: string;
  notes: string;
}

export interface RelatedPartyTransaction {
  id: string;
  entityAId: string;
  entityBId: string;
  description: string;
  fyAmountUsdK: number;
  basis: string;
}

export interface TpRegisterRow {
  id: string;
  entityAId: string;
  entityBId: string;
  relationship: string;
  tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
  intercoServiceFeePct: number | null;
  benchmarkRange: string;
  benchmarkSource: string;
  masterFile: { current: TpFileVersion | null; history: TpFileVersion[] };
  localFile: { current: TpFileVersion | null; history: TpFileVersion[] };
  relatedPartyTransactions: RelatedPartyTransaction[];
  notes: string;
}

// Fabricated demo TP register rows removed per the no-demo-data policy.


/* ============================================================
   Insurance register
   ============================================================ */
export type InsuranceKind =
  | "Professional Indemnity"
  | "D&O"
  | "Employer's Liability"
  | "Cyber"
  | "Office / Property";

export interface InsurancePolicy {
  id: string;
  entityId: string;
  kind: InsuranceKind;
  insurer: string;
  policyNumber: string;
  periodFrom: string;
  periodTo: string;
  coverageUsdK: number;
  premiumUsdK: number;
  excessUsdK: number;
  status: "active" | "expiring_soon" | "expired" | "renewal_in_progress";
  renewalOwner: string;
  notes: string;
}

// Fabricated demo insurance policies removed per the no-demo-data policy.


/* ============================================================
   Routes — DB-backed registers (Task #177).

   All five registers persist in atelier_finance_compliance_entries
   (register discriminator + jsonb payload). Reads keep the original
   { items } shape; writes are finance-leadership only, so real
   controls / filings / policies can be entered manually now that
   the demo seed is gone.
   ============================================================ */
type RegisterKey = "controls" | "sod" | "statutory" | "tp" | "insurance";
const REGISTERS: RegisterKey[] = ["controls", "sod", "statutory", "tp", "insurance"];

// Minimal per-register required string fields for manual entry; the
// full interfaces above document the complete shape the UI renders.
const REQUIRED_FIELDS: Record<RegisterKey, string[]> = {
  controls: ["title", "area", "owner", "frequency"],
  sod: ["title", "severity"],
  statutory: ["entityId", "kind", "authority", "dueOn", "status"],
  tp: ["entityAId", "entityBId", "relationship", "tpMethod"],
  insurance: ["entityId", "kind", "insurer", "periodFrom", "periodTo"],
};

function isFinanceLeadership(me: Me): boolean {
  return ["founding_partner", "partner", "finance", "senior_manager"].includes(me.role);
}

async function listRegister(orgId: string, register: RegisterKey): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(atelierFinanceComplianceEntries)
    .where(and(
      eq(atelierFinanceComplianceEntries.orgId, orgId),
      eq(atelierFinanceComplianceEntries.register, register),
      isNull(atelierFinanceComplianceEntries.deletedAt),
    ))
    .orderBy(asc(atelierFinanceComplianceEntries.createdAt));
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

function gatedList(register: RegisterKey) {
  return async (req: Request, res: Response) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (denyRecruiter(me, res)) return;
    res.json({ items: await listRegister(me.orgId, register) });
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/controls", gatedList("controls"));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/sod", gatedList("sod"));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/statutory", gatedList("statutory"));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/tp", gatedList("tp"));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/insurance", gatedList("insurance"));

function parseRegister(req: Request, res: Response): RegisterKey | null {
  const r = String(req.params.register ?? "");
  if (!REGISTERS.includes(r as RegisterKey)) {
    res.status(404).json({ error: "not-found", message: "unknown register" });
    return null;
  }
  return r as RegisterKey;
}

function validateEntry(register: RegisterKey, data: unknown, res: Response): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    res.status(400).json({ error: "invalid", message: "data must be an object" });
    return null;
  }
  const obj = data as Record<string, unknown>;
  delete obj.id; // row id is server-assigned
  const missing = REQUIRED_FIELDS[register].filter(
    (f) => obj[f] === undefined || obj[f] === null || obj[f] === "",
  );
  if (missing.length > 0) {
    res.status(400).json({ error: "invalid", message: `missing required field(s): ${missing.join(", ")}` });
    return null;
  }
  if (JSON.stringify(obj).length > 50_000) {
    res.status(400).json({ error: "invalid", message: "entry too large" });
    return null;
  }
  return obj;
}

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/comply/:register", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
    return;
  }
  const register = parseRegister(req, res); if (!register) return;
  const data = validateEntry(register, req.body?.data ?? req.body, res); if (!data) return;
  const id = `fcr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(atelierFinanceComplianceEntries).values({
    id, orgId: me.orgId, register, data, createdByUserId: me.id, updatedByUserId: me.id,
  });
  res.status(201).json({ item: { id, ...data } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.patch("/finance/comply/:register/:id", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
    return;
  }
  const register = parseRegister(req, res); if (!register) return;
  const rows = await db.select().from(atelierFinanceComplianceEntries)
    .where(and(
      eq(atelierFinanceComplianceEntries.orgId, me.orgId),
      eq(atelierFinanceComplianceEntries.id, String(req.params.id)),
      eq(atelierFinanceComplianceEntries.register, register),
      isNull(atelierFinanceComplianceEntries.deletedAt),
    )).limit(1);
  const existing = rows[0];
  if (!existing) { res.status(404).json({ error: "not-found" }); return; }
  const merged = { ...existing.data, ...(req.body?.data ?? req.body ?? {}) };
  const data = validateEntry(register, merged, res); if (!data) return;
  await db.update(atelierFinanceComplianceEntries)
    .set({ data, updatedAt: new Date(), updatedByUserId: me.id })
    .where(eq(atelierFinanceComplianceEntries.id, existing.id));
  res.json({ item: { id: existing.id, ...data } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.delete("/finance/comply/:register/:id", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
    return;
  }
  const register = parseRegister(req, res); if (!register) return;
  const rows = await db.select().from(atelierFinanceComplianceEntries)
    .where(and(
      eq(atelierFinanceComplianceEntries.orgId, me.orgId),
      eq(atelierFinanceComplianceEntries.id, String(req.params.id)),
      eq(atelierFinanceComplianceEntries.register, register),
      isNull(atelierFinanceComplianceEntries.deletedAt),
    )).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "not-found" }); return; }
  await db.update(atelierFinanceComplianceEntries)
    .set({ deletedAt: new Date(), updatedByUserId: me.id })
    .where(eq(atelierFinanceComplianceEntries.id, rows[0].id));
  res.json({ ok: true, deleted: true });
});

export default router;
