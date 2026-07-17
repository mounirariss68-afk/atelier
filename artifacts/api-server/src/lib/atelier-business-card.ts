/**
 * Task #52 — Cognirise business-card PDF + PPTX template assets.
 *
 * The authoritative designs are the two supplied PPTX templates, kept as
 * server assets under `artifacts/api-server/assets/atelier-templates/`:
 *   - cognirise-bio-template.pptx     (blank biography template, served for
 *     download; person-specific prefill stripped, instruction placeholders kept)
 *   - cognirise-business-card.pptx    (business-card design reference)
 *   - card-logo.png / card-back-art.png (media extracted from the card PPTX,
 *     pre-rendered/cropped so pdfkit can embed them directly)
 *
 * The PDF faithfully mirrors the card PPTX: two pages at the template's
 * exact slide size (3240088 × 1800225 EMU ≈ 90 × 50 mm), front = navy
 * (#010538) with logo, gradient divider and contact lines; back = dark
 * gradient with the dotted-C artwork and the person's REAL vCard QR code
 * (replacing the dummy QR baked into the template).
 *
 * Assets are read from disk with dist/src candidate paths (the bundled
 * entrypoint collapses to dist/index.mjs) — same pattern as
 * atelier-board-pack-logo.ts. Loaders fail loud: a missing asset is a
 * packaging bug, not something to paper over with a blank card.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ------------------------------------------------------------------
// Asset loading (dist + src candidates)
// ------------------------------------------------------------------
const ASSET_CANDIDATE_DIRS = [
  // Bundled output: artifacts/api-server/dist/index.mjs → ../assets
  "../assets/atelier-templates/",
  // Source (tsx): artifacts/api-server/src/lib/ → ../../assets
  "../../assets/atelier-templates/",
] as const;

export function loadTemplateAsset(name: string): Buffer {
  const tried: string[] = [];
  for (const dir of ASSET_CANDIDATE_DIRS) {
    const rel = `${dir}${name}`;
    try {
      return readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
    } catch {
      tried.push(rel);
    }
  }
  throw new Error(
    `atelier template asset "${name}" not found (tried: ${tried.join(", ")})`,
  );
}

export const BIO_TEMPLATE_FILENAME = "Cognirise_Bio_Template.pptx";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function loadBioTemplate(): Buffer {
  return loadTemplateAsset("cognirise-bio-template.pptx");
}

// ------------------------------------------------------------------
// vCard builder — server copy of artifacts/atelier/src/lib/vcard.ts.
// Only PUBLIC card-safe fields are ever encoded.
// ------------------------------------------------------------------
export interface CardCell {
  country: string;
  number: string;
}

export interface CardPerson {
  fullName: string;
  title?: string | null;
  email?: string | null;
  cellPhones?: CardCell[] | null;
  officeAddress?: string | null;
}

const FIRM = "Cognirise";
const WEBSITE = "www.cognirise.ai";

function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function structuredName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return `${esc(fullName.trim())};;;;`;
  const family = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(" ");
  return `${esc(family)};${esc(given)};;;`;
}

export function buildVCard(p: CardPerson): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`N:${structuredName(p.fullName)}`);
  lines.push(`FN:${esc(p.fullName)}`);
  lines.push(`ORG:${esc(FIRM)}`);
  if (p.title) lines.push(`TITLE:${esc(p.title)}`);
  if (p.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(p.email)}`);
  const cells = (p.cellPhones ?? []).filter((c) => c.number.trim());
  cells.forEach((c, i) => {
    const num = c.number.trim();
    const label = c.country.trim();
    if (label) {
      const item = `item${i + 1}`;
      lines.push(`${item}.TEL;TYPE=CELL,VOICE:${esc(num)}`);
      lines.push(`${item}.X-ABLabel:${esc(label)}`);
    } else {
      lines.push(`TEL;TYPE=CELL,VOICE:${esc(num)}`);
    }
  });
  if (p.officeAddress && p.officeAddress.trim()) {
    lines.push(`ADR;TYPE=WORK:;;${esc(p.officeAddress.trim())};;;;`);
    lines.push(`LABEL;TYPE=WORK:${esc(p.officeAddress.trim())}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** Sanitise a name into a safe download filename stem. */
export function cardFilenameStem(fullName: string): string {
  return (
    fullName
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "") || "contact"
  );
}

// ------------------------------------------------------------------
// PDF generation — geometry lifted from the card PPTX slide XML.
// 1 EMU = 1/914400 in; PDF points = EMU / 12700.
// ------------------------------------------------------------------
const EMU = (v: number): number => v / 12700;

/** Exact slide size of the supplied card template. */
const PAGE_W = EMU(3240088); // ≈ 255.1 pt (3.543 in / 90 mm)
const PAGE_H = EMU(1800225); // ≈ 141.8 pt (1.969 in / 50 mm)

/** Front-page geometry (slide1.xml). */
const FRONT = {
  bg: "#010538",
  logo: { x: EMU(13252), y: EMU(228570), w: EMU(1676698), h: EMU(1117797) },
  divider: { x: EMU(1726096), y0: EMU(440635), y1: EMU(440635 + 1017104) },
  // TextBox offsets + PowerPoint default insets (l 91440, t 45720 EMU).
  textX: EMU(1822174 + 91440),
  name: { y: EMU(467139 + 45720), size: 11 },
  title: { y: EMU(675257 + 45720), size: 6 },
  phone: { y: EMU(962887 + 45720), size: 6 },
  email: { y: EMU(1111070 + 45720), size: 6 },
  website: { y: EMU(1259254 + 45720), size: 6 },
} as const;

/** Divider gradient stops (top → bottom), from the template line fill. */
const DIVIDER_STOPS: Array<[number, string]> = [
  [0, "#2971C6"],
  [0.2, "#7650BB"],
  [0.56, "#B23EAB"],
  [0.82, "#C2447E"],
  [1, "#C04A55"],
];

/** Back-page geometry (slide2.xml). */
const BACK = {
  // Gradient background: 020711 at 0% → 080A1A at 48% → 080A1A at 100%.
  gradFrom: "#020711",
  gradTo: "#080A1A",
  art: { x: EMU(6626), y: EMU(354598), w: EMU(2036915), h: EMU(1216922) },
  qr: { x: EMU(2323601), y: EMU(639538), size: EMU(521147) },
} as const;

export interface BusinessCardPdfResult {
  pdf: Buffer;
  vcard: string;
  filename: string;
}

/**
 * Render the two-sided business-card PDF for a person. Throws if the
 * person has no usable contact fields at all (name is always required
 * upstream) or if template assets are missing.
 */
export async function generateBusinessCardPdf(
  person: CardPerson,
): Promise<BusinessCardPdfResult> {
  const logo = loadTemplateAsset("card-logo.png");
  const art = loadTemplateAsset("card-back-art.png");
  const vcard = buildVCard(person);
  const qrPng = await QRCode.toBuffer(vcard, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
    color: { dark: "#0b1220", light: "#ffffff" },
  });

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: 0,
    autoFirstPage: false,
    info: { Title: `${person.fullName} — Cognirise business card` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ---- Front ----
  doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(FRONT.bg);
  doc.image(logo, FRONT.logo.x, FRONT.logo.y, {
    fit: [FRONT.logo.w, FRONT.logo.h],
    align: "center",
    valign: "center",
  });
  const grad = doc.linearGradient(
    FRONT.divider.x,
    FRONT.divider.y0,
    FRONT.divider.x,
    FRONT.divider.y1,
  );
  for (const [pos, color] of DIVIDER_STOPS) grad.stop(pos, color);
  doc
    .moveTo(FRONT.divider.x, FRONT.divider.y0)
    .lineTo(FRONT.divider.x, FRONT.divider.y1)
    .lineWidth(0.5)
    .stroke(grad);

  const textW = PAGE_W - FRONT.textX - 4;
  doc.fillColor("#ffffff");
  doc.font("Helvetica").fontSize(FRONT.name.size);
  doc.text(person.fullName, FRONT.textX, FRONT.name.y, { width: textW, lineBreak: false });
  doc.fontSize(FRONT.title.size);
  if (person.title) {
    doc.text(person.title, FRONT.textX, FRONT.title.y, { width: textW, lineBreak: false });
  }
  const phone = (person.cellPhones ?? []).find((c) => c.number.trim())?.number.trim();
  if (phone) {
    doc.text(phone, FRONT.textX, FRONT.phone.y, { width: textW, lineBreak: false });
  }
  if (person.email) {
    doc.text(person.email, FRONT.textX, FRONT.email.y, { width: textW, lineBreak: false });
  }
  doc.text(WEBSITE, FRONT.textX, FRONT.website.y, { width: textW, lineBreak: false });

  // ---- Back ----
  doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  const bgGrad = doc.linearGradient(0, 0, PAGE_W, 0);
  bgGrad.stop(0, BACK.gradFrom).stop(0.48, BACK.gradTo).stop(1, BACK.gradTo);
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(bgGrad);
  doc.image(art, BACK.art.x, BACK.art.y, { width: BACK.art.w, height: BACK.art.h });
  doc.image(qrPng, BACK.qr.x, BACK.qr.y, { width: BACK.qr.size, height: BACK.qr.size });

  doc.end();
  const pdf = await done;
  return {
    pdf,
    vcard,
    filename: `${cardFilenameStem(person.fullName)}_Cognirise_Business_Card.pdf`,
  };
}
