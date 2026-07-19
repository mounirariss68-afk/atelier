/**
 * Atelier — Finance Entities backbone read routes (Task #372).
 *
 * Legal-entity registry API. All demo/dummy entity data was permanently
 * removed (Task #114) per the production no-dummy-data policy; the
 * registry is empty until real persistence + data entry lands. Routes
 * keep responding (empty collection / 404 by id) and persona gating
 * mirrors v5Routes: recruiter is denied (it is /studio-only firm-wide).
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

interface EInvoicingId {
  scheme: "ZATCA" | "FTA" | "Peppol" | "HMRC_MTD";
  id: string;
  status: "live" | "sandbox" | "pending";
  enrolledAt: string;
}
interface TradeLicense {
  id: string;
  authority: string;
  number: string;
  issuedOn: string;
  expiresOn: string;
  status: "active" | "expiring_soon" | "expired" | "renewal_in_progress";
  scope: string;
}
interface BankAccount {
  id: string;
  bank: string;
  iban: string;
  currency: string;
  purpose: "operating" | "tax" | "payroll" | "escrow";
  signatories: string[];
  primary: boolean;
}
interface Signatory {
  id: string;
  name: string;
  role: string;
  authorityLevel: "A" | "B" | "C";
  resolutionRef: string | null;
}
interface FiscalCalendar {
  yearEnd: string;
  vatPeriod: "monthly" | "quarterly";
  ctPeriod: "annual";
  nextClose: string;
  nextVatFiling: string;
  nextCtFiling: string;
}
interface InterCompanyLink {
  counterpartyId: string;
  relationship: "subsidiary" | "branch" | "shareholder" | "service_provider";
  tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
  intercoServiceFeePct: number | null;
}
interface FinanceEntity {
  id: string;
  legalName: string;
  shortName: string;
  kind: "parent" | "subsidiary" | "branch" | "jv";
  parentId: string | null;
  status: "active" | "dormant" | "winding_down";
  country: "SA" | "AE" | "GB";
  jurisdiction: string;
  baseCurrency: "SAR" | "AED" | "GBP" | "USD";
  reportingCurrency: "USD";
  incorporatedOn: string;
  commercialRegistration: { number: string; authority: string; expiresOn: string };
  taxIds: { vat: string | null; corporate: string | null; whtAgent: string | null };
  eInvoicing: EInvoicingId[];
  tradeLicenses: TradeLicense[];
  bankAccounts: BankAccount[];
  signatories: Signatory[];
  fiscal: FiscalCalendar;
  interCompany: InterCompanyLink[];
  staffCount: number;
  notes: string;
}

// No legal entities exist yet. Real entity records will be created through
// proper data entry / persistence in a future task — nothing may reseed
// dummy data here (production no-dummy-data policy, 2026-07-16).
export const ENTITIES_SEED: FinanceEntity[] = [];

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  res.json({ items: ENTITIES_SEED });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const row = ENTITIES_SEED.find((e) => e.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not-found" });
  res.json({ entity: row });
});

export default router;
