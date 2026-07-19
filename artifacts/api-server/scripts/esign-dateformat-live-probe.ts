/**
 * Task #309 — Live DocuSeal date-format probe (temporary, self-cleaning).
 *
 * createTemplateFromPdf now stamps date fields with an explicit
 * preferences.format (DD MMM YYYY) so signed PDFs don't render dates in
 * the ambiguous US default (07/19/2026). This probe verifies live:
 *   1. The template's date fields round-trip with the format preference.
 *   2. The completed signed PDF renders the date as "19 Jul 2026" and
 *      does NOT contain "07/19/2026".
 *   3. Archives the submission + template. No local DB rows are created.
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
  DATE_FIELD_FORMAT,
  type ExtraSignerField,
} from "../src/lib/docuseal.js";

const TAG = "__esignprobe309";

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
  console.log(`[probe] DocuSeal base: ${docusealBaseUrl()}, format: ${DATE_FIELD_FORMAT}`);

  const extraFields: ExtraSignerField[] = [
    { signerIndex: 0, type: "date", page: 1, x: 0.08, y: 0.74, w: 0.2, h: 0.04 },
    { signerIndex: 1, type: "date", page: 1, x: 0.55, y: 0.74, w: 0.2, h: 0.04 },
  ];
  const pdf = onePagePdf(`Date-format probe ${TAG}`);

  let templateId: number | null = null;
  let submissionId: number | null = null;
  const tmp = mkdtempSync(join(tmpdir(), "esign309-"));
  const failures: string[] = [];

  try {
    const tpl = await createTemplateFromPdf({
      name: `Date-format probe ${TAG}`,
      fileName: `dateformat_probe_${TAG}.pdf`,
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
        preferences?: { format?: string };
      }>;
    };
    const dateFields = (full.fields ?? []).filter((f) => f.type === "date");
    console.log(
      `[probe] date fields: ${JSON.stringify(dateFields.map((f) => ({ name: f.name, preferences: f.preferences })))}`,
    );
    if (dateFields.length !== 2) failures.push(`expected 2 date fields, got ${dateFields.length}`);
    for (const f of dateFields) {
      if (f.preferences?.format !== DATE_FIELD_FORMAT) {
        failures.push(
          `field "${f.name}" preferences.format=${JSON.stringify(f.preferences?.format)}, expected "${DATE_FIELD_FORMAT}"`,
        );
      }
    }

    const sub = await createSubmission({
      templateId,
      signers: [
        { name: "Probe One", email: `probe1.${TAG}@example.com` },
        { name: "Probe Two", email: `probe2.${TAG}@example.com` },
      ],
      subject: "Automated date-format probe — ignore",
      message: "Automated date-format probe. Safe to ignore.",
    });
    submissionId = sub.submissionId;
    console.log(`[probe] submission ${submissionId}`);
    const sigPngPath = join(tmp, "sig.png");
    execFileSync("magick", [
      "-size", "120x40", "xc:none",
      "-stroke", "black", "-strokewidth", "3",
      "-draw", "line 10,30 40,10 line 40,10 70,30 line 70,30 110,12",
      sigPngPath,
    ]);
    const sigPng = readFileSync(sigPngPath).toString("base64");
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
      console.log(`[probe] signed PDF text: ${JSON.stringify(text.slice(0, 500))}`);
      if (!text.includes("19 Jul 2026")) failures.push('formatted date "19 Jul 2026" not found in signed PDF');
      if (text.includes("07/19/2026")) failures.push('US-format date "07/19/2026" still present in signed PDF');
    }

    if (failures.length) {
      console.error(`[probe] ❌ FAILURES:\n - ${failures.join("\n - ")}`);
      throw new Error("date-format probe failed");
    }
    console.log("[probe] ✅ LIVE DATE-FORMAT PROBE PASSED — signed PDF renders dates as DD MMM YYYY");
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
