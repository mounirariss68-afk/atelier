/**
 * RecordCard — the shared entity-card pattern (Task #529).
 *
 * Design standard (from the Roster people card):
 * - Title: `font-medium text-text`, single line.
 * - Subtitle: `text-xs text-text-mute`.
 * - Optional `border-l-4` colored left-border accent carrying type/status semantics.
 * - One MonoChip row for status/tier/type/country/etc.
 * - Optional trailing slot (avatars / amounts / counts) top-right.
 * - Whole card clickable → the record's edit/detail surface (href or onClick).
 * - Secondary actions via a compact affordance (RecordCardAction), never a button row.
 *
 * Named RecordCard (not EntityCard) to avoid collisions with the CLI result
 * renderers and the local FinanceEntities helper of that name.
 */
import * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/primitives";

export type RecordCardProps = {
  title: React.ReactNode;
  /** Muted xs line under the title. */
  subtitle?: React.ReactNode;
  /** Tailwind border-color class for the left accent, e.g. "border-l-gold". */
  accentClass?: string;
  /** MonoChip row content. */
  chips?: React.ReactNode;
  /** Top-right slot — chips, avatars, amounts. */
  trailing?: React.ReactNode;
  /** Compact secondary actions (use RecordCardAction). Clicks won't bubble to the card. */
  actions?: React.ReactNode;
  /** Whole-card navigation target. */
  href?: string;
  /** Whole-card click handler (used when href is absent). */
  onClick?: () => void;
  /** Highlight ring for a selected card. */
  selected?: boolean;
  className?: string;
  /** Extra body content below the chip row. */
  children?: React.ReactNode;
  /** Bottom row separated by a soft border. */
  footer?: React.ReactNode;
  "data-testid"?: string;
  title_props?: React.HTMLAttributes<HTMLDivElement>;
};

export function RecordCard({
  title,
  subtitle,
  accentClass,
  chips,
  trailing,
  actions,
  href,
  onClick,
  selected,
  className,
  children,
  footer,
  "data-testid": testId,
  title_props,
}: RecordCardProps) {
  const interactive = Boolean(href || onClick);
  const body = (
    <Card
      className={cn(
        "p-4 space-y-2 h-full flex flex-col transition-colors",
        accentClass && cn("border-l-4", accentClass),
        interactive && "cursor-pointer hover:bg-bg-elevate-2",
        selected && "border-gold/60",
        className,
      )}
      onClick={href ? undefined : onClick}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-text" {...title_props}>{title}</div>
          {subtitle != null && subtitle !== "" && (
            <div className="text-xs text-text-mute mt-0.5">{subtitle}</div>
          )}
        </div>
        {(trailing || actions) && (
          <div className="flex items-center gap-1.5 shrink-0">
            {trailing}
            {actions && (
              <div
                className="flex items-center gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
      {chips && <div className="flex flex-wrap items-center gap-1 text-xs">{chips}</div>}
      {children}
      {footer && <div className="mt-auto pt-2 border-t border-border-soft">{footer}</div>}
    </Card>
  );
  if (href) {
    return (
      <Link href={href} className="block h-full">
        {body}
      </Link>
    );
  }
  return body;
}

/** Compact mono-uppercase secondary action used inside RecordCard `actions`. */
export const RecordCardAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }
>(({ className, danger, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "text-[10px] font-mono uppercase tracking-widest inline-flex items-center gap-1 transition-colors",
      danger
        ? "text-text-faint hover:text-red-400"
        : "text-gold/80 hover:text-gold",
      className,
    )}
    {...props}
  />
));
RecordCardAction.displayName = "RecordCardAction";
