/**
 * Atelier — Finance Payables (P2P) routes (Task #418, Wave 6).
 *
 * All in-memory demo data (vendors, purchase orders, vendor invoices,
 * payment runs, WHT certificates, subcontractor links) was permanently
 * removed per the production no-dummy-data policy (Task #114). The
 * routes keep responding — listings return empty collections, derived
 * summaries compute to zero, by-id lookups 404 — so the frontend fails
 * gracefully. Real persistence + data entry land in a future task;
 * nothing here may reseed dummy data.
 *
 * Persona gating mirrors the Finance Entities pattern.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { atelierUsers } from "@workspace/db";

type Me = typeof atelierUsers.$inferSelect;
const router: IRouter = Router();

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
    res.status(403).json({ error: "recruiter-scope", message: "Recruiter persona may only access /studio surfaces." });
    return true;
  }
  return false;
}

function requireFinanceLeader(me: Me, res: Response): boolean {
  // Maker-checker / signatory mutations require Partner-tier or Finance.
  const ok = me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
  if (!ok) {
    res.status(403).json({ error: "leader-only", message: "Partner-tier or Finance role required." });
    return true;
  }
  return false;
}

/** Shared guard for read routes: persona + recruiter scope. */
function readGate(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return null;
  return me;
}

/** Shared guard for write routes: persona + recruiter scope + leader role. */
function writeGate(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return null;
  return me;
}

// ============================================================
// Vendors
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/vendors", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/vendors/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/vendors/:id/bank-change", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "vendor-not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/vendors/:id/bank-change/:changeId/oob-confirm", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "vendor-not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/vendors/:id/bank-change/:changeId/decide", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "vendor-not-found" });
});

// ============================================================
// Purchase Orders + GRNs
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/po", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/po/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Vendor invoices + 3-way match
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/invoices", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/invoices/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/invoices/:id/match", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/invoices/:id/approve", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/invoices/:id/override", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Payment runs (maker-checker + dual signatories + bank-file)
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/payment-runs", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/build", (req, res) => {
  if (!writeGate(req, res)) return;
  // No approved-for-payment invoices exist, so no run can be built.
  res.status(409).json({ error: "no-eligible-invoices", excluded: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/payment-runs/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/check", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/sign", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/export", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// WHT register
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/wht", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [], remittance: [] });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/wht/:id/issue", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/wht/:id/send", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/wht/:id/acknowledge", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Subcontractors
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/subcontractors", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ vendors: [], links: [] });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/subcontractors/links/:id/ar-receipt", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Audit trail
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/audit", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// ============================================================
// Dashboard tile + inbox producers (Wave-1 wiring)
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/dashboard/expected-disbursements", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/dashboard/stalled-approvals", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

export default router;
