/**
 * Task #1136 — live probe on a SCRATCH DB: Payroll Clerk draft flow +
 * WPS SIF export end-to-end. Run:
 *   CRM_TEST_DB_NAME=crm_test_wps pnpm --filter @workspace/api-server exec tsx scripts/payroll-clerk-probe.ts
 */
import "../tests/crm/scratch-db.js"; // MUST be first: rewrites DATABASE_URL

const { db, atelierUsers, atelierLegalEntities, atelierEmployees, atelierNotifications, atelierWpsSifExports, atelierFinanceComplianceEntries, atelierAgentRuns, atelierAuditEvents } = await import("@workspace/db");
const { and, eq, like, sql } = await import("drizzle-orm");
const { runPayrollClerk } = await import("../src/lib/atelier-agents/payrollClerk.js");
const { computePayrollRun, postPayrollRun } = await import("../src/lib/atelier-payroll/payrollRun.js");
const { previewWpsSif, exportWpsSif } = await import("../src/lib/atelier-payroll/wpsSifExport.js");
const { runAgentExclusive, launchAgentExclusive } = await import("../src/lib/atelier-agents/exclusive-runs.js");
const { getLatestJob } = await import("../src/lib/background-jobs.js");

const ORG = "aico";
const PERIOD = "2026-08";
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { console.log(`  ok  ${name}`); return; }
  failures++;
  console.error(`FAIL  ${name}`, JSON.stringify(detail ?? "", null, 0)?.slice(0, 600));
}

// ── Rerun-safe cleanup (scratch DB persists across runs) ──
const { atelierPayrollRuns, atelierPayrollLines } = await import("@workspace/db");
await db.delete(atelierNotifications).where(eq(atelierNotifications.kind, "payroll_clerk_draft"));
await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.agentId, "ag_payroll_clerk"));
await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.action, "payroll.wps_sif_exported"));
await db.delete(atelierWpsSifExports).where(like(atelierWpsSifExports.legalEntityId, "ent_wps_%"));
await db.delete(atelierFinanceComplianceEntries).where(sql`${atelierFinanceComplianceEntries.data} ->> 'sourceKey' LIKE 'stat_ent_wps_%'`);
await db.delete(atelierPayrollLines).where(sql`${atelierPayrollLines.employeeId} LIKE 'emp_wps_%'`);
await db.delete(atelierPayrollRuns).where(like(atelierPayrollRuns.legalEntityId, "ent_wps_%"));
await db.delete(atelierPayrollLines).where(sql`${atelierPayrollLines.runId} NOT IN (select id from atelier_payroll_runs)`);
await db.delete(atelierEmployees).where(like(atelierEmployees.id, "emp_wps_%"));
await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.id, "ent_wps_%"));
await db.delete(atelierUsers).where(like(atelierUsers.id, "u_probe_%"));
await db.execute(sql`delete from atelier_background_jobs where kind = 'payroll_clerk'`);
await db.execute(sql`delete from atelier_gl_journal_entry where source_ref like '%ent_wps_%' or memo like '%Probe%'`).catch(() => {});

// ── Seed ──
await db.insert(atelierUsers).values({
  id: "u_probe_fin", orgId: ORG, name: "Probe Finance", email: "probe-fin@x.test",
  initials: "PF", role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner",
} as typeof atelierUsers.$inferInsert);

await db.insert(atelierLegalEntities).values([
  {
    id: "ent_wps_main", orgId: ORG, legalNameEn: "Probe Consulting FZ-LLC", shortName: "Probe Main",
    country: "AE", jurisdiction: "Dubai", baseCurrency: "AED", status: "active",
    statutory: { wps: { applicable: true, employerUniqueId: "1234567890123", agentBankRoutingCode: "999888777" } },
  },
  {
    id: "ent_wps_difc", orgId: ORG, legalNameEn: "Probe Capital DIFC Ltd", shortName: "Probe DIFC",
    country: "AE", jurisdiction: "DIFC", baseCurrency: "AED", status: "active",
    statutory: { freeZoneRegime: "DIFC" },
  },
] as (typeof atelierLegalEntities.$inferInsert)[]);

await db.insert(atelierEmployees).values([
  { // complete GCC national — included in SIF; pension is a separate GPSSA filing line
    id: "emp_wps_1", orgId: ORG, fullName: "Aisha Al Mansoori", email: "aisha@x.test", role: "consultant",
    legalEntityId: "ent_wps_main", status: "active", employmentStatus: "active",
    baseCompensation: 360000, baseCurrency: "AED", startDate: "2023-01-01", nationality: "AE",
    iban: "AE070331234567890123456", mohrePersonId: "12345678901234", bankRoutingCode: "111222333",
  },
  { // expat missing MOHRE id — draft ok, EXCLUDED from SIF
    id: "emp_wps_2", orgId: ORG, fullName: "Deniz Kaya", email: "deniz@x.test", role: "consultant",
    legalEntityId: "ent_wps_main", status: "active", employmentStatus: "active",
    baseCompensation: 240000, baseCurrency: "AED", startDate: "2024-03-01", nationality: "TR",
    iban: "AE770331234567890123457", bankRoutingCode: "111222333",
  },
  { // leaver mid-period, no settlement started
    id: "emp_wps_3", orgId: ORG, fullName: "Omar Haddad", email: "omar@x.test", role: "consultant",
    legalEntityId: "ent_wps_main", status: "active", employmentStatus: "active",
    baseCompensation: 300000, baseCurrency: "AED", startDate: "2022-06-01", endDate: "2026-08-14", nationality: "JO",
    iban: "AE500331234567890123458", mohrePersonId: "22345678901234", bankRoutingCode: "111222333",
  },
] as (typeof atelierEmployees.$inferInsert)[]);

// Boot-seeded demo/reviewer employees are not entity-linked and would fail
// run validation on a multi-entity org — park them out of scope.
await db.update(atelierEmployees).set({ deletedAt: new Date() })
  .where(sql`${atelierEmployees.id} NOT LIKE 'emp_wps_%'`);

// Cross-tenant isolation fixtures: another org with a finance user and an
// active AE entity — the clerk must never draft or notify across orgs.
await db.insert(atelierUsers).values({
  id: "u_probe_otherorg", orgId: "otherorg", name: "Other Org Finance", email: "probe-other@x.test",
  initials: "OF", role: "finance", roleLabel: "Finance", title: "Finance",
} as typeof atelierUsers.$inferInsert);
await db.insert(atelierLegalEntities).values({
  id: "ent_wps_other", orgId: "otherorg", legalNameEn: "Other Org LLC", shortName: "OtherOrg",
  country: "AE", jurisdiction: "Dubai", baseCurrency: "AED", status: "active",
} as typeof atelierLegalEntities.$inferInsert);

// ── 1. Payroll Clerk draft run (through the exclusive lock) ──
const res = await runAgentExclusive({
  agent: "payroll_clerk", orgId: ORG, userId: "u_probe_fin", label: "probe clerk",
  work: () => runPayrollClerk({ orgId: ORG, input: { periodLabel: PERIOD }, triggeredByUserId: "u_probe_fin" }),
});
check("clerk ran under exclusive lock", res.ran === true);
if (!res.ran) process.exit(1);
const out = res.result.output;
check("both AE entities covered", out.entities.length === 2, out.entities.map((e) => e.entityId));
const main = out.entities.find((e) => e.entityId === "ent_wps_main");
const difc = out.entities.find((e) => e.entityId === "ent_wps_difc");
check("main draft with exceptions", main?.status === "draft_with_exceptions" && main.headcount === 3, main);
check("DIFC reported WPS-exempt with explanation", difc?.wps?.applicable === false && /DIFC/.test(difc?.wps?.exemptReason ?? ""), difc?.wps);
check("SIF exclusion flagged for Deniz", out.exceptions.some((e) => e.code === "sif_exclusion" && e.employeeId === "emp_wps_2"), out.exceptions);
check("leaver settlement flagged for Omar", out.exceptions.some((e) => e.code === "leaver_settlement" && e.employeeId === "emp_wps_3"), out.exceptions);
check("main excludedCount 1", main?.wps?.excludedCount === 1, main?.wps);

const notes = await db.select().from(atelierNotifications).where(and(
  eq(atelierNotifications.userId, "u_probe_fin"),
  eq(atelierNotifications.kind, "payroll_clerk_draft"),
));
check("finance notified with review card", notes.length === 1 && /exception/.test(notes[0].subject ?? ""), notes[0]?.subject);
check("other org's entity never drafted", !out.entities.some((e) => e.entityId === "ent_wps_other"), out.entities.map((e) => e.entityId));
const leaked = await db.select().from(atelierNotifications).where(and(
  eq(atelierNotifications.userId, "u_probe_otherorg"),
  eq(atelierNotifications.kind, "payroll_clerk_draft"),
));
check("no cross-org notification leak", leaked.length === 0, leaked);
{
  const runs = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.agentId, "ag_payroll_clerk"));
  check("agent run recorded with caller org", runs.length === 1 && runs[0].orgId === ORG, runs.map((r) => r.orgId));
}

// Cross-tenant: run the clerk AS the other org — its run row must carry that
// org, cover only that org's entities, and never surface aico data.
{
  const otherRes = await runPayrollClerk({ orgId: "otherorg", input: { periodLabel: PERIOD }, triggeredByUserId: "u_probe_otherorg" });
  check("other-org clerk sees only its own entity", otherRes.output.entities.length === 1 && otherRes.output.entities[0].entityId === "ent_wps_other", otherRes.output.entities.map((e) => e.entityId));
  const runs = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.agentId, "ag_payroll_clerk"));
  const otherRun = runs.find((r) => r.id === otherRes.runId);
  check("other-org run row carries otherorg (not aico)", otherRun?.orgId === "otherorg", runs.map((r) => ({ id: r.id, orgId: r.orgId })));
  const aicoNotes = await db.select().from(atelierNotifications).where(and(
    eq(atelierNotifications.userId, "u_probe_fin"),
    eq(atelierNotifications.kind, "payroll_clerk_draft"),
  ));
  check("aico finance not notified by other-org run", aicoNotes.length === 1, aicoNotes.length);
}

// Exclusive lock: a second launch while a job row is running must refuse.
// (simulate by inserting the running row via launchAgentExclusive with slow work)
const slow = await launchAgentExclusive({
  agent: "payroll_clerk", orgId: ORG, userId: "u_probe_fin", label: "probe slow",
  work: () => new Promise((r) => setTimeout(r, 1500)),
});
check("async launch started", slow.started === true);
const collide = await launchAgentExclusive({
  agent: "payroll_clerk", orgId: ORG, userId: "u_probe_fin", label: "probe collide",
  work: async () => {},
});
check("overlapping run refused", collide.started === false && !collide.started && collide.reason === "already_running");
await new Promise((r) => setTimeout(r, 2000));
const job = await getLatestJob(["payroll_clerk"], "_singleton_", ORG);
check("job completed for status poll", job != null && ["completed", "done"].includes(String(job.status)), job?.status);

// ── 2. Idempotent rerun refreshes drafts only ──
const rerun = await runPayrollClerk({ orgId: ORG, input: { periodLabel: PERIOD }, triggeredByUserId: null });
check("rerun keeps same draft run id", rerun.output.entities.find((e) => e.entityId === "ent_wps_main")?.runId === main?.runId);
const notesAfterRerun = await db.select().from(atelierNotifications).where(and(
  eq(atelierNotifications.userId, "u_probe_fin"),
  eq(atelierNotifications.kind, "payroll_clerk_draft"),
));
check("rerun supersedes notification (no duplicates)", notesAfterRerun.length === 1, notesAfterRerun.length);

// ── 3. Fix the roster gaps, post, export the SIF ──
// Leaver handled: mark Omar's line acceptable by giving settlement? For the
// export we only need SIF-valid identifiers — set Deniz's MOHRE id via the
// same column the audited payroll PATCH writes.
await db.update(atelierEmployees).set({ mohrePersonId: "32345678901234" }).where(eq(atelierEmployees.id, "emp_wps_2"));
const { run } = await computePayrollRun({ orgId: ORG, entityId: "ent_wps_main", periodLabel: PERIOD, createdByUserId: "u_probe_fin" });
check("draft valid after fix", (run.validationErrors ?? []).length === 0, run.validationErrors);

// preview before posting: ready=false (not posted), no problems.
// NOTE: no ensureStatutoryFilings pre-call — the export itself must
// materialize the register row and guarantee the link.
const pre = await previewWpsSif(ORG, run.id);
check("preview applicable, no problems, not ready pre-post", pre.applicable && pre.problems.length === 0 && !pre.ready, pre.problems);

// exempt preview on DIFC run
const { run: difcRun } = await computePayrollRun({ orgId: ORG, entityId: "ent_wps_difc", periodLabel: PERIOD, createdByUserId: "u_probe_fin" });
const preDifc = await previewWpsSif(ORG, difcRun.id);
check("DIFC preview exempt explanation", !preDifc.applicable && /DIFC/.test(preDifc.exemptReason ?? ""), preDifc.exemptReason);
await exportWpsSif({ orgId: ORG, runId: difcRun.id, actor: { id: "u_probe_fin", name: "Probe" } })
  .then(() => check("DIFC export refused", false))
  .catch((e) => check("DIFC export refused", /posted|DIFC|WPS/.test(String(e.message)), e.message));

await postPayrollRun({ orgId: ORG, runId: run.id, postedByUserId: "u_probe_fin" });
const exp = await exportWpsSif({ orgId: ORG, runId: run.id, actor: { id: "u_probe_fin", name: "Probe Finance" } });
check("SIF filename convention", /^1234567890123\d{14}\.SIF$/.test(exp.fileName), exp.fileName);
check("3 EDR records (GCC national included)", exp.recordCount === 3, exp.recordCount);
check("content has EDR for GCC national + SCR", exp.content.includes("EDR,12345678901234") && exp.content.includes("\r\nSCR,1234567890123,"), exp.content);
check("no GPSSA amounts in SIF", !/GPSSA/i.test(exp.content));

const [expRow] = await db.select().from(atelierWpsSifExports).where(eq(atelierWpsSifExports.id, exp.exportId));
check("export recorded who/when/run/hash", expRow?.exportedByUserId === "u_probe_fin" && expRow?.runId === run.id && expRow?.sha256 === exp.sha256, expRow);

// filing register link — WPS row carries the export, GPSSA row stays separate
const filings = await db.select().from(atelierFinanceComplianceEntries).where(and(
  eq(atelierFinanceComplianceEntries.register, "statutory"),
  sql`${atelierFinanceComplianceEntries.data} ->> 'sourceKey' LIKE ${"stat_ent_wps_main_%_" + PERIOD}`,
));
const wpsRow = filings.find((f) => String((f.data as Record<string, unknown>).sourceKey).includes("wps_mohre"));
const gpssaRow = filings.find((f) => String((f.data as Record<string, unknown>).sourceKey).includes("gpssa"));
check("WPS filing row linked to export", !!wpsRow && (wpsRow.data as { sifExport?: { exportId?: string } }).sifExport?.exportId === exp.exportId, wpsRow?.data);
check("GPSSA remains a separate filing line", !!gpssaRow && !(gpssaRow.data as { sifExport?: unknown }).sifExport, gpssaRow ? "ok" : filings.map((f) => (f.data as Record<string, unknown>).sourceKey));
check("export row links compliance entry", expRow?.complianceEntryId === wpsRow?.id);

const audits = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.action, "payroll.wps_sif_exported"));
check("export audited", audits.length === 1 && /Wio portal/.test(audits[0].payloadSummary ?? ""), audits[0]?.payloadSummary);

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nPayroll Clerk + WPS SIF probe passed.");
process.exit(0);
