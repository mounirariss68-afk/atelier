/**
 * Task #297 — Salon recipient share-link auth + audit tests.
 *
 * Hits the live api-server (assumed running on $PORT or 8080) over
 * HTTP to assert the public Salon recipient surface enforces:
 *   1. Unknown / mismatched token   → 404
 *   2. Revoked link                  → 410 "revoked"
 *   3. Expired link                  → 410 "expired"
 *   4. JSON GET is side-effect free  (openCount stays 0)
 *   5. HTML GET increments openCount and writes a single
 *      `proposal.recipient.opened` audit event (one view = one open).
 *
 * Seeds and cleans up its own rows so it can run repeatedly.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  db,
  atelierProposals,
  atelierProposalSections,
  atelierProposalRecipients,
  atelierAuditEvents,
} from "@workspace/db";

const BASE = process.env.API_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 8080}/api/salon`;
const SUFFIX = Date.now().toString(36);
const PROPOSAL_ID = `prp_share_${SUFFIX}`;
const ORG_ID = "aico";

async function seedProposal() {
  await db.insert(atelierProposals).values({
    id: PROPOSAL_ID,
    orgId: ORG_ID,
    opportunityId: `opp_share_${SUFFIX}`,
    title: "Share-link test proposal",
    status: "draft",
    winThemes: [],
    pricingModel: {},
    complianceMatrix: [],
  });
  // Seed one section so renderProposalHtml has content to render.
  await db.insert(atelierProposalSections).values({
    id: `psec_share_${SUFFIX}`,
    proposalId: PROPOSAL_ID,
    sectionId: "exec_summary",
    name: "Executive Summary",
    ownerAgent: "test",
    status: "draft",
    content: "Hello recipient.",
  });
}

function mintRecipient(overrides: Partial<typeof atelierProposalRecipients.$inferInsert> = {}) {
  const id = `prc_${randomBytes(4).toString("hex")}_${SUFFIX}`;
  const token = randomBytes(24).toString("base64url");
  return { id, token, overrides };
}

async function insertRecipient(spec: { id: string; token: string; overrides: Partial<typeof atelierProposalRecipients.$inferInsert> }) {
  await db.insert(atelierProposalRecipients).values({
    id: spec.id,
    orgId: ORG_ID,
    proposalId: PROPOSAL_ID,
    recipientName: "Test Recipient",
    recipientEmail: null,
    recipientOrg: null,
    token: spec.token,
    expiresAt: null,
    createdByUserId: "u_test",
    ...spec.overrides,
  });
  return spec;
}

async function cleanup() {
  await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, PROPOSAL_ID));
  await db.delete(atelierProposalRecipients).where(eq(atelierProposalRecipients.proposalId, PROPOSAL_ID));
  await db.delete(atelierProposalSections).where(eq(atelierProposalSections.proposalId, PROPOSAL_ID));
  await db.delete(atelierProposals).where(eq(atelierProposals.id, PROPOSAL_ID));
}

let exitCode = 0;
try {
  await cleanup();
  await seedProposal();

  // 1. Unknown token → 404
  const r404 = await fetch(`${BASE}/proposal/${PROPOSAL_ID}/not-a-real-token`);
  assert.equal(r404.status, 404, "unknown token returns 404");

  // 2. Revoked → 410 "revoked"
  const revoked = await insertRecipient(mintRecipient({ revokedAt: new Date() }));
  const rRevoked = await fetch(`${BASE}/proposal/${PROPOSAL_ID}/${revoked.token}`);
  assert.equal(rRevoked.status, 410, "revoked link returns 410");
  const revokedBody = await rRevoked.json();
  assert.equal(revokedBody.error, "revoked", "revoked reason surfaced");

  // 3. Expired → 410 "expired"
  const expired = await insertRecipient(mintRecipient({ expiresAt: new Date(Date.now() - 60_000) }));
  const rExpired = await fetch(`${BASE}/proposal/${PROPOSAL_ID}/${expired.token}`);
  assert.equal(rExpired.status, 410, "expired link returns 410");
  const expiredBody = await rExpired.json();
  assert.equal(expiredBody.error, "expired", "expired reason surfaced");

  // 4. Live recipient: JSON is side-effect free.
  const live = await insertRecipient(mintRecipient());
  const rJson = await fetch(`${BASE}/proposal/${PROPOSAL_ID}/${live.token}`);
  assert.equal(rJson.status, 200, "valid link JSON 200");
  const jsonBody = await rJson.json();
  assert.equal(jsonBody.proposalId, PROPOSAL_ID);
  assert.ok(jsonBody.recipient, "recipient block present in payload");

  const [afterJson] = await db
    .select({ openCount: atelierProposalRecipients.openCount })
    .from(atelierProposalRecipients)
    .where(eq(atelierProposalRecipients.id, live.id));
  assert.equal(afterJson.openCount, 0, "JSON GET does not record an open");

  // 5. HTML GET increments openCount + writes exactly one audit event.
  const rHtml = await fetch(`${BASE}/proposal/${PROPOSAL_ID}/${live.token}/html`);
  assert.equal(rHtml.status, 200, "HTML GET 200");
  const html = await rHtml.text();
  assert.ok(html.includes("Test Recipient"), "fixed header carries recipient name");
  assert.ok(html.includes("IntersectionObserver"), "scroll-spy script ships in hosted HTML");

  const [afterHtml] = await db
    .select({ openCount: atelierProposalRecipients.openCount })
    .from(atelierProposalRecipients)
    .where(eq(atelierProposalRecipients.id, live.id));
  assert.equal(afterHtml.openCount, 1, "HTML GET increments openCount to 1");

  const audits = await db
    .select({ action: atelierAuditEvents.action })
    .from(atelierAuditEvents)
    .where(eq(atelierAuditEvents.entityId, PROPOSAL_ID));
  const opens = audits.filter((a) => a.action === "proposal.recipient.opened");
  assert.equal(opens.length, 1, "exactly one open audit per HTML view");

  console.log("ok — recipient share-link auth + audit behavior is correct");
} catch (err) {
  exitCode = 1;
  console.error("recipient-share test FAILED:", err);
} finally {
  await cleanup();
  process.exit(exitCode);
}
