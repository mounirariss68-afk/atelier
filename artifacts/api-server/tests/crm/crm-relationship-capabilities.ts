import assert from "node:assert/strict";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  authorizeAndCapCrmRows,
  crmFreshness,
  crmRelationshipEnvelope,
  mergeCrmCandidates,
  type CrmRelationshipRow,
} from "../../src/lib/atelier-cli/crm-relationship-capabilities.js";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierCrmAliases,
  atelierOpportunities,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { findByToolName } from "../../src/lib/atelier-cli/capability-catalog.js";
import type { CliPersona, ToolContext } from "../../src/lib/atelier-cli/index.js";
import { normalizeAlias } from "../../src/routes/atelier/crmAliasRoutes.js";

const row = (id: string, kind = "contact"): CrmRelationshipRow => ({
  id,
  kind,
  label: id,
  updated_at: new Date().toISOString(),
  relation: "test.related",
});

// An alias and a different canonical target must remain ambiguous.
const collision = mergeCrmCandidates(
  [{ id: "acct_alias", label: "Acme (alias)" }],
  [{ id: "acct_canonical", label: "Acme" }],
);
assert.deepEqual(collision.map((candidate) => candidate.id), ["acct_alias", "acct_canonical"]);
assert.equal(normalizeAlias("Ac\u200Bme"), "acme");

// ACL filtering happens before capping: hidden rows neither disclose nor
// consume the public limit.
const authorized = await authorizeAndCapCrmRows(
  [row("hidden"), row("visible-1"), row("archived"), row("visible-2")],
  (candidate) => !["hidden", "archived"].includes(candidate.id),
  2,
);
assert.deepEqual(authorized.map((candidate) => candidate.id), ["visible-1", "visible-2"]);

// A stale/archived source candidate is rejected by the same authorization
// boundary; freshness is metadata, not a reason to resurrect an inaccessible
// record.
const liveOnly = await authorizeAndCapCrmRows(
  [row("stale"), row("live")],
  (candidate) => candidate.id === "live",
  8,
);
assert.deepEqual(liveOnly.map((candidate) => candidate.id), ["live"]);
assert.equal(crmFreshness(new Date(Date.now() - 31 * 86_400_000).toISOString()), "stale");

// Canonical person links remain CRM contacts only; HR and partner-resource
// domains are intentionally out of this semantic surface.
const envelope = crmRelationshipEnvelope(
  { id: "person-1", kind: "person", freshness: "fresh" },
  [
    { kind: "contact", id: "contact-1", source: "atelier_contacts" },
  ],
);
assert.equal(envelope.bounded.maxHops, 1);
assert.equal(envelope.relationships.length, 1);
assert.equal(envelope.relationships[0]?.kind, "contact");
assert.ok(envelope.relationships.every((relationship) => relationship.source));

console.log("CRM relationship capability contract passed");

// Exercise the actual registered capability against authoritative DB rows.
// This deliberately uses a unique org so the contract remains repeatable.
const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const org = `org_crm_rel_${suffix}`;
const account = `acct_crm_rel_${suffix}`;
const hiddenAccount = `acct_crm_rel_hidden_${suffix}`;
const opportunity = `opp_crm_rel_${suffix}`;
const contact = `con_crm_rel_${suffix}`;
const aliasId = `calias_crm_rel_${suffix}`;
const persona: CliPersona = {
  id: `user_crm_rel_${suffix}`,
  name: "CRM relationship probe",
  role: "consultant",
  orgId: org,
} as CliPersona;
const ctx: ToolContext = {
  persona,
  turnId: `turn_${suffix}`,
  sessionId: `session_${suffix}`,
  stepIdx: 0,
} as ToolContext;
try {
  await db.insert(atelierAccounts).values({
    id: account, orgId: org, name: "CRM Relationship Probe Account",
    country: "AE", sector: "technology", partnerOwnerId: persona.id,
  });
  await db.insert(atelierAccounts).values({
    id: hiddenAccount, orgId: org, name: "CRM Relationship Probe Account",
    country: "AE", sector: "technology",
  });
  await db.insert(atelierOpportunities).values({
    id: opportunity, orgId: org, slug: `probe-${suffix}`,
    name: "CRM Relationship Probe Opportunity", accountId: account,
    partnerOwnerId: persona.id, engagementLeadId: persona.id,
    dealSizeHypothesis: 1000, probabilityPct: 25,
    nextMilestone: "Probe milestone", sourceLead: "test",
  });
  await db.insert(atelierContacts).values({
    id: contact, orgId: org, accountId: account,
    fullName: "CRM Relationship Probe Contact",
    sourceUrl: "https://example.com/probe-contact",
  });
  await db.insert(atelierCrmAliases).values({
    id: aliasId,
    orgId: org,
    targetKind: "account",
    targetId: account,
    alias: `Probe ali\u200Bas ${suffix}`,
    normalizedAlias: normalizeAlias(`Probe ali\u200Bas ${suffix}`),
    status: "active",
    sourceKind: "manual_review",
    sourceRef: `crm-test:${suffix}`,
    createdBy: persona.id,
  });
  const cap = findByToolName("crm_relationships");
  assert.ok(cap, "crm_relationships must be registered by bootstrap");
  const result = await cap!.run({ kind: "account", id: account }, ctx);
  assert.equal(result.ok, true, `actual capability failed: ${JSON.stringify(result)}`);
  const data = (result as { data: {
    root: Record<string, unknown>;
    relationships: Array<Record<string, unknown>>;
    bounded: { maxHops: number };
  } }).data;
  assert.equal(data.bounded.maxHops, 1);
  assert.equal(data.root.source, "atelier_accounts");
  assert.ok(data.relationships.some((r) => r.id === opportunity && r.kind === "opportunity"));
  assert.ok(data.relationships.some((r) => r.id === contact && r.kind === "contact"));
  assert.ok(data.relationships.every((r) => r.source));
  const contactRelationship = data.relationships.find((r) => r.id === contact);
  assert.deepEqual(
    (contactRelationship?.provenance as { evidence?: unknown[] })?.evidence,
    [{ kind: "source_url", url: "https://example.com/probe-contact" }],
  );

  // A hidden same-name candidate must be removed before ambiguity options are
  // built; its label/count must never cross the ACL boundary.
  const queryResult = await cap!.run({
    kind: "account", query: "CRM Relationship Probe Account",
  }, ctx);
  assert.equal(queryResult.ok, true);
  const queryData = (queryResult as { data: { root?: { id?: string }; options?: unknown[] } }).data;
  assert.equal(queryData.root?.id, account);
  assert.equal(queryData.options, undefined);

  // Alias provenance is retained, but archiving the authoritative account
  // makes the alias unresolvable until the same canonical record is restored.
  const aliasResult = await cap!.run({
    kind: "account",
    query: `Probe ali\u200Bas ${suffix}`,
  }, ctx);
  assert.equal(aliasResult.ok, true);
  const aliasRoot = (aliasResult as { data: { root: {
    id: string;
    provenance: { sourceId: string; sourceKind: string; sourceRef?: string };
  } } }).data.root;
  assert.equal(aliasRoot.id, account);
  assert.equal(aliasRoot.provenance.sourceId, aliasId);
  assert.equal(aliasRoot.provenance.sourceKind, "manual_review");
  assert.equal(aliasRoot.provenance.sourceRef, `crm-test:${suffix}`);

  await db.update(atelierAccounts).set({ status: "archived" })
    .where(eq(atelierAccounts.id, account));
  const archivedAlias = await cap!.run({
    kind: "account",
    query: `Probe ali\u200Bas ${suffix}`,
  }, ctx);
  assert.equal(archivedAlias.ok, false);
  assert.equal(archivedAlias.errorCode, "not_found");

  await db.update(atelierAccounts).set({ status: "prospect" })
    .where(eq(atelierAccounts.id, account));
  const restoredAlias = await cap!.run({
    kind: "account",
    query: `Probe ali\u200Bas ${suffix}`,
  }, ctx);
  assert.equal(restoredAlias.ok, true);
} finally {
  await db.delete(atelierCrmAliases).where(eq(atelierCrmAliases.id, aliasId)).catch(() => {});
  await db.delete(atelierContacts).where(eq(atelierContacts.id, contact)).catch(() => {});
  await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, opportunity)).catch(() => {});
  await db.delete(atelierAccounts).where(eq(atelierAccounts.id, account)).catch(() => {});
  await db.delete(atelierAccounts).where(eq(atelierAccounts.id, hiddenAccount)).catch(() => {});
}