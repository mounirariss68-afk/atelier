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

import { PEOPLE_MVP_SECTIONS, ME_MVP_SECTIONS } from "./peopleMeMvp";
import {
  Archive,
  Banknote,
  BarChart3,
  Bot,
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
  Inbox,
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
      ...PEOPLE_MVP_SECTIONS.map((s) => ({
        ...s,
        icon: s.id === "roster" ? Users : s.id === "time" ? Clock : ClipboardCheck,
      })),
    ],
  },
  {
    id: "agents",
    label: "Agents",
    prefix: "/agents",
    description: "Executable agents, persisted runs, and operator decisions.",
    shortcut: "⌘3",
    shortcutKey: "3",
    sections: [
      { id: "catalogue", label: "Catalogue", href: "/agents", icon: Bot },
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
    description: "Entities, money in and out, reconciliation, and performance.",
    shortcut: "⌘5",
    shortcutKey: "5",
    sections: [
      { id: "overview", label: "Overview", href: "/finance", icon: LayoutDashboard },
      { id: "entities", label: "Entities", href: "/finance/entities", icon: Landmark },
      { id: "money-out", label: "Money out", href: "/finance/money-out", icon: Receipt },
      { id: "money-in", label: "Money in", href: "/finance/money-in", icon: Banknote },
      { id: "reconcile", label: "Reconcile", href: "/finance/reconcile", icon: RefreshCw },
      { id: "reports", label: "Reports", href: "/finance/reports", icon: BarChart3 },
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
    sections: ME_MVP_SECTIONS.map((s) => ({
      ...s,
      icon:
        s.id === "overview" ? LayoutDashboard :
        s.id === "profile" ? User :
        s.id === "time" ? Clock :
        s.id === "expenses" ? Receipt : Wallet,
    })),
  },
] as const;

/**
 * Task #943 — single shared definition of the role-gated Me-lens tabs.
 * Both the top-bar menu (ManagePicker's LensSectionTabs) and the
 * screen-catalog generator import THIS function, so the role rules can
 * never drift between the two.
 *
 * Rules (Tasks #50/#242/#386):
 *  • performance — hidden for contractors (server 403s reviews/goals too)
 *  • delegates   — partner-tier only (partner / founding_partner)
 *  • assist      — the EA workspace, self-only personas (employee / contractor)
 *  • everything else — visible to every role that can see the Me lens
 */
export function meSectionVisibleForRole(
  sectionId: string,
  role: string | null | undefined,
): boolean {
  return ME_MVP_SECTIONS.some((section) => section.id === sectionId);
}

/**
 * The six founder-facing Finance destinations are safe for every role that can
 * see the Finance lens. Sensitive mutations remain gated by their pages and
 * server routes; advanced direct routes stay available without appearing here.
 */
export function financeSectionVisibleForRole(
  _sectionId: string,
  _role: string | null | undefined,
): boolean {
  return true;
}

/** The Me lens's section tabs filtered by the shared role gating above. */
export function visibleMeSectionsForRole(
  role: string | null | undefined,
): readonly LensSection[] {
  const me = LENSES.find((l) => l.id === "me")!;
  return me.sections.filter((s) => meSectionVisibleForRole(s.id, role));
}

/**
 * Task #50 — personas whose world is ONLY the Me lens. They cannot see the
 * five org-wide lenses in the picker (the server enforces the same boundary
 * on /api/atelier — see the non-employee middleware in routes/atelier).
 */
export function isSelfOnlyRole(role: string | null | undefined): boolean {
  return role === "employee" || role === "contractor";
}

/**
 * Task #1297 — Non-Equity Partner: the Me lens plus a deliberately slimmed
 * Clients lens (Accounts + Opportunities only — the server clamps every
 * other clients surface at the central gate).
 */
export function isNonEquityPartnerRole(role: string | null | undefined): boolean {
  return role === "non_equity_partner";
}

/**
 * Task #1297 — Clients-lens tab gating. NEPs only get Accounts and
 * Opportunities (their owned/granted/invited slice); everyone else keeps
 * the full lens. Shared by the top-bar tabs AND the screen-catalog
 * generator so the two cannot drift.
 */
export function clientsSectionVisibleForRole(
  sectionId: string,
  role: string | null | undefined,
): boolean {
  if (isNonEquityPartnerRole(role)) {
    return sectionId === "accounts" || sectionId === "opportunities";
  }
  return true;
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

/** Mirrors canEditPartnersLens on the server; tagging never grants portal access. */
export function canEditPartnerAssociations(role: string | null | undefined): boolean {
  return role === "founding_partner" || role === "partner" ||
    role === "senior_manager" || role === "finance";
}

/** Lenses the picker should offer this persona. */
export function visibleLensesForRole(
  role: string | null | undefined,
): readonly LensDef[] {
  if (isSelfOnlyRole(role)) return LENSES.filter((l) => l.id === "me");
  // Task #1297 — NEPs get Me + (slimmed) Clients only.
  if (isNonEquityPartnerRole(role)) {
    return LENSES.filter((l) => l.id === "me" || l.id === "clients");
  }
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
