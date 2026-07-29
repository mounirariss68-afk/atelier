/**
 * LensPageHeader — the standard page hero for every workspace page in
 * Atelier (Task #401). Wraps `<PageHero>` + `<SectionHead>` with an
 * automatic, consistent eyebrow:
 *
 *   • Managed lens page  →  `Manage · {Lens} · {Section}`
 *   • Firm-menu surface  →  `Firm · {Area}`
 *
 * The eyebrow is derived from the current URL via `useLensSection()`;
 * pages can override by passing `eyebrow={...}` (e.g. detail pages
 * that prefer the entity name, or pages that want a sub-section
 * label).
 *
 * Why a wrapper, not a primitive? `SectionHead` is reused inside
 * cards/panels with arbitrary eyebrow strings. `LensPageHeader` is
 * specifically the *page* hero — having it be its own component keeps
 * the `Manage · Lens · Section` rule trivially greppable and prevents
 * page authors from inventing ad-hoc eyebrows like `WALLET` or
 * `<MonoChip>Hire</MonoChip>`.
 *
 * Page authors: prefer `<LensPageHeader>` for the top-of-page hero.
 * Use `<SectionHead>` for in-card titles.
 */

import * as React from "react";
import { BackLink, PageHero, SectionHead } from "@/components/ui/primitives";
import { useLensSection } from "@/lib/lensSection";

export interface LensPageHeaderProps {
  /** The page H1. Required. */
  headline: React.ReactNode;
  /** Optional one-line description below the headline. */
  lede?: React.ReactNode;
  /**
   * Override the auto-derived `Manage · Lens · Section` /
   * `Firm · Area` eyebrow. Pass a string for the standard styling, or
   * any node for fully-custom content (entity names, status chips, …).
   * Pass `null` to suppress the eyebrow entirely (rare).
   */
  eyebrow?: React.ReactNode | null;
  /**
   * Optional content rendered to the right of the headline (e.g.
   * primary CTA buttons). Stays inside the hero band.
   */
  actions?: React.ReactNode;
  /** Extra classnames on the inner SectionHead wrapper. */
  className?: string;
  /**
   * Optional back affordance rendered above the headline using the
   * shared `BackLink`. Lens home pages pass `backHref="/"` +
   * `backLabel="Home"` so no top-level screen feels like a dead end;
   * detail pages point at their logical parent list.
   */
  backHref?: string;
  backLabel?: React.ReactNode;
}

export function LensPageHeader({
  headline,
  lede,
  eyebrow,
  actions,
  className,
  backHref,
  backLabel,
}: LensPageHeaderProps) {
  const auto = useLensSection();
  // `undefined` = use auto. `null` = suppress. Anything else = override.
  const resolvedEyebrow =
    eyebrow === undefined ? auto.eyebrow ?? undefined : eyebrow ?? undefined;

  return (
    <PageHero>
      {backHref && (
        <BackLink href={backHref} className="mb-4" data-testid="link-back">
          {backLabel ?? "Back"}
        </BackLink>
      )}
      {actions ? (
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <SectionHead
              eyebrow={resolvedEyebrow}
              headline={headline}
              lede={lede}
              className={className}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>
        </div>
      ) : (
        <SectionHead
          eyebrow={resolvedEyebrow}
          headline={headline}
          lede={lede}
          className={className}
        />
      )}
    </PageHero>
  );
}
