/** Task #318 probe — /me/contracts/:id returns template field labels/roles (self-cleaning). */
process.env.NODE_ENV = "test";
const STAMP = Date.now();
const EMP_ID = `p_test_mecf_${STAMP}`;

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const D: any = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractTemplates,
    atelierContractTemplateVersions,
    atelierContractRecords,
  } = D;
  const { eq } = await import("drizzle-orm");
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${EMP_ID}` };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  const empRowId = `emp_test_mecf_${STAMP}`;
  const tplId = `ctpl_test_mecf_${STAMP}`;
  const tvId = `ctv_test_mecf_${STAMP}`;
  const ctrId = `ctr_test_mecf_${STAMP}`;
  const ctrNoTplId = `ctr_test_mecf2_${STAMP}`;
  try {
    await db.insert(atelierUsers).values({
      id: EMP_ID,
      orgId: "aico",
      email: `${EMP_ID}@cognirise.ai`,
      name: "T318 Probe Employee",
      initials: "TP",
      role: "employee",
      roleLabel: "Employee",
      title: "Analyst",
      permissions: [],
      bdActive: false,
    });
    await db.insert(atelierEmployees).values({
      id: empRowId,
      orgId: "aico",
      userId: EMP_ID,
      fullName: "T318 Probe Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierContractTemplates).values({
      id: tplId,
      orgId: "aico",
      name: `__T318 Probe Template ${STAMP}`,
      contractType: "employment",
      status: "active",
      currentVersionId: tvId,
      createdBy: "p_mounir_ariss",
    });
    await db.insert(atelierContractTemplateVersions).values({
      id: tvId,
      orgId: "aico",
      templateId: tplId,
      versionNumber: 1,
      fileName: "probe.docx",
      sizeBytes: 10,
      sha256: "0".repeat(64),
      blobRef: "enc:cdoc:probe-t318",
      fieldSchema: [
        { key: "employee_name", label: "Employee name", placeholder: "{{employee_name}}", type: "text", required: true, role: "standard" },
        { key: "sig_date", label: "Signature date", placeholder: "{{sig_date}}", type: "date", required: true, role: "second_party" },
        { key: "emirates_id", label: "Emirates ID number", placeholder: "{{emirates_id}}", type: "text", required: true, role: "second_party" },
      ],
      fieldStatus: "reviewed",
      createdBy: "p_mounir_ariss",
    });
    await db.insert(atelierContractRecords).values({
      id: ctrId,
      orgId: "aico",
      title: "__T318 Probe Contract",
      contractType: "employment",
      templateId: tplId,
      templateVersionId: tvId,
      counterpartyKind: "person",
      personId: empRowId,
      counterpartyLabel: "T318 Probe Employee",
      status: "signed",
      fieldValues: { employee_name: "T318 Probe Employee", sig_date: "2026-07-19", emirates_id: "784-1990-1234567-1" },
      ownerUserId: "p_mounir_ariss",
      ownerLabel: "Mounir Ariss",
    });
    await db.insert(atelierContractRecords).values({
      id: ctrNoTplId,
      orgId: "aico",
      title: "__T318 Probe No-template Contract",
      contractType: "other",
      counterpartyKind: "person",
      personId: empRowId,
      counterpartyLabel: "T318 Probe Employee",
      status: "signed",
      ownerUserId: "p_mounir_ariss",
      ownerLabel: "Mounir Ariss",
    });

    const r = await fetch(`${base}/me/contracts/${ctrId}`, { headers: hdrs });
    const j: any = await r.json();
    check("200", r.status === 200, { status: r.status, j });
    check("fields array present", Array.isArray(j.fields), j);
    const byKey = new Map((j.fields ?? []).map((f: any) => [f.key, f]));
    check("second_party role + label surfaced",
      (byKey.get("emirates_id") as any)?.role === "second_party" &&
      (byKey.get("emirates_id") as any)?.label === "Emirates ID number" &&
      (byKey.get("sig_date") as any)?.role === "second_party",
      j.fields);
    check("standard field surfaced", (byKey.get("employee_name") as any)?.role === "standard", j.fields);
    check("fieldValues intact", j.contract?.fieldValues?.emirates_id === "784-1990-1234567-1", j.contract?.fieldValues);

    const r2 = await fetch(`${base}/me/contracts/${ctrNoTplId}`, { headers: hdrs });
    const j2: any = await r2.json();
    check("no-template contract: 200 + empty fields", r2.status === 200 && Array.isArray(j2.fields) && j2.fields.length === 0, { status: r2.status, fields: j2.fields });
  } finally {
    await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, ctrId));
    await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, ctrNoTplId));
    await db.delete(atelierContractTemplateVersions).where(eq(atelierContractTemplateVersions.id, tvId));
    await db.delete(atelierContractTemplates).where(eq(atelierContractTemplates.id, tplId));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empRowId));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, EMP_ID));
    server.close();
    await pool.end();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("PROBE_ERR", e);
  process.exit(1);
});
