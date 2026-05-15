/**
 * Task #334 — Capability-catalog entries that operate on attachments.
 *
 * Forward-safe additions (no orchestrator wiring change). Each entry
 * follows the same `defineCapability(...)` shape as the Task #332 seed
 * file. The CLI orchestrator picks them up automatically because
 * `getToolsForPersona` walks the catalog at every turn.
 *
 * Read-only:
 *   fetch_document_chunk          — read one chunk by id
 *   qualify_opportunity_rubric    — score an extracted RFP (no write)
 *
 * Writes (two-phase confirm):
 *   ingest_rfp_to_opportunity     — RFP → atelier_opportunities row
 *                                   + qualification_rubric snapshot
 *   ingest_transcript_to_raid     — transcript → atelier_raid_items rows
 *   ingest_receipts_to_expenses   — receipt batch → atelier_expenses rows
 *   ingest_deck_to_brand_profile  — deck/notes → atelier_firm_profile draft
 *   ingest_spreadsheet_summary    — xlsx/csv → analyst summary asset
 *
 * Each ingest tool persists the originating `attachmentIds[]` onto the
 * downstream record (audit row payload) so the timeline can pivot from
 * the attachment to the materialised entity and back.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierEngagements,
  atelierEngagementAccess,
  atelierOpportunities,
  atelierRaidItems,
  atelierExpenses,
  atelierFirmProfile,
  atelierAssets,
  atelierAuditEvents,
  atelierExtractedDocuments,
  atelierCliAttachments,
} from "@workspace/db";

/**
 * Engagement-grant ACL parity check (mirrors `ensureEngAccess` from
 * engagementRoutes). Returns the engagement when the persona is allowed
 * to write to it, or a rejection result the capability can return.
 *
 *   - founding_partner / partner roles bypass the grant table
 *     (firm-wide visibility, Task #292 convention).
 *   - all other roles must hold an active, non-revoked
 *     `atelier_engagement_access` row for the engagement.
 *   - cross-org engagement ids surface as `not_found` so existence is
 *     not leaked; intra-org engagements without a grant return
 *     `forbidden`.
 */
async function ensureEngagementWriteAccess(
  ctx: { persona: { id: string; orgId: string; role: string } },
  engagementId: string,
): Promise<
  | { ok: true; engagement: typeof atelierEngagements.$inferSelect }
  | { ok: false; errorCode: "not_found" | "forbidden"; errorMessage: string }
> {
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, engagementId),
        eq(atelierEngagements.orgId, ctx.persona.orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (!eng) {
    return {
      ok: false,
      errorCode: "not_found",
      errorMessage: `engagement ${engagementId} not found`,
    };
  }
  if (ctx.persona.role === "founding_partner" || ctx.persona.role === "partner") {
    return { ok: true, engagement: eng };
  }
  const [grant] = await db
    .select({ id: atelierEngagementAccess.id })
    .from(atelierEngagementAccess)
    .where(
      and(
        eq(atelierEngagementAccess.engagementId, engagementId),
        eq(atelierEngagementAccess.userId, ctx.persona.id),
        eq(atelierEngagementAccess.status, "active"),
        isNull(atelierEngagementAccess.deletedAt),
      ),
    );
  if (!grant) {
    return {
      ok: false,
      errorCode: "forbidden",
      errorMessage: "Persona has no access grant for this engagement.",
    };
  }
  return { ok: true, engagement: eng };
}
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import { loadAttachment, loadChunk, type DocChunk } from "./attachments/index.js";
import { scoreRubric, type RubricChunk } from "./qualification-rubric.js";
import { entityNavPath } from "./orchestrator-capabilities.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function loadAllChunks(
  attachmentIds: string[],
  orgId: string,
): Promise<RubricChunk[]> {
  const out: RubricChunk[] = [];
  for (const aid of attachmentIds) {
    const loaded = await loadAttachment(aid, orgId);
    const chunks = (loaded?.extracted?.chunks ?? []) as DocChunk[];
    for (const c of chunks) out.push({ chunkId: c.chunkId, text: c.text });
  }
  return out;
}

// =====================================================================
// fetch_document_chunk — read one chunk verbatim by id.
// =====================================================================
defineCapability({
  id: "attachment.fetch_chunk",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "fetch_document_chunk",
  description:
    "Read one chunk of an attached document by chunkId (returned by the upload digest). Read-only; safe for any persona.",
  slashAliases: { en: ["/chunk", "/read-chunk"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string" },
      chunkId: { type: "string" },
    },
    required: ["attachmentId", "chunkId"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global"],
  examplePhrases: {
    en: ["read chunk c3 of this attachment", "/chunk c1"],
  },
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "document_chunk",
  async run(input, _ctx) {
    const attachmentId = String(input.attachmentId ?? "");
    const chunkId = String(input.chunkId ?? "");
    const hit = await loadChunk({ attachmentId, chunkId, orgId: _ctx.persona.orgId });
    if (!hit) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `chunk ${chunkId} not found on ${attachmentId}`,
      };
    }
    return {
      ok: true,
      data: {
        attachmentId,
        chunkId: hit.chunk.chunkId,
        kind: hit.kind,
        charStart: hit.chunk.charStart,
        charEnd: hit.chunk.charEnd,
        summary: hit.chunk.summary,
        text: hit.chunk.text,
      },
    };
  },
});

// =====================================================================
// qualify_opportunity_rubric — score an RFP without writing the opp.
// =====================================================================
defineCapability({
  id: "opportunity.qualify_rubric",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "qualify_opportunity_rubric",
  description:
    "Score the qualification rubric (6 dimensions, 0-100 composite, pursue/watch/decline band) for one or more attached RFPs. Read-only.",
  slashAliases: { en: ["/qualify", "/rubric"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      offeringAnchors: { type: "array", items: { type: "string" } },
      accountCountry: { type: "string" },
      accountSector: { type: "string" },
    },
    required: ["attachmentIds"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "opportunity_workspace"],
  examplePhrases: {
    en: ["score this RFP", "qualify the attached RFP", "/qualify"],
  },
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "qualification_rubric",
  async run(input, _ctx) {
    const attachmentIds = (input.attachmentIds as string[]) ?? [];
    const chunks = await loadAllChunks(attachmentIds, _ctx.persona.orgId);
    if (chunks.length === 0) {
      return {
        ok: false,
        errorCode: "no_chunks",
        errorMessage: "no extracted chunks found for the supplied attachments",
      };
    }
    const result = scoreRubric({
      attachmentIds,
      chunks,
      offeringAnchors: (input.offeringAnchors as string[]) ?? [],
      accountCountry:
        typeof input.accountCountry === "string" ? input.accountCountry : undefined,
      accountSector:
        typeof input.accountSector === "string" ? input.accountSector : undefined,
    });
    return { ok: true, data: result };
  },
});

// =====================================================================
// ingest_rfp_to_opportunity — RFP → opportunity row + rubric.
// =====================================================================
defineCapability({
  id: "opportunity.ingest_rfp",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "ingest_rfp_to_opportunity",
  description:
    "Create a new opportunity from an attached RFP. Persists the deterministic 6-dimension qualification rubric on the row.",
  slashAliases: { en: ["/rfp", "/ingest-rfp"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      accountId: { type: "string" },
      opportunityName: { type: "string" },
      offeringAnchor: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentIds", "accountId", "opportunityName"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager", "manager"],
  surfaceOn: ["opportunity_workspace", "account_workspace", "global"],
  examplePhrases: {
    en: ["log this RFP as an opportunity for Acme", "/rfp Acme — Annual Audit"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "opportunity_card",
  async run(input, ctx) {
    const attachmentIds = (input.attachmentIds as string[]) ?? [];
    const accountId = String(input.accountId ?? "");
    const opportunityName = String(input.opportunityName ?? "").slice(0, 200);
    const offeringAnchor =
      typeof input.offeringAnchor === "string" ? input.offeringAnchor : null;

    // Org-scoped account validation. Cross-org account ids surface as
    // not_found rather than forbidden so we don't leak existence.
    const [account] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, accountId),
          eq(atelierAccounts.orgId, ctx.persona.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      );
    if (!account) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `account ${accountId} not found`,
      };
    }

    const chunks = await loadAllChunks(attachmentIds, ctx.persona.orgId);
    if (chunks.length === 0) {
      return {
        ok: false,
        errorCode: "no_chunks",
        errorMessage: "no extracted chunks found",
      };
    }
    const rubric = scoreRubric({
      attachmentIds,
      chunks,
      offeringAnchors: offeringAnchor ? [offeringAnchor] : [],
      accountCountry: account.country ?? undefined,
      accountSector: account.sector ?? undefined,
    });

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { opportunityName, accountId, rubric } },
        confirmation: {
          summary: `Create opportunity “${opportunityName}” for ${account.name} — rubric ${rubric.composite}/100 (${rubric.band}).`,
          diff: {
            create: {
              table: "atelier_opportunities",
              values: { name: opportunityName, accountId, qualificationRubric: rubric },
            },
          },
          pending: {
            tool: "ingest_rfp_to_opportunity",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    const id = rid("opp");
    const slug = opportunityName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);
    await db.insert(atelierOpportunities).values({
      id,
      orgId: ctx.persona.orgId,
      slug: `${slug}-${id.slice(-6)}`,
      name: opportunityName,
      accountId,
      offeringAnchor: offeringAnchor ?? undefined,
      plmStage: "lead",
      salesStage: "suspect",
      partnerOwnerId: ctx.persona.id,
      engagementLeadId: ctx.persona.id,
      dealSizeHypothesis: 0,
      probabilityPct: 5,
      qualificationRubric: rubric,
      nextMilestone: "Confirm pursuit decision from rubric",
      sourceLead: "cli_rfp_ingest",
      createdByUserId: ctx.persona.id,
    });
    await db.insert(atelierAuditEvents).values([
      {
        id: rid("aud"),
        entityType: "opportunity",
        entityId: id,
        actorType: "human",
        actorId: ctx.persona.id,
        actorLabel: ctx.persona.name,
        action: "opportunity.create.cli",
        payload: {
          opportunityName,
          accountId,
          attachmentIds,
          turnId: ctx.turnId,
          rubricBand: rubric.band,
          rubricComposite: rubric.composite,
        },
        payloadSummary: `CLI created opportunity ${opportunityName} from ${attachmentIds.length} attachment(s)`,
      },
      {
        id: rid("aud"),
        entityType: "opportunity",
        entityId: id,
        actorType: "system",
        actorId: "atelier-cli",
        actorLabel: "Qualification rubric",
        action: "opportunity.qualify_rubric",
        payload: { rubric, attachmentIds, turnId: ctx.turnId },
        payloadSummary: `Rubric ${rubric.composite}/100 → ${rubric.band}`,
      },
    ]);
    // Task #499 — commit landed a single opportunity row; jump there.
    const navPath = entityNavPath("opportunity", id);
    return {
      ok: true,
      data: {
        id,
        opportunityName,
        accountId,
        rubric,
        attachmentIds,
        navigateTo: navPath ? { path: navPath, when: "on_commit" as const } : null,
      },
    };
  },
});

// =====================================================================
// ingest_transcript_to_raid — transcript → atelier_raid_items rows.
// =====================================================================
defineCapability({
  id: "raid.ingest_transcript",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "raid",
  toolName: "ingest_transcript_to_raid",
  description:
    "Lift action items + risks out of an attached meeting transcript and stage them as RAID items on an engagement.",
  slashAliases: { en: ["/transcript-to-raid", "/lift-raid"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      engagementId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentIds", "engagementId"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [
    "founding_partner",
    "partner",
    "senior_manager",
    "manager",
    "associate",
  ],
  surfaceOn: ["engagement_dashboard", "global"],
  examplePhrases: {
    en: ["lift action items from this transcript", "/transcript-to-raid"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "raid_batch",
  async run(input, ctx) {
    const attachmentIds = (input.attachmentIds as string[]) ?? [];
    const engagementId = String(input.engagementId ?? "");
    // Engagement ACL parity with raid/engagement routes: org scope +
    // active grant unless persona is founding_partner / partner.
    const acl = await ensureEngagementWriteAccess(ctx, engagementId);
    if (!acl.ok) return acl;
    const chunks = await loadAllChunks(attachmentIds, ctx.persona.orgId);
    if (chunks.length === 0) {
      return {
        ok: false,
        errorCode: "no_chunks",
        errorMessage: "no extracted chunks found",
      };
    }
    // Deterministic lift: scan each chunk for explicit action / risk
    // markers. Each match becomes one RAID candidate; the chunkId is
    // pinned onto the audit payload so reviewers can jump back.
    const candidates: Array<{
      kind: "risk" | "issue" | "assumption" | "dependency";
      severity: "red" | "amber" | "green";
      description: string;
      chunkId: string;
    }> = [];
    const ACTION_RE = /\b(action|next step|todo|to-do)\b[:\-]\s*([^\n]{6,200})/gi;
    const RISK_RE = /\b(risk|blocker|concern|escalation)\b[:\-]\s*([^\n]{6,200})/gi;
    for (const c of chunks) {
      let m: RegExpExecArray | null;
      ACTION_RE.lastIndex = 0;
      while ((m = ACTION_RE.exec(c.text)) !== null) {
        candidates.push({
          kind: "issue",
          severity: "amber",
          description: m[2].trim().slice(0, 480),
          chunkId: c.chunkId,
        });
      }
      RISK_RE.lastIndex = 0;
      while ((m = RISK_RE.exec(c.text)) !== null) {
        candidates.push({
          kind: "risk",
          severity: /\b(red|critical|blocker)\b/i.test(m[0]) ? "red" : "amber",
          description: m[2].trim().slice(0, 480),
          chunkId: c.chunkId,
        });
      }
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errorCode: "no_signal",
        errorMessage: "no action/risk lines found in the attached transcript",
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: candidates.slice(0, 12), totalCount: candidates.length },
        confirmation: {
          summary: `Stage ${candidates.length} RAID items on ${engagementId} from ${attachmentIds.length} transcript(s).`,
          diff: { create: { table: "atelier_raid_items", count: candidates.length } },
          pending: {
            tool: "ingest_transcript_to_raid",
            input: { ...input, confirm: true },
          },
        },
      };
    }
    const created: string[] = [];
    for (const cand of candidates) {
      const id = rid("raid");
      await db.insert(atelierRaidItems).values({
        id,
        orgId: ctx.persona.orgId,
        engagementId,
        kind: cand.kind,
        severity: cand.severity,
        description: cand.description,
        status: "open",
        createdByUserId: ctx.persona.id,
      });
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "raid_item",
        entityId: id,
        actorType: "human",
        actorId: ctx.persona.id,
        actorLabel: ctx.persona.name,
        action: "raid.add.cli",
        payload: {
          ...cand,
          attachmentIds,
          turnId: ctx.turnId,
          source: "cli_transcript",
        },
        payloadSummary: `CLI lifted ${cand.kind} from transcript chunk ${cand.chunkId}`,
      });
      created.push(id);
    }
    // Task #499 — RAID lift commits target a single engagement; land
    // the user on its workspace so they can review the new items.
    const navPath = entityNavPath("engagement", engagementId);
    return {
      ok: true,
      data: {
        engagementId,
        createdCount: created.length,
        ids: created,
        attachmentIds,
        navigateTo: navPath ? { path: navPath, when: "on_commit" as const } : null,
      },
    };
  },
});

// =====================================================================
// ingest_receipts_to_expenses — receipt batch → atelier_expenses rows.
// =====================================================================
defineCapability({
  id: "wallet.ingest_receipts",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "ingest_receipts_to_expenses",
  description:
    "Stage a batch of attached receipt images / spreadsheet rows as draft expenses for the persona's own wallet.",
  slashAliases: { en: ["/receipts", "/ingest-receipts"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      engagementId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentIds"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [
    "founding_partner",
    "partner",
    "senior_manager",
    "manager",
    "associate",
  ],
  surfaceOn: ["wallet", "global"],
  examplePhrases: {
    en: ["log these receipts to my wallet", "/receipts"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "expense_batch",
  async run(input, ctx) {
    const attachmentIds = (input.attachmentIds as string[]) ?? [];
    const engagementId =
      typeof input.engagementId === "string" ? input.engagementId : null;
    // Receipts can land "to wallet only" (no engagement) — but if an
    // engagementId is supplied, validate it belongs to the persona's
    // org before opening a confirm dialog.
    if (engagementId) {
      const acl = await ensureEngagementWriteAccess(ctx, engagementId);
      if (!acl.ok) return acl;
    }
    const drafts: Array<{
      attachmentId: string;
      merchant: string;
      amount: number;
      currency: string;
      category: string;
      vatAmount: number;
      country: string | null;
    }> = [];
    for (const aid of attachmentIds) {
      const loaded = await loadAttachment(aid, ctx.persona.orgId);
      if (!loaded?.extracted) continue;
      const text = loaded.extracted.normalizedText ?? "";
      // Receipt-fixture text always carries `merchant:`/`total:`/`currency:`
      // headers (see extractors.extractImage). Parse them; non-image
      // attachments fall back to "scan as text".
      const merchantMatch = text.match(/merchant:\s*([^\n]+)/i);
      const totalMatch = text.match(/total:\s*([\d.]+)/i);
      const currencyMatch = text.match(/currency:\s*([A-Z]{3})/i);
      const categoryMatch = text.match(/category:\s*(\w+)/i);
      const taxMatch = text.match(/tax:\s*([\d.]+)/i);
      const countryMatch = text.match(/country:\s*([A-Z]+)/i);
      drafts.push({
        attachmentId: aid,
        merchant: merchantMatch?.[1].trim() ?? loaded.attachment.fileName,
        amount: totalMatch ? Number(totalMatch[1]) : 0,
        currency: currencyMatch?.[1] ?? "USD",
        category: categoryMatch?.[1] ?? "other",
        vatAmount: taxMatch ? Number(taxMatch[1]) : 0,
        country: countryMatch?.[1] ?? null,
      });
    }
    if (drafts.length === 0) {
      return {
        ok: false,
        errorCode: "no_receipts",
        errorMessage: "no parseable receipts found in attachments",
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: drafts },
        confirmation: {
          summary: `Stage ${drafts.length} draft expense(s) from ${attachmentIds.length} attachment(s).`,
          diff: { create: { table: "atelier_expenses", count: drafts.length } },
          pending: {
            tool: "ingest_receipts_to_expenses",
            input: { ...input, confirm: true },
          },
        },
      };
    }
    const today = new Date().toISOString().slice(0, 10);
    const created: string[] = [];
    for (const d of drafts) {
      const id = rid("exp");
      await db.insert(atelierExpenses).values({
        id,
        orgId: ctx.persona.orgId,
        personId: ctx.persona.id,
        personType: "employee",
        engagementId,
        expenseDate: today,
        captureSource: "manual",
        merchant: d.merchant,
        category: d.category,
        amount: d.amount,
        currency: d.currency,
        vatAmount: d.vatAmount,
        vatCountry: d.country,
        receiptFileRef: `enc:cli:${d.attachmentId}`,
        status: "draft",
        createdByUserId: ctx.persona.id,
      });
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "expense",
        entityId: id,
        actorType: "human",
        actorId: ctx.persona.id,
        actorLabel: ctx.persona.name,
        action: "expense.create",
        payload: {
          ...d,
          attachmentIds: [d.attachmentId],
          turnId: ctx.turnId,
          source: "cli_receipt_ingest",
        },
        payloadSummary: `CLI staged expense ${d.merchant} (${d.currency} ${d.amount})`,
      });
      created.push(id);
    }
    // Task #499 — receipts land on the wallet expenses index (the
    // batch can produce many rows, so navigate to the list, not a
    // specific row).
    return {
      ok: true,
      data: {
        ids: created,
        count: created.length,
        attachmentIds,
        navigateTo:
          created.length > 0
            ? { path: "/wallet/expenses", when: "on_commit" as const }
            : null,
      },
    };
  },
});

// =====================================================================
// ingest_deck_to_brand_profile — deck/notes → atelier_firm_profile draft.
// =====================================================================
defineCapability({
  id: "firm_profile.ingest_deck",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "ingest_deck_to_brand_profile",
  description:
    "Seed a Brand Profile draft from an attached pitch deck or brand-notes document. Always lands as draft (publish gated by partner).",
  slashAliases: { en: ["/deck-to-brand", "/seed-brand"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      firmName: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentIds", "firmName"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["global"],
  examplePhrases: {
    en: ["seed brand profile from this deck", "/deck-to-brand AICo"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "brand_profile_draft",
  async run(input, ctx) {
    const attachmentIds = (input.attachmentIds as string[]) ?? [];
    const firmName = String(input.firmName ?? "").slice(0, 200);
    const chunks = await loadAllChunks(attachmentIds, ctx.persona.orgId);
    if (chunks.length === 0) {
      return {
        ok: false,
        errorCode: "no_chunks",
        errorMessage: "no extracted chunks found",
      };
    }
    const text = chunks.map((c) => c.text).join("\n\n");
    const tagline = (text.match(/(tagline|slogan)[:\-]\s*([^\n]{4,120})/i)?.[2] ?? "").trim();
    const mission = (text.match(/(mission|purpose)[:\-]\s*([^\n]{8,400})/i)?.[2] ?? "").trim();
    const differentiators = Array.from(
      new Set(
        text
          .match(/(differentiators?|why us)[:\-]\s*([^\n]{4,400})/gi)
          ?.map((m) => m.replace(/^[^:\-]+[:\-]\s*/, "").trim())
          .filter((s) => s.length > 0) ?? [],
      ),
    ).slice(0, 6);
    const draft = {
      firmName,
      tagline: tagline || `${firmName} — pitch deck import`,
      missionStatement: mission || "(seed from attached deck — pending review)",
      voiceAttributes: [],
      principles: [],
      boilerplateShort: text.slice(0, 480),
      boilerplateLong: text.slice(0, 1400),
      capabilitiesPitch: "",
      differentiators,
      proofPoints: [],
      legalEntities: [],
      contactBlock: "",
    };
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: draft, attachmentIds },
        confirmation: {
          summary: `Seed Brand Profile draft for ${firmName} from ${attachmentIds.length} attachment(s).`,
          diff: { create: { table: "atelier_firm_profile", values: { firmName } } },
          pending: {
            tool: "ingest_deck_to_brand_profile",
            input: { ...input, confirm: true },
          },
        },
      };
    }
    const id = rid("fp");
    // Pick the next version number for this org (best-effort — partner
    // publishes from the canonical firmProfileRoutes after review).
    const existing = await db
      .select({ version: atelierFirmProfile.version })
      .from(atelierFirmProfile)
      .where(eq(atelierFirmProfile.orgId, ctx.persona.orgId));
    const nextVersion = (existing.reduce((m, r) => Math.max(m, r.version), 0) ?? 0) + 1;
    await db.insert(atelierFirmProfile).values({
      id,
      orgId: ctx.persona.orgId,
      version: nextVersion,
      status: "draft",
      payload: draft,
      notes: `Seeded by CLI from attachments ${attachmentIds.join(", ")}`,
      createdByUserId: ctx.persona.id,
    });
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "firm_profile",
      entityId: id,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "firm_profile.draft.cli",
      payload: { firmName, attachmentIds, turnId: ctx.turnId, version: nextVersion },
      payloadSummary: `CLI seeded Brand Profile draft v${nextVersion} from deck`,
    });
    // Task #499 — brand profile drafts always land on the firm
    // profile review page so the partner can publish.
    return {
      ok: true,
      data: {
        id,
        version: nextVersion,
        attachmentIds,
        navigateTo: { path: "/atelier/firm-profile", when: "on_commit" as const },
      },
    };
  },
});

// =====================================================================
// ingest_spreadsheet_summary — xlsx/csv → analyst summary asset.
// =====================================================================
defineCapability({
  id: "knowledge.ingest_spreadsheet",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "ingest_spreadsheet_summary",
  description:
    "Summarise an attached spreadsheet (CSV / XLSX) and persist the analyst summary as a knowledge-base asset.",
  slashAliases: { en: ["/spreadsheet", "/summarise-sheet"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      title: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentIds", "title"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [
    "founding_partner",
    "partner",
    "senior_manager",
    "manager",
    "associate",
  ],
  surfaceOn: ["global"],
  examplePhrases: {
    en: ["summarise this spreadsheet", "/summarise-sheet Q3 utilisation"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "asset_card",
  async run(input, ctx) {
    const attachmentIds = (input.attachmentIds as string[]) ?? [];
    const title = String(input.title ?? "").slice(0, 200);
    const summaries: Array<{
      attachmentId: string;
      kind: string;
      columns: string[];
      rowCount: number;
      sample: Array<Record<string, unknown>>;
    }> = [];
    for (const aid of attachmentIds) {
      const loaded = await loadAttachment(aid, ctx.persona.orgId);
      if (!loaded?.extracted) continue;
      const ts = loaded.extracted.tableSummary;
      if (ts) {
        summaries.push({
          attachmentId: aid,
          kind: loaded.extracted.kind,
          columns: ts.columns,
          rowCount: ts.rowCount,
          sample: ts.sample,
        });
      }
    }
    if (summaries.length === 0) {
      return {
        ok: false,
        errorCode: "no_table",
        errorMessage:
          "no tabular extraction found — attach a CSV (XLSX text-only extraction does not preserve columns yet)",
      };
    }
    const abstract = summaries
      .map(
        (s) =>
          `${s.attachmentId} (${s.kind}): ${s.rowCount} rows · cols ${s.columns.join(", ")}`,
      )
      .join("\n");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { title, abstract, summaries } },
        confirmation: {
          summary: `Persist analyst summary “${title}” derived from ${attachmentIds.length} spreadsheet(s).`,
          diff: { create: { table: "atelier_assets", values: { title, kind: "framework" } } },
          pending: {
            tool: "ingest_spreadsheet_summary",
            input: { ...input, confirm: true },
          },
        },
      };
    }
    const id = rid("ast");
    await db.insert(atelierAssets).values({
      id,
      orgId: ctx.persona.orgId,
      kind: "framework",
      title,
      abstract,
      bodyOrFileUrl: null,
      provenance: `cli_spreadsheet_summary:${attachmentIds.join(",")}`,
      tags: ["cli", "spreadsheet"],
      createdByUserId: ctx.persona.id,
    });
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "asset",
      entityId: id,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "asset.create.cli",
      payload: { title, attachmentIds, turnId: ctx.turnId, summaries },
      payloadSummary: `CLI persisted spreadsheet summary asset ${title}`,
    });
    // Task #499 — spreadsheet summaries persist as Codex assets;
    // navigate to the assets section so the new card is visible.
    return {
      ok: true,
      data: {
        id,
        title,
        attachmentIds,
        summaries,
        navigateTo: { path: "/codex/assets", when: "on_commit" as const },
      },
    };
  },
});

// Side-effect import: ensures the catalog registers when the
// orchestrator boots. Mirrors capability-seed.ts.
export const ATTACHMENT_CAPABILITIES_LOADED = true;
// Reference all imports so tree-shaking can't drop an unused side-effect.
void atelierAccounts;
void atelierExtractedDocuments;
void atelierCliAttachments;
