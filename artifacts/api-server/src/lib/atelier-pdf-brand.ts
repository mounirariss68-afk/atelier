/**
 * Task #1007 — Cognirise PDF brand kit.
 *
 * Shared styling module for every server-generated pdfkit document
 * (research briefs, POV, account plan/QBR, board pack, report exports,
 * invoices, expense exports, audit packs, proposal docs).
 *
 * Print translation of Atelier's glassmorphism UI:
 *   - navy cover with a soft "glass" card (white wash + hairline stroke)
 *   - light ice gradient backdrop wash on content pages
 *   - rounded translucent-looking glass panels for content sections
 *     (light tints + rounded corners — NO raster blur, text stays
 *     vector-crisp, selectable and printable, readable in B&W)
 *   - gold accent details, Cognirise wordmark on every page
 *   - Plus Jakarta Sans throughout (full Latin-Extended, Turkish-safe)
 *
 * The section/panel layout is measurement-first: content is described as
 * simple blocks, measured with the target font, sliced across pages, and
 * each slice's panel rectangle is painted BEFORE its text (PDF content
 * streams are strictly painter's-order — there is no z-index).
 *
 * All docs from this kit are created with autoFirstPage:false and
 * bufferPages:true so the footer pass can stamp page numbers.
 */
import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBoardPackLogo } from "./atelier-board-pack-logo.js";

// ── Palette ───────────────────────────────────────────────────────────────────
// Mirrors the Atelier web tokens (src/index.css). Like the web app, the
// `gold*` names are retained for stability but resolve to the Cognirise
// magenta accent (light-theme values — PDFs are light surfaces). Never
// use amber/golden hues: they are not Cognirise colors.
export const BRAND = {
  navy: "#0E1F3D",
  navyDeep: "#0A1730",
  gold: "#A6348F", // Cognirise magenta (AA on light surfaces)
  goldSoft: "#C45BB8", // brighter magenta — accents on dark/navy surfaces
  coral: "#FF7B5A",
  purple: "#8A5BD6",
  blue: "#5B7CFF",
  ink: "#1F2A3D",
  muted: "#5B6B7C",
  faint: "#8A97A8",
  panelStroke: "#D9E2EE",
  hairline: "#E4E9F2",
  zebra: "#F1F5FA",
  danger: "#B91C1C",
  white: "#FFFFFF",
} as const;

/** Cognirise signature gradient stops (blue→purple→magenta→coral). */
const COG_GRAD: ReadonlyArray<readonly [number, string]> = [
  [0, BRAND.blue],
  [0.35, BRAND.purple],
  [0.65, BRAND.goldSoft],
  [1, BRAND.coral],
];

function cogGradRule(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
  const grad = doc.linearGradient(x, y, x + w, y);
  for (const [stop, color] of COG_GRAD) grad.stop(stop, color);
  doc.rect(x, y, w, h).fill(grad);
}

// ── Backdrop artwork ─────────────────────────────────────────────────────────
// Approved Cognirise backdrop art (portrait JPEG crops of the web app's
// light-bg-wave / dark-bg backdrops, pre-rendered into assets/). Null when
// unresolvable — pages fall back to the vector gradient wash.
// Returns a stable file-path STRING (not a Buffer): pdfkit keys its image
// registry on string sources, so the same path is embedded as ONE image
// XObject reused across every page instead of re-embedded per page.
// "./assets/" first — that's the dist layout (build.mjs copies the JPEGs
// next to the bundle); the deeper candidates cover the source tree in dev.
const BG_CANDIDATE_DIRS = ["./assets/", "../assets/", "../../assets/", "../../../assets/"] as const;
const bgPathCache = new Map<string, string | null>();
function loadBgAsset(file: string): string | null {
  const hit = bgPathCache.get(file);
  if (hit !== undefined) return hit;
  let found: string | null = null;
  for (const dir of BG_CANDIDATE_DIRS) {
    try {
      const p = fileURLToPath(new URL(`${dir}${file}`, import.meta.url));
      readFileSync(p); // existence + readability check
      found = p;
      break;
    } catch {
      // try next candidate
    }
  }
  bgPathCache.set(file, found);
  return found;
}

// ── Geometry ──────────────────────────────────────────────────────────────────
export const PAGE = {
  margin: 56,
  left: 56,
  right: 539, // A4 595.28 - 56
  contentW: 483,
  /** first usable y on a content page (below the chrome header) */
  contentTop: 72,
  /** last usable y before the footer zone */
  bottom: 780,
} as const;

const PANEL_PAD = 14;
const PANEL_RADIUS = 12;
const PANEL_GAP = 14;

// ── Fonts ─────────────────────────────────────────────────────────────────────
export const FONT = {
  regular: "Brand",
  medium: "Brand-Medium",
  semibold: "Brand-SemiBold",
  bold: "Brand-Bold",
  italic: "Brand-Italic",
} as const;

const FONT_FILES: Record<string, string> = {
  [FONT.regular]: "PlusJakartaSans-Regular.ttf",
  [FONT.medium]: "PlusJakartaSans-Medium.ttf",
  [FONT.semibold]: "PlusJakartaSans-SemiBold.ttf",
  [FONT.bold]: "PlusJakartaSans-Bold.ttf",
  [FONT.italic]: "PlusJakartaSans-Italic.ttf",
};

// dist/index.mjs → ../fonts ; src/lib → ../../fonts (same pattern as the
// letters/business-card loaders).
const FONT_CANDIDATE_DIRS = ["../fonts/", "../../fonts/", "../../../fonts/"] as const;

const fontCache = new Map<string, Buffer>();
function loadFontFile(file: string): Buffer {
  const hit = fontCache.get(file);
  if (hit) return hit;
  const tried: string[] = [];
  for (const dir of FONT_CANDIDATE_DIRS) {
    const rel = `${dir}${file}`;
    try {
      const buf = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
      fontCache.set(file, buf);
      return buf;
    } catch {
      tried.push(rel);
    }
  }
  throw new Error(
    `brand font ${file} not found (tried: ${tried.join(", ")}) — refusing to fall back to WinAnsi Helvetica (would corrupt non-Latin-1 glyphs)`,
  );
}

/** Register the Plus Jakarta Sans family on a pdfkit document. */
export function registerBrandFonts(doc: PDFKit.PDFDocument): void {
  for (const [name, file] of Object.entries(FONT_FILES)) {
    doc.registerFont(name, loadFontFile(file));
  }
}

// ── Logo ──────────────────────────────────────────────────────────────────────
// Navy Cognirise wordmark (fits light surfaces). Null when unresolvable —
// callers fall back to a text wordmark.
export function loadBrandLogo(): Buffer | null {
  return loadBoardPackLogo();
}

// ── Per-document state ────────────────────────────────────────────────────────
interface BrandState {
  chrome: boolean; // paint content-page chrome on pageAdded
  coverPages: number; // pages rendered as covers (skip footers)
  logo: Buffer | null;
}
const stateByDoc = new WeakMap<PDFKit.PDFDocument, BrandState>();

function state(doc: PDFKit.PDFDocument): BrandState {
  let s = stateByDoc.get(doc);
  if (!s) {
    s = { chrome: true, coverPages: 0, logo: loadBrandLogo() };
    stateByDoc.set(doc, s);
  }
  return s;
}

/**
 * Create a pdfkit document pre-configured for the brand kit: A4, brand
 * fonts registered, buffered pages, no auto first page, and a pageAdded
 * hook that paints the glass backdrop chrome on every content page.
 */
export function createBrandDoc(): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE.contentTop, bottom: 60, left: PAGE.margin, right: PAGE.margin },
    autoFirstPage: false,
    bufferPages: true,
  });
  registerBrandFonts(doc);
  const s = state(doc);
  doc.on("pageAdded", () => {
    if (s.chrome) paintPageChrome(doc);
    doc.x = PAGE.left;
    doc.y = PAGE.contentTop + 8;
  });
  return doc;
}

/** Add a content page (backdrop chrome painted automatically). */
export function addBrandPage(doc: PDFKit.PDFDocument): void {
  state(doc).chrome = true;
  doc.addPage();
}

// ── Page chrome (content pages) ──────────────────────────────────────────────
function paintPageChrome(doc: PDFKit.PDFDocument): void {
  const w = doc.page.width;
  const h = doc.page.height;
  doc.save();
  // Approved light wave artwork behind everything (glassmorphism print
  // translation) with a near-white scrim so panels/text stay readable;
  // vector ice gradient as fallback when the asset is unavailable.
  const bg = loadBgAsset("pdf-bg-light.jpg");
  if (bg) {
    doc.image(bg, 0, 0, { width: w, height: h });
    doc.fillOpacity(0.6).rect(0, 0, w, h).fill("#F6F7FB");
    doc.fillOpacity(1);
  } else {
    const grad = doc.linearGradient(0, 0, 0, h);
    grad.stop(0, "#E9EFF7").stop(0.3, "#F5F8FC").stop(1, "#FBFCFE");
    doc.rect(0, 0, w, h).fill(grad);
  }
  // Navy strip + Cognirise gradient hairline at the very top.
  doc.rect(0, 0, w, 8).fill(BRAND.navy);
  cogGradRule(doc, 0, 8, w, 1.6);
  // Wordmark, top-left of the header zone.
  const s = state(doc);
  if (s.logo) {
    doc.image(s.logo, PAGE.left, 24, { width: 88 });
  } else {
    doc.font(FONT.bold).fontSize(13).fillColor(BRAND.navy).text("COGNIRISE", PAGE.left, 26, { lineBreak: false });
  }
  doc
    .font(FONT.medium)
    .fontSize(7.5)
    .fillColor(BRAND.muted)
    .text("ATELIER · COGNIRISE", PAGE.right - 180, 32, { width: 180, align: "right", characterSpacing: 1.2, lineBreak: false });
  doc
    .moveTo(PAGE.left, 56)
    .lineTo(PAGE.right, 56)
    .strokeColor(BRAND.hairline)
    .lineWidth(0.8)
    .stroke();
  doc.restore();
}

// ── Cover page ────────────────────────────────────────────────────────────────
export interface BrandCoverOpts {
  /** e.g. "Client Research Brief" */
  docType: string;
  /** main title (entity/document name) */
  title: string;
  /** secondary lines under the title */
  subLines?: Array<string | null | undefined>;
  /** small gold badge line, e.g. "Confidence: high" */
  badge?: string | null;
  generatedAt?: Date;
  /** bottom-of-cover confidentiality line override */
  confidentiality?: string;
}

/**
 * Full-bleed cover on the approved dark Cognirise artwork.
 *
 * Editorial layout — no boxes, no chips: the white wordmark sits directly
 * on the artwork top-left, the title block anchors the upper-middle of the
 * page over the darkest region of the art, and a hairline meta band with
 * the generated date + confidentiality line closes the page.
 */
export function brandCover(doc: PDFKit.PDFDocument, opts: BrandCoverOpts): void {
  const s = state(doc);
  s.chrome = false;
  doc.addPage();
  s.coverPages += 1;
  s.chrome = true;

  const w = doc.page.width;
  const h = doc.page.height;
  // Approved dark backdrop artwork with a navy scrim for text contrast;
  // vector navy gradient as fallback when the asset is unavailable.
  const bg = loadBgAsset("pdf-bg-dark.jpg");
  if (bg) {
    doc.image(bg, 0, 0, { width: w, height: h });
    doc.save();
    // Heavier at the top (where the copy sits), lighter over the artwork.
    const scrim = doc.linearGradient(0, 0, 0, h);
    scrim.stop(0, BRAND.navyDeep).stop(0.65, BRAND.navyDeep).stop(1, BRAND.navyDeep);
    doc.fillOpacity(0.45).rect(0, 0, w, h).fill(scrim);
    doc.fillOpacity(1);
    doc.restore();
  } else {
    const grad = doc.linearGradient(0, 0, w, h);
    grad.stop(0, BRAND.navyDeep).stop(0.55, BRAND.navy).stop(1, "#16305A");
    doc.rect(0, 0, w, h).fill(grad);
  }
  // Cognirise gradient top rule.
  cogGradRule(doc, 0, 0, w, 6);

  const mx = 64; // cover margin
  const cw = w - mx * 2;

  // White wordmark straight on the artwork — no chip.
  const whiteLogo = loadBgAsset("pdf-logo-white.png");
  if (whiteLogo) {
    doc.image(whiteLogo, mx, 58, { width: 132 });
  } else {
    doc.font(FONT.bold).fontSize(18).fillColor(BRAND.white).text("COGNIRISE", mx, 62, { lineBreak: false });
  }
  doc
    .font(FONT.medium)
    .fontSize(8)
    .fillOpacity(0.7)
    .fillColor(BRAND.white)
    .text("ATELIER", w - mx - 120, 70, { width: 120, align: "right", characterSpacing: 3, lineBreak: false });
  doc.fillOpacity(1);

  // Title block, upper-middle.
  let y = 236;
  cogGradRule(doc, mx, y, 72, 2.2);
  y += 18;
  doc
    .font(FONT.semibold)
    .fontSize(11)
    .fillColor(BRAND.goldSoft)
    .text(opts.docType.toUpperCase(), mx, y, { width: cw, characterSpacing: 2.6 });
  y = doc.y + 14;
  doc.font(FONT.bold).fontSize(31).fillColor(BRAND.white).text(opts.title, mx, y, { width: cw, lineGap: 2 });
  y = doc.y + 14;

  for (const line of opts.subLines ?? []) {
    if (!line) continue;
    doc.font(FONT.regular).fontSize(12).fillOpacity(0.85).fillColor(BRAND.white).text(line, mx, y, { width: cw });
    doc.fillOpacity(1);
    y = doc.y + 5;
  }
  if (opts.badge) {
    // Outlined pill badge in the coral accent.
    y += 12;
    const badgeText = opts.badge;
    doc.font(FONT.semibold).fontSize(9.5);
    const tw = doc.widthOfString(badgeText, { characterSpacing: 0.4 });
    const ph = 22;
    doc.save();
    doc.roundedRect(mx, y, tw + 28, ph, ph / 2).lineWidth(1).strokeOpacity(0.85).strokeColor(BRAND.coral).stroke();
    doc.strokeOpacity(1);
    doc.restore();
    doc.fillColor(BRAND.coral).text(badgeText, mx + 14, y + 6, { characterSpacing: 0.4, lineBreak: false });
    y += ph;
  }

  // Bottom meta band. Zero the bottom margin while writing near the page
  // edge — otherwise pdfkit auto-paginates onto a phantom page.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const genAt = opts.generatedAt ?? new Date();
  const dateStr = genAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const bandY = h - 92;
  doc.save();
  doc.moveTo(mx, bandY).lineTo(w - mx, bandY).lineWidth(0.8).strokeOpacity(0.28).strokeColor(BRAND.white).stroke();
  doc.strokeOpacity(1);
  doc.restore();
  doc
    .font(FONT.semibold)
    .fontSize(9)
    .fillOpacity(0.85)
    .fillColor(BRAND.white)
    .text(`Generated ${dateStr}`, mx, bandY + 14, { width: cw / 2, lineBreak: false });
  doc
    .font(FONT.regular)
    .fontSize(9)
    .text("cognirise.ai", mx + cw / 2, bandY + 14, { width: cw / 2, align: "right", lineBreak: false });
  doc
    .font(FONT.regular)
    .fontSize(7.5)
    .fillOpacity(0.6)
    .text(
      opts.confidentiality ??
        "Confidential — prepared by Cognirise. Not for distribution outside the intended recipient.",
      mx,
      bandY + 32,
      { width: cw },
    );
  doc.fillOpacity(1);
  doc.page.margins.bottom = savedBottom;
}

// ── Block model ───────────────────────────────────────────────────────────────
export type BrandBlock =
  | {
      kind: "text";
      text: string;
      font?: string;
      size?: number;
      color?: string;
      indent?: number;
      gapAfter?: number;
      align?: "left" | "right" | "center";
      link?: string;
    }
  | { kind: "bullet"; text: string; bold?: boolean; indent?: number; size?: number; color?: string; gapAfter?: number }
  | { kind: "gap"; h: number }
  | { kind: "divider" }
  | {
      kind: "row";
      cells: Array<{ text: string; width: number; align?: "left" | "right" | "center"; font?: string; size?: number; color?: string }>;
      gapAfter?: number;
    };

export const block = {
  body: (text: string, over: Partial<Extract<BrandBlock, { kind: "text" }>> = {}): BrandBlock => ({
    kind: "text", text, font: FONT.regular, size: 9.5, color: BRAND.ink, gapAfter: 4, ...over,
  }),
  label: (text: string): BrandBlock => ({
    kind: "text", text, font: FONT.semibold, size: 9.5, color: BRAND.navy, gapAfter: 2,
  }),
  strong: (text: string, over: Partial<Extract<BrandBlock, { kind: "text" }>> = {}): BrandBlock => ({
    kind: "text", text, font: FONT.semibold, size: 10.5, color: BRAND.navy, gapAfter: 3, ...over,
  }),
  muted: (text: string, over: Partial<Extract<BrandBlock, { kind: "text" }>> = {}): BrandBlock => ({
    kind: "text", text, font: FONT.regular, size: 9, color: BRAND.muted, gapAfter: 3, ...over,
  }),
  italic: (text: string, over: Partial<Extract<BrandBlock, { kind: "text" }>> = {}): BrandBlock => ({
    kind: "text", text, font: FONT.italic, size: 9.5, color: BRAND.muted, gapAfter: 3, ...over,
  }),
  refs: (text: string, indent = 10): BrandBlock => ({
    kind: "text", text, font: FONT.semibold, size: 7.5, color: BRAND.gold, indent, gapAfter: 4,
  }),
  bullet: (text: string, over: Partial<Extract<BrandBlock, { kind: "bullet" }>> = {}): BrandBlock => ({
    kind: "bullet", text, ...over,
  }),
  gap: (h = 6): BrandBlock => ({ kind: "gap", h }),
  notYet: (): BrandBlock => ({
    kind: "text", text: "Not yet available.", font: FONT.italic, size: 9.5, color: BRAND.faint, gapAfter: 3,
  }),
};

const INNER_W = PAGE.contentW - PANEL_PAD * 2;

function blockFont(b: BrandBlock): { font: string; size: number } {
  switch (b.kind) {
    case "text":
      return { font: b.font ?? FONT.regular, size: b.size ?? 9.5 };
    case "bullet":
      return { font: b.bold ? FONT.semibold : FONT.regular, size: b.size ?? 9.5 };
    default:
      return { font: FONT.regular, size: 9.5 };
  }
}

function measureBlock(doc: PDFKit.PDFDocument, b: BrandBlock): number {
  switch (b.kind) {
    case "gap":
      return b.h;
    case "divider":
      return 10;
    case "text": {
      const { font, size } = blockFont(b);
      const w = INNER_W - (b.indent ?? 0);
      return doc.font(font).fontSize(size).heightOfString(b.text, { width: w }) + (b.gapAfter ?? 4);
    }
    case "bullet": {
      const { font, size } = blockFont(b);
      const w = INNER_W - (b.indent ?? 0) - 12;
      return doc.font(font).fontSize(size).heightOfString(b.text, { width: w }) + (b.gapAfter ?? 3);
    }
    case "row": {
      let max = 0;
      for (const c of b.cells) {
        const h = doc
          .font(c.font ?? FONT.regular)
          .fontSize(c.size ?? 9)
          .heightOfString(c.text, { width: c.width });
        if (h > max) max = h;
      }
      return max + (b.gapAfter ?? 4);
    }
  }
}

function renderBlock(doc: PDFKit.PDFDocument, b: BrandBlock, x: number, y: number): number {
  switch (b.kind) {
    case "gap":
      return y + b.h;
    case "divider":
      doc.moveTo(x, y + 4).lineTo(x + INNER_W, y + 4).strokeColor(BRAND.hairline).lineWidth(0.7).stroke();
      return y + 10;
    case "text": {
      const { font, size } = blockFont(b);
      const ix = x + (b.indent ?? 0);
      const w = INNER_W - (b.indent ?? 0);
      doc.font(font).fontSize(size).fillColor(b.color ?? BRAND.ink).text(b.text, ix, y, {
        width: w,
        align: b.align ?? "left",
        ...(b.link ? { link: b.link } : {}),
      });
      return doc.y + (b.gapAfter ?? 4);
    }
    case "bullet": {
      const { font, size } = blockFont(b);
      const ix = x + (b.indent ?? 0);
      // Gold dot marker, hanging indent.
      doc.circle(ix + 3, y + size * 0.5, 1.7).fill(BRAND.gold);
      doc.font(font).fontSize(size).fillColor(b.color ?? BRAND.ink).text(b.text, ix + 12, y, {
        width: INNER_W - (b.indent ?? 0) - 12,
      });
      return doc.y + (b.gapAfter ?? 3);
    }
    case "row": {
      let cx = x;
      let maxY = y;
      for (const c of b.cells) {
        doc
          .font(c.font ?? FONT.regular)
          .fontSize(c.size ?? 9)
          .fillColor(c.color ?? BRAND.ink)
          .text(c.text, cx, y, { width: c.width, align: c.align ?? "left" });
        if (doc.y > maxY) maxY = doc.y;
        cx += c.width;
      }
      return maxY + (b.gapAfter ?? 4);
    }
  }
}

/** Split an over-tall text block into page-sized chunks (word-greedy). */
function splitOversizeBlock(doc: PDFKit.PDFDocument, b: BrandBlock, maxH: number): BrandBlock[] {
  if (b.kind !== "text") return [b];
  const { font, size } = blockFont(b);
  const w = INNER_W - (b.indent ?? 0);
  const words = b.text.split(/\s+/);
  const out: BrandBlock[] = [];
  let start = 0;
  while (start < words.length) {
    let lo = start + 1;
    let hi = words.length;
    // Binary search the largest word-count that fits maxH.
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const h = doc.font(font).fontSize(size).heightOfString(words.slice(start, mid).join(" "), { width: w });
      if (h <= maxH) lo = mid; else hi = mid - 1;
    }
    out.push({ ...b, text: words.slice(start, lo).join(" ") });
    start = lo;
  }
  return out.length ? out : [b];
}

// ── Glass section ─────────────────────────────────────────────────────────────
const HEADING_H = 30;

function panelSliceHeights(doc: PDFKit.PDFDocument, blocks: BrandBlock[]): number[] {
  return blocks.map((b) => measureBlock(doc, b));
}

/**
 * Render a titled glass panel containing measured blocks, splitting the
 * panel across pages as needed (continuation panels repeat the title with
 * a "continued" marker).
 */
export function glassSection(
  doc: PDFKit.PDFDocument,
  title: string | null,
  blocksIn: BrandBlock[],
  opts: { accent?: string } = {},
): void {
  const blocks = blocksIn.length ? blocksIn : [block.notYet()];
  const fullInnerH = PAGE.bottom - PAGE.contentTop - PANEL_PAD * 2 - HEADING_H - 8;
  // Pre-split any block taller than a full page's panel interior.
  const flat: BrandBlock[] = [];
  for (const b of blocks) {
    const h = measureBlock(doc, b);
    if (h > fullInnerH) flat.push(...splitOversizeBlock(doc, b, fullInnerH - 12));
    else flat.push(b);
  }
  const heights = panelSliceHeights(doc, flat);

  let i = 0;
  let first = true;
  while (i < flat.length) {
    let y = doc.y;
    const headH = title ? HEADING_H : 0;
    let avail = PAGE.bottom - y - PANEL_PAD * 2 - headH;
    // Need room for at least the heading + one block; otherwise new page.
    if (avail < heights[i] || avail < 40) {
      addBrandPage(doc);
      y = doc.y;
      avail = PAGE.bottom - y - PANEL_PAD * 2 - headH;
    }
    // Take blocks that fit this page.
    let take = 0;
    let used = 0;
    while (i + take < flat.length && used + heights[i + take] <= avail) {
      used += heights[i + take];
      take += 1;
    }
    if (take === 0) { take = 1; used = Math.min(heights[i], avail); } // safety
    const panelH = used + PANEL_PAD * 2 + headH;

    // Paint panel behind the slice.
    doc.save();
    doc.fillOpacity(0.72).roundedRect(PAGE.left, y, PAGE.contentW, panelH, PANEL_RADIUS).fill(BRAND.white);
    doc.fillOpacity(1);
    doc
      .roundedRect(PAGE.left, y, PAGE.contentW, panelH, PANEL_RADIUS)
      .lineWidth(0.9)
      .strokeColor(BRAND.panelStroke)
      .stroke();
    doc.restore();

    let cy = y + PANEL_PAD;
    if (title) {
      // Gold accent tick + navy title.
      doc.roundedRect(PAGE.left + PANEL_PAD, cy + 1, 3.5, 13, 1.75).fill(opts.accent ?? BRAND.gold);
      doc
        .font(FONT.semibold)
        .fontSize(12)
        .fillColor(BRAND.navy)
        .text(first ? title : `${title} (continued)`, PAGE.left + PANEL_PAD + 12, cy, {
          width: INNER_W - 12,
          lineBreak: false,
        });
      cy = y + PANEL_PAD + 18;
      doc
        .moveTo(PAGE.left + PANEL_PAD, cy + 2)
        .lineTo(PAGE.right - PANEL_PAD, cy + 2)
        .strokeColor(BRAND.hairline)
        .lineWidth(0.7)
        .stroke();
      cy += 10;
    }
    for (let k = 0; k < take; k++) {
      cy = renderBlock(doc, flat[i + k], PAGE.left + PANEL_PAD, cy);
    }
    doc.x = PAGE.left;
    doc.y = y + panelH + PANEL_GAP;
    i += take;
    first = false;
  }
}

// ── Branded table ─────────────────────────────────────────────────────────────
export interface BrandTableColumn {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
}

/**
 * Navy-headed zebra table. Page-break aware (header band repeats). Widths
 * should sum to ≤ PAGE.contentW.
 */
export function brandTable(
  doc: PDFKit.PDFDocument,
  columns: BrandTableColumn[],
  rows: string[][],
  opts: { fontSize?: number; boldRows?: Set<number> } = {},
): void {
  const size = opts.fontSize ?? 8.5;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const x0 = PAGE.left;
  const padX = 6;

  const drawHeader = (y: number): number => {
    doc.roundedRect(x0, y, totalW, 20, 5).fill(BRAND.navy);
    let cx = x0;
    for (const c of columns) {
      doc
        .font(FONT.semibold)
        .fontSize(size - 0.5)
        .fillColor(BRAND.white)
        .text(c.label, cx + padX, y + 5.5, { width: c.width - padX * 2, align: c.align ?? "left", lineBreak: false });
      cx += c.width;
    }
    return y + 24;
  };

  let y = doc.y;
  if (y + 60 > PAGE.bottom) {
    addBrandPage(doc);
    y = doc.y;
  }
  y = drawHeader(y);

  rows.forEach((row, r) => {
    const bold = opts.boldRows?.has(r) ?? false;
    const font = bold ? FONT.semibold : FONT.regular;
    let rowH = 0;
    columns.forEach((c, i) => {
      const h = doc.font(font).fontSize(size).heightOfString(row[i] ?? "", { width: c.width - padX * 2 });
      if (h > rowH) rowH = h;
    });
    rowH += 6;
    if (y + rowH > PAGE.bottom) {
      addBrandPage(doc);
      y = doc.y;
      y = drawHeader(y);
    }
    if (r % 2 === 1) {
      doc.rect(x0, y - 2, totalW, rowH).fill(BRAND.zebra);
    }
    let cx = x0;
    columns.forEach((c, i) => {
      doc
        .font(font)
        .fontSize(size)
        .fillColor(bold ? BRAND.navy : BRAND.ink)
        .text(row[i] ?? "", cx + padX, y, { width: c.width - padX * 2, align: c.align ?? "left" });
      cx += c.width;
    });
    y += rowH;
  });
  doc.moveTo(x0, y + 1).lineTo(x0 + totalW, y + 1).strokeColor(BRAND.panelStroke).lineWidth(0.8).stroke();
  doc.x = PAGE.left;
  doc.y = y + 10;
}

// ── Footers ───────────────────────────────────────────────────────────────────
/**
 * Stamp branded footers on every buffered content page (cover pages carry
 * their own confidentiality line and are skipped).
 */
export function writeBrandFooters(
  doc: PDFKit.PDFDocument,
  opts: { label?: string; generatedAt?: Date } = {},
): void {
  const s = state(doc);
  const range = doc.bufferedPageRange();
  const total = range.count;
  const genAt = opts.generatedAt ?? new Date();
  const dateStr = genAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  for (let i = 0; i < total; i++) {
    if (i < s.coverPages) continue;
    doc.switchToPage(range.start + i);
    // Zero the bottom margin so writing in the footer zone can never
    // trigger pdfkit's auto-pagination onto a phantom page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.circle(PAGE.left + 2.5, y + 4, 2.5).fill(BRAND.gold);
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(BRAND.muted)
      .text(opts.label ?? "Cognirise — Confidential", PAGE.left + 10, y, { width: PAGE.contentW / 2, lineBreak: false });
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(BRAND.muted)
      .text(`${dateStr}   ·   Page ${i + 1} of ${total}`, PAGE.left + PAGE.contentW / 2, y, {
        width: PAGE.contentW / 2 - 10,
        align: "right",
        lineBreak: false,
      });
  }
}
