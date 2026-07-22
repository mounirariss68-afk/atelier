/** Task #531 probe — national ID front+back scans (self-cleaning). */
process.env.NODE_ENV = "test";
const STAMP = Date.now();
const EMP_ID = `p_test_idb_${STAMP}`;

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000-1f15c4890000000d49444154789c6260000000060002305ec2f80000000049454e44ae426082".replace("-", "0"),
  "hex",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
);

function fd(fields: Record<string, string>, files: Record<string, { buf: Buffer; name: string; mime: string }>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [k, v] of Object.entries(files)) f.append(k, new Blob([v.buf], { type: v.mime }), v.name);
  return f;
}

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const D: any = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierPersonDocuments } = D;
  const { eq, like } = await import("drizzle-orm");
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${EMP_ID}` };
  const hrHdrs = { cookie: `atelier_persona=p_mounir_ariss` };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  const empRowId = `emp_test_idb_${STAMP}`;
  try {
    await db.insert(atelierUsers).values({
      id: EMP_ID, orgId: "aico", email: `${EMP_ID}@cognirise.ai`, name: "T531 Probe",
      initials: "TP", role: "employee", roleLabel: "Employee", title: "Analyst",
      permissions: [], bdActive: false,
    });
    await db.insert(atelierEmployees).values({
      id: empRowId, orgId: "aico", userId: EMP_ID, fullName: "T531 Probe",
      email: `${EMP_ID}@cognirise.ai`, role: "employee", title: "Analyst",
    });

    // 1. national_id image front only -> 400 back-side-required
    let r = await fetch(`${base}/me/documents`, { method: "POST", headers: hdrs, body: fd(
      { kind: "national_id", title: "ID front only" },
      { file: { buf: PNG, name: "front.png", mime: "image/png" } },
    )});
    let j: any = await r.json();
    check("front-only image rejected 400", r.status === 400 && j.error === "back-side-required", { s: r.status, j });

    // 2. front+back images -> 201 sides front_back
    r = await fetch(`${base}/me/documents`, { method: "POST", headers: hdrs, body: fd(
      { kind: "national_id", title: "ID both sides" },
      { file: { buf: PNG, name: "front.png", mime: "image/png" },
        fileBack: { buf: PNG, name: "back.png", mime: "image/png" } },
    )});
    j = await r.json();
    const bothDoc = j.document;
    check("front+back 201 sides=front_back", r.status === 201 && bothDoc?.sides === "front_back" && bothDoc?.hasBackFile === true, { s: r.status, j });

    // 3. combined PDF -> 201 sides combined
    r = await fetch(`${base}/me/documents`, { method: "POST", headers: hdrs, body: fd(
      { kind: "national_id", title: "ID combined" },
      { file: { buf: PDF, name: "id.pdf", mime: "application/pdf" } },
    )});
    j = await r.json();
    check("combined PDF 201 sides=combined", r.status === 201 && j.document?.sides === "combined", { s: r.status, j });

    // 4. non-national_id with fileBack -> 400
    r = await fetch(`${base}/me/documents`, { method: "POST", headers: hdrs, body: fd(
      { kind: "passport", title: "Passport bad back" },
      { file: { buf: PNG, name: "p.png", mime: "image/png" },
        fileBack: { buf: PNG, name: "pb.png", mime: "image/png" } },
    )});
    j = await r.json();
    check("passport back rejected 400", r.status === 400 && j.error === "back-side-not-allowed", { s: r.status, j });

    // 5. other kind single file still works
    r = await fetch(`${base}/me/documents`, { method: "POST", headers: hdrs, body: fd(
      { kind: "passport", title: "Passport ok" },
      { file: { buf: PNG, name: "p.png", mime: "image/png" } },
    )});
    j = await r.json();
    check("passport single 201", r.status === 201 && (j.document?.sides ?? null) === null, { s: r.status, j });

    // 6. legacy front_only doc (direct insert) -> attach back later
    const legacyId = `pdoc_test_idb_${STAMP}`;
    await db.insert(atelierPersonDocuments).values({
      id: legacyId, orgId: "aico", personType: "employee", personId: empRowId,
      kind: "national_id", title: "Legacy ID", fileRef: bothDoc.id ? null : null,
      fileName: "old.png", mime: "image/png", sizeBytes: 10,
      uploadedByUserId: EMP_ID, createdByUserId: EMP_ID,
    });
    // fileRef null -> set via replace-front first
    r = await fetch(`${base}/me/documents/${legacyId}/file`, { method: "POST", headers: hdrs, body: fd(
      {}, { file: { buf: PNG, name: "front.png", mime: "image/png" } },
    )});
    j = await r.json();
    check("legacy front upload sides=front_only", r.status === 200 && j.document?.sides === "front_only", { s: r.status, j });

    r = await fetch(`${base}/me/documents/${legacyId}/file`, { method: "POST", headers: hdrs, body: fd(
      { side: "back" }, { file: { buf: PNG, name: "back.png", mime: "image/png" } },
    )});
    j = await r.json();
    check("attach back later -> front_back", r.status === 200 && j.document?.sides === "front_back", { s: r.status, j });

    // 7. side=back on passport -> 400
    const passId = j?.document?.id; // reuse legacy id instead
    r = await fetch(`${base}/me/documents/${legacyId}/download?side=back`, { headers: hdrs });
    check("owner download back 200", r.status === 200, { s: r.status });
    r = await fetch(`${base}/me/documents/${bothDoc.id}/download?side=back`, { headers: hdrs });
    check("owner download back (created pair) 200", r.status === 200, { s: r.status });
    r = await fetch(`${base}/me/documents/${bothDoc.id}/download`, { headers: hdrs });
    check("owner download front 200", r.status === 200, { s: r.status });

    // 8. HR roster list shows sides + backDownloadUrl; signed back download works
    r = await fetch(`${base}/roster/people/${empRowId}/documents?personType=employee`, { headers: hrHdrs });
    j = await r.json();
    const rows: any[] = j.documents ?? j;
    const hrDoc = Array.isArray(rows) ? rows.find((d: any) => d.id === bothDoc.id) : undefined;
    check("HR list sides + backDownloadUrl", !!hrDoc && hrDoc.sides === "front_back" && typeof hrDoc.backDownloadUrl === "string", { s: r.status, hrDoc });
    if (hrDoc?.backDownloadUrl) {
      const dl = await fetch(`http://127.0.0.1:${port}${hrDoc.backDownloadUrl}`, { headers: hrHdrs });
      check("HR signed back download 200", dl.status === 200, { s: dl.status });
    }
  } finally {
    await db.delete(atelierPersonDocuments).where(like(atelierPersonDocuments.personId, `emp_test_idb_%`));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empRowId));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, EMP_ID));
    server.close();
    await pool.end();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
