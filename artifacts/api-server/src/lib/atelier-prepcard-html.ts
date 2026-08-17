// ============================================================
import { distillBriefView } from "./atelier-brief-view.js";
// Task #589 — Self-contained first-meeting prep card (HTML).
// ------------------------------------------------------------
// renderPrepCardHtml(input) projects the Account Cartographer's
// 4-step research (Client Present Brief, Origination Hypothesis,
// Stress-Test, deep person profiles) into a single, self-contained
// HTML document a Partner can download and walk into a first
// meeting with. No external CSS/JS — everything is inlined, so the
// file works fully offline (Task #1188: the old Brandfetch CDN logo
// guess is gone — it served Brandfetch's own wordmark on a missed
// guess. The header now renders the account name in brand type, with
// an optional real client logo only when the caller actually has one).
//
// Branding mirrors the shared Cognirise PDF brand kit
// (atelier-pdf-brand.ts): navy + magenta palette, the signature
// blue→purple→magenta→coral gradient rule, Inter body + Comfortaa heading type,
// and a "Prepared by Riser" byline (the assistant, never the
// requesting user).
//
// The 9 sections follow the account-research skill's prep-card spec:
//   1. Header with client wordmark (+ Cognirise wordmark)
//   2. Account snapshot
//   3. Group / business-unit structure (visual map)
//   4. What's changing right now
//   5. Their pressure
//   6. Person profile — who you're meeting
//   7. Our angle
//   8. Priority project areas (with service-line tags + deal size)
//   9. Watch-outs
// ============================================================

const COGNIRISE_TAGLINE = "Intelligence that Elevates.";

// Distinct accent colors for the business-unit map cards, cycled by index so
// each division reads as its own block at a glance. Cognirise brand rules:
// no amber/golden hues — lead with the magenta family, keep the rest cool.
const BU_ACCENTS = ["#A6348F", "#3B82C4", "#2E7D5B", "#8A5BD6", "#FF7B5A", "#11808F"];

// Typical first-mandate deal-size ranges per Cognirise service line.
// Mirrors the table in prompts/account_cartographer/v1.md — kept here so
// the prep card can annotate each service-line-fit row without a round-trip.
const SERVICE_LINE_META: Record<string, { name: string; dealSize: string }> = {
  SL01: { name: "Agentic Enterprise Transformation", dealSize: "$500K – $3M+" },
  SL02: { name: "Data & AI Foundations", dealSize: "$300K – $2M" },
  SL03: { name: "Engineering with AI", dealSize: "$200K – $1.5M" },
  SL04: { name: "Sovereign Agentic AI", dealSize: "$500K – $5M+" },
  SL05: { name: "Platforms", dealSize: "$100K – $1M+" },
};

export interface PrepCardContact {
  fullName: string;
  title?: string | null;
  seniority?: string | null;
  buyerPersona?: string | null;
  disposition?: string | null;
  rationale?: string | null;
  notes?: string | null;
  sourceUrl?: string | null;
  confidence?: string | null;
  timeInRole?: string | null;
  careerHistory?: Array<{
    role: string;
    company: string;
    period?: string | null;
    highlight?: string | null;
  }>;
  education?: Array<{
    institution: string;
    programme?: string | null;
    year?: string | null;
  }>;
}

export interface PrepCardResearchBrief {
  whatsChanging?: Array<{ text: string; evidence?: string; sourceUrls?: string[] }>;
  executiveTensions?: Array<{ text: string; evidence?: string; sourceUrls?: string[] }>;
  serviceLineFit?: Array<{ serviceLine: string; signal: string; sourceUrls?: string[] }>;
  partnerEcosystem?: Array<{
    partner: string;
    relationship: string;
    serviceLineGap?: string | null;
    sourceUrls?: string[];
  }>;
  businessUnits?: Array<{ name: string; brands?: string[]; note?: string | null }>;
  mandateAngles?: Array<{
    title: string;
    serviceLines?: string[];
    tension: string;
    whyNow: string;
    entryStakeholder: string;
    sourceUrls?: string[];
  }>;
  whyNowHypothesis?: string;
  openQuestions?: string[];
  singleMostImportant?: string;
  stressTest?: {
    failureScenarios?: string[];
    assumptions?: {
      evidenced?: string[];
      untestedButLikely?: string[];
      uncertain?: string[];
    };
    likelyObjections?: string[];
    evidenceToStrengthen?: Array<{ evidence: string; whereToFind: string }>;
    revisedHypothesis?: string;
  } | null;
}

export interface RenderPrepCardInput {
  accountName: string;
  brandName?: string | null;
  sector: string;
  country: string;
  tier?: string | null;
  hqCity?: string | null;
  cogniriseHypothesis?: string | null;
  strategicPriorities?: string[];
  researchBrief: PrepCardResearchBrief | null;
  /** All decision-makers for the account (ordered by influence). */
  contacts: PrepCardContact[];
  /** When set, the named contact is spotlighted at the top of section 9. */
  focusContact?: PrepCardContact | null;
  /** A REAL client logo asset (https or data:image URI) — rendered only
   *  when provided; never guessed from the account name. */
  clientLogoUrl?: string | null;
  /** Suggested talking points keyed by the verbatim watch-out text
   *  (Task #1188). Watch-outs without an entry render without guidance. */
  watchOutAnswers?: Record<string, string>;
  generatedAt?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** Allowlist http(s) before emitting an href, so a persisted javascript:/data:
 *  URL (from a reviewed/manual payload) can never become a clickable script
 *  sink in the served card. Returns null for any non-http(s) scheme. */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  return u;
}

/** Only render a client logo we genuinely have: https URL or an inline
 *  data:image URI. No guessing, no third-party CDN lookups (Task #1188). */
function safeLogoSrc(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  if (/^https:\/\//i.test(u) || /^data:image\//i.test(u)) return u;
  return null;
}

function evidencePill(evidence?: string): string {
  if (!evidence) return "";
  const cls =
    evidence === "evidenced" ? "ev-evidenced" : evidence === "inferred" ? "ev-inferred" : "ev-hypothesis";
  return `<span class="ev ${cls}">${escapeHtml(evidence)}</span>`;
}

function sourceLinks(urls?: string[]): string {
  const list = (urls ?? [])
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((u) => safeHref(u))
    .filter((u): u is string => u !== null);
  if (list.length === 0) return "";
  return `<span class="srcs">${list
    .map((u, i) => `<a href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">[${i + 1}]</a>`)
    .join(" ")}</span>`;
}

function sectionShell(num: number, title: string, inner: string): string {
  return `
    <section class="card">
      <div class="card-num">${String(num).padStart(2, "0")}</div>
      <h2>${escapeHtml(title)}</h2>
      <div class="card-body">${inner}</div>
    </section>`;
}

function emptyNote(text: string): string {
  return `<p class="empty">${escapeHtml(text)}</p>`;
}

function renderContactProfile(c: PrepCardContact, spotlight: boolean): string {
  const meta = [c.title, c.seniority?.replace(/_/g, " "), c.buyerPersona]
    .filter((x) => x && String(x).trim().length > 0)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");
  const time = c.timeInRole ? `<div class="kv"><span>Time in role</span><b>${escapeHtml(c.timeInRole)}</b></div>` : "";
  const career = (c.careerHistory ?? []).filter((h) => (h.role || h.company));
  const edu = (c.education ?? []).filter((e) => e.institution);
  const careerHtml = career.length
    ? `<div class="profile-block"><div class="profile-label">Career history</div><ul>${career
        .map((h) => {
          const head = [h.role, h.company].filter(Boolean).map((x) => escapeHtml(String(x))).join(" — ");
          const period = h.period ? ` <span class="muted">(${escapeHtml(h.period)})</span>` : "";
          const hl = h.highlight ? `<div class="profile-hl">${escapeHtml(h.highlight)}</div>` : "";
          return `<li>${head}${period}${hl}</li>`;
        })
        .join("")}</ul></div>`
    : "";
  const eduHtml = edu.length
    ? `<div class="profile-block"><div class="profile-label">Education</div><ul>${edu
        .map((e) => {
          const head = escapeHtml(e.institution);
          const prog = e.programme ? ` — ${escapeHtml(e.programme)}` : "";
          const yr = e.year ? ` <span class="muted">(${escapeHtml(e.year)})</span>` : "";
          return `<li>${head}${prog}${yr}</li>`;
        })
        .join("")}</ul></div>`
    : "";
  const why = c.rationale ? `<p class="profile-why">${escapeHtml(c.rationale)}</p>` : "";
  const srcHref = c.sourceUrl ? safeHref(c.sourceUrl) : null;
  const src = srcHref
    ? `<a class="profile-src" href="${escapeAttr(srcHref)}" target="_blank" rel="noopener noreferrer">Source</a>`
    : "";
  const conf = c.confidence
    ? `<span class="ev ${c.confidence === "verified" ? "ev-evidenced" : "ev-inferred"}">${escapeHtml(c.confidence)}</span>`
    : "";
  return `
    <div class="person ${spotlight ? "person-spotlight" : ""}">
      <div class="person-head">
        <div>
          <div class="person-name">${escapeHtml(c.fullName)} ${conf}</div>
          ${meta ? `<div class="person-meta">${meta}</div>` : ""}
        </div>
        ${src}
      </div>
      ${time}
      ${why}
      ${careerHtml}
      ${eduHtml}
    </div>`;
}

export function renderPrepCardHtml(input: RenderPrepCardInput): string {
  const brand = input.brandName?.trim() || input.accountName;
  const rb = input.researchBrief ?? {};
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const dateLabel = new Date(generatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const logoUrl = safeLogoSrc(input.clientLogoUrl);

  // ---- Section 2: account snapshot (4 data points + a strategic-interest line) ----
  const facts = [
    ["Sector", input.sector],
    ["Country", input.country],
    input.hqCity ? ["HQ", input.hqCity] : null,
    input.tier ? ["Tier", input.tier] : null,
  ].filter(Boolean) as Array<[string, string]>;
  const single = rb.singleMostImportant?.trim() || input.cogniriseHypothesis?.trim() || "";
  const snapshotInner = `
    <div class="glance">${facts
      .map(([k, v]) => `<div class="glance-cell"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
      .join("")}</div>
    ${single ? `<div class="headline"><span class="headline-label">Why they're interesting right now</span>${escapeHtml(single)}</div>` : ""}`;

  // ---- Section 3: group / business-unit structure (visual map) ----
  const units = rb.businessUnits ?? [];
  const unitsInner = units.length
    ? `<div class="bu-grid">${units
        .map((u, i) => {
          const accent = BU_ACCENTS[i % BU_ACCENTS.length];
          const brands = (u.brands ?? []).filter((b) => b && b.trim().length > 0);
          const brandHtml = brands.length
            ? `<div class="bu-brands">${brands.map((b) => escapeHtml(b)).join(" · ")}</div>`
            : "";
          const note = u.note ? `<div class="bu-note">${escapeHtml(u.note)}</div>` : "";
          return `<div class="bu-card" style="border-top:3px solid ${accent}">
            <div class="bu-name">${escapeHtml(u.name)}</div>
            ${note}
            ${brandHtml}
          </div>`;
        })
        .join("")}</div>`
    : emptyNote("No business-unit map captured yet — re-run the Account Cartographer.");

  // ---- Section 4: what's changing right now (3 max) ----
  const changing = (rb.whatsChanging ?? []).slice(0, 3);
  const changingInner = changing.length
    ? `<ul class="rows">${changing
        .map(
          (x) =>
            `<li>${escapeHtml(x.text)} ${evidencePill(x.evidence)} ${sourceLinks(x.sourceUrls)}</li>`,
        )
        .join("")}</ul>`
    : emptyNote("No change signals captured yet.");

  // ---- Section 5: their pressure — what the meeting contact is accountable for ----
  const tensions = (rb.executiveTensions ?? []).slice(0, 3);
  const tensionsInner = tensions.length
    ? `<ul class="rows">${tensions
        .map(
          (x) =>
            `<li>${escapeHtml(x.text)} ${evidencePill(x.evidence)} ${sourceLinks(x.sourceUrls)}</li>`,
        )
        .join("")}</ul>`
    : emptyNote("No executive pressures captured yet.");

  // ---- Section 6: person profile — who you're meeting ----
  const focus = input.focusContact ?? input.contacts[0] ?? null;
  const others = focus
    ? input.contacts.filter((c) => c.fullName.toLowerCase() !== focus.fullName.toLowerCase())
    : input.contacts;
  const personInner = focus
    ? `${renderContactProfile(focus, true)}${
        others.length
          ? `<div class="profile-block"><div class="profile-label">Other stakeholders</div>${others
              .map((c) => renderContactProfile(c, false))
              .join("")}</div>`
          : ""
      }`
    : emptyNote("No decision-makers captured yet.");

  // ---- Section 7: our angle (1–2 sentences, issue-led). The distilled
  // single view (post-stress-test) IS the angle whenever it exists, so the
  // card never carries a second, competing hypothesis next to Section 9's
  // "Our view"; the partner-entered hypothesis is only a fallback for
  // accounts the Cartographer hasn't researched yet. ----
  const view = distillBriefView(rb);
  const angle = view.ourView || input.cogniriseHypothesis?.trim() || "";
  const angleInner = angle
    ? `<p class="prose">${escapeHtml(angle)}</p>`
    : emptyNote("No origination angle captured yet.");

  // ---- Section 8: priority project areas (up to 5) ----
  const angles = (rb.mandateAngles ?? []).slice(0, 5);
  const anglesInner = angles.length
    ? angles
        .map((a) => {
          const sls = (a.serviceLines ?? [])
            .map((s) => {
              const meta = SERVICE_LINE_META[s];
              const label = meta ? `${escapeHtml(s)} · ${escapeHtml(meta.dealSize)}` : escapeHtml(s);
              return `<span class="sl-tag">${label}</span>`;
            })
            .join(" ");
          const whyLive = a.whyNow || a.tension;
          return `<div class="angle">
            <div class="angle-title">${escapeHtml(a.title)} ${sls}</div>
            ${whyLive ? `<div class="kv"><span>Why live</span><b>${escapeHtml(whyLive)}</b></div>` : ""}
            ${a.entryStakeholder ? `<div class="kv"><span>Owner</span><b>${escapeHtml(a.entryStakeholder)}</b></div>` : ""}
            ${sourceLinks(a.sourceUrls)}
          </div>`;
        })
        .join("")
    : emptyNote("No priority project areas captured yet.");

  // ---- Section 9: our view (one balanced opinion + caveats + confidence,
  // distilled from the stress-test — never the original hypothesis shown
  // side-by-side with the attack on it) ----
  const watchInner =
    view.ourView || view.watchOuts.length
      ? `${view.ourView ? `<div class="rtw"><span class="rtw-label">Our view</span>${escapeHtml(view.ourView)}</div>` : ""}
        ${view.confidence ? `<div class="kv"><span>Confidence</span><b>${escapeHtml(view.confidence.label)}</b></div>` : ""}
        ${
          view.watchOuts.length
            ? `<div class="rtw-label" style="margin-top:10px">What could change our view</div>
               <ul class="rows">${view.watchOuts
                 .map((x) => {
                   const answer = input.watchOutAnswers?.[x]?.trim();
                   const guidance = answer
                     ? `<div class="wo-answer"><span class="wo-answer-label">If they raise it</span>${escapeHtml(answer)}</div>`
                     : "";
                   return `<li>${escapeHtml(x)}${guidance}</li>`;
                 })
                 .join("")}</ul>`
            : ""
        }`
      : emptyNote("This hypothesis has not been stress-tested yet — re-run the Account Cartographer to surface watch-outs.");

  const sections = [
    sectionShell(2, "Account snapshot", snapshotInner),
    sectionShell(3, "Group / business-unit structure", unitsInner),
    sectionShell(4, "What's changing right now", changingInner),
    sectionShell(5, "Their pressure", tensionsInner),
    sectionShell(6, "Who you're meeting", personInner),
    sectionShell(7, "Our angle", angleInner),
    sectionShell(8, "Priority project areas", anglesInner),
    sectionShell(9, "Our view", watchInner),
  ].join("");

  // Byline mirrors the shared PDF brand kit: prepared by the assistant
  // (Riser), never the requesting user's personal name.
  const preparedLine = `Prepared by Riser · ${dateLabel}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(brand)} — First-meeting prep</title>
<style>
  /* --gold name kept for stability but resolves to the Cognirise magenta
     accent — never amber/golden hues (mirrors atelier-pdf-brand.ts). */
  /* Palette mirrors atelier-pdf-brand.ts BRAND tokens. */
  :root { --navy:#0E1F3D; --gold:#A6348F; --ink:#1F2A3D; --mute:#5B6B7C; --soft:#f5f6f8; --rule:#e2e6ec; --paper:#ffffff;
    --blue:#5B7CFF; --purple:#8A5BD6; --magenta:#C45BB8; --coral:#FF7B5A; }
  *,*::before,*::after { box-sizing:border-box; }
  html,body { margin:0; padding:0; background:#eef1f5; color:var(--ink);
    font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.55; }
  h1,h2,h3,.client-wordmark,.cognirise-mark { font-family:"Comfortaa","Inter",ui-sans-serif,system-ui,sans-serif; }
  /* Cognirise brand chrome: navy strip + signature gradient hairline
     (blue→purple→magenta→coral), same as every generated PDF page. */
  .brand-strip { height:8px; background:var(--navy); }
  .brand-rule { height:2px; background:linear-gradient(90deg, var(--blue) 0%, var(--purple) 35%, var(--magenta) 65%, var(--coral) 100%); }
  .sheet { max-width:880px; margin:0 auto; padding:0 18px 64px; }
  header.top { display:flex; align-items:flex-start; justify-content:space-between; gap:24px;
    padding:36px 4px 24px; }
  .client-logo { height:46px; max-width:240px; object-fit:contain; display:block; }
  .client-wordmark { font-size:26px; font-weight:700; color:var(--navy); letter-spacing:-0.01em; }
  .client-sub { color:var(--mute); font-size:13px; margin-top:4px; }
  .corner { text-align:right; }
  .cognirise-mark { font-size:13px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:var(--navy); }
  .cognirise-mark .dot { color:var(--gold); }
  .corner .doctype { font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--mute); margin-top:6px; }
  .corner .prepared { font-size:11px; color:var(--mute); margin-top:2px; }
  .card { background:var(--paper); border:1px solid var(--rule); border-radius:12px;
    padding:24px 26px; margin:14px 0; position:relative; box-shadow:0 1px 2px rgba(14,31,61,0.04); }
  .card-num { position:absolute; top:18px; right:22px; font-size:12px; font-variant-numeric:tabular-nums;
    color:#c2c9d4; font-weight:700; letter-spacing:0.1em; }
  .card h2 { margin:0 0 14px; font-size:17px; color:var(--navy); letter-spacing:-0.01em; }
  .card-body { font-size:14.5px; }
  .glance { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px; }
  .glance-cell { background:var(--soft); border:1px solid var(--rule); border-radius:8px; padding:8px 14px; min-width:110px; }
  .glance-cell span { display:block; font-size:10.5px; letter-spacing:0.1em; text-transform:uppercase; color:var(--mute); }
  .glance-cell b { font-size:15px; color:var(--navy); }
  .headline { margin-top:16px; padding:14px 16px; background:#faeef7; border-left:3px solid var(--gold); border-radius:0 8px 8px 0; font-size:15.5px; color:var(--navy); }
  .headline-label, .rtw-label { display:block; font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase; color:var(--gold); margin-bottom:4px; font-weight:700; }
  .rtw { margin-top:14px; padding:14px 16px; background:var(--soft); border:1px solid var(--rule); border-radius:8px; }
  ul.rows { list-style:none; padding:0; margin:0; }
  ul.rows li { padding:9px 0; border-bottom:1px solid var(--rule); }
  ul.rows li:last-child { border-bottom:0; }
  .prose { margin:0; }
  .ev { display:inline-block; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; padding:1px 7px; border-radius:999px; border:1px solid var(--rule); vertical-align:middle; }
  .ev-evidenced { color:#2E7D5B; border-color:#bfe0cd; background:#f0f8f3; }
  .ev-inferred { color:#8A5BD6; border-color:#ddd0f5; background:#f6f2fd; }
  .ev-hypothesis { color:#6b7480; border-color:var(--rule); background:var(--soft); }
  .srcs a { color:var(--gold); text-decoration:none; font-size:11.5px; font-weight:600; }
  table.grid { width:100%; border-collapse:collapse; font-size:13.5px; }
  table.grid th { text-align:left; padding:8px 10px; background:var(--soft); border-bottom:1px solid var(--rule);
    font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:var(--mute); }
  table.grid td { padding:9px 10px; border-bottom:1px solid var(--rule); vertical-align:top; }
  td.sl { font-weight:600; color:var(--navy); white-space:nowrap; }
  td.deal { white-space:nowrap; color:var(--navy); font-weight:600; }
  .gap { margin-top:4px; font-size:12.5px; color:#A6348F; }
  .bu-grid { display:flex; flex-wrap:wrap; gap:12px; }
  .bu-card { flex:1 1 160px; min-width:150px; background:var(--soft); border:1px solid var(--rule);
    border-radius:10px; padding:12px 14px; }
  .bu-name { font-weight:700; color:var(--navy); font-size:14px; }
  .bu-note { color:var(--mute); font-size:12px; margin-top:3px; }
  .bu-brands { color:var(--ink); font-size:12.5px; margin-top:7px; }
  .angle { padding:14px 16px; border:1px solid var(--rule); border-radius:8px; margin-bottom:12px; }
  .angle:last-child { margin-bottom:0; }
  .angle-title { font-weight:700; color:var(--navy); font-size:15px; margin-bottom:8px; }
  .sl-tag { display:inline-block; font-size:10px; font-weight:700; letter-spacing:0.06em; color:var(--gold); border:1px solid #e9c8e1; background:#faeef7; border-radius:999px; padding:1px 7px; margin-left:4px; }
  .kv { display:flex; gap:10px; padding:3px 0; font-size:13.5px; }
  .kv span { flex:0 0 88px; color:var(--mute); font-size:11px; letter-spacing:0.06em; text-transform:uppercase; padding-top:2px; }
  .kv b { font-weight:500; color:var(--ink); }
  .profile-block { margin-top:12px; }
  .profile-label { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--mute); font-weight:700; margin-bottom:4px; }
  .profile-block ul { margin:0; padding-left:18px; }
  .profile-block li { margin-bottom:5px; }
  .profile-hl { font-size:13px; color:var(--mute); }
  .assume { display:flex; flex-wrap:wrap; gap:16px; margin-top:12px; }
  .assume-col { flex:1 1 200px; min-width:180px; }
  .person { padding:16px 0; border-bottom:1px solid var(--rule); }
  .person:last-child { border-bottom:0; }
  .person-spotlight { background:#faeef7; border:1px solid #e9c8e1; border-radius:10px; padding:16px; margin-bottom:8px; }
  .person-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .person-name { font-weight:700; color:var(--navy); font-size:15.5px; }
  .person-meta { color:var(--mute); font-size:13px; margin-top:2px; }
  .person-why { margin:8px 0 0; font-size:13.5px; }
  .profile-src { color:var(--gold); text-decoration:none; font-size:12px; font-weight:600; white-space:nowrap; }
  .muted { color:var(--mute); }
  .empty { color:var(--mute); font-style:italic; margin:0; }
  .wo-answer { margin-top:6px; padding:8px 12px; background:#faeef7; border-left:2px solid var(--gold); border-radius:0 6px 6px 0; font-size:13.5px; }
  .wo-answer-label { display:block; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:var(--gold); font-weight:700; margin-bottom:2px; }
  footer.foot { text-align:center; padding:34px 0 0; color:var(--mute); }
  footer.foot .fmark { font-size:13px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:var(--navy); }
  footer.foot .fmark .dot { color:var(--gold); }
  footer.foot .ftag { font-style:italic; color:var(--gold); margin-top:4px; font-size:13px; }
  footer.foot .fnote { font-size:11px; margin-top:8px; }
  @media print {
    html,body { background:#fff; }
    .card { box-shadow:none; break-inside:avoid; }
  }
</style>
</head>
<body>
<div class="brand-strip"></div>
<div class="brand-rule"></div>
<div class="sheet">
  <header class="top">
    <div class="client">
      ${
        logoUrl
          ? `<img class="client-logo" src="${escapeAttr(logoUrl)}" alt="${escapeAttr(brand)}" onerror="this.style.display='none';var w=this.nextElementSibling;if(w)w.style.display='block';" />
             <div class="client-wordmark" style="display:none">${escapeHtml(brand)}</div>`
          : `<div class="client-wordmark">${escapeHtml(brand)}</div>`
      }
      <div class="client-sub">${escapeHtml(input.sector)} · ${escapeHtml(input.country)}</div>
    </div>
    <div class="corner">
      <div class="cognirise-mark">Cognirise<span class="dot">.</span></div>
      <div class="doctype">First-meeting prep</div>
      <div class="prepared">${preparedLine}</div>
    </div>
  </header>
  ${sections}
  <footer class="foot">
    <div class="fmark">Cognirise<span class="dot">.</span></div>
    <div class="ftag">${escapeHtml(COGNIRISE_TAGLINE)}</div>
    <div class="fnote">Confidential — prepared by Riser from outside-in public-source research. AI generated and may contain errors — verify key facts before relying on it.</div>
  </footer>
</div>
</body>
</html>`;
}
