/**
 * Task — POV export formats beyond PDF.
 *
 * Renders a stored POV version (same PovVersionInput the PDF renderer
 * consumes) into:
 *   - a Cognirise-branded PowerPoint deck (.pptx via pptxgenjs):
 *     navy title slide with the white wordmark, one light "glass" slide
 *     per POV section (long sections split across continuation slides),
 *     citation-coverage note and a sources slide.
 *   - a single self-contained branded HTML document (inline CSS, logo
 *     embedded as a data URI) readable offline and printable.
 *
 * Both renderers deliberately reuse the brand tokens from the PDF kit so
 * the three exports read as one family.
 */
import PptxGenJSImport from "pptxgenjs";

// pptxgenjs ships CJS; depending on the bundler/loader the constructor may
// arrive as the module itself or under .default — resolve both shapes.
const PptxGenJS: typeof PptxGenJSImport =
  ((PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }).default ??
    PptxGenJSImport) as typeof PptxGenJSImport;
import { readFileSync } from "node:fs";
import { BRAND, loadBgAsset, loadBrandLogo } from "./atelier-pdf-brand.js";
import type { PovVersionInput } from "./atelier-brief-pdf.js";
import type { AgentFact } from "./atelier-agents/runner.js";

type PovSection = PovVersionInput["version"]["sections"][number];

// ── Shared text helpers ───────────────────────────────────────────────────────

/** Drafted body text of a section, tolerant of both stored shapes, tags stripped. */
function sectionText(s: PovSection): string {
  const raw = (s.body && s.body.trim()) || (s.content && s.content.trim()) || "";
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function strippedBody(v: PovVersionInput["version"]): string {
  return (v.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** True when a drafted text is only the known empty-draft placeholder. */
function isPlaceholderText(t: string): boolean {
  const norm = t.toLowerCase().replace(/[^a-z ]/g, "").trim();
  return norm === "" || norm === "not yet available" || norm === "not available yet";
}

/**
 * True when the version has nothing exportable: no section carries real
 * drafted text (placeholder-only "Not yet available." text doesn't count)
 * and there is no real fallback body. Export routes refuse these instead
 * of shipping an empty placeholder file to a client.
 */
export function isPovVersionEmpty(v: PovVersionInput["version"]): boolean {
  const hasSectionText = (v.sections ?? []).some((s) => !isPlaceholderText(sectionText(s)));
  return !hasSectionText && isPlaceholderText(strippedBody(v));
}

/** Split long text into chunks at sentence boundaries (~maxLen chars each). */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > maxLen) {
      chunks.push(cur.trim());
      cur = "";
    }
    // A single sentence longer than maxLen gets hard-wrapped on word bounds.
    if (s.length > maxLen) {
      const words = s.split(/\s+/);
      for (const w of words) {
        if (cur.length + w.length + 1 > maxLen) {
          chunks.push(cur.trim());
          cur = "";
        }
        cur += (cur ? " " : "") + w;
      }
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

interface SourceRef {
  url: string;
  index: number;
}

function collectRefs(urls: string[], sources: SourceRef[]): string {
  const refs = urls.map((url) => {
    const hit = sources.find((s) => s.url === url);
    if (hit) return `[${hit.index}]`;
    const idx = sources.length + 1;
    sources.push({ url, index: idx });
    return `[${idx}]`;
  });
  return refs.join(" ");
}

function sectionSourceUrls(section: PovSection, citations: AgentFact[]): string[] {
  const citedIds = section.citationIds ?? section.factIds ?? [];
  const linked = citations.filter((f) => f.id && citedIds.includes(f.id));
  return [...new Set(linked.filter((f) => f.sourceUrl).map((f) => f.sourceUrl!))];
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const CONFIDENTIALITY =
  "Confidential — prepared by Cognirise. Not for distribution outside the intended recipient.";
const AI_NOTE =
  "This document is AI generated and may contain errors — please verify key facts before relying on it.";

// ── PPTX export ───────────────────────────────────────────────────────────────

// Task #1280 brand pairing — Inter body, Comfortaa headings (font *names*
// only: pptx cannot embed fonts, viewers fall back when not installed).
const FONT_FACE = "Inter";
const HEADING_FACE = "Comfortaa";
// 16:9 slide geometry in inches.
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MX = 0.55; // side margin
const CW = SLIDE_W - MX * 2;

function assetB64(file: string): string | null {
  const p = loadBgAsset(file);
  if (!p) return null;
  try {
    return readFileSync(p).toString("base64");
  } catch {
    return null;
  }
}

/** Build the branded POV deck; resolves to the .pptx file bytes. */
export async function buildPovPptx(input: PovVersionInput): Promise<Buffer> {
  const { oppName, pov, version: v, generatedAt } = input;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "COG_16x9", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "COG_16x9";
  pptx.author = "Cognirise";
  pptx.company = "Cognirise";
  pptx.title = pov.title;

  const darkBg = assetB64("pdf-bg-dark.jpg");
  const whiteLogo = assetB64("pdf-logo-white.png");
  const navyLogoBuf = loadBrandLogo();
  const navyLogo = navyLogoBuf ? navyLogoBuf.toString("base64") : null;

  // Light content-slide master: ice wash, navy top strip, magenta hairline,
  // Cognirise wordmark bottom-left, slide number bottom-right.
  pptx.defineSlideMaster({
    title: "COG_CONTENT",
    background: { color: "F5F8FC" },
    objects: [
      { rect: { x: 0, y: 0, w: SLIDE_W, h: 0.09, fill: { color: BRAND.navy.replace("#", "") } } },
      { rect: { x: 0, y: 0.09, w: SLIDE_W, h: 0.022, fill: { color: BRAND.gold.replace("#", "") } } },
      ...(navyLogo
        ? [{ image: { x: MX, y: SLIDE_H - 0.42, h: 0.22, w: 1.0, data: `data:image/png;base64,${navyLogo}` } } as const]
        : [
            {
              text: {
                text: "COGNIRISE",
                options: {
                  x: MX, y: SLIDE_H - 0.45, w: 2, h: 0.3,
                  fontFace: HEADING_FACE, fontSize: 9, bold: true,
                  color: BRAND.navy.replace("#", ""),
                },
              },
            } as const,
          ]),
    ],
    slideNumber: {
      x: SLIDE_W - MX - 0.6, y: SLIDE_H - 0.42, w: 0.6, h: 0.25,
      fontFace: FONT_FACE, fontSize: 9, color: "8A97A8", align: "right",
    },
  });

  const navy = BRAND.navy.replace("#", "");
  const gold = BRAND.gold.replace("#", "");
  const goldSoft = BRAND.goldSoft.replace("#", "");
  const ink = BRAND.ink.replace("#", "");
  const muted = BRAND.muted.replace("#", "");

  // ── Title slide ──
  {
    const s = pptx.addSlide();
    if (darkBg) {
      s.background = { data: `data:image/jpeg;base64,${darkBg}` };
    } else {
      s.background = { color: BRAND.navyDeep.replace("#", "") };
    }
    // Signature gradient rule approximation (blue→purple→magenta→coral bands).
    const bands = ["5B7CFF", "8A5BD6", "C45BB8", "FF7B5A"];
    bands.forEach((c, i) => {
      s.addShape("rect", { x: (SLIDE_W / 4) * i, y: 0, w: SLIDE_W / 4, h: 0.06, fill: { color: c } });
    });
    if (whiteLogo) {
      s.addImage({ data: `data:image/png;base64,${whiteLogo}`, x: MX, y: 0.5, w: 1.55, h: 0.34 });
    } else {
      s.addText("COGNIRISE", {
        x: MX, y: 0.45, w: 3, h: 0.4, fontFace: HEADING_FACE, fontSize: 16, bold: true, color: "FFFFFF",
      });
    }
    s.addText("POINT OF VIEW", {
      x: MX, y: 1.7, w: CW, h: 0.35, fontFace: FONT_FACE, fontSize: 12, bold: true,
      color: goldSoft, charSpacing: 4,
    });
    s.addText(pov.title, {
      x: MX, y: 2.05, w: CW, h: 1.35, fontFace: HEADING_FACE, fontSize: 28, bold: true,
      color: "FFFFFF", valign: "top", fit: "shrink",
    });
    s.addText(oppName + (pov.audience ? ` · For ${pov.audience}` : ""), {
      x: MX, y: 3.45, w: CW, h: 0.35, fontFace: FONT_FACE, fontSize: 13, color: "FFFFFF",
      transparency: 12,
    });
    s.addShape("line", {
      x: MX, y: SLIDE_H - 0.95, w: CW, h: 0, line: { color: "FFFFFF", width: 0.75, transparency: 65 },
    });
    s.addText(`Generated ${fmtDate(generatedAt)}  ·  Draft v${v.versionNumber}`, {
      x: MX, y: SLIDE_H - 0.85, w: CW / 2, h: 0.3, fontFace: FONT_FACE, fontSize: 9, bold: true, color: "FFFFFF",
    });
    s.addText("cognirise.ai", {
      x: SLIDE_W - MX - 2, y: SLIDE_H - 0.85, w: 2, h: 0.3, fontFace: FONT_FACE, fontSize: 9,
      color: "FFFFFF", align: "right",
    });
    s.addText(`${CONFIDENTIALITY}  ${AI_NOTE}`, {
      x: MX, y: SLIDE_H - 0.55, w: CW, h: 0.45, fontFace: FONT_FACE, fontSize: 7,
      color: "FFFFFF", transparency: 35, valign: "top",
    });
  }

  const sources: SourceRef[] = [];
  const sections = (v.sections ?? []).filter((s) => s.heading || sectionText(s) || s.intent);

  // ── Agenda slide (contents) ──
  {
    const entries = sections.length > 0
      ? sections.map((s) => s.heading || "Untitled section")
      : [`Draft v${v.versionNumber}`];
    const s = pptx.addSlide({ masterName: "COG_CONTENT" });
    s.addText("Contents", {
      x: MX, y: 0.4, w: CW, h: 0.45, fontFace: HEADING_FACE, fontSize: 20, bold: true, color: navy,
    });
    s.addShape("rect", { x: MX, y: 0.92, w: 0.7, h: 0.035, fill: { color: gold } });
    // Two columns when long.
    const perCol = Math.ceil(entries.length / (entries.length > 8 ? 2 : 1));
    const cols = entries.length > 8 ? 2 : 1;
    for (let c = 0; c < cols; c++) {
      const colEntries = entries.slice(c * perCol, (c + 1) * perCol);
      s.addText(
        colEntries.map((heading, i) => ({
          text: `${c * perCol + i + 1}.  ${heading}`,
          options: { breakLine: true, paraSpaceAfter: 8 },
        })),
        {
          x: MX + c * (CW / 2), y: 1.15, w: CW / cols - 0.2, h: SLIDE_H - 1.8,
          fontFace: FONT_FACE, fontSize: entries.length > 10 ? 11 : 13, bold: true, color: navy,
          valign: "top", fit: "shrink",
        },
      );
    }
  }

  // ── Section slides ──
  const addSectionSlide = (heading: string, bodyChunk: string, refs: string | null, intentOnly = false) => {
    const s = pptx.addSlide({ masterName: "COG_CONTENT" });
    s.addText(heading, {
      x: MX, y: 0.35, w: CW, h: 0.62, fontFace: HEADING_FACE, fontSize: 18, bold: true,
      color: navy, valign: "top", fit: "shrink",
    });
    s.addShape("rect", { x: MX, y: 1.0, w: 0.7, h: 0.035, fill: { color: gold } });
    // Glass card panel behind the body.
    s.addShape("roundRect", {
      x: MX - 0.08, y: 1.2, w: CW + 0.16, h: SLIDE_H - 1.85,
      rectRadius: 0.08, fill: { color: "FFFFFF", transparency: 22 },
      line: { color: "D9E2EE", width: 0.75 },
    });
    s.addText(bodyChunk, {
      x: MX + 0.12, y: 1.34, w: CW - 0.24, h: SLIDE_H - 2.1 - (refs ? 0.3 : 0),
      fontFace: FONT_FACE, fontSize: 12.5, color: intentOnly ? muted : ink,
      italic: intentOnly, valign: "top", fit: "shrink", lineSpacingMultiple: 1.15,
    });
    if (refs) {
      s.addText(`Sources ${refs}`, {
        x: MX + 0.12, y: SLIDE_H - 0.95, w: CW - 0.24, h: 0.25,
        fontFace: FONT_FACE, fontSize: 8.5, bold: true, color: gold,
      });
    }
  };

  if (sections.length > 0) {
    for (const section of sections) {
      const heading = section.heading || "Untitled section";
      const text = sectionText(section);
      const refs = (() => {
        const urls = sectionSourceUrls(section, (v.citations as AgentFact[]) ?? []);
        return urls.length ? collectRefs(urls, sources) : null;
      })();
      if (text) {
        // ~1000 chars fits comfortably at 12.5pt in the panel; shrink covers slack.
        const chunks = chunkText(text, 1000);
        chunks.forEach((chunk, i) => {
          addSectionSlide(i === 0 ? heading : `${heading} (cont.)`, chunk, i === chunks.length - 1 ? refs : null);
        });
      } else if (section.intent) {
        addSectionSlide(heading, `Intent: ${section.intent}`, refs, true);
      }
    }
  } else {
    const chunks = chunkText(strippedBody(v), 1000);
    chunks.forEach((chunk, i) => {
      addSectionSlide(i === 0 ? `Draft v${v.versionNumber}` : `Draft v${v.versionNumber} (cont.)`, chunk, null);
    });
  }

  // Remaining citations join the registry so the appendix is complete.
  for (const f of (v.citations as AgentFact[]) ?? []) {
    if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
      sources.push({ url: f.sourceUrl, index: sources.length + 1 });
    }
  }

  // ── Sources / coverage slide ──
  {
    const s = pptx.addSlide({ masterName: "COG_CONTENT" });
    s.addText("Sources", {
      x: MX, y: 0.4, w: CW, h: 0.45, fontFace: HEADING_FACE, fontSize: 20, bold: true, color: navy,
    });
    s.addShape("rect", { x: MX, y: 0.92, w: 0.7, h: 0.035, fill: { color: gold } });
    let y = 1.15;
    if (v.citationCoverage != null) {
      s.addText(`${Math.round(v.citationCoverage * 100)}% of sections cite evidence.`, {
        x: MX, y, w: CW, h: 0.3, fontFace: FONT_FACE, fontSize: 11, color: ink,
      });
      y += 0.35;
    }
    if (sources.length > 0) {
      s.addText(
        sources.map((src) => ({
          text: `[${src.index}]  ${src.url}`,
          options: { breakLine: true, paraSpaceAfter: 4 },
        })),
        {
          x: MX, y, w: CW, h: SLIDE_H - y - 0.6, fontFace: FONT_FACE,
          fontSize: sources.length > 14 ? 7.5 : 9, color: muted, valign: "top", fit: "shrink",
        },
      );
    } else {
      s.addText("No external sources cited.", {
        x: MX, y, w: CW, h: 0.3, fontFace: FONT_FACE, fontSize: 10, italic: true, color: muted,
      });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}

// ── HTML export ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render the POV as a single self-contained branded HTML document. */
export function renderPovHtml(input: PovVersionInput): string {
  const { oppName, pov, version: v, generatedAt } = input;
  const navyLogoBuf = loadBrandLogo();
  const logoTag = navyLogoBuf
    ? `<img class="logo" src="data:image/png;base64,${navyLogoBuf.toString("base64")}" alt="Cognirise" />`
    : `<span class="wordmark">COGNIRISE</span>`;
  const whiteLogo = assetB64("pdf-logo-white.png");
  const coverLogoTag = whiteLogo
    ? `<img class="logo" src="data:image/png;base64,${whiteLogo}" alt="Cognirise" />`
    : `<span class="wordmark wordmark-white">COGNIRISE</span>`;

  const sources: SourceRef[] = [];
  const sections = (v.sections ?? []).filter((s) => s.heading || sectionText(s) || s.intent);

  const sectionCards: string[] = [];
  if (sections.length > 0) {
    for (const section of sections) {
      const text = sectionText(section);
      const urls = sectionSourceUrls(section, (v.citations as AgentFact[]) ?? []);
      const refs = urls.length ? collectRefs(urls, sources) : null;
      sectionCards.push(`
      <section class="card">
        ${section.heading ? `<h2>${esc(section.heading)}</h2>` : ""}
        ${text ? `<p>${esc(text)}</p>` : section.intent ? `<p class="intent">Intent: ${esc(section.intent)}</p>` : ""}
        ${refs ? `<p class="refs">Sources ${esc(refs)}</p>` : ""}
      </section>`);
    }
  } else {
    sectionCards.push(`
      <section class="card">
        <h2>Draft v${v.versionNumber}</h2>
        <p>${esc(strippedBody(v))}</p>
      </section>`);
  }

  for (const f of (v.citations as AgentFact[]) ?? []) {
    if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
      sources.push({ url: f.sourceUrl, index: sources.length + 1 });
    }
  }

  const tocItems = (sections.length > 0
    ? sections.map((s) => s.heading || "Untitled section")
    : [`Draft v${v.versionNumber}`]
  )
    .concat(v.citationCoverage != null ? ["Citation Coverage"] : [])
    .concat(["Sources"])
    .map((h, i) => `<li>${i + 1}.&nbsp;&nbsp;${esc(h)}</li>`) 
    .join("\n          ");

  // Citation URLs are researched/stored data — only linkify http(s) URLs so a
  // poisoned `javascript:` (or other scheme) value can never become clickable.
  const safeHref = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  };
  const sourceItems = sources
    .map((s) => {
      const href = safeHref(s.url);
      return href
        ? `<li>[${s.index}] <a href="${esc(href)}" rel="noopener">${esc(s.url)}</a></li>`
        : `<li>[${s.index}] ${esc(s.url)}</li>`;
    })
    .join("\n          ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(pov.title)} — Cognirise Point of View</title>
<style>
  :root {
    --navy: ${BRAND.navy}; --navy-deep: ${BRAND.navyDeep}; --magenta: ${BRAND.gold};
    --magenta-soft: ${BRAND.goldSoft}; --coral: ${BRAND.coral}; --purple: ${BRAND.purple};
    --blue: ${BRAND.blue}; --ink: ${BRAND.ink}; --muted: ${BRAND.muted}; --faint: ${BRAND.faint};
    --stroke: ${BRAND.panelStroke};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    background: linear-gradient(180deg, #E9EFF7 0%, #F5F8FC 30%, #FBFCFE 100%);
    color: var(--ink); line-height: 1.6;
  }
  .grad-rule { height: 5px; background: linear-gradient(90deg, var(--blue) 0%, var(--purple) 35%, var(--magenta-soft) 65%, var(--coral) 100%); }
  .cover {
    background: linear-gradient(135deg, var(--navy-deep) 0%, var(--navy) 55%, #16305A 100%);
    color: #fff; padding: 56px 8vw 44px;
  }
  .cover .logo { width: 150px; display: block; }
  h1, h2, .wordmark { font-family: "Comfortaa", "Inter", "Segoe UI", system-ui, sans-serif; }
  .wordmark { font-weight: 800; letter-spacing: 1px; color: var(--navy); }
  .wordmark-white { color: #fff; font-size: 20px; }
  .cover .doctype { margin-top: 72px; color: var(--magenta-soft); font-weight: 700; letter-spacing: 4px; font-size: 13px; }
  .cover .doctype::before { content: ""; display: block; width: 72px; height: 3px; margin-bottom: 16px;
    background: linear-gradient(90deg, var(--blue), var(--purple), var(--magenta-soft), var(--coral)); }
  .cover h1 { font-size: clamp(28px, 4.5vw, 44px); font-weight: 800; margin-top: 14px; line-height: 1.2; }
  .cover .sub { margin-top: 14px; font-size: 16px; opacity: .85; }
  .cover .meta { margin-top: 56px; border-top: 1px solid rgba(255,255,255,.28); padding-top: 14px;
    display: flex; justify-content: space-between; font-size: 12.5px; flex-wrap: wrap; gap: 6px; }
  .cover .legal { margin-top: 14px; font-size: 10.5px; opacity: .6; max-width: 720px; }
  main { max-width: 860px; margin: 0 auto; padding: 36px 24px 64px; }
  .card {
    background: rgba(255,255,255,.78); border: 1px solid var(--stroke); border-radius: 14px;
    padding: 26px 30px; margin-bottom: 18px; box-shadow: 0 8px 24px rgba(14,31,61,.05);
  }
  .card h2 { color: var(--navy); font-size: 19px; font-weight: 700; margin-bottom: 10px; }
  .card h2::after { content: ""; display: block; width: 52px; height: 3px; margin-top: 8px; background: var(--magenta); border-radius: 2px; }
  .card p { font-size: 14.5px; color: var(--ink); }
  .card p.intent { font-style: italic; color: var(--muted); }
  .card p.refs { margin-top: 12px; font-size: 11px; font-weight: 700; color: var(--magenta); }
  .toc ul { list-style: none; }
  .toc li { font-weight: 600; color: var(--navy); padding: 4px 0; font-size: 14.5px; }
  .sources li { font-size: 12.5px; color: var(--muted); padding: 3px 0; word-break: break-all; list-style: none; }
  .sources a { color: var(--magenta); text-decoration: none; }
  footer { text-align: center; padding: 24px 16px 48px; color: var(--faint); font-size: 11px; }
  footer .logo { width: 110px; opacity: .85; margin-bottom: 10px; }
  @media print {
    body { background: #fff; }
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; page-break-after: always; }
    .card { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="grad-rule"></div>
  <header class="cover">
    ${coverLogoTag}
    <div class="doctype">POINT OF VIEW</div>
    <h1>${esc(pov.title)}</h1>
    <div class="sub">${esc(oppName + (pov.audience ? ` · For ${pov.audience}` : ""))}</div>
    <div class="meta">
      <span><strong>Generated ${esc(fmtDate(generatedAt))}</strong> · Draft v${v.versionNumber}</span>
      <span>cognirise.ai</span>
    </div>
    <div class="legal">${esc(CONFIDENTIALITY)}<br/>${esc(AI_NOTE)}</div>
  </header>
  <main>
    <section class="card toc">
      <h2>Contents</h2>
      <ul>
          ${tocItems}
      </ul>
    </section>
${sectionCards.join("\n")}
    ${
      v.citationCoverage != null
        ? `<section class="card"><h2>Citation Coverage</h2><p>${Math.round(v.citationCoverage * 100)}% of sections cite evidence.</p>${v.notes ? `<p class="intent">Notes: ${esc(v.notes)}</p>` : ""}</section>`
        : ""
    }
    <section class="card sources">
      <h2>Sources</h2>
      <ul>
          ${sourceItems || "<li>No external sources cited.</li>"}
      </ul>
    </section>
  </main>
  <footer>
    ${logoTag}
    <div>${esc(CONFIDENTIALITY)}</div>
  </footer>
</body>
</html>`;
}
