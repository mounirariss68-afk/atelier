/**
 * Task #939 — generate lib/screen-catalog/src/catalog.ts from the web
 * app's REAL nav definitions (lens.ts + peopleLifecycle.ts) so the chat
 * assistant's screen answers can never drift from the actual UI.
 *
 *   pnpm --filter @workspace/atelier run generate:screen-catalog
 *   pnpm --filter @workspace/atelier run test:screen-catalog   (--check)
 *
 * `--check` regenerates in-memory and diffs against the committed file;
 * a mismatch exits 1 (the drift guard). Role visibility is computed by
 * evaluating the SAME functions the lens picker uses
 * (visibleLensesForRole) across the persona-role list.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import {
  LENSES,
  meSectionVisibleForRole,
  clientsSectionVisibleForRole,
  visibleLensesForRole,
  type LensDef,
} from "../src/lib/lens";

// Mirror of ATELIER_PERSONA_ROLES (api-server routes/atelier/personaRoles.ts)
// minus alliance_partner, whose world is only the partner portal + chat.
const INTERNAL_ROLES = [
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
  "contractor",
  "partner_firm_resource",
  "board_observer",
  "recruiter",
  "compliance_officer",
  "employee",
  // Task #1297 — NEP: Me lens + slimmed Clients lens only.
  "non_equity_partner",
] as const;

// Personas whose whole world is the Me lens (server-enforced central gate).
const SELF_SCOPE = new Set([
  "employee",
  "contractor",
  "partner_firm_resource",
  // Task #1297 — NEPs get NO firm-ops / home / reports surfaces; their
  // extra Clients tabs come from the lens/section gates below.
  "non_equity_partner",
]);
// Firm-ops surfaces (avatar → Firm menu etc.) — internal org roles only.
const ORG_ROLES = INTERNAL_ROLES.filter(
  (r) => !SELF_SCOPE.has(r) && r !== "board_observer",
);
const ALL_ROLES = [...INTERNAL_ROLES, "alliance_partner"];

interface Entry {
  id: string;
  title: string;
  description: string;
  path: string;
  breadcrumb: string[];
  keywords: string[];
  roles: string[];
  parameterized: boolean;
}

// Curated synonym boosts per screen id — plain words users actually say.
const KEYWORDS: Record<string, string[]> = {
  "clients.overview": ["crm", "client", "dashboard"],
  "clients.accounts": ["client", "company", "customer", "crm"],
  "clients.opportunities": ["pipeline", "deal", "deals", "sales", "pursuit"],
  "clients.engagements": ["project", "projects", "delivery", "deliverables"],
  "clients.billing": ["invoice", "invoices", "collect"],
  "clients.references": ["win", "loss", "library", "case", "study"],
  "people.roster": ["directory", "team", "staff", "employees"],
  "people.hire": ["recruiting", "candidates", "interviews", "offers"],
  "people.time": ["timesheet", "timesheets", "utilization", "hours"],
  "people.compliance": ["passport", "visa", "documents", "expiry"],
  "people.approvals": ["approve", "pending", "requests"],
  "people.reward": ["pay", "salary", "compensation", "bank"],
  "agents.monitor": ["runs", "status"],
  "finance.entities": ["legal", "entity", "registry"],
  "finance.ledger": ["journal", "journals", "gl", "bookkeeping"],
  "finance.billing": ["invoice", "invoices", "collections", "receivables", "ar"],
  "finance.payables": ["bills", "vendors", "payments", "ap"],
  "finance.close": ["period", "month", "end"],
  "finance.plan": ["budget", "forecast", "fpa", "cash"],
  "finance.reports": ["statement", "pnl", "balance", "sheet"],
  "finance.comply": ["tax", "vat", "filings", "statutory"],
  "contracts.templates": ["template"],
  "contracts.signatures": ["esign", "signature", "signing", "docuseal"],
  "contracts.codex": ["clm", "register", "clauses"],
  "me.overview": ["home", "personal"],
  "me.profile": ["name", "photo", "details", "preferences"],
  "me.time": ["timesheet", "timesheets", "hours", "log"],
  "me.expenses": ["receipt", "receipts", "claim", "claims", "reimbursement", "spend"],
  "me.pay": ["payslip", "payslips", "salary", "benefits", "bank"],
  "me.performance": ["review", "goals", "feedback"],
  "me.learning": ["training", "courses", "certifications"],
  "me.delegates": ["assistant", "ea", "delegation"],
  "me.assist": ["ea", "workspace", "acting"],
};

function kw(id: string): string[] {
  return KEYWORDS[id] ?? [];
}

function lensRoles(lens: LensDef): string[] {
  return INTERNAL_ROLES.filter((r) =>
    visibleLensesForRole(r).some((l) => l.id === lens.id),
  );
}

function build(): Entry[] {
  const entries: Entry[] = [];

  for (const lens of LENSES) {
    const roles = lensRoles(lens);
    const sections = [...lens.sections, ...(lens.more ?? [])];
    for (const s of sections) {
      const id = `${lens.id}.${s.id}`;
      // Role-gated Me tabs (Task #943): the gating comes from the SAME
      // shared definition the top-bar menu uses (lens.ts
      // meSectionVisibleForRole), so the two cannot drift.
      const sectionRoles =
        lens.id === "me"
          ? roles.filter((r) => meSectionVisibleForRole(s.id, r))
          : lens.id === "clients"
            ? // Task #1297 — NEPs only get the Accounts/Opportunities tabs.
              roles.filter((r) => clientsSectionVisibleForRole(s.id, r))
            : roles;
      entries.push({
        id,
        title: s.label,
        description: `${s.label} — inside the ${lens.label} area (${lens.description})`,
        path: s.href,
        breadcrumb: [lens.label, s.label],
        keywords: kw(id),
        roles: sectionRoles,
        parameterized: false,
      });
    }
  }

  const nonSelf = INTERNAL_ROLES.filter((r) => !SELF_SCOPE.has(r));
  const extras: Entry[] = [
    { id: "app.home", title: "Home", description: "Your landing dashboard with suggestions and quick links.", path: "/", breadcrumb: ["Home"], keywords: ["dashboard", "start", "landing"], roles: [...nonSelf], parameterized: false },
    { id: "app.chat", title: "Riser (chat assistant)", description: "The chat assistant — ask questions and take actions in plain language.", path: "/cli", breadcrumb: ["Riser"], keywords: ["assistant", "chat", "riser", "ask"], roles: ALL_ROLES, parameterized: false },
    { id: "app.reports", title: "Reports", description: "Cross-firm reports and analytics.", path: "/reports", breadcrumb: ["Reports"], keywords: ["analytics", "kpi", "metrics"], roles: [...nonSelf], parameterized: false },
    { id: "app.documents", title: "Document Library", description: "The firm-wide document library — upload, search, and manage documents.", path: "/documents", breadcrumb: ["Documents"], keywords: ["files", "library", "upload", "search"], roles: [...ORG_ROLES], parameterized: false },
    { id: "app.winloss", title: "Win/Loss Debriefs", description: "Win/loss debrief intake and review.", path: "/win-loss", breadcrumb: ["Win/Loss"], keywords: ["debrief", "postmortem", "lost", "won"], roles: [...ORG_ROLES], parameterized: false },
    { id: "app.atelier", title: "Atelier (Firm IP)", description: "Firm IP catalog, methods and assets.", path: "/atelier", breadcrumb: ["Firm", "Atelier"], keywords: ["ip", "methods", "assets", "catalog"], roles: [...ORG_ROLES], parameterized: false },
    { id: "app.firmprofile", title: "Firm Profile", description: "Firm identity, legal entities, signing and letterhead settings.", path: "/atelier/firm-profile", breadcrumb: ["Firm", "Firm Profile"], keywords: ["legal", "entities", "letterhead", "brand", "signing"], roles: ["founding_partner", "partner", "finance"], parameterized: false },
    { id: "app.press", title: "Press", description: "Press and public-relations workspace.", path: "/press", breadcrumb: ["Firm", "Press"], keywords: ["pr", "media", "news"], roles: [...ORG_ROLES], parameterized: false },
    { id: "app.guardhouse", title: "Guardhouse", description: "Security, audit and compliance evidence console.", path: "/guardhouse", breadcrumb: ["Firm", "Guardhouse"], keywords: ["security", "audit", "access", "reviews", "incidents"], roles: ["founding_partner", "partner", "compliance_officer"], parameterized: false },
    // Alliance-partner portal (external logins, Task #873).
    { id: "partnerportal.home", title: "Shared Opportunities", description: "Opportunities your firm has been granted access to.", path: "/partner", breadcrumb: ["Partner Portal", "Opportunities"], keywords: ["portal", "granted", "shared", "deals"], roles: ["alliance_partner"], parameterized: false },
    { id: "partnerportal.contracts", title: "Contracts", description: "Your firm's agreements with Cognirise.", path: "/partner/contracts", breadcrumb: ["Partner Portal", "Contracts"], keywords: ["agreement", "nda", "signed"], roles: ["alliance_partner"], parameterized: false },
    { id: "partnerportal.billing", title: "Billing", description: "Your firm's invoices and payment status.", path: "/partner/billing", breadcrumb: ["Partner Portal", "Billing"], keywords: ["invoice", "invoices", "payment"], roles: ["alliance_partner"], parameterized: false },
    // Parameterized workspaces — described, never direct-linked.
    { id: "workspace.account", title: "Account workspace", description: "One client account's workspace: profile, contacts, strategy, procurement, coverage.", path: "/accounts/:accountId", breadcrumb: ["Clients", "Accounts", "(open an account)"], keywords: ["client", "company", "detail", "contacts", "strategy"], roles: lensRoles(LENSES.find((l) => l.id === "clients")!), parameterized: true },
    { id: "workspace.opportunity", title: "Opportunity workspace", description: "One opportunity's workspace: qualification, pricing, proposal, tasks and RAID items.", path: "/opportunities/:oppId", breadcrumb: ["Clients", "Opportunities", "(open an opportunity)"], keywords: ["deal", "task", "tasks", "raid", "risk", "pricing", "proposal", "qualification"], roles: lensRoles(LENSES.find((l) => l.id === "clients")!), parameterized: true },
    { id: "workspace.engagement", title: "Engagement workspace", description: "One engagement's workspace: deliverables, tasks and RAID items, meetings, economics.", path: "/engagements/:engId", breadcrumb: ["Clients", "Engagements", "(open an engagement)"], keywords: ["project", "delivery", "task", "tasks", "raid", "deliverable", "deliverables"], roles: lensRoles(LENSES.find((l) => l.id === "clients")!), parameterized: true },
    { id: "workspace.person", title: "Person profile", description: "One person's roster profile: details, documents, payroll, skills.", path: "/roster/people/:id", breadcrumb: ["People", "Roster", "(open a person)"], keywords: ["profile", "employee", "roster", "person"], roles: lensRoles(LENSES.find((l) => l.id === "people")!), parameterized: true },
  ];
  entries.push(...extras);

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

function render(entries: Entry[]): string {
  return `/**
 * GENERATED FILE — DO NOT EDIT.
 * Regenerate: pnpm --filter @workspace/atelier run generate:screen-catalog
 * Drift guard: pnpm --filter @workspace/atelier run test:screen-catalog
 */
import type { ScreenEntry } from "./index.js";

export const SCREEN_CATALOG: readonly ScreenEntry[] = ${JSON.stringify(entries, null, 2)};
`;
}

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../../lib/screen-catalog/src/catalog.ts");
const next = render(build());

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    /* missing file = drift */
  }
  if (current !== next) {
    console.error(
      "screen-catalog DRIFT: nav definitions changed but lib/screen-catalog/src/catalog.ts was not regenerated.\n" +
        "Run: pnpm --filter @workspace/atelier run generate:screen-catalog",
    );
    process.exit(1);
  }
  console.log("screen-catalog: in sync ✓");
} else {
  writeFileSync(target, next);
  console.log(`screen-catalog: wrote ${target}`);
}
