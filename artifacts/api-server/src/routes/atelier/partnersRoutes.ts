/**
 * Atelier — Partners lens routes (Task #513).
 *
 * One canonical partner-firm registry (`atelier_partner_firms`) backs both
 * the roster staffing flows and this lens. Real CRUD for firms, target
 * partners, joint pipeline (CRM-linked co-sell), certifications and
 * conflicts. Govern reads real e-sign contracts (partner_firm
 * counterparties); Co-deliver reads real partner-firm-resource assignments
 * + self-billing (RCTI) invoices.
 *
 * Access: the central gate in routes/atelier/index.ts already restricts
 * every /partners and /alliances path to `canAccessPartnersLens` roles.
 * Writes are additionally gated per-route on `canEditPartnersLens`
 * (leadership + senior_manager + finance) as defense-in-depth.
 *
 * All writes are org-scoped and audited via the shared audit() helper.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  db,
  atelierUsers,
  atelierPartnerFirms,
  atelierPartnerFirmResources,
  atelierPartnerTargets,
  atelierAllianceJointPipeline,
  atelierAllianceCertifications,
  atelierAllianceConflicts,
  atelierOpportunities,
  atelierAccounts,
  atelierEmployees,
  atelierCounterparty,
  atelierContract,
  atelierSelfBilledInvoices,
  atelierAuditEvents,
  atelierDealPricings,
} from "@workspace/db";
import { normalizeCostLines } from "../../lib/atelier-pricing-structures.js";
import {
  startBackgroundJob,
  reapStaleRunningJob,
  completeBackgroundJob,
  failBackgroundJob,
  getLatestJob,
} from "../../lib/background-jobs.js";
import { atelierAgentRuns } from "@workspace/db";
import { desc } from "drizzle-orm";
import { audit } from "./engagementRoutes";
import { canEditPartnersLens } from "./personaRoles";
import {
  runAllianceCartographerAndQueue,
  runAllianceMapperAndQueue,
} from "../../lib/atelier-agents/alliance-mapper-chain.js";
import {
  refreshPartnerFirmRag,
  removePartnerFirmRag,
} from "../../lib/atelier-cli/partner-capability-rag.js";
import {
  ALLIANCE_FIT_DIMENSIONS,
  computeFitTotals,
} from "../../lib/atelier-agents/alliance-cartographer.js";
import {
  agentRunIsFresh,
  agentRunRowIsStale,
  hasFreshRunningRun,
  INTERRUPTED_RUN_MESSAGE,
} from "../../lib/atelier-agents/run-staleness.js";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

/** Write gate — leadership / senior_manager / finance only. */
function ensureEditor(me: Me, res: Response): boolean {
  if (!canEditPartnersLens(me.role)) {
    res.status(403).json({
      error: "partners-edit-restricted",
      message: "Partner records may only be edited by leadership, senior managers or finance.",
    });
    return false;
  }
  return true;
}

function invalidBody(res: Response, err: z.ZodError): void {
  res.status(400).json({
    error: "invalid-body",
    issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

// -------------------------------------------------------------------
// PARTNER FIRMS — unified registry CRUD
// -------------------------------------------------------------------

const FIRM_TIERS = ["strategic", "preferred", "transactional"] as const;
const FIRM_STATUSES = [
  "active",
  "renewal_due",
  "paused",
  "offboarded",
  "terminated",
] as const;

const contactSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  role: z.string().max(200).nullish(),
  email: z.string().max(320).nullish(),
  // Task #538 — round-tripped by the UI; server stamps it on write.
  personId: z.string().max(80).nullish(),
});

const firmBaseSchema = z.object({
  name: z.string().min(1).max(300),
  kind: z.string().max(100).nullish(),
  speciality: z.string().max(500).nullish(),
  country: z.string().max(100).nullish(),
  countryCode: z.string().max(2).nullish(),
  tier: z.enum(FIRM_TIERS).nullish(),
  status: z.enum(FIRM_STATUSES).optional(),
  relationshipStrength: z.number().int().min(1).max(5).nullish(),
  anchorCognirise: z.string().max(200).nullish(),
  anchorPartner: z.string().max(200).nullish(),
  lastTouchAt: z.string().max(40).nullish(),
  capabilities: z.record(z.number().min(0).max(5)).optional(),
  contacts: z.array(contactSchema).max(50).optional(),
  contactName: z.string().max(200).nullish(),
  contactEmail: z.string().max(320).nullish(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).nullish(),
  defaultBillingCurrency: z.string().max(10).nullish(),
  notes: z.string().max(5000).nullish(),
  tierChangeReason: z.string().max(1000).nullish(),
  // Task #526 — Alliance Partner Evaluation Framework: human-editable fields.
  // Scorecard/DD/risks/phasing arrive ONLY via the agent proposal queue.
  archetype: z
    .enum([
      "reference_brand",
      "delivery_backbone",
      "platform_capability",
      "niche_subcontractor",
      "market_access_jv",
      "competitor_monitor",
    ])
    .nullish(),
  // Task #871 — two-dimensional stage model. Partnership stage:
  // consideration → exploration → agreed; agreement stage only applies
  // once agreed (server enforces the pairing).
  partnershipStage: z.enum(["consideration", "exploration", "agreed"]).optional(),
  agreementStage: z
    .enum(["preparing", "negotiating", "reviewing", "signing", "signed"])
    .nullish(),
  // Task #870 — duplicate-name guard: set true to create despite an existing
  // firm with the same (case-insensitive) name in this org.
  confirmDuplicate: z.boolean().optional(),
});

/**
 * Task #871 — keep the two stage dimensions consistent: an agreed firm
 * always carries an agreement stage (default "preparing"); a non-agreed
 * firm never does.
 */
function reconcileStages(
  partnershipStage: string,
  agreementStage: string | null | undefined,
): { partnershipStage: string; agreementStage: string | null } {
  if (partnershipStage === "agreed") {
    return { partnershipStage, agreementStage: agreementStage ?? "preparing" };
  }
  return { partnershipStage, agreementStage: null };
}

// Task #538 — contact-list writes back every entry with a person record.
import { writePersonFromFullName } from "../../lib/atelier-person-sync.js";

function normalizeContacts(
  contacts: z.infer<typeof contactSchema>[] | undefined,
): Array<{ id: string; name: string; role?: string | null; email?: string | null; personId?: string | null }> | undefined {
  if (!contacts) return undefined;
  return contacts.map((c) => ({
    id: c.id ?? rid("pfc"),
    name: c.name,
    role: c.role ?? null,
    email: c.email ?? null,
    personId: c.personId ?? null,
  }));
}

/**
 * Task #538 — every contact entry written to the jsonb list is backed by a
 * real person record and a promoted partner_firm_resource row (mirroring
 * the one-time migration). Entries that already carry a personId are left
 * alone; new/unstamped entries get a person parsed from the free-text name
 * plus a deterministic `pfr_pfc_<entryId>` resource row.
 */
type DbExec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function stampContactPersons(
  exec: DbExec,
  me: Me,
  firmId: string,
  contacts: NonNullable<ReturnType<typeof normalizeContacts>>,
): Promise<typeof contacts> {
  const out: typeof contacts = [];
  for (const entry of contacts) {
    if (entry.personId || !entry.name.trim()) {
      out.push(entry);
      continue;
    }
    const w = await writePersonFromFullName(exec, {
      orgId: me.orgId,
      fullName: entry.name,
      sourceKind: "partner_firm_contact",
      createdByUserId: me.id,
    });
    const rowId = `pfr_pfc_${entry.id}`;
    const [existing] = await exec
      .select({ id: atelierPartnerFirmResources.id })
      .from(atelierPartnerFirmResources)
      .where(and(eq(atelierPartnerFirmResources.id, rowId), eq(atelierPartnerFirmResources.orgId, me.orgId)));
    if (!existing) {
      await exec.insert(atelierPartnerFirmResources).values({
        id: rowId,
        orgId: me.orgId,
        partnerFirmId: firmId,
        fullName: entry.name.trim(),
        personId: w.personId,
        email: entry.email ?? null,
        role: entry.role ?? null,
        status: "active",
        notes: "Promoted from partner-firm contact list (Task #538).",
      });
    }
    out.push({ ...entry, personId: w.personId });
  }
  return out;
}

function firmScope(me: Me) {
  return and(
    eq(atelierPartnerFirms.orgId, me.orgId),
    isNull(atelierPartnerFirms.deletedAt),
  );
}

async function getFirm(me: Me, id: string) {
  const [row] = await db
    .select()
    .from(atelierPartnerFirms)
    .where(and(eq(atelierPartnerFirms.id, id), firmScope(me)));
  return row ?? null;
}

// Task #874 — payable bank details NEVER ride on general firm reads. The
// Partners lens is visible to roles far broader than finance/leadership, so
// every serialized firm row passes through this sanitizer; the only surface
// exposing (masked) bank data is the finance/leadership review queue at
// /partners/bank-changes.
function sanitizeFirmWire<T extends Record<string, unknown>>(
  f: T,
): Omit<T, "bankIban" | "bankSwift" | "bankName" | "bankCurrency"> & {
  bankDetailsOnFile: boolean;
} {
  const { bankIban, bankSwift, bankName, bankCurrency, ...rest } = f as Record<string, unknown>;
  void bankSwift;
  void bankName;
  void bankCurrency;
  return { ...(rest as Omit<T, "bankIban" | "bankSwift" | "bankName" | "bankCurrency">), bankDetailsOnFile: Boolean(bankIban) };
}

// List — includes live-resource counts so the directory shows staffing reality.
// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/firms", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db.select().from(atelierPartnerFirms).where(firmScope(me));
    const resources = await db
      .select({
        partnerFirmId: atelierPartnerFirmResources.partnerFirmId,
        status: atelierPartnerFirmResources.status,
      })
      .from(atelierPartnerFirmResources)
      .where(
        and(
          eq(atelierPartnerFirmResources.orgId, me.orgId),
          isNull(atelierPartnerFirmResources.deletedAt),
        ),
      );
    const activeByFirm = new Map<string, number>();
    for (const r of resources) {
      if (r.status !== "active") continue;
      activeByFirm.set(r.partnerFirmId, (activeByFirm.get(r.partnerFirmId) ?? 0) + 1);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      items: rows.map((f) => ({
        ...sanitizeFirmWire(f),
        activeResourceCount: activeByFirm.get(f.id) ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/firms/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    res.json(sanitizeFirmWire(firm));
  } catch (err) {
    next(err);
  }
});

// Deals whose pricing carries an alliance-partner-quote cost line linked to
// this firm (Task #665). Read-only projection over atelier_deal_pricings
// cost lines — surfaces quoted-vs-costed spend per deal on the partner page.
// @cli-skip: Task #665 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/firms/:id/quoted-deals", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const rows = await db
      .select({
        opportunityId: atelierDealPricings.opportunityId,
        costLines: atelierDealPricings.costLines,
        opportunityName: atelierOpportunities.name,
        salesStage: atelierOpportunities.salesStage,
        accountId: atelierOpportunities.accountId,
        accountName: atelierAccounts.name,
      })
      .from(atelierDealPricings)
      .innerJoin(
        atelierOpportunities,
        and(
          eq(atelierOpportunities.id, atelierDealPricings.opportunityId),
          eq(atelierOpportunities.orgId, me.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      )
      .leftJoin(atelierAccounts, eq(atelierAccounts.id, atelierOpportunities.accountId))
      .where(eq(atelierDealPricings.orgId, me.orgId));
    const items: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const lines = normalizeCostLines(r.costLines ?? []);
      for (const line of lines) {
        if (line.type !== "alliance_partner_quote") continue;
        if (line.partnerFirmId !== firm.id) continue;
        const quoted = line.quotedAmountUsd ?? null;
        items.push({
          opportunityId: r.opportunityId,
          opportunityName: r.opportunityName ?? null,
          accountId: r.accountId ?? null,
          accountName: r.accountName ?? null,
          salesStage: r.salesStage ?? null,
          lineLabel: line.label ?? null,
          quotedAmountUsd: quoted,
          costedAmountUsd: line.amountUsd,
          deltaUsd:
            quoted == null ? null : Math.round((line.amountUsd - quoted) * 100) / 100,
          passThrough: line.passThrough === true,
          recurrence: line.recurrence ?? "one_time",
        });
      }
    }
    items.sort((a, b) =>
      String(a.opportunityName ?? "").localeCompare(String(b.opportunityName ?? "")),
    );
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/firms", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const parsed = firmBaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    // Task #870 — org-scoped duplicate-name guard. A structured 409 lets the
    // UI warn and offer an explicit "create anyway" (confirmDuplicate: true).
    const trimmedName = b.name.trim();
    const [dupe] = await db
      .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
      .from(atelierPartnerFirms)
      .where(
        and(
          firmScope(me),
          sql`lower(${atelierPartnerFirms.name}) = ${trimmedName.toLowerCase()}`,
        ),
      );
    if (dupe && !b.confirmDuplicate) {
      res.status(409).json({
        error: "duplicate-partner-firm-name",
        message: `A partner firm named "${dupe.name}" already exists.`,
        existingId: dupe.id,
        existingName: dupe.name,
      });
      return;
    }
    const id = rid("pfrm");
    const now = new Date().toISOString();
    const tierHistory = b.tier
      ? [{ fromTier: null, toTier: b.tier, at: now, byUserId: me.id, reason: b.tierChangeReason ?? null }]
      : [];
    // Task #870 — all-or-nothing create: the firm row is inserted FIRST, then
    // contact person/resource stamping and the audit event, all in one
    // transaction so a failure anywhere leaves no orphaned records behind.
    const row = await db.transaction(async (tx) => {
      const normalized = normalizeContacts(b.contacts) ?? [];
      const [created] = await tx
        .insert(atelierPartnerFirms)
        .values({
          id,
          orgId: me.orgId,
          name: b.name,
          kind: b.kind ?? null,
          speciality: b.speciality ?? null,
          country: b.country ?? null,
          countryCode: b.countryCode ?? null,
          tier: b.tier ?? null,
          status: b.status ?? "active",
          relationshipStrength: b.relationshipStrength ?? null,
          anchorCognirise: b.anchorCognirise ?? null,
          anchorPartner: b.anchorPartner ?? null,
          lastTouchAt: b.lastTouchAt ?? null,
          capabilities: b.capabilities ?? {},
          contacts: normalized,
          contactName: b.contactName ?? null,
          contactEmail: b.contactEmail ?? null,
          defaultPaymentTermsDays: b.defaultPaymentTermsDays ?? null,
          defaultBillingCurrency: b.defaultBillingCurrency ?? null,
          notes: b.notes ?? null,
          archetype: b.archetype ?? null,
          // Task #871 — two-dimensional stage model (agreed ⇔ agreementStage).
          ...reconcileStages(b.partnershipStage ?? "consideration", b.agreementStage),
          tierHistory,
          createdByUserId: me.id,
        })
        .returning();
      let out = created;
      if (normalized.length > 0) {
        const stamped = await stampContactPersons(tx, me, id, normalized);
        if (JSON.stringify(stamped) !== JSON.stringify(normalized)) {
          const [updated] = await tx
            .update(atelierPartnerFirms)
            .set({ contacts: stamped })
            .where(eq(atelierPartnerFirms.id, id))
            .returning();
          out = updated;
        }
      }
      await tx.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "partner_firm",
        entityId: id,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "partner_firm.create",
        payload: { name: b.name, tier: b.tier ?? null },
        payloadSummary: `Created partner firm "${b.name}"`,
      });
      return out;
    });
    // Task #871 — every new partner firm gets (a) an entity embedding so
    // Riser can resolve it immediately and (b) a fire-and-forget capability
    // research run (Alliance Cartographer, which now also proposes the
    // capability profile). Neither can fail the create.
    void refreshPartnerFirmRag(id);
    if (!(await alreadyRunningInDb("alliance_cartographer", id))) {
      await launchAllianceAgent({
        agentId: "alliance_cartographer",
        firmId: id,
        firmName: b.name,
        orgId: me.orgId,
        userId: me.id,
        run: () => runAllianceCartographerAndQueue(id, me.id, { chainMapper: true }),
      });
    }
    res.status(201).json(sanitizeFirmWire(row));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.patch("/partners/firms/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const parsed = firmBaseSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const assign = (key: keyof typeof b, col: string) => {
      if (b[key] === undefined) return;
      const from = (firm as Record<string, unknown>)[col];
      const to = b[key] ?? null;
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      patch[col] = to;
      changes[col] = { from, to };
    };
    assign("name", "name");
    assign("kind", "kind");
    assign("speciality", "speciality");
    assign("country", "country");
    assign("countryCode", "countryCode");
    assign("status", "status");
    assign("relationshipStrength", "relationshipStrength");
    assign("anchorCognirise", "anchorCognirise");
    assign("anchorPartner", "anchorPartner");
    assign("lastTouchAt", "lastTouchAt");
    assign("capabilities", "capabilities");
    assign("contactName", "contactName");
    assign("contactEmail", "contactEmail");
    assign("defaultPaymentTermsDays", "defaultPaymentTermsDays");
    assign("defaultBillingCurrency", "defaultBillingCurrency");
    assign("notes", "notes");
    assign("archetype", "archetype");
    // Task #871 — the two stage dimensions patch together so they can
    // never drift apart (agreed ⇒ agreement stage set; else ⇒ null).
    if (b.partnershipStage !== undefined || b.agreementStage !== undefined) {
      const next = reconcileStages(
        b.partnershipStage ?? firm.partnershipStage,
        b.agreementStage !== undefined ? b.agreementStage : firm.agreementStage,
      );
      if (next.partnershipStage !== firm.partnershipStage) {
        patch.partnershipStage = next.partnershipStage;
        changes.partnershipStage = { from: firm.partnershipStage, to: next.partnershipStage };
      }
      if (next.agreementStage !== (firm.agreementStage ?? null)) {
        patch.agreementStage = next.agreementStage;
        changes.agreementStage = { from: firm.agreementStage ?? null, to: next.agreementStage };
      }
    }
    if (b.contacts !== undefined) {
      const to = await stampContactPersons(db, me, firm.id, normalizeContacts(b.contacts) ?? []);
      patch.contacts = to;
      changes.contacts = { from: firm.contacts, to };
    }
    // Tier changes append to tierHistory (Renew lifecycle, Task #513).
    if (b.tier !== undefined && (b.tier ?? null) !== firm.tier) {
      patch.tier = b.tier ?? null;
      changes.tier = { from: firm.tier, to: b.tier ?? null };
      if (b.tier) {
        patch.tierHistory = [
          ...(firm.tierHistory ?? []),
          {
            fromTier: firm.tier,
            toTier: b.tier,
            at: new Date().toISOString(),
            byUserId: me.id,
            reason: b.tierChangeReason ?? null,
          },
        ];
      }
    }
    if (Object.keys(changes).length === 0) {
      res.json(sanitizeFirmWire(firm));
      return;
    }
    const [row] = await db
      .update(atelierPartnerFirms)
      .set(patch)
      .where(and(eq(atelierPartnerFirms.id, firm.id), firmScope(me)))
      .returning();
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.update",
      payload: { changes },
      summary: `Updated partner firm "${firm.name}" (${Object.keys(changes).join(", ")})`,
    });
    // Task #871 — keep Riser's partner retrieval fresh on firmographic edits.
    if (["name", "speciality", "capabilities"].some((k) => k in changes)) {
      void refreshPartnerFirmRag(firm.id);
    }
    res.json(sanitizeFirmWire(row));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/firms/:id/archive", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    // Guard: firms with live secondee resources cannot be archived.
    const live = await db
      .select({ id: atelierPartnerFirmResources.id })
      .from(atelierPartnerFirmResources)
      .where(
        and(
          eq(atelierPartnerFirmResources.orgId, me.orgId),
          eq(atelierPartnerFirmResources.partnerFirmId, firm.id),
          eq(atelierPartnerFirmResources.status, "active"),
          isNull(atelierPartnerFirmResources.deletedAt),
        ),
      );
    if (live.length > 0) {
      res.status(409).json({
        error: "partner-firm-has-active-resources",
        count: live.length,
        message: "Offboard or end the firm's active resources before archiving.",
      });
      return;
    }
    await db
      .update(atelierPartnerFirms)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierPartnerFirms.id, firm.id), firmScope(me)));
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.archive",
      payload: { name: firm.name },
      summary: `Archived partner firm "${firm.name}"`,
    });
    // Task #871 — an archived partner must never surface in retrieval.
    void removePartnerFirmRag(me.orgId, firm.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// FIT-SCORECARD — manual dimension adjustment (Task #530)
// -------------------------------------------------------------------
//
// Lets an authorized editor override individual framework-dimension scores
// on an existing Cartographer-produced scorecard. The server recomputes
// weightedTotal / verdict / watchouts with the SAME shared computation the
// Cartographer uses (computeFitTotals) and stamps who adjusted which
// dimension and when, so manual scores stay distinguishable from
// agent-produced ones.

const fitAdjustSchema = z.object({
  scores: z
    .record(z.number().int().min(1).max(5))
    .refine((m) => Object.keys(m).length > 0, "at least one dimension score is required"),
});

// @cli-skip: Task #530 REST surface behind the Partners Qualify UI
router.patch("/partners/firms/:id/fit-scorecard", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const parsed = fitAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const validIds = new Set(ALLIANCE_FIT_DIMENSIONS.map((d) => d.id));
    const unknown = Object.keys(parsed.data.scores).filter((k) => !validIds.has(k));
    if (unknown.length > 0) {
      return void res.status(400).json({
        error: "unknown-dimension",
        message: `Unknown fit dimension(s): ${unknown.join(", ")}`,
      });
    }
    const result = await db.transaction(async (tx) => {
      const [firm] = await tx
        .select()
        .from(atelierPartnerFirms)
        .where(and(eq(atelierPartnerFirms.id, req.params.id), firmScope(me)))
        .for("update");
      if (!firm) return { code: 404 as const };
      const sc = firm.fitScorecard;
      if (!sc || !Array.isArray(sc.dimensions) || sc.dimensions.length === 0) {
        return { code: 409 as const };
      }
      const now = new Date().toISOString();
      const changes: Record<string, { from: number; to: number }> = {};
      const dimensions = sc.dimensions.map((d) => {
        const to = parsed.data.scores[d.id];
        if (to == null || to === d.score) return d;
        changes[d.id] = { from: d.score, to };
        return { ...d, score: to, adjustedByUserId: me.id, adjustedAt: now };
      });
      if (Object.keys(changes).length === 0) {
        return { code: 200 as const, firm, noop: true };
      }
      const { weightedTotal, verdict, watchouts } = computeFitTotals(dimensions);
      const fitScorecard: typeof sc = {
        ...sc,
        dimensions,
        weightedTotal,
        verdict,
        watchouts,
        adjustedAt: now,
        adjustedByUserId: me.id,
      };
      const [row] = await tx
        .update(atelierPartnerFirms)
        .set({ fitScorecard, updatedAt: new Date() })
        .where(eq(atelierPartnerFirms.id, firm.id))
        .returning();
      return { code: 200 as const, firm: row, changes, weightedTotal, verdict };
    });
    if (result.code === 404) {
      return void res.status(404).json({ error: "partner-firm-not-found" });
    }
    if (result.code === 409) {
      return void res.status(409).json({
        error: "no-fit-scorecard",
        message:
          "This partner has no fit scorecard yet — run the Alliance Cartographer evaluation first.",
      });
    }
    if (!("noop" in result && result.noop)) {
      await audit({
        entityType: "partner_firm",
        entityId: req.params.id,
        actor: me,
        action: "partner_firm.fitScorecard.adjust",
        payload: {
          changes: result.changes,
          weightedTotal: result.weightedTotal,
          verdict: result.verdict,
        },
        summary: `${me.name} adjusted fit-scorecard dimension(s) ${Object.keys(result.changes ?? {}).join(", ")} on "${result.firm?.name}".`,
      });
    }
    res.json(result.firm);
  } catch (err) {
    next(err);
  }
});

// Recent manual fit-scorecard adjustments for one firm, reconstructed at
// read time from the audit trail (same pattern as the account
// firmographic-history feed): each `partner_firm.fitScorecard.adjust`
// event carries a `changes` map of { dimensionId: { from, to } }, so the
// history is a flat, newest-first projection of those rows. No separate
// history table. Reverting re-uses the adjust PATCH with the recorded
// `from` value, so the revert is itself audited as another adjust event.
// @cli-skip: Task #541 REST surface behind the Partners Qualify UI
router.get("/partners/firms/:id/fit-scorecard/history", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(and(eq(atelierPartnerFirms.id, req.params.id), firmScope(me)));
    if (!firm) return void res.status(404).json({ error: "partner-firm-not-found" });
    const events = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "partner_firm"),
          eq(atelierAuditEvents.entityId, firm.id),
          eq(atelierAuditEvents.action, "partner_firm.fitScorecard.adjust"),
        ),
      )
      .orderBy(desc(atelierAuditEvents.createdAt))
      .limit(50);
    const labels = new Map(ALLIANCE_FIT_DIMENSIONS.map((d) => [d.id, d.label]));
    const items: Array<{
      id: string;
      dimensionId: string;
      label: string;
      actorLabel: string;
      at: string;
      from: number;
      to: number;
    }> = [];
    for (const e of events) {
      const changes = (e.payload as { changes?: unknown } | null)?.changes;
      if (!changes || typeof changes !== "object") continue;
      for (const [dimId, ch] of Object.entries(
        changes as Record<string, { from?: unknown; to?: unknown }>,
      )) {
        if (typeof ch?.from !== "number" || typeof ch?.to !== "number") continue;
        items.push({
          id: `${e.id}:${dimId}`,
          dimensionId: dimId,
          label: labels.get(dimId) ?? dimId,
          actorLabel: e.actorLabel ?? "",
          at: new Date(e.createdAt).toISOString(),
          from: ch.from,
          to: ch.to,
        });
      }
    }
    res.json({ items: items.slice(0, 40) });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// TARGET PARTNERS — Identify pipeline CRUD + promote
// -------------------------------------------------------------------

const TARGET_STATUSES = [
  "researching",
  "outreach",
  "intro_call",
  "evaluating",
  "promoted",
  "dropped",
] as const;

const targetBaseSchema = z.object({
  name: z.string().min(1).max(300),
  ecosystem: z.string().max(200).nullish(),
  country: z.string().max(100).nullish(),
  thesis: z.string().max(2000).nullish(),
  tierHypothesis: z.enum(FIRM_TIERS).nullish(),
  priority: z.enum(["high", "med", "low"]).optional(),
  status: z.enum(TARGET_STATUSES).optional(),
  ownerUserId: z.string().max(100).nullish(),
  nextStep: z.string().max(1000).nullish(),
  lastContactAt: z.string().max(40).nullish(),
});

function targetScope(me: Me) {
  return and(
    eq(atelierPartnerTargets.orgId, me.orgId),
    isNull(atelierPartnerTargets.deletedAt),
  );
}

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/targets", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db.select().from(atelierPartnerTargets).where(targetScope(me));
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/targets", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const parsed = targetBaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    const id = rid("ptgt");
    const [row] = await db
      .insert(atelierPartnerTargets)
      .values({
        id,
        orgId: me.orgId,
        name: b.name,
        ecosystem: b.ecosystem ?? null,
        country: b.country ?? null,
        thesis: b.thesis ?? "",
        tierHypothesis: b.tierHypothesis ?? null,
        priority: b.priority ?? "med",
        status: b.status ?? "researching",
        ownerUserId: b.ownerUserId ?? me.id,
        nextStep: b.nextStep ?? null,
        lastContactAt: b.lastContactAt ?? null,
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      entityType: "partner_target",
      entityId: id,
      actor: me,
      action: "partner_target.create",
      payload: { name: b.name },
      summary: `Added target partner "${b.name}"`,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.patch("/partners/targets/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [target] = await db
      .select()
      .from(atelierPartnerTargets)
      .where(and(eq(atelierPartnerTargets.id, req.params.id), targetScope(me)));
    if (!target) {
      res.status(404).json({ error: "partner-target-not-found" });
      return;
    }
    const parsed = targetBaseSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) patch[k] = v ?? null;
    }
    const [row] = await db
      .update(atelierPartnerTargets)
      .set(patch)
      .where(and(eq(atelierPartnerTargets.id, target.id), targetScope(me)))
      .returning();
    await audit({
      entityType: "partner_target",
      entityId: target.id,
      actor: me,
      action: "partner_target.update",
      payload: { patch: b },
      summary: `Updated target partner "${target.name}"`,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/targets/:id/archive", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [target] = await db
      .select()
      .from(atelierPartnerTargets)
      .where(and(eq(atelierPartnerTargets.id, req.params.id), targetScope(me)));
    if (!target) {
      res.status(404).json({ error: "partner-target-not-found" });
      return;
    }
    await db
      .update(atelierPartnerTargets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierPartnerTargets.id, target.id), targetScope(me)));
    await audit({
      entityType: "partner_target",
      entityId: target.id,
      actor: me,
      action: "partner_target.archive",
      payload: { name: target.name },
      summary: `Archived target partner "${target.name}"`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Promote a target into the registry — creates a partner firm carrying
// over the identify fields, marks the target promoted + linked.
// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/targets/:id/promote", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [target] = await db
      .select()
      .from(atelierPartnerTargets)
      .where(and(eq(atelierPartnerTargets.id, req.params.id), targetScope(me)));
    if (!target) {
      res.status(404).json({ error: "partner-target-not-found" });
      return;
    }
    if (target.status === "promoted" && target.promotedFirmId) {
      const existing = await getFirm(me, target.promotedFirmId);
      if (existing) {
        res.json({ alreadyPromoted: true, firm: existing, target });
        return;
      }
    }
    const firmId = rid("pfrm");
    const now = new Date().toISOString();
    const [firm] = await db
      .insert(atelierPartnerFirms)
      .values({
        id: firmId,
        orgId: me.orgId,
        name: target.name,
        kind: target.ecosystem ?? null,
        country: target.country ?? null,
        speciality: target.thesis || null,
        tier: target.tierHypothesis ?? null,
        tierHistory: target.tierHypothesis
          ? [{ fromTier: null, toTier: target.tierHypothesis, at: now, byUserId: me.id, reason: "Promoted from target pipeline" }]
          : [],
        status: "active",
        createdByUserId: me.id,
      })
      .returning();
    const [updatedTarget] = await db
      .update(atelierPartnerTargets)
      .set({ status: "promoted", promotedFirmId: firmId, updatedAt: new Date() })
      .where(and(eq(atelierPartnerTargets.id, target.id), targetScope(me)))
      .returning();
    await audit({
      entityType: "partner_firm",
      entityId: firmId,
      actor: me,
      action: "partner_firm.promote_from_target",
      payload: { targetId: target.id, name: target.name },
      summary: `Promoted target "${target.name}" to partner firm`,
    });
    // Task #871 — promoted firms get the same treatment as directly
    // created ones: entity embedding + capability research run.
    void refreshPartnerFirmRag(firmId);
    if (!(await alreadyRunningInDb("alliance_cartographer", firmId))) {
      await launchAllianceAgent({
        agentId: "alliance_cartographer",
        firmId,
        firmName: target.name,
        orgId: me.orgId,
        userId: me.id,
        run: () => runAllianceCartographerAndQueue(firmId, me.id, { chainMapper: true }),
      });
    }
    res.status(201).json({ firm: sanitizeFirmWire(firm), target: updatedTarget });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// JOINT PIPELINE — CRM-linked co-sell CRUD
// -------------------------------------------------------------------

const jointBaseSchema = z.object({
  opportunityId: z.string().min(1),
  partnerFirmId: z.string().min(1),
  leadParty: z.enum(["cognirise", "partner", "joint"]).optional(),
  cognirisePct: z.number().int().min(0).max(100).optional(),
  partnerPct: z.number().int().min(0).max(100).optional(),
  splitRationale: z.string().max(2000).optional(),
  allianceLetterStatus: z.enum(["none", "drafting", "signed"]).optional(),
  partnerSourced: z.boolean().optional(),
});

function jointScope(me: Me) {
  return and(
    eq(atelierAllianceJointPipeline.orgId, me.orgId),
    isNull(atelierAllianceJointPipeline.deletedAt),
  );
}

async function jointWire(me: Me, rows: (typeof atelierAllianceJointPipeline.$inferSelect)[]) {
  const oppIds = [...new Set(rows.map((r) => r.opportunityId))];
  const firmIds = [...new Set(rows.map((r) => r.partnerFirmId))];
  const opps = oppIds.length
    ? await db
        .select({
          id: atelierOpportunities.id,
          name: atelierOpportunities.name,
          accountId: atelierOpportunities.accountId,
          salesStage: atelierOpportunities.salesStage,
          dealSizeHypothesis: atelierOpportunities.dealSizeHypothesis,
        })
        .from(atelierOpportunities)
        .where(
          and(
            eq(atelierOpportunities.orgId, me.orgId),
            inArray(atelierOpportunities.id, oppIds),
            isNull(atelierOpportunities.deletedAt),
          ),
        )
    : [];
  const accountIds = [...new Set(opps.map((o) => o.accountId))];
  const accounts = accountIds.length
    ? await db
        .select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.orgId, me.orgId), inArray(atelierAccounts.id, accountIds)))
    : [];
  const firms = firmIds.length
    ? await db
        .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
        .from(atelierPartnerFirms)
        .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
    : [];
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const accById = new Map(accounts.map((a) => [a.id, a.name]));
  const firmById = new Map(firms.map((f) => [f.id, f.name]));
  return rows.map((r) => {
    const opp = oppById.get(r.opportunityId) ?? null;
    return {
      ...r,
      opportunityName: opp?.name ?? null,
      clientName: opp ? (accById.get(opp.accountId) ?? null) : null,
      salesStage: opp?.salesStage ?? null,
      dealSizeHypothesis: opp?.dealSizeHypothesis ?? null,
      partnerFirmName: firmById.get(r.partnerFirmId) ?? null,
    };
  });
}

// ?opportunityId= filters (used by the opportunity view's partner panel).
// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/joint-pipeline", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const oppId = typeof req.query.opportunityId === "string" ? req.query.opportunityId : null;
    const where = oppId
      ? and(jointScope(me), eq(atelierAllianceJointPipeline.opportunityId, oppId))
      : jointScope(me);
    const rows = await db.select().from(atelierAllianceJointPipeline).where(where);
    res.json({ items: await jointWire(me, rows) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/joint-pipeline", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const parsed = jointBaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    // FK validation — both must be live org-scoped records.
    const [opp] = await db
      .select({ id: atelierOpportunities.id, name: atelierOpportunities.name })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.id, b.opportunityId),
          eq(atelierOpportunities.orgId, me.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      );
    if (!opp) {
      res.status(422).json({ error: "opportunity-not-found" });
      return;
    }
    const firm = await getFirm(me, b.partnerFirmId);
    if (!firm) {
      res.status(422).json({ error: "partner-firm-not-found" });
      return;
    }
    if ((b.cognirisePct ?? 0) + (b.partnerPct ?? 0) > 100) {
      res.status(422).json({ error: "split-exceeds-100" });
      return;
    }
    // One entry per (opportunity, firm) pair.
    const [dup] = await db
      .select({ id: atelierAllianceJointPipeline.id })
      .from(atelierAllianceJointPipeline)
      .where(
        and(
          jointScope(me),
          eq(atelierAllianceJointPipeline.opportunityId, b.opportunityId),
          eq(atelierAllianceJointPipeline.partnerFirmId, b.partnerFirmId),
        ),
      );
    if (dup) {
      res.status(409).json({ error: "joint-pipeline-entry-exists", id: dup.id });
      return;
    }
    const id = rid("jpl");
    const [row] = await db
      .insert(atelierAllianceJointPipeline)
      .values({
        id,
        orgId: me.orgId,
        opportunityId: b.opportunityId,
        partnerFirmId: b.partnerFirmId,
        leadParty: b.leadParty ?? "cognirise",
        cognirisePct: b.cognirisePct ?? 0,
        partnerPct: b.partnerPct ?? 0,
        splitRationale: b.splitRationale ?? "",
        allianceLetterStatus: b.allianceLetterStatus ?? "none",
        partnerSourced: b.partnerSourced ?? false,
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      entityType: "joint_pipeline",
      entityId: id,
      actor: me,
      action: "joint_pipeline.create",
      payload: { opportunityId: b.opportunityId, partnerFirmId: b.partnerFirmId },
      summary: `Linked partner "${firm.name}" to opportunity "${opp.name}"`,
    });
    res.status(201).json((await jointWire(me, [row]))[0]);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.patch("/partners/joint-pipeline/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [entry] = await db
      .select()
      .from(atelierAllianceJointPipeline)
      .where(and(eq(atelierAllianceJointPipeline.id, req.params.id), jointScope(me)));
    if (!entry) {
      res.status(404).json({ error: "joint-pipeline-entry-not-found" });
      return;
    }
    const parsed = jointBaseSchema
      .partial()
      .omit({ opportunityId: true, partnerFirmId: true })
      .safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    const cn = b.cognirisePct ?? entry.cognirisePct;
    const pn = b.partnerPct ?? entry.partnerPct;
    if (cn + pn > 100) {
      res.status(422).json({ error: "split-exceeds-100" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) patch[k] = v;
    }
    const [row] = await db
      .update(atelierAllianceJointPipeline)
      .set(patch)
      .where(and(eq(atelierAllianceJointPipeline.id, entry.id), jointScope(me)))
      .returning();
    await audit({
      entityType: "joint_pipeline",
      entityId: entry.id,
      actor: me,
      action: "joint_pipeline.update",
      payload: { patch: b },
      summary: `Updated joint-pipeline entry ${entry.id}`,
    });
    res.json((await jointWire(me, [row]))[0]);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/joint-pipeline/:id/archive", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [entry] = await db
      .select()
      .from(atelierAllianceJointPipeline)
      .where(and(eq(atelierAllianceJointPipeline.id, req.params.id), jointScope(me)));
    if (!entry) {
      res.status(404).json({ error: "joint-pipeline-entry-not-found" });
      return;
    }
    await db
      .update(atelierAllianceJointPipeline)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierAllianceJointPipeline.id, entry.id), jointScope(me)));
    await audit({
      entityType: "joint_pipeline",
      entityId: entry.id,
      actor: me,
      action: "joint_pipeline.archive",
      payload: {},
      summary: `Archived joint-pipeline entry ${entry.id}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// CERTIFICATIONS — registry-linked CRUD
// -------------------------------------------------------------------

const certBaseSchema = z.object({
  partnerFirmId: z.string().min(1),
  credential: z.string().min(1).max(300),
  platform: z.string().min(1).max(200),
  holderPersonId: z.string().max(100).nullish(),
  holder: z.string().max(200).nullish(),
  status: z.enum(["active", "lapsing", "lapsed"]).optional(),
  expiresAt: z.string().max(40).nullish(),
});

function certScope(me: Me) {
  return and(
    eq(atelierAllianceCertifications.orgId, me.orgId),
    isNull(atelierAllianceCertifications.deletedAt),
  );
}

async function resolveHolderLabel(
  me: Me,
  holderPersonId: string | null | undefined,
  fallback: string | null | undefined,
): Promise<string> {
  if (holderPersonId) {
    const [emp] = await db
      .select({ fullName: atelierEmployees.fullName })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, holderPersonId), eq(atelierEmployees.orgId, me.orgId)));
    if (emp) return emp.fullName;
    const [pfr] = await db
      .select({ fullName: atelierPartnerFirmResources.fullName })
      .from(atelierPartnerFirmResources)
      .where(
        and(
          eq(atelierPartnerFirmResources.id, holderPersonId),
          eq(atelierPartnerFirmResources.orgId, me.orgId),
        ),
      );
    if (pfr) return pfr.fullName;
  }
  return fallback ?? "";
}

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/certifications", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db.select().from(atelierAllianceCertifications).where(certScope(me));
    const firmIds = [...new Set(rows.map((r) => r.partnerFirmId))];
    const firms = firmIds.length
      ? await db
          .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const firmById = new Map(firms.map((f) => [f.id, f.name]));
    res.json({
      items: rows.map((r) => ({ ...r, partnerFirmName: firmById.get(r.partnerFirmId) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/certifications", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const parsed = certBaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    const firm = await getFirm(me, b.partnerFirmId);
    if (!firm) {
      res.status(422).json({ error: "partner-firm-not-found" });
      return;
    }
    const holder = await resolveHolderLabel(me, b.holderPersonId, b.holder);
    const id = rid("cert");
    const [row] = await db
      .insert(atelierAllianceCertifications)
      .values({
        id,
        orgId: me.orgId,
        partnerFirmId: b.partnerFirmId,
        credential: b.credential,
        platform: b.platform,
        holderPersonId: b.holderPersonId ?? null,
        holder,
        status: b.status ?? "active",
        expiresAt: b.expiresAt ?? null,
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      entityType: "alliance_certification",
      entityId: id,
      actor: me,
      action: "alliance_certification.create",
      payload: { credential: b.credential, partnerFirmId: b.partnerFirmId },
      summary: `Added certification "${b.credential}" for ${firm.name}`,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.patch("/partners/certifications/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [cert] = await db
      .select()
      .from(atelierAllianceCertifications)
      .where(and(eq(atelierAllianceCertifications.id, req.params.id), certScope(me)));
    if (!cert) {
      res.status(404).json({ error: "certification-not-found" });
      return;
    }
    const parsed = certBaseSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    if (b.partnerFirmId && !(await getFirm(me, b.partnerFirmId))) {
      res.status(422).json({ error: "partner-firm-not-found" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) patch[k] = v ?? null;
    }
    if (b.holderPersonId !== undefined || b.holder !== undefined) {
      patch.holder = await resolveHolderLabel(
        me,
        b.holderPersonId !== undefined ? b.holderPersonId : cert.holderPersonId,
        b.holder !== undefined ? b.holder : cert.holder,
      );
    }
    const [row] = await db
      .update(atelierAllianceCertifications)
      .set(patch)
      .where(and(eq(atelierAllianceCertifications.id, cert.id), certScope(me)))
      .returning();
    await audit({
      entityType: "alliance_certification",
      entityId: cert.id,
      actor: me,
      action: "alliance_certification.update",
      payload: { patch: b },
      summary: `Updated certification "${cert.credential}"`,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/certifications/:id/archive", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [cert] = await db
      .select()
      .from(atelierAllianceCertifications)
      .where(and(eq(atelierAllianceCertifications.id, req.params.id), certScope(me)));
    if (!cert) {
      res.status(404).json({ error: "certification-not-found" });
      return;
    }
    await db
      .update(atelierAllianceCertifications)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierAllianceCertifications.id, cert.id), certScope(me)));
    await audit({
      entityType: "alliance_certification",
      entityId: cert.id,
      actor: me,
      action: "alliance_certification.archive",
      payload: { credential: cert.credential },
      summary: `Archived certification "${cert.credential}"`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// CONFLICTS — registry-linked CRUD (open/resolve lifecycle)
// -------------------------------------------------------------------

const conflictBaseSchema = z.object({
  partnerFirmId: z.string().min(1),
  headline: z.string().min(1).max(500),
  detectedAt: z.string().max(40).optional(),
  severity: z.enum(["high", "med", "low"]).optional(),
  detail: z.string().max(5000).optional(),
  recommendation: z.string().max(2000).optional(),
  status: z.enum(["open", "resolved"]).optional(),
});

function conflictScope(me: Me) {
  return and(
    eq(atelierAllianceConflicts.orgId, me.orgId),
    isNull(atelierAllianceConflicts.deletedAt),
  );
}

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/conflicts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db.select().from(atelierAllianceConflicts).where(conflictScope(me));
    const firmIds = [...new Set(rows.map((r) => r.partnerFirmId))];
    const firms = firmIds.length
      ? await db
          .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const firmById = new Map(firms.map((f) => [f.id, f.name]));
    res.json({
      items: rows.map((r) => ({ ...r, partnerFirmName: firmById.get(r.partnerFirmId) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/conflicts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const parsed = conflictBaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    const firm = await getFirm(me, b.partnerFirmId);
    if (!firm) {
      res.status(422).json({ error: "partner-firm-not-found" });
      return;
    }
    const id = rid("conf");
    const [row] = await db
      .insert(atelierAllianceConflicts)
      .values({
        id,
        orgId: me.orgId,
        partnerFirmId: b.partnerFirmId,
        headline: b.headline,
        detectedAt: b.detectedAt ?? new Date().toISOString().slice(0, 10),
        severity: b.severity ?? "med",
        detail: b.detail ?? "",
        recommendation: b.recommendation ?? "",
        status: b.status ?? "open",
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      entityType: "alliance_conflict",
      entityId: id,
      actor: me,
      action: "alliance_conflict.create",
      payload: { headline: b.headline, partnerFirmId: b.partnerFirmId },
      summary: `Logged conflict "${b.headline}" for ${firm.name}`,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.patch("/partners/conflicts/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [conf] = await db
      .select()
      .from(atelierAllianceConflicts)
      .where(and(eq(atelierAllianceConflicts.id, req.params.id), conflictScope(me)));
    if (!conf) {
      res.status(404).json({ error: "conflict-not-found" });
      return;
    }
    const parsed = conflictBaseSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return invalidBody(res, parsed.error);
    const b = parsed.data;
    if (b.partnerFirmId && !(await getFirm(me, b.partnerFirmId))) {
      res.status(422).json({ error: "partner-firm-not-found" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) patch[k] = v ?? null;
    }
    if (b.status === "resolved" && conf.status !== "resolved") {
      patch.resolvedAt = new Date().toISOString();
    }
    if (b.status === "open") {
      patch.resolvedAt = null;
    }
    const [row] = await db
      .update(atelierAllianceConflicts)
      .set(patch)
      .where(and(eq(atelierAllianceConflicts.id, conf.id), conflictScope(me)))
      .returning();
    await audit({
      entityType: "alliance_conflict",
      entityId: conf.id,
      actor: me,
      action: "alliance_conflict.update",
      payload: { patch: b },
      summary: `Updated conflict "${conf.headline}"`,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.post("/partners/conflicts/:id/archive", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const [conf] = await db
      .select()
      .from(atelierAllianceConflicts)
      .where(and(eq(atelierAllianceConflicts.id, req.params.id), conflictScope(me)));
    if (!conf) {
      res.status(404).json({ error: "conflict-not-found" });
      return;
    }
    await db
      .update(atelierAllianceConflicts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierAllianceConflicts.id, conf.id), conflictScope(me)));
    await audit({
      entityType: "alliance_conflict",
      entityId: conf.id,
      actor: me,
      action: "alliance_conflict.archive",
      payload: { headline: conf.headline },
      summary: `Archived conflict "${conf.headline}"`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// GOVERN — real e-sign agreements with partner-firm counterparties
// -------------------------------------------------------------------
// Read-only projection of the contract system filtered to partner_firm
// counterparties. NDA status in Qualify and framework agreements in
// Govern both derive from this — never a hand-toggled field.
// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
/**
 * Task #875 — shared agreement join, also consumed by the partner-portal
 * contracts tab (firm-scoped). Returns e-sign registry contracts with
 * partner-firm counterparties, each resolved to a partnerFirmId via the
 * deterministic normalized-name join (there is NO FK between contract
 * counterparties and the partner-firm registry — never name-match in UIs).
 */
export async function partnerAgreementItems(orgId: string): Promise<
  Array<{
    id: string;
    instrumentType: string;
    counterpartyId: string;
    title: string;
    status: string;
    governingLaw: string;
    termStart: string | null;
    termEnd: string | null;
    fullyExecutedAt: Date | null;
    counterpartyName: string | null;
    partnerFirmId: string | null;
  }>
> {
  const counterparties = await db
    .select({
      id: atelierCounterparty.id,
      legalName: atelierCounterparty.legalName,
      displayName: atelierCounterparty.displayName,
    })
    .from(atelierCounterparty)
    .where(
      and(
        eq(atelierCounterparty.orgId, orgId),
        eq(atelierCounterparty.kind, "partner_firm"),
        isNull(atelierCounterparty.deletedAt),
      ),
    );
  if (counterparties.length === 0) return [];
  const cpIds = counterparties.map((c) => c.id);
  const contracts = await db
    .select({
      id: atelierContract.id,
      instrumentType: atelierContract.instrumentType,
      counterpartyId: atelierContract.counterpartyId,
      title: atelierContract.title,
      status: atelierContract.status,
      governingLaw: atelierContract.governingLaw,
      termStart: atelierContract.termStart,
      termEnd: atelierContract.termEnd,
      fullyExecutedAt: atelierContract.fullyExecutedAt,
    })
    .from(atelierContract)
    .where(
      and(
        eq(atelierContract.orgId, orgId),
        inArray(atelierContract.counterpartyId, cpIds),
        isNull(atelierContract.deletedAt),
      ),
    );
  const cpById = new Map(counterparties.map((c) => [c.id, c]));
  // Deterministic counterparty→partner-firm linkage by normalized name.
  // There is no FK between contracts' counterparties and the partner-firm
  // registry, so we join on trimmed, case-folded names.
  const firms = await db
    .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
    .from(atelierPartnerFirms)
    .where(and(eq(atelierPartnerFirms.orgId, orgId), isNull(atelierPartnerFirms.deletedAt)));
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const firmByName = new Map(firms.map((f) => [norm(f.name), f.id]));
  const firmIdForCp = (cpId: string): string | null => {
    const cp = cpById.get(cpId);
    if (!cp) return null;
    return firmByName.get(norm(cp.displayName)) ?? firmByName.get(norm(cp.legalName)) ?? null;
  };
  return contracts.map((c) => ({
    ...c,
    counterpartyName:
      cpById.get(c.counterpartyId)?.displayName ??
      cpById.get(c.counterpartyId)?.legalName ??
      null,
    partnerFirmId: firmIdForCp(c.counterpartyId),
  }));
}

// @cli-skip: read-only partner-agreements listing for the Partners hub UI (raw fetch)
router.get("/partners/agreements", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    res.json({ items: await partnerAgreementItems(me.orgId) });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// CO-DELIVER — real resource assignments + RCTI cost lines
// -------------------------------------------------------------------
// @cli-skip: Task #513 REST surface; chat parity tracked in docs/PARTNERS_BACKLOG.md
router.get("/partners/co-deliver", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const resources = await db
      .select({
        id: atelierPartnerFirmResources.id,
        partnerFirmId: atelierPartnerFirmResources.partnerFirmId,
        fullName: atelierPartnerFirmResources.fullName,
        role: atelierPartnerFirmResources.role,
        seniority: atelierPartnerFirmResources.seniority,
        country: atelierPartnerFirmResources.country,
        startDate: atelierPartnerFirmResources.startDate,
        status: atelierPartnerFirmResources.status,
      })
      .from(atelierPartnerFirmResources)
      .where(
        and(
          eq(atelierPartnerFirmResources.orgId, me.orgId),
          isNull(atelierPartnerFirmResources.deletedAt),
        ),
      );
    const invoices = await db
      .select({
        id: atelierSelfBilledInvoices.id,
        invoiceNumber: atelierSelfBilledInvoices.invoiceNumber,
        supplierId: atelierSelfBilledInvoices.supplierId,
        supplierName: atelierSelfBilledInvoices.supplierName,
        weekIso: atelierSelfBilledInvoices.weekIso,
        currency: atelierSelfBilledInvoices.currency,
        totalAmount: atelierSelfBilledInvoices.totalAmount,
        totalUsd: atelierSelfBilledInvoices.totalUsd,
        status: atelierSelfBilledInvoices.status,
      })
      .from(atelierSelfBilledInvoices)
      .where(
        and(
          eq(atelierSelfBilledInvoices.orgId, me.orgId),
          eq(atelierSelfBilledInvoices.supplierType, "partner_firm"),
          isNull(atelierSelfBilledInvoices.deletedAt),
        ),
      );
    const firmIds = [
      ...new Set([...resources.map((r) => r.partnerFirmId), ...invoices.map((i) => i.supplierId)]),
    ];
    const firms = firmIds.length
      ? await db
          .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const firmById = new Map(firms.map((f) => [f.id, f.name]));
    res.json({
      resources: resources.map((r) => ({
        ...r,
        partnerFirmName: firmById.get(r.partnerFirmId) ?? null,
      })),
      invoices: invoices.map((i) => ({
        ...i,
        partnerFirmName: firmById.get(i.supplierId) ?? i.supplierName,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------
// ALLIANCE EVALUATION AGENTS (Task #526) — async start-then-poll
// -------------------------------------------------------------------
// Long LLM runs must NOT hold the HTTP request open (the proxy 502s held
// requests at ~60s). Record an in-process launch entry, run in the
// background, return 202 immediately; the client polls the status route.
// Bespoke raw-fetch routes — deliberately NOT in the OpenAPI spec.

// Task #1020 — launch state now lives in the durable background-job
// registry (atelier_background_jobs): survives restarts, shows in the
// global indicator, and notifies the starter on completion.
type AllianceLaunchState = {
  status: "running" | "succeeded" | "failed";
  error: string | null;
  runId: string | null;
  proposedCount: number | null;
  summary: Record<string, unknown> | null;
};
// Watchdog: a job stuck "running" past 30 minutes is dead (process kept
// going but the promise never settled) — treat as failed on read.
const LAUNCH_STALE_MS = 30 * 60 * 1000;

async function readLaunch(agentId: string, firmId: string, orgId?: string | null): Promise<AllianceLaunchState | null> {
  const job = await getLatestJob([agentId], firmId, orgId ?? undefined);
  if (!job) return null;
  if (job.status === "running" && Date.now() - job.createdAt.getTime() > LAUNCH_STALE_MS) {
    // Task #1046 — old start time alone is not death: a long run that is
    // still stamping progress on its durable run row is alive.
    if (await hasFreshRunningRun(agentId, firmId)) {
      return { status: "running", error: null, runId: null, proposedCount: null, summary: null };
    }
    return { status: "failed", error: "The run timed out — please retry.", runId: null, proposedCount: null, summary: null };
  }
  if (job.status === "running") {
    return { status: "running", error: null, runId: null, proposedCount: null, summary: null };
  }
  if (job.status === "failed") {
    return { status: "failed", error: job.error ?? "failed", runId: null, proposedCount: null, summary: null };
  }
  const r = (job.result ?? {}) as { runId?: string; proposedCount?: number; summary?: Record<string, unknown> };
  return {
    status: "succeeded",
    error: null,
    runId: r.runId ?? null,
    proposedCount: r.proposedCount ?? null,
    summary: r.summary ?? null,
  };
}

async function alreadyRunningInDb(agentId: string, firmId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: atelierAgentRuns.id })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, agentId),
        eq(atelierAgentRuns.targetId, firmId),
        eq(atelierAgentRuns.status, "running"),
        // Task #1046 — a stale "running" row (dead process) must not
        // block a relaunch forever.
        agentRunIsFresh(),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function launchAllianceAgent(args: {
  agentId: "alliance_cartographer" | "alliance_executive_mapper";
  firmId: string;
  firmName: string;
  orgId: string | null;
  userId: string;
  run: () => Promise<{ runId: string; proposedCount: number } & Record<string, unknown>>;
}): Promise<void> {
  const friendly =
    args.agentId === "alliance_cartographer" ? "Partner evaluation" : "Partner people sweep";
  // A stale "running" row (dead promise) would block the relaunch via the
  // running-unique index — fail it first (same 30-min watchdog as reads).
  // Task #1046 — but never reap a run whose durable heartbeat is still
  // fresh: a >30min run stamping progress is alive, not stuck.
  if (!(await hasFreshRunningRun(args.agentId, args.firmId))) {
    await reapStaleRunningJob([args.agentId], args.firmId, args.orgId, LAUNCH_STALE_MS);
  }
  const jobId = await startBackgroundJob({
    orgId: args.orgId,
    userId: args.userId,
    kind: args.agentId,
    targetType: "partner_firm",
    targetId: args.firmId,
    label: `${friendly} — "${args.firmName}"`,
    resultHref: "/partners/identify",
  });
  if (!jobId) return; // lost the atomic-start race — a run is already live
  void (async () => {
    try {
      const result = await args.run();
      const { runId, proposedCount, ...rest } = result;
      await completeBackgroundJob(jobId, {
        result: { runId, proposedCount, summary: rest },
        notifyTitle: `${friendly} finished — "${args.firmName}"`,
        notifyBody:
          proposedCount > 0
            ? `${proposedCount} proposed update${proposedCount === 1 ? "" : "s"} to review.`
            : "No new updates were proposed.",
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      await failBackgroundJob(jobId, raw, {
        notifyTitle: `${friendly} failed — "${args.firmName}"`,
      });
      console.warn(`[atelier] ${args.agentId} run failed for firm ${args.firmId}`, raw);
    }
  })();
}

// Launch the full framework evaluation (Cartographer → auto-chains Mapper).
// @cli-skip: long-running agent trigger behind the Partners Evaluation UI; raw-fetch 202/poll
router.post("/partners/firms/:id/agents/alliance-cartographer/run", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) return void res.status(404).json({ error: "not-found" });
    const launch = await readLaunch("alliance_cartographer", firm.id, me.orgId);
    if (launch?.status === "running" || (await alreadyRunningInDb("alliance_cartographer", firm.id))) {
      return void res.status(409).json({
        error: "alliance-cartographer-already-running",
        message: "A framework evaluation is already running for this partner.",
      });
    }
    const contextNotes =
      typeof req.body?.contextNotes === "string" ? req.body.contextNotes.slice(0, 2000) : null;
    await launchAllianceAgent({
      agentId: "alliance_cartographer",
      firmId: firm.id,
      firmName: firm.name,
      orgId: me.orgId,
      userId: me.id,
      run: () => runAllianceCartographerAndQueue(firm.id, me.id, { contextNotes }),
    });
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.agentRun.start",
      payload: { agentId: "alliance_cartographer" },
      summary: `${me.name} launched the Alliance Cartographer evaluation for "${firm.name}".`,
    });
    res.status(202).json({ started: true, status: "running" });
  } catch (err) {
    next(err);
  }
});

// Launch the people sweep on its own (normally auto-chained).
// @cli-skip: long-running agent trigger behind the Partners Evaluation UI; raw-fetch 202/poll
router.post("/partners/firms/:id/agents/alliance-mapper/run", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) return void res.status(404).json({ error: "not-found" });
    const launch = await readLaunch("alliance_executive_mapper", firm.id, me.orgId);
    if (
      launch?.status === "running" ||
      (await alreadyRunningInDb("alliance_executive_mapper", firm.id))
    ) {
      return void res.status(409).json({
        error: "alliance-mapper-already-running",
        message: "An alliance executive sweep is already running for this partner.",
      });
    }
    await launchAllianceAgent({
      agentId: "alliance_executive_mapper",
      firmId: firm.id,
      firmName: firm.name,
      orgId: me.orgId,
      userId: me.id,
      run: () => runAllianceMapperAndQueue(firm.id, me.id),
    });
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.agentRun.start",
      payload: { agentId: "alliance_executive_mapper" },
      summary: `${me.name} launched the Alliance Executive Mapper for "${firm.name}".`,
    });
    res.status(202).json({ started: true, status: "running" });
  } catch (err) {
    next(err);
  }
});

// Merged run status for both alliance agents (launch map + durable run rows).
// @cli-skip: bespoke agent-status poll route, surfaced in the Partners UI only
router.get("/partners/firms/:id/agents/status", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const firm = await getFirm(me, req.params.id);
    if (!firm) return void res.status(404).json({ error: "not-found" });
    const agents = ["alliance_cartographer", "alliance_executive_mapper"] as const;
    const out: Record<string, unknown> = {};
    for (const agentId of agents) {
      const launch = await readLaunch(agentId, firm.id, me.orgId);
      const [latestRaw] = await db
        .select({
          id: atelierAgentRuns.id,
          status: atelierAgentRuns.status,
          statusMessage: atelierAgentRuns.statusMessage,
          createdAt: atelierAgentRuns.createdAt,
          updatedAt: atelierAgentRuns.updatedAt,
        })
        .from(atelierAgentRuns)
        .where(
          and(
            eq(atelierAgentRuns.agentId, agentId),
            eq(atelierAgentRuns.targetId, firm.id),
            isNull(atelierAgentRuns.deletedAt),
          ),
        )
        .orderBy(desc(atelierAgentRuns.createdAt))
        .limit(1);
      // Task #1046 — a heartbeat-dead "running" row (crashed process) must
      // render as an interrupted error, never as a live run.
      const latest =
        latestRaw && agentRunRowIsStale(latestRaw)
          ? { ...latestRaw, status: "error", statusMessage: INTERRUPTED_RUN_MESSAGE }
          : latestRaw;
      if (launch?.status === "running") {
        out[agentId] = {
          status: "running",
          phase:
            latest?.status === "running" ? (latest.statusMessage ?? null) : "Starting research…",
          runId: latest?.status === "running" ? latest.id : null,
        };
      } else if (launch?.status === "failed") {
        out[agentId] = { status: "failed", phase: launch.error, runId: null };
      } else if (launch?.status === "succeeded") {
        out[agentId] = {
          status: "succeeded",
          runId: launch.runId,
          proposedCount: launch.proposedCount,
          summary: launch.summary,
        };
      } else if (latest?.status === "running") {
        // Server restarted mid-run: no launch entry, durable row still running.
        out[agentId] = {
          status: "running",
          phase: latest.statusMessage ?? null,
          runId: latest.id,
        };
      } else {
        out[agentId] = {
          status: latest ? latest.status : "idle",
          runId: latest?.id ?? null,
          phase: latest?.statusMessage ?? null,
        };
      }
    }
    const pendingCount = (firm.pendingUpdates ?? []).filter((u) => u.status === "pending").length;
    res.json({ agents: out, pendingProposals: pendingCount });
  } catch (err) {
    next(err);
  }
});

// ---------- proposal review (approve applies + audits, reject records) ----------

function applyPartnerProposal(
  firm: NonNullable<Awaited<ReturnType<typeof getFirm>>>,
  proposal: (typeof firm.pendingUpdates)[number],
  me: Me,
): Partial<typeof atelierPartnerFirms.$inferInsert> {
  const v = proposal.toValue;
  switch (proposal.field) {
    case "archetype":
      return { archetype: typeof v === "string" ? v : null };
    case "tier": {
      const toTier = typeof v === "string" ? v : null;
      if (!toTier) return {};
      return {
        tier: toTier,
        tierHistory: [
          ...(firm.tierHistory ?? []),
          {
            fromTier: firm.tier ?? null,
            toTier,
            at: new Date().toISOString(),
            byUserId: me.id,
            reason: `Approved Alliance Cartographer proposal ${proposal.id}`,
          },
        ],
      };
    }
    case "fitScorecard":
      return { fitScorecard: v as (typeof firm)["fitScorecard"] };
    case "dueDiligence":
      return { dueDiligence: v as (typeof firm)["dueDiligence"] };
    case "riskRegister":
      return { riskRegister: (v ?? []) as (typeof firm)["riskRegister"] };
    case "phasing":
      return { phasing: v as (typeof firm)["phasing"] };
    case "capabilities":
      return { capabilities: (v ?? {}) as Record<string, number> };
    case "capabilityProfile":
      // Task #871 — approved capability profile; the decide route
      // refreshes the firm's RAG chunks after the row update.
      return { capabilityProfile: v as (typeof firm)["capabilityProfile"] };
    case "speciality":
      return { speciality: typeof v === "string" ? v : null };
    case "kind":
      return { kind: typeof v === "string" ? v : null };
    case "country": {
      const meta = (proposal.meta ?? {}) as { countryCode?: unknown };
      return {
        country: typeof v === "string" ? v : null,
        ...(typeof meta.countryCode === "string" && meta.countryCode.length === 2
          ? { countryCode: meta.countryCode }
          : {}),
      };
    }
    case "contact": {
      const c = (v ?? {}) as { name?: unknown; role?: unknown; email?: unknown };
      if (typeof c.name !== "string" || !c.name.trim()) return {};
      const contacts = [...(firm.contacts ?? [])];
      const norm = (s: string) => s.trim().toLowerCase();
      const existing = contacts.find((x) => norm(x.name) === norm(c.name as string));
      if (existing) {
        if (typeof c.role === "string" && c.role.trim()) existing.role = c.role;
        if (typeof c.email === "string" && c.email.trim()) existing.email = c.email;
      } else {
        contacts.push({
          id: rid("pfc"),
          name: (c.name as string).trim(),
          role: typeof c.role === "string" ? c.role : null,
          email: typeof c.email === "string" ? c.email : null,
        });
      }
      return { contacts };
    }
    default:
      throw new Error(`unsupported-proposal-field:${proposal.field}`);
  }
}

// Approve or reject a queued agent proposal. Approve applies the change to
// the live firm record; both decisions are stamped on the queue + audited.
// @cli-skip: bespoke proposal-review route behind the Partners Evaluation UI
router.post("/partners/firms/:id/proposals/:proposalId/decide", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!ensureEditor(me, res)) return;
    const action = req.body?.action;
    if (action !== "approve" && action !== "reject") {
      return void res.status(400).json({ error: "invalid-body", message: "action must be approve or reject" });
    }
    const result = await db.transaction(async (tx) => {
      const [firm] = await tx
        .select()
        .from(atelierPartnerFirms)
        .where(and(eq(atelierPartnerFirms.id, req.params.id), firmScope(me)))
        .for("update");
      if (!firm) return { code: 404 as const };
      const queue = [...(firm.pendingUpdates ?? [])];
      const idx = queue.findIndex((u) => u.id === req.params.proposalId);
      if (idx === -1) return { code: 404 as const };
      const proposal = queue[idx];
      if (proposal.status !== "pending") {
        return { code: 200 as const, proposal, idempotent: true };
      }
      const decided = {
        ...proposal,
        status: (action === "approve" ? "approved" : "rejected") as "approved" | "rejected",
        decidedAt: new Date().toISOString(),
        decidedByUserId: me.id,
      };
      queue[idx] = decided;
      let patch: Partial<typeof atelierPartnerFirms.$inferInsert> = {};
      if (action === "approve") {
        try {
          patch = applyPartnerProposal(firm, proposal, me);
        } catch (err) {
          return {
            code: 422 as const,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }
      await tx
        .update(atelierPartnerFirms)
        .set({ ...patch, pendingUpdates: queue, updatedAt: new Date() })
        .where(eq(atelierPartnerFirms.id, firm.id));
      return { code: 200 as const, proposal: decided, appliedFields: Object.keys(patch) };
    });
    if (result.code === 404) return void res.status(404).json({ error: "not-found" });
    if (result.code === 422) {
      return void res.status(422).json({ error: "proposal-apply-failed", message: result.message });
    }
    // Task #538 — an approved contact proposal may have appended an
    // unstamped jsonb entry; back it with a person record + promoted
    // resource row (outside the row-lock tx; stamping is idempotent).
    if (
      action === "approve" &&
      "appliedFields" in result &&
      (result.appliedFields ?? []).includes("contacts")
    ) {
      const fresh = await getFirm(me, req.params.id);
      if (fresh && Array.isArray(fresh.contacts)) {
        const stamped = await stampContactPersons(
          db,
          me,
          fresh.id,
          fresh.contacts.map((c) => ({
            id: c.id,
            name: c.name,
            role: c.role ?? null,
            email: c.email ?? null,
            personId: (c as { personId?: string | null }).personId ?? null,
          })),
        );
        await db
          .update(atelierPartnerFirms)
          .set({ contacts: stamped, updatedAt: new Date() })
          .where(eq(atelierPartnerFirms.id, fresh.id));
      }
    }
    // Task #871 — an approved proposal that touched profile/capability
    // fields must refresh the firm's entity embedding + capability chunks.
    if (
      action === "approve" &&
      "appliedFields" in result &&
      (result.appliedFields ?? []).some((f) =>
        ["capabilityProfile", "capabilities", "speciality", "kind", "country"].includes(f),
      )
    ) {
      void refreshPartnerFirmRag(req.params.id);
    }
    if (!("idempotent" in result && result.idempotent)) {
      await audit({
        entityType: "partner_firm",
        entityId: req.params.id,
        actor: me,
        action: `partner_firm.proposal.${action}`,
        payload: {
          proposalId: req.params.proposalId,
          field: result.proposal?.field,
          appliedFields: "appliedFields" in result ? result.appliedFields : [],
        },
        summary: `${me.name} ${action === "approve" ? "approved" : "rejected"} an agent proposal (${result.proposal?.field}).`,
      });
    }
    res.json({ ok: true, proposal: result.proposal });
  } catch (err) {
    next(err);
  }
});

export default router;
