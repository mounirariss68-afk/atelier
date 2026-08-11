/**
 * ViewToggle + RecordRow — shared list/card view pattern (Task #723).
 *
 * Every card-listing page (Accounts, Roster/People, Engagements, Partners
 * directory, Pipeline's kanban/table switch) offers the same segmented
 * cards/list control. The chosen view persists per page via localStorage
 * (`useViewMode(pageKey)`), so the preference is remembered when the user
 * returns.
 *
 * RecordRow is the compact list-row counterpart of RecordCard: same key
 * fields (title, subtitle, chips, trailing) in a single scannable row that
 * navigates to the same detail page.
 */
import * as React from "react";
import { Link } from "wouter";
import { LayoutGrid, List as ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "cards" | "list";

const STORAGE_PREFIX = "atelier-view-mode:";

export function useViewMode(
  pageKey: string,
  defaultMode: ViewMode = "cards",
): [ViewMode, (m: ViewMode) => void] {
  const [mode, setModeState] = React.useState<ViewMode>(() => {
    if (typeof window === "undefined") return defaultMode;
    try {
      const v = window.localStorage.getItem(STORAGE_PREFIX + pageKey);
      return v === "cards" || v === "list" ? v : defaultMode;
    } catch {
      return defaultMode;
    }
  });
  const setMode = React.useCallback(
    (m: ViewMode) => {
      setModeState(m);
      try {
        window.localStorage.setItem(STORAGE_PREFIX + pageKey, m);
      } catch {
        /* private-mode storage failures are non-fatal */
      }
    },
    [pageKey],
  );
  return [mode, setMode];
}

export function ViewToggle({
  mode,
  onChange,
  cardsLabel = "Cards",
  listLabel = "List",
  cardsIcon,
  className,
  "data-testid": testId,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  /** Label shown in the tooltip for the cards side (e.g. "Kanban"). */
  cardsLabel?: string;
  listLabel?: string;
  /** Override the cards-side icon (defaults to a grid). */
  cardsIcon?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 glass-surface p-1 rounded-full border border-border shrink-0",
        className,
      )}
      data-testid={testId ?? "view-toggle"}
    >
      <button
        type="button"
        title={cardsLabel}
        aria-label={cardsLabel}
        aria-pressed={mode === "cards"}
        onClick={() => onChange("cards")}
        className={`p-1.5 rounded-full transition-colors ${
          mode === "cards" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"
        }`}
        data-testid="view-toggle-cards"
      >
        {cardsIcon ?? <LayoutGrid className="w-4 h-4" />}
      </button>
      <button
        type="button"
        title={listLabel}
        aria-label={listLabel}
        aria-pressed={mode === "list"}
        onClick={() => onChange("list")}
        className={`p-1.5 rounded-full transition-colors ${
          mode === "list" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"
        }`}
        data-testid="view-toggle-list"
      >
        <ListIcon className="w-4 h-4" />
      </button>
    </div>
  );
}

export type RecordRowProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Tailwind border-color class for the left accent, e.g. "border-l-gold". */
  accentClass?: string;
  /** MonoChip row content — same chips as the card. */
  chips?: React.ReactNode;
  /** Right-aligned slot — status chips, amounts, counts. */
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
};

export function RecordRow({
  title,
  subtitle,
  accentClass,
  chips,
  trailing,
  href,
  onClick,
  className,
  "data-testid": testId,
}: RecordRowProps) {
  const interactive = Boolean(href || onClick);
  const body = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 glass-surface border border-border rounded-md transition-colors",
        accentClass && cn("border-l-4", accentClass),
        interactive && "cursor-pointer hover:bg-bg-elevate-2",
        className,
      )}
      onClick={href ? undefined : onClick}
      data-testid={testId}
    >
      <div className="min-w-0 flex items-baseline gap-2 flex-1 basis-56">
        <span className="font-medium text-text text-sm truncate">{title}</span>
        {subtitle != null && subtitle !== "" && (
          <span className="text-xs text-text-mute truncate">{subtitle}</span>
        )}
      </div>
      {chips && (
        <div className="flex flex-wrap items-center gap-1 text-xs">{chips}</div>
      )}
      {trailing && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">{trailing}</div>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}
