/**
 * Task #159 — Contract lifecycle chat capabilities.
 *
 * Three capabilities that let partners drive the contracting workflow
 * from chat:
 *
 *   1. `contract_prepare`        — "prepare a mutual NDA for Acme Corp".
 *                                  Resolves the template (by name/type) and
 *                                  the counterparty (roster person, contact,
 *                                  or account), auto-fills detected fields
 *                                  from CRM data, asks for missing required
 *                                  values via the clarification protocol,
 *                                  then shows a confirm card. On commit it
 *                                  fills the Word template and creates the
 *                                  contract record (status `draft`).
 *   2. `contract_send_signature` — converts the latest Word doc to PDF and
 *                                  hands off to the DocuSeal e-sign flow
 *                                  (two-phase confirm; outbound email).
 *   3. `contract_status`         — read-only status query ("what's the
 *                                  contract status with Acme?", "which
 *                                  contracts are awaiting signature?").
 *
 * Heavy/multipart steps (template upload, final redlined .docx upload,
 * downloads) stay on the REST routes — chat links to the Contracts UI
 * instead of accepting file bytes.
 *
 * All mutation logic lives in lib/atelier-contract-service.ts, shared
 * with the REST routes; these wrappers only resolve names → ids and
 * shape the confirm/clarification envelopes.
 */

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierContractors,
  atelierEmployees,
  atelierUsers,
  atelierContractTemplates,
  atelierContractTemplateVersions,
  atelierContractRecords,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { hybridResolveEntity } from "./entity-resolver.js";
import {
  prepareContract,
  sendContract,
  resolveCounterparty,
  firmAutoFill,
  buildFieldValues,
  resolveSigningEntity,
  type Counterparty,
} from "../atelier-contract-service.js";
import {
  CONTRACT_TYPES,
  DOCX_MIME,
  TERMINAL_CONTRACT_STATUSES,
  addContractDocument,
  auditContractEntity,
  normalizeFieldSchema,
} from "../atelier-contracts.js";
import { writePersonAndSync } from "../atelier-person-sync.js";
import {
  PersonNameValidationError,
  resolveStructuredNameInput,
} from "../atelier-person-model.js";
import { loadAttachment, loadAttachmentBytes } from "./attachments/index.js";

const CONTRACTS_PATH = "/contracts";

/** Contract type whose chat prepare flow may auto-add the counterparty to the roster (Task #967). */
const NEP_CONTRACT_TYPE = "non_equity_partner_employment";
const NEP_ROLE_LABEL = "Non-Equity Partner";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type TemplateRow = typeof atelierContractTemplates.$inferSelect;

// ---------------------------------------------------------------------------
// Shared resolution helpers
// ---------------------------------------------------------------------------

/** Fuzzy template match by name or contract type over ACTIVE templates. */
async function resolveTemplate(
  orgId: string,
  query: string,
): Promise<{ match: TemplateRow | null; candidates: TemplateRow[] }> {
  const q = (query ?? "").trim();
  if (!q) return { match: null, candidates: [] };
  const active = await db
    .select()
    .from(atelierContractTemplates)
    .where(
      and(
        eq(atelierContractTemplates.orgId, orgId),
        eq(atelierContractTemplates.status, "active"),
      ),
    )
    .orderBy(desc(atelierContractTemplates.createdAt));
  // Exact id short-circuit.
  const byId = active.find((t) => t.id === q);
  if (byId) return { match: byId, candidates: [byId] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nq = norm(q);
  // Exact type token ("mutual_nda") or normalized-name/type containment.
  const scored = active
    .map((t) => {
      const name = norm(t.name);
      const type = norm(t.contractType);
      let score = 0;
      if (t.contractType === q) score = 1;
      else if (name === nq || type === nq) score = 0.95;
      else if (name.includes(nq) || nq.includes(name)) score = 0.8;
      else if (type.includes(nq) || nq.includes(type)) score = 0.7;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { match: null, candidates: [] };
  const top = scored[0];
  const ambiguous =
    scored.length > 1 && scored[1].score >= top.score && scored[1].t.id !== top.t.id;
  return {
    match: ambiguous ? null : top.t,
    candidates: scored.slice(0, 5).map((x) => x.t),
  };
}

/**
 * Resolve a counterparty by display name. Searches roster people,
 * contacts, and accounts (optionally narrowed by `kind`); returns the
 * resolved Counterparty, or the candidate list when ambiguous.
 */
async function resolveCounterpartyByName(
  orgId: string,
  name: string,
  kind?: string | null,
): Promise<{
  match: Counterparty | null;
  candidates: Array<{ kind: string; id: string; label: string }>;
}> {
  const q = (name ?? "").trim();
  if (!q) return { match: null, candidates: [] };
  const wants = (k: string) => !kind || kind === k;

  // Exact-id short-circuit. Confirmation `pending.input` and clarification
  // `partial` reruns carry the resolved counterparty as an ID (plus kind),
  // so an ID must resolve directly — a name search would miss it and fail
  // the commit with counterparty_not_found.
  for (const k of ["person", "contact", "account"]) {
    if (!wants(k)) continue;
    const byId = await resolveCounterparty(orgId, k, q);
    if (byId) {
      return { match: byId, candidates: [{ kind: k, id: byId.id, label: byId.label }] };
    }
  }
  const candidates: Array<{ kind: string; id: string; label: string; score: number }> = [];

  if (wants("person")) {
    const people = await db
      .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName })
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.orgId, orgId),
          or(
            ilike(atelierEmployees.fullName, `%${q}%`),
            ilike(atelierEmployees.preferredName, `%${q}%`),
            // Task #538 — match structured person preferred/display name too.
            sql`EXISTS (SELECT 1 FROM atelier_persons p WHERE p.id = ${atelierEmployees.personId} AND (p.preferred_name ILIKE ${`%${q}%`} OR p.display_name ILIKE ${`%${q}%`}))`,
          ),
        ),
      )
      .limit(5);
    for (const p of people) {
      candidates.push({
        kind: "person",
        id: p.id,
        label: p.fullName,
        score: p.fullName.toLowerCase() === q.toLowerCase() ? 1 : 0.7,
      });
    }
    // Task #967 — contractors are roster people too (non-equity partners
    // added by the prepare flow live in atelier_contractors).
    const contractors = await db
      .select({ id: atelierContractors.id, fullName: atelierContractors.fullName })
      .from(atelierContractors)
      .where(
        and(
          eq(atelierContractors.orgId, orgId),
          isNull(atelierContractors.deletedAt),
          ilike(atelierContractors.fullName, `%${q}%`),
        ),
      )
      .limit(5);
    for (const c of contractors) {
      candidates.push({
        kind: "person",
        id: c.id,
        label: c.fullName,
        score: c.fullName.toLowerCase() === q.toLowerCase() ? 1 : 0.7,
      });
    }
  }
  if (wants("contact")) {
    for (const c of await hybridResolveEntity("contact", q, orgId)) {
      candidates.push({ kind: "contact", id: c.id, label: c.label, score: c.score });
    }
  }
  if (wants("account")) {
    for (const a of await hybridResolveEntity("account", q, orgId)) {
      candidates.push({ kind: "account", id: a.id, label: a.label, score: a.score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  if (!top) return { match: null, candidates: [] };
  const runnerUp = candidates[1];
  const decisive = top.score >= 0.95 || !runnerUp || top.score - runnerUp.score >= 0.2;
  if (!decisive) {
    return {
      match: null,
      candidates: candidates.slice(0, 5).map(({ kind: k, id, label }) => ({ kind: k, id, label })),
    };
  }
  const resolved = await resolveCounterparty(orgId, top.kind, top.id);
  return {
    match: resolved,
    candidates: candidates.slice(0, 5).map(({ kind: k, id, label }) => ({ kind: k, id, label })),
  };
}

function contractSummary(c: typeof atelierContractRecords.$inferSelect) {
  return {
    id: c.id,
    title: c.title,
    contractType: c.contractType,
    counterparty: c.counterpartyLabel,
    counterpartyKind: c.counterpartyKind,
    status: c.status,
    effectiveDate: c.effectiveDate ? c.effectiveDate.toISOString().slice(0, 10) : null,
    expiryDate: c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : null,
    owner: c.ownerLabel,
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. contract_prepare
// ---------------------------------------------------------------------------

defineCapability({
  id: "codex.contract_prepare",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_prepare",
  description:
    "Prepare a contract from an uploaded Word template: resolve the template (by name or type, e.g. mutual NDA / employment / contractor agreement) and the counterparty (roster person, contact, or client organization), auto-fill fields from CRM data, and generate the filled Word draft. Two-phase: first call previews the filled values, second call (confirm=true) creates the contract. Missing required values trigger a clarification question.",
  slashAliases: { en: ["/contract-prepare"] },
  representativePrompts: {
    en: [
      "Prepare a mutual NDA for Acme Corp.",
      "Prepare an employment contract for Jane Doe effective 1 September.",
      "Draft a contractor agreement for John Smith with a day rate of $900.",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      confirm: { type: "boolean", description: "Set true to commit." },
      summary: { type: "string", description: "Optional human description." },
      template: {
        type: "string",
        description:
          "Template name or contract type (e.g. 'mutual NDA', 'employment', 'contractor agreement').",
      },
      counterparty: {
        type: "string",
        description: "Counterparty name — a roster person, client contact, or client organization.",
      },
      counterpartyKind: {
        type: "string",
        enum: ["person", "contact", "account"],
        description: "Optional narrowing when the name alone is ambiguous.",
      },
      newPersonEmail: {
        type: "string",
        description:
          "Non-equity partner agreements only: when the counterparty is not on the roster yet, their email address — the person is auto-added to the roster (contractor, no login) on commit.",
      },
      values: {
        type: "object",
        description:
          "Explicit field values keyed by the template's field keys (fees, term, etc.).",
        additionalProperties: { type: "string" },
      },
      effectiveDate: { type: "string", description: "YYYY-MM-DD." },
      expiryDate: { type: "string", description: "YYYY-MM-DD." },
      title: { type: "string", description: "Optional contract title override." },
    },
    required: ["template", "counterparty"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    const orgId = ctx.persona.orgId;
    const { match: template, candidates: tCandidates } = await resolveTemplate(
      orgId,
      String(input.template ?? ""),
    );
    if (!template) {
      if (tCandidates.length > 1) {
        return {
          ok: false,
          errorCode: "ambiguous_template",
          errorMessage: "Multiple templates match.",
          disambiguation: {
            kind: "contract_template",
            options: tCandidates.map((t) => ({ id: t.id, label: t.name, type: t.contractType })),
          },
        };
      }
      return {
        ok: false,
        errorCode: "template_not_found",
        errorMessage: `No active contract template matches "${String(input.template)}". Upload and activate one on the Contracts → Templates page (types: ${CONTRACT_TYPES.join(", ")}).`,
      };
    }
    const resolved = await resolveCounterpartyByName(
      orgId,
      String(input.counterparty ?? ""),
      input.counterpartyKind ? String(input.counterpartyKind) : null,
    );
    let counterparty = resolved.match;
    // Task #967 — roster auto-add for non-equity partner agreements: when
    // the named counterparty is nobody we know, offer to add them to the
    // roster (contractor, role label "Non-Equity Partner", no login) and
    // prepare the agreement against the new roster row.
    let pendingRosterCreate: { name: string; email: string } | null = null;
    if (!counterparty) {
      if (resolved.candidates.length > 1) {
        return {
          ok: false,
          errorCode: "ambiguous_counterparty",
          errorMessage: "Multiple people/organizations match.",
          disambiguation: { kind: "contract_counterparty", options: resolved.candidates },
        };
      }
      const name = String(input.counterparty ?? "").trim();
      if (template.contractType !== NEP_CONTRACT_TYPE) {
        return {
          ok: false,
          errorCode: "counterparty_not_found",
          errorMessage: `Nobody in the roster, contacts, or accounts matches "${name}".`,
        };
      }
      const email = String(input.newPersonEmail ?? "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return {
          ok: false,
          errorCode: "counterparty_not_on_roster",
          errorMessage: `"${name}" is not on the roster yet; their email is needed to add them.`,
          clarification: {
            field: "newPersonEmail",
            question: `"${name}" isn't on the roster yet. What's their email address? I'll add them to the roster as a non-equity partner (contractor, no portal login) and prepare the agreement.`,
            tool: "contract_prepare",
            partial: { ...input, template: template.id },
          },
        };
      }
      // Duplicate guard — same email already on the roster means the same
      // human; reuse that roster row instead of creating a duplicate.
      const [dupEmp] = await db
        .select({ id: atelierEmployees.id })
        .from(atelierEmployees)
        .where(and(eq(atelierEmployees.orgId, orgId), sql`lower(${atelierEmployees.email}) = ${email}`, isNull(atelierEmployees.deletedAt)));
      const [dupCtr] = await db
        .select({ id: atelierContractors.id })
        .from(atelierContractors)
        .where(and(eq(atelierContractors.orgId, orgId), sql`lower(${atelierContractors.email}) = ${email}`, isNull(atelierContractors.deletedAt)));
      const dup = dupEmp ?? dupCtr;
      if (dup) {
        counterparty = await resolveCounterparty(orgId, "person", dup.id);
      }
      if (!counterparty) {
        // Validate the name up front so the confirm card never promises a
        // roster row that would fail structured-name validation on commit.
        try {
          resolveStructuredNameInput({ fullName: name });
        } catch (err) {
          if (err instanceof PersonNameValidationError) {
            return { ok: false, errorCode: "invalid_name", errorMessage: err.message };
          }
          throw err;
        }
        pendingRosterCreate = { name, email };
        counterparty = {
          kind: "person",
          id: "",
          label: name,
          accountId: null,
          autoFill: { counterparty_name: name, counterparty_email: email },
        };
      }
    }

    // Preview the merged values against the current template version.
    const [version] = template.currentVersionId
      ? await db
          .select()
          .from(atelierContractTemplateVersions)
          .where(eq(atelierContractTemplateVersions.id, template.currentVersionId))
      : [];
    if (!version) {
      return {
        ok: false,
        errorCode: "template_not_active",
        errorMessage: "The template's fields must be reviewed and activated first.",
      };
    }
    // Task #237 — every contract must record a Cognirise signing entity; the
    // chat/CLI flow always uses the registry's default entity.
    const { entity: signingEntity } = await resolveSigningEntity(orgId, null);
    if (!signingEntity) {
      return {
        ok: false,
        errorCode: "signing_entity_not_found",
        errorMessage:
          "No Cognirise signing entity is configured. Add a legal entity (and mark one as default) under Settings → Firm profile before preparing contracts.",
      };
    }
    const firm = await firmAutoFill(orgId, signingEntity);
    const explicit = (input.values && typeof input.values === "object"
      ? input.values
      : {}) as Record<string, string>;
    const { values, missingRequired } = buildFieldValues({
      fields: version.fieldSchema,
      counterparty,
      firm,
      explicit,
      effectiveDate: input.effectiveDate ? String(input.effectiveDate) : null,
      expiryDate: input.expiryDate ? String(input.expiryDate) : null,
    });
    if (missingRequired.length > 0) {
      const first = version.fieldSchema.find((f) => f.key === missingRequired[0]);
      // Multi-field clarification — carry the FULL list of missing
      // fields (machine name + human label + hint) so the chat can
      // render one labeled input per field and collect everything in a
      // single round-trip. `field`/`question` stay pointed at the first
      // missing field for backward compatibility with the single-input
      // protocol.
      const schema = normalizeFieldSchema(version.fieldSchema);
      const missingFields = missingRequired.map((key) => {
        const f = schema.find((x) => x.key === key);
        // Task #291 — richer clarification inputs: dropdowns for
        // option-list fields, date pickers for dates, today-default
        // for the firm-side signature date.
        return {
          field: `values.${key}`,
          label: f?.label ?? key,
          ...(f?.note ? { hint: String(f.note) } : {}),
          ...(f?.options && f.options.length > 0 ? { options: f.options } : {}),
          ...(f?.dataType === "date" ? { inputType: "date" as const } : {}),
          ...(f?.dataType === "date" && f?.defaultHint === "today"
            ? { defaultValue: new Date().toISOString().slice(0, 10) }
            : {}),
        };
      });
      const question =
        missingFields.length > 1
          ? `I need a few more values: ${missingFields.map((f) => `"${f.label}"`).join(", ")}.`
          : `What should "${first?.label ?? missingRequired[0]}" be${first?.note ? ` (${first.note})` : ""}?`;
      return {
        ok: false,
        errorCode: "missing_required_fields",
        errorMessage: `Values required for: ${missingRequired.join(", ")}`,
        clarification: {
          field: `values.${missingRequired[0]}`,
          question,
          fields: missingFields,
          tool: "contract_prepare",
          partial: {
            ...input,
            template: template.id,
            // Pending roster creates have no id yet — keep resolving by name
            // (+ newPersonEmail) until the commit actually creates the row.
            counterparty: pendingRosterCreate ? pendingRosterCreate.name : counterparty.id,
            counterpartyKind: counterparty.kind,
            values: { ...explicit, ...values },
          },
        },
      };
    }

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { stage: "preview", template: template.name, counterparty: counterparty.label },
        confirmation: {
          summary: pendingRosterCreate
            ? `Add ${pendingRosterCreate.name} (${pendingRosterCreate.email}) to the roster as a non-equity partner (contractor, no portal login) and prepare "${template.name}" for them — the filled Word draft will be generated for review/redlining.`
            : `Prepare "${template.name}" for ${counterparty.label} — the filled Word draft will be generated for review/redlining.`,
          diff: {
            template: { id: template.id, name: template.name, type: template.contractType },
            counterparty: { kind: counterparty.kind, id: counterparty.id, label: counterparty.label },
            ...(pendingRosterCreate
              ? {
                  rosterCreate: {
                    name: pendingRosterCreate.name,
                    email: pendingRosterCreate.email,
                    workerType: "contractor",
                    roleLabel: NEP_ROLE_LABEL,
                    login: "none",
                  },
                }
              : {}),
            signingEntity: { id: signingEntity.id, name: signingEntity.name },
            values: {
              ...values,
              // Task #291 — reference numbers are only assigned at commit
              // time (race-safe series); show that on the preview.
              ...Object.fromEntries(
                normalizeFieldSchema(version.fieldSchema)
                  .filter((f) => f.role === "reference")
                  .map((f) => [f.key, "(auto-assigned on creation)"]),
              ),
            },
            effectiveDate: input.effectiveDate ?? null,
            expiryDate: input.expiryDate ?? null,
          },
          pending: {
            tool: "contract_prepare",
            input: {
              ...input,
              template: template.id,
              counterparty: pendingRosterCreate ? pendingRosterCreate.name : counterparty.id,
              counterpartyKind: counterparty.kind,
              values: { ...explicit, ...values },
              confirm: true,
            },
          },
        },
      };
    }

    // Task #967 — commit-time roster create for a pending non-equity
    // partner (contractor row, structured-name SoT, no portal login).
    if (pendingRosterCreate) {
      const personWrite = await writePersonAndSync(db, {
        orgId,
        structured: resolveStructuredNameInput({ fullName: pendingRosterCreate.name })!,
        sourceKind: "contractor",
        createdByUserId: ctx.persona.id,
      });
      const personId = `ctr_${rid("x").slice(2)}`;
      await db.insert(atelierContractors).values({
        id: personId,
        orgId,
        personId: personWrite.personId,
        fullName: personWrite.fullName,
        email: pendingRosterCreate.email,
        notes: NEP_ROLE_LABEL,
        status: "active",
      });
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "person",
        entityId: personId,
        actorType: "human",
        actorId: ctx.persona.id,
        actorLabel: ctx.persona.name,
        action: "roster.person.created",
        payload: {
          method: "chat_contract_prepare",
          workerType: "contractor",
          roleLabel: NEP_ROLE_LABEL,
          status: "active",
          email: pendingRosterCreate.email,
          createLogin: false,
        },
        payloadSummary: `${ctx.persona.name} added ${personWrite.fullName} to the roster (non-equity partner) while preparing their agreement in chat.`,
      });
      const created = await resolveCounterparty(orgId, "person", personId);
      if (!created) {
        return {
          ok: false,
          errorCode: "roster_create_failed",
          errorMessage: "The roster entry could not be created.",
        };
      }
      counterparty = created;
    }

    const result = await prepareContract({
      orgId,
      actor: { id: ctx.persona.id, name: ctx.persona.name },
      templateId: template.id,
      counterparty: { kind: counterparty.kind, id: counterparty.id },
      signingEntityId: signingEntity.id,
      title: input.title ? String(input.title) : null,
      values: { ...explicit, ...values },
      effectiveDate: input.effectiveDate ? String(input.effectiveDate) : null,
      expiryDate: input.expiryDate ? String(input.expiryDate) : null,
    });
    if (!result.ok) {
      return { ok: false, errorCode: result.code.replace(/-/g, "_"), errorMessage: result.message };
    }
    return {
      ok: true,
      data: {
        id: result.contract.id,
        kind: "contract",
        contract: contractSummary(result.contract),
        downloadHint: `The filled Word draft is downloadable from the contract page.`,
        navigateTo: { path: `${CONTRACTS_PATH}/${result.contract.id}`, when: "on_commit" },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 2. contract_send_signature
// ---------------------------------------------------------------------------

defineCapability({
  id: "codex.contract_send_signature",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_send_signature",
  description:
    "Send a prepared contract for e-signature: converts the latest Word document to PDF and dispatches it through the DocuSeal e-sign flow. Two-phase confirm; sends outbound email to the signers.",
  slashAliases: { en: ["/contract-send"] },
  representativePrompts: {
    en: ["Send the Acme NDA for signature to jane@acme.com."],
  },
  inputSchema: {
    type: "object",
    properties: {
      confirm: { type: "boolean", description: "Set true to commit." },
      summary: { type: "string", description: "Optional human description." },
      contract: { type: "string", description: "Contract id or title/counterparty text." },
      signers: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["name", "email"],
          additionalProperties: false,
        },
      },
      message: { type: "string", description: "Optional message to the signers." },
    },
    required: ["contract", "signers"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: "email",
  resultCard: "entity_card",
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    const orgId = ctx.persona.orgId;
    const q = String(input.contract ?? "").trim();
    const rows = await db
      .select()
      .from(atelierContractRecords)
      .where(
        and(
          eq(atelierContractRecords.orgId, orgId),
          or(
            eq(atelierContractRecords.id, q),
            ilike(atelierContractRecords.title, `%${q}%`),
            ilike(atelierContractRecords.counterpartyLabel, `%${q}%`),
          ),
        ),
      )
      .orderBy(desc(atelierContractRecords.updatedAt))
      .limit(5);
    const sendable = rows.filter((r) =>
      ["draft", "out_for_review", "final_uploaded"].includes(r.status),
    );
    if (sendable.length === 0) {
      return {
        ok: false,
        errorCode: rows.length > 0 ? "not_sendable" : "not_found",
        errorMessage:
          rows.length > 0
            ? `Matching contract(s) are not in a sendable status (${rows.map((r) => `${r.title}: ${r.status}`).join("; ")}).`
            : `No contract matches "${q}".`,
      };
    }
    if (sendable.length > 1) {
      return {
        ok: false,
        errorCode: "ambiguous_contract",
        errorMessage: "Multiple contracts match.",
        disambiguation: {
          kind: "contract",
          options: sendable.map((r) => ({
            id: r.id,
            label: `${r.title} (${r.status})`,
          })),
        },
      };
    }
    const target = sendable[0];
    const signers = (Array.isArray(input.signers) ? input.signers : []) as Array<{
      name: string;
      email: string;
    }>;

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { stage: "preview", contract: contractSummary(target) },
        confirmation: {
          summary: `Send "${target.title}" for signature to ${signers.map((s) => s.email).join(", ")} — the latest Word document is converted to PDF and emailed via DocuSeal.`,
          diff: {
            contract: contractSummary(target),
            signers,
            message: input.message ?? null,
          },
          pending: {
            tool: "contract_send_signature",
            input: { ...input, contract: target.id, confirm: true },
          },
        },
      };
    }

    // Task #345 — pass the caller identity so the shared service can
    // enforce the authorised-signatory gate when the caller is a signer
    // (implicit firm-side "sign first"); the CLI must not bypass the
    // 403 the REST route enforces.
    const [callerRow] = await db
      .select({ email: atelierUsers.email })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, ctx.persona.id), eq(atelierUsers.orgId, orgId)));
    const result = await sendContract({
      orgId,
      actor: { id: ctx.persona.id, name: ctx.persona.name },
      contractId: target.id,
      signers,
      message: input.message ? String(input.message) : null,
      caller: { userId: ctx.persona.id, email: callerRow?.email ?? null },
    });
    if (!result.ok) {
      return { ok: false, errorCode: result.code.replace(/-/g, "_"), errorMessage: result.message };
    }
    return {
      ok: true,
      data: {
        id: result.contract.id,
        kind: "contract",
        contract: contractSummary(result.contract),
        signatureRequestId: result.signatureRequestId,
        navigateTo: { path: `${CONTRACTS_PATH}/${result.contract.id}`, when: "on_commit" },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 2b. contract_attach_final_and_send (Task #967)
// ---------------------------------------------------------------------------

defineCapability({
  id: "codex.contract_attach_final_and_send",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_attach_final_and_send",
  description:
    "Record a chat-attached revised Word document (.docx) as a contract's FINAL version and immediately send it for e-signature: the attachment is stored as the final Word version, converted to PDF, and dispatched through the DocuSeal e-sign flow. Use when the user attaches an agreed/externally-reviewed revision and asks to trigger signature. Two-phase confirm; sends outbound email to the signers.",
  slashAliases: { en: ["/contract-attach-sign"] },
  representativePrompts: {
    en: [
      "Here's the agreed revision — record it as final and send it for signature.",
      "Attach this revised agreement to the Nowfel contract and trigger the signature process.",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      confirm: { type: "boolean", description: "Set true to commit." },
      summary: { type: "string", description: "Optional human description." },
      contract: { type: "string", description: "Contract id or title/counterparty text." },
      attachmentId: {
        type: "string",
        description: "Chat attachment id of the revised .docx (from attachmentIds).",
      },
      signers: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["name", "email"],
          additionalProperties: false,
        },
      },
      message: { type: "string", description: "Optional message to the signers." },
    },
    required: ["contract", "attachmentId", "signers"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: "email",
  resultCard: "entity_card",
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    const orgId = ctx.persona.orgId;
    const q = String(input.contract ?? "").trim();
    const rows = await db
      .select()
      .from(atelierContractRecords)
      .where(
        and(
          eq(atelierContractRecords.orgId, orgId),
          or(
            eq(atelierContractRecords.id, q),
            ilike(atelierContractRecords.title, `%${q}%`),
            ilike(atelierContractRecords.counterpartyLabel, `%${q}%`),
          ),
        ),
      )
      .orderBy(desc(atelierContractRecords.updatedAt))
      .limit(5);
    // Same editability rule as the REST final-upload route: terminal
    // statuses and out_for_signature cannot take a new final version.
    const editable = rows.filter(
      (r) => !TERMINAL_CONTRACT_STATUSES.has(r.status) && r.status !== "out_for_signature",
    );
    if (editable.length === 0) {
      return {
        ok: false,
        errorCode: rows.length > 0 ? "not_editable" : "not_found",
        errorMessage:
          rows.length > 0
            ? `Matching contract(s) cannot take a final version right now (${rows.map((r) => `${r.title}: ${r.status}`).join("; ")}).`
            : `No contract matches "${q}".`,
      };
    }
    if (editable.length > 1) {
      return {
        ok: false,
        errorCode: "ambiguous_contract",
        errorMessage: "Multiple contracts match.",
        disambiguation: {
          kind: "contract",
          options: editable.map((r) => ({ id: r.id, label: `${r.title} (${r.status})` })),
        },
        // Write-tool disambiguation payloads must carry navigateTo:null.
        data: { navigateTo: null },
      };
    }
    const target = editable[0];

    const attachmentId = String(input.attachmentId ?? "").trim();
    const loaded = await loadAttachment(attachmentId, orgId);
    if (!loaded || loaded.attachment.deletedAt) {
      return {
        ok: false,
        errorCode: "attachment_not_found",
        errorMessage: `Attachment ${attachmentId} was not found (it may have been deleted).`,
      };
    }
    // Own-upload guard — the revision recorded as final must be a file this
    // user attached in chat, not someone else's upload.
    if (loaded.attachment.userId !== ctx.persona.id) {
      return {
        ok: false,
        errorCode: "attachment_not_yours",
        errorMessage: "Only the uploader of the attachment can record it as the final version.",
      };
    }
    if (loaded.attachment.mime !== DOCX_MIME) {
      return {
        ok: false,
        errorCode: "not_a_docx",
        errorMessage: `The final version must be a Word document (.docx); the attachment is ${loaded.attachment.mime}.`,
      };
    }
    const signers = (Array.isArray(input.signers) ? input.signers : []) as Array<{
      name: string;
      email: string;
    }>;

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { stage: "preview", contract: contractSummary(target) },
        confirmation: {
          summary: `Record "${loaded.attachment.fileName}" as the FINAL version of "${target.title}", convert it to PDF, and send it for signature to ${signers.map((s) => s.email).join(", ")} via DocuSeal.`,
          diff: {
            contract: contractSummary(target),
            finalDocument: {
              attachmentId,
              fileName: loaded.attachment.fileName,
              sizeBytes: loaded.attachment.sizeBytes,
            },
            signers,
            message: input.message ?? null,
          },
          pending: {
            tool: "contract_attach_final_and_send",
            input: { ...input, contract: target.id, confirm: true },
          },
        },
      };
    }

    const bytes = await loadAttachmentBytes(loaded.attachment.encryptedRef);
    if (!bytes) {
      return {
        ok: false,
        errorCode: "attachment_bytes_missing",
        errorMessage: "The attachment's file content could not be loaded.",
      };
    }
    // Mirror POST /contracts/:id/final — store the doc, flip the status,
    // audit — then hand off to the shared send flow.
    const doc = await addContractDocument({
      contractId: target.id,
      kind: "final_docx",
      fileName: loaded.attachment.fileName || "final.docx",
      mime: DOCX_MIME,
      bytes,
      actor: { id: ctx.persona.id, label: ctx.persona.name },
    });
    await db
      .update(atelierContractRecords)
      .set({ status: "final_uploaded", currentDocumentId: doc.id, updatedAt: new Date() })
      .where(eq(atelierContractRecords.id, target.id));
    await auditContractEntity({
      entityType: "atelier_contract_record",
      entityId: target.id,
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "contract.final_upload",
      payload: { fileName: doc.fileName, from: target.status, via: "chat", attachmentId },
      summary: `Uploaded final Word version for contract "${target.title}" (chat attachment)`,
    });

    // Authorised-signatory gate + DOCX→PDF + DocuSeal dispatch all live in
    // the shared service (same as contract_send_signature).
    const [callerRow] = await db
      .select({ email: atelierUsers.email })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, ctx.persona.id), eq(atelierUsers.orgId, orgId)));
    const result = await sendContract({
      orgId,
      actor: { id: ctx.persona.id, name: ctx.persona.name },
      contractId: target.id,
      signers,
      message: input.message ? String(input.message) : null,
      caller: { userId: ctx.persona.id, email: callerRow?.email ?? null },
    });
    if (!result.ok) {
      // The final version IS recorded even when the send fails (signatory
      // gate, conversion, DocuSeal outage) — surface that honestly.
      return {
        ok: false,
        errorCode: result.code.replace(/-/g, "_"),
        errorMessage: `The revision was recorded as the final version, but sending for signature failed: ${result.message}`,
      };
    }
    return {
      ok: true,
      data: {
        id: result.contract.id,
        kind: "contract",
        contract: contractSummary(result.contract),
        finalDocumentId: doc.id,
        signatureRequestId: result.signatureRequestId,
        navigateTo: { path: `${CONTRACTS_PATH}/${result.contract.id}`, when: "on_commit" },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 3. contract_status (read)
// ---------------------------------------------------------------------------

defineCapability({
  id: "codex.contract_status",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_status",
  description:
    "Query contract lifecycle status: by counterparty ('what's the contract status with Acme?'), by status ('which contracts are awaiting signature?'), or list recent contracts. Read-only.",
  slashAliases: { en: ["/contract-status"] },
  representativePrompts: {
    en: [
      "What's the contract status with Acme?",
      "Which contracts are awaiting signature?",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Counterparty or title text to filter on." },
      status: {
        type: "string",
        enum: [
          "draft",
          "out_for_review",
          "final_uploaded",
          "out_for_signature",
          "signed",
          "declined",
          "voided",
          "expired",
        ],
      },
    },
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    const conds = [eq(atelierContractRecords.orgId, ctx.persona.orgId)];
    if (input.status) conds.push(eq(atelierContractRecords.status, String(input.status)));
    if (input.query) {
      const q = `%${String(input.query).trim()}%`;
      const textCond = or(
        ilike(atelierContractRecords.title, q),
        ilike(atelierContractRecords.counterpartyLabel, q),
      );
      if (textCond) conds.push(textCond);
    }
    const rows = await db
      .select()
      .from(atelierContractRecords)
      .where(and(...conds))
      .orderBy(desc(atelierContractRecords.updatedAt))
      .limit(25);
    return {
      ok: true,
      data: {
        contracts: rows.map(contractSummary),
        count: rows.length,
        pageHref: CONTRACTS_PATH,
      },
    };
  },
});
