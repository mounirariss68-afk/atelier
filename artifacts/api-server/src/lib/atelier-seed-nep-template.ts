/**
 * Task #969 — boot-time ingestion of the templatized Non-Equity Partner
 * Agreement v3 as the ACTIVE version of the firm's "Non-Equity Partner
 * Agreement" template.
 *
 * Why boot-time instead of a live-API script: task-agent DB writes never
 * merge, the agent holds no founding-partner credentials (passwords are
 * user-managed), and the production DB is only writable through the
 * deployed app. Running the ingestion as an idempotent boot chore (same
 * pattern as the reference/pricing seeds) makes every environment —
 * main dev on the post-merge restart, production on the next publish —
 * pick the template up automatically with no credentials involved.
 *
 * This is CONFIGURATION ingestion (the firm's real contract template),
 * not demo-data seeding, which stays banned (2026-07-16 policy).
 *
 * Idempotent: when the template's current version already carries the v3
 * file name with the reviewed schema and the template is active, this is
 * a no-op. Concurrent instances (autoscale) are serialized with a pg
 * advisory lock. Mirrors the write behaviour of the template routes:
 * bytes to object storage, placeholder verification against the actual
 * document BEFORE activation, prior-review reconciliation, audit events.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, asc, and, ne, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierContractTemplates,
  atelierContractTemplateVersions,
  type ContractTemplateField,
  type PriorFieldReview,
} from "@workspace/db";
import { logger } from "./logger.js";
import {
  rid,
  looksLikeDocx,
  storeContractBytes,
  findMissingPlaceholders,
  normalizeFieldSchema,
  auditContractEntity,
} from "./atelier-contracts.js";
import { NEP_FIELD_SCHEMA } from "./nep-template-schema.js";

// ASCII-only on purpose (matches scripts/ingest-nep-template.ts).
const FILE_NAME = "Non-Equity Partner Agreement - v3 (template).docx";
const TEMPLATE_TYPE = "non_equity_partner_employment";
const TEMPLATE_NAME = "Non-Equity Partner Agreement";
// Distinct advisory-lock key for this chore (int4 range).
const LOCK_KEY = 969_003_001;

/**
 * Load the v3 docx. Bundled server: build.mjs copies it to dist/assets
 * (first candidate, relative to dist/index.mjs — the build FAILS if the
 * copy is missing). Fallbacks cover tsx-from-src and repo-layout runs.
 */
function loadTemplateDocx(): Buffer | null {
  for (const rel of [
    "./assets/non-equity-partner-agreement-template-v3.docx",
    "../../scripts/assets/non-equity-partner-agreement-template-v3.docx",
    "../scripts/assets/non-equity-partner-agreement-template-v3.docx",
  ]) {
    try {
      const buf = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
      if (looksLikeDocx(buf)) return buf;
    } catch {
      /* try next */
    }
  }
  return null;
}

function schemaMatches(current: ContractTemplateField[]): boolean {
  const norm = (fields: ContractTemplateField[]) =>
    JSON.stringify(
      normalizeFieldSchema(fields)
        .map((f) => ({
          key: f.key,
          label: f.label,
          placeholder: f.placeholder,
          dataType: f.dataType,
          autoFill: f.autoFill,
          required: f.required,
          role: f.role ?? "standard",
          ...(f.defaultHint ? { defaultHint: f.defaultHint } : {}),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    );
  return norm(current) === norm(NEP_FIELD_SCHEMA as ContractTemplateField[]);
}

export async function ensureAtelierNepTemplateSeed(): Promise<void> {
  // Actor/org: the earliest founding partner (auth seed runs before this chore).
  const [founder] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.role, "founding_partner"))
    .orderBy(asc(atelierUsers.createdAt))
    .limit(1);
  if (!founder) {
    logger.warn("[nep-template] no founding partner user yet — skipping ingestion");
    return;
  }

  const findTemplate = async () => {
    const [t] = await db
      .select()
      .from(atelierContractTemplates)
      .where(
        and(
          eq(atelierContractTemplates.orgId, founder.orgId),
          eq(atelierContractTemplates.contractType, TEMPLATE_TYPE),
          ne(atelierContractTemplates.status, "archived"),
        ),
      )
      .orderBy(asc(atelierContractTemplates.createdAt))
      .limit(1);
    return t ?? null;
  };

  const isIngested = async (): Promise<boolean> => {
    const template = await findTemplate();
    if (!template || !template.currentVersionId || template.status !== "active") return false;
    const [cv] = await db
      .select()
      .from(atelierContractTemplateVersions)
      .where(eq(atelierContractTemplateVersions.id, template.currentVersionId));
    return Boolean(
      cv &&
        cv.fileName === FILE_NAME &&
        cv.fieldStatus === "reviewed" &&
        schemaMatches(cv.fieldSchema ?? []),
    );
  };

  if (await isIngested()) return; // fast path, no lock

  const [lockRow] = (
    await db.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`)
  ).rows;
  if (!lockRow?.locked) {
    logger.info("[nep-template] another instance is ingesting — skipping");
    return;
  }
  try {
    if (await isIngested()) return; // re-check under the lock

    const buf = loadTemplateDocx();
    if (!buf) {
      logger.error(
        "[nep-template] v3 docx asset not found next to the server bundle — ingestion NOT applied",
      );
      return;
    }
    const fields = normalizeFieldSchema(NEP_FIELD_SCHEMA as ContractTemplateField[]);
    // Same guarantee the PUT /fields route gives: every placeholder must
    // match the actual document before the template activates.
    const missing = await findMissingPlaceholders(
      buf,
      fields.map((f) => f.placeholder),
    );
    if (missing.length > 0) {
      logger.error(
        { missing },
        "[nep-template] placeholder mismatch against v3 docx — ingestion NOT applied",
      );
      return;
    }

    const actor = {
      actorType: "system" as const,
      actorId: founder.id,
      actorLabel: "System (template ingestion)",
    };
    const { blobRef, sha256 } = await storeContractBytes(buf);
    let template = await findTemplate();

    if (!template) {
      const templateId = rid("ctpl");
      const versionId = rid("ctv");
      [template] = await db
        .insert(atelierContractTemplates)
        .values({
          id: templateId,
          orgId: founder.orgId,
          name: TEMPLATE_NAME,
          contractType: TEMPLATE_TYPE,
          status: "draft",
          currentVersionId: versionId,
          createdBy: founder.id,
          createdByLabel: founder.name,
        })
        .returning();
      await db.insert(atelierContractTemplateVersions).values({
        id: versionId,
        orgId: founder.orgId,
        templateId,
        versionNumber: 1,
        fileName: FILE_NAME,
        sizeBytes: buf.length,
        sha256,
        blobRef,
        fieldSchema: fields,
        fieldStatus: "reviewed",
        detectionWarnings: [],
        createdBy: founder.id,
      });
      await auditContractEntity({
        entityType: "atelier_contract_template",
        entityId: templateId,
        ...actor,
        action: "contract_template.create",
        payload: { name: TEMPLATE_NAME, contractType: TEMPLATE_TYPE, fileName: FILE_NAME },
        summary: `Ingested contract template "${TEMPLATE_NAME}" (v3, reviewed schema)`,
      });
    } else {
      const prior = await db
        .select()
        .from(atelierContractTemplateVersions)
        .where(eq(atelierContractTemplateVersions.templateId, template.id));
      const nextNumber = prior.reduce((mx, r) => Math.max(mx, r.versionNumber), 0) + 1;
      // Reconcile the previous reviewed schema like the versions route does.
      let priorFieldReview: PriorFieldReview | null = null;
      const previous = prior.find((v) => v.id === template!.currentVersionId) ?? null;
      if (previous && previous.fieldStatus === "reviewed" && previous.fieldSchema.length > 0) {
        const gone = new Set(
          await findMissingPlaceholders(
            buf,
            previous.fieldSchema.map((f) => f.placeholder),
          ),
        );
        priorFieldReview = {
          fromVersionNumber: previous.versionNumber,
          fields: previous.fieldSchema.map((f) => ({
            ...f,
            status: gone.has(f.placeholder) ? ("missing" as const) : ("carried_over" as const),
          })),
        };
      }
      const versionId = rid("ctv");
      await db.insert(atelierContractTemplateVersions).values({
        id: versionId,
        orgId: founder.orgId,
        templateId: template.id,
        versionNumber: nextNumber,
        fileName: FILE_NAME,
        sizeBytes: buf.length,
        sha256,
        blobRef,
        fieldSchema: fields,
        fieldStatus: "reviewed",
        detectionWarnings: [],
        priorFieldReview,
        createdBy: founder.id,
      });
      await db
        .update(atelierContractTemplates)
        .set({ currentVersionId: versionId, updatedAt: new Date() })
        .where(eq(atelierContractTemplates.id, template.id));
      await auditContractEntity({
        entityType: "atelier_contract_template",
        entityId: template.id,
        ...actor,
        action: "contract_template.new_version",
        payload: { versionNumber: nextNumber, fileName: FILE_NAME },
        summary: `Ingested v${nextNumber} of contract template "${template.name}" (v3, reviewed schema)`,
      });
    }

    const [activated] = await db
      .update(atelierContractTemplates)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(atelierContractTemplates.id, template.id))
      .returning();
    await auditContractEntity({
      entityType: "atelier_contract_template",
      entityId: template.id,
      ...actor,
      action: "contract_template.fields_reviewed",
      payload: { fieldCount: fields.length, activated: true },
      summary: `Reviewed ${fields.length} fill-in fields on "${activated.name}" (template activated)`,
    });
    logger.info(
      { templateId: template.id },
      "[nep-template] v3 Non-Equity Partner Agreement template ingested and activated",
    );
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
}
