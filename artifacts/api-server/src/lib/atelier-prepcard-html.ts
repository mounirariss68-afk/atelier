// ============================================================
// Task #589 — Self-contained first-meeting prep card (HTML).
// ------------------------------------------------------------
// renderPrepCardHtml(input) projects the Account Cartographer's
// 4-step research (Client Present Brief, Origination Hypothesis,
// Stress-Test, deep person profiles) into a single, self-contained
// HTML document a Partner can download and walk into a first
// meeting with. No external CSS/JS — everything is inlined, so the
// file works offline. The ONLY network dependency is the client
// logo (Brandfetch CDN), which degrades gracefully to a text
// wordmark via an inline onerror handler.
//
// The 9 sections mirror the research method end-to-end:
//   1. Cover / at-a-glance
//   2. Client Present Brief — what's changing
//   3. Executive tensions
//   4. Service-line fit (with typical deal-size ranges)
//   5. Partner ecosystem & white space
//   6. Origination hypothesis (why now)
//   7. Mandate angles
//   8. Stress-test
//   9. Key people (deep profiles) + open questions
// ============================================================

const COGNIRISE_TAGLINE = "Intelligence that Elevates.";

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
  preparedBy?: string | null;
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

/** Best-effort domain guess for the Brandfetch logo CDN. Unreliable by
 *  design — the <img onerror> falls back to a text wordmark when the guess
 *  (or Brandfetch) does not resolve, so a wrong guess never breaks the card. */
function guessDomain(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return slug ? `${slug}.com` : "";
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
  const domain = guessDomain(brand);
  const logoUrl = domain
    ? `https://cdn.brandfetch.io/${domain}/w/600/h/200/theme/dark/logo.png`
    : "";

  // ---- Section 1: cover / at-a-glance ----
  const facts = [
    ["Sector", input.sector],
    ["Country", input.country],
    input.hqCity ? ["HQ", input.hqCity] : null,
    input.tier ? ["Tier", input.tier] : null,
  ].filter(Boolean) as Array<[string, string]>;
  const single = rb.singleMostImportant?.trim();
  const coverInner = `
    <div class="glance">${facts
      .map(([k, v]) => `<div class="glance-cell"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
      .join("")}</div>
    ${single ? `<div class="headline"><span class="headline-label">The single most important thing</span>${escapeHtml(single)}</div>` : ""}
    ${input.cogniriseHypothesis ? `<div class="rtw"><span class="rtw-label">Cognirise right-to-win</span>${escapeHtml(input.cogniriseHypothesis)}</div>` : ""}`;

  // ---- Section 2: what's changing ----
  const changing = rb.whatsChanging ?? [];
  const changingInner = changing.length
    ? `<ul class="rows">${changing
        .map(
          (x) =>
            `<li>${escapeHtml(x.text)} ${evidencePill(x.evidence)} ${sourceLinks(x.sourceUrls)}</li>`,
        )
        .join("")}</ul>`
    : emptyNote("No change signals captured yet.");

  // ---- Section 3: executive tensions ----
  const tensions = rb.executiveTensions ?? [];
  const tensionsInner = tensions.length
    ? `<ul class="rows">${tensions
        .map(
          (x) =>
            `<li>${escapeHtml(x.text)} ${evidencePill(x.evidence)} ${sourceLinks(x.sourceUrls)}</li>`,
        )
        .join("")}</ul>`
    : emptyNote("No executive tensions captured yet.");

  // ---- Section 4: service-line fit + deal sizes ----
  const slFit = rb.serviceLineFit ?? [];
  const slInner = slFit.length
    ? `<table class="grid"><thead><tr><th>Service line</th><th>Signal</th><th>Typical deal size</th><th></th></tr></thead><tbody>${slFit
        .map((s) => {
          const meta = SERVICE_LINE_META[s.serviceLine];
          const slLabel = meta ? `${escapeHtml(s.serviceLine)} · ${escapeHtml(meta.name)}` : escapeHtml(s.serviceLine);
          const deal = meta ? escapeHtml(meta.dealSize) : "—";
          return `<tr><td class="sl">${slLabel}</td><td>${escapeHtml(s.signal)}</td><td class="deal">${deal}</td><td>${sourceLinks(s.sourceUrls)}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : emptyNote("No service-line fit captured yet.");

  // ---- Section 5: partner ecosystem ----
  const partners = rb.partnerEcosystem ?? [];
  const partnersInner = partners.length
    ? `<ul class="rows">${partners
        .map((p) => {
          const gap = p.serviceLineGap ? `<div class="gap">White space: ${escapeHtml(p.serviceLineGap)}</div>` : "";
          return `<li><b>${escapeHtml(p.partner)}</b> — ${escapeHtml(p.relationship)} ${sourceLinks(p.sourceUrls)}${gap}</li>`;
        })
        .join("")}</ul>`
    : emptyNote("No partner ecosystem captured yet.");

  // ---- Section 6: why now ----
  const whyNow = rb.whyNowHypothesis?.trim();
  const whyNowInner = whyNow
    ? `<p class="prose">${escapeHtml(whyNow)}</p>`
    : emptyNote("No origination hypothesis captured yet.");

  // ---- Section 7: mandate angles ----
  const angles = rb.mandateAngles ?? [];
  const anglesInner = angles.length
    ? angles
        .map((a) => {
          const sls = (a.serviceLines ?? []).map((s) => `<span class="sl-tag">${escapeHtml(s)}</span>`).join(" ");
          return `<div class="angle">
            <div class="angle-title">${escapeHtml(a.title)} ${sls}</div>
            <div class="kv"><span>Tension</span><b>${escapeHtml(a.tension)}</b></div>
            <div class="kv"><span>Why now</span><b>${escapeHtml(a.whyNow)}</b></div>
            <div class="kv"><span>Enter via</span><b>${escapeHtml(a.entryStakeholder)}</b></div>
            ${sourceLinks(a.sourceUrls)}
          </div>`;
        })
        .join("")
    : emptyNote("No mandate angles captured yet.");

  // ---- Section 8: stress-test ----
  const st = rb.stressTest ?? null;
  const stInner = st
    ? `
      ${st.revisedHypothesis ? `<div class="rtw"><span class="rtw-label">Revised hypothesis</span>${escapeHtml(st.revisedHypothesis)}</div>` : ""}
      ${
        (st.failureScenarios ?? []).length
          ? `<div class="profile-block"><div class="profile-label">How it could be wrong</div><ul>${(st.failureScenarios ?? [])
              .map((x) => `<li>${escapeHtml(x)}</li>`)
              .join("")}</ul></div>`
          : ""
      }
      ${
        st.assumptions
          ? `<div class="assume">
              ${(st.assumptions.evidenced ?? []).length ? `<div class="assume-col"><div class="profile-label">Evidenced</div><ul>${(st.assumptions.evidenced ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : ""}
              ${(st.assumptions.untestedButLikely ?? []).length ? `<div class="assume-col"><div class="profile-label">Untested but likely</div><ul>${(st.assumptions.untestedButLikely ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : ""}
              ${(st.assumptions.uncertain ?? []).length ? `<div class="assume-col"><div class="profile-label">Uncertain</div><ul>${(st.assumptions.uncertain ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : ""}
            </div>`
          : ""
      }
      ${
        (st.likelyObjections ?? []).length
          ? `<div class="profile-block"><div class="profile-label">Likely objections</div><ul>${(st.likelyObjections ?? [])
              .map((x) => `<li>${escapeHtml(x)}</li>`)
              .join("")}</ul></div>`
          : ""
      }
      ${
        (st.evidenceToStrengthen ?? []).length
          ? `<div class="profile-block"><div class="profile-label">Evidence to strengthen</div><ul>${(st.evidenceToStrengthen ?? [])
              .map((e) => `<li>${escapeHtml(e.evidence)} <span class="muted">— ${escapeHtml(e.whereToFind)}</span></li>`)
              .join("")}</ul></div>`
          : ""
      }`
    : emptyNote("This hypothesis has not been stress-tested yet. Re-run the Account Cartographer to generate it.");

  // ---- Section 9: people + open questions ----
  const focus = input.focusContact ?? null;
  const others = focus
    ? input.contacts.filter((c) => c.fullName.toLowerCase() !== focus.fullName.toLowerCase())
    : input.contacts;
  const peopleHtml =
    input.contacts.length || focus
      ? `${focus ? renderContactProfile(focus, true) : ""}${others.map((c) => renderContactProfile(c, false)).join("")}`
      : emptyNote("No decision-makers captured yet.");
  const openQ = rb.openQuestions ?? [];
  const openInner = openQ.length
    ? `<div class="profile-block"><div class="profile-label">Open questions to resolve</div><ul>${openQ
        .map((q) => `<li>${escapeHtml(q)}</li>`)
        .join("")}</ul></div>`
    : "";
  const peopleInner = `${peopleHtml}${openInner}`;

  const sections = [
    sectionShell(1, "At a glance", coverInner),
    sectionShell(2, "What's changing", changingInner),
    sectionShell(3, "Executive tensions", tensionsInner),
    sectionShell(4, "Service-line fit", slInner),
    sectionShell(5, "Partner ecosystem & white space", partnersInner),
    sectionShell(6, "Why now — origination hypothesis", whyNowInner),
    sectionShell(7, "Mandate angles", anglesInner),
    sectionShell(8, "Stress-test", stInner),
    sectionShell(9, "Key people & open questions", peopleInner),
  ].join("");

  const preparedLine = [
    input.preparedBy ? `Prepared by ${escapeHtml(input.preparedBy)}` : null,
    dateLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(brand)} — First-meeting prep</title>
<style>
  :root { --navy:#0E1F3D; --gold:#E89E2C; --ink:#26303f; --mute:#6b7480; --soft:#f5f6f8; --rule:#e2e6ec; --paper:#ffffff; }
  *,*::before,*::after { box-sizing:border-box; }
  html,body { margin:0; padding:0; background:#eef1f5; color:var(--ink);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.55; }
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
  .headline { margin-top:16px; padding:14px 16px; background:#fbf3e3; border-left:3px solid var(--gold); border-radius:0 8px 8px 0; font-size:15.5px; color:var(--navy); }
  .headline-label, .rtw-label { display:block; font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase; color:var(--gold); margin-bottom:4px; font-weight:700; }
  .rtw { margin-top:14px; padding:14px 16px; background:var(--soft); border:1px solid var(--rule); border-radius:8px; }
  ul.rows { list-style:none; padding:0; margin:0; }
  ul.rows li { padding:9px 0; border-bottom:1px solid var(--rule); }
  ul.rows li:last-child { border-bottom:0; }
  .prose { margin:0; }
  .ev { display:inline-block; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; padding:1px 7px; border-radius:999px; border:1px solid var(--rule); vertical-align:middle; }
  .ev-evidenced { color:#2E7D5B; border-color:#bfe0cd; background:#f0f8f3; }
  .ev-inferred { color:#b07a14; border-color:#ecd9a4; background:#fdf6e6; }
  .ev-hypothesis { color:#6b7480; border-color:var(--rule); background:var(--soft); }
  .srcs a { color:var(--gold); text-decoration:none; font-size:11.5px; font-weight:600; }
  table.grid { width:100%; border-collapse:collapse; font-size:13.5px; }
  table.grid th { text-align:left; padding:8px 10px; background:var(--soft); border-bottom:1px solid var(--rule);
    font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:var(--mute); }
  table.grid td { padding:9px 10px; border-bottom:1px solid var(--rule); vertical-align:top; }
  td.sl { font-weight:600; color:var(--navy); white-space:nowrap; }
  td.deal { white-space:nowrap; color:var(--navy); font-weight:600; }
  .gap { margin-top:4px; font-size:12.5px; color:#b07a14; }
  .angle { padding:14px 16px; border:1px solid var(--rule); border-radius:8px; margin-bottom:12px; }
  .angle:last-child { margin-bottom:0; }
  .angle-title { font-weight:700; color:var(--navy); font-size:15px; margin-bottom:8px; }
  .sl-tag { display:inline-block; font-size:10px; font-weight:700; letter-spacing:0.06em; color:var(--gold); border:1px solid #ecd9a4; background:#fdf6e6; border-radius:999px; padding:1px 7px; margin-left:4px; }
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
  .person-spotlight { background:#fbf3e3; border:1px solid #ecd9a4; border-radius:10px; padding:16px; margin-bottom:8px; }
  .person-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .person-name { font-weight:700; color:var(--navy); font-size:15.5px; }
  .person-meta { color:var(--mute); font-size:13px; margin-top:2px; }
  .person-why { margin:8px 0 0; font-size:13.5px; }
  .profile-src { color:var(--gold); text-decoration:none; font-size:12px; font-weight:600; white-space:nowrap; }
  .muted { color:var(--mute); }
  .empty { color:var(--mute); font-style:italic; margin:0; }
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
      ${preparedLine ? `<div class="prepared">${preparedLine}</div>` : ""}
    </div>
  </header>
  ${sections}
  <footer class="foot">
    <div class="fmark">Cognirise<span class="dot">.</span></div>
    <div class="ftag">${escapeHtml(COGNIRISE_TAGLINE)}</div>
    <div class="fnote">Confidential — outside-in research from public sources. Verify before acting.</div>
  </footer>
</div>
</body>
</html>`;
}
