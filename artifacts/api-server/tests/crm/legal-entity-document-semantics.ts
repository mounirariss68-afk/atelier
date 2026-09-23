import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  DEFAULT_COMPANY_REGISTRATION_AND_TAX,
  classifySemanticBundleWithClaude,
  normalizeAlias,
  parseSemanticBundle,
  resolveEntityBundle,
  rolloutMode,
} from "../../src/lib/legal-entity-document-semantics.js";

assert.equal(normalizeAlias("  Cognirise—Dubai  "), "cognirise dubai");
assert.deepEqual(
  parseSemanticBundle("Company registration and tax documents"),
  ["registration", "ejari", "constitutional", "ct", "vat"],
);
assert.deepEqual(
  parseSemanticBundle("Company registration and tax documents without VAT and excluding Ejari"),
  ["registration", "constitutional", "ct"],
);
assert.deepEqual(parseSemanticBundle("constitutional papers"), ["constitutional"]);
assert.deepEqual(parseSemanticBundle("Ejari and VAT"), ["ejari", "vat"]);
assert.deepEqual(parseSemanticBundle("something unrelated"), []);
assert.deepEqual(
  await classifySemanticBundleWithClaude({
    query: "Ejari and government tax enrollment paper without VAT",
    orgId: "probe",
    configured: DEFAULT_COMPANY_REGISTRATION_AND_TAX,
    classify: async () => ({ concepts: ["ct", "vat", "invented"] }),
  }),
  ["ejari", "ct"],
);
assert.deepEqual(
  await classifySemanticBundleWithClaude({
    query: "mysterious papers",
    orgId: "probe",
    configured: DEFAULT_COMPANY_REGISTRATION_AND_TAX,
    classify: async () => ({ concepts: [] }),
  }),
  [],
);
assert.deepEqual(
  await classifySemanticBundleWithClaude({
    query: "tax registration papers",
    orgId: "probe",
    configured: DEFAULT_COMPANY_REGISTRATION_AND_TAX.filter((concept) => concept.key !== "vat"),
    classify: async () => ({ concepts: ["vat"] }),
  }),
  [],
);

const resolved = resolveEntityBundle(
  {
    id: "lent_dubai",
    registrations: [
      { type: "tax_registration_ct", certificateDocumentId: "doc_ct" },
      { type: "tax_registration_vat", certificateDocumentId: "doc_vat" },
    ],
  },
  [
    { id: "doc_reg", title: "Commercial Register", docKind: "commercial_register", currentVersionId: "v1", status: "active", available: true },
    { id: "doc_ejari", title: "Ejari", docKind: "ejari_tenancy", currentVersionId: "v2", status: "active", available: true },
    { id: "doc_moa", title: "Memorandum of Association", docKind: "memorandum_of_association", currentVersionId: "v3", status: "active", available: true },
    { id: "doc_ct", title: "CT Certificate", docKind: "tax_registration_ct", currentVersionId: "v4", status: "active", available: true },
    { id: "doc_vat", title: "VAT Certificate", docKind: "tax_registration_vat", currentVersionId: "v5", status: "active", available: true },
  ],
  DEFAULT_COMPANY_REGISTRATION_AND_TAX,
);
assert.deepEqual(resolved.map((item) => item.outcome), ["resolved", "resolved", "resolved", "resolved", "resolved"]);

const missing = resolveEntityBundle(
  { id: "lent_dubai", registrations: [{ type: "tax_registration_ct", certificateDocumentId: "doc_hidden" }] },
  [],
  DEFAULT_COMPANY_REGISTRATION_AND_TAX.filter((concept) => concept.key === "ct" || concept.key === "vat"),
);
  assert.deepEqual(missing.map((item) => item.outcome), ["stale", "missing"]);

const duplicate = resolveEntityBundle(
  { id: "lent_dubai", registrations: [] },
  [
    { id: "doc_reg_1", title: "Commercial Register A", currentVersionId: "v1", status: "active", available: true },
    { id: "doc_reg_2", title: "Commercial Register B", currentVersionId: "v2", status: "active", available: true },
  ],
  DEFAULT_COMPANY_REGISTRATION_AND_TAX.filter((concept) => concept.key === "registration"),
);
assert.equal(duplicate[0]?.outcome, "duplicate");

const substringFalsePositive = resolveEntityBundle(
  { id: "lent_dubai", registrations: [] },
  [{ id: "doc_samoa", title: "Samoa incorporation certificate", currentVersionId: "v1", status: "active", available: true, versionExists: true }],
  DEFAULT_COMPANY_REGISTRATION_AND_TAX.filter((concept) => concept.key === "constitutional"),
);
assert.deepEqual(substringFalsePositive, [{
  outcome: "missing",
  concept: "constitutional",
  documentIds: [],
}]);

const hiddenTaxDuplicate = resolveEntityBundle(
  {
    id: "lent_dubai",
    registrations: [
      { type: "tax_registration_ct", certificateDocumentId: "doc_visible_ct" },
      { type: "tax_registration_ct", certificateDocumentId: "doc_hidden_ct" },
    ],
  },
  [{ id: "doc_visible_ct", currentVersionId: "v1", status: "active", available: true, versionExists: true }],
  DEFAULT_COMPANY_REGISTRATION_AND_TAX.filter((concept) => concept.key === "ct"),
  [
    { id: "doc_visible_ct", currentVersionId: "v1", status: "active", available: true, versionExists: true },
    { id: "doc_hidden_ct", currentVersionId: "v2", status: "active", available: true, versionExists: true },
  ],
);
assert.deepEqual(hiddenTaxDuplicate, [{
  outcome: "duplicate",
  concept: "ct",
  documentIds: ["doc_visible_ct"],
}]);

assert.equal(rolloutMode({ orgId: "aico", mode: "draft", orgAllowlist: [] }), "off");
assert.equal(rolloutMode({ orgId: "aico", mode: "retrieval", orgAllowlist: ["aico"] }), "retrieval");
assert.equal(rolloutMode({
  orgId: "aico",
  testMailbox: "test@example.com",
  mode: "draft",
  mailboxAllowlist: ["test@example.com"],
}), "draft");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url });
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const orgId = `org_legal_sem_${suffix}`;
const entityId = `lent_legal_sem_${suffix}`;
try {
  const migration = await readFile(
    resolve(process.cwd(), "../../lib/db/drizzle/0096_legal_entity_document_semantics.sql"),
    "utf8",
  );
  await pool.query(migration);
  await pool.query(migration);
  const rls = await pool.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE relname IN ('atelier_legal_entity_aliases','atelier_legal_entity_bundle_definitions')`,
  );
  assert.equal(rls.rowCount, 2);
  assert.ok(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));

  await pool.query(
    `INSERT INTO atelier_legal_entities (id, org_id, legal_name_en, short_name, country)
     VALUES ($1, $2, 'Cognirise Dubai LLC', 'Cognirise Dubai', 'AE')`,
    [entityId, orgId],
  );
  await pool.query(
    `INSERT INTO atelier_legal_entity_aliases
       (id, org_id, entity_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, $3, 'Cognirise Dubai', 'cognirise dubai', 'probe')`,
    [`ealias_1_${suffix}`, orgId, entityId],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO atelier_legal_entity_aliases
         (id, org_id, entity_id, alias, normalized_alias, created_by)
       VALUES ($1, $2, $3, 'COGNIRISE DUBAI', 'cognirise dubai', 'probe')`,
      [`ealias_2_${suffix}`, orgId, entityId],
    ),
    (error: unknown) => (error as { code?: string }).code === "23505",
  );
  await pool.query(
    `UPDATE atelier_legal_entity_aliases SET status='retired', retired_at=now(), retired_by='probe'
      WHERE id=$1`,
    [`ealias_1_${suffix}`],
  );
  await pool.query(
    `INSERT INTO atelier_legal_entity_aliases
       (id, org_id, entity_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, $3, 'Cognirise Dubai', 'cognirise dubai', 'probe')`,
    [`ealias_3_${suffix}`, orgId, entityId],
  );
} finally {
  await pool.query(`DELETE FROM atelier_legal_entity_bundle_definitions WHERE org_id=$1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM atelier_legal_entity_aliases WHERE org_id=$1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM atelier_legal_entities WHERE org_id=$1`, [orgId]).catch(() => {});
  await pool.end();
}

console.log("legal-entity document semantics contract passed");