import * as React from "react";
import { Link, useLocation } from "wouter";

const ITEMS: { href: string; label: string }[] = [
  { href: "/roster/people", label: "People" },
  { href: "/roster/access-matrix", label: "Access matrix" },
  { href: "/roster/invitations", label: "Invitations" },
  { href: "/roster/onboarding", label: "Onboarding" },
  { href: "/roster/offboarding", label: "Offboarding" },
  { href: "/roster/compliance", label: "Compliance" },
];

export function RosterNav(): React.ReactElement {
  const [loc] = useLocation();
  return (
    <div className="flex flex-wrap gap-1 mb-4 border-b border-line">
      {ITEMS.map((it) => {
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
