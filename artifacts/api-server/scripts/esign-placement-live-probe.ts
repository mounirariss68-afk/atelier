/**
 * Task #150 — Live DocuSeal custom-placement probe (temporary, self-cleaning).
 *
 * Verifies that createTemplateFromPdf's custom SignaturePlacement mapping
 * lands correctly on the REAL DocuSeal service (the local stub is
 * shape-agnostic and never validated pages/coords):
 *   1. Build a 3-page PDF.
 *   2. createTemplateFromPdf with custom boxes: signer 1 on page 2,
 *      signer 2 on page 3, at distinct normalized coordinates.
 *   3. GET /templates/:id and assert the stored field areas round-trip
 *      exactly (1-based page, x/y/w/h fractions) and that the document
 *      was parsed as 3 pages.
 *   4. Create a submission, complete both submitters, download the
 *      signed PDF, rasterize each page (pdftoppm) and diff against the
 *      original render — the stamped pages must be exactly {2, 3}.
 *   5. Archive the submission + template. No local DB rows are created.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTemplateFromPdf,
  createSubmission,
  docusealBaseUrl,
  docusealConfigured,
  type SignaturePlacement,
} from "../src/lib/docuseal.js";

const TAG = "__esignprobe150";

function multiPagePdf(pages: string[]): Buffer {
  const n = pages.length;
  // objects: 1 catalog, 2 pages, then per page: page obj + content obj, last: font
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  const fontRef = `${3 + n * 2} 0 R`;
  pages.forEach((text, i) => {
    const contentObj = 4 + i * 2;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontRef} >> >> >>`,
    );
    const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
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

function rasterize(pdfPath: string, outPrefix: string): string[] {
  execFileSync("pdftoppm", ["-r", "50", "-png", pdfPath, outPrefix]);
  const dir = join(outPrefix, "..");
  return readdirSync(dir)
    .filter((f) => f.startsWith(outPrefix.split("/").pop()!) && f.endsWith(".png"))
    .sort()
    .map((f) => join(dir, f));
}

function near(a: number, b: number, tol = 1e-4): boolean {
  return Math.abs(a - b) <= tol;
}

async function main() {
  if (!docusealConfigured()) throw new Error("DOCUSEAL_API_KEY not set");
  console.log(`[probe] DocuSeal base: ${docusealBaseUrl()}`);

  const placements: SignaturePlacement[] = [
    { page: 2, x: 0.1, y: 0.25, w: 0.3, h: 0.06 },
    { page: 3, x: 0.55, y: 0.7, w: 0.35, h: 0.05 },
  ];
  const pdf = multiPagePdf([
    `Placement probe ${TAG} - page one - no boxes here`,
    `Placement probe ${TAG} - page two - signer 1 box`,
    `Placement probe ${TAG} - page three - signer 2 box`,
  ]);

  let templateId: number | null = null;
  let submissionId: number | null = null;
  const tmp = mkdtempSync(join(tmpdir(), "esign150-"));
  const failures: string[] = [];

  try {
    // 2. Create template with custom placements
    const tpl = await createTemplateFromPdf({
      name: `Placement probe ${TAG}`,
      fileName: `placement_probe_${TAG}.pdf`,
      pdfBytes: pdf,
      signerCount: 2,
      lastPageIndex: 2,
      placements,
    });
    templateId = tpl.id;
    console.log(`[probe] template created: ${templateId}`);

    // 3. Read back and verify areas
    const full = (await api("GET", `/templates/${templateId}`)) as {
      fields?: Array<{
        name: string;
        type: string;
        submitter_uuid?: string;
        areas?: Array<{ x: number; y: number; w: number; h: number; page: number; attachment_uuid?: string }>;
      }>;
      submitters?: Array<{ name: string; uuid: string }>;
    };
    const fields = full.fields ?? [];
    console.log(`[probe] template fields: ${JSON.stringify(fields)}`);
    console.log(`[probe] template submitters: ${JSON.stringify(full.submitters)}`);
    if (fields.length !== 2) failures.push(`expected 2 fields, got ${fields.length}`);
    placements.forEach((p, i) => {
      const f = fields.find((f) => f.name === `Signature ${i + 1}`);
      const a = f?.areas?.[0];
      if (!f || !a) {
        failures.push(`field "Signature ${i + 1}" missing or has no area`);
        return;
      }
      if (f.type !== "signature") failures.push(`field ${i + 1} type=${f.type}`);
      const role = full.submitters?.find((s) => s.uuid === f.submitter_uuid)?.name;
      if (role !== `Signer ${i + 1}`) failures.push(`field ${i + 1} bound to role "${role}", expected "Signer ${i + 1}"`);
      if (!near(a.x, p.x) || !near(a.y, p.y) || !near(a.w, p.w) || !near(a.h, p.h)) {
        failures.push(
          `field ${i + 1} coords round-trip mismatch: sent ${JSON.stringify(p)} got ${JSON.stringify(a)}`,
        );
      }
      // DocuSeal Cloud accepts 1-based pages on create ("page must be more
      // than 0") but STORES them 0-based; a correct round-trip is stored ===
      // sent - 1. The render check below is the authoritative proof.
      console.log(`[probe] field ${i + 1}: sent page=${p.page} stored page=${a.page} (0-based storage expected)`);
      if (a.page !== p.page - 1) {
        failures.push(`field ${i + 1} stored page=${a.page}, expected ${p.page - 1} (0-based) for sent 1-based page ${p.page}`);
      }
    });

    // 4. Submission → complete both → signed PDF → rasterize diff
    const sub = await createSubmission({
      templateId,
      signers: [
        { name: "Probe One", email: `probe1.${TAG}@example.com` },
        { name: "Probe Two", email: `probe2.${TAG}@example.com` },
      ],
      subject: "Automated placement probe — ignore",
      message: "Automated placement probe. Safe to ignore.",
    });
    submissionId = sub.submissionId;
    console.log(`[probe] submission ${submissionId}, submitters ${sub.submitters.map((s) => s.id)}`);
    // Complete each submitter WITH a real signature image value so the
    // stamp is actually drawn into the signed PDF (completed:true alone
    // renders nothing, making the page-diff check inconclusive).
    const sigPngPath = join(tmp, "sig.png");
    execFileSync("magick", [
      "-size", "120x40", "xc:none",
      "-stroke", "black", "-strokewidth", "3",
      "-draw", "line 10,30 40,10 line 40,10 70,30 line 70,30 110,12",
      sigPngPath,
    ]);
    const sigPng = readFileSync(sigPngPath).toString("base64");
    for (const [i, s] of sub.submitters.entries()) {
      await api("PUT", `/submitters/${s.id}`, {
        completed: true,
        values: { [`Signature ${i + 1}`]: `data:image/png;base64,${sigPng}` },
      });
    }
    // fetch signed doc
    let signedUrl: string | null = null;
    for (let i = 0; i < 10 && !signedUrl; i++) {
      const got = (await api("GET", `/submissions/${submissionId}`)) as {
        status?: string;
        documents?: Array<{ name?: string; url: string }>;
        audit_log_url?: string | null;
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
      const signed = Buffer.from(await res.arrayBuffer());
      const origPath = join(tmp, "orig.pdf");
      const signedPath = join(tmp, "signed.pdf");
      writeFileSync(origPath, pdf);
      writeFileSync(signedPath, signed);
      const origPages = rasterize(origPath, join(tmp, "orig"));
      const signedPages = rasterize(signedPath, join(tmp, "signed"));
      console.log(`[probe] rasterized: orig=${origPages.length} pages, signed=${signedPages.length} pages`);
      if (signedPages.length !== 3) failures.push(`signed PDF has ${signedPages.length} pages, expected 3`);
      const changed: number[] = [];
      for (let i = 0; i < Math.min(origPages.length, signedPages.length); i++) {
        const a = readFileSync(origPages[i]);
        const b = readFileSync(signedPages[i]);
        let diff = !a.equals(b);
        if (diff) {
          // pixel-level compare via ImageMagick for a robust count
          try {
            const out = execFileSync(
              "magick",
              ["compare", "-metric", "AE", origPages[i], signedPages[i], "null:"],
              { stdio: ["ignore", "pipe", "pipe"] },
            ).toString();
            diff = parseFloat(out || "1") > 50;
          } catch (e) {
            const errOut = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
            const n = parseFloat(errOut);
            diff = Number.isFinite(n) ? n > 50 : true;
          }
        }
        if (diff) changed.push(i + 1);
      }
      console.log(`[probe] pages with stamped content vs original: [${changed.join(", ")}]`);
      const expected = [2, 3];
      if (JSON.stringify(changed) !== JSON.stringify(expected)) {
        failures.push(
          `signature stamps landed on pages [${changed.join(",")}], expected [${expected.join(",")}] — page-index mapping is wrong`,
        );
      }
    }

    if (failures.length) {
      console.error(`[probe] ❌ FAILURES:\n - ${failures.join("\n - ")}`);
      throw new Error("placement probe failed");
    }
    console.log("[probe] ✅ LIVE PLACEMENT PROBE PASSED — custom boxes land on the intended pages/coords");
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
