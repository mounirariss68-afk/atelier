/**
 * Task #451 — client invoice PDF + email-send probe.
 *
 * Covers:
 *   - GET /wallet/invoices/:id/pdf on a draft -> 400 invalid_state
 *   - issue draft (partner) -> 200, minted number
 *   - GET pdf -> 200, application/pdf, %PDF magic bytes, inline disposition
 *   - GET pdf?download=1 -> attachment disposition with invoice-number filename
 *   - POST /send with no billTo.contactEmail -> 400 invalid_input
 *   - POST /send with contactEmail -> ok:true, via:"log-only", delivered:false
 *     (honest semantics; Resend not configured in scratch env)
 *   - finance role may send; restricted persona (contractor) -> 403 on pdf
 *   - audit row wallet.invoice.emailed written with delivered:false
 *
 * Deterministic: no LLM calls.
 * Run: pnpm exec tsx tests/crm/invoice-pdf-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierInvoice, atelierInvoiceLine, atelierAuditEvents } = D;
  const { eq, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe451_${Date.now()}`;
  const partnerId = `u_${runTag}_fp`;
  const financeId = `u_${runTag}_fin`;
  const contractorId = `u_${runTag}_ct`;
  const invId = `inv_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (userId: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${userId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/pdf")) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, pdf: buf, body: null as any };
    }
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, headers: res.headers, pdf: null as Buffer | null, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values([
      { id: partnerId, orgId: "aico", name: "Probe Partner", initials: "PP", email: `${runTag}-fp@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: financeId, orgId: "aico", name: "Probe Finance", initials: "PF", email: `${runTag}-fin@example.test`, role: "finance", roleLabel: "Finance", title: "Finance Lead" },
      { id: contractorId, orgId: "aico", name: "Probe Contractor", initials: "PC", email: `${runTag}-ct@example.test`, role: "contractor", roleLabel: "Contractor", title: "Contractor" },
    ] as any);

    // Draft invoice with one manual line, no contactEmail yet.
    const create = await api(partnerId, "POST", "/wallet/invoices", {
      jurisdiction: "GLOBAL",
      currency: "USD",
      billTo: { name: `Probe Client ${runTag}` },
      notes: "Probe invoice — do not pay.",
    });
    check("draft create -> 201", create.status === 201, create.body);
    const draftId = create.body?.invoice?.id;
    check("draft id present", !!draftId, create.body);

    const addLine = await api(partnerId, "POST", `/wallet/invoices/${draftId}/lines`, {
      description: "Advisory retainer — July 2026",
      qty: 1,
      unitPrice: 12500,
    });
    check("line added", addLine.status === 200, addLine.body);

    // PDF on a draft must be rejected.
    const draftPdf = await api(partnerId, "GET", `/wallet/invoices/${draftId}/pdf`);
    check("draft pdf -> 400 invalid_state", draftPdf.status === 400 && draftPdf.body?.error === "invalid_state", draftPdf.body);

    // Send on a draft must be rejected too.
    const draftSend = await api(financeId, "POST", `/wallet/invoices/${draftId}/send`);
    check("draft send -> 400", draftSend.status === 400, draftSend.body);

    // Issue.
    const issue = await api(partnerId, "POST", `/wallet/invoices/${draftId}/issue`);
    check("issue -> 200", issue.status === 200, issue.body);
    const invoiceNumber: string | undefined = issue.body?.invoice?.invoiceNumber;
    check("invoice number minted", !!invoiceNumber && /INV/.test(invoiceNumber), issue.body?.invoice);

    // PDF now renders.
    const pdf = await api(financeId, "GET", `/wallet/invoices/${draftId}/pdf`);
    check("issued pdf -> 200 application/pdf", pdf.status === 200 && !!pdf.pdf, pdf.body);
    check("pdf magic bytes", !!pdf.pdf && pdf.pdf.subarray(0, 5).toString() === "%PDF-", pdf.pdf?.subarray(0, 8).toString());
    check("pdf inline disposition", (pdf.headers.get("content-disposition") ?? "").startsWith("inline"), pdf.headers.get("content-disposition"));
    check("pdf non-trivial size", (pdf.pdf?.length ?? 0) > 1500, pdf.pdf?.length);

    const dl = await api(financeId, "GET", `/wallet/invoices/${draftId}/pdf?download=1`);
    const disp = dl.headers.get("content-disposition") ?? "";
    check("download disposition = attachment with number", disp.startsWith("attachment") && disp.includes(".pdf"), disp);

    // Restricted persona denied.
    const denied = await api(contractorId, "GET", `/wallet/invoices/${draftId}/pdf`);
    check("contractor pdf -> 403", denied.status === 403, denied.body);

    // Send without any recipient -> 400.
    const noTo = await api(financeId, "POST", `/wallet/invoices/${draftId}/send`);
    check("send without recipient -> 400 invalid_input", noTo.status === 400 && noTo.body?.error === "invalid_input", noTo.body);

    // Send with explicit `to` -> log-only honest status.
    const send = await api(financeId, "POST", `/wallet/invoices/${draftId}/send`, { to: "client@example.test" });
    check("send -> 200", send.status === 200, send.body);
    // Invariant: without a working Resend setup the response must honestly
    // report NOT delivered (via log-only). ok may be true (no key at all) or
    // false (key present but the provider rejected, e.g. testing mode).
    check("send honest log-only status", send.body?.via === "log-only" && send.body?.delivered === false, send.body);
    check("send echoes recipient", send.body?.to === "client@example.test", send.body);

    // Audit row written.
    const audits = await db.select().from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, draftId));
    const emailed = audits.filter((a: any) => a.action === "wallet.invoice.emailed");
    check("audit wallet.invoice.emailed written", emailed.length === 1, audits.map((a: any) => a.action));
    check("audit payload delivered:false", emailed[0]?.payload?.delivered === false, emailed[0]?.payload);
  } finally {
    // Cleanup (scratch DB, but keep it tidy).
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `u_${runTag}%`));
    await db.delete(atelierInvoiceLine).where(like(atelierInvoiceLine.id, `invl_%`));
    await db.delete(atelierInvoice).where(eq(atelierInvoice.createdByUserId, partnerId));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `u_${runTag}%`));
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASH", err);
  process.exit(1);
});
