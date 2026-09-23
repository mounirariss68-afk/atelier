import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  contactBelongsToScopedAccount,
  filterAuthorizedCandidates,
} from "../../src/lib/atelier-cli/entity-resolver.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString: url, max: 4 });
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const orgId = `org_semantic_${suffix}`;
const ids = {
  doc: `doc_semantic_${suffix}`,
  ver: `dver_semantic_${suffix}`,
  ver2: `dver_semantic2_${suffix}`,
  entity: `lent_semantic_${suffix}`,
  raceDocA: `doc_semantic_racea_${suffix}`,
  raceVerA: `dver_semantic_racea_${suffix}`,
  raceEntityA: `lent_semantic_racea_${suffix}`,
  raceDocB: `doc_semantic_raceb_${suffix}`,
  raceVerB: `dver_semantic_raceb_${suffix}`,
  raceEntityB: `lent_semantic_raceb_${suffix}`,
  racePatchDocA: `doc_semantic_patcha_${suffix}`,
  racePatchVerA: `dver_semantic_patcha_${suffix}`,
  racePatchEntityA: `lent_semantic_patcha_${suffix}`,
  racePatchDocB: `doc_semantic_patchb_${suffix}`,
  racePatchVerB: `dver_semantic_patchb_${suffix}`,
  racePatchEntityB: `lent_semantic_patchb_${suffix}`,
  contactA: `contact_semantic_a_${suffix}`,
  contactB: `contact_semantic_b_${suffix}`,
  accountA: `acc_semantic_a_${suffix}`,
  accountB: `acc_semantic_b_${suffix}`,
};

const registration = (documentId: string) => JSON.stringify([{
  type: "tax_registration_ct",
  label: "Corporate Tax",
  number: "TEST",
  certificateDocumentId: documentId,
}]);

async function addDocument(documentId: string, versionId: string): Promise<void> {
  await pool.query(
    `INSERT INTO atelier_documents
       (id, org_id, title, uploader_user_id, uploader_label)
     VALUES ($1, $2, 'Semantic integrity probe', 'probe', 'Probe')`,
    [documentId, orgId],
  );
  await pool.query(
    `INSERT INTO atelier_document_versions
       (id, org_id, document_id, version_number, file_name, mime, size_bytes, sha256, blob_ref, uploader_user_id)
     VALUES ($1, $2, $3, 1, 'probe.pdf', 'application/pdf', 1, $4, $5, 'probe')`,
    [versionId, orgId, documentId, `sha_${versionId}`, `enc:probe:${versionId}`],
  );
  await pool.query(
    `UPDATE atelier_documents SET current_version_id = $1 WHERE id = $2`,
    [versionId, documentId],
  );
}

async function addEntity(entityId: string, registrations = "[]"): Promise<void> {
  await pool.query(
    `INSERT INTO atelier_legal_entities
       (id, org_id, legal_name_en, country, registrations)
     VALUES ($1, $2, 'Semantic Probe LLC', 'AE', $3::jsonb)`,
    [entityId, orgId, registrations],
  );
}

async function expectPgCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    assert.fail(`expected PostgreSQL error ${code}`);
  } catch (error) {
    assert.equal((error as { code?: string }).code, code);
  }
}

function capturePgFailure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error) => error,
  );
}

async function expectCapturedPgCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise;
  assert.equal((error as { code?: string } | null)?.code, code);
}

try {
  const migration = await readFile(
    resolve(process.cwd(), "../../lib/db/drizzle/0095_semantic_projection_rls.sql"),
    "utf8",
  );
  await pool.query(migration);
  await pool.query(migration);

  const rls = await pool.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN (
      'atelier_document_chunk_embeddings',
      'atelier_entity_embeddings',
      'atelier_partner_capability_chunks',
      'atelier_strategy_exemplars'
    )
  `);
  assert.ok(rls.rows.length >= 3);
  assert.ok(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));

  await addDocument(ids.doc, ids.ver);
  await addEntity(ids.entity, registration(ids.doc));
  await pool.query(
    `INSERT INTO atelier_document_versions
       (id, org_id, document_id, version_number, file_name, mime, size_bytes, sha256, blob_ref, uploader_user_id)
     VALUES ($1, $2, $3, 2, 'probe-v2.pdf', 'application/pdf', 1, $4, $5, 'probe')`,
    [ids.ver2, orgId, ids.doc, `sha_${ids.ver2}`, `enc:probe:${ids.ver2}`],
  );
  await expectPgCode(
    pool.query(`UPDATE atelier_documents SET current_version_id = $1 WHERE id = $2`, [ids.ver2, ids.doc]),
    "23503",
  );
  await expectPgCode(
    pool.query(`UPDATE atelier_documents SET status = 'deleted', deleted_at = now() WHERE id = $1`, [ids.doc]),
    "23503",
  );
  await expectPgCode(
    pool.query(`UPDATE atelier_documents SET entity_id = 'lent_other' WHERE id = $1`, [ids.doc]),
    "23503",
  );
  await expectPgCode(
    pool.query(`UPDATE atelier_documents SET doc_kind = 'other' WHERE id = $1`, [ids.doc]),
    "23503",
  );
  await expectPgCode(
    pool.query(
      `UPDATE atelier_legal_entities SET registrations = $1::jsonb WHERE id = $2`,
      [JSON.stringify([
        ...JSON.parse(registration(ids.doc)),
        ...JSON.parse(registration(ids.doc)),
      ]), ids.entity],
    ),
    "23514",
  );

  // Document mutation wins the lock: a later registry claim revalidates and fails.
  await addDocument(ids.raceDocA, ids.raceVerA);
  await addEntity(ids.raceEntityA);
  const deleteFirst = await pool.connect();
  const claimSecond = await pool.connect();
  try {
    await deleteFirst.query("BEGIN");
    await claimSecond.query("BEGIN");
    await deleteFirst.query(
      `UPDATE atelier_documents SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [ids.raceDocA],
    );
    const claim = capturePgFailure(claimSecond.query(
      `UPDATE atelier_legal_entities SET registrations = $1::jsonb WHERE id = $2`,
      [registration(ids.raceDocA), ids.raceEntityA],
    ));
    await new Promise((done) => setTimeout(done, 50));
    await deleteFirst.query("COMMIT");
    await expectCapturedPgCode(claim, "23503");
    await claimSecond.query("ROLLBACK");
  } finally {
    deleteFirst.release();
    claimSecond.release();
  }

  // Registry claim wins the lock: a later document mutation sees the pointer and fails.
  await addDocument(ids.raceDocB, ids.raceVerB);
  await addEntity(ids.raceEntityB);
  const claimFirst = await pool.connect();
  const deleteSecond = await pool.connect();
  try {
    await claimFirst.query("BEGIN");
    await deleteSecond.query("BEGIN");
    await claimFirst.query(
      `UPDATE atelier_legal_entities SET registrations = $1::jsonb WHERE id = $2`,
      [registration(ids.raceDocB), ids.raceEntityB],
    );
    const remove = capturePgFailure(deleteSecond.query(
      `UPDATE atelier_documents SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [ids.raceDocB],
    ));
    await new Promise((done) => setTimeout(done, 50));
    await claimFirst.query("COMMIT");
    await expectCapturedPgCode(remove, "23503");
    await deleteSecond.query("ROLLBACK");
  } finally {
    claimFirst.release();
    deleteSecond.release();
  }

  // Linkage PATCH wins the lock: a later registry claim revalidates the
  // document's authoritative entity association and rejects the claim.
  await addDocument(ids.racePatchDocA, ids.racePatchVerA);
  await addEntity(ids.racePatchEntityA);
  const patchFirst = await pool.connect();
  const patchClaimSecond = await pool.connect();
  try {
    await patchFirst.query("BEGIN");
    await patchClaimSecond.query("BEGIN");
    await patchFirst.query(
      `UPDATE atelier_documents SET entity_id = 'lent_competing' WHERE id = $1`,
      [ids.racePatchDocA],
    );
    const claim = capturePgFailure(patchClaimSecond.query(
      `UPDATE atelier_legal_entities SET registrations = $1::jsonb WHERE id = $2`,
      [registration(ids.racePatchDocA), ids.racePatchEntityA],
    ));
    await new Promise((done) => setTimeout(done, 50));
    await patchFirst.query("COMMIT");
    await expectCapturedPgCode(claim, "23503");
    await patchClaimSecond.query("ROLLBACK");
  } finally {
    patchFirst.release();
    patchClaimSecond.release();
  }

  // Registry claim wins the lock: a later generic linkage PATCH sees the
  // new pointer and cannot move or reclassify the canonical certificate.
  await addDocument(ids.racePatchDocB, ids.racePatchVerB);
  await addEntity(ids.racePatchEntityB);
  const patchClaimFirst = await pool.connect();
  const patchSecond = await pool.connect();
  try {
    await patchClaimFirst.query("BEGIN");
    await patchSecond.query("BEGIN");
    await patchClaimFirst.query(
      `UPDATE atelier_legal_entities SET registrations = $1::jsonb WHERE id = $2`,
      [registration(ids.racePatchDocB), ids.racePatchEntityB],
    );
    const patch = capturePgFailure(patchSecond.query(
      `UPDATE atelier_documents SET entity_id = 'lent_competing', doc_kind = 'other' WHERE id = $1`,
      [ids.racePatchDocB],
    ));
    await new Promise((done) => setTimeout(done, 50));
    await patchClaimFirst.query("COMMIT");
    await expectCapturedPgCode(patch, "23503");
    await patchSecond.query("ROLLBACK");
  } finally {
    patchClaimFirst.release();
    patchSecond.release();
  }

  const resolverActorId = `usr_semantic_${suffix}`;
  await pool.query(
    `INSERT INTO atelier_accounts
       (id, org_id, name, country, sector, partner_owner_id)
     VALUES ($1, $3, 'Scoped Account', 'AE', 'Test', $4),
            ($2, $3, 'Other Account', 'AE', 'Test', 'someone_else')`,
    [ids.accountA, ids.accountB, orgId, resolverActorId],
  );
  await pool.query(
    `INSERT INTO atelier_contacts (id, org_id, account_id, full_name)
     VALUES ($1, $2, $4, 'Scoped Contact'),
            ($3, $2, $5, 'Other Account Contact')`,
    [ids.contactA, orgId, ids.contactB, ids.accountA, ids.accountB],
  );
  assert.equal(await contactBelongsToScopedAccount({
    contactId: ids.contactA,
    orgId,
    accountId: ids.accountA,
  }), true);
  assert.equal(await contactBelongsToScopedAccount({
    contactId: ids.contactB,
    orgId,
    accountId: ids.accountA,
  }), false, "a contact from another account must not pass a restricted scoped lookup");
  const scopedVector = await filterAuthorizedCandidates(
    "contact",
    [
      { id: ids.contactA, label: "Stale Scoped Label", score: 0.9, via: "vector" },
      { id: ids.contactB, label: "Stale Other Label", score: 0.8, via: "vector" },
    ],
    { id: resolverActorId, orgId, role: "consultant" },
    { accountId: ids.accountA },
  );
  assert.deepEqual(
    scopedVector.map(({ id, label }) => ({ id, label })),
    [{ id: ids.contactA, label: "Scoped Contact" }],
    "the complete vector pipeline must keep the authorized live contact, refresh its label, and reject cross-account candidates",
  );

  console.log("semantic source integrity database contract passed");
} finally {
  await pool.query(`DELETE FROM atelier_contacts WHERE org_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM atelier_accounts WHERE org_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM atelier_legal_entities WHERE org_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM atelier_document_versions WHERE org_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM atelier_documents WHERE org_id = $1`, [orgId]).catch(() => {});
  await pool.end();
}