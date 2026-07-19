/**
 * ManagePicker — top-bar entity-lens chip (Task #368).
 *
 * Renders "Manage: <Lens ▾>" with a dropdown of the five lenses, each with
 * its description and ⌘1–⌘5 shortcut hint. Picking a lens calls
 * `useActiveLens().setLens(id)` which persists + navigates to that lens's
 * home. Keyboard shortcuts ⌘1–⌘5 (Ctrl on non-Mac) switch the lens from
 * anywhere; Esc closes the menu.
 */

import * as React from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type LensId, getLens, visibleLensesForRole } from "@/lib/lens";
import { useActiveLens } from "@/hooks/useActiveLens";
import { cn } from "@/lib/utils";

interface ManagePickerProps {
  userId: string | null | undefined;
  role: string | null | undefined;
}

/**
 * LensSectionTabs — the contextual section-tabs slot the spec calls out
 * (Logo · Home · Manage · *contextual lens sections* · Ask · Bell · Avatar).
 * Renders the active lens's default sections inline next to the picker.
 * Each lens task replaces these with its own lifecycle-shaped tabs.
 */
export function LensSectionTabs({ userId, role }: ManagePickerProps) {
  const { active } = useActiveLens({ userId, role });
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const lens = getLens(active);
  const more = lens.more ?? [];
  // A section is active on an exact match, or a prefix match when no
  // longer/more-specific sibling href also matches (otherwise the lens
  // Overview tab — whose href is the bare lens prefix — would light up on
  // every sub-page alongside the actual section tab).
  const allHrefs = [...lens.sections, ...more].map((s) => s.href);
  const isSectionActive = (href: string): boolean => {
    if (location === href) return true;
    if (!location.startsWith(href + "/")) return false;
    return !allHrefs.some(
      (h) =>
        h !== href &&
        h.startsWith(href + "/") &&
        (location === h || location.startsWith(h + "/")),
    );
  };
  const moreActive = more.some((s) => isSectionActive(s.href));
  return (
    <div
      className="hidden lg:flex items-center gap-4 pl-2 ml-1 border-l border-border-soft text-xs font-mono uppercase tracking-widest"
      data-testid={`lens-sections-${active}`}
    >
      {lens.sections.map((s) => {
        const isActive = isSectionActive(s.href);
        return (
          <Link
            key={s.id}
            href={s.href}
            className={cn(
              "transition-colors hover:text-gold",
              isActive ? "text-gold" : "text-text-mute",
            )}
            data-testid={`lens-section-${active}-${s.id}`}
          >
            {s.label}
          </Link>
        );
      })}
      {more.length > 0 && (
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid={`lens-sections-${active}-more`}
              className={cn(
                "inline-flex items-center gap-0.5 uppercase tracking-widest transition-colors hover:text-gold outline-none",
                moreActive ? "text-gold" : "text-text-mute",
              )}
            >
              More
              <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="w-44 bg-bg-elevate border-border text-text"
          >
            {more.map((s) => {
              const isActive = isSectionActive(s.href);
              return (
                <DropdownMenuItem
                  key={s.id}
                  asChild
                  className={cn(
                    "cursor-pointer focus:bg-bg-elevate-2 focus:text-text",
                    isActive && "bg-bg-elevate-2",
                  )}
                >
                  <Link
                    href={s.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "block w-full text-sm",
                      isActive ? "text-gold" : "text-text",
                    )}
                    data-testid={`lens-section-${active}-${s.id}`}
                  >
                    {s.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function ManagePicker({ userId, role }: ManagePickerProps) {
  const { active, setLens } = useActiveLens({ userId, role });
  const [open, setOpen] = React.useState(false);
  // Task #50 — self-only personas (employee/contractor) see only the Me
  // lens; everyone else sees all six.
  const lenses = visibleLensesForRole(role);

  // ⌘1–⌘5 / Ctrl+1–5 — global lens shortcuts. Skipped while the user is
  // typing in an editable element so the CLI / forms keep their digits.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const key = e.key;
      const lens = visibleLensesForRole(role).find((l) => l.shortcutKey === key);
      if (!lens) return;
      e.preventDefault();
      setLens(lens.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setLens, role]);

  const activeLens = getLens(active);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="manage-picker-trigger"
          aria-label={`Lens — current: ${activeLens.label}`}
          className={cn(
            "group inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevate/40 px-2.5 py-1 text-sm font-medium",
            "hover:border-gold/50 hover:text-text transition-colors outline-none focus-visible:border-gold",
          )}
        >
          <span className="text-text">{activeLens.label}</span>
          <ChevronDown className="w-3.5 h-3.5 text-text-mute group-hover:text-text transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-44 bg-bg-elevate border-border text-text"
      >
        {lenses.map((l) => {
          const isActive = l.id === active;
          return (
            <DropdownMenuItem
              key={l.id}
              data-testid={`manage-picker-item-${l.id}`}
              onSelect={(e) => {
                e.preventDefault();
                setLens(l.id as LensId);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between gap-3 py-1.5 cursor-pointer",
                "focus:bg-bg-elevate-2 focus:text-text",
                isActive && "bg-bg-elevate-2",
              )}
            >
              <span className={cn("text-sm", isActive ? "text-gold" : "text-text")}>
                {l.label}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                {l.shortcut}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
