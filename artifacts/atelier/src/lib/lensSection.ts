/**
 * lensSection — single source of truth for the eyebrow/breadcrumb a page
 * shows in its hero (Task #401, "Lens nav & page-header consistency").
 *
 * Every Atelier page header must follow ONE of two patterns:
 *
 *   • Managed lens page  →  `Manage · {Lens} · {Section}`
 *     (e.g. `Manage · Clients · Opportunities`,
 *      `Manage · People · Hire`, `Manage · Agents · Monitor`)
 *
 *   • Firm-menu surface  →  `Firm · {Area}`
 *     (e.g. `Firm · Atelier`, `Firm · Press`, `Firm · Codex`)
 *
 * `useLensSection()` resolves the current pathname to the right tuple
 * automatically. `LensPageHeader` consumes it so individual pages don't
 * have to spell out the breadcrumb. Pages can still pass an explicit
 * `eyebrow` to override (e.g. detail pages that want the entity name).
 *
 * Section labels for managed lenses come from `LENSES[*].sections`
 * (`lens.ts` is canonical for IA). When the URL is a known sub-route of
 * a section (e.g. `/clients/deliver/engagements/:id`) we pick the
 * deepest matching section by longest-prefix.
 */

import * as React from "react";
import { useLocation } from "wouter";
import { LENSES, type LensId, type LensSection } from "./lens";

export type FirmAreaId =
  | "atelier"
  | "ip"
  | "press"
  | "guardhouse"
  | "codex"
  | "wallet"
  | "ledger"
  | "studio"
  | "alliances"
  | "reports"
  | "settings"
  | "admin";

export interface FirmArea {
  id: FirmAreaId;
  /** Label used in the eyebrow (`Firm · {label}`). */
  label: string;
  /** URL prefix that owns this area. */
  prefix: string;
}

/**
 * Firm-menu surfaces — anything reachable from the avatar's "Firm"
 * submenu plus the operations workbenches that live outside the five
 * managed lenses (Wallet, Ledger). Order matters for prefix matching:
 * longer prefixes first so `/atelier/ip` wins over `/atelier`.
 */
export const FIRM_AREAS: readonly FirmArea[] = [
  { id: "ip", label: "IP catalog", prefix: "/atelier/ip" },
  { id: "atelier", label: "Atelier", prefix: "/atelier" },
  { id: "press", label: "Press", prefix: "/press" },
  { id: "guardhouse", label: "Guardhouse", prefix: "/guardhouse" },
  { id: "codex", label: "Codex", prefix: "/codex" },
  { id: "wallet", label: "Wallet", prefix: "/wallet" },
  { id: "ledger", label: "Ledger", prefix: "/ledger" },
  { id: "studio", label: "Studio", prefix: "/studio" },
  { id: "alliances", label: "Alliances", prefix: "/alliances" },
  { id: "reports", label: "Reports", prefix: "/reports" },
  { id: "admin", label: "Admin", prefix: "/admin" },
  { id: "settings", label: "Settings", prefix: "/settings" },
] as const;

export type LensSectionResolution =
  | {
      kind: "lens";
      lens: LensId;
      lensLabel: string;
      section: LensSection;
      /** `Manage · {Lens} · {Section}` */
      eyebrow: string;
    }
  | {
      kind: "firm";
      area: FirmArea;
      /** `Firm · {Area label}` */
      eyebrow: string;
    }
  | {
      kind: "unknown";
      eyebrow: null;
    };

function findLensSection(
  pathname: string,
): { lens: LensId; lensLabel: string; section: LensSection } | null {
  for (const lens of LENSES) {
    if (pathname !== lens.prefix && !pathname.startsWith(lens.prefix + "/")) {
      continue;
    }
    // Pick the deepest matching section by href length so that
    // `/clients/deliver/engagements/abc/charter` resolves to
    // `Engagements`, not `Overview`.
    let best: LensSection | null = null;
    for (const s of lens.sections) {
      const exact = pathname === s.href;
      const nested = pathname.startsWith(s.href + "/");
      if (exact || nested) {
        if (!best || s.href.length > best.href.length) best = s;
      }
    }
    // Fall back to the lens overview when no section matches. Prefer
    // an explicit overview section (`href === lens.prefix`); otherwise
    // synthesize one so we don't mislabel the lens home as the first
    // sub-section (e.g. `/agents` → "Design").
    if (!best) {
      const overview = lens.sections.find((s) => s.href === lens.prefix);
      best =
        overview ?? {
          id: "overview",
          label: "Overview",
          href: lens.prefix,
        };
    }
    return { lens: lens.id, lensLabel: lens.label, section: best };
  }
  return null;
}

function findFirmArea(pathname: string): FirmArea | null {
  for (const a of FIRM_AREAS) {
    if (pathname === a.prefix || pathname.startsWith(a.prefix + "/")) return a;
  }
  return null;
}

/** Pure resolver — exported for tests / non-hook callers. */
export function resolveLensSection(pathname: string): LensSectionResolution {
  const lensHit = findLensSection(pathname);
  if (lensHit) {
    return {
      kind: "lens",
      lens: lensHit.lens,
      lensLabel: lensHit.lensLabel,
      section: lensHit.section,
      eyebrow: `Manage · ${lensHit.lensLabel} · ${lensHit.section.label}`,
    };
  }
  const firm = findFirmArea(pathname);
  if (firm) {
    return { kind: "firm", area: firm, eyebrow: `Firm · ${firm.label}` };
  }
  return { kind: "unknown", eyebrow: null };
}

/**
 * Hook variant — reads the current wouter location.
 * Pass an explicit `pathname` to override (useful for tests or when a
 * page wants to resolve the eyebrow for a different URL).
 */
export function useLensSection(pathname?: string): LensSectionResolution {
  const [loc] = useLocation();
  const target = pathname ?? loc;
  return React.useMemo(() => resolveLensSection(target), [target]);
}
