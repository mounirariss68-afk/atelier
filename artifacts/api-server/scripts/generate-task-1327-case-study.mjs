import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header,
  HeadingLevel, ImageRun, Packer, PageBreak, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "generated");
const logoLight = path.resolve(root, "../cognirise-atelier/public/cognirise-logo-light.png");
const logoDark = path.resolve(root, "../cognirise-atelier/public/cognirise-logo.png");

const C = {
  navy: "101A36", deep: "091126", blue: "3979F6", purple: "7657F6",
  magenta: "D04CA6", coral: "FF7262", ink: "17203A", muted: "5D6680",
  pale: "F3F5FA", line: "DDE2EC", white: "FFFFFF", mint: "DDF7EE",
};
const BODY = "Inter";
const HEAD = "Comfortaa";

const sources = [
  ["1", "Peng et al.", "The Impact of AI on Developer Productivity: Evidence from GitHub Copilot", "13 Feb 2023", "https://arxiv.org/abs/2302.06590", "Controlled, bounded JavaScript task; 55.8% faster completion (95% CI 21–89%). Not a whole-enterprise estimate."],
  ["2", "Cui et al.", "The Effects of Generative AI on High-Skilled Work: Evidence from Three Field Experiments with Software Developers", "first posted 5 Sep 2024", "https://www.microsoft.com/en-us/research/publication/the-effects-of-generative-ai-on-high-skilled-work-evidence-from-three-field-experiments-with-software-developers/", "Pooled 26.08% more completed tasks (SE 10.3) across 4,867 developers; heterogeneous effects and settings. Manuscript: https://ssrn.com/abstract=4945566"],
  ["3", "DORA", "Accelerate State of DevOps Report 2024", "22 Oct 2024", "https://dora.dev/research/2024/dora-report/", "Nearly 3,000 respondents; observational evidence with mixed associations, including lower delivery throughput and stability."],
  ["4", "METR", "Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity", "10 Jul 2025", "https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/", "Randomized study: 16 experienced maintainers, 246 issues; AI-allowed work was 19% slower. Historical tools and narrow sample limit generalization."],
  ["5", "METR", "Measuring AI Ability to Complete Long Tasks", "2025", "https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/", "Benchmark task-horizon trend roughly doubled every seven months; benchmark capability is not workplace productivity."],
  ["6", "Jimenez et al.; OpenAI", "SWE-bench: Can Language Models Resolve Real-World GitHub Issues? / SWE-bench Verified", "paper Oct 2023; Verified 13 Aug 2024", "https://arxiv.org/abs/2310.06770", "Software-engineering benchmark and human-filtered subset; measures benchmark capability, not ROI or deployment outcomes. Verified: https://openai.com/index/introducing-swe-bench-verified/"],
  ["7", "Stanford HAI", "AI Index Report 2025", "7 Apr 2025", "https://hai.stanford.edu/ai-index/2025-ai-index-report", "Inference price for GPT-3.5-level benchmark performance fell more than 280× from Nov 2022 to Oct 2024; not enterprise TCO."],
  ["8", "Epoch AI", "How much does it cost to train frontier AI models?", "3 Jun 2024", "https://epoch.ai/publications/how-much-does-it-cost-to-train-frontier-ai-models", "Estimated frontier training costs grew about 2.4× per year; supply-side trend, not coding-assistant cost."],
  ["9", "DORA", "State of AI-assisted Software Development 2025", "23 Sep 2025", "https://dora.dev/research/2025/dora-report/", "Mixed-method, observational framing: AI acts as an amplifier of organizational conditions; association is not causation."],
  ["10", "Cognirise", "Repository and commit-history evidence", "as of 5 Sep 2026", "", "Implemented code and recorded chronology only. It does not establish live deployment, effort, adoption, quality, or production outcomes."],
];
const sourceRegister = sources.map(s => `[${s[0]}] ${s[1]} (${s[3]}): ${s[5]} ${s[4]}`).join("\n");

const chronology = [
  ["Foundation", "12 May 2026, ~20:28", "Core application foundation recorded.", "Commit history establishes recording/order only. [10]"],
  ["Pre-contract", "12 May, by ~21:57", "Early opportunity-to-contract workflow surface.", "Implemented-code evidence; not proof of use. [10]"],
  ["Delivery/process MVP closeout", "13 May, ~06:06", "Engagement, deliverable and process spine recorded.", "No deployment or elapsed-effort inference. [10]"],
  ["v2 expansion", "13 May, through ~13:09", "CRM, pricing and salon/reference expansion.", "Ordering from history; capability from code. [10]"],
  ["v3 expansion", "13 May, through evening", "People, time and wallet capabilities broadened.", "No production-outcome claim. [10]"],
  ["Continued expansion", "13–14 May", "CRM and reference work continued.", "Recorded activity only. [10]"],
  ["Mobile", "19–20 Jul", "Mobile code introduced.", "Mobile code exists; distribution/adoption unverified. [10]"],
  ["System hardening", "Aug 2026", "Design-system alignment and hardening work recorded.", "No reliability uplift quantified. [10]"],
];

const capabilities = [
  ["Growth intelligence", "CRM and research-agent code; account/opportunity context and assistant surfaces.", "Implemented code", "External model/search paths are implemented—not proven live."],
  ["Commercial control", "Deterministic pricing and margin controls; engagements, deliverables and change orders.", "Implemented code", "Control design is visible; realized margin impact is unmeasured."],
  ["Finance spine", "Billing, finance, GL, payroll, VAT and cash-operation code paths.", "Implemented code", "Operational completeness and statutory use are not asserted."],
  ["People operations", "People lifecycle, time, wallet and Me self-service.", "Implemented code", "Adoption, satisfaction and cycle-time outcomes are unmeasured."],
  ["Contracts", "Contract lifecycle and e-sign integration code.", "Implemented code", "E-sign provider path is implemented—not proven live."],
  ["Extended workforce", "Contractor self-billing and scoped access; alliance-partner portal isolation.", "Implemented code", "Isolation is evidenced in code, not by a production audit."],
  ["Experience layer", "Web and mobile code plus shared design-system assets.", "Implemented code", "Mobile release/distribution is not claimed."],
  ["Agentic interface", "Admin/assistant capability catalog and action-oriented service code.", "Implemented code", "Autonomy, accuracy and business benefit require live evaluation."],
];

const operating = [
  ["Employees", "Me self-service; people/time/wallet; contracts and requests", "Assistant proposes or retrieves; deterministic services execute approved actions", "Role scope, confirmation gates, audit trail, exception owners"],
  ["Contractors", "Scoped access; time/expense and self-billing paths", "Guided self-service reduces hand-offs while preserving commercial controls", "Least privilege, engagement scope, invoice review, finance exception handling"],
  ["Alliance partners", "Isolated partner portal and relevant delivery/commercial context", "Shared workflow without exposing unrelated firm data", "Portal isolation, explicit grants, partner-owner review, revocation"],
];

function r(text, o = {}) {
  return new TextRun({ text, font: o.font || BODY, size: o.size || 19, color: o.color || C.ink,
    bold: !!o.bold, italics: !!o.italics, underline: o.underline });
}
function para(text = "", o = {}) {
  return new Paragraph({
    heading: o.heading, alignment: o.alignment, pageBreakBefore: o.pageBreakBefore,
    spacing: o.spacing || { after: 110, line: 286 }, keepNext: o.keepNext,
    bullet: o.bullet ? { level: o.level || 0 } : undefined,
    children: Array.isArray(text) ? text : [r(text, o)],
  });
}
const h1 = t => para(t, { heading: HeadingLevel.HEADING_1, keepNext: true });
const h2 = t => para(t, { heading: HeadingLevel.HEADING_2, keepNext: true });
const bullet = t => para(t, { bullet: true });
function cell(value, fill, white = false) {
  return new TableCell({
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 100, bottom: 100, left: 110, right: 110 },
    children: [para(value, { size: 16, color: white ? C.white : C.ink, bold: white })],
  });
}
function table(headers, rows, widths) {
  const borders = Object.fromEntries(["top","bottom","left","right","insideHorizontal","insideVertical"]
    .map(k => [k, { style: BorderStyle.SINGLE, size: 4, color: C.line }]));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: widths,
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map(h => cell(h, C.navy, true)) }),
      ...rows.map((row, i) => new TableRow({ cantSplit: true, children: row.map(v => cell(v, i % 2 ? C.pale : C.white)) })),
    ],
  });
}
function callout(title, body) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: Object.fromEntries(["top","bottom","left","right","insideHorizontal","insideVertical"]
      .map(k => [k, { style: BorderStyle.NONE, size: 0, color: C.white }])),
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: "EEF1FF" },
      margins: { top: 150, bottom: 150, left: 180, right: 180 },
      children: [para([r(title + "  ", { bold: true, color: C.purple }), r(body)])],
    })] })],
  });
}
function docBreak() { return para([new PageBreak()], { spacing: { after: 0 } }); }

async function buildDocx() {
  const logo = await fs.readFile(logoDark);
  const children = [
    para("", { spacing: { after: 900 } }),
    para("COGNIRISE  /  CASE STUDY", { color: C.purple, bold: true, size: 18 }),
    para("Atelier\nBuilding the agentic operating system", { heading: HeadingLevel.TITLE }),
    para("A repository-evidenced case study of staged platform construction, operating-model design and disciplined interpretation", { size: 28, color: C.muted }),
    para("", { spacing: { after: 700 } }),
    callout("Evidence boundary", "Repository evidence means implemented code only. Commit history establishes ordering and recording—not deployment, effort, usage or business impact. External integrations are implemented-not-proven-live. Evidence reviewed through 5 September 2026. [10]"),
    para("", { spacing: { after: 500 } }),
    para("Prepared 5 September 2026  •  Public-safe edition", { color: C.muted }),
    docBreak(),
    h1("Executive abstract"),
    para("Cognirise faced a founding design question: buy a patchwork of horizontal systems and integrate later, or build a coherent operating spine around the firm’s workflows. The repository records a staged build beginning on 12 May 2026, broadening from foundation and pre-contract workflows into delivery, commercial control, finance, people, contracts, extended-workforce access, mobile and a shared design system. [10]"),
    para("The strategic bet was not that AI makes every software task faster. It was that senior-led domain design, deterministic controls and bounded agentic assistance could make one operating model legible across employees, contractors and alliance partners. External studies justify experimentation but do not settle ROI: reported effects range from faster bounded tasks and more completed work to slower experienced-maintainer work, while DORA reports mixed organizational associations. [1–5,9]"),
    para("The verified claim is breadth and sequencing in implemented code—not live deployment or production outcomes. The repository contains CRM/research agents; deterministic pricing and margin controls; engagement, deliverable and change-order workflows; billing/finance/GL/payroll/VAT/cash capabilities; people and contract lifecycles; Me self-service; contractor self-billing/scoped access; alliance-partner isolation; mobile code; and an admin/assistant capability catalog. Integration paths, including e-sign and external AI/search, remain implemented-not-proven-live. [10]"),
    h2("Decision in one sentence"),
    callout("Build a controlled operating spine", "Use agents at the interaction and synthesis layer; keep pricing, permissions, accounting and approvals deterministic; stage breadth behind senior-led governance; verify production performance before making outcome claims."),
    h2("What this case establishes"),
    bullet("A coherent chronology and capability map grounded in repository evidence as of 5 September 2026. [10]"),
    bullet("An operating-model pattern spanning employees, contractors and alliance partners with differentiated access and common governance."),
    bullet("A balanced evidence base: promising external productivity and capability signals alongside negative and mixed findings. [1–9]"),
    bullet("A forward evaluation agenda rather than retrospective claims of deployment, savings, adoption or ROI."),
    docBreak(),
    h1("1. Context and founding challenge"),
    para("A professional-services firm has an unusually connected operating surface: research becomes pipeline; pipeline becomes pricing and contracting; contracting becomes delivery and change control; delivery becomes time, billing, cash and margin; each step depends on people, permissions and evidence. Fragmenting that chain across products can be sensible, but it creates integration, identity, control and reporting seams."),
    para("At founding, the relevant choice was therefore architectural and organizational—not simply whether to use AI. The firm needed to decide where differentiation justified owned software, where commodity services should remain external, and where humans must retain accountable control."),
    h2("Design constraints"),
    table(["Constraint", "Implication"], [
      ["One firm, three constituencies", "Employees, contractors and alliance partners require common workflows but different entitlements and obligations."],
      ["Agentic ambition", "Natural-language and research assistance must be bounded by explicit action catalogs, approvals and deterministic services."],
      ["Commercial accountability", "Pricing, margin, engagement scope, deliverables and change orders need structured records rather than generated prose alone."],
      ["Financial integrity", "Billing, GL, payroll, VAT and cash paths require deterministic calculation, validation, review and auditability."],
      ["Evidence discipline", "A fast repository chronology cannot be converted into claims about elapsed effort, deployment, quality, savings or adoption."],
    ], [2600, 6500]),
    h2("The founding hypothesis"),
    para("A senior-led team could encode the firm’s operating model directly: a shared domain spine, constituency-specific portals and bounded assistants sitting above deterministic controls. This is a strategic hypothesis and design interpretation—not a measured production result."),
    docBreak(),
    h1("2. Build versus buy"),
    para("The decision was not binary. The recorded architecture supports a hybrid logic: own the differentiated workflow and control plane; integrate commodity infrastructure through explicit adapters; treat agentic models as replaceable capabilities rather than the system of record."),
    table(["Decision lens", "Build / own", "Buy / integrate", "Control question"], [
      ["Differentiation", "Cross-domain operating model, capability catalog, workflow semantics", "Commodity transport, signature and model services", "Does this encode how the firm works?"],
      ["Determinism", "Pricing, margin, permissions, lifecycle state and finance rules", "External execution endpoints", "Can the result be reproduced and audited?"],
      ["Change", "Rapidly evolving internal workflow", "Standards-based or mature utility", "Who controls roadmap and switching cost?"],
      ["Risk", "Policy, approval and evidence layer", "Provider-specific execution", "Can a provider failure be contained?"],
      ["Economics", "Evaluate total lifecycle value", "Evaluate license plus integration/exit cost", "No zero-cost assumption; measure full TCO."],
    ], [1600, 2800, 2500, 2200]),
    h2("Why external evidence does not decide the choice"),
    para("Peng et al. found 55.8% faster completion in a bounded JavaScript task (95% CI 21–89%), and Cui et al. estimated 26.08% more completed tasks (SE 10.3) pooled across 4,867 developers. These are material signals, but task, developer and organizational effects vary. [1,2]"),
    para("DORA 2024 reports observational, mixed associations—including lower throughput and stability—while METR’s early-2025 randomized study found 16 experienced open-source maintainers were 19% slower over 246 issues when AI was allowed. DORA 2025 frames AI as an amplifier of the surrounding system. Together, these findings argue for local measurement, not a universal multiplier. [3,4,9]"),
    para("Capability benchmarks are directional, not financial cases. METR’s roughly seven-month task-horizon doubling trend and SWE-bench/Verified indicate advancing benchmark capability, but neither measures workplace productivity or ROI. Falling benchmark-level inference prices (>280× for GPT-3.5-level performance, Nov 2022–Oct 2024) do not equal enterprise TCO; rising frontier training costs (~2.4×/year estimated) are a supply-side signal, not coding-assistant cost. [5–8]"),
    docBreak(),
    h1("3. Staged chronology"),
    para("The chronology below is canonical across this report and both decks. Times are approximate repository-history timestamps. They establish recorded ordering only; they do not establish deployment, production use or elapsed human effort. [10]"),
    table(["Stage", "Recorded point", "Repository-evidenced scope", "Interpretation limit"], chronology, [1500, 1600, 3200, 2800]),
    h2("Reading the sequence"),
    para("The sequence suggests an architectural progression: establish the foundation; connect demand to contracting; close the delivery/process loop; extend commercial and reference depth; add people, time and wallet; continue CRM; introduce mobile; then strengthen visual coherence and hardening. “Suggests” matters: intent has not been reconstructed from timestamps alone."),
    docBreak(),
    h1("4. Verified capability architecture"),
    para("The platform is best understood as a controlled operating spine rather than a collection of screens. The capability map separates what code supports from what evidence cannot yet establish. [10]"),
    table(["Domain", "Implemented-code evidence", "Evidence status", "Boundary / limitation"], capabilities, [1500, 3400, 1500, 2700]),
    h2("Architecture pattern"),
    bullet("Experience: web, mobile and role-specific portals present tasks and context."),
    bullet("Agentic interaction: CRM/research agents and the assistant capability catalog interpret requests, retrieve context and propose bounded actions."),
    bullet("Deterministic domain services: pricing, margin, lifecycle, billing, tax and permission rules remain explicit code paths."),
    bullet("Evidence and control: structured records, scoped access, confirmations and audit-oriented workflows support accountable review."),
    bullet("Integration edge: e-sign, model, search and related external-provider paths exist in code but are not proven live. [10]"),
    docBreak(),
    h1("5. Agentic operating model"),
    para("The target model is augmentation with accountability. Assistants can reduce navigation and synthesis burden; they should not blur who owns a commercial, people, legal or financial decision."),
    table(["Constituency", "Workspace", "Agentic pattern", "Control model"], operating, [1400, 2700, 3000, 2500]),
    h2("Senior-led governance"),
    para("The differentiator is not unrestricted autonomy. Senior leaders define policy and decision rights; domain services enforce deterministic constraints; assistants expose only cataloged capabilities; material writes use confirmation and authorization; exceptions route to accountable owners; evidence is reviewed before capability or outcome claims are expanded."),
    table(["Layer", "Accountability", "Minimum practice"], [
      ["Strategy", "Founders / senior leadership", "Set value hypothesis, risk appetite, constituent promises and stop criteria."],
      ["Domain", "Commercial, delivery, people, finance and legal owners", "Own rules, approval thresholds, exceptions and control evidence."],
      ["Technology", "Engineering / platform owner", "Version capabilities, secure integrations, observe failures and preserve reversibility."],
      ["Assurance", "Independent reviewer or designated control owner", "Sample decisions, test access boundaries and challenge reported outcomes."],
    ], [1500, 3000, 4500]),
    docBreak(),
    h1("6. Evidence, limitations and evaluation agenda"),
    h2("What is supported"),
    para("The repository supports claims about implemented code and a recorded sequence through 5 September 2026. It provides a broad capability inventory and observable design choices such as deterministic pricing controls, scoped access, partner isolation and explicit assistant capabilities. [10]"),
    h2("What is not supported"),
    bullet("No claim of live deployment, production adoption, realized savings, improved throughput, stability, revenue, margin or satisfaction."),
    bullet("No conversion of commit timestamps into effort, team size, velocity or time-to-market."),
    bullet("No assertion that external integrations executed successfully in production; those paths are implemented-not-proven-live."),
    bullet("No client names, confidential fixtures, unapproved metrics or zero-cost claims."),
    h2("Founder assertions"),
    callout("Founder assertion (unverified)", "The strategic intent was to create an AI-native operating model with senior practitioners close to design and delivery. This explains the proposed differentiator but is not repository proof and should be validated through interviews and operating evidence."),
    h2("Recommended measurement plan"),
    table(["Question", "Measure", "Design"], [
      ["Does assistance improve task performance?", "Completion time, success, rework and reviewer intervention by task class", "Within-person or randomized rollout; stratify by expertise and task complexity."],
      ["Does the platform improve flow?", "Lead-to-contract, deliverable acceptance, invoice cycle and exception age", "Pre-defined baselines; control for mix and seasonality."],
      ["Are controls effective?", "Unauthorized-action attempts, confirmation failures, access violations and reconciliation exceptions", "Automated tests plus periodic independent sampling."],
      ["Is value durable?", "Full TCO, adoption, support burden, provider spend and switching cost", "Include engineering, assurance, integration and change costs."],
    ], [2300, 3300, 3900]),
    docBreak(),
    h1("7. Lessons and conclusion"),
    h2("Lessons"),
    bullet("Design the operating model before the assistant. A capability catalog is safer when it maps to explicit domain actions."),
    bullet("Keep consequential math and state transitions deterministic. Language models can assist interpretation without owning the ledger."),
    bullet("Treat identity and constituency boundaries as architecture. Employee convenience must not collapse contractor or alliance-partner isolation."),
    bullet("Stage breadth, then harden coherence. Recorded sequence can guide technical archaeology, but not productivity storytelling."),
    bullet("Triangulate external evidence. Positive, negative and mixed studies imply local experiments with confidence intervals and task segmentation. [1–9]"),
    bullet("Separate capability, deployment and outcome. They require different evidence."),
    h2("Conclusion"),
    para("The Cognirise repository records an unusually broad operating spine assembled in stages: growth intelligence, commercial and delivery control, finance, people, contracts, extended-workforce access, mobile and agentic administration. The strongest defensible story is architectural coherence and implemented breadth—not a claim of production transformation. [10]"),
    para("The next chapter is empirical: validate integrations, test access boundaries, instrument real workflows, compare assisted and unassisted performance, and report total cost and outcomes with uncertainty. That approach preserves ambition while meeting the evidence standard suggested by the mixed external literature. [1–9]"),
    callout("BOOK A DEMO", "See Atelier’s controlled workflow from research and pricing through delivery, finance and workforce self-service—and discuss an evidence-led pilot. Visit https://www.cognirise.ai"),
    docBreak(),
    h1("Appendix A. Evidence register"),
    table(["ID", "Claim / artifact", "Evidence class", "Permitted wording", "Do not infer"], [
      ["E1", "Repository chronology, 12 May–Aug 2026", "Commit history [10]", "Recorded / introduced / continued", "Deployment, effort, velocity or production use"],
      ["E2", "Capability domains listed in §4", "Implemented code [10]", "Code supports / implemented path", "Adoption, completeness, quality or outcome"],
      ["E3", "External e-sign, AI/search and other provider adapters", "Implemented integration code [10]", "Implemented-not-proven-live", "Successful connection or transaction"],
      ["E4", "Three-constituency model", "Code structure + design interpretation [10]", "Scoped surfaces and isolation code exist", "Production authorization effectiveness"],
      ["E5", "Senior-led differentiator", "Founder assertion", "Explicitly labeled assertion", "Independent validation"],
      ["E6", "AI productivity/capability context", "External studies [1–9]", "Study-specific result with scope", "Universal effect, local ROI or causal transfer"],
    ], [700, 2200, 1600, 2600, 2400]),
    h2("Claim-control checklist"),
    bullet("Repository claim carries [10] and uses “implemented,” “recorded” or “code supports.”"),
    bullet("Chronology carries the no-deployment/no-effort limitation."),
    bullet("Founder intent is labeled as assertion."),
    bullet("External result includes design, population or benchmark caveat."),
    bullet("Production outcome claims remain pending measured evidence."),
    docBreak(),
    h1("Endnotes"),
    ...sources.map(s => para(`[${s[0]}] ${s[5]}`, { size: 15, spacing: { after: 80, line: 245 } })),
    h1("Bibliography"),
    ...sources.map(s => new Paragraph({
      spacing: { after: 95, line: 235 },
      children: [
        r(`[${s[0]}] ${s[1]}. ${s[2]}. ${s[3]}. `, { size: 14 }),
        ...(s[4] ? [new ExternalHyperlink({ link: s[4], children: [r(s[4], { size: 14, color: C.blue, underline: {} })] })] : []),
        r(` ${s[5]}`, { size: 14, color: C.muted }),
      ],
    })),
  ];
  const doc = new Document({
    styles: {
      default: { document: { run: { font: BODY, size: 19, color: C.ink }, paragraph: { spacing: { line: 286 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: HEAD, size: 48, bold: true, color: C.navy }, paragraph: { spacing: { after: 300 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: HEAD, size: 31, bold: true, color: C.navy }, paragraph: { spacing: { before: 220, after: 130 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: HEAD, size: 23, bold: true, color: C.purple }, paragraph: { spacing: { before: 180, after: 90 } } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ data: logo, transformation: { width: 113, height: 30 }, type: "png" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [r("COGNIRISE  •  PUBLIC-SAFE CASE STUDY   ", { size: 14, color: C.muted }), r("PAGE ", { size: 14, color: C.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 14, color: C.muted })] })] }) },
      children,
    }],
  });
  await fs.writeFile(path.join(out, "Cognirise-Atelier-Agentic-Operating-System-Case-Study.docx"), await Packer.toBuffer(doc));
}

function addGradient(slide) {
  const colors = [C.blue, C.purple, C.magenta, C.coral];
  colors.forEach((color, i) => slide.addShape("rect", { x: 0.48 + i * 0.64, y: 0.43, w: 0.66, h: 0.07, line: { color, transparency: 100 }, fill: { color } }));
}
function addBrand(slide, n, dark = false) {
  slide.background = { color: dark ? C.deep : C.white };
  addGradient(slide);
  slide.addImage({ path: dark ? logoLight : logoDark, x: 10.85, y: 0.35, w: 1.72, h: 0.456 });
  slide.addText(String(n).padStart(2, "0"), { x: 12.35, y: 7.08, w: 0.45, h: 0.18, fontFace: BODY, fontSize: 8, color: dark ? "AAB3CE" : C.muted, align: "right", margin: 0 });
}
function title(slide, kicker, heading, sub, dark = false) {
  slide.addText(kicker.toUpperCase(), { x: 0.55, y: 0.7, w: 7.6, h: 0.25, fontFace: BODY, fontSize: 10, bold: true, charSpacing: 2, color: dark ? "9DBAFB" : C.purple, margin: 0 });
  slide.addText(heading, { x: 0.55, y: 1.02, w: 11.8, h: 0.68, fontFace: HEAD, fontSize: 25, bold: true, color: dark ? C.white : C.navy, margin: 0, breakLine: false });
  if (sub) slide.addText(sub, { x: 0.55, y: 1.72, w: 11.8, h: 0.38, fontFace: BODY, fontSize: 11.5, color: dark ? "C8CEE0" : C.muted, margin: 0 });
}
function panel(slide, x, y, w, h, heading, body, accent = C.blue, dark = false) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.06, line: { color: dark ? "31405F" : C.line, width: 0.8 }, fill: { color: dark ? "172442" : C.pale } });
  slide.addShape("rect", { x, y, w: 0.07, h, line: { transparency: 100 }, fill: { color: accent } });
  slide.addText(heading, { x: x + 0.22, y: y + 0.18, w: w - 0.4, h: 0.28, fontFace: HEAD, bold: true, fontSize: 13, color: dark ? C.white : C.navy, margin: 0, fit: "shrink" });
  slide.addText(body, { x: x + 0.22, y: y + 0.56, w: w - 0.42, h: h - 0.72, fontFace: BODY, fontSize: 10.2, color: dark ? "D9DEEA" : C.ink, margin: 0.01, breakLine: false, valign: "top", fit: "shrink", bullet: body.includes("\n") ? { type: "bullet" } : undefined, paraSpaceAfterPt: 5 });
}
function footer(slide, cite, dark = false) {
  slide.addText(cite, { x: 0.55, y: 6.96, w: 11.4, h: 0.28, fontFace: BODY, fontSize: 8.5, color: dark ? "BFC7D9" : C.muted, margin: 0, fit: "shrink" });
}
function notes(slide, context) {
  slide.addNotes(`${context}\n\nSOURCE REGISTER\n${sourceRegister}\n\nEvidence rule: repository evidence means implemented code only; history establishes ordering/recording, not deployment or effort. Integration paths are implemented-not-proven-live.`);
}
async function buildMainDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Cognirise"; pptx.subject = "Atelier agentic operating system case study"; pptx.title = "Atelier: the agentic operating system";
  pptx.company = "Cognirise"; pptx.lang = "en-US"; pptx.theme = { headFontFace: HEAD, bodyFontFace: BODY, lang: "en-US" };

  let s = pptx.addSlide(); addBrand(s, 1, true); title(s, "01 / Atelier case study", "One firm. One operating spine. Three constituencies.", "The founding problem was not “where can we add AI?” It was how Atelier could connect demand, delivery, money and people without losing control.", true);
  panel(s, .55, 2.35, 3.86, 3.55, "FRAGMENTATION RISK", "Research → CRM → pricing → contract → delivery → billing → cash\n\nPoint products can leave identity, data, approval and reporting seams.", C.blue, true);
  panel(s, 4.72, 2.35, 3.86, 3.55, "FOUNDING DESIGN QUESTION", "Buy a patchwork and integrate later—or own the differentiated workflow spine while integrating commodity services?", C.magenta, true);
  panel(s, 8.89, 2.35, 3.86, 3.55, "NON-NEGOTIABLE", "Employees, contractors and alliance partners need shared flow with distinct rights.\n\nConsequential math, state and approvals stay deterministic.", C.coral, true);
  s.addText("Strategic hypothesis—not a production-outcome claim", { x:.58,y:6.25,w:5.2,h:.28,fontFace:BODY,fontSize:10,bold:true,color:"9DBAFB",margin:0 });
  footer(s, "[10] Repository/history evidence through 5 Sep 2026. No deployment, effort or production outcomes inferred.", true);
  notes(s, "Story: frame the connected operating surface and the hybrid build-versus-buy decision. Founder intent is a labeled strategic hypothesis.");

  s = pptx.addSlide(); addBrand(s, 2); title(s, "02 / Strategic bet + external evidence", "Own the workflow and control plane; rent replaceable utilities.", "External evidence supports disciplined experimentation—not a universal productivity multiplier.");
  panel(s,.55,2.2,3.0,3.75,"THE BET","Own domain semantics, permissions, pricing/margin controls and capability catalog.\n\nIntegrate models, signature and other commodity services behind explicit adapters.",C.purple);
  panel(s,3.82,2.2,2.82,3.75,"POSITIVE SIGNALS","55.8% faster in a bounded JS task (95% CI 21–89%). [1]\n\n26.08% more completed tasks, pooled across 4,867 developers (SE 10.3); heterogeneous. [2]",C.blue);
  panel(s,6.91,2.2,2.82,3.75,"COUNTER-SIGNALS","DORA 2024: observational, mixed; lower throughput/stability associations. [3]\n\nMETR: 16 maintainers / 246 issues; AI-allowed 19% slower. [4]",C.magenta);
  panel(s,10.0,2.2,2.77,3.75,"TRAJECTORY ≠ ROI","Task horizon ~2× / 7 months; SWE-bench is capability, not ROI. [5,6]\n\n>280× inference-price decline ≠ enterprise TCO; frontier training cost ≠ assistant cost. [7,8]",C.coral);
  s.addText("DORA 2025: AI is an amplifier of organizational conditions; mixed-method/observational framing. [9]", { x:.55,y:6.25,w:12.2,h:.38,fontFace:BODY,fontSize:11,bold:true,color:C.navy,align:"center",margin:0 });
  footer(s, "[1–9] Study designs and populations differ; transfer to Cognirise requires local measurement.");
  notes(s, "Story: the bet is architectural. Present positive and negative findings together; emphasize bounded tasks, heterogeneity and observational limits.");

  s = pptx.addSlide(); addBrand(s, 3); title(s, "03 / Staged build + capability architecture", "A staged record from foundation to hardening", "Recorded chronology establishes order—not deployment, effort, velocity or production use. Capability labels mean implemented code. [10]");
  const stages = [["12 MAY\n~20:28","Foundation"],["BY ~21:57","Pre-contract"],["13 MAY\n~06:06","Delivery / process\nMVP closeout"],["THRU ~13:09","v2 CRM / pricing /\nsalon"],["13 MAY\nEVENING","v3 people /\ntime / wallet"],["13–14 MAY","CRM / reference\ncontinues"],["19–20 JUL","Mobile code\nintroduced"],["AUG","Design system /\nhardening"]];
  stages.forEach((q,i)=>{ const x=.55+i*1.53; s.addShape("ellipse",{x:x+.48,y:2.28,w:.28,h:.28,line:{color:i%2?C.magenta:C.blue},fill:{color:i%2?C.magenta:C.blue}}); if(i<7)s.addShape("line",{x:x+.75,y:2.42,w:1.25,h:0,line:{color:C.line,width:2}}); s.addText(q[0],{x,y:2.72,w:1.35,h:.38,fontFace:BODY,fontSize:8,bold:true,color:C.purple,align:"center",margin:0,fit:"shrink"}); s.addText(q[1],{x,y:3.18,w:1.35,h:.56,fontFace:BODY,fontSize:9.2,bold:true,color:C.navy,align:"center",margin:0,fit:"shrink"});});
  panel(s,.55,4.15,2.9,1.73,"GROW + COMMERCIAL","CRM / research agents\nPricing + margin\nEngagements / deliverables / change",C.blue);
  panel(s,3.66,4.15,2.9,1.73,"FINANCE","Billing / finance / GL\nPayroll / VAT / cash\nDeterministic controls",C.purple);
  panel(s,6.77,4.15,2.9,1.73,"PEOPLE + CONTRACTS","People lifecycle / Me\nContract lifecycle + e-sign path\nTime / wallet",C.magenta);
  panel(s,9.88,4.15,2.9,1.73,"ACCESS + EXPERIENCE","Contractor self-billing / scope\nAlliance portal isolation\nMobile + capability catalog",C.coral);
  s.addText("Experience → bounded agentic interaction → deterministic domain services → evidence & control → integration edge", { x:.65,y:6.25,w:12,h:.34,fontFace:HEAD,fontSize:12,bold:true,color:C.navy,align:"center",margin:0 });
  footer(s, "[10] Integration paths—including e-sign and external AI/search—are implemented-not-proven-live.");
  notes(s, "Story: use the canonical eight-stage chronology. The architecture spans experience, agentic interaction, deterministic services, evidence/control and external adapters.");

  s = pptx.addSlide(); addBrand(s, 4, true); title(s, "04 / Agentic operating model", "Three workspaces. Shared spine. Senior-led control.", "Assistants reduce navigation and synthesis burden; accountable owners retain commercial, people, legal and financial decisions.", true);
  panel(s,.55,2.2,3.86,3.25,"EMPLOYEES","Me self-service; people, time, wallet and contracts.\n\nAssistant retrieves or proposes; approved domain services execute.",C.blue,true);
  panel(s,4.72,2.2,3.86,3.25,"CONTRACTORS","Scoped access; time, expense and self-billing paths.\n\nLeast privilege + engagement scope + finance review.",C.magenta,true);
  panel(s,8.89,2.2,3.86,3.25,"ALLIANCE PARTNERS","Isolated portal with relevant delivery/commercial context.\n\nExplicit grants + partner-owner review + revocation.",C.coral,true);
  s.addShape("roundRect",{x:.55,y:5.75,w:12.2,h:.68,rectRadius:.06,line:{color:"394869"},fill:{color:"202F50"}});
  s.addText("SENIOR-LED GOVERNANCE", { x:.8,y:5.95,w:2.25,h:.22,fontFace:HEAD,fontSize:11,bold:true,color:"9DBAFB",margin:0 });
  s.addText("policy & decision rights  →  deterministic constraints  →  cataloged actions  →  confirmation / authorization  →  exceptions & assurance", { x:3.05,y:5.94,w:9.4,h:.25,fontFace:BODY,fontSize:10.2,color:C.white,margin:0,fit:"shrink" });
  footer(s, "[10] Scoped surfaces and isolation are evidenced in code; production authorization effectiveness is unverified.", true);
  notes(s, "Story: explain constituency-specific workspaces and common controls. The senior-led differentiator is a founder assertion until independently validated.");

  s = pptx.addSlide(); addBrand(s, 5); title(s, "05 / Evidenced trajectory", "Breadth is visible. Outcomes are the next experiment.", "The defensible case is implemented coherence and staged trajectory—not live deployment or transformation. [10]");
  panel(s,.55,2.18,3.86,3.62,"EVIDENCED","Eight-stage recorded chronology\n\nBroad cross-domain code surface\n\nDeterministic commercial/finance controls\n\nScoped workforce and partner experiences",C.blue);
  panel(s,4.72,2.18,3.86,3.62,"LESSONS","Design operating model before assistant\n\nKeep consequential math/state explicit\n\nTreat identity boundaries as architecture\n\nSeparate capability, deployment and outcome",C.purple);
  panel(s,8.89,2.18,3.86,3.62,"CAVEATS + NEXT PROOF","No live deployment or outcomes claimed\n\nValidate integrations and access boundaries\n\nMeasure time, success, rework, controls and full TCO\n\nReport uncertainty and task heterogeneity",C.coral);
  s.addShape("roundRect",{x:.55,y:6.08,w:12.2,h:.62,rectRadius:.06,line:{color:C.navy},fill:{color:C.navy}});
  s.addText("BOOK A DEMO", { x:.82,y:6.28,w:1.6,h:.2,fontFace:HEAD,fontSize:11,bold:true,color:C.white,margin:0 });
  s.addText("See Atelier’s controlled workflow—and shape an evidence-led pilot.  cognirise.ai", { x:2.65,y:6.27,w:8.9,h:.23,fontFace:BODY,fontSize:10.5,color:C.white,margin:0 });
  footer(s, "[1–10] Full source register and methodology caveats are included in speaker notes.");
  notes(s, "Story: conclude with what is evidenced, what was learned, what remains unproven and the measurement agenda. Invite an evidence-led demo/pilot.");
  await pptx.writeFile({ fileName: path.join(out, "Cognirise-Atelier-Agentic-Operating-System-Case-Study-5-Slide-Summary.pptx") });
}

async function buildExecutiveDeck() {
  const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.author = "Cognirise"; pptx.title = "Atelier agentic operating system — executive case"; pptx.theme = { headFontFace: HEAD, bodyFontFace: BODY, lang: "en-US" };
  const s = pptx.addSlide(); addBrand(s, 1, true);
  title(s, "Atelier / Executive case", "The agentic operating system for a senior-led firm", "One operating spine connecting demand, delivery, money and people—across employees, contractors and alliance partners.", true);
  panel(s,.55,2.12,2.28,2.92,"SITUATION","Fragmented tools risk seams across identity, approvals, commercial flow and reporting.",C.blue,true);
  panel(s,3.02,2.12,2.28,2.92,"INTERVENTION","Own workflow + control plane; place bounded agents above deterministic services; integrate utilities.",C.purple,true);
  panel(s,5.49,2.12,2.28,2.92,"BREADTH","CRM / research\nPricing / margin\nDelivery / change\nFinance / GL\nPayroll / VAT / cash\nPeople / contracts\nPortals / mobile",C.magenta,true);
  panel(s,7.96,2.12,2.28,2.92,"TRAJECTORY","Recorded from foundation (12 May) through staged expansion, mobile (19–20 Jul) and Aug hardening. [10]",C.coral,true);
  panel(s,10.43,2.12,2.35,2.92,"DIFFERENTIATOR","Founder assertion: senior practitioners define policy, decisions and exceptions—not unrestricted autonomy.",C.blue,true);
  s.addShape("roundRect",{x:.55,y:5.36,w:8.18,h:.92,rectRadius:.06,line:{color:"394869"},fill:{color:"202F50"}});
  s.addText("EVIDENCE BOUNDARY", {x:.8,y:5.58,w:1.75,h:.2,fontFace:HEAD,fontSize:10,bold:true,color:"9DBAFB",margin:0});
  s.addText("Implemented code and recorded order—not deployment, effort, adoption or outcomes. External integrations are implemented-not-proven-live. Mixed external evidence requires local measurement. [1–10]", {x:2.56,y:5.51,w:5.88,h:.42,fontFace:BODY,fontSize:9.3,color:C.white,margin:0,fit:"shrink"});
  s.addShape("roundRect",{x:8.95,y:5.36,w:3.83,h:.92,rectRadius:.06,line:{color:C.coral},fill:{color:C.coral}});
  s.addText("BOOK A DEMO", {x:9.22,y:5.55,w:1.45,h:.25,fontFace:HEAD,fontSize:11,bold:true,color:C.white,margin:0});
  s.addText("Shape an evidence-led pilot\ncognirise.ai", {x:10.62,y:5.48,w:1.88,h:.43,fontFace:BODY,fontSize:9.5,color:C.white,margin:0,fit:"shrink"});
  footer(s, "[1–9] External studies: bounded/heterogeneous/mixed and benchmark caveats. [10] Cognirise repository/history through 5 Sep 2026.", true);
  notes(s, "Standalone executive summary. Situation: connected professional-services work creates seams. Intervention: owned operating spine with bounded assistance and deterministic control. Breadth and chronology are repository-evidenced only. Senior-led differentiation is a founder assertion.");
  await pptx.writeFile({ fileName: path.join(out, "Cognirise-Atelier-Agentic-Operating-System-Executive-One-Slide.pptx") });
}

await fs.mkdir(out, { recursive: true });
await Promise.all([buildDocx(), buildMainDeck(), buildExecutiveDeck()]);
console.log("Generated task 1327 DOCX and two PPTX deliverables.");