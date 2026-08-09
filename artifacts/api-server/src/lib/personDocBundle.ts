/**
 * One-file bundle of a two-sided personal document (national ID front+back):
 * a 2-page A4 PDF when both sides are plain JPEG/PNG images (pdfkit can embed
 * those), otherwise a ZIP of the raw files so nothing is lost or re-encoded.
 *
 * Robustness: bytes labelled image/jpeg or image/png can still be corrupt —
 * pdfkit throws while embedding. Any PDF-build failure degrades to the ZIP
 * path, so the download route never 500s on a bad scan.
 */

const PDF_EMBED_MIMES = new Set(["image/jpeg", "image/png"]);

export interface DocSideBytes {
  bytes: Buffer;
  mime: string | null;
  name: string | null;
}

export interface DocBundle {
  bytes: Buffer;
  mime: string;
  fileName: string;
}

async function pdfBundle(front: DocSideBytes, back: DocSideBytes, base: string): Promise<DocBundle> {
  const { default: PDFDocument } = await import("pdfkit");
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    pdf.on("data", (d: Buffer) => chunks.push(d));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    try {
      for (const side of [front, back]) {
        pdf.addPage({ size: "A4", margin: 36 });
        pdf.image(side.bytes, 36, 36, {
          fit: [523, 770],
          align: "center",
          valign: "center",
        });
      }
      pdf.end();
    } catch (err) {
      // pdfkit throws synchronously on corrupt image bytes — surface it as a
      // rejection so the caller can fall back to the ZIP bundle.
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  return { bytes, mime: "application/pdf", fileName: `${base}.pdf` };
}

async function zipBundle(front: DocSideBytes, back: DocSideBytes, base: string): Promise<DocBundle> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const extOf = (m: string | null, fallback: string) =>
    m === "application/pdf"
      ? "pdf"
      : m === "image/png"
        ? "png"
        : m === "image/webp"
          ? "webp"
          : m === "image/jpeg"
            ? "jpg"
            : fallback;
  zip.file(front.name || `${base}-front.${extOf(front.mime, "bin")}`, front.bytes);
  zip.file(back.name || `${base}-back.${extOf(back.mime, "bin")}`, back.bytes);
  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  return { bytes, mime: "application/zip", fileName: `${base}.zip` };
}

export async function bundleDocSides(
  front: DocSideBytes,
  back: DocSideBytes,
  title: string,
): Promise<DocBundle> {
  const base = title.replace(/[^\w.\- ]+/g, "_").trim() || "document";
  if (PDF_EMBED_MIMES.has(front.mime ?? "") && PDF_EMBED_MIMES.has(back.mime ?? "")) {
    try {
      return await pdfBundle(front, back, base);
    } catch {
      // corrupt/mislabelled image — deliver the raw files instead of a 500
      return zipBundle(front, back, base);
    }
  }
  return zipBundle(front, back, base);
}
