/**
 * Task #245 — Probe: prior reviewed field schema is reconciled when a new
 * contract-template version is uploaded.
 *
 * Flow: upload v1 (two placeholders) → review fields (activates) → upload v2
 * where one placeholder survives and one is gone → assert the new version
 * carries `priorFieldReview` with the survivor tagged carried_over and the
 * dropped one tagged missing. Field detection is served by a local stub
 * Anthropic server (no live LLM).
 *
 * Run: pnpm exec tsx tests/crm/template-version-prior-review-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const PH_NAME = "[COUNTERPARTY NAME]";
const PH_DATE = "[EFFECTIVE DATE]";
const PH_FEE = "[FEE AMOUNT]";

function fieldsFor(text: string) {
  const all = [
    { key: "counterparty_name", label: "Counterparty name", placeholder: PH_NAME, dataType: "text", autoFill: "counterparty_name", required: true },
    { key: "effective_date", label: "Effective date", placeholder: PH_DATE, dataType: "date", autoFill: "effective_date", required: true },
    { key: "fee_amount", label: "Fee amount", placeholder: PH_FEE, dataType: "money", autoFill: "fee", required: false },
  ];
  return all.filter((f) => text.includes(f.placeholder));
}

async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
  // Stub Anthropic: returns fields derived from the document text embedded
  // in the request prompt (both placeholders that appear in it).
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const fields = fieldsFor(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe245",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify({ fields }) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe245-stub-key";

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierContractTemplates, atelierContractTemplateVersions } = D;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe245_${Date.now()}`;
  const userId = `u_${runTag}`;
  let templateId: string | null = null;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const apiJson = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${userId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const apiUpload = async (path: string, docx: Buffer, extra?: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
    fd.append(
      "file",
      new Blob([new Uint8Array(docx)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      "template.docx",
    );
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${userId}` },
      body: fd,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe TwoFortyFive",
      initials: "PT",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);

    // ---- v1 upload + review ----
    const docx1 = await makeDocx([
      `This agreement is between the Firm and ${PH_NAME}.`,
      `It takes effect on ${PH_DATE}.`,
    ]);
    const created = await apiUpload("/contract-templates", docx1, {
      name: `Probe NDA ${runTag}`,
      contractType: "mutual_nda",
    });
    check("v1 uploaded (201)", created.status === 201, created);
    templateId = created.body?.template?.id ?? null;
    const v1Fields = created.body?.template?.currentVersion?.fieldSchema ?? [];
    check("v1 detected 2 fields", v1Fields.length === 2, v1Fields);
    check(
      "v1 has no priorFieldReview",
      created.body?.template?.currentVersion?.priorFieldReview == null,
      created.body?.template?.currentVersion?.priorFieldReview,
    );

    const reviewed = await apiJson("PUT", `/contract-templates/${templateId}/fields`, {
      fields: v1Fields,
    });
    check("v1 fields reviewed (200)", reviewed.status === 200, reviewed);
    check(
      "template activated after review",
      reviewed.body?.template?.status === "active",
      reviewed.body?.template?.status,
    );

    // ---- v2 upload: NAME survives, DATE removed, FEE added ----
    const docx2 = await makeDocx([
      `This restated agreement is between the Firm and ${PH_NAME}.`,
      `The fee is ${PH_FEE}.`,
    ]);
    const v2 = await apiUpload(`/contract-templates/${templateId}/versions`, docx2);
    check("v2 uploaded (201)", v2.status === 201, v2);
    const cur = v2.body?.template?.currentVersion;
    check("v2 is version 2", cur?.versionNumber === 2, cur?.versionNumber);
    check("v2 fieldStatus back to detected", cur?.fieldStatus === "detected", cur?.fieldStatus);

    const pfr = cur?.priorFieldReview;
    check("v2 has priorFieldReview", !!pfr, cur);
    check("priorFieldReview from v1", pfr?.fromVersionNumber === 1, pfr?.fromVersionNumber);
    const byKey = new Map((pfr?.fields ?? []).map((f: any) => [f.key, f]));
    check(
      "counterparty_name carried over",
      byKey.get("counterparty_name")?.status === "carried_over",
      byKey.get("counterparty_name"),
    );
    check(
      "effective_date flagged missing",
      byKey.get("effective_date")?.status === "missing",
      byKey.get("effective_date"),
    );
    check("prior review covers exactly the 2 reviewed fields", (pfr?.fields ?? []).length === 2, pfr);

    // GET detail also carries it (what the Review dialog reads)
    const detail = await apiJson("GET", `/contract-templates/${templateId}`);
    check(
      "GET detail exposes priorFieldReview on current version",
      detail.body?.template?.currentVersion?.priorFieldReview?.fromVersionNumber === 1,
      detail.body?.template?.currentVersion,
    );

    // Reviewing v2's fields (fresh detection) still works
    const v2Fields = cur?.fieldSchema ?? [];
    const rereview = await apiJson("PUT", `/contract-templates/${templateId}/fields`, {
      fields: v2Fields,
    });
    check("v2 fields review passes placeholder validation", rereview.status === 200, rereview);
  } finally {
    if (templateId) {
      await db
        .delete(atelierContractTemplateVersions)
        .where(eq(atelierContractTemplateVersions.templateId, templateId));
      await db.delete(atelierContractTemplates).where(eq(atelierContractTemplates.id, templateId));
    }
    await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    server.close();
    stub.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
