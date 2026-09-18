/**
 * Isolated, deterministic API integration coverage for partner tagging/filter/report.
 * Run: CRM_TEST_DB_NAME=crm_test_partner_report pnpm exec tsx tests/crm/partner-opportunity-filter-report-probe.ts
 */
import "./scratch-db.js";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers: users, atelierAccounts: accounts, atelierOpportunities: opps,
    atelierPartnerFirms: firms, atelierAllianceJointPipeline: links, atelierPartnerOppGrants: grants,
    atelierAuditEvents: audits } = D;
  const { eq, and, inArray, isNull, sql } = await import("drizzle-orm");
  const { default: app } = await import("../../src/app.js");
  const { extractText } = await import("unpdf");
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  const tag = `partner_report_${Date.now()}`;
  const owner = `${tag}_owner`, reader = `${tag}_reader`, otherOwner = `${tag}_other`;
  const firmA = `${tag}_a`, firmB = `${tag}_b`, foreignFirm = `${tag}_foreign`, blockedFirm = `${tag}_blocked`;
  const account = `${tag}_acct`, accountEur = `${tag}_eur`, foreignAccount = `${tag}_foreign_acct`;
  const deniedRoles = ["employee", "contractor", "partner_firm_resource", "alliance_partner", "recruiter", "board_observer", "non_equity_partner"];
  const userIds = [owner, reader, otherOwner, ...deniedRoles.map((role) => `${tag}_${role}`)];
  const created: string[] = [];
  let checks = 0;
  function check(name: string, value: unknown) {
    assert.ok(value, name);
    checks++;
    console.log(`PASS ${name}`);
  }
  async function api(method: string, path: string, body?: unknown, persona: string | null = owner) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "content-type": "application/json", ...(persona ? { cookie: `atelier_persona=${persona}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const isJson = response.headers.get("content-type")?.includes("application/json");
    return { status: response.status, headers: response.headers, bytes, body: isJson ? JSON.parse(bytes.toString()) : null };
  }
  const input = (name: string, ids?: string[]) => ({
    name, description: "PRIVATE_DESCRIPTION_NEVER_EXPORT", accountId: account,
    runScout: false, partnerFirmIds: ids, dealSizeUsd: 12345, closeDate: "2027-03-20",
  });
  const active = (id: string) => db.select().from(links).where(and(eq(links.opportunityId, id), isNull(links.deletedAt)));
  const constraint = `${tag}_reject`;
  try {
    await db.insert(users).values(userIds.map((id) => ({
      id, orgId: "aico", name: id === owner ? "Ömer Yiş" : id,
      initials: "PR", email: `${id}@example.test`,
      role: id === owner || id === otherOwner ? "founding_partner" : id === reader ? "consultant" : deniedRoles.find((role) => id.endsWith(`_${role}`))!,
      roleLabel: "Probe", title: "Probe",
    })) as typeof users.$inferInsert[]);
    await db.insert(accounts).values([
      { id: account, orgId: "aico", name: "İstanbul Şirketi", country: "TR", sector: "Technology", primaryCurrency: "USD", partnerOwnerId: owner },
      { id: accountEur, orgId: "aico", name: "Avrupa Müşteri", country: "TR", sector: "Technology", primaryCurrency: "EUR", partnerOwnerId: owner },
      { id: foreignAccount, orgId: "other_org", name: "FOREIGN_ACCOUNT_SECRET", country: "TR", sector: "Technology", partnerOwnerId: owner },
    ]);
    await db.insert(firms).values([
      { id: firmA, orgId: "aico", name: "İş Ortaklığı Şirketi — Ömer Yiş" },
      { id: firmB, orgId: "aico", name: "OTHER_PARTNER_MUST_NOT_EXPORT" },
      { id: blockedFirm, orgId: "aico", name: "Rollback Test Firm" },
      { id: foreignFirm, orgId: "other_org", name: "FOREIGN_PARTNER_SECRET" },
    ]);
    const made = await api("POST", "/opportunities", input("İstanbul Dönüşümü Çok Ortaklı Fırsat", [firmA, firmB, firmA]));
    check("create with multiple deduplicated partner firms", made.status === 201 && made.body.opportunity.partnerFirms.length === 2);
    const id = made.body.opportunity.id;
    created.push(id);
    check("wire exposes owner ID immediately", made.body.opportunity.partnerOwnerId === owner);
    let savedLinks = await active(id);
    check("tag creation assigns no economics", savedLinks.length === 2 && savedLinks.every((l) => l.cognirisePct === 0 && l.partnerPct === 0 && l.leadParty === "cognirise"));
    check("no portal grants on create", (await db.select().from(grants).where(eq(grants.opportunityId, id))).length === 0);
    const original = savedLinks.find((l) => l.partnerFirmId === firmA)!;
    await db.update(links).set({ cognirisePct: 73, partnerPct: 27, splitRationale: "SECRET_SPLIT_RATIONALE", allianceLetterStatus: "signed", leadParty: "joint", partnerSourced: true }).where(eq(links.id, original.id));
    const patched = await api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [firmA], name: "İstanbul Büyüme Fırsatı" });
    check("edit returns updated partner projection", patched.status === 200 && patched.body.partnerFirms.length === 1);
    savedLinks = await active(id);
    check("retained association keeps identity and all economics/metadata", savedLinks.length === 1 && savedLinks[0].id === original.id && savedLinks[0].cognirisePct === 73 && savedLinks[0].partnerPct === 27 && savedLinks[0].splitRationale === "SECRET_SPLIT_RATIONALE" && savedLinks[0].allianceLetterStatus === "signed" && savedLinks[0].partnerSourced && savedLinks[0].leadParty === "joint");
    check("removed link is archived not deleted", (await db.select().from(links).where(and(eq(links.opportunityId, id), eq(links.partnerFirmId, firmB))))[0].deletedAt !== null);
    await api("PATCH", `/opportunities/${id}`, { nextMilestone: "INTERNAL_MILESTONE_SECRET" });
    check("omitted tags preserve associations", (await active(id)).length === 1);
    await api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [firmA, firmB] });
    check("re-add uses fresh neutral metadata", (await active(id)).find((l) => l.partnerFirmId === firmB)?.partnerPct === 0);
    const detail = await api("GET", `/opportunities/${id}`);
    check("detail partner projection", detail.body.partnerFirms.length === 2);
    const query = `partnerFirmId=${firmA}&owner=${owner}&stage=prospect&account=${account}&sector=Technology`;
    const listed = await api("GET", `/opportunities?${query}`);
    check("all list filters compose and multi-partner rows count once", listed.status === 200 && listed.body.length === 1 && listed.body[0].id === id);
    check("legacy owner display-name filter remains supported", (await api("GET", `/opportunities?partnerFirmId=${firmA}&owner=${encodeURIComponent("Ömer Yiş")}`)).body.length === 1);
    check("second partner matches same opportunity", (await api("GET", `/opportunities?partnerFirmId=${firmB}`)).body.some((o: { id: string }) => o.id === id));
    check("owner mismatch produces no rows", (await api("GET", `/opportunities?partnerFirmId=${firmA}&owner=${otherOwner}`)).body.length === 0);
    check("stage mismatch produces no rows", (await api("GET", `/opportunities?partnerFirmId=${firmA}&stage=lost`)).body.length === 0);
    check("PDF requires partner selection", (await api("GET", "/opportunities/partner-report.pdf")).status === 400);
    const empty = await api("GET", `/opportunities/partner-report.pdf?partnerFirmId=${firmA}&stage=lost`);
    check("empty PDF result is explicit", empty.status === 404 && empty.body.error === "no-matching-opportunities");
    check("array filter rejected", (await api("GET", `/opportunities?partnerFirmId=${firmA}&owner=x&owner=y`)).status === 400);
    check("reader can filter", (await api("GET", `/opportunities?${query}`, undefined, reader)).status === 200);
    check("reader cannot tag", (await api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [] }, reader)).status === 403);
    check("reader cannot tag on create", (await api("POST", "/opportunities", input("Denied reader create", [firmA]), reader)).status === 403);
    for (const role of deniedRoles) {
      const persona = `${tag}_${role}`;
      const list = await api("GET", `/opportunities?${query}`, undefined, persona);
      const pdf = await api("GET", `/opportunities/partner-report.pdf?${query}`, undefined, persona);
      check(`${role} cannot use partner filter or direct PDF`, [403, 404].includes(list.status) && [403, 404].includes(pdf.status));
    }
    check("unauthenticated direct PDF denied", [401, 403].includes((await api("GET", `/opportunities/partner-report.pdf?${query}`, undefined, null)).status));
    check("foreign firm filter denied", (await api("GET", `/opportunities?partnerFirmId=${foreignFirm}`)).status === 404);
    check("foreign firm PDF denied", (await api("GET", `/opportunities/partner-report.pdf?partnerFirmId=${foreignFirm}`)).status === 404);
    check("foreign firm cannot be tagged", (await api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [foreignFirm], name: "Must not change" })).status === 422);
    check("invalid edit leaves opportunity untouched", (await api("GET", `/opportunities/${id}`)).body.name === "İstanbul Büyüme Fırsatı");
    check("foreign account create denied", (await api("POST", "/opportunities", { ...input("Foreign Account Create", [firmA]), accountId: foreignAccount })).status === 404);
    const foreignId = `${tag}_foreign_opp`;
    created.push(foreignId);
    await db.insert(opps).values({ id: foreignId, orgId: "other_org", slug: foreignId, name: "FOREIGN_OPPORTUNITY_SECRET", accountId: foreignAccount, partnerOwnerId: owner, engagementLeadId: owner, dealSizeHypothesis: 999, probabilityPct: 25, nextMilestone: "Test", sourceLead: "manual" });
    await db.insert(links).values({ id: `${tag}_foreign_link`, orgId: "other_org", opportunityId: foreignId, partnerFirmId: firmA });
    check("foreign opportunity excluded even with malformed cross-org link", !(await api("GET", `/opportunities?partnerFirmId=${firmA}`)).body.some((o: { id: string }) => o.id === foreignId));
    check("foreign opportunity detail denied", (await api("GET", `/opportunities/${foreignId}`)).status === 404);
    check("foreign opportunity tag write denied", (await api("PATCH", `/opportunities/${foreignId}`, { partnerFirmIds: [firmA] })).status === 404);

    // Fault injection ONLY in this isolated scratch DB, after selection validates.
    await db.execute(sql.raw(`ALTER TABLE atelier_alliance_joint_pipeline ADD CONSTRAINT "${constraint}" CHECK (partner_firm_id <> '${blockedFirm}')`));
    const rollbackName = `${tag} ROLLBACK_CREATE`;
    check("association insert failure returns explicit recoverable create failure", (await api("POST", "/opportunities", input(rollbackName, [blockedFirm]))).status === 500);
    check("failed tag insert rolls back opportunity creation", (await db.select().from(opps).where(eq(opps.name, rollbackName))).length === 0);
    check("failed edit returns save failure", (await api("PATCH", `/opportunities/${id}`, { name: "ROLLBACK_EDIT", partnerFirmIds: [blockedFirm] })).status === 500);
    check("failed edit restores removed tags and original fields", (await active(id)).length === 2 && (await api("GET", `/opportunities/${id}`)).body.name === "İstanbul Büyüme Fırsatı");
    await db.execute(sql.raw(`ALTER TABLE atelier_alliance_joint_pipeline DROP CONSTRAINT "${constraint}"`));
    const simultaneous = await Promise.all([
      api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [firmA, firmB, blockedFirm] }),
      api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [firmA, firmB, blockedFirm] }),
      api("POST", "/partners/joint-pipeline", { opportunityId: id, partnerFirmId: blockedFirm }),
    ]);
    check("concurrent tag and canonical writes do not duplicate new active associations", simultaneous[0].status === 200 && simultaneous[1].status === 200 && [201, 409].includes(simultaneous[2].status) && (await active(id)).length === 3);
    check("tag audits committed", (await db.select().from(audits).where(and(eq(audits.entityId, id), eq(audits.action, "opportunity.partners.update")))).length >= 3);
    check("tag edits never grant portal access", (await db.select().from(grants).where(eq(grants.opportunityId, id))).length === 0);

    const excludedRows = [
      { id: `${tag}_wrong_owner`, orgId: "aico", slug: `${tag}_wrong_owner`, name: "WRONG_OWNER_MUST_NOT_EXPORT", accountId: account, partnerOwnerId: otherOwner, engagementLeadId: otherOwner, dealSizeHypothesis: 98765, salesStage: "prospect", probabilityPct: 25, nextMilestone: "Test", sourceLead: "manual" },
      { id: `${tag}_wrong_stage`, orgId: "aico", slug: `${tag}_wrong_stage`, name: "WRONG_STAGE_MUST_NOT_EXPORT", accountId: account, partnerOwnerId: owner, engagementLeadId: owner, dealSizeHypothesis: 98765, salesStage: "runner", probabilityPct: 80, nextMilestone: "Test", sourceLead: "manual" },
    ];
    created.push(...excludedRows.map((row) => row.id));
    await db.insert(opps).values(excludedRows);
    await db.insert(links).values(excludedRows.map((row) => ({ id: `${row.id}_link`, orgId: "aico", opportunityId: row.id, partnerFirmId: firmA })));
    check("combined owner and stage list excludes other tagged deals", (await api("GET", `/opportunities?${query}`)).body.length === 1);
    const single = await api("GET", `/opportunities/partner-report.pdf?${query}`, undefined, reader);
    check("reader PDF uses shared list filters", single.status === 200 && single.headers.get("content-type")?.includes("application/pdf"));
    check("Turkish filename is header-safe", single.headers.get("content-disposition")?.includes("filename*=UTF-8''"));
    const singleText = (await extractText(new Uint8Array(single.bytes), { mergePages: true })).text;
    check("PDF preserves Turkish glyphs and safe columns", singleText.includes("İstanbul Büyüme Fırsatı") && singleText.includes("Ömer Yiş") && singleText.includes("2027-03-20") && singleText.includes("1 opportunities"));
    check("PDF omits descriptions, milestones, splits, other firms and nonmatching deals", !["PRIVATE_DESCRIPTION", "INTERNAL_MILESTONE", "SECRET_SPLIT", "OTHER_PARTNER", "FOREIGN_", "WRONG_OWNER", "WRONG_STAGE"].some((secret) => singleText.includes(secret)));

    // Enough long-name records for a multi-page artifact; EUR is never added to USD.
    const sampleRows = Array.from({ length: 24 }, (_, i) => ({
      id: `${tag}_sample_${i}`, orgId: "aico", slug: `${tag}_sample_${i}`,
      name: `Fırsat ${i + 1} — İstanbul, Şişli ve Çanakkale için sürdürülebilir dönüşüm ve uzun kapsamlı iş ortaklığı programı`,
      accountId: i % 2 ? account : accountEur, partnerOwnerId: owner, engagementLeadId: owner,
      dealSizeHypothesis: 1000, salesStage: "prospect", closeDate: "2027-04-30", probabilityPct: 25, nextMilestone: "Test", sourceLead: "manual",
    }));
    created.push(...sampleRows.map((row) => row.id));
    await db.insert(opps).values(sampleRows);
    await db.insert(links).values(sampleRows.map((row) => ({
      id: `${row.id}_link`, orgId: "aico", opportunityId: row.id, partnerFirmId: firmA,
    })));
    const many = await api("GET", `/opportunities/partner-report.pdf?partnerFirmId=${firmA}&owner=${owner}&stage=prospect`);
    const extracted = await extractText(new Uint8Array(many.bytes), { mergePages: true });
    check("multi-page export includes all rows beyond viewport", many.status === 200 && extracted.totalPages > 1 && extracted.text.includes("25 opportunities") && extracted.text.includes("Fırsat 24"));
    check("currency totals remain separate", extracted.text.includes("EUR 12,000") && extracted.text.includes("USD 24,345"));
    await mkdir("../../.local/deliverables", { recursive: true });
    await writeFile("../../.local/deliverables/partner-opportunity-report-sample.pdf", many.bytes);
    check("empty partner array clears all associations", (await api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [] })).body.partnerFirms.length === 0 && (await active(id)).length === 0);
    check("empty association removed from partner filter", !(await api("GET", `/opportunities?partnerFirmId=${firmB}`)).body.some((o: { id: string }) => o.id === id));
    await db.update(firms).set({ deletedAt: new Date() }).where(eq(firms.id, firmA));
    check("archived firm cannot be filtered or exported", (await api("GET", `/opportunities?partnerFirmId=${firmA}`)).status === 404 && (await api("GET", `/opportunities/partner-report.pdf?partnerFirmId=${firmA}`)).status === 404);
    check("archived firm cannot be tagged", (await api("PATCH", `/opportunities/${id}`, { partnerFirmIds: [firmA] })).status === 422);
    console.log(`PASS ${checks} checks; PDF: .local/deliverables/partner-opportunity-report-sample.pdf`);
  } finally {
    await db.execute(sql.raw(`ALTER TABLE atelier_alliance_joint_pipeline DROP CONSTRAINT IF EXISTS "${constraint}"`));
    if (created.length) {
      await db.delete(links).where(inArray(links.opportunityId, created));
      await db.delete(audits).where(inArray(audits.entityId, created));
      await db.delete(opps).where(inArray(opps.id, created));
    }
    await db.delete(firms).where(inArray(firms.id, [firmA, firmB, foreignFirm, blockedFirm]));
    await db.delete(accounts).where(inArray(accounts.id, [account, accountEur, foreignAccount]));
    await db.delete(users).where(inArray(users.id, userIds));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });