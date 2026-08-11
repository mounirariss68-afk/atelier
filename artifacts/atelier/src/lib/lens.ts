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

import { STAGES as PEOPLE_STAGES } from "@/pages/people/peopleLifecycle";
import {
  Archive,
  Banknote,
  BarChart3,
  BookMarked,
  BookOpen,
  Briefcase,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Clock,
  DoorOpen,
  FileCheck2,
  FilePen,
  FileText,
  Filter,
  FlaskConical,
  Gauge,
  Gift,
  GraduationCap,
  Hammer,
  Handshake,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lock,
  Magnet,
  Network,
  Package,
  PenLine,
  PenTool,
  Quote,
  RefreshCw,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  User,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  Receipt,
  Activity,
  type LucideIcon,
} from "lucide-react";

/**
 * Task #956 — icons for the People lifecycle strip. The strip itself is
 * generated from `peopleLifecycle.STAGES`, so icons are keyed by stage id
 * here (nav concerns stay in lens.ts; peopleLifecycle stays icon-free).
 */
const PEOPLE_STAGE_ICONS: Record<string, LucideIcon> = {
  attract: Magnet,
  hire: UserPlus,
  onboard: DoorOpen,
  develop: GraduationCap,
  perform: Gauge,
  reward: Gift,
  offboard: UserMinus,
};

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
  /** Task #956 — lucide icon rendered before the label in the nav. */
  icon: LucideIcon;
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
      { id: "overview", label: "Overview", href: "/clients", icon: LayoutDashboard },
      { id: "accounts", label: "Accounts", href: "/clients/accounts", icon: Building2 },
      { id: "opportunities", label: "Opportunities", href: "/clients/opportunities", icon: Target },
      { id: "engagements", label: "Engagements", href: "/clients/deliver/engagements", icon: Briefcase },
      { id: "billing", label: "Billing", href: "/clients/billing", icon: Receipt },
      { id: "references", label: "References", href: "/clients/references", icon: Quote },
    ],
  },
  {
    id: "people",
    label: "People",
    prefix: "/people",
    description: "Studio, roster, timesheets — hire, run, develop, off-board.",
    shortcut: "⌘2",
    shortcutKey: "2",
    // Nav defined once (Task #509): the lifecycle strip derives from
    // peopleLifecycle.STAGES so the two nav configs can't drift.
    sections: [
      { id: "overview", label: "Overview", href: "/people", icon: LayoutDashboard },
      { id: "roster", label: "Roster", href: "/people/people", icon: Users },
      ...PEOPLE_STAGES.map((s) => ({
        id: s.id,
        label: s.label,
        href: s.href,
        icon: PEOPLE_STAGE_ICONS[s.id] ?? Users,
      })),
    ],
    // Cross-cutting People modules — reachable but out of the primary
    // lifecycle strip so it doesn't overcrowd.
    more: [
      { id: "access", label: "Access", href: "/people/access", icon: KeyRound },
      { id: "skills", label: "Skills", href: "/people/skills", icon: Network },
      { id: "time", label: "Time", href: "/people/time", icon: Clock },
      { id: "compliance", label: "Compliance", href: "/people/compliance", icon: ShieldCheck },
      { id: "approvals", label: "Approvals", href: "/people/approvals", icon: ClipboardCheck },
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
      { id: "design", label: "Design", href: "/agents/design", icon: PenTool },
      { id: "build", label: "Build", href: "/agents/build", icon: Hammer },
      { id: "evaluate", label: "Evaluate", href: "/agents/evaluate", icon: FlaskConical },
      { id: "deploy", label: "Deploy", href: "/agents/deploy", icon: Rocket },
      { id: "monitor", label: "Monitor", href: "/agents/monitor", icon: Activity },
      { id: "improve", label: "Improve", href: "/agents/improve", icon: TrendingUp },
      { id: "retire", label: "Retire", href: "/agents/retire", icon: Archive },
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
      { id: "identify", label: "Identify", href: "/partners/identify", icon: Search },
      { id: "qualify", label: "Qualify", href: "/partners/qualify", icon: Filter },
      { id: "co-sell", label: "Co-sell", href: "/partners/co-sell", icon: Handshake },
      { id: "co-deliver", label: "Co-deliver", href: "/partners/co-deliver", icon: Package },
      { id: "govern", label: "Govern", href: "/partners/govern", icon: Scale },
      { id: "renew", label: "Renew", href: "/partners/renew", icon: RefreshCw },
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
      { id: "overview", label: "Overview", href: "/finance", icon: LayoutDashboard },
      { id: "entities", label: "Entities", href: "/finance/entities", icon: Landmark },
      { id: "ledger", label: "Record", href: "/finance/ledger", icon: BookOpen },
      { id: "billing", label: "Bill & Collect", href: "/finance/billing", icon: Receipt },
      { id: "payables", label: "Pay", href: "/finance/payables", icon: Banknote },
      { id: "close", label: "Close", href: "/finance/close", icon: Lock },
      { id: "plan", label: "Plan", href: "/finance/plan", icon: CalendarRange },
      { id: "reports", label: "Report", href: "/finance/reports", icon: BarChart3 },
      { id: "comply", label: "Comply", href: "/finance/comply", icon: ShieldCheck },
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
      { id: "overview", label: "Overview", href: "/contracts", icon: LayoutDashboard },
      { id: "templates", label: "Templates", href: "/contracts/templates", icon: FileText },
      { id: "drafts", label: "Drafts", href: "/contracts/drafts", icon: FilePen },
      { id: "signatures", label: "Out for Signature", href: "/contracts/signatures", icon: PenLine },
      { id: "active", label: "Active", href: "/contracts/active", icon: FileCheck2 },
      { id: "archive", label: "Archive", href: "/contracts/archive", icon: Archive },
    ],
    more: [
      { id: "codex", label: "CLM Register", href: "/contracts/codex", icon: BookMarked },
      { id: "dpas", label: "DPAs", href: "/contracts/codex/dpas", icon: ShieldCheck },
      { id: "renewals", label: "Renewals", href: "/contracts/codex/renewals", icon: RefreshCw },
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
      { id: "overview", label: "Overview", href: "/me", icon: LayoutDashboard },
      { id: "profile", label: "Profile", href: "/me/profile", icon: User },
      { id: "time", label: "Time", href: "/me/time", icon: Clock },
      { id: "expenses", label: "Expenses", href: "/me/expenses", icon: Receipt },
      { id: "pay", label: "Pay & Benefits", href: "/me/pay", icon: Wallet },
      { id: "performance", label: "Performance", href: "/me/performance", icon: Gauge },
      { id: "learning", label: "Learning", href: "/me/learning", icon: GraduationCap },
      // Task #386 — role-gated in LensSectionTabs: Delegates is
      // partner-tier only; Assist is the EA workspace (self-only roles).
      { id: "delegates", label: "Delegates", href: "/me/delegates", icon: Users },
      { id: "assist", label: "Assist", href: "/me/assist", icon: Sparkles },
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

/**
 * Task #873 — external alliance-partner portal logins. Their world is
 * ONLY /partner (assigned opportunities + redacted client overview) and
 * /cli. No lenses, no Me lens, no org rail — the server forbids every
 * other route at the central gate.
 */
export function isAlliancePartnerRole(role: string | null | undefined): boolean {
  return role === "alliance_partner";
}

/** Task #274 — the Contracts lens is partner-tier only. */
export function canSeeContractsLens(role: string | null | undefined): boolean {
  return role === "founding_partner" || role === "partner";
}

/**
 * Task #513 — the Partners lens (firm-wide alliance intel) is internal-only.
 * Mirrors `canAccessPartnersLens` on the server: partner-tier, consultant-
 * tier, finance, hr, compliance_officer. Partner-firm resources and
 * recruiters must not see it.
 */
export function canSeePartnersLens(role: string | null | undefined): boolean {
  return (
    role === "founding_partner" ||
    role === "partner" ||
    role === "senior_manager" ||
    role === "consultant" ||
    role === "finance" ||
    role === "hr" ||
    role === "compliance_officer"
  );
}

/** Lenses the picker should offer this persona. */
export function visibleLensesForRole(
  role: string | null | undefined,
): readonly LensDef[] {
  if (isSelfOnlyRole(role)) return LENSES.filter((l) => l.id === "me");
  let out: readonly LensDef[] = LENSES;
  if (!canSeeContractsLens(role)) {
    out = out.filter((l) => l.id !== "contracts");
  }
  if (!canSeePartnersLens(role)) {
    out = out.filter((l) => l.id !== "partners");
  }
  return out;
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
 * recruiter; partner_firm_resource → Me per Task #513 — PFRs are
 * external and never see firm-wide alliance intel) and falls back to
 * Clients for the commercial-loop personas. We also accept future role ids by string match so that when
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
    // Task #513 — PFRs must NOT land on the internal Partners lens; they
    // are self-scope personas and default to Me.
    case "partner_firm_resource":
      return "me";
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
