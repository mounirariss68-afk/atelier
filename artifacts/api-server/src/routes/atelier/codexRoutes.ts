/**
 * Atelier — Codex (CLM) routes (Task #360, Wave 1, Step 2).
 *
 * Backs /codex with counterparty registry + clause library. The
 * contract record + state machine + two-partner countersign land in
 * Step 3 (this same file, additive). Change orders, deliverable
 * acceptance, e-sign and DPA flows ship in their own route files.
 *
 * Endpoints (Step 2):
 *   GET    /atelier/codex/counterparties                 list (?kind=, ?accountId=)
 *   GET    /atelier/codex/counterparties/:id             single
 *   POST   /atelier/codex/counterparties                 create  (partner|finance)
 *   PATCH  /atelier/codex/counterparties/:id             update  (partner|finance)
 *
 *   GET    /atelier/codex/clauses                        list (?family=, ?status=, ?instrument=, ?q=)
 *   GET    /atelier/codex/clauses/:id                    single
 *   POST   /atelier/codex/clauses                        create draft (partner|finance)
 *   PATCH  /atelier/codex/clauses/:id                    edit draft   (partner|finance)
 *   POST   /atelier/codex/clauses/:id/publish            partner|finance
 *   POST   /atelier/codex/clauses/:id/retire             partner|finance
 *   GET    /atelier/codex/clauses/:id/acceptance         past per-counterparty acceptances
 *
 * Persona gates:
 *   - Read of clauses + counterparties: anyone except RESTRICTED set
 *     (contractor | partner_firm_resource | recruiter | board_observer).
 *     Defense-in-depth — the table-level RLS in 0031 already blocks
 *     these roles, but a 403 at the route is friendlier than a silent
 *     empty list.
 *   - Write: founding_partner | partner | finance only.
 *   - DB writes go through `withRls(req, ...)` so the RLS USING/WITH
 *     CHECK clauses bind against the caller's role + engagement_ids
 *     GUC for the duration of the transaction.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierCounterparty,
  atelierClause,
  atelierClauseAcceptance,
  atelierContract,
  atelierContractParty,
  atelierContractClause,
  atelierContractVersion,
  atelierTwoPartnerCountersign,
  atelierAuditEvents,
  atelierDpa,
} from "@workspace/db";
import { createHash } from "node:crypto";
import { withRls } from "./rls";
import {
  isLeadership,
  isFinance,
  isRestrictedPersona,
  isBoardObserver,
} from "./personaRoles";

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response) {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function canReadCodex(role: string | null | undefined): boolean {
  return !!role && !isRestrictedPersona(role) && !isBoardObserver(role);
}

function canWriteCodex(role: string | null | undefined): boolean {
  return isLeadership(role) || isFinance(role);
}

/**
 * Column-level mask on `atelier_contract.contract_value` /
 * `contract_value_usd`. The 0031 migration ships `atelier_contract_v`
 * for raw SQL access; routes that go through Drizzle re-apply the same
 * mask in code so the wire shape matches.
 */
function canSeeContractValue(role: string | null | undefined): boolean {
  return (
    isLeadership(role) || isFinance(role) || role === "compliance_officer"
  );
}

type ContractRow = typeof atelierContract.$inferSelect;
function maskContractValue(
  row: ContractRow,
  role: string | null | undefined,
): ContractRow & { contractValue: number | null; contractValueUsd: number | null } {
  if (canSeeContractValue(role)) {
    return row as ContractRow & {
      contractValue: number | null;
      contractValueUsd: number | null;
    };
  }
  return {
    ...row,
    contractValue: null as unknown as number,
    contractValueUsd: null as unknown as number,
  };
}

// ---------------------------------------------------------------
// Contract state machine
// ---------------------------------------------------------------
//
// draft → internal_review → two_partner_countersigned →
// external_dispatched → counterparty_review → fully_executed →
// active → expiring → renewed | expired | terminated
//
// Special rules:
//   - external_dispatched requires status = two_partner_countersigned
//     (countersign hard gate; the gate itself is enforced by the
//     `/countersign` route auto-transitioning into that state once
//     both partners sign).
//   - terminated reachable from any non-terminal state.
//   - back-transitions (e.g. counterparty_review → internal_review on
//     incoming redlines) are allowed from review/dispatch states; we
//     re-enter draft by way of internal_review to keep the audit trail
//     monotonic (no draft after dispatch).
//
const CONTRACT_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  draft: ["internal_review", "terminated"],
  internal_review: ["draft", "two_partner_countersigned", "terminated"],
  two_partner_countersigned: ["external_dispatched", "internal_review", "terminated"],
  external_dispatched: ["counterparty_review", "internal_review", "terminated"],
  counterparty_review: ["fully_executed", "internal_review", "terminated"],
  fully_executed: ["active", "terminated"],
  active: ["expiring", "terminated"],
  expiring: ["renewed", "expired", "active", "terminated"],
  renewed: ["terminated"],
  expired: [],
  terminated: [],
};

function isContractTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return false;
  return (CONTRACT_TRANSITIONS[from] ?? []).includes(to);
}

async function audit(
  entityType: string,
  entityId: string,
  actor: { id: string; name: string; role: string },
  action: string,
  payload: Record<string, unknown>,
  summary: string,
) {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType,
    entityId,
    actorType: "human",
    actorId: actor.id,
    actorLabel: actor.name,
    action,
    payload,
    payloadSummary: summary,
  });
}

// ---------------------------------------------------------------
// Zod input schemas (inlined; promote to @workspace/api-zod later)
// ---------------------------------------------------------------

const CounterpartyCreateBody = z.object({
  kind: z.enum(["client", "partner_firm", "contractor", "regulator", "other"]),
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  accountId: z.string().nullable().optional(),
  jurisdiction: z.string().max(8).optional(),
  vatNumber: z.string().max(64).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  billToAddress: z
    .object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      region: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string(),
    })
    .nullable()
    .optional(),
  notes: z.string().max(4000).optional(),
});

const CounterpartyPatchBody = CounterpartyCreateBody.partial().extend({
  kycState: z
    .enum(["pending", "approved", "refresh_due", "blocked"])
    .optional(),
});

const ClauseCreateBody = z.object({
  family: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  jurisdictionTags: z.array(z.string().max(8)).default([]),
  instrumentTypes: z.array(
    z.enum(["msa", "sow", "nda", "dpa", "change_order", "side_letter", "renewal"]),
  ).default([]),
  riskTier: z.enum(["low", "medium", "high"]).default("low"),
});

const ClausePatchBody = ClauseCreateBody.partial();

const ContractCreateBody = z.object({
  instrumentType: z.enum([
    "msa",
    "sow",
    "nda",
    "dpa",
    "change_order",
    "side_letter",
    "renewal",
  ]),
  parentContractId: z.string().nullable().optional(),
  counterpartyId: z.string().min(1),
  engagementId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  title: z.string().min(1).max(240),
  governingLaw: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
  contractValue: z.number().min(0).optional(),
  contractValueUsd: z.number().min(0).optional(),
  termStart: z.string().nullable().optional(), // ISO date
  termEnd: z.string().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  poNumber: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ContractPatchBody = ContractCreateBody.partial();

const ContractTransitionBody = z.object({
  to: z.enum([
    "draft",
    "internal_review",
    "two_partner_countersigned",
    "external_dispatched",
    "counterparty_review",
    "fully_executed",
    "active",
    "expiring",
    "renewed",
    "expired",
    "terminated",
  ]),
  reason: z.string().max(2000).optional(),
});

const ContractPartyAddBody = z.object({
  counterpartyId: z.string().nullable().optional(),
  internalUserId: z.string().nullable().optional(),
  roleOnContract: z.enum(["signer", "witness", "notice_party", "observer"]),
  signerName: z.string().min(1).max(160),
  signerEmail: z.string().email().max(200),
  signerTitle: z.string().max(160).optional(),
  signMethod: z
    .enum(["docusign", "tabellio", "wet_ink_pdf"])
    .optional(),
});

const CountersignBody = z.object({
  partnerBUserId: z.string().min(1).optional(), // required on first call only
  rationaleText: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------
// Router
// ---------------------------------------------------------------

const router: IRouter = Router();

// ===============================================================
// COUNTERPARTIES
// ===============================================================

router.get("/codex/counterparties", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const kind = typeof req.query.kind === "string" ? req.query.kind : null;
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : null;
  const rows = await withRls(req, async (tx) => {
    const conditions = [isNull(atelierCounterparty.deletedAt)];
    if (kind) conditions.push(eq(atelierCounterparty.kind, kind));
    if (accountId) conditions.push(eq(atelierCounterparty.accountId, accountId));
    return tx
      .select()
      .from(atelierCounterparty)
      .where(and(...conditions))
      .orderBy(desc(atelierCounterparty.createdAt));
  });
  res.json({ items: rows });
});

router.get("/codex/counterparties/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const row = await withRls(req, async (tx) => {
    const [r] = await tx
      .select()
      .from(atelierCounterparty)
      .where(
        and(
          eq(atelierCounterparty.id, req.params.id),
          isNull(atelierCounterparty.deletedAt),
        ),
      );
    return r ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "counterparty-not-found" });
    return;
  }
  res.json(row);
});

router.post("/codex/counterparties", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = CounterpartyCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const id = rid("cp");
  const now = new Date();
  const row = await withRls(req, async (tx) => {
    const [created] = await tx
      .insert(atelierCounterparty)
      .values({
        id,
        kind: parsed.data.kind,
        legalName: parsed.data.legalName,
        displayName: parsed.data.displayName,
        accountId: parsed.data.accountId ?? null,
        jurisdiction: parsed.data.jurisdiction ?? "",
        vatNumber: parsed.data.vatNumber ?? "",
        paymentTermsDays: parsed.data.paymentTermsDays ?? 30,
        billToAddress: parsed.data.billToAddress ?? null,
        notes: parsed.data.notes ?? "",
        createdByUserId: me.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  });
  await audit(
    "counterparty",
    id,
    me,
    "counterparty.create",
    { kind: parsed.data.kind, legalName: parsed.data.legalName },
    `${me.name} added counterparty ${parsed.data.legalName}`,
  );
  res.status(201).json(row);
});

router.patch("/codex/counterparties/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = CounterpartyPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  if ("kycState" in patch && patch.kycState) {
    patch.kycReviewedAt = new Date();
  }
  const row = await withRls(req, async (tx) => {
    const [updated] = await tx
      .update(atelierCounterparty)
      .set(patch as never)
      .where(
        and(
          eq(atelierCounterparty.id, req.params.id),
          isNull(atelierCounterparty.deletedAt),
        ),
      )
      .returning();
    return updated ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "counterparty-not-found" });
    return;
  }
  await audit(
    "counterparty",
    row.id,
    me,
    "counterparty.update",
    { fields: Object.keys(parsed.data) },
    `${me.name} updated counterparty ${row.legalName}`,
  );
  res.json(row);
});

// ===============================================================
// CLAUSE LIBRARY
// ===============================================================

router.get("/codex/clauses", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const family = typeof req.query.family === "string" ? req.query.family : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const instrument =
    typeof req.query.instrument === "string" ? req.query.instrument : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const rows = await withRls(req, async (tx) => {
    const conditions = [isNull(atelierClause.deletedAt)];
    if (family) conditions.push(eq(atelierClause.family, family));
    if (status) conditions.push(eq(atelierClause.status, status));
    if (instrument) {
      // jsonb array containment: instrument_types @> '["sow"]'
      conditions.push(
        sql`${atelierClause.instrumentTypes} @> ${JSON.stringify([instrument])}::jsonb`,
      );
    }
    if (q) {
      // simple ILIKE on title|body — full-text can come later if needed.
      conditions.push(
        sql`(${atelierClause.title} ILIKE ${"%" + q + "%"} OR ${atelierClause.body} ILIKE ${"%" + q + "%"})`,
      );
    }
    return tx
      .select()
      .from(atelierClause)
      .where(and(...conditions))
      .orderBy(desc(atelierClause.updatedAt));
  });
  res.json({ items: rows });
});

router.get("/codex/clauses/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const row = await withRls(req, async (tx) => {
    const [r] = await tx
      .select()
      .from(atelierClause)
      .where(
        and(
          eq(atelierClause.id, req.params.id),
          isNull(atelierClause.deletedAt),
        ),
      );
    return r ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "clause-not-found" });
    return;
  }
  res.json(row);
});

router.post("/codex/clauses", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = ClauseCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const id = rid("cl");
  const now = new Date();
  const row = await withRls(req, async (tx) => {
    // Determine version: max(version) + 1 within this family for this org.
    const [latest] = await tx
      .select({ v: atelierClause.version })
      .from(atelierClause)
      .where(eq(atelierClause.family, parsed.data.family))
      .orderBy(desc(atelierClause.version))
      .limit(1);
    const version = (latest?.v ?? 0) + 1;
    const [created] = await tx
      .insert(atelierClause)
      .values({
        id,
        family: parsed.data.family,
        title: parsed.data.title,
        body: parsed.data.body,
        version,
        parentId: latest ? null : null, // resolved by family+version-1 lookup at read time
        jurisdictionTags: parsed.data.jurisdictionTags,
        instrumentTypes: parsed.data.instrumentTypes,
        riskTier: parsed.data.riskTier,
        status: "draft",
        createdByUserId: me.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  });
  await audit(
    "clause",
    id,
    me,
    "clause.draft",
    { family: parsed.data.family, version: row.version },
    `${me.name} drafted clause ${parsed.data.family} v${row.version}`,
  );
  res.status(201).json(row);
});

router.patch("/codex/clauses/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = ClausePatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  const row = await withRls(req, async (tx) => {
    // Refuse edits on published clauses — the contract is publish-then-version.
    const [existing] = await tx
      .select()
      .from(atelierClause)
      .where(
        and(eq(atelierClause.id, req.params.id), isNull(atelierClause.deletedAt)),
      );
    if (!existing) return { error: "not-found" as const };
    if (existing.status !== "draft") {
      return { error: "not-draft" as const, status: existing.status };
    }
    const [updated] = await tx
      .update(atelierClause)
      .set(patch as never)
      .where(eq(atelierClause.id, req.params.id))
      .returning();
    return { row: updated };
  });
  if ("error" in row) {
    if (row.error === "not-found") {
      res.status(404).json({ error: "clause-not-found" });
    } else {
      res.status(409).json({
        error: "clause-not-editable",
        message: `Clause is in status ${row.status}; create a new draft to revise.`,
      });
    }
    return;
  }
  await audit(
    "clause",
    row.row.id,
    me,
    "clause.draft.edit",
    { fields: Object.keys(parsed.data) },
    `${me.name} edited clause draft ${row.row.family} v${row.row.version}`,
  );
  res.json(row.row);
});

router.post("/codex/clauses/:id/publish", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierClause)
      .where(
        and(eq(atelierClause.id, req.params.id), isNull(atelierClause.deletedAt)),
      );
    if (!existing) return { error: "not-found" as const };
    if (existing.status !== "draft") {
      return { error: "not-draft" as const, status: existing.status };
    }
    const now = new Date();
    const [updated] = await tx
      .update(atelierClause)
      .set({
        status: "published",
        publishedAt: now,
        publishedByUserId: me.id,
        updatedAt: now,
      })
      .where(eq(atelierClause.id, req.params.id))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "clause-not-found" });
    } else {
      res.status(409).json({
        error: "clause-not-publishable",
        message: `Clause is in status ${result.status}; only drafts can be published.`,
      });
    }
    return;
  }
  await audit(
    "clause",
    result.row.id,
    me,
    "clause.publish",
    { family: result.row.family, version: result.row.version },
    `${me.name} published clause ${result.row.family} v${result.row.version}`,
  );
  res.json(result.row);
});

router.post("/codex/clauses/:id/retire", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierClause)
      .where(
        and(eq(atelierClause.id, req.params.id), isNull(atelierClause.deletedAt)),
      );
    if (!existing) return { error: "not-found" as const };
    if (existing.status !== "published") {
      return { error: "not-published" as const, status: existing.status };
    }
    const [updated] = await tx
      .update(atelierClause)
      .set({ status: "retired", updatedAt: new Date() })
      .where(eq(atelierClause.id, req.params.id))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "clause-not-found" });
    } else {
      res.status(409).json({
        error: "clause-not-retirable",
        message: `Clause is in status ${result.status}; only published clauses can be retired.`,
      });
    }
    return;
  }
  await audit(
    "clause",
    result.row.id,
    me,
    "clause.retire",
    { family: result.row.family, version: result.row.version },
    `${me.name} retired clause ${result.row.family} v${result.row.version}`,
  );
  res.json(result.row);
});

router.get("/codex/clauses/:id/acceptance", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const rows = await withRls(req, async (tx) => {
    return tx
      .select()
      .from(atelierClauseAcceptance)
      .where(eq(atelierClauseAcceptance.clauseId, req.params.id))
      .orderBy(desc(atelierClauseAcceptance.acceptedAt));
  });
  res.json({ items: rows });
});

// ===============================================================
// CONTRACT (record + state machine)
// ===============================================================

router.get("/codex/contracts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const engagementId =
    typeof req.query.engagementId === "string" ? req.query.engagementId : null;
  const counterpartyId =
    typeof req.query.counterpartyId === "string" ? req.query.counterpartyId : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const instrumentType =
    typeof req.query.instrumentType === "string" ? req.query.instrumentType : null;

  const rows = await withRls(req, async (tx) => {
    const conditions = [isNull(atelierContract.deletedAt)];
    if (engagementId) conditions.push(eq(atelierContract.engagementId, engagementId));
    if (counterpartyId)
      conditions.push(eq(atelierContract.counterpartyId, counterpartyId));
    if (status) conditions.push(eq(atelierContract.status, status));
    if (instrumentType)
      conditions.push(eq(atelierContract.instrumentType, instrumentType));
    return tx
      .select()
      .from(atelierContract)
      .where(and(...conditions))
      .orderBy(desc(atelierContract.createdAt));
  });
  res.json({
    items: rows.map((r) => maskContractValue(r, me.role)),
  });
});

router.get("/codex/contracts/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-not-allowed-for-persona" });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [row] = await tx
      .select()
      .from(atelierContract)
      .where(
        and(
          eq(atelierContract.id, req.params.id),
          isNull(atelierContract.deletedAt),
        ),
      );
    if (!row) return null;
    const parties = await tx
      .select()
      .from(atelierContractParty)
      .where(
        and(
          eq(atelierContractParty.contractId, row.id),
          isNull(atelierContractParty.deletedAt),
        ),
      );
    const clauses = await tx
      .select()
      .from(atelierContractClause)
      .where(
        and(
          eq(atelierContractClause.contractId, row.id),
          isNull(atelierContractClause.deletedAt),
        ),
      )
      .orderBy(atelierContractClause.position);
    const versions = await tx
      .select()
      .from(atelierContractVersion)
      .where(eq(atelierContractVersion.contractId, row.id))
      .orderBy(desc(atelierContractVersion.version));
    const [cs] = await tx
      .select()
      .from(atelierTwoPartnerCountersign)
      .where(eq(atelierTwoPartnerCountersign.contractId, row.id));
    return { row, parties, clauses, versions, countersign: cs ?? null };
  });
  if (!result) {
    res.status(404).json({ error: "contract-not-found" });
    return;
  }
  res.json({
    contract: maskContractValue(result.row, me.role),
    parties: result.parties,
    clauses: result.clauses,
    versions: result.versions,
    countersign: result.countersign,
  });
});

router.post("/codex/contracts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = ContractCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const id = rid("ctr");
  const now = new Date();
  const created = await withRls(req, async (tx) => {
    const [row] = await tx
      .insert(atelierContract)
      .values({
        id,
        instrumentType: parsed.data.instrumentType,
        parentContractId: parsed.data.parentContractId ?? null,
        counterpartyId: parsed.data.counterpartyId,
        engagementId: parsed.data.engagementId ?? null,
        opportunityId: parsed.data.opportunityId ?? null,
        title: parsed.data.title,
        status: "draft",
        governingLaw: parsed.data.governingLaw ?? "",
        currency: parsed.data.currency ?? "USD",
        contractValue: parsed.data.contractValue ?? 0,
        contractValueUsd: parsed.data.contractValueUsd ?? parsed.data.contractValue ?? 0,
        termStart: parsed.data.termStart ?? null,
        termEnd: parsed.data.termEnd ?? null,
        paymentTermsDays: parsed.data.paymentTermsDays ?? 30,
        poNumber: parsed.data.poNumber ?? "",
        metadata: parsed.data.metadata ?? {},
        createdByUserId: me.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  });
  await audit(
    "contract",
    id,
    me,
    "contract.create",
    {
      instrumentType: parsed.data.instrumentType,
      counterpartyId: parsed.data.counterpartyId,
      engagementId: parsed.data.engagementId ?? null,
    },
    `${me.name} created ${parsed.data.instrumentType.toUpperCase()} ${parsed.data.title}`,
  );
  res.status(201).json(maskContractValue(created, me.role));
});

router.patch("/codex/contracts/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = ContractPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierContract)
      .where(
        and(eq(atelierContract.id, req.params.id), isNull(atelierContract.deletedAt)),
      );
    if (!existing) return { error: "not-found" as const };
    if (existing.status !== "draft" && existing.status !== "internal_review") {
      return { error: "not-editable" as const, status: existing.status };
    }
    const [updated] = await tx
      .update(atelierContract)
      .set(patch as never)
      .where(eq(atelierContract.id, req.params.id))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "contract-not-found" });
    } else {
      res.status(409).json({
        error: "contract-not-editable",
        message: `Contract is in status ${result.status}; only draft / internal_review can be edited.`,
      });
    }
    return;
  }
  await audit(
    "contract",
    result.row.id,
    me,
    "contract.update",
    { fields: Object.keys(parsed.data) },
    `${me.name} updated contract ${result.row.title}`,
  );
  res.json(maskContractValue(result.row, me.role));
});

/**
 * POST /codex/contracts/:id/transition
 *
 * Server-side state machine. Snapshots the current rendered body into
 * `atelier_contract_version` on every transition (the "rendered body"
 * is a placeholder JSON of the contract record + clauses until S4
 * wires the Composer agent).
 *
 * Hard gates:
 *   - external_dispatched only reachable from two_partner_countersigned.
 */
router.post("/codex/contracts/:id/transition", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = ContractTransitionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierContract)
      .where(
        and(eq(atelierContract.id, req.params.id), isNull(atelierContract.deletedAt)),
      );
    if (!existing) return { error: "not-found" as const };
    if (!isContractTransitionAllowed(existing.status, parsed.data.to)) {
      return {
        error: "illegal-transition" as const,
        from: existing.status,
        to: parsed.data.to,
      };
    }
    // Hard gate: external_dispatched requires two-partner countersign.
    if (parsed.data.to === "external_dispatched") {
      const [cs] = await tx
        .select()
        .from(atelierTwoPartnerCountersign)
        .where(eq(atelierTwoPartnerCountersign.contractId, existing.id));
      if (!cs || cs.state !== "both_signed") {
        return { error: "countersign-required" as const };
      }
    }
    const now = new Date();
    const patch: Record<string, unknown> = {
      status: parsed.data.to,
      updatedAt: now,
    };
    if (parsed.data.to === "fully_executed") patch.fullyExecutedAt = now;
    if (parsed.data.to === "terminated") {
      patch.terminatedAt = now;
      patch.terminationReason = parsed.data.reason ?? "";
    }
    const [updated] = await tx
      .update(atelierContract)
      .set(patch as never)
      .where(eq(atelierContract.id, existing.id))
      .returning();

    // Snapshot a version row.
    const [latestVer] = await tx
      .select({ v: atelierContractVersion.version })
      .from(atelierContractVersion)
      .where(eq(atelierContractVersion.contractId, existing.id))
      .orderBy(desc(atelierContractVersion.version))
      .limit(1);
    const renderedBody = JSON.stringify({
      contract: updated,
      reason: parsed.data.reason ?? "",
      stamp: now.toISOString(),
    });
    const bodyHash = createHash("sha256").update(renderedBody).digest("hex");
    await tx.insert(atelierContractVersion).values({
      id: rid("cv"),
      contractId: existing.id,
      version: (latestVer?.v ?? 0) + 1,
      renderedBody,
      bodyHash,
      snapshotReason: parsed.data.to,
      createdAt: now,
      createdByUserId: me.id,
    });
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "contract-not-found" });
    } else if (result.error === "illegal-transition") {
      res.status(409).json({
        error: "illegal-transition",
        message: `Cannot transition contract from ${result.from} to ${result.to}.`,
        allowed: CONTRACT_TRANSITIONS[result.from] ?? [],
      });
    } else if (result.error === "countersign-required") {
      res.status(409).json({
        error: "countersign-required",
        message:
          "Two-partner countersign must be both_signed before external dispatch.",
      });
    }
    return;
  }
  await audit(
    "contract",
    result.row.id,
    me,
    "contract.transition",
    { to: parsed.data.to, reason: parsed.data.reason ?? "" },
    `${me.name} moved contract ${result.row.title} → ${parsed.data.to}`,
  );
  res.json(maskContractValue(result.row, me.role));
});

// ===============================================================
// CONTRACT PARTIES
// ===============================================================

router.post("/codex/contracts/:id/parties", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteCodex(me.role)) {
    res.status(403).json({ error: "codex-write-requires-finance-or-partner" });
    return;
  }
  const parsed = ContractPartyAddBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [contract] = await tx
      .select()
      .from(atelierContract)
      .where(
        and(eq(atelierContract.id, req.params.id), isNull(atelierContract.deletedAt)),
      );
    if (!contract) return { error: "not-found" as const };
    const id = rid("cp");
    const now = new Date();
    const [row] = await tx
      .insert(atelierContractParty)
      .values({
        id,
        contractId: contract.id,
        counterpartyId: parsed.data.counterpartyId ?? null,
        internalUserId: parsed.data.internalUserId ?? null,
        roleOnContract: parsed.data.roleOnContract,
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail,
        signerTitle: parsed.data.signerTitle ?? "",
        signMethod: parsed.data.signMethod ?? "docusign",
        signState: "pending",
        createdByUserId: me.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { row };
  });
  if ("error" in result) {
    res.status(404).json({ error: "contract-not-found" });
    return;
  }
  await audit(
    "contract",
    result.row.contractId,
    me,
    "contract.party.add",
    {
      partyId: result.row.id,
      role: result.row.roleOnContract,
      email: result.row.signerEmail,
    },
    `${me.name} added ${result.row.roleOnContract} ${result.row.signerName} to contract`,
  );
  res.status(201).json(result.row);
});

// ===============================================================
// TWO-PARTNER COUNTERSIGN (per v4 Resolution 6)
// ===============================================================
//
// First call (by partner A): creates the countersign row with
// `partnerBUserId` = body.partnerBUserId, partnerAUserId = me.id,
// partnerASignedAt = now, state = partner_a_signed.
// Second call (by partner B, must be different user): sets
// partnerBSignedAt + state = both_signed and auto-transitions the
// contract: draft|internal_review → two_partner_countersigned.
//
// Both signers MUST be leadership (partner | founding_partner).
//
router.post("/codex/contracts/:id/countersign", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me.role)) {
    res.status(403).json({
      error: "countersign-requires-partner",
      message: "Two-partner countersign requires founding_partner or partner.",
    });
    return;
  }
  const parsed = CountersignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [contract] = await tx
      .select()
      .from(atelierContract)
      .where(
        and(eq(atelierContract.id, req.params.id), isNull(atelierContract.deletedAt)),
      );
    if (!contract) return { error: "not-found" as const };
    if (
      contract.status !== "draft" &&
      contract.status !== "internal_review"
    ) {
      return {
        error: "wrong-state" as const,
        status: contract.status,
      };
    }
    const [existing] = await tx
      .select()
      .from(atelierTwoPartnerCountersign)
      .where(eq(atelierTwoPartnerCountersign.contractId, contract.id));
    const now = new Date();
    if (!existing) {
      // First signer.
      if (!parsed.data.partnerBUserId) {
        return { error: "partner-b-required" as const };
      }
      if (parsed.data.partnerBUserId === me.id) {
        return { error: "same-partner" as const };
      }
      const [row] = await tx
        .insert(atelierTwoPartnerCountersign)
        .values({
          id: rid("cs"),
          contractId: contract.id,
          partnerAUserId: me.id,
          partnerBUserId: parsed.data.partnerBUserId,
          partnerASignedAt: now,
          state: "partner_a_signed",
          rationaleText: parsed.data.rationaleText ?? "",
          createdByUserId: me.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return { phase: "partner_a" as const, countersign: row, contract };
    }
    // Second signer.
    if (existing.state === "both_signed") {
      return { error: "already-signed" as const };
    }
    if (existing.state === "declined") {
      return { error: "declined" as const };
    }
    if (me.id !== existing.partnerBUserId) {
      return { error: "not-designated-partner-b" as const };
    }
    if (me.id === existing.partnerAUserId) {
      return { error: "same-partner" as const };
    }
    const [updatedCs] = await tx
      .update(atelierTwoPartnerCountersign)
      .set({
        partnerBSignedAt: now,
        state: "both_signed",
        rationaleText:
          parsed.data.rationaleText ?? existing.rationaleText ?? "",
        updatedAt: now,
      })
      .where(eq(atelierTwoPartnerCountersign.id, existing.id))
      .returning();
    // Auto-transition the contract.
    const [updatedContract] = await tx
      .update(atelierContract)
      .set({
        status: "two_partner_countersigned",
        updatedAt: now,
      })
      .where(eq(atelierContract.id, contract.id))
      .returning();
    // Snapshot a version row for the auto-transition.
    const [latestVer] = await tx
      .select({ v: atelierContractVersion.version })
      .from(atelierContractVersion)
      .where(eq(atelierContractVersion.contractId, contract.id))
      .orderBy(desc(atelierContractVersion.version))
      .limit(1);
    const renderedBody = JSON.stringify({
      contract: updatedContract,
      countersign: updatedCs,
      stamp: now.toISOString(),
    });
    const bodyHash = createHash("sha256").update(renderedBody).digest("hex");
    await tx.insert(atelierContractVersion).values({
      id: rid("cv"),
      contractId: contract.id,
      version: (latestVer?.v ?? 0) + 1,
      renderedBody,
      bodyHash,
      snapshotReason: "two_partner_countersigned",
      createdAt: now,
      createdByUserId: me.id,
    });
    return {
      phase: "both" as const,
      countersign: updatedCs,
      contract: updatedContract,
    };
  });
  if ("error" in result) {
    const map: Record<string, [number, string]> = {
      "not-found": [404, "contract-not-found"],
      "wrong-state": [409, "countersign-only-from-draft-or-internal-review"],
      "partner-b-required": [400, "partner-b-required-on-first-call"],
      "same-partner": [400, "two-partner-countersign-requires-distinct-partners"],
      "already-signed": [409, "countersign-already-both-signed"],
      "declined": [409, "countersign-declined"],
      "not-designated-partner-b": [403, "not-the-designated-partner-b"],
    };
    const entry = map[String(result.error)] ?? [500, "countersign-error"];
    res.status(entry[0]).json({ error: entry[1], detail: result });
    return;
  }
  await audit(
    "contract",
    result.contract.id,
    me,
    result.phase === "partner_a"
      ? "contract.countersign.partner_a"
      : "contract.countersign.both_signed",
    {
      countersignId: result.countersign.id,
      state: result.countersign.state,
    },
    result.phase === "partner_a"
      ? `${me.name} signed as partner A on contract ${result.contract.title}`
      : `${me.name} co-signed contract ${result.contract.title} (both signed → two_partner_countersigned)`,
  );
  res.json({
    countersign: result.countersign,
    contract: maskContractValue(result.contract as ContractRow, me.role),
  });
});

// ---------------------------------------------------------------
// Renewal Watchdog — daemon endpoint
// ---------------------------------------------------------------
// Triggered by the daily scheduler (or by a partner ad-hoc) to walk
// every active contract + DPA and emit a partner-facing briefing of
// items in the renewal window. Read-only on the data tables; the
// agent run itself is logged via the standard atelier_agent_runs path.
//
// Default windows: contracts 90d, DPAs 60d. Caller can override via
// query params for ad-hoc sweeps.

router.post("/renewal-watchdog/run", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadCodex(me.role)) {
    res.status(403).json({ error: "codex-read-denied" });
    return;
  }
  const contractDays = Math.max(
    1,
    Math.min(365, Number(req.query.contractDays ?? 90)),
  );
  const dpaDays = Math.max(
    1,
    Math.min(365, Number(req.query.dpaDays ?? 60)),
  );
  const { runRenewalWatchdog } = await import(
    "../../lib/atelier-agents/runner.js"
  );
  const { activeContracts, activeDpas } = await withRls(req, async (tx) => {
    const contracts = await tx
      .select({
        id: atelierContract.id,
        title: atelierContract.title,
        instrumentType: atelierContract.instrumentType,
        status: atelierContract.status,
        termEnd: atelierContract.termEnd,
        currency: atelierContract.currency,
        contractValueUsd: atelierContract.contractValueUsd,
        counterpartyId: atelierContract.counterpartyId,
      })
      .from(atelierContract)
      .where(
        and(
          isNull(atelierContract.deletedAt),
          sql`${atelierContract.status} IN ('active','expiring')`,
        ),
      );
    const dpas = await tx
      .select({
        id: atelierDpa.id,
        status: atelierDpa.status,
        expiresAt: atelierDpa.expiresAt,
        counterpartyId: atelierDpa.counterpartyId,
        engagementId: atelierDpa.engagementId,
      })
      .from(atelierDpa)
      .where(
        and(
          isNull(atelierDpa.deletedAt),
          sql`${atelierDpa.status} IN ('signed','active','reviewed')`,
        ),
      );
    const cpIds = Array.from(
      new Set(
        [
          ...contracts.map((c) => c.counterpartyId),
          ...dpas.map((d) => d.counterpartyId),
        ].filter(Boolean) as string[],
      ),
    );
    const cps =
      cpIds.length === 0
        ? []
        : await tx
            .select({
              id: atelierCounterparty.id,
              legalName: atelierCounterparty.legalName,
            })
            .from(atelierCounterparty)
            .where(sql`${atelierCounterparty.id} = ANY(${cpIds})`);
    const cpName = new Map<string, string>(cps.map((r) => [r.id, r.legalName]));
    return {
      activeContracts: contracts.map((c) => ({
        id: c.id,
        title: c.title,
        instrumentType: c.instrumentType,
        status: c.status,
        termEnd: c.termEnd,
        currency: c.currency,
        contractValueUsd: c.contractValueUsd,
        counterpartyLegalName: cpName.get(c.counterpartyId) ?? "Unknown",
      })),
      activeDpas: dpas.map((d) => ({
        id: d.id,
        status: d.status,
        expiresAt: d.expiresAt
          ? d.expiresAt instanceof Date
            ? d.expiresAt.toISOString()
            : String(d.expiresAt)
          : null,
        counterpartyLegalName: cpName.get(d.counterpartyId) ?? "Unknown",
        engagementId: d.engagementId,
      })),
    };
  });
  const { runId, output, costUsd } = await runRenewalWatchdog({
    now: new Date().toISOString(),
    warningWindows: { contractDays, dpaDays },
    activeContracts,
    activeDpas,
    triggeredByUserId: me.id,
    actorLabel: me.name,
  });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "agent_run",
    entityId: runId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "renewal_watchdog_swept",
    payload: {
      contractsChecked: activeContracts.length,
      dpasChecked: activeDpas.length,
      flagged:
        output.contractRecommendations.length + output.dpaRecommendations.length,
    },
    payloadSummary: `Renewal Watchdog: ${output.contractRecommendations.length} contract(s) + ${output.dpaRecommendations.length} DPA(s) flagged.`,
  });
  res.json({ runId, costUsd, output });
});

export default router;
