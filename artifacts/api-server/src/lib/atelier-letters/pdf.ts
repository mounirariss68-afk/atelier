/**
 * Task #845 — Cognirise letterhead PDF generator for employment/salary
 * letters. pdfkit, A4. Branding follows the server-side Cognirise
 * document surfaces (navy wordmark on a light page — see the board-pack
 * precedent; the contract DOCX templates carry the same navy-on-white
 * letterhead: logo top, entity block, rule, footer strip).
 *
 * Language handling:
 *  - EN/TR: Plus Jakarta Sans (full Latin-Extended, Turkish-safe).
 *  - AR: Noto Naskh Arabic. fontkit shapes Arabic correctly, but pdfkit
 *    lays RTL runs out with `features: ["rtla"]`, which reverses the
 *    whole logical string — so embedded LTR runs (digits, Latin names,
 *    emails) must be pre-reversed (`fixRtlRuns`) to survive the flip.
 */

import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCardFont } from "../atelier-business-card.js";
import type { LetterContent } from "./templates.js";

// ------------------------------------------------------------------
// Assets
// ------------------------------------------------------------------

const FONT_CANDIDATE_DIRS = ["../fonts/", "../../fonts/", "../../../fonts/"] as const;

let arabicFontCache: Buffer | null = null;
export function loadArabicFont(): Buffer {
  if (arabicFontCache) return arabicFontCache;
  const tried: string[] = [];
  for (const dir of FONT_CANDIDATE_DIRS) {
    const rel = `${dir}NotoNaskhArabic-Regular.ttf`;
    try {
      arabicFontCache = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
      return arabicFontCache;
    } catch {
      tried.push(rel);
    }
  }
  throw new Error(
    `NotoNaskhArabic-Regular.ttf not found (tried: ${tried.join(", ")}) — refusing to render Arabic letters with a Latin-only font`,
  );
}

const LOGO_CANDIDATES = [
  "../../atelier/public/cognirise-logo-light.png",
  "../../../atelier/public/cognirise-logo-light.png",
  "../../../../artifacts/atelier/public/cognirise-logo-light.png",
] as const;

let logoCache: Buffer | null | undefined;
export function loadLetterLogo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  for (const rel of LOGO_CANDIDATES) {
    try {
      logoCache = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
      return logoCache;
    } catch {
      // try next
    }
  }
  logoCache = null;
  return logoCache;
}

// ------------------------------------------------------------------
// RTL helpers
// ------------------------------------------------------------------

/**
 * Pre-reverse embedded LTR runs (digits, Latin words, emails, numbers
 * with grouping separators) inside a logical-order Arabic string so
 * pdfkit's whole-string RTL flip renders them left-to-right again.
 */
export function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
}

export function fixRtlRuns(text: string): string {
  // Strings with no Arabic at all are laid out LTR even under `rtla` —
  // leave them untouched or they'd render mirrored.
  if (!hasArabic(text)) return text;
  const L = "0-9A-Za-z\\u00C0-\\u024F"; // ASCII + Latin-1/Extended (Turkish etc.)
  return text.replace(
    new RegExp(`[${L}][${L} @._,\\-\\/:()]*[${L})]|[${L}]`, "g"),
    (run) => [...run].reverse().join(""),
  );
}

const NAVY = "#0A2540";
const INK = "#1c2b3a";
const MUTED = "#5b6b7c";
const RULE = "#c9d4de";

export interface LetterPdfArgs {
  content: LetterContent;
  language: "en" | "ar" | "tr";
  refNumber: string;
  issueDateText: string;
  entityName: string;
  entityAddress: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  /** Transparent PNGs; null → wet-signature blank block. */
  signaturePng: Buffer | null;
  stampPng: Buffer | null;
  /** false → wet signature: printed name/title + blank space, no images. */
  embedSignature: boolean;
}

export async function generateLetterPdf(args: LetterPdfArgs): Promise<Buffer> {
  const { content } = args;
  const isAr = args.language === "ar";
  // Bottom margin is deliberately tiny: the footer is absolutely
  // positioned near the page edge and a taller margin makes pdfkit
  // paginate it onto a phantom second page (Arabic line metrics are
  // taller than Latin ones and tripped this).
  const doc = new PDFDocument({ size: "A4", margins: { top: 46, bottom: 18, left: 56, right: 56 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.registerFont("Body", loadCardFont());
  const latinBoldPath = (() => {
    for (const dir of FONT_CANDIDATE_DIRS) {
      try {
        return readFileSync(fileURLToPath(new URL(`${dir}PlusJakartaSans-Bold.ttf`, import.meta.url)));
      } catch {
        // next
      }
    }
    return null;
  })();
  if (latinBoldPath) doc.registerFont("BodyBold", latinBoldPath);
  const arabic = isAr ? loadArabicFont() : null;
  if (arabic) doc.registerFont("Arabic", arabic);

  const pageW = doc.page.width;
  const left = doc.page.margins.left;
  const right = pageW - doc.page.margins.right;
  const contentW = right - left;

  // Text helpers -----------------------------------------------------
  const bodyFont = isAr ? "Arabic" : "Body";
  const boldFont = isAr ? "Arabic" : latinBoldPath ? "BodyBold" : "Body";
  const t = (s: string) => (isAr ? fixRtlRuns(s) : s);
  /**
   * Per-string layout options: Arabic-free lines in an Arabic letter
   * (Latin names, banks, emails) must render LTR with the Latin font —
   * `rtla` would mirror them and Naskh lacks full Latin coverage.
   */
  type Feat = PDFKit.Mixins.TextOptions["features"];
  const RTLA = ["rtla"] as unknown as Feat;
  const optsFor = (s: string): { font: string; features?: Feat } =>
    isAr && hasArabic(s) ? { font: "Arabic", features: RTLA } : { font: isAr ? "Body" : bodyFont };
  const para = (s: string, opts: PDFKit.Mixins.TextOptions = {}) => {
    const o = optsFor(s);
    const size = (doc as unknown as { _fontSize: number })._fontSize;
    doc.font(o.font).fontSize(size);
    doc.text(t(s), left, doc.y, {
      width: contentW,
      align: isAr ? "right" : "left",
      lineGap: 3,
      ...(o.features ? { features: o.features } : {}),
      ...opts,
    });
  };

  // Letterhead header -------------------------------------------------
  const logo = loadLetterLogo();
  if (logo) {
    doc.image(logo, left, 40, { fit: [150, 42] });
  } else {
    doc.font("Body").fontSize(20).fillColor(NAVY).text("Cognirise", left, 44);
  }
  doc.font("Body").fontSize(8.2).fillColor(MUTED);
  const headerBlock = `${args.entityName}\n${args.entityAddress}`;
  doc.text(headerBlock, left + 220, 42, { width: contentW - 220, align: "right" });
  doc.moveTo(left, 96).lineTo(right, 96).lineWidth(1).strokeColor(NAVY).stroke();
  doc.y = 112;

  // Ref / date strip ---------------------------------------------------
  doc.font("Body").fontSize(9).fillColor(MUTED);
  const refText = `${content.refLabel}: ${args.refNumber}`;
  const dateText = `${content.dateLabel}: ${args.issueDateText}`;
  if (isAr) {
    for (const s of [refText, dateText]) {
      const o = optsFor(s);
      doc.font(o.font);
      doc.text(t(s), left, doc.y, {
        width: contentW,
        align: "right",
        ...(o.features ? { features: o.features } : {}),
      });
    }
  } else {
    doc.text(refText, left, doc.y, { width: contentW / 2 });
    doc.moveUp();
    doc.text(dateText, left + contentW / 2, doc.y, { width: contentW / 2, align: "right" });
  }
  doc.moveDown(1.2);

  // Title ---------------------------------------------------------------
  const titleOpts = optsFor(content.title);
  doc.font(isAr && !titleOpts.features ? boldFont : isAr ? "Arabic" : boldFont).fontSize(14.5).fillColor(NAVY);
  doc.text(t(content.title), left, doc.y, {
    width: contentW,
    align: "center",
    ...(titleOpts.features ? { features: titleOpts.features } : {}),
  });
  doc.moveDown(1.1);

  // Addressee + salutation ----------------------------------------------
  doc.font(bodyFont).fontSize(10.5).fillColor(INK);
  for (const line of content.addresseeLines) para(line);
  doc.moveDown(0.8);
  para(content.salutation);
  doc.moveDown(0.6);

  // Body paragraphs -------------------------------------------------------
  for (const p of content.paragraphs) {
    para(p);
    doc.moveDown(0.65);
  }

  // Closing + signature block ---------------------------------------------
  doc.moveDown(0.4);
  para(content.closing);
  const sigTop = doc.y + 8;
  const sigX = isAr ? right - 220 : left;
  if (args.embedSignature && args.signaturePng) {
    doc.image(args.signaturePng, sigX, sigTop, { fit: [130, 62] });
  }
  if (args.embedSignature && args.stampPng) {
    // Stamp overlaps the signature slightly, like a real wet stamp.
    doc.image(args.stampPng, sigX + 96, sigTop - 4, { fit: [86, 86] });
  }
  const nameY = sigTop + (args.embedSignature ? 72 : 58);
  if (!args.embedSignature) {
    // Wet signature: blank block with a rule to sign on.
    doc.moveTo(sigX, nameY - 8).lineTo(sigX + 200, nameY - 8).lineWidth(0.8).strokeColor(INK).stroke();
    const so = optsFor(content.signatureLabel);
    doc.font(so.font).fontSize(8.5).fillColor(MUTED);
    doc.text(t(content.signatureLabel), sigX, nameY - 26, {
      width: 220,
      align: isAr ? "right" : "left",
      ...(so.features ? { features: so.features } : {}),
    });
  }
  const sigLine = (s: string, font: string, size: number, y?: number) => {
    const o = optsFor(s);
    doc.font(o.features ? o.font : font).fontSize(size);
    doc.text(t(s), sigX, y ?? doc.y, {
      width: 260,
      align: isAr ? "right" : "left",
      ...(o.features ? { features: o.features } : {}),
    });
  };
  doc.fillColor(INK);
  if (args.signatoryName) sigLine(args.signatoryName, isAr ? "Body" : boldFont, 10.5, nameY);
  doc.fillColor(MUTED);
  if (args.signatoryTitle) sigLine(args.signatoryTitle, isAr ? "Body" : bodyFont, 9.5);
  sigLine(args.entityName, isAr ? "Body" : bodyFont, 9.5);

  // Footer: verification line + rule ---------------------------------------
  const footY = doc.page.height - 78;
  doc.moveTo(left, footY).lineTo(right, footY).lineWidth(0.7).strokeColor(RULE).stroke();
  const vo = optsFor(content.verificationLine);
  doc.font(vo.font).fontSize(7.8).fillColor(MUTED);
  doc.text(t(content.verificationLine), left, footY + 8, {
    width: contentW,
    align: isAr ? "right" : "center",
    ...(vo.features ? { features: vo.features } : {}),
  });

  doc.end();
  return done;
}
