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
import { atelierUsers } from "@workspace/db";

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
const CONTROLS: InternalControl[] = [];

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
const SOD_CONFLICTS: SoDConflict[] = [];

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
const STATUTORY_FILINGS: StatutoryFiling[] = [];

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
const TP_REGISTER: TpRegisterRow[] = [];

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
const INSURANCE: InsurancePolicy[] = [];

/* ============================================================
   Routes
   ============================================================ */
function gatedList(items: unknown) {
  return (req: Request, res: Response) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (denyRecruiter(me, res)) return;
    res.json({ items });
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/controls", gatedList(CONTROLS));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/sod", gatedList(SOD_CONFLICTS));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/statutory", gatedList(STATUTORY_FILINGS));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/tp", gatedList(TP_REGISTER));
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/comply/insurance", gatedList(INSURANCE));

export default router;
