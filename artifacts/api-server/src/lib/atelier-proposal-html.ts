// Task #297 — Canonical 15-section proposal spine + HTML renderer.
// One source of truth: this module's `PROPOSAL_SPINE` is consumed by
// the Salon hosting route, the live-preview tab, AND the PDF/DOCX
// exports. The HTML is the primary deliverable; PDF/DOCX are derived
// projections of the same section list.

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(text: string): string {
  const parts = text.split(/\n{2,}/);
  return parts
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function renderCover(input: RenderProposalHtmlInput, profile: FirmProfileLite | null): string {
  const tagline = profile?.tagline ?? "Senior-overseen agentic operations";
  const recipientLine = input.recipient
    ? `<div class="recipient-line">Prepared for <strong>${escapeHtml(input.recipient.recipientName)}</strong>${
        input.recipient.recipientOrg ? ` · ${escapeHtml(input.recipient.recipientOrg)}` : ""
      }</div>`
    : "";
  return `
    <section class="cover snap" id="cover" aria-label="Cover">
      <div class="cover-inner">
        <div class="brand">${escapeHtml(profile?.firmName ?? "AICo")}</div>
        <div class="cover-tagline">${escapeHtml(tagline)}</div>
        <h1 class="cover-title">${escapeHtml(input.title)}</h1>
        ${recipientLine}
        <div class="cover-meta">${new Date(input.generatedAt ?? new Date().toISOString()).toLocaleDateString()}</div>
      </div>
    </section>
  `;
}

function renderCompanyProfile(profile: FirmProfileLite | null): string {
  if (!profile) return `<p><em>Company profile not yet published. Run the Brand Profile Writer to seed it.</em></p>`;
  const principlesHtml = (profile.principles ?? [])
    .map((p) => `<li><strong>${escapeHtml(p.name)}.</strong> ${escapeHtml(p.description)}</li>`)
    .join("");
  const proofHtml = (profile.proofPoints ?? [])
    .map((p) => `<li><span class="proof-label">${escapeHtml(p.label)}</span> — <span class="proof-metric">${escapeHtml(p.metric)}</span></li>`)
    .join("");
  const diffsHtml = (profile.differentiators ?? [])
    .map((d) => `<li>${escapeHtml(d)}</li>`)
    .join("");
  const entitiesHtml = (profile.legalEntities ?? [])
    .map((e) => `<li>${escapeHtml(e.name)} <span class="entity-juris">(${escapeHtml(e.jurisdiction)})</span></li>`)
    .join("");
  return `
    <div class="profile-grid">
      <div>
        <h3>About ${escapeHtml(profile.firmName)}</h3>
        ${paragraphs(profile.boilerplateLong ?? profile.boilerplateShort ?? profile.missionStatement ?? "")}
        ${profile.capabilitiesPitch ? `<h4>Capabilities</h4>${paragraphs(profile.capabilitiesPitch)}` : ""}
      </div>
      <div>
        ${diffsHtml ? `<h4>Differentiators</h4><ul class="bullets">${diffsHtml}</ul>` : ""}
        ${proofHtml ? `<h4>Proof points</h4><ul class="bullets">${proofHtml}</ul>` : ""}
        ${principlesHtml ? `<h4>Principles</h4><ul class="bullets">${principlesHtml}</ul>` : ""}
        ${entitiesHtml ? `<h4>Legal entities</h4><ul class="bullets">${entitiesHtml}</ul>` : ""}
        ${profile.contactBlock ? `<h4>Contact</h4>${paragraphs(profile.contactBlock)}` : ""}
      </div>
    </div>
  `;
}

function renderPricingSection(input: RenderProposalHtmlInput): string {
  const p = input.pricingModel;
  if (!p) return `<p><em>Pricing model not computed.</em></p>`;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return `
    <table class="pricing-table">
      <tbody>
        <tr><th>Revenue</th><td>${fmt(p.totalRevenueUsd ?? 0)}</td></tr>
        <tr><th>Cost</th><td>${fmt(p.totalCostUsd ?? 0)}</td></tr>
        <tr><th>Margin</th><td>${p.marginPct ?? 0}%</td></tr>
        <tr><th>Verdict</th><td><span class="verdict v-${escapeHtml(p.verdict ?? "n/a")}">${escapeHtml(p.verdict ?? "n/a")}</span></td></tr>
      </tbody>
    </table>
  `;
}

function renderComplianceSection(input: RenderProposalHtmlInput): string {
  const m = input.complianceMatrix ?? [];
  if (m.length === 0) return `<p><em>No compliance matrix attached.</em></p>`;
  const rows = m
    .map(
      (r) => `
        <tr>
          <td><span class="dot dot-${escapeHtml(r.status)}"></span> ${escapeHtml(r.status)}</td>
          <td class="mono">${escapeHtml(r.rfpReqId)}</td>
          <td>${escapeHtml(r.requirement)}</td>
          <td class="evidence">${escapeHtml(r.evidence)}</td>
        </tr>
      `,
    )
    .join("");
  return `
    <table class="compliance-table">
      <thead><tr><th>Status</th><th>Req</th><th>Requirement</th><th>Evidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderSectionBody(
  section: ProposalSectionLite,
  input: RenderProposalHtmlInput,
  profile: FirmProfileLite | null,
): string {
  switch (section.sectionId) {
    case "company_profile":
      return renderCompanyProfile(profile);
    case "pricing":
      return [paragraphs(section.content ?? ""), renderPricingSection(input)].join("");
    case "compliance":
      return [paragraphs(section.content ?? ""), renderComplianceSection(input)].join("");
    default:
      return paragraphs(section.content ?? "(no content)");
  }
}

export function renderProposalHtml(input: RenderProposalHtmlInput): string {
  const profile = input.firmProfile;
  const orderedAll = orderSectionsBySpine(input.sections);
  const cover = orderedAll.find((s) => s.sectionId === "cover");
  const body = orderedAll.filter((s) => s.sectionId !== "cover");

  const tocHtml = body
    .map(
      (s) => `<li><a href="#sec-${escapeHtml(s.sectionId)}" data-target="sec-${escapeHtml(s.sectionId)}">
        <span class="toc-dot toc-dot-${escapeHtml(s.status)}"></span>${escapeHtml(s.name)}
      </a></li>`,
    )
    .join("");

  const sectionsHtml = body
    .map(
      (s) => `
        <section class="proposal-section snap" id="sec-${escapeHtml(s.sectionId)}" aria-labelledby="h-${escapeHtml(s.sectionId)}">
          <header class="section-header">
            <div class="section-eyebrow">${escapeHtml(s.sectionId)}</div>
            <h2 id="h-${escapeHtml(s.sectionId)}">${escapeHtml(s.name)}</h2>
            <div class="section-meta">owner · ${escapeHtml(s.ownerAgent)} <span class="status-pill s-${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></div>
          </header>
          <div class="section-body">${renderSectionBody(s, input, profile)}</div>
        </section>
      `,
    )
    .join("");

  const watermarkText = input.recipient
    ? `Confidential — ${input.recipient.recipientName}${input.recipient.recipientOrg ? " · " + input.recipient.recipientOrg : ""}`
    : "Confidential — Draft preview";

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
  nav.toc { position: sticky; top: 0; align-self: start; height: 100vh; padding: 28px 18px;
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
  main.body { scroll-snap-type: y proximity; overflow-y: auto; height: 100vh; }
  section.snap { scroll-snap-align: start; min-height: 100vh; padding: 80px 8% 80px;
    border-bottom: 1px solid var(--rule); position: relative; }
  section.cover { background: linear-gradient(180deg, #fbfaf6 0%, var(--soft) 100%); }
  .cover-inner { max-width: 720px; margin: 0 auto; padding-top: 80px; }
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
  .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .profile-grid h3, .profile-grid h4 { color: var(--primary); margin: 0 0 8px; }
  .profile-grid h4 { margin-top: 18px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em;
    font-family: ui-sans-serif, system-ui, sans-serif; color: var(--mute); }
  .bullets { padding-left: 20px; margin: 0 0 8px; }
  .bullets li { margin-bottom: 6px; }
  .proof-label { font-weight: 600; }
  .proof-metric { color: var(--gold); }
  .entity-juris { color: var(--mute); font-size: 13px; }
  .pricing-table, .compliance-table { width: 100%; border-collapse: collapse; margin-top: 12px;
    font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
  .pricing-table th { width: 130px; text-align: left; padding: 8px 10px; color: var(--mute);
    font-weight: 500; border-bottom: 1px solid var(--rule); }
  .pricing-table td { padding: 8px 10px; border-bottom: 1px solid var(--rule); }
  .compliance-table th { padding: 8px 10px; background: var(--soft); text-align: left;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--mute); border-bottom: 1px solid var(--rule); }
  .compliance-table td { padding: 8px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .compliance-table .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--mute); }
  .compliance-table .evidence { color: var(--mute); }
  .verdict { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--rule); font-size: 12px; }
  .verdict.v-green { color: #2f9e6d; border-color: #b9dec9; }
  .verdict.v-amber { color: #b07a14; border-color: #ecd9a4; }
  .verdict.v-red, .verdict.v-partner_override_required { color: #b94646; border-color: #ecbcbc; }
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
    .profile-grid { grid-template-columns: 1fr; }
  }
  @media print {
    .layout { grid-template-columns: 1fr; }
    nav.toc, .watermark { display: none !important; }
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
<div class="layout">
  <nav class="toc" aria-label="Table of contents">
    <div class="brand">${escapeHtml(profile?.firmName ?? "AICo")} · Proposal</div>
    <ol>${tocHtml}</ol>
  </nav>
  <main class="body" id="proposal-main">
    ${cover ? renderCover(input, profile) : ""}
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
