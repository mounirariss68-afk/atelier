// Task #297 — Canonical 15-section proposal spine + shared block model.
//
// One source of truth lives in this module:
//   1. `PROPOSAL_SPINE` — the 15-section taxonomy.
//   2. `buildProposalBlocks(input)` — produces a structured per-section
//      block list (paragraphs / bullets / key-value pairs / tables) using
//      a *single* set of section renderers (e.g. Company Profile pulled
//      from `firm_profile`, Pricing as a table, Compliance as a table).
//   3. `renderProposalHtml(input)` — projects those blocks into the
//      hosted HTML deliverable (sticky TOC, scroll-snap, watermark,
//      print stylesheet, fixed recipient/version header).
//
// PDF and DOCX exports in `proposal-docs.ts` walk the *same* block list,
// so they cannot drift from what a recipient sees in Salon.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Navy-wordmark Cognirise logo for the light/printed proposal surfaces
 *  (HTML cover, PDF cover, DOCX header). Loaded once from the sibling
 *  atelier artifact's public assets; resolves relative to the bundled
 *  output (artifacts/api-server/dist) so it survives the esbuild build.
 *  Falls back to null (text-only header) if the asset can't be read. */
export const COGNIRISE_PROPOSAL_LOGO: Buffer | null = (() => {
  try {
    return readFileSync(
      fileURLToPath(
        new URL("../../atelier/public/cognirise-logo-light.png", import.meta.url),
      ),
    );
  } catch {
    return null;
  }
})();

const COGNIRISE_PROPOSAL_LOGO_DATA_URI: string | null = COGNIRISE_PROPOSAL_LOGO
  ? `data:image/png;base64,${COGNIRISE_PROPOSAL_LOGO.toString("base64")}`
  : null;

export interface ProposalSpineEntry {
  /** Stable section key persisted in atelier_proposal_sections.section_id. */
  id: string;
  /** Display name. */
  name: string;
  /** Owner agent (mock-first; real Composer may overwrite). */
  ownerAgent: string;
  /** Whether the section is required by default in a fresh compose. */
  defaultRequired: boolean;
  /** Whether this section is rendered on the cover (no TOC entry). */
  cover?: boolean;
}

export const PROPOSAL_SPINE: ProposalSpineEntry[] = [
  { id: "cover",          name: "Cover",                ownerAgent: "brand_profile_writer", defaultRequired: true, cover: true },
  { id: "exec_summary",   name: "Executive Summary",    ownerAgent: "context_writer",       defaultRequired: true },
  { id: "context",        name: "Context",              ownerAgent: "context_writer",       defaultRequired: true },
  { id: "hypothesis",     name: "Hypothesis",           ownerAgent: "context_writer",       defaultRequired: true },
  { id: "approach",       name: "Approach",             ownerAgent: "approach_writer",      defaultRequired: true },
  { id: "workplan",       name: "Workplan",             ownerAgent: "workplan_writer",      defaultRequired: true },
  { id: "team",           name: "Team",                 ownerAgent: "team_bios_writer",     defaultRequired: true },
  { id: "pricing",        name: "Pricing",              ownerAgent: "pricing_analyst",      defaultRequired: true },
  { id: "case_studies",   name: "Case Studies",         ownerAgent: "case_study_picker",    defaultRequired: true },
  { id: "company_profile",name: "Company Profile",      ownerAgent: "brand_profile_writer", defaultRequired: true },
  { id: "value_case",     name: "Value Case",           ownerAgent: "approach_writer",      defaultRequired: true },
  { id: "terms",          name: "Terms & Risk",         ownerAgent: "terms_risk_writer",    defaultRequired: true },
  { id: "compliance",     name: "Compliance",           ownerAgent: "compliance_reviewer",  defaultRequired: true },
  { id: "annexes",        name: "Annexes",              ownerAgent: "context_writer",       defaultRequired: true },
  { id: "appendices",     name: "Appendices",           ownerAgent: "context_writer",       defaultRequired: true },
];

export const DEFAULT_SECTIONS_REQUIRED: string[] = PROPOSAL_SPINE
  .filter((s) => s.defaultRequired)
  .map((s) => s.id);

/**
 * Idempotent mapping from the legacy 8-section proposals to the 15-section
 * spine. Used by the spine backfill script (Task #297 step 3).
 *
 * Old id → new id (every old key maps to itself; this table also exposes
 * the *new* keys that need to be inserted alongside them when we backfill
 * a proposal that was authored under the 8-section regime).
 */
export const LEGACY_TO_SPINE_MAP: Record<string, string> = {
  context: "context",
  approach: "approach",
  workplan: "workplan",
  team: "team",
  pricing: "pricing",
  case_studies: "case_studies",
  terms: "terms",
  compliance: "compliance",
};

/** Section ids added by the 15-section spine that must be backfilled. */
export const SPINE_ADDED_SECTIONS: string[] = PROPOSAL_SPINE
  .map((s) => s.id)
  .filter((id) => !(id in LEGACY_TO_SPINE_MAP));

export interface FirmProfileLite {
  firmName: string;
  tagline?: string;
  missionStatement?: string;
  boilerplateShort?: string;
  boilerplateLong?: string;
  capabilitiesPitch?: string;
  differentiators?: string[];
  proofPoints?: Array<{ label: string; metric: string }>;
  legalEntities?: Array<{ name: string; jurisdiction: string }>;
  contactBlock?: string;
  voiceAttributes?: string[];
  principles?: Array<{ name: string; description: string }>;
  brandColors?: { primary?: string; ink?: string; gold?: string };
}

export interface ProposalSectionLite {
  sectionId: string;
  name: string;
  ownerAgent: string;
  status: string;
  content: string | null;
}

export interface RecipientLite {
  recipientName: string;
  recipientEmail?: string | null;
  recipientOrg?: string | null;
}

export interface RenderProposalHtmlInput {
  proposalId: string;
  title: string;
  winThemes: string[];
  sections: ProposalSectionLite[];
  pricingModel?: { totalRevenueUsd?: number; totalCostUsd?: number; marginPct?: number; verdict?: string } | null;
  complianceMatrix?: Array<{ rfpReqId: string; requirement: string; status: string; evidence: string }>;
  firmProfile: FirmProfileLite | null;
  recipient?: RecipientLite | null;
  /** Proposal version (drives the fixed header label). Defaults to 1. */
  version?: number;
  /** ISO timestamp; defaults to now. */
  generatedAt?: string;
}

/** Order sections according to the canonical spine; unknown keys preserve their relative order at the end. */
export function orderSectionsBySpine(sections: ProposalSectionLite[]): ProposalSectionLite[] {
  const idx = new Map(PROPOSAL_SPINE.map((s, i) => [s.id, i]));
  return [...sections].sort((a, b) => {
    const ai = idx.get(a.sectionId) ?? 999 + sections.indexOf(a);
    const bi = idx.get(b.sectionId) ?? 999 + sections.indexOf(b);
    return ai - bi;
  });
}

// =============================================================
// Shared block model — the canonical intermediate representation
// consumed by HTML / PDF / DOCX renderers.
// =============================================================

export type ProposalBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 3 | 4; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "kv"; rows: Array<{ label: string; value: string }> }
  | {
      kind: "table";
      headers?: string[];
      /** Each row is an array of plain-text cells (no inline HTML). */
      rows: string[][];
      /** Optional status column index — drives PDF/DOCX colour. */
      statusColIndex?: number;
    };

export interface ProposalSectionBlock {
  sectionId: string;
  name: string;
  ownerAgent: string;
  status: string;
  /** True if this is the cover (rendered specially in HTML). */
  isCover: boolean;
  blocks: ProposalBlock[];
}

function paragraphBlocks(text: string | null | undefined): ProposalBlock[] {
  if (!text) return [{ kind: "paragraph", text: "(no content)" }];
  return text.split(/\n{2,}/).map((p) => ({ kind: "paragraph" as const, text: p.trim() }));
}

function fmtUsd(n: number | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString()}`;
}

function buildCompanyProfileBlocks(profile: FirmProfileLite | null): ProposalBlock[] {
  if (!profile) {
    return [{ kind: "paragraph", text: "Company profile not yet published. Run the Brand Profile Writer to seed it." }];
  }
  const out: ProposalBlock[] = [];
  out.push({ kind: "heading", level: 3, text: `About ${profile.firmName}` });
  const aboutText = profile.boilerplateLong ?? profile.boilerplateShort ?? profile.missionStatement ?? "";
  if (aboutText) out.push(...paragraphBlocks(aboutText));
  if (profile.capabilitiesPitch) {
    out.push({ kind: "heading", level: 4, text: "Capabilities" });
    out.push(...paragraphBlocks(profile.capabilitiesPitch));
  }
  if (profile.differentiators?.length) {
    out.push({ kind: "heading", level: 4, text: "Differentiators" });
    out.push({ kind: "bullets", items: profile.differentiators });
  }
  if (profile.proofPoints?.length) {
    out.push({ kind: "heading", level: 4, text: "Proof points" });
    out.push({ kind: "bullets", items: profile.proofPoints.map((p) => `${p.label} — ${p.metric}`) });
  }
  if (profile.principles?.length) {
    out.push({ kind: "heading", level: 4, text: "Principles" });
    out.push({ kind: "bullets", items: profile.principles.map((p) => `${p.name}. ${p.description}`) });
  }
  if (profile.legalEntities?.length) {
    out.push({ kind: "heading", level: 4, text: "Legal entities" });
    out.push({ kind: "bullets", items: profile.legalEntities.map((e) => `${e.name} (${e.jurisdiction})`) });
  }
  if (profile.contactBlock) {
    out.push({ kind: "heading", level: 4, text: "Contact" });
    out.push(...paragraphBlocks(profile.contactBlock));
  }
  return out;
}

function buildPricingBlocks(input: RenderProposalHtmlInput, content: string | null): ProposalBlock[] {
  const out: ProposalBlock[] = [];
  if (content) out.push(...paragraphBlocks(content));
  const p = input.pricingModel;
  if (!p) {
    out.push({ kind: "paragraph", text: "Pricing model not computed." });
    return out;
  }
  out.push({
    kind: "kv",
    rows: [
      { label: "Revenue", value: fmtUsd(p.totalRevenueUsd) },
      { label: "Cost", value: fmtUsd(p.totalCostUsd) },
      { label: "Margin", value: `${p.marginPct ?? 0}%` },
      { label: "Verdict", value: p.verdict ?? "n/a" },
    ],
  });
  return out;
}

function buildComplianceBlocks(input: RenderProposalHtmlInput, content: string | null): ProposalBlock[] {
  const out: ProposalBlock[] = [];
  if (content) out.push(...paragraphBlocks(content));
  const m = input.complianceMatrix ?? [];
  if (m.length === 0) {
    out.push({ kind: "paragraph", text: "No compliance matrix attached." });
    return out;
  }
  out.push({
    kind: "table",
    headers: ["Status", "Req", "Requirement", "Evidence"],
    rows: m.map((r) => [r.status, r.rfpReqId, r.requirement, r.evidence]),
    statusColIndex: 0,
  });
  return out;
}

function buildCoverBlocks(input: RenderProposalHtmlInput, profile: FirmProfileLite | null): ProposalBlock[] {
  const tagline = profile?.tagline ?? "Senior-overseen agentic operations";
  const date = new Date(input.generatedAt ?? new Date().toISOString()).toLocaleDateString();
  const out: ProposalBlock[] = [
    { kind: "paragraph", text: profile?.firmName ?? "Cognirise" },
    { kind: "paragraph", text: tagline },
    { kind: "heading", level: 3, text: input.title },
  ];
  if (input.recipient) {
    const orgPart = input.recipient.recipientOrg ? ` · ${input.recipient.recipientOrg}` : "";
    out.push({ kind: "paragraph", text: `Prepared for ${input.recipient.recipientName}${orgPart}` });
  }
  out.push({ kind: "paragraph", text: `${date} — v${input.version ?? 1}` });
  return out;
}

/**
 * Build the canonical block list for a proposal. This is the *only*
 * place where section-specific business logic (Company Profile from
 * `firm_profile`, pricing/compliance tables) lives.
 */
export function buildProposalBlocks(input: RenderProposalHtmlInput): ProposalSectionBlock[] {
  const profile = input.firmProfile;
  return orderSectionsBySpine(input.sections).map((s) => {
    const isCover = s.sectionId === "cover";
    let blocks: ProposalBlock[];
    if (isCover) blocks = buildCoverBlocks(input, profile);
    else if (s.sectionId === "company_profile") blocks = buildCompanyProfileBlocks(profile);
    else if (s.sectionId === "pricing") blocks = buildPricingBlocks(input, s.content);
    else if (s.sectionId === "compliance") blocks = buildComplianceBlocks(input, s.content);
    else blocks = paragraphBlocks(s.content);
    return {
      sectionId: s.sectionId,
      name: s.name,
      ownerAgent: s.ownerAgent,
      status: s.status,
      isCover,
      blocks,
    };
  });
}

// =============================================================
// HTML projection of the block model.
// =============================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBlockHtml(b: ProposalBlock): string {
  switch (b.kind) {
    case "paragraph":
      return `<p>${escapeHtml(b.text).replace(/\n/g, "<br/>")}</p>`;
    case "heading":
      return `<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`;
    case "bullets":
      return `<ul class="bullets">${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    case "kv":
      return `<table class="pricing-table"><tbody>${b.rows
        .map((r) => `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`)
        .join("")}</tbody></table>`;
    case "table": {
      const head = b.headers
        ? `<thead><tr>${b.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`
        : "";
      const rows = b.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, i) => {
                if (i === b.statusColIndex) {
                  return `<td><span class="dot dot-${escapeHtml(cell)}"></span> ${escapeHtml(cell)}</td>`;
                }
                return `<td>${escapeHtml(cell)}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("");
      return `<table class="compliance-table">${head}<tbody>${rows}</tbody></table>`;
    }
  }
}

function renderCoverHtml(section: ProposalSectionBlock, profile: FirmProfileLite | null): string {
  const [brand, tagline, titleHeading, ...rest] = section.blocks;
  const title = titleHeading && titleHeading.kind === "heading" ? titleHeading.text : "";
  const recipientPara = rest.find((b) => b.kind === "paragraph" && (b as { text: string }).text.startsWith("Prepared for"));
  const meta = rest.find((b) => b !== recipientPara);
  const logoHtml = COGNIRISE_PROPOSAL_LOGO_DATA_URI
    ? `<img class="cover-logo" src="${COGNIRISE_PROPOSAL_LOGO_DATA_URI}" alt="Cognirise" />`
    : "";
  return `
    <section class="cover snap" id="sec-cover" aria-label="Cover">
      <div class="cover-inner">
        ${logoHtml}
        <div class="brand">${escapeHtml(brand && brand.kind === "paragraph" ? brand.text : (profile?.firmName ?? "Cognirise"))}</div>
        <div class="cover-tagline">${escapeHtml(tagline && tagline.kind === "paragraph" ? tagline.text : "")}</div>
        <h1 class="cover-title">${escapeHtml(title)}</h1>
        ${recipientPara && recipientPara.kind === "paragraph" ? `<div class="recipient-line">${escapeHtml(recipientPara.text)}</div>` : ""}
        <div class="cover-meta">${escapeHtml(meta && meta.kind === "paragraph" ? meta.text : "")}</div>
      </div>
    </section>
  `;
}

export function renderProposalHtml(input: RenderProposalHtmlInput): string {
  const profile = input.firmProfile;
  const blocks = buildProposalBlocks(input);
  const cover = blocks.find((b) => b.isCover);
  const body = blocks.filter((b) => !b.isCover);
  const version = input.version ?? 1;

  const tocHtml = body
    .map(
      (s) => `<li><a href="#sec-${escapeHtml(s.sectionId)}" data-target="sec-${escapeHtml(s.sectionId)}">
        <span class="toc-dot toc-dot-${escapeHtml(s.status)}"></span>${escapeHtml(s.name)}
      </a></li>`,
    )
    .join("");

  const sectionsHtml = body
    .map((s) => {
      const profileGrid = s.sectionId === "company_profile";
      const inner = s.blocks.map(renderBlockHtml).join("");
      return `
        <section class="proposal-section snap" id="sec-${escapeHtml(s.sectionId)}" aria-labelledby="h-${escapeHtml(s.sectionId)}">
          <header class="section-header">
            <div class="section-eyebrow">${escapeHtml(s.sectionId)}</div>
            <h2 id="h-${escapeHtml(s.sectionId)}">${escapeHtml(s.name)}</h2>
            <div class="section-meta">owner · ${escapeHtml(s.ownerAgent)} <span class="status-pill s-${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></div>
          </header>
          <div class="section-body ${profileGrid ? "profile-flow" : ""}">${inner}</div>
        </section>
      `;
    })
    .join("");

  const watermarkText = input.recipient
    ? `Confidential — ${input.recipient.recipientName}${input.recipient.recipientOrg ? " · " + input.recipient.recipientOrg : ""}`
    : "Confidential — Draft preview";
  const headerRecipient = input.recipient
    ? `${input.recipient.recipientName}${input.recipient.recipientOrg ? " · " + input.recipient.recipientOrg : ""}`
    : "Draft preview";

  const colors = profile?.brandColors ?? {};
  const primary = colors.primary ?? "#0f172a";
  const ink = colors.ink ?? "#0f172a";
  const gold = colors.gold ?? "#b8852b";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
  :root { --primary: ${primary}; --ink: ${ink}; --gold: ${gold}; --soft: #f4f1ea; --rule: #e6e1d4; --mute: #6b6358; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fbfaf6; color: var(--ink);
    font-family: ui-serif, Georgia, "Times New Roman", serif; line-height: 1.55; }
  .layout { display: grid; grid-template-columns: 240px 1fr; gap: 0; min-height: 100vh; }
  /* Fixed header (Task #297) — recipient + version always visible. */
  header.fixed-bar { position: sticky; top: 0; z-index: 5; grid-column: 1 / -1;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 18px; background: white; border-bottom: 1px solid var(--rule);
    font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--mute); }
  header.fixed-bar .h-title { color: var(--primary); font-weight: 600; letter-spacing: 0.02em; }
  header.fixed-bar .h-meta { display: flex; gap: 16px; align-items: center; }
  header.fixed-bar .h-pill { padding: 2px 8px; border: 1px solid var(--rule); border-radius: 999px;
    text-transform: uppercase; letter-spacing: 0.1em; font-size: 10px; color: var(--gold); }
  nav.toc { position: sticky; top: 38px; align-self: start; height: calc(100vh - 38px); padding: 28px 18px;
    background: var(--soft); border-right: 1px solid var(--rule); overflow-y: auto;
    font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; }
  nav.toc .brand { font-weight: 600; letter-spacing: 0.04em; color: var(--gold);
    text-transform: uppercase; font-size: 11px; margin-bottom: 18px; }
  nav.toc ol { list-style: none; counter-reset: toc; padding: 0; margin: 0; }
  nav.toc li { counter-increment: toc; margin: 4px 0; }
  nav.toc li a { color: var(--ink); text-decoration: none; display: flex; gap: 8px; align-items: center;
    padding: 6px 8px; border-radius: 4px; }
  nav.toc li a::before { content: counter(toc, decimal-leading-zero);
    color: var(--mute); font-variant-numeric: tabular-nums; min-width: 22px; }
  nav.toc li a:hover, nav.toc li a.active { background: white; color: var(--primary); }
  .toc-dot { width: 6px; height: 6px; border-radius: 50%; background: #c4bfb1; display: inline-block; }
  .toc-dot-green, .toc-dot-approved { background: #2f9e6d; }
  .toc-dot-amber { background: #c89b2a; }
  .toc-dot-red, .toc-dot-rejected { background: #c34d4d; }
  main.body { scroll-snap-type: y proximity; overflow-y: auto; height: calc(100vh - 38px); }
  section.snap { scroll-snap-align: start; min-height: calc(100vh - 38px); padding: 60px 8% 80px;
    border-bottom: 1px solid var(--rule); position: relative; }
  section.cover { background: linear-gradient(180deg, #fbfaf6 0%, var(--soft) 100%); }
  .cover-inner { max-width: 720px; margin: 0 auto; padding-top: 60px; }
  .cover-logo { display: block; height: 44px; width: auto; margin-bottom: 36px; }
  .cover .brand { font-family: ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.18em;
    text-transform: uppercase; font-size: 11px; color: var(--gold); margin-bottom: 32px; }
  .cover-tagline { font-style: italic; color: var(--mute); margin-bottom: 16px; }
  .cover-title { font-size: 44px; line-height: 1.1; margin: 0 0 24px; color: var(--primary); }
  .cover .recipient-line { font-size: 16px; color: var(--ink); }
  .cover-meta { margin-top: 36px; font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute); }
  .section-eyebrow { font-family: ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.16em;
    text-transform: uppercase; font-size: 10px; color: var(--gold); margin-bottom: 8px; }
  .section-header h2 { font-size: 32px; margin: 0 0 8px; color: var(--primary); }
  .section-meta { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; color: var(--mute);
    margin-bottom: 28px; display: flex; gap: 12px; align-items: center; }
  .status-pill { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--rule);
    text-transform: uppercase; letter-spacing: 0.1em; font-size: 9.5px; }
  .status-pill.s-green, .status-pill.s-approved { color: #2f9e6d; border-color: #b9dec9; }
  .status-pill.s-amber { color: #b07a14; border-color: #ecd9a4; }
  .status-pill.s-red, .status-pill.s-rejected { color: #b94646; border-color: #ecbcbc; }
  .section-body { font-size: 16px; max-width: 820px; }
  .section-body p { margin: 0 0 14px; }
  .profile-flow h3, .profile-flow h4 { color: var(--primary); margin: 18px 0 8px; }
  .profile-flow h4 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em;
    font-family: ui-sans-serif, system-ui, sans-serif; color: var(--mute); }
  .bullets { padding-left: 20px; margin: 0 0 8px; }
  .bullets li { margin-bottom: 6px; }
  .pricing-table, .compliance-table { width: 100%; border-collapse: collapse; margin-top: 12px;
    font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
  .pricing-table th { width: 130px; text-align: left; padding: 8px 10px; color: var(--mute);
    font-weight: 500; border-bottom: 1px solid var(--rule); }
  .pricing-table td { padding: 8px 10px; border-bottom: 1px solid var(--rule); }
  .compliance-table th { padding: 8px 10px; background: var(--soft); text-align: left;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--mute); border-bottom: 1px solid var(--rule); }
  .compliance-table td { padding: 8px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .dot-green { background: #2f9e6d; } .dot-amber { background: #c89b2a; } .dot-red { background: #c34d4d; }
  .watermark { position: fixed; inset: 0; pointer-events: none; z-index: 1;
    background-image: repeating-linear-gradient(-30deg, transparent 0 220px, rgba(184,133,43,0.07) 220px 360px); }
  .watermark::after { content: attr(data-text); position: fixed; bottom: 16px; right: 24px;
    font-family: ui-sans-serif, system-ui, sans-serif; font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(15,23,42,0.55); background: rgba(255,255,255,0.7);
    padding: 4px 10px; border: 1px solid var(--rule); border-radius: 4px; }
  @media (max-width: 760px) {
    .layout { grid-template-columns: 1fr; }
    nav.toc { position: static; height: auto; }
    main.body { height: auto; }
  }
  @media print {
    .layout { grid-template-columns: 1fr; }
    nav.toc, .watermark, header.fixed-bar { display: none !important; }
    main.body { height: auto; overflow: visible; }
    section.snap { min-height: 0; page-break-inside: avoid; page-break-after: always;
      padding: 24px 32px; border-bottom: 0; }
    section.cover { page-break-after: always; }
    .cover-title { font-size: 32px; }
    body { background: white; }
  }
</style>
</head>
<body>
<div class="watermark" data-text="${escapeHtml(watermarkText)}" aria-hidden="true"></div>
<header class="fixed-bar" data-testid="proposal-fixed-header">
  <div class="h-title">${escapeHtml(input.title)}</div>
  <div class="h-meta">
    <span data-testid="header-recipient">Recipient: <strong>${escapeHtml(headerRecipient)}</strong></span>
    <span class="h-pill" data-testid="header-version">v${escapeHtml(String(version))}</span>
  </div>
</header>
<div class="layout">
  <nav class="toc" aria-label="Table of contents">
    <div class="brand">${escapeHtml(profile?.firmName ?? "Cognirise")} · Proposal</div>
    <ol>${tocHtml}</ol>
  </nav>
  <main class="body" id="proposal-main">
    ${cover ? renderCoverHtml(cover, profile) : ""}
    ${sectionsHtml}
  </main>
</div>
<script>
  // TOC active-link highlighter via IntersectionObserver — matches the
  // section currently in the snap viewport.
  (function () {
    var links = document.querySelectorAll('nav.toc a');
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('data-target')] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (a) { a.classList.remove('active'); });
          var a = byId[e.target.id];
          if (a) a.classList.add('active');
        }
      });
    }, { root: document.getElementById('proposal-main'), threshold: 0.4 });
    document.querySelectorAll('section.snap').forEach(function (s) { io.observe(s); });
  })();
</script>
</body>
</html>`;
}
