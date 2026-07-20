/**
 * Task #159 — contract lifecycle end-to-end probe.
 *
 * Pins the whole server-side chain, fully deterministic (no live LLM,
 * no live DocuSeal, real LibreOffice docx→PDF):
 *
 *   1. Template upload (.docx multipart) → stub-Anthropic field
 *      detection → fieldStatus "detected".
 *   2. Field review (PUT fields) → "reviewed", template auto-activates.
 *   3. Contract create for a roster person → CRM auto-fill
 *      (counterparty_name), generated draft .docx on the chain.
 *   4. Regenerate with edited values → new draft version.
 *   5. Final Word upload → docx→PDF (LibreOffice) → final + final_pdf
 *      docs, status "final_uploaded".
 *   6. Send for signature → stub DocuSeal → "out_for_signature".
 *   7. Manual e-sign sync (stub reports completed) → contract "signed",
 *      signed PDF copied onto the chain; terminal status never regresses.
 *   8. RBAC: employee persona cannot manage templates or contracts but
 *      CAN read their own contract.
 *
 * Stubs are installed via env BEFORE the app import (established
 * pattern: brief-envelope-contract-probe / esign-account-link-probe).
 *
 * Run: pnpm --filter @workspace/api-server test:contracts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const DETECTED_FIELDS = {
  fields: [
    {
      key: "counterparty_name",
      label: "Counterparty name",
      placeholder: "[COUNTERPARTY_NAME]",
      dataType: "text",
      autoFill: "counterparty_name",
      required: true,
    },
    {
      key: "effective_date",
      label: "Effective date",
      placeholder: "[EFFECTIVE_DATE]",
      dataType: "date",
      autoFill: "effective_date",
      required: true,
    },
    {
      key: "fee",
      label: "Fee",
      placeholder: "[FEE_AMOUNT]",
      dataType: "money",
      autoFill: "none",
      required: false,
    },
    // Task #298 — counterparty signature-block fields: skipped at
    // preparation, surfaced as DocuSeal boxes at send time.
    {
      key: "counterparty_sign_date",
      label: "Counterparty date signed",
      placeholder: "[CP_SIGN_DATE]",
      dataType: "date",
      autoFill: "none",
      required: false,
      role: "second_party",
    },
    {
      key: "counterparty_signatory_title",
      label: "Signatory title",
      placeholder: "[CP_TITLE]",
      dataType: "text",
      autoFill: "none",
      required: false,
      role: "second_party",
    },
    // Task #330 — token-style reference placeholder WITHOUT an explicit
    // role: normalizeFieldSchema/classifyFieldRole must classify it as
    // "reference" and prepare must allocate + format a real number.
    {
      key: "reference_number",
      label: "Reference Number",
      placeholder: "[CGNR-NDA-U-[YEAR]-[###]]",
      dataType: "text",
      autoFill: "none",
      required: false,
    },
  ],
  warnings: ["probe warning"],
};

async function main() {
  // ---- stub Anthropic BEFORE app import ----
  const anthropicStub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe159",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify(DETECTED_FIELDS) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  anthropicStub.listen(0);
  await new Promise<void>((r) => anthropicStub.once("listening", () => r()));
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropicStub.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe159-stub-key";

  // ---- stub DocuSeal BEFORE app import ----
  const SIGNED_PDF = Buffer.from("%PDF-1.4 probe159 signed pdf\n%%EOF");
  let submissionCompleted = false;
  let lastTemplateFields: Array<{ name: string; type?: string; role: string; areas: Array<{ page: number }> }> | null = null;
  const docusealStub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/templates/pdf") {
        lastTemplateFields = JSON.parse(raw || "{}")?.documents?.[0]?.fields ?? null;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: 7159 }));
        return;
      }
      if (req.method === "POST" && url === "/submissions") {
        const body = JSON.parse(raw || "{}");
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            (body?.submitters ?? []).map((s: any, i: number) => ({
              id: 9200 + i,
              submission_id: 5599,
              name: s.name,
              email: s.email,
              status: "sent",
            })),
          ),
        );
        return;
      }
      if (req.method === "GET" && url === "/submissions/5599") {
        res.setHeader("content-type", "application/json");
        const base = `http://127.0.0.1:${(docusealStub.address() as AddressInfo).port}`;
        res.end(
          JSON.stringify(
            submissionCompleted
              ? {
                  id: 5599,
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  submitters: [
                    {
                      id: 9200,
                      status: "completed",
                      email: "p159_signer@example.test",
                      completed_at: new Date().toISOString(),
                    },
                  ],
                  documents: [{ name: "signed", url: `${base}/signed.pdf` }],
                }
              : { id: 5599, status: "pending", submitters: [] },
          ),
        );
        return;
      }
      if (req.method === "GET" && url === "/signed.pdf") {
        res.setHeader("content-type", "application/pdf");
        res.end(SIGNED_PDF);
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `unexpected-docuseal-call ${req.method} ${url}` }));
    });
  });
  docusealStub.listen(0);
  await new Promise<void>((r) => docusealStub.once("listening", () => r()));
  process.env.DOCUSEAL_BASE_URL = `http://127.0.0.1:${(docusealStub.address() as AddressInfo).port}`;
  process.env.DOCUSEAL_API_KEY = "probe159-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractTemplates,
    atelierContractTemplateVersions,
    atelierContractRecords,
    atelierContractDocuments,
    atelierSignatureRequests,
    atelierSignatureSigners,
    atelierDocuments,
    atelierLegalEntities,
    atelierSigningEntitySignatories,
    atelierSelfNotifications,
  } = D as any;
  const { eq, inArray, like } = await import("drizzle-orm");
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe159_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const empUserId = `u_${runTag}_emp`;
  const empId = `emp_${runTag}`;
  const entityId = `lent_${runTag}`;
  // Task #335 — a second partner: contract manager but NOT an authorised signatory.
  const p2Id = `u_${runTag}_p2`;
  let contract2Id: string | null = null;
  let sigRequestId2: string | null = null;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown, who: string = fpId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        cookie: `atelier_persona=${who}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  const upload = async (path: string, fields: Record<string, string>, file: { name: string; bytes: Buffer; mime: string }, who: string = fpId) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name);
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${who}` },
      body: fd,
    });
    const body: any = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  async function makeDocx(lines: string[]): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          children: lines.map(
            (t) => new Paragraph({ children: [new TextRun(t)] }),
          ),
        },
      ],
    });
    return Buffer.from(await Packer.toBuffer(doc));
  }

  let templateId: string | null = null;
  let contractId: string | null = null;
  let sigRequestId: string | null = null;

  // ---- Task #330 unit checks: classification + formatting ----
  {
    const { classifyFieldRole } = await import("../../src/lib/atelier-contracts.js");
    const { formatReferenceValue, buildFieldValues } = await import(
      "../../src/lib/atelier-contract-service.js"
    );
    const base = { dataType: "text", autoFill: "none", required: false } as any;
    check(
      "classify: token-style [YEAR]/[###] + reference label -> reference",
      classifyFieldRole({ ...base, key: "reference_number", label: "Reference Number", placeholder: "[CGNR-NDA-U-[YEAR]-[###]]" }).role === "reference",
    );
    check(
      "classify: token-style [YYYY]/[NNN] variant -> reference",
      classifyFieldRole({ ...base, key: "ref_no", label: "Ref No.", placeholder: "REF-[YYYY]-[NNN]" }).role === "reference",
    );
    check(
      "classify: literal year+series still -> reference",
      classifyFieldRole({ ...base, key: "agreement_ref", label: "Agreement ref", placeholder: "AGR-2026-003" }).role === "reference",
    );
    check(
      "classify: [YYYY] alone (date field) stays standard",
      classifyFieldRole({ ...base, key: "start_date", label: "Start date", dataType: "date", placeholder: "[DD Month YYYY]" }).role === "standard",
    );
    check(
      "classify: token placeholder WITHOUT reference-like text stays standard",
      classifyFieldRole({ ...base, key: "misc_code", label: "Misc code", placeholder: "[X-[YEAR]-[###]]" }).role === "standard",
    );
    check(
      "format: token-style renders with wrapping brackets stripped",
      formatReferenceValue("[CGNR-NDA-U-[YEAR]-[###]]", 2026, 1) === "CGNR-NDA-U-2026-001",
      formatReferenceValue("[CGNR-NDA-U-[YEAR]-[###]]", 2026, 1),
    );
    check(
      "format: unwrapped token-style renders in place",
      formatReferenceValue("REF-[YYYY]-[NNN]", 2026, 12) === "REF-2026-012",
      formatReferenceValue("REF-[YYYY]-[NNN]", 2026, 12),
    );
    check(
      "format: literal style unchanged",
      formatReferenceValue("AGR-2026-003", 2027, 4) === "AGR-2027-004",
      formatReferenceValue("AGR-2026-003", 2027, 4),
    );
    check(
      "format: unknown shape falls back to YYYY-NNN",
      formatReferenceValue("______", 2026, 7) === "2026-007",
    );
    const bfv = buildFieldValues({
      fields: [
        { ...base, key: "reference_number", label: "Reference Number", placeholder: "[CGNR-NDA-U-[YEAR]-[###]]" },
        { ...base, key: "cp_sign_date", label: "Counterparty date signed", dataType: "date", role: "second_party", placeholder: "Date" },
        { ...base, key: "name", label: "Name", autoFill: "counterparty_name", placeholder: "[NAME]" },
      ],
      counterparty: { kind: "person", id: "x", label: "X", accountId: null, autoFill: { counterparty_name: "X Y" } } as any,
      firm: {},
      explicit: { reference_number: "FAKE", cp_sign_date: "2020-01-01" },
    });
    check(
      "buildFieldValues skips reference + second_party (explicit ignored)",
      bfv.values.reference_number === undefined && bfv.values.cp_sign_date === undefined && bfv.values.name === "X Y",
      bfv,
    );
  }

  try {
    // ---- personas ----
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Probe159 Partner",
      initials: "PP",
      email: `${runTag}_fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierUsers).values({
      id: empUserId,
      orgId: "aico",
      name: "Probe159 Employee",
      initials: "PE",
      email: `${runTag}_emp@example.test`,
      role: "employee",
      roleLabel: "Employee",
      title: "Consultant",
    } as any);
    await db.insert(atelierUsers).values({
      id: p2Id,
      orgId: "aico",
      name: "Probe335 Partner2",
      initials: "P2",
      email: `${runTag}_p2@example.test`,
      role: "partner",
      roleLabel: "Partner",
      title: "Partner",
    } as any);
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      userId: empUserId,
      fullName: "Nadia Probe",
      email: `${runTag}_nadia@example.test`,
      role: "consultant",
      roleTitle: "Consultant",
    } as any);

    // ---- 1. template upload + LLM detection (stubbed) ----
    const tplDocx = await makeDocx([
      "INDIVIDUAL NON-DISCLOSURE AGREEMENT",
      "Reference No.: [CGNR-NDA-U-[YEAR]-[###]]",
      "This NDA is entered into by [COUNTERPARTY_NAME] effective [EFFECTIVE_DATE].",
      "The engagement fee is [FEE_AMOUNT].",
      "Signed by the recipient: date [CP_SIGN_DATE], title [CP_TITLE].",
    ]);
    const tplUp = await upload(
      "/contract-templates",
      { name: `Probe NDA ${runTag}`, contractType: "individual_nda" },
      { name: "nda.docx", bytes: tplDocx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    );
    check("template upload -> 201", tplUp.status === 201, tplUp);
    templateId = tplUp.body?.template?.id ?? null;
    const tplV = tplUp.body?.template?.currentVersion;
    check("fields detected from stub LLM", tplV?.fieldStatus === "detected" && tplV?.fieldSchema?.length === 6, tplV);
    // Task #330 — the token-style reference placeholder came back from the
    // stub WITHOUT a role; deterministic classification must stamp it.
    const detectedRef = (tplV?.fieldSchema ?? []).find((f: any) => f.key === "reference_number");
    check("token-style reference auto-classified", detectedRef?.role === "reference", detectedRef);
    check("template starts draft", tplUp.body?.template?.status === "draft", tplUp.body?.template?.status);
    if (!templateId) throw new Error("no template id — aborting");

    // employee cannot upload templates
    const tplForbidden = await upload(
      "/contract-templates",
      { name: "nope", contractType: "other" },
      { name: "x.docx", bytes: tplDocx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      empUserId,
    );
    check("employee template upload -> 403", tplForbidden.status === 403, tplForbidden);

    // contract create before review -> rejected (template not usable)
    const early = await api("POST", "/contracts", {
      templateId,
      counterparty: { kind: "person", id: empId },
      values: {},
    });
    check("create before field review rejected", early.status >= 400, early);

    // ---- 2. review fields -> reviewed + auto-activate ----
    const review = await api("PUT", `/contract-templates/${templateId}/fields`, {
      fields: DETECTED_FIELDS.fields.map((f) => ({ ...f, note: undefined })),
    });
    check("field review -> 200", review.status === 200, review);
    check("fieldStatus reviewed", review.body?.template?.currentVersion?.fieldStatus === "reviewed", review.body);
    check("template auto-activated", review.body?.template?.status === "active", review.body?.template?.status);

    // ---- 3. create contract for roster person (auto-fill) ----
    // Task #237 — a Cognirise signing entity is mandatory at create.
    await db.insert(atelierLegalEntities).values({
      id: entityId,
      orgId: "aico",
      legalNameEn: "Probe159 Consulting FZ-LLC",
      jurisdiction: "DIFC",
      registeredAddress: "Unit 1, DIFC, Dubai",
      country: "AE",
      governingLaw: "DIFC Law",
      courts: "DIFC Courts",
      status: "active",
    } as any);
    const created = await api("POST", "/contracts", {
      templateId,
      counterparty: { kind: "person", id: empId },
      signingEntityId: entityId,
      // reference_number is explicitly supplied here and MUST be ignored
      // (reference fields are never user-supplied at creation).
      values: { fee: "AED 25,000", reference_number: "FAKE-9999-999" },
      effectiveDate: "2026-07-18",
    });
    check("contract create -> 201", created.status === 201, created);
    contractId = created.body?.contract?.id ?? null;
    const c0 = created.body?.contract;
    check("status draft", c0?.status === "draft", c0?.status);
    check("counterparty label = person name", c0?.counterpartyLabel === "Nadia Probe", c0);
    check(
      "auto-fill counterparty_name from CRM",
      c0?.fieldValues?.counterparty_name === "Nadia Probe",
      c0?.fieldValues,
    );
    check("effective_date auto-filled", String(c0?.fieldValues?.effective_date ?? "").includes("2026"), c0?.fieldValues);
    // Task #330 — token-style reference: auto-assigned in the template's
    // own style, never the explicit (fake) value, never the raw placeholder.
    const refYear = new Date().getFullYear();
    const assignedRef = String(c0?.fieldValues?.reference_number ?? "");
    check(
      "token-style reference auto-assigned at prepare",
      new RegExp(`^CGNR-NDA-U-${refYear}-\\d{3}$`).test(assignedRef),
      c0?.fieldValues,
    );
    check("explicit reference value ignored", assignedRef !== "FAKE-9999-999", assignedRef);
    const draftDocs = (c0?.documents ?? []).filter((d: any) => d.kind === "generated_draft");
    check("draft .docx generated on chain", draftDocs.length === 1, c0?.documents);
    if (!contractId) throw new Error("no contract id — aborting");

    // draft docx actually contains the filled value
    const dl = await fetch(`${BASE}/contracts/${contractId}/documents/${draftDocs[0].id}/download`, {
      headers: { cookie: `atelier_persona=${fpId}` },
    });
    check("draft download -> 200 docx", dl.status === 200, dl.status);
    const draftBytes = Buffer.from(await dl.arrayBuffer());
    const { extractDocxText } = await import("../../src/lib/atelier-contracts.js");
    const draftText = await extractDocxText(draftBytes);
    check("draft text has filled name (no placeholder left)", draftText.includes("Nadia Probe") && !draftText.includes("[COUNTERPARTY_NAME]"), draftText.slice(0, 200));
    check("draft text has fee value", draftText.includes("AED 25,000"), draftText.slice(0, 200));
    check(
      "draft text shows assigned reference (raw placeholder gone)",
      draftText.includes(assignedRef) && !draftText.includes("[CGNR-NDA-U-["),
      draftText.slice(0, 300),
    );

    // ---- 4. regenerate with edited values ----
    const regen = await api("POST", `/contracts/${contractId}/regenerate`, {
      values: { fee: "AED 30,000" },
    });
    check("regenerate -> 201", regen.status === 201, regen);
    check("regenerated values merged", regen.body?.contract?.fieldValues?.fee === "AED 30,000", regen.body?.contract?.fieldValues);
    check(
      "assigned reference carries over on regenerate (not reallocated)",
      regen.body?.contract?.fieldValues?.reference_number === assignedRef,
      regen.body?.contract?.fieldValues,
    );
    const afterRegen = await api("GET", `/contracts/${contractId}`);
    const regenDrafts = (afterRegen.body?.contract?.documents ?? []).filter(
      (d: any) => d.kind === "generated_draft",
    );
    check("regenerate adds a new draft version", regenDrafts.length === 2, afterRegen.body?.contract?.documents);

    // ---- 5. final Word upload -> LibreOffice PDF ----
    const finalDocx = await makeDocx([
      "INDIVIDUAL NON-DISCLOSURE AGREEMENT (FINAL)",
      "This NDA is entered into by Nadia Probe effective 18 July 2026.",
    ]);
    const fin = await upload(
      `/contracts/${contractId}/final`,
      {},
      { name: "nda-final.docx", bytes: finalDocx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    );
    check("final upload -> 200/201", fin.status === 200 || fin.status === 201, fin);
    const cf = fin.body?.contract;
    check("status final_uploaded", cf?.status === "final_uploaded", cf?.status);
    const finDocs = (cf?.documents ?? []).filter((d: any) => d.kind === "final_docx");
    check("final_docx on chain", finDocs.length === 1, cf?.documents);

    // ---- 5b. Task #335 — per-entity authorised signatories ----
    // Configure: only fp is an authorised signatory of the entity.
    const setSig = await api("PUT", `/signing-entities/${entityId}/signatories`, {
      userIds: [fpId],
    });
    check("set signatories -> 200", setSig.status === 200, setSig);
    check(
      "signatories echo resolved user",
      (setSig.body?.authorisedSignatories ?? []).some((s: any) => s.userId === fpId),
      setSig.body,
    );
    const badSig = await api("PUT", `/signing-entities/${entityId}/signatories`, {
      userIds: ["u_not_a_real_user"],
    });
    check("unknown signatory user -> 400", badSig.status === 400, badSig);
    const empSig = await api(
      "PUT",
      `/signing-entities/${entityId}/signatories`,
      { userIds: [] },
      empUserId,
    );
    check("employee cannot set signatories -> 403", empSig.status === 403, empSig);
    const entList = await api("GET", "/signing-entities");
    const entWire = (entList.body?.entities ?? []).find((e: any) => e.id === entityId);
    check(
      "GET signing-entities includes authorisedSignatories",
      (entWire?.authorisedSignatories ?? []).some((s: any) => s.userId === fpId),
      entWire,
    );

    // Viewer flags on contract detail.
    const detailFp = await api("GET", `/contracts/${contractId}`);
    check(
      "fp viewerIsAuthorisedSignatory true",
      detailFp.body?.signing?.viewerIsAuthorisedSignatory === true,
      detailFp.body?.signing,
    );
    const detailP2 = await api("GET", `/contracts/${contractId}`, undefined, p2Id);
    check(
      "p2 viewerIsAuthorisedSignatory false",
      detailP2.body?.signing?.viewerIsAuthorisedSignatory === false,
      detailP2.body?.signing,
    );

    // Crafted signFirst by a non-signatory manager -> 403.
    const p2Sign = await api(
      "POST",
      `/contracts/${contractId}/send-for-signature`,
      {
        signers: [
          { name: "Probe335 Partner2", email: `${runTag}_p2@example.test` },
          { name: "Nadia Probe", email: "p159_signer@example.test" },
        ],
        signFirst: true,
      },
      p2Id,
    );
    check("non-signatory signFirst -> 403", p2Sign.status === 403, p2Sign);
    check(
      "403 code not-authorised-signatory",
      p2Sign.body?.error === "not-authorised-signatory",
      p2Sign.body,
    );
    // Signatory signFirst where the first signer is NOT the caller -> 403.
    const fpWrongFirst = await api("POST", `/contracts/${contractId}/send-for-signature`, {
      signers: [{ name: "Someone Else", email: "someone_else@example.test" }],
      signFirst: true,
    });
    check("signFirst first-signer-not-caller -> 403", fpWrongFirst.status === 403, fpWrongFirst);
    check(
      "403 code sign-first-not-caller",
      fpWrongFirst.body?.error === "sign-first-not-caller",
      fpWrongFirst.body,
    );

    // Non-signatory "Send for signature" (internal request) -> awaiting + notify.
    const reqSig = await api("POST", `/contracts/${contractId}/request-signature`, {}, p2Id);
    check("request-signature -> 200", reqSig.status === 200, reqSig);
    check(
      "awaiting fields set",
      !!reqSig.body?.contract?.firmSignatureRequestedAt &&
        reqSig.body?.contract?.firmSignatureRequestedBy === p2Id,
      reqSig.body?.contract,
    );
    const notifRows = await db
      .select()
      .from(atelierSelfNotifications)
      .where(eq(atelierSelfNotifications.userId, fpId));
    check(
      "signatory notified",
      notifRows.some((n: any) => n.kind === "contract_signature_requested"),
      notifRows.map((n: any) => n.kind),
    );
    const empReq = await api("POST", `/contracts/${contractId}/request-signature`, {}, empUserId);
    check("employee request-signature -> 403", empReq.status === 403, empReq);

    // ---- 6. send for signature (LibreOffice PDF + stub DocuSeal) ----
    const sent = await api("POST", `/contracts/${contractId}/send-for-signature`, {
      signers: [{ name: "Nadia Probe", email: "p159_signer@example.test" }],
    });
    check("send-for-signature -> 200/201", sent.status === 200 || sent.status === 201, sent);
    check("status out_for_signature", sent.body?.contract?.status === "out_for_signature", sent.body?.contract?.status);
    sigRequestId = sent.body?.contract?.signatureRequestId ?? null;
    check("signatureRequestId linked", !!sigRequestId, sent.body?.contract);
    // Task #335 — a successful send clears the awaiting-firm-signatory flag.
    check(
      "awaiting flag cleared on send",
      sent.body?.contract?.firmSignatureRequestedAt == null,
      sent.body?.contract?.firmSignatureRequestedAt,
    );

    // Task #298 — the second-party template fields become DocuSeal boxes:
    // a date box (auto-filled at signing) and a labelled text box the
    // counterparty completes, both on the signer's role.
    const dsFields = (lastTemplateFields ?? []) as any[];
    const dsDate = dsFields.filter((f) => f.type === "date");
    const dsText = dsFields.filter((f) => f.type === "text");
    check(
      "second-party date box stamped for the signer",
      dsDate.length === 1 && dsDate[0].role === "Signer 1",
      JSON.stringify(dsFields.map((f) => ({ n: f.name, t: f.type, r: f.role }))),
    );
    check(
      "second-party text box stamped with the field label",
      dsText.length === 1 && dsText[0].role === "Signer 1" && String(dsText[0].name).startsWith("Signatory title"),
      JSON.stringify(dsFields.map((f) => ({ n: f.name, t: f.type, r: f.role }))),
    );
    check(
      "extra boxes land on a real page (clamped)",
      dsFields.every((f) => (f.areas ?? []).every((a: any) => a.page >= 1)),
      JSON.stringify(dsFields.map((f) => f.areas)),
    );

    const afterSend = await api("GET", `/contracts/${contractId}`);
    const pdfDocs = (afterSend.body?.contract?.documents ?? []).filter(
      (d: any) => d.kind === "converted_pdf",
    );
    check("converted_pdf generated at send", pdfDocs.length === 1 && pdfDocs[0].mime === "application/pdf", afterSend.body?.contract?.documents);
    const pdfDl = await fetch(`${BASE}/contracts/${contractId}/documents/${pdfDocs[0].id}/download`, {
      headers: { cookie: `atelier_persona=${fpId}` },
    });
    const pdfBytes = Buffer.from(await pdfDl.arrayBuffer());
    check("downloaded PDF magic bytes", pdfBytes.subarray(0, 4).toString() === "%PDF", pdfBytes.subarray(0, 8).toString());

    // manual status edits to signature-driven statuses are rejected
    const manualSigned = await api("PATCH", `/contracts/${contractId}`, { status: "signed" });
    check("manual 'signed' rejected -> 409", manualSigned.status === 409, manualSigned);

    // ---- 7. e-sign sync completes -> contract signed ----
    submissionCompleted = true;
    const sync = await api("POST", `/esign/requests/${sigRequestId}/sync`);
    check("esign sync -> 200", sync.status === 200, sync);
    const after = await api("GET", `/contracts/${contractId}`);
    check("contract signed after sync", after.body?.contract?.status === "signed", after.body?.contract?.status);
    const signedDocs = (after.body?.contract?.documents ?? []).filter((d: any) => d.kind === "signed_pdf");
    check("signed PDF copied onto chain", signedDocs.length === 1, after.body?.contract?.documents);
    check("signed library doc linked", !!after.body?.contract?.signedLibraryDocumentId, after.body?.contract);

    // terminal status never regresses
    const regress = await api("PATCH", `/contracts/${contractId}`, { status: "voided" });
    check("terminal status never regresses -> 409", regress.status === 409, regress);
    const regen2 = await api("POST", `/contracts/${contractId}/regenerate`, { values: {} });
    check("regenerate after signed rejected", regen2.status >= 400, regen2);

    // ---- 7b. Task #335 — authorised signatory signs & sends from DRAFT ----
    const created2 = await api("POST", "/contracts", {
      templateId,
      counterparty: { kind: "person", id: empId },
      signingEntityId: entityId,
      values: { fee: "AED 5,000", effective_date: "20 July 2026" },
    });
    check("second contract create -> 201", created2.status === 201, created2);
    contract2Id = created2.body?.contract?.id ?? null;
    check("second contract is draft", created2.body?.contract?.status === "draft", created2.body?.contract?.status);
    const sent2 = await api("POST", `/contracts/${contract2Id}/send-for-signature`, {
      signers: [
        { name: "Probe159 Partner", email: `${runTag}_fp@example.test` },
        { name: "Nadia Probe", email: "p159_signer@example.test" },
      ],
      signFirst: true,
    });
    check("signatory signFirst from draft -> 201", sent2.status === 201, sent2);
    check(
      "second contract out_for_signature",
      sent2.body?.contract?.status === "out_for_signature",
      sent2.body?.contract?.status,
    );
    sigRequestId2 = sent2.body?.contract?.signatureRequestId ?? null;

    // ---- 8. RBAC: employee sees OWN contract via Me lens, cannot manage ----
    // Employee personas are hard-gated to /me/* (Task #50 self-scope).
    const gated = await api("GET", `/contracts/${contractId}`, undefined, empUserId);
    check("employee /contracts/:id gated -> 403", gated.status === 403, gated);
    const mine = await api("GET", "/me/contracts", undefined, empUserId);
    check(
      "employee /me/contracts lists own contract",
      mine.status === 200 && (mine.body?.contracts ?? []).some((c: any) => c.id === contractId),
      mine,
    );
    // Task #161 — employee opens own contract detail + downloads signed PDF
    // via the self-scope /me/contracts/* routes.
    const mineDetail = await api("GET", `/me/contracts/${contractId}`, undefined, empUserId);
    check("employee /me/contracts/:id -> 200", mineDetail.status === 200, mineDetail);
    // Task #166 — signature history rides beside the contract for the
    // employee's own record: who signed, their status and completed-at.
    const mineSig = mineDetail.body?.signatureRequest;
    check("me detail includes signatureRequest", !!mineSig && mineSig.id === sigRequestId, mineSig);
    check(
      "signatureRequest completed after sync",
      mineSig?.status === "completed" && !!mineSig?.completedAt,
      mineSig,
    );
    const mineSigner = (mineSig?.signers ?? [])[0];
    check(
      "signer name/status/completedAt visible",
      mineSigner?.name === "Nadia Probe" &&
        mineSigner?.status === "completed" &&
        !!mineSigner?.completedAt,
      mineSig?.signers,
    );
    const mineDocs = mineDetail.body?.contract?.documents ?? [];
    const mineSigned = mineDocs.find((d: any) => d.kind === "signed_pdf");
    check("me detail includes documents chain + signed_pdf", !!mineSigned, mineDocs);
    if (mineSigned) {
      const mineDl = await fetch(
        `${BASE}/me/contracts/${contractId}/documents/${mineSigned.id}/download`,
        { headers: { cookie: `atelier_persona=${empUserId}` } },
      );
      const mineBytes = Buffer.from(await mineDl.arrayBuffer());
      check(
        "employee downloads own signed PDF via /me route",
        mineDl.status === 200 && mineBytes.subarray(0, 4).toString() === "%PDF",
        { status: mineDl.status, head: mineBytes.subarray(0, 8).toString() },
      );
    }
    // Not the caller's contract (fp has no roster row linked) -> 403.
    const notMine = await api("GET", `/me/contracts/${contractId}`, undefined, fpId);
    check("/me/contracts/:id on someone else's contract -> 403", notMine.status === 403, notMine);
    const notMineDl = await api(
      "GET",
      `/me/contracts/${contractId}/documents/${mineSigned?.id ?? "doc_x"}/download`,
      undefined,
      fpId,
    );
    check("/me download on someone else's contract -> 403", notMineDl.status === 403, notMineDl);
    // Unknown contract id -> 404.
    const mineMissing = await api("GET", "/me/contracts/ctr_does_not_exist", undefined, empUserId);
    check("/me/contracts/:id unknown -> 404", mineMissing.status === 404, mineMissing);

    const empPatch = await api("PATCH", `/contracts/${contractId}`, { notes: "hax" }, empUserId);
    check("employee cannot patch contract -> 403", empPatch.status === 403, empPatch);
    const empCreate = await api(
      "POST",
      "/contracts",
      { templateId, counterparty: { kind: "person", id: empId }, values: {} },
      empUserId,
    );
    check("employee cannot create contract -> 403", empCreate.status === 403, empCreate);
  } finally {
    // ---- cleanup (tracked ids + tag sweep) ----
    try {
      if (contractId) {
        await db.delete(atelierContractDocuments).where(eq(atelierContractDocuments.contractId, contractId));
        await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, contractId));
      }
      if (sigRequestId) {
        await db.delete(atelierSignatureSigners).where(eq(atelierSignatureSigners.requestId, sigRequestId));
        await db.delete(atelierSignatureRequests).where(eq(atelierSignatureRequests.id, sigRequestId));
      }
      if (contract2Id) {
        await db.delete(atelierContractDocuments).where(eq(atelierContractDocuments.contractId, contract2Id));
        await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, contract2Id));
      }
      if (sigRequestId2) {
        await db.delete(atelierSignatureSigners).where(eq(atelierSignatureSigners.requestId, sigRequestId2));
        await db.delete(atelierSignatureRequests).where(eq(atelierSignatureRequests.id, sigRequestId2));
      }
      await db.delete(atelierSigningEntitySignatories).where(eq(atelierSigningEntitySignatories.entityId, entityId));
      await db.delete(atelierSelfNotifications).where(inArray(atelierSelfNotifications.userId, [fpId, p2Id]));
      if (templateId) {
        await db.delete(atelierContractTemplateVersions).where(eq(atelierContractTemplateVersions.templateId, templateId));
        await db.delete(atelierContractTemplates).where(eq(atelierContractTemplates.id, templateId));
        await db
          .delete((D as any).atelierContractReferenceSequences)
          .where(eq((D as any).atelierContractReferenceSequences.templateId, templateId));
      }
      await db.delete(atelierDocuments).where(like(atelierDocuments.title, `%${runTag}%`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, entityId));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, empUserId, p2Id]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    anthropicStub.close();
    docusealStub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
