/**
 * Task #396 — PDF invoice/receipt text extraction (ported from the kit's
 * pdfTextExtractor.ts + ocrEngine.ts).
 *
 * 1. Try the PDF's embedded text layer via pdfjs-dist.
 * 2. Assess text quality (length, garble ratio, presence of dates/amounts).
 * 3. If unusable (scanned/image-only PDF), render pages with `pdftoppm`
 *    (poppler) and OCR them with `tesseract` (eng+ara+tur).
 *
 * The caller falls back to vision extraction on a rendered page image when
 * OCR also fails the quality gate.
 */

import { execFile } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_DPI = 300;
export const OCR_LANGUAGES = ["eng", "ara", "tur"];
const MAX_PAGES = 5;

export interface PdfTextResult {
  text: string;
  method: "text_layer" | "ocr";
  pageCount: number;
  quality: OcrQualityAssessment;
}

export interface OcrQualityAssessment {
  isUsable: boolean;
  dateCount: number;
  amountCount: number;
  garbleRatio: number;
  charCount: number;
}

const DATE_PATTERNS = [
  /\d{1,2}(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{4}/gi,
  /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/g,
  /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi,
];

const AMOUNT_PATTERN = /\d{1,3}(?:,\d{3})*\.\d{2}\b/g;

const GARBLE_PATTERN = /[^\x20-\x7E\xA0-\xFF\n\r\t]/;

export function assessTextQuality(text: string): OcrQualityAssessment {
  const charCount = text.length;
  let dateCount = 0;
  for (const pattern of DATE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) dateCount += matches.length;
  }
  const amountMatches = text.match(AMOUNT_PATTERN);
  const amountCount = amountMatches ? amountMatches.length : 0;
  // Arabic/Turkish text trips the raw garble pattern; strip letters first.
  const stripped = text.replace(/[\u0600-\u06FF\u011E\u011F\u0130\u0131\u015E\u015F\u00C0-\u024F]/g, "a");
  const garbleMatches = stripped.match(new RegExp(GARBLE_PATTERN, "g"));
  const garbleCount = garbleMatches ? garbleMatches.length : 0;
  const garbleRatio = charCount > 0 ? garbleCount / charCount : 1;
  const isUsable =
    charCount > 100 && garbleRatio < 0.15 && (dateCount >= 1 || amountCount >= 2);
  return { isUsable, dateCount, amountCount, garbleRatio, charCount };
}

async function extractTextLayer(
  pdfData: Uint8Array,
): Promise<{ text: string; pageCount: number }> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(pageCount, MAX_PAGES); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) =>
        typeof (item as { str?: unknown }).str === "string"
          ? (item as { str: string }).str
          : "",
      )
      .join(" ");
    pages.push(pageText);
  }
  await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return { text: pages.join("\n\n"), pageCount };
}

/** Render one PDF page to a PNG buffer via pdftoppm. */
async function renderPdfPageImage(
  pdfData: Uint8Array,
  pageNumber: number,
  dpi: number = DEFAULT_DPI,
): Promise<Buffer> {
  const tempId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = join(tmpdir(), `${tempId}.pdf`);
  const outPrefix = join(tmpdir(), `${tempId}_out`);
  const outFile = `${outPrefix}.png`;
  try {
    writeFileSync(pdfPath, pdfData);
    await execFileAsync(
      "pdftoppm",
      ["-png", "-r", String(dpi), "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", pdfPath, outPrefix],
      { timeout: 30000 },
    );
    if (!existsSync(outFile)) {
      throw new Error(`pdftoppm produced no output for page ${pageNumber}`);
    }
    return readFileSync(outFile);
  } finally {
    try { unlinkSync(pdfPath); } catch { /* ignore */ }
    try { unlinkSync(outFile); } catch { /* ignore */ }
  }
}

async function ocrImage(
  imageBuffer: Buffer,
  languages: string[],
): Promise<string> {
  const tempId = `ocr_img_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const imgPath = join(tmpdir(), `${tempId}.png`);
  try {
    writeFileSync(imgPath, imageBuffer);
    const { stdout } = await execFileAsync(
      "tesseract",
      [imgPath, "stdout", "-l", languages.join("+"), "--psm", "6"],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout || "";
  } finally {
    try { unlinkSync(imgPath); } catch { /* ignore */ }
  }
}

async function ocrPdfPages(
  pdfData: Uint8Array,
  pageNumbers: number[],
  languages: string[],
): Promise<string> {
  const texts: string[] = [];
  for (const pageNum of pageNumbers) {
    try {
      const img = await renderPdfPageImage(pdfData, pageNum);
      const text = await ocrImage(img, languages);
      console.log(`[OCR] Page ${pageNum}: ${text.length} chars`);
      texts.push(text);
    } catch (err) {
      console.error(`[OCR] Failed page ${pageNum}:`, (err as Error).message);
      texts.push("");
    }
  }
  return texts.join("\n\n");
}

/**
 * Extract text from a PDF: text layer first, OCR fallback.
 * `quality` reflects the RETURNED text; when method==="ocr" and quality is
 * still unusable, the caller should escalate to vision on a page image.
 */
export async function extractPdfText(
  pdfData: Uint8Array,
  options: { ocrLanguages?: string[] } = {},
): Promise<PdfTextResult> {
  let textLayer = "";
  let pageCount = 1;
  try {
    const result = await extractTextLayer(pdfData);
    textLayer = result.text;
    pageCount = result.pageCount;
  } catch (error) {
    console.warn(
      `[PdfTextExtractor] Text-layer extraction failed: ${(error as Error).message}`,
    );
  }

  const layerQuality = assessTextQuality(textLayer);
  if (layerQuality.isUsable) {
    return { text: textLayer, method: "text_layer", pageCount, quality: layerQuality };
  }

  console.log(
    `[PdfTextExtractor] Text layer unusable (chars=${layerQuality.charCount}, garble=${layerQuality.garbleRatio.toFixed(2)}) — OCR fallback`,
  );
  const pagesToOcr = Array.from(
    { length: Math.min(pageCount, MAX_PAGES) },
    (_, i) => i + 1,
  );
  const ocrText = await ocrPdfPages(
    pdfData,
    pagesToOcr,
    options.ocrLanguages || OCR_LANGUAGES,
  );
  return {
    text: ocrText,
    method: "ocr",
    pageCount,
    quality: assessTextQuality(ocrText),
  };
}
