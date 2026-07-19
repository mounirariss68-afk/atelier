/**
 * FinanceClose — period close, reconciliations, adjusting entries and
 * two-partner sign-off (Task #416, Wave 4).
 *
 * The in-memory demo close store was permanently removed (Task #114)
 * per the production no-dummy-data policy. Until real close persistence
 * lands, this page renders the entity picker (from the live entities
 * API, currently empty) and an explicit empty state — no dummy
 * checklists, reconciliations, adjustments or sign-offs.
 */

import * as React from "react";
import { PageHero, SectionHead, Card, Eyebrow } from "@/components/ui/primitives";
import { useFinanceEntities } from "@/lib/v5-hooks";
import { Lock } from "lucide-react";

export default function FinanceClose() {
  const entities = useFinanceEntities();
  const [entityId, setEntityId] = React.useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("entity") ?? "";
  });
  const entity = entities.find((e) => e.id === entityId) ?? entities[0];

  return (
    <div className="animate-in fade-in" data-testid="page-finance-close">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Close"
          headline="Period close"
          lede="Per-entity close checklist, reconciliations, adjusting entries (accruals · deferrals · FX revaluation) and the two-partner sign-off that locks the period and writes the immutable audit trail."
        />
        {entities.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2" data-testid="close-entity-picker">
            {entities.map((e) => (
              <button
                key={e.id}
                onClick={() => setEntityId(e.id)}
                className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                  entity?.id === e.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
                }`}
                data-testid={`close-entity-${e.id}`}
              >
                {e.shortName}
              </button>
            ))}
          </div>
        )}
      </PageHero>

      <div className="container-atelier py-8">
        <Card className="p-10 text-center" data-testid="finance-close-empty">
          <Lock className="w-6 h-6 text-text-faint mx-auto" />
          <div className="text-sm text-text mt-3">
            {entities.length === 0 ? "No close periods yet" : `No close periods yet for ${entity?.shortName ?? "this entity"}`}
          </div>
          <p className="text-xs text-text-mute mt-2 max-w-md mx-auto">
            The period-close workflow — checklist, reconciliations, adjusting
            entries and two-partner sign-off — will appear here once
            {entities.length === 0 ? " legal entities and " : " "}close periods
            are set up on real data.
          </p>
          {entities.length === 0 && (
            <div className="mt-4">
              <Eyebrow>Set up legal entities first</Eyebrow>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
