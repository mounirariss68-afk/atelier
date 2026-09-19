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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  buildContactVCard,
  canonicalPhoneValue,
  type ContactCardInput,
  type ContactCardPhone,
} from "@workspace/contact-card";

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

/**
 * Task #696 — Unicode text font for the card.
 *
 * pdfkit's built-in Helvetica is WinAnsi-only: Turkish letters outside
 * Latin-1 (ş, ğ, İ, ı…) get substituted with wrong glyphs ("Yiş" printed
 * as "Yi ð"). Embed the bundled Inter TTFs (Task #1280 brand body face,
 * full Latin-Extended coverage) instead. Fail loud if
 * the fonts directory is missing — silently falling back to Helvetica
 * would reintroduce the corruption.
 */
const FONT_CANDIDATE_DIRS = [
  // Bundled output: artifacts/api-server/dist/index.mjs → ../fonts
  "../fonts/",
  // Source (tsx): artifacts/api-server/src/lib/ → ../../fonts
  "../../fonts/",
] as const;

let cardFontCache: Buffer | null = null;

export function loadCardFont(): Buffer {
  if (cardFontCache) return cardFontCache;
  const tried: string[] = [];
  for (const dir of FONT_CANDIDATE_DIRS) {
    try {
      const dirPath = fileURLToPath(new URL(dir, import.meta.url));
      // Sanity-guard: only accept a dir that actually holds the TTF.
      if (!readdirSync(dirPath).includes("Inter-Regular.ttf")) {
        tried.push(dir);
        continue;
      }
      cardFontCache = readFileSync(`${dirPath}/Inter-Regular.ttf`);
      return cardFontCache;
    } catch {
      tried.push(dir);
    }
  }
  throw new Error(
    `business-card font Inter-Regular.ttf not found (tried: ${tried.join(", ")}) — refusing to fall back to WinAnsi Helvetica (would corrupt non-Latin-1 glyphs)`,
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
export type CardCell = ContactCardPhone;

export interface CardPerson extends Omit<ContactCardInput, "org"> {}

const FIRM = "Cognirise";
const WEBSITE = "www.cognirise.ai";

export const telValue = canonicalPhoneValue;
export function buildVCard(p: CardPerson): string {
  return buildContactVCard({ ...p, org: FIRM });
}

// ------------------------------------------------------------------
// Phone display formatting — every stored cell renders on its own line,
// grouped per the number's national dialing convention (libphonenumber).
// ------------------------------------------------------------------

/** Country-label → ISO-3166 alpha-2, for cells stored with a name label
 *  instead of a dial code (matches the labels dialCodeCountry() emits). */
const COUNTRY_LABEL_TO_ISO: Record<string, CountryCode> = {
  uae: "AE",
  "united arab emirates": "AE",
  ksa: "SA",
  "saudi arabia": "SA",
  qatar: "QA",
  kuwait: "KW",
  bahrain: "BH",
  oman: "OM",
  egypt: "EG",
  lebanon: "LB",
  jordan: "JO",
  turkey: "TR",
  "türkiye": "TR",
  uk: "GB",
  "united kingdom": "GB",
  france: "FR",
  germany: "DE",
  india: "IN",
  pakistan: "PK",
  usa: "US",
  "united states": "US",
};

/**
 * Format one stored cell for display. Cells are stored as
 * `{ country, number }` where `country` is usually a dial code ("+971")
 * and `number` the local part ("506504416"), but tolerate full E.164
 * numbers and country-name labels. Falls back to a raw international
 * join when the number can't be parsed.
 */
export function formatCardPhone(cell: CardCell): string {
  const rawNumber = cell.number.trim();
  const rawCountry = cell.country.trim();
  if (!rawNumber) return "";

  const candidates: Array<{ text: string; iso?: CountryCode }> = [];
  if (rawNumber.startsWith("+")) {
    candidates.push({ text: rawNumber });
  }
  if (rawCountry.startsWith("+")) {
    candidates.push({ text: `${rawCountry}${rawNumber.replace(/^0+/, "")}` });
  }
  const iso = COUNTRY_LABEL_TO_ISO[rawCountry.toLowerCase()];
  if (iso) {
    candidates.push({ text: rawNumber, iso });
  }
  candidates.push({ text: rawNumber });

  for (const c of candidates) {
    const parsed = parsePhoneNumberFromString(c.text, c.iso);
    if (parsed && parsed.isPossible()) return parsed.formatInternational();
  }
  // Unparseable: fall back to a readable international-style join.
  if (rawCountry.startsWith("+") && !rawNumber.startsWith("+")) {
    return `${rawCountry} ${rawNumber}`;
  }
  return rawNumber;
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
  // Template navy was #010538; lightened slightly on request (2026-07-27).
  bg: "#0A1050",
  logo: { x: EMU(13252), y: EMU(228570), w: EMU(1676698), h: EMU(1117797) },
  divider: { x: EMU(1726096), y0: EMU(440635), y1: EMU(440635 + 1017104) },
  // TextBox offsets + PowerPoint default insets (l 91440, t 45720 EMU).
  textX: EMU(1822174 + 91440),
  // Template size was 11 with Helvetica; the embedded brand face runs
  // wider, so 10 restores the original visual weight (user request
  // 2026-07-28; auto-fit below shrinks further when needed).
  name: { y: EMU(467139 + 45720), size: 10 },
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

/** Back-page geometry (slide2.xml of the new card PPTX). */
const BACK = {
  // Gradient background: 020711 at 0% → 080A1A at 48% → 080A1A at 100%.
  gradFrom: "#020711",
  gradTo: "#080A1A",
  art: { x: EMU(0), y: EMU(351999), w: EMU(2187078), h: EMU(1229577) },
  // QR + frame enlarged ~20% vs the template (user request 2026-07-27),
  // scaled about the original frame center (EMU 2589212, 903288) so the
  // composition is unchanged. Template values: qr 521147 @ (2328639,642714);
  // frame 593725 @ (2292350,606425).
  qr: { x: EMU(2276524), y: EMU(590599), size: EMU(625376) },
  // Rounded-rect QR frame with the brand gradient stroke (roundRect,
  // adj 8111 → corner radius = 8.111% of the side; ln w 6350 EMU = 0.5 pt).
  qrFrame: {
    x: EMU(2232977),
    y: EMU(547053),
    size: EMU(712470),
    radiusFrac: 0.08111,
    lineWidth: EMU(6350),
  },
} as const;

/** QR-frame gradient stops (top → bottom), from the roundRect line fill. */
const QR_FRAME_STOPS: Array<[number, string]> = [
  [0, "#2971C6"],
  [0.2, "#7650BB"],
  [0.43, "#B23EAB"],
  [0.62, "#C2447E"],
  [0.81, "#C1466E"],
  [1, "#C04A55"],
];

export interface BusinessCardPdfResult {
  pdf: Buffer;
  vcard: string;
  filename: string;
}

/**
 * Task #352 — output variants.
 *   standard: exactly 90×50 mm, no bleed or marks (screen / office print).
 *   print:    professional print shop output — the same trim layout with
 *             3 mm bleed on all sides (backgrounds + the left-edge-touching
 *             back artwork extended into the bleed via a pre-baked mirrored
 *             strip) plus a 3 mm slug margin carrying corner crop marks that
 *             mark the 90×50 mm trim. TrimBox/BleedBox metadata is set on
 *             both pages.
 *
 * Task #389 — color handling: BOTH variants are deliberately untagged
 * DeviceRGB, exactly like the user's original card PDF. A previous task
 * embedded an sRGB ICC OutputIntent on the print variant; the raw pixels
 * were identical, but color-managed viewers on wide-gamut displays render
 * tagged sRGB navy visibly duller than untagged device RGB, which the user
 * perceived as a changed background color. Do NOT reintroduce an
 * OutputIntent (or any ICC tagging) without verifying on-screen appearance
 * side-by-side against the original PDF in a color-managed viewer.
 */
export type CardVariant = "standard" | "print";

const MM = (v: number): number => (v / 25.4) * 72;
const BLEED = MM(3);
const SLUG = MM(3); // white margin beyond the bleed that carries crop marks
const PRINT_OFF = BLEED + SLUG; // trim origin offset on print pages

/** Draw the 8 corner crop marks (in trim coordinates: trim = 0..w/0..h).
 *  Marks live entirely in the slug area — from the bleed edge outward — so
 *  they never touch bleed artwork. */
function drawCropMarks(doc: PDFKit.PDFDocument, w: number, h: number): void {
  doc.save();
  doc.lineWidth(0.3).strokeColor("#000000");
  for (const x of [0, w]) {
    doc.moveTo(x, -BLEED - SLUG).lineTo(x, -BLEED).stroke();
    doc.moveTo(x, h + BLEED).lineTo(x, h + BLEED + SLUG).stroke();
  }
  for (const y of [0, h]) {
    doc.moveTo(-BLEED - SLUG, y).lineTo(-BLEED, y).stroke();
    doc.moveTo(w + BLEED, y).lineTo(w + BLEED + SLUG, y).stroke();
  }
  doc.restore();
}

/** Add a page for the given variant, set its Trim/Bleed boxes, draw crop
 *  marks (print only) and translate so 0,0 = trim top-left. Content code
 *  below always draws in trim coordinates. */
function beginCardPage(doc: PDFKit.PDFDocument, variant: CardVariant): void {
  if (variant === "standard") {
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
    return;
  }
  const pw = PAGE_W + 2 * PRINT_OFF;
  const ph = PAGE_H + 2 * PRINT_OFF;
  doc.addPage({ size: [pw, ph], margin: 0 });
  // PDF box metadata (PDF user space, symmetric so no y-flip concerns).
  const dict = (doc.page as unknown as {
    dictionary: { data: Record<string, unknown> };
  }).dictionary;
  dict.data.TrimBox = [PRINT_OFF, PRINT_OFF, pw - PRINT_OFF, ph - PRINT_OFF];
  dict.data.BleedBox = [SLUG, SLUG, pw - SLUG, ph - SLUG];
  doc.translate(PRINT_OFF, PRINT_OFF);
  drawCropMarks(doc, PAGE_W, PAGE_H);
}

/** Fill the page background: exactly the trim on standard pages, trim +
 *  bleed on print pages (the slug stays white for the crop marks). Gradient
 *  fills stay anchored to trim coordinates — pdfkit shadings extend their
 *  end colors, so the trimmed area is pixel-identical across variants. */
function bgRect(
  doc: PDFKit.PDFDocument,
  variant: CardVariant,
): PDFKit.PDFDocument {
  return variant === "standard"
    ? doc.rect(0, 0, PAGE_W, PAGE_H)
    : doc.rect(-BLEED, -BLEED, PAGE_W + 2 * BLEED, PAGE_H + 2 * BLEED);
}

/**
 * Render the two-sided business-card PDF for a person. Throws if the
 * person has no usable contact fields at all (name is always required
 * upstream) or if template assets are missing.
 */
export async function generateBusinessCardPdf(
  person: CardPerson,
  variant: CardVariant = "standard",
): Promise<BusinessCardPdfResult> {
  const logo = loadTemplateAsset("card-front-logo.png");
  // Print pages use the bleed-extended artwork (mirrored 3 mm strip baked
  // onto the left, the only trim-touching edge).
  const art = loadTemplateAsset(
    variant === "print" ? "card-back-art-bleed.png" : "card-back-art-hires.png",
  );
  const vcard = buildVCard(person);
  const qrPng = await QRCode.toBuffer(vcard, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1280,
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
  beginCardPage(doc, variant);
  bgRect(doc, variant).fill(FRONT.bg);
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

  // Right padding mirrors the left inset between divider and text (~8.5 pt)
  // so the name never crowds the trim edge.
  const RIGHT_PAD = 9;
  const textW = PAGE_W - FRONT.textX - RIGHT_PAD;
  doc.fillColor("#ffffff");
  doc.registerFont("CardText", loadCardFont());
  // Auto-fit the name: start at the template size and shrink until the full
  // name fits the text column (lineBreak is off, so overflow would otherwise
  // clip at the card edge). Floor keeps degenerate inputs legible.
  let nameSize = FRONT.name.size;
  doc.font("CardText").fontSize(nameSize);
  const NAME_MIN_SIZE = 7;
  while (nameSize > NAME_MIN_SIZE && doc.widthOfString(person.fullName) > textW) {
    nameSize -= 0.25;
    doc.fontSize(nameSize);
  }
  doc.text(person.fullName, FRONT.textX, FRONT.name.y, { width: textW, lineBreak: false });
  doc.fontSize(FRONT.title.size);
  if (person.title) {
    doc.text(person.title, FRONT.textX, FRONT.title.y, { width: textW, lineBreak: false });
  }
  // Every stored cell renders on its own line (PPTX stacks them inside one
  // textbox starting at the phone offset). With 3+ numbers, tighten the
  // leading and shift the block up slightly so it never collides with the
  // email line below.
  const phones = (person.cellPhones ?? [])
    .map((c) => formatCardPhone(c))
    .filter((p) => p.length > 0);
  if (phones.length > 0) {
    // A single number sits at the template's phone offset; 2+ anchor upward
    // from the email line (tighter leading at 3+) so the last phone always
    // clears the email and a single number leaves no odd gap.
    const lineH = phones.length > 2 ? 7 : 7.6;
    const startY =
      phones.length > 1
        ? FRONT.email.y - phones.length * lineH
        : FRONT.phone.y;
    phones.forEach((p, i) => {
      doc.text(p, FRONT.textX, startY + i * lineH, {
        width: textW,
        lineBreak: false,
      });
    });
  }
  if (person.email) {
    doc.text(person.email, FRONT.textX, FRONT.email.y, { width: textW, lineBreak: false });
  }
  doc.text(WEBSITE, FRONT.textX, FRONT.website.y, { width: textW, lineBreak: false });

  // ---- Back ----
  beginCardPage(doc, variant);
  const bgGrad = doc.linearGradient(0, 0, PAGE_W, 0);
  bgGrad.stop(0, BACK.gradFrom).stop(0.48, BACK.gradTo).stop(1, BACK.gradTo);
  bgRect(doc, variant).fill(bgGrad);
  if (variant === "print") {
    // Bleed-extended artwork: mirrored 3 mm strip runs into the left bleed;
    // the trim-visible portion is pixel-identical to the standard variant.
    doc.image(art, BACK.art.x - BLEED, BACK.art.y, {
      width: BACK.art.w + BLEED,
      height: BACK.art.h,
    });
  } else {
    doc.image(art, BACK.art.x, BACK.art.y, { width: BACK.art.w, height: BACK.art.h });
  }
  doc.image(qrPng, BACK.qr.x, BACK.qr.y, { width: BACK.qr.size, height: BACK.qr.size });
  const frame = BACK.qrFrame;
  const frameGrad = doc.linearGradient(
    frame.x,
    frame.y,
    frame.x,
    frame.y + frame.size,
  );
  for (const [pos, color] of QR_FRAME_STOPS) frameGrad.stop(pos, color);
  doc
    .roundedRect(frame.x, frame.y, frame.size, frame.size, frame.size * frame.radiusFrac)
    .lineWidth(frame.lineWidth)
    .stroke(frameGrad);

  doc.end();
  const pdf = await done;
  const suffix = variant === "print" ? "_Print" : "";
  return {
    pdf,
    vcard,
    filename: `${cardFilenameStem(person.fullName)}_Cognirise_Business_Card${suffix}.pdf`,
  };
}
