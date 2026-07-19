/**
 * FinanceEntities — legal entities (Task #372, real data Task #256).
 *
 * Lists the firm's real legal entities from the signing-entity registry
 * (firm profile → Signing entities). The old demo backbone (fabricated
 * CR numbers, tax IDs, licences, banks, signatories) was removed per the
 * production no-dummy-data policy; only fields that actually exist in
 * the registry are shown. Rich statutory data (registrations, fiscal
 * calendars, e-invoicing) is future work.
 */

import * as React from "react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { useFinanceEntities, type FinanceEntityRow } from "@/lib/v5-hooks";

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">{label}</div>
      <div className="text-sm text-text">{value}</div>
    </div>
  );
}

function EntityCard({ entity }: { entity: FinanceEntityRow }) {
  return (
    <Card className="p-5 space-y-4" data-testid={`finance-entity-${entity.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Legal entity</Eyebrow>
          <h3 className="text-lg font-semibold mt-1">{entity.legalName}</h3>
          {(entity.jurisdiction || entity.country) && (
            <div className="text-xs text-text-mute mt-1">
              {[entity.jurisdiction, entity.country].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entity.isDefault && <MonoChip tone="gold">default signing entity</MonoChip>}
          <MonoChip>{entity.baseCurrency ?? "currency not set"}</MonoChip>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Registered address" value={entity.registeredAddress} />
        <Field label="Governing law" value={entity.governingLaw} />
      </div>

      <div className="text-xs text-text-faint italic border-t border-border-soft pt-3">
        Statutory detail (registrations, tax IDs, licences, fiscal calendar) is
        not tracked yet — this card reflects the signing-entity registry only.
      </div>
    </Card>
  );
}

export default function FinanceEntities() {
  const entities = useFinanceEntities();

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Finance · Entities</Eyebrow>
        <h1 className="headline mt-3">Legal entities</h1>
        <p className="lede mt-3 max-w-3xl">
          The firm&apos;s legal entities as registered in the signing-entity
          registry (Firm profile → Signing entities). These drive the entity
          filter across the Finance lens and contract signing blocks.
        </p>
      </PageHero>

      <div className="container-atelier py-10 space-y-4">
        <SectionHead headline={`${entities.length} entit${entities.length === 1 ? "y" : "ies"}`} />
        {entities.length === 0 && (
          <Card className="p-8 text-center" data-testid="finance-entities-empty">
            <div className="text-sm text-text">No legal entities yet</div>
            <p className="text-xs text-text-mute mt-2 max-w-md mx-auto">
              Add signing entities in the firm profile and they will appear
              here and in the Finance filter bar.
            </p>
          </Card>
        )}
        {entities.map((e) => (
          <EntityCard key={e.id} entity={e} />
        ))}
      </div>
    </div>
  );
}
