import * as React from "react";
import { Link, useLocation } from "wouter";

interface NavItem { href: string; label: string }

const ROSTER_ITEMS: NavItem[] = [
  { href: "/roster/people", label: "People" },
  { href: "/roster/access-matrix", label: "Access matrix" },
  { href: "/roster/skill-graph", label: "Skill graph" },
  { href: "/roster/invitations", label: "Invitations" },
  { href: "/roster/onboarding", label: "Onboarding" },
  { href: "/roster/offboarding", label: "Offboarding" },
  { href: "/roster/compliance", label: "Compliance" },
];

// Task #364 — when these pages are mounted under /people/* we hide the
// legacy roster nav (the People Studio shell renders the cross-module rail
// instead) so the user doesn't see two competing navigations.
export function RosterNav(): React.ReactElement | null {
  const [loc] = useLocation();
  if (loc.startsWith("/people/")) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-4 border-b border-line">
      {ROSTER_ITEMS.map((it) => {
        const active = loc === it.href || loc.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={
              "px-3 py-2 font-mono text-xs uppercase tracking-wide border-b-2 -mb-px " +
              (active
                ? "border-gold text-gold"
                : "border-transparent text-text-mute hover:text-text")
            }
            data-testid={`roster-nav-${it.href.split("/").pop()}`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
