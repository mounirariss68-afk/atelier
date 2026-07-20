/**
 * Atelier — Manage shell entity-lens definitions (Task #368).
 *
 * The top nav grew to 10 items mixing three concepts (managed entities, firm
 * IP/operations, personal landing). The Manage picker collapses the entity
 * group into five lifecycle-shaped lenses — Clients · People · Agents ·
 * Partners · Finance — and moves firm-IP/operations entries into the avatar
 * "Firm" submenu.
 *
 * This file is the single source of truth for: ids, labels, descriptions,
 * URL prefixes, keyboard shortcuts and persona defaults. Anything that needs
 * to render or reason about the picker should import from here.
 */

export type LensId =
  | "clients"
  | "people"
  | "agents"
  | "partners"
  | "finance"
  | "contracts"
  | "me";

export interface LensSection {
  /** Stable id for the section. */
  id: string;
  /** Label shown in the contextual section tabs slot. */
  label: string;
  /** URL the tab navigates to (lives under the lens prefix). */
  href: string;
}

export interface LensDef {
  id: LensId;
  label: string;
  prefix: string;
  description: string;
  shortcut: string;
  shortcutKey: "1" | "2" | "3" | "4" | "5" | "6" | "7";
  /**
   * Default section tabs the shell renders next to the picker before the
   * lens's own home page mounts. Each lens task replaces these with its
   * lifecycle-shaped tabs (e.g. People → Hire · Run · Develop · Off-board).
   */
  sections: readonly LensSection[];
  /**
   * Optional overflow sections rendered behind a "More ▾" dropdown at the
   * end of the tab strip. Used when a lens has cross-cutting pages that
   * would overcrowd the primary strip (e.g. People → Org, Access, Skills,
   * Time, Compliance, Approvals).
   */
  more?: readonly LensSection[];
}

export const LENSES: readonly LensDef[] = [
  {
    id: "clients",
    label: "Clients",
    prefix: "/clients",
    description: "Accounts, opportunities, engagements — the commercial loop.",
    shortcut: "⌘1",
    shortcutKey: "1",
    sections: [
      // Flat section IA: Overview · Accounts · Opportunities · Engagements
      // · Billing · References. Renewals/expansions live as a flag on each
      // opportunity, not a separate tab.
      { id: "overview", label: "Overview", href: "/clients" },
      { id: "accounts", label: "Accounts", href: "/clients/accounts" },
      { id: "opportunities", label: "Opportunities", href: "/clients/opportunities" },
      { id: "engagements", label: "Engagements", href: "/clients/deliver/engagements" },
      { id: "billing", label: "Billing", href: "/clients/billing" },
      { id: "references", label: "References", href: "/clients/references" },
    ],
  },
  {
    id: "people",
    label: "People",
    prefix: "/people",
    description: "Studio, roster, timesheets — hire, run, develop, off-board.",
    shortcut: "⌘2",
    shortcutKey: "2",
    sections: [
      { id: "overview", label: "Overview", href: "/people" },
      { id: "roster", label: "Roster", href: "/people/people" },
      { id: "attract", label: "Attract", href: "/people/attract" },
      { id: "hire", label: "Hire", href: "/people/hire" },
      { id: "onboard", label: "Onboard", href: "/people/onboard" },
      { id: "develop", label: "Develop", href: "/people/develop" },
      { id: "perform", label: "Perform", href: "/people/perform" },
      { id: "reward", label: "Reward", href: "/people/reward" },
      { id: "retain", label: "Retain", href: "/people/retain" },
      { id: "offboard", label: "Offboard", href: "/people/offboard" },
    ],
    // Cross-cutting People modules — reachable but out of the primary
    // lifecycle strip so it doesn't overcrowd.
    more: [
      { id: "org", label: "Org chart", href: "/people/org" },
      { id: "access", label: "Access", href: "/people/access" },
      { id: "skills", label: "Skills", href: "/people/skills" },
      { id: "time", label: "Time", href: "/people/time" },
      { id: "compliance", label: "Compliance", href: "/people/compliance" },
      { id: "approvals", label: "Approvals", href: "/people/approvals" },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    prefix: "/agents",
    description: "Agent library, runs, evaluations — design to retire.",
    shortcut: "⌘3",
    shortcutKey: "3",
    sections: [
      { id: "design", label: "Design", href: "/agents/design" },
      { id: "build", label: "Build", href: "/agents/build" },
      { id: "evaluate", label: "Evaluate", href: "/agents/evaluate" },
      { id: "deploy", label: "Deploy", href: "/agents/deploy" },
      { id: "monitor", label: "Monitor", href: "/agents/monitor" },
      { id: "improve", label: "Improve", href: "/agents/improve" },
      { id: "retire", label: "Retire", href: "/agents/retire" },
    ],
  },
  {
    id: "partners",
    label: "Partners",
    prefix: "/partners",
    description: "Alliances and partner firms — identify to renew.",
    shortcut: "⌘4",
    shortcutKey: "4",
    sections: [
      { id: "identify", label: "Identify", href: "/partners/identify" },
      { id: "qualify", label: "Qualify", href: "/partners/qualify" },
      { id: "co-sell", label: "Co-sell", href: "/partners/co-sell" },
      { id: "co-deliver", label: "Co-deliver", href: "/partners/co-deliver" },
      { id: "govern", label: "Govern", href: "/partners/govern" },
      { id: "renew", label: "Renew", href: "/partners/renew" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    prefix: "/finance",
    description: "Entities, ledgers, FP&A, close, comply.",
    shortcut: "⌘5",
    shortcutKey: "5",
    sections: [
      { id: "overview", label: "Overview", href: "/finance" },
      { id: "entities", label: "Entities", href: "/finance/entities" },
      { id: "ledger", label: "Record", href: "/finance/ledger" },
      { id: "billing", label: "Bill & Collect", href: "/finance/billing" },
      { id: "payables", label: "Pay", href: "/finance/payables" },
      { id: "close", label: "Close", href: "/finance/close" },
      { id: "plan", label: "Plan", href: "/finance/plan" },
      { id: "reports", label: "Report", href: "/finance/reports" },
      { id: "comply", label: "Comply", href: "/finance/comply" },
    ],
  },
  {
    // Task #274 — Contracts lens: the unified contract journey (draft
    // from template → send for signature → signed & archived) promoted
    // out of the avatar → Firm menu. Partner-tier only (see
    // visibleLensesForRole). The e-sign surface (former Agreements page)
    // is the "Out for Signature" section; the CLM register (former
    // Codex) lives under the More ▾ overflow.
    id: "contracts",
    label: "Contracts",
    prefix: "/contracts",
    description: "Templates, drafts, e-signature, executed contracts.",
    shortcut: "⌘6",
    shortcutKey: "6",
    sections: [
      { id: "overview", label: "Overview", href: "/contracts" },
      { id: "templates", label: "Templates", href: "/contracts/templates" },
      { id: "drafts", label: "Drafts", href: "/contracts/drafts" },
      { id: "signatures", label: "Out for Signature", href: "/contracts/signatures" },
      { id: "active", label: "Active", href: "/contracts/active" },
      { id: "archive", label: "Archive", href: "/contracts/archive" },
    ],
    more: [
      { id: "codex", label: "CLM Register", href: "/contracts/codex" },
      { id: "dpas", label: "DPAs", href: "/contracts/codex/dpas" },
      { id: "renewals", label: "Renewals", href: "/contracts/codex/renewals" },
    ],
  },
  {
    // Task #50 — the self-service lens. Visible to every persona; the ONLY
    // lens for the self-only personas (role employee / contractor).
    id: "me",
    label: "Me",
    prefix: "/me",
    description: "Your profile, time, expenses, pay, performance, learning.",
    shortcut: "⌘7",
    shortcutKey: "7",
    sections: [
      { id: "overview", label: "Overview", href: "/me" },
      { id: "profile", label: "Profile", href: "/me/profile" },
      { id: "time", label: "Time", href: "/me/time" },
      { id: "expenses", label: "Expenses", href: "/me/expenses" },
      { id: "pay", label: "Pay & Benefits", href: "/me/pay" },
      { id: "performance", label: "Performance", href: "/me/performance" },
      { id: "learning", label: "Learning", href: "/me/learning" },
      // Task #386 — role-gated in LensSectionTabs: Delegates is
      // partner-tier only; Assist is the EA workspace (self-only roles).
      { id: "delegates", label: "Delegates", href: "/me/delegates" },
      { id: "assist", label: "Assist", href: "/me/assist" },
    ],
  },
] as const;

/**
 * Task #50 — personas whose world is ONLY the Me lens. They cannot see the
 * five org-wide lenses in the picker (the server enforces the same boundary
 * on /api/atelier — see the non-employee middleware in routes/atelier).
 */
export function isSelfOnlyRole(role: string | null | undefined): boolean {
  return role === "employee" || role === "contractor";
}

/** Task #274 — the Contracts lens is partner-tier only. */
export function canSeeContractsLens(role: string | null | undefined): boolean {
  return role === "founding_partner" || role === "partner";
}

/** Lenses the picker should offer this persona. */
export function visibleLensesForRole(
  role: string | null | undefined,
): readonly LensDef[] {
  if (isSelfOnlyRole(role)) return LENSES.filter((l) => l.id === "me");
  if (!canSeeContractsLens(role)) {
    return LENSES.filter((l) => l.id !== "contracts");
  }
  return LENSES;
}

const LENS_BY_ID: Record<LensId, LensDef> = LENSES.reduce(
  (acc, l) => ({ ...acc, [l.id]: l }),
  {} as Record<LensId, LensDef>,
);

export function getLens(id: LensId): LensDef {
  return LENS_BY_ID[id];
}

/**
 * Resolve a URL pathname to a lens id by prefix match. Returns null if the
 * path does not belong to any lens (e.g. Home `/`, firm-menu items like
 * `/atelier`, `/press`, `/wallet`, etc.).
 */
export function lensFromPath(pathname: string): LensId | null {
  for (const l of LENSES) {
    if (pathname === l.prefix || pathname.startsWith(l.prefix + "/")) {
      return l.id;
    }
  }
  return null;
}

/**
 * Persona → default lens. Used the very first time a user visits the app
 * before they've touched the picker. After that, the persisted choice wins.
 *
 * The spec calls out: Partner/BD → Clients, People Ops/HR → People,
 * Agent Ops → Agents, Alliance Lead → Partners, Finance/Controller →
 * Finance, anyone else → Clients. The 9-persona model in personaRoles.ts
 * doesn't have dedicated Agent Ops / Alliance Lead personas yet, so the
 * mapping below keeps the explicit categorical defaults (finance, hr,
 * recruiter, partner_firm_resource → Partners since PFRs work with
 * partner firms) and falls back to Clients for the commercial-loop
 * personas. We also accept future role ids by string match so that when
 * `agent_ops` and `alliance_lead` personas are introduced they slot
 * straight into Agents / Partners without another shell change.
 */
export function defaultLensForRole(role: string | null | undefined): LensId {
  if (!role) return "clients";
  // Task #50 — self-only personas land on (and stay in) the Me lens.
  if (isSelfOnlyRole(role)) return "me";
  // Forward-compatible matches for personas that don't exist in the
  // 9-persona model yet but are named in the spec.
  if (role.includes("agent_ops") || role === "agent_ops") return "agents";
  if (role.includes("alliance") || role === "alliance_lead") return "partners";
  switch (role) {
    case "finance":
      return "finance";
    case "hr":
    case "recruiter":
      return "people";
    case "partner_firm_resource":
      return "partners";
    case "founding_partner":
    case "partner":
    case "senior_manager":
    case "consultant":
    case "contractor":
    case "board_observer":
    case "compliance_officer":
    default:
      return "clients";
  }
}

export function lensStorageKey(userId: string): string {
  return `atelier.activeLens.${userId}`;
}
