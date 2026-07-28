/**
 * Task #388 — Roster-scoped business-card PDF download access probe.
 *
 * Runs standalone (npx tsx ./tests/roster-card/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass with ephemeral p_test_* personas. Rows cleaned up in `finally`.
 *
 * Coverage (GET /roster/people/:id/business-card.pdf):
 *   1. Full-roster viewer (hr) gets 200 %PDF for BOTH variants
 *      (standard + print) on someone else's card.
 *   2. Manager persona 403s on a person OUTSIDE their reports tree
 *      (and 200s inside the tree, proving the scope predicate — not a
 *      blanket block — is what's gating).
 *   3. Plain employee persona 403s on another person's card.
 *   4. An audit row (action document.downloaded) with payload
 *      kind "business_card_pdf" / self:false is written for the
 *      roster-scope download.
 *   5. Unknown person 404s; bad variant 400s (regression parity with
 *      the manual probe).
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_rchr_${STAMP}`;
const MGR_ID = `p_test_rcmgr_${STAMP}`;
const EMP_ID = `p_test_rcemp_${STAMP}`;
const MGR_PERSON = `emp_test_rcmgr_${STAMP}`;
const REPORT_PERSON = `emp_test_rcrep_${STAMP}`;
const OUTSIDE_PERSON = `emp_test_rcout_${STAMP}`;
const EMP_PERSON = `emp_test_rcemp_${STAMP}`;
const TR_PERSON = `emp_test_rctr_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierRosterReportsTo,
    atelierAuditEvents,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function card(
    personaId: string,
    personId: string,
    variant?: string,
  ): Promise<{ status: number; buf: Buffer; disp: string; type: string }> {
    const q = variant ? `?variant=${variant}` : "";
    const res = await fetch(`${API}/roster/people/${personId}/business-card.pdf${q}`, {
      headers: { cookie: `atelier_persona=${personaId}` },
    });
    return {
      status: res.status,
      buf: Buffer.from(await res.arrayBuffer()),
      disp: res.headers.get("content-disposition") ?? "",
      type: res.headers.get("content-type") ?? "",
    };
  }

  const edgeIds: string[] = [];
  try {
    const personas = [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "RC HR" },
      { id: MGR_ID, role: "senior_manager", roleLabel: "Senior Manager", name: "RC Manager" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "RC Employee" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "RC",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    const people = [
      { id: MGR_PERSON, userId: MGR_ID, fullName: "RC Manager", role: "senior_manager", title: "Senior Manager" },
      { id: REPORT_PERSON, userId: null, fullName: "RC Report", role: "employee", title: "Consultant" },
      { id: OUTSIDE_PERSON, userId: null, fullName: "RC Outside Tree", role: "employee", title: "Analyst" },
      { id: EMP_PERSON, userId: EMP_ID, fullName: "RC Employee", role: "employee", title: "Analyst" },
      // Task #694 — non-ASCII (Turkish) name must not break the download header.
      { id: TR_PERSON, userId: null, fullName: "Ömer Barbaros Yiş", role: "employee", title: "CEO Türkiye" },
    ];
    for (const p of people) {
      await db.insert(atelierEmployees).values({
        id: p.id,
        orgId: ORG,
        userId: p.userId,
        fullName: p.fullName,
        email: `${p.id}@cognirise.ai`,
        role: p.role,
        title: p.title,
        cellPhones: [{ country: "+971", number: "50 111 2222" }],
      });
    }
    // reports_to edge: MGR → REPORT (OUTSIDE_PERSON stays out of tree)
    const edgeId = `rrt_test_rc_${STAMP}`;
    edgeIds.push(edgeId);
    await db.insert(atelierRosterReportsTo).values({
      id: edgeId,
      orgId: ORG,
      personId: REPORT_PERSON,
      managerPersonId: MGR_PERSON,
    });

    // =====================================================================
    group("full-roster viewer (hr) \u2014 both variants 200");
    // =====================================================================
    const std = await card(HR_ID, OUTSIDE_PERSON);
    check(
      "hr standard variant 200 %PDF attachment",
      std.status === 200 &&
        std.type === "application/pdf" &&
        std.buf.subarray(0, 4).toString() === "%PDF" &&
        std.disp.includes("Business_Card"),
      `status=${std.status} type=${std.type} disp=${std.disp}`,
    );
    const prn = await card(HR_ID, OUTSIDE_PERSON, "print");
    check(
      "hr print variant 200 %PDF with _Print filename",
      prn.status === 200 &&
        prn.buf.subarray(0, 4).toString() === "%PDF" &&
        prn.disp.includes("Business_Card_Print.pdf"),
      `status=${prn.status} disp=${prn.disp}`,
    );

    // =====================================================================
    group("manager scope \u2014 tree only");
    // =====================================================================
    const inTree = await card(MGR_ID, REPORT_PERSON);
    check(
      "manager 200 for direct report's card",
      inTree.status === 200 && inTree.buf.subarray(0, 4).toString() === "%PDF",
      `status=${inTree.status}`,
    );
    const outTree = await card(MGR_ID, OUTSIDE_PERSON);
    check(
      "manager 403 outside reports tree",
      outTree.status === 403 &&
        outTree.buf.toString().includes("roster-scope-forbidden"),
      `status=${outTree.status} body=${outTree.buf.toString().slice(0, 120)}`,
    );

    // =====================================================================
    group("employee persona \u2014 403 on others");
    // =====================================================================
    const empTry = await card(EMP_ID, OUTSIDE_PERSON);
    check(
      "employee 403 on another person's card",
      empTry.status === 403,
      `status=${empTry.status} body=${empTry.buf.toString().slice(0, 120)}`,
    );

    // =====================================================================
    group("Task #694 \u2014 Turkish-character name downloads as real PDF");
    // =====================================================================
    const tr = await card(HR_ID, TR_PERSON);
    check(
      "turkish name 200 %PDF (no header crash)",
      tr.status === 200 &&
        tr.type === "application/pdf" &&
        tr.buf.subarray(0, 4).toString() === "%PDF",
      `status=${tr.status} type=${tr.type}`,
    );
    check(
      "header carries RFC 5987 filename* with UTF-8 name + ASCII fallback",
      tr.disp.includes("filename*=UTF-8''") &&
        tr.disp.includes('filename="Omer_Barbaros_Yis_Cognirise_Business_Card.pdf"') &&
        /^[\x20-\x7e]+$/.test(tr.disp),
      `disp=${tr.disp}`,
    );
    // Task #696 — the rendered card text must carry correct Turkish glyphs
    // (Helvetica/WinAnsi substituted "ş" with "ð"). Extract text via pdftotext.
    {
      const { execFile } = await import("node:child_process");
      const { writeFile, unlink } = await import("node:fs/promises");
      const tmpPdf = `/tmp/roster-card-tr-${STAMP}.pdf`;
      await writeFile(tmpPdf, tr.buf);
      const text = await new Promise<string>((resolve, reject) => {
        execFile("pdftotext", [tmpPdf, "-"], (err, stdout) =>
          err ? reject(err) : resolve(stdout),
        );
      }).catch((e) => `pdftotext-failed: ${e}`);
      await unlink(tmpPdf).catch(() => {});
      check(
        "card text renders Turkish glyphs (Yiş / Türkiye, no ð substitution)",
        text.includes("Ömer Barbaros Yiş") &&
          text.includes("CEO Türkiye") &&
          !text.includes("\u00f0"),
        `extracted=${JSON.stringify(text.slice(0, 200))}`,
      );
    }

    // =====================================================================
    group("request validation parity");
    // =====================================================================
    const missing = await card(HR_ID, `emp_test_nope_${STAMP}`);
    check("unknown person 404s", missing.status === 404, `status=${missing.status}`);
    const badVar = await card(HR_ID, OUTSIDE_PERSON, "poster");
    check(
      "bad variant 400s with allowed list",
      badVar.status === 400 && badVar.buf.toString().includes("invalid-variant"),
      `status=${badVar.status} body=${badVar.buf.toString().slice(0, 120)}`,
    );

    // =====================================================================
    group("audit trail");
    // =====================================================================
    const auditRows = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, OUTSIDE_PERSON));
    const hrDownloads = auditRows.filter(
      (r: any) =>
        r.action === "document.downloaded" &&
        r.actorId === HR_ID &&
        r.payload?.kind === "business_card_pdf" &&
        r.payload?.self === false,
    );
    check(
      "audit rows written: kind business_card_pdf, self:false (both variants)",
      hrDownloads.length === 2 &&
        hrDownloads.some((r: any) => r.payload?.variant === "standard") &&
        hrDownloads.some((r: any) => r.payload?.variant === "print"),
      `matching=${hrDownloads.length} rows=${JSON.stringify(auditRows.map((r: any) => ({ action: r.action, payload: r.payload }))).slice(0, 300)}`,
    );
    const deniedAudits = auditRows.filter(
      (r: any) =>
        r.action === "document.downloaded" &&
        (r.actorId === MGR_ID || r.actorId === EMP_ID),
    );
    check(
      "no download audit rows for denied (403) attempts",
      deniedAudits.length === 0,
      `found=${deniedAudits.length}`,
    );
  } finally {
    for (const id of edgeIds) {
      await db.delete(atelierRosterReportsTo).where(eq(atelierRosterReportsTo.id, id));
    }
    for (const id of [MGR_PERSON, REPORT_PERSON, OUTSIDE_PERSON, EMP_PERSON, TR_PERSON]) {
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, id));
    }
    await db
      .delete(atelierAuditEvents)
      .where(like(atelierAuditEvents.actorId, `p_test_rc%_${STAMP}`));
    for (const id of [HR_ID, MGR_ID, EMP_ID]) {
      await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
    }
    await pool.end();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll roster-card checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
