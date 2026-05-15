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

export type LensId = "clients" | "people" | "agents" | "partners" | "finance";

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
  shortcutKey: "1" | "2" | "3" | "4" | "5";
  /**
   * Default section tabs the shell renders next to the picker before the
   * lens's own home page mounts. Each lens task replaces these with its
   * lifecycle-shaped tabs (e.g. People → Hire · Run · Develop · Off-board).
   */
  sections: readonly LensSection[];
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
      // Task #369 — Clients lens lifecycle stages.
      { id: "overview", label: "Overview", href: "/clients" },
      { id: "prospect", label: "Prospect", href: "/clients/prospect" },
      { id: "pursue", label: "Pursue", href: "/clients/pursue" },
      { id: "win", label: "Win", href: "/clients/win" },
      { id: "deliver", label: "Deliver", href: "/clients/deliver" },
      { id: "bill", label: "Bill", href: "/clients/bill" },
      { id: "renew", label: "Renew", href: "/clients/renew" },
      { id: "reference", label: "Reference", href: "/clients/reference" },
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
      { id: "studio", label: "Studio", href: "/studio" },
      { id: "roster", label: "Roster", href: "/roster/people" },
      { id: "timesheets", label: "Timesheets", href: "/ledger/timesheets" },
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
      { id: "ledger", label: "Ledger", href: "/ledger" },
      { id: "economics", label: "Economics", href: "/ledger/firm-economics" },
    ],
  },
] as const;

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
