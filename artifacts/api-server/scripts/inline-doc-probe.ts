/** Task #294 probe — document download inline vs attachment (self-cleaning). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const { db, atelierDocuments, atelierAuditEvents } = await import("@workspace/db");
  const { eq, like, desc } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const cookie = `atelier_persona=${PERSONA}`;
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  let docId: string | null = null;
  try {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF");
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), "__t294-probe.pdf");
    fd.append("title", "__T294 probe doc");
    fd.append("category", "other");
    const up = await fetch(`${base}/documents`, { method: "POST", headers: { cookie }, body: fd });
    const uj: any = await up.json();
    check("upload 201", up.status === 201, uj);
    docId = uj.document?.id ?? null;
    if (!docId) throw new Error("no doc id");

    const dl = await fetch(`${base}/documents/${docId}/download`, { headers: { cookie } });
    check("default download 200", dl.status === 200);
    const cd1 = dl.headers.get("content-disposition") || "";
    check("default is attachment with filename", cd1.startsWith("attachment;") && cd1.includes("__t294-probe.pdf"), cd1);

    const inl = await fetch(`${base}/documents/${docId}/download?disposition=inline`, { headers: { cookie } });
    check("inline download 200", inl.status === 200);
    const cd2 = inl.headers.get("content-disposition") || "";
    check("inline disposition", cd2.startsWith("inline;") && cd2.includes("__t294-probe.pdf"), cd2);
    check("inline content-type pdf", (inl.headers.get("content-type") || "").includes("application/pdf"));
    const body = Buffer.from(await inl.arrayBuffer());
    check("inline body matches", body.equals(pdf));

    const audits = await db.select().from(atelierAuditEvents)
      .where(like(atelierAuditEvents.payloadSummary, "%__t294-probe.pdf%"))
      .orderBy(desc(atelierAuditEvents.createdAt));
    const summaries = audits.map((a: any) => a.payloadSummary);
    check("audit has Viewed", summaries.some((s: string) => s?.startsWith('Viewed "__t294-probe.pdf"')), summaries);
    check("audit has Downloaded", summaries.some((s: string) => s?.startsWith('Downloaded "__t294-probe.pdf"')), summaries);

    const noauth = await fetch(`${base}/documents/${docId}/download?disposition=inline`);
    check("unauthenticated 401", noauth.status === 401);
  } finally {
    if (docId) await db.delete(atelierDocuments).where(eq(atelierDocuments.id, docId));
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.payloadSummary, "%__t294%"));
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.payloadSummary, "%__T294%"));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
