/**
 * Task #305 — Live DocuSeal counterparty text-field probe (temporary, self-cleaning).
 *
 * Task #298 added labelled TEXT fill-in boxes (printed name, title, …) for the
 * counterparty signer on contract send. All automated checks ran against the
 * shape-agnostic stub; the real DocuSeal Cloud API is stricter (it rejected
 * field-less templates and 0-based pages before). This probe verifies live:
 *   1. createTemplateFromPdf with signature + date + labelled text extra
 *      fields returns 200 and a template id.
 *   2. GET /templates/:id round-trips the text fields with type "text",
 *      the custom names ("Printed name 2", "Title 2") and correct role binding.
 *   3. A submission can be created and the counterparty submitter completed
 *      with values for the text fields; the signed PDF contains the typed
 *      values (pdftotext) — i.e. the boxes actually render into the document.
 *   4. Archive the submission + template. No local DB rows are created.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTemplateFromPdf,
  createSubmission,
  docusealBaseUrl,
  docusealConfigured,
  type ExtraSignerField,
} from "../src/lib/docuseal.js";

const TAG = "__esignprobe305";

function onePagePdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${docusealBaseUrl()}${path}`, {
    method,
    headers: {
      "X-Auth-Token": process.env.DOCUSEAL_API_KEY!.trim(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  if (!docusealConfigured()) throw new Error("DOCUSEAL_API_KEY not set");
  console.log(`[probe] DocuSeal base: ${docusealBaseUrl()}`);

  // Counterparty = signer index 1 (Signer 2), like the contract send path.
  const extraFields: ExtraSignerField[] = [
    { signerIndex: 0, type: "date", page: 1, x: 0.08, y: 0.74, w: 0.2, h: 0.04 },
    { signerIndex: 1, type: "date", page: 1, x: 0.55, y: 0.74, w: 0.2, h: 0.04 },
    { signerIndex: 1, type: "text", label: "Printed name", page: 1, x: 0.55, y: 0.8, w: 0.32, h: 0.04 },
    { signerIndex: 1, type: "text", label: "Title", page: 1, x: 0.55, y: 0.86, w: 0.32, h: 0.04 },
  ];
  const pdf = onePagePdf(`Text-field probe ${TAG}`);

  let templateId: number | null = null;
  let submissionId: number | null = null;
  const tmp = mkdtempSync(join(tmpdir(), "esign305-"));
  const failures: string[] = [];

  try {
    const tpl = await createTemplateFromPdf({
      name: `Text-field probe ${TAG}`,
      fileName: `textfield_probe_${TAG}.pdf`,
      pdfBytes: pdf,
      signerCount: 2,
      lastPageIndex: 0,
      extraFields,
    });
    templateId = tpl.id;
    console.log(`[probe] template created: ${templateId}`);

    const full = (await api("GET", `/templates/${templateId}`)) as {
      fields?: Array<{
        name: string;
        type: string;
        required?: boolean;
        submitter_uuid?: string;
        areas?: Array<{ x: number; y: number; w: number; h: number; page: number }>;
      }>;
      submitters?: Array<{ name: string; uuid: string }>;
    };
    const fields = full.fields ?? [];
    console.log(`[probe] template fields: ${JSON.stringify(fields.map((f) => ({ name: f.name, type: f.type, role: full.submitters?.find((s) => s.uuid === f.submitter_uuid)?.name })))}`);
    const expect: Array<{ name: string; type: string; role: string }> = [
      { name: "Signature 1", type: "signature", role: "Signer 1" },
      { name: "Signature 2", type: "signature", role: "Signer 2" },
      { name: "Date signed 1", type: "date", role: "Signer 1" },
      { name: "Date signed 2", type: "date", role: "Signer 2" },
      { name: "Printed name 2", type: "text", role: "Signer 2" },
      { name: "Title 2", type: "text", role: "Signer 2" },
    ];
    if (fields.length !== expect.length) failures.push(`expected ${expect.length} fields, got ${fields.length}`);
    for (const e of expect) {
      const f = fields.find((f) => f.name === e.name);
      if (!f) {
        failures.push(`field "${e.name}" missing on live template`);
        continue;
      }
      if (f.type !== e.type) failures.push(`field "${e.name}" type=${f.type}, expected ${e.type}`);
      const role = full.submitters?.find((s) => s.uuid === f.submitter_uuid)?.name;
      if (role !== e.role) failures.push(`field "${e.name}" bound to role "${role}", expected "${e.role}"`);
      if (!f.areas?.length) failures.push(`field "${e.name}" has no area`);
    }

    // Submission → complete both signers; counterparty fills the text boxes.
    const sub = await createSubmission({
      templateId,
      signers: [
        { name: "Probe One", email: `probe1.${TAG}@example.com` },
        { name: "Probe Two", email: `probe2.${TAG}@example.com` },
      ],
      subject: "Automated text-field probe — ignore",
      message: "Automated text-field probe. Safe to ignore.",
    });
    submissionId = sub.submissionId;
    console.log(`[probe] submission ${submissionId}, submitters ${sub.submitters.map((s) => s.id)}`);
    const sigPngPath = join(tmp, "sig.png");
    execFileSync("magick", [
      "-size", "120x40", "xc:none",
      "-stroke", "black", "-strokewidth", "3",
      "-draw", "line 10,30 40,10 line 40,10 70,30 line 70,30 110,12",
      sigPngPath,
    ]);
    const sigPng = readFileSync(sigPngPath).toString("base64");
    const PRINTED = "Jane Q Counterparty305";
    const TITLE = "Chief Probe Officer305";
    await api("PUT", `/submitters/${sub.submitters[0].id}`, {
      completed: true,
      values: {
        "Signature 1": `data:image/png;base64,${sigPng}`,
        "Date signed 1": "2026-07-19",
      },
    });
    await api("PUT", `/submitters/${sub.submitters[1].id}`, {
      completed: true,
      values: {
        "Signature 2": `data:image/png;base64,${sigPng}`,
        "Date signed 2": "2026-07-19",
        "Printed name 2": PRINTED,
        "Title 2": TITLE,
      },
    });

    let signedUrl: string | null = null;
    for (let i = 0; i < 10 && !signedUrl; i++) {
      const got = (await api("GET", `/submissions/${submissionId}`)) as {
        status?: string;
        documents?: Array<{ name?: string; url: string }>;
      };
      const doc = got.documents?.find((d) => !/audit/i.test(d.name ?? ""));
      if (got.status === "completed" && doc) signedUrl = doc.url;
      else await new Promise((r) => setTimeout(r, 3000));
    }
    if (!signedUrl) {
      failures.push("submission did not complete / no signed document URL");
    } else {
      const res = await fetch(signedUrl, {
        headers: { "X-Auth-Token": process.env.DOCUSEAL_API_KEY!.trim() },
      });
      if (!res.ok) throw new Error(`signed doc download -> ${res.status}`);
      const signedPath = join(tmp, "signed.pdf");
      writeFileSync(signedPath, Buffer.from(await res.arrayBuffer()));
      const text = execFileSync("pdftotext", [signedPath, "-"]).toString();
      console.log(`[probe] signed PDF text: ${JSON.stringify(text.slice(0, 400))}`);
      if (!text.includes(PRINTED)) failures.push(`typed printed-name value "${PRINTED}" not found in signed PDF`);
      if (!text.includes(TITLE)) failures.push(`typed title value "${TITLE}" not found in signed PDF`);
    }

    if (failures.length) {
      console.error(`[probe] ❌ FAILURES:\n - ${failures.join("\n - ")}`);
      throw new Error("text-field probe failed");
    }
    console.log("[probe] ✅ LIVE TEXT-FIELD PROBE PASSED — labelled counterparty text boxes are accepted and render into the signed PDF");
  } finally {
    try {
      if (submissionId) await api("DELETE", `/submissions/${submissionId}`).catch(() => {});
      if (templateId) await api("DELETE", `/templates/${templateId}`).catch(() => {});
      console.log(`[probe] cleaned up submission=${submissionId} template=${templateId}`);
    } catch (err) {
      console.error(`[probe] cleanup error: ${err}`);
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[probe] FAILED: ${err instanceof Error ? err.stack : err}`);
    process.exit(1);
  },
);
