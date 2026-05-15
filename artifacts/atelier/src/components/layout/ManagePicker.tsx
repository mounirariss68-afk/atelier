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
import { LENSES, type LensId, getLens } from "@/lib/lens";
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
  const lens = getLens(active);
  return (
    <div
      className="hidden lg:flex items-center gap-4 pl-2 ml-1 border-l border-border-soft text-xs font-mono uppercase tracking-widest"
      data-testid={`lens-sections-${active}`}
    >
      {lens.sections.map((s) => {
        const isActive =
          location === s.href || location.startsWith(s.href + "/");
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
    </div>
  );
}

export function ManagePicker({ userId, role }: ManagePickerProps) {
  const { active, setLens } = useActiveLens({ userId, role });
  const [open, setOpen] = React.useState(false);

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
      const lens = LENSES.find((l) => l.shortcutKey === key);
      if (!lens) return;
      e.preventDefault();
      setLens(lens.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setLens]);

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
        {LENSES.map((l) => {
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
