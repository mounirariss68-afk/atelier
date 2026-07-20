/**
 * Task #52 — Biography PPTX flow + business-card PDF regression probe.
 *
 * Runs standalone (npx tsx ./tests/bio-card/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass with ephemeral p_test_* personas. Rows cleaned up in `finally`.
 *
 * Coverage:
 *   1. GET /me/bio/template — 200, PPTX mime, non-trivial bytes (employee
 *      AND contractor); consultant persona (no roster row) gets 404
 *   2. POST /me/bio — rejects missing file (400) and non-PPTX (415);
 *      accepts a PK-magic .pptx as octet-stream; versions increment;
 *      list is newest-first; rows carry kind "biography"
 *   3. GET /me/documents excludes biography rows; owner can stream the
 *      bio back via /me/documents/:id/download; a DIFFERENT employee
 *      404s on that id (self-scope)
 *   4. GET /me/business-card.pdf — 200 %PDF for employee and contractor;
 *      download is audited
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_ID = `p_test_emp_${STAMP}`;
const EMP2_ID = `p_test_emp2_${STAMP}`;
const CT_ID = `p_test_ct_${STAMP}`;
const CONS_ID = `p_test_cons_${STAMP}`;

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

// Minimal valid-enough PPTX stand-in: PK zip magic + padding. The route
// only checks mime/extension/magic — it does not parse slides.
function fakePptx(seed: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`fake-pptx-${seed}-`.repeat(64)),
  ]);
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
    atelierContractors,
    atelierPersonDocuments,
    atelierAuditEvents,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  const cookie = (id: string) => ({ cookie: `atelier_persona=${id}` });

  async function upload(
    personaId: string,
    file: { name: string; type: string; bytes: Buffer } | null,
  ): Promise<{ status: number; body: any }> {
    const fd = new FormData();
    if (file) {
      fd.append(
        "file",
        new Blob([new Uint8Array(file.bytes)], { type: file.type }),
        file.name,
      );
    }
    const res = await fetch(`${API}/me/bio`, {
      method: "POST",
      headers: cookie(personaId),
      body: fd,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const EMP_ROW = `emp_test_${STAMP}`;
  const EMP2_ROW = `emp_test2_${STAMP}`;
  const CT_ROW = `ct_test_${STAMP}`;

  try {
    const personas = [
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "Bio Employee" },
      { id: EMP2_ID, role: "employee", roleLabel: "Employee", name: "Other Employee" },
      { id: CT_ID, role: "contractor", roleLabel: "Contractor", name: "Bio Contractor" },
      { id: CONS_ID, role: "consultant", roleLabel: "Consultant", name: "Bio Consultant" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "TT",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values({
      id: EMP_ROW,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "Bio Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Senior Analyst",
      cellPhones: [{ country: "+971", number: "50 111 2222" }],
    });
    await db.insert(atelierEmployees).values({
      id: EMP2_ROW,
      orgId: ORG,
      userId: EMP2_ID,
      fullName: "Other Employee",
      email: `${EMP2_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierContractors).values({
      id: CT_ROW,
      orgId: ORG,
      fullName: "Bio Contractor",
      email: `${CT_ID}@cognirise.ai`,
    });

    // =====================================================================
    group("bio template download");
    // =====================================================================
    for (const [label, pid] of [
      ["employee", EMP_ID],
      ["contractor", CT_ID],
    ] as const) {
      const res = await fetch(`${API}/me/bio/template`, { headers: cookie(pid) });
      const buf = Buffer.from(await res.arrayBuffer());
      check(
        `${label} downloads template (200 pptx, PK magic, >1MB)`,
        res.status === 200 &&
          (res.headers.get("content-type") ?? "").includes("presentationml") &&
          buf.length > 1024 * 1024 &&
          buf.subarray(0, 2).toString() === "PK",
        `status=${res.status} len=${buf.length}`,
      );
    }
    const consTpl = await fetch(`${API}/me/bio/template`, { headers: cookie(CONS_ID) });
    check(
      "consultant (no roster row) gets 404 on template",
      consTpl.status === 404,
      `status=${consTpl.status}`,
    );

    // =====================================================================
    group("bio upload · validation + versioning");
    // =====================================================================
    const noFile = await upload(EMP_ID, null);
    check("missing file rejected 400", noFile.status === 400, `status=${noFile.status}`);

    const badType = await upload(EMP_ID, {
      name: "bio.pdf",
      type: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 fake"),
    });
    check(
      "non-pptx rejected 415",
      badType.status === 415 && badType.body?.error === "unsupported-file-type",
      `status=${badType.status}`,
    );

    const v1 = await upload(EMP_ID, {
      name: "my-bio.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: fakePptx("v1"),
    });
    check(
      "v1 upload 201, version 1",
      v1.status === 201 && v1.body?.version === 1 && v1.body?.biography?.title === "Biography v1",
      `status=${v1.status} body=${JSON.stringify(v1.body)?.slice(0, 200)}`,
    );

    const v2 = await upload(EMP_ID, {
      name: "my-bio-updated.pptx",
      type: "application/octet-stream", // octet-stream + .pptx + PK magic path
      bytes: fakePptx("v2"),
    });
    check(
      "v2 re-upload 201, version 2 (octet-stream accepted via magic)",
      v2.status === 201 && v2.body?.version === 2,
      `status=${v2.status} body=${JSON.stringify(v2.body)?.slice(0, 200)}`,
    );

    const list = await fetch(`${API}/me/bio`, { headers: cookie(EMP_ID) });
    const listBody = (await list.json()) as any;
    check(
      "list newest-first with downloadUrl",
      list.status === 200 &&
        listBody?.biographies?.length === 2 &&
        listBody.biographies[0]?.title === "Biography v2" &&
        String(listBody.biographies[0]?.downloadUrl ?? "").includes("/me/documents/"),
      JSON.stringify(listBody)?.slice(0, 300),
    );

    // =====================================================================
    group("bio · scoping + documents-list exclusion");
    // =====================================================================
    const docsList = await fetch(`${API}/me/documents`, { headers: cookie(EMP_ID) });
    const docsBody = (await docsList.json()) as any;
    check(
      "/me/documents excludes biography rows",
      docsList.status === 200 &&
        (docsBody?.documents ?? []).every((d: any) => d.kind !== "biography"),
      JSON.stringify(docsBody)?.slice(0, 200),
    );

    const bioId = v1.body?.biography?.id as string;
    const ownDl = await fetch(`${API}/me/documents/${bioId}/download`, {
      headers: cookie(EMP_ID),
    });
    const ownBytes = Buffer.from(await ownDl.arrayBuffer());
    check(
      "owner streams own bio back (200, PK magic)",
      ownDl.status === 200 && ownBytes.subarray(0, 2).toString() === "PK",
      `status=${ownDl.status} len=${ownBytes.length}`,
    );

    const foreignDl = await fetch(`${API}/me/documents/${bioId}/download`, {
      headers: cookie(EMP2_ID),
    });
    check(
      "different employee 404s on that bio id",
      foreignDl.status === 404,
      `status=${foreignDl.status}`,
    );

    // =====================================================================
    group("business-card PDF");
    // =====================================================================
    for (const [label, pid] of [
      ["employee", EMP_ID],
      ["contractor", CT_ID],
    ] as const) {
      const res = await fetch(`${API}/me/business-card.pdf`, { headers: cookie(pid) });
      const buf = Buffer.from(await res.arrayBuffer());
      check(
        `${label} card PDF 200 (%PDF, attachment)`,
        res.status === 200 &&
          res.headers.get("content-type") === "application/pdf" &&
          buf.subarray(0, 4).toString() === "%PDF" &&
          (res.headers.get("content-disposition") ?? "").includes("Business_Card"),
        `status=${res.status} len=${buf.length}`,
      );
    }
    // Task #352 — print variant: 3 mm bleed + crop marks, distinct filename,
    // TrimBox/BleedBox metadata, larger MediaBox than the standard card.
    const stdRes = await fetch(`${API}/me/business-card.pdf`, { headers: cookie(EMP_ID) });
    const stdBuf = Buffer.from(await stdRes.arrayBuffer());
    const prnRes = await fetch(`${API}/me/business-card.pdf?variant=print`, {
      headers: cookie(EMP_ID),
    });
    const prnBuf = Buffer.from(await prnRes.arrayBuffer());
    const prnDisp = prnRes.headers.get("content-disposition") ?? "";
    const prnTxt = prnBuf.toString("latin1");
    check(
      "print variant 200 with _Print filename",
      prnRes.status === 200 &&
        prnBuf.subarray(0, 4).toString() === "%PDF" &&
        prnDisp.includes("Business_Card_Print.pdf"),
      `status=${prnRes.status} disp=${prnDisp}`,
    );
    check(
      "print variant carries TrimBox + BleedBox",
      prnTxt.includes("/TrimBox") && prnTxt.includes("/BleedBox"),
    );
    // Task #382 — print variant embeds a PDF/X-style ICC output intent
    // (sRGB IEC61966-2.1) so print shops get predictable color; the
    // standard variant stays untouched (no OutputIntents).
    check(
      "print variant embeds ICC output intent (GTS_PDFX + sRGB profile)",
      prnTxt.includes("/OutputIntents") &&
        prnTxt.includes("/GTS_PDFX") &&
        prnTxt.includes("/DestOutputProfile") &&
        prnTxt.includes("sRGB IEC61966-2.1"),
    );
    check(
      "standard variant has no output intent",
      !stdBuf.toString("latin1").includes("/OutputIntents"),
    );
    check(
      "standard variant has no TrimBox and is smaller page",
      !stdBuf.toString("latin1").includes("/TrimBox") &&
        stdBuf.toString("latin1").includes("MediaBox [0 0 255.125") &&
        prnTxt.includes("MediaBox [0 0 289.140"),
    );
    const badVar = await fetch(`${API}/me/business-card.pdf?variant=poster`, {
      headers: cookie(EMP_ID),
    });
    check("unknown variant 400s", badVar.status === 400, `status=${badVar.status}`);

    const consCard = await fetch(`${API}/me/business-card.pdf`, { headers: cookie(CONS_ID) });
    check("consultant 404s on card PDF", consCard.status === 404, `status=${consCard.status}`);

    const [auditRow] = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.action, "document.downloaded"),
          eq(atelierAuditEvents.entityId, EMP_ROW),
        ),
      )
      .limit(1);
    check("card download audited", Boolean(auditRow), "no document.downloaded audit row");
  } finally {
    // cleanup — delete test rows (docs → roster → users → audits)
    await db
      .delete(atelierPersonDocuments)
      .where(eq(atelierPersonDocuments.personId, EMP_ROW));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP_ROW));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP2_ROW));
    await db.delete(atelierContractors).where(eq(atelierContractors.id, CT_ROW));
    await db
      .delete(atelierAuditEvents)
      .where(like(atelierAuditEvents.actorId, `p_test_%${STAMP}`));
    for (const id of [EMP_ID, EMP2_ID, CT_ID, CONS_ID]) {
      await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
    }
    await pool.end();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll bio-card checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
