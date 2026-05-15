/**
 * SubSectionTabs — link-driven tab strip for navigation BELOW the
 * page hero (Task #401). Use only for legitimate intra-section
 * navigation (e.g. Wallet's Expenses · Invoices · AR · Cards
 * sub-tabs). NEVER use it to duplicate the shell's `LensSectionTabs`
 * strip — that just adds visual noise.
 *
 * Visually it's a thinner, lower-key version of `<TabNav>` so the
 * shell-level lens tabs remain the dominant nav.
 */

import * as React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

export interface SubSectionTab {
  id: string;
  label: React.ReactNode;
  href: string;
  /** Hide this tab (e.g. behind a permission). */
  hidden?: boolean;
  /** Override the active match. Defaults to exact-or-prefix. */
  isActive?: (pathname: string) => boolean;
}

export interface SubSectionTabsProps {
  tabs: readonly SubSectionTab[];
  className?: string;
  "data-testid"?: string;
}

function defaultActive(href: string, pathname: string, allHrefs: readonly string[]): boolean {
  // Exact match always wins.
  if (pathname === href) return true;
  // Prefix match — but only if no longer/more-specific sibling href is
  // also a prefix. Without this guard a tab like `/wallet` would activate
  // on every `/wallet/*` route alongside the actual child tab.
  if (!pathname.startsWith(href + "/")) return false;
  const moreSpecific = allHrefs.some(
    (h) => h !== href && h.startsWith(href + "/") &&
      (pathname === h || pathname.startsWith(h + "/")),
  );
  return !moreSpecific;
}

export function SubSectionTabs({
  tabs,
  className,
  "data-testid": testId,
}: SubSectionTabsProps) {
  const [loc] = useLocation();
  const visible = tabs.filter((t) => !t.hidden);
  if (visible.length === 0) return null;
  const hrefs = visible.map((t) => t.href);
  return (
    <nav
      aria-label="Sub-section navigation"
      className={cn(
        "flex items-center gap-4 overflow-x-auto border-b border-border-soft text-xs font-mono uppercase tracking-widest",
        className,
      )}
      data-testid={testId ?? "subsection-tabs"}
    >
      {visible.map((t) => {
        const active = (t.isActive ?? ((p) => defaultActive(t.href, p, hrefs)))(loc);
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 py-2.5 transition-colors hover:text-text",
              active
                ? "text-gold border-b-2 border-gold -mb-px"
                : "text-text-mute",
            )}
            data-testid={`subsection-tab-${t.id}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
