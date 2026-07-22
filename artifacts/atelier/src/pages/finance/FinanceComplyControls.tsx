/**
 * FinanceComplyControls — Internal controls catalogue + SoD matrix (Task #419).
 *
 * SOX-lite control catalogue showing each control with its owner,
 * cadence, last-tested date, last-result, exceptions and remediation.
 * The SoD matrix below maps the role model to control conflicts;
 * conflicts the firm currently violates are surfaced as live exceptions.
 */
import * as React from "react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, BackLink } from "@/components/ui/primitives";
import {
  useInternalControls,
  useSoDConflicts,
  type InternalControlRow,
  type SoDConflictRow,
} from "@/lib/v5-hooks";

const AREA_LABEL: Record<InternalControlRow["area"], string> = {
  revenue: "Revenue",
  ar: "AR",
  cash: "Cash",
  ap: "AP",
  payroll: "Payroll",
  journals: "Journals",
  itgc: "IT general controls",
};

const FREQUENCY_LABEL: Record<InternalControlRow["frequency"], string> = {
  per_transaction: "per transaction",
  daily: "daily",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "annual",
};

function resultTone(r: InternalControlRow["lastResult"]): "green" | "amber" | "red" | "default" {
  switch (r) {
    case "pass": return "green";
    case "exception": return "amber";
    case "fail": return "red";
    default: return "default";
  }
}

function severityTone(s: SoDConflictRow["severity"]): "red" | "amber" | "default" {
  return s === "high" ? "red" : s === "medium" ? "amber" : "default";
}

function ControlCard({ c }: { c: InternalControlRow }) {
  return (
    <Card className="p-5 space-y-3" data-testid={`control-${c.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Eyebrow>{AREA_LABEL[c.area]} · {c.id}</Eyebrow>
          <h3 className="font-medium text-text mt-1">{c.title}</h3>
          <p className="text-sm text-text-mute mt-1">{c.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <MonoChip tone={resultTone(c.lastResult)}>{c.lastResult.replace("_", " ")}</MonoChip>
          {c.exceptionsOpen > 0 && <MonoChip tone="amber">{c.exceptionsOpen} open</MonoChip>}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-2 border-t border-border-soft">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Owner</div>
          <div className="text-text mt-0.5">{c.owner}</div>
          <div className="text-text-mute">{c.ownerRole}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Frequency</div>
          <div className="text-text mt-0.5">{FREQUENCY_LABEL[c.frequency]}</div>
          <div className="text-text-mute">{c.evidenceCadence}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Last tested</div>
          <div className="text-text mt-0.5 font-mono">{c.lastTestedOn}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Applies to</div>
          <div className="text-text mt-0.5 font-mono text-[10px]">{c.appliesToEntities.length} entities</div>
        </div>
      </div>
      {c.remediation && (
        <div className="text-xs text-amber-200/90 italic border-l-2 border-amber-500/40 pl-3 py-1">
          <span className="font-mono uppercase tracking-widest text-[10px] not-italic mr-2 text-amber-300/80">Remediation</span>
          {c.remediation}
        </div>
      )}
    </Card>
  );
}

function SoDRow({ s }: { s: SoDConflictRow }) {
  const violated = s.currentlyViolatingPeople.length > 0;
  return (
    <Card className={`p-4 space-y-2 ${violated ? "border-amber-500/40" : ""}`} data-testid={`sod-${s.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Eyebrow>{s.id}</Eyebrow>
          <div className="text-sm font-medium text-text mt-0.5">{s.title}</div>
        </div>
        <div className="flex gap-1.5">
          <MonoChip tone={severityTone(s.severity)}>{s.severity}</MonoChip>
          {violated ? (
            <MonoChip tone="amber">conflict open</MonoChip>
          ) : (
            <MonoChip tone="green">clean</MonoChip>
          )}
        </div>
      </div>
      <p className="text-xs text-text-mute">{s.description}</p>
      <div className="flex flex-wrap gap-2 text-[10px] font-mono text-text-faint">
        <span>Roles A: {s.rolesA.join(", ")}</span>
        <span className="text-text-faint/40">↔</span>
        <span>Roles B: {s.rolesB.join(", ")}</span>
      </div>
      {violated && (
        <div className="text-xs text-amber-200/90 border-l-2 border-amber-500/40 pl-3 py-1">
          <span className="font-mono uppercase tracking-widest text-[10px] mr-2 text-amber-300/80">People holding both</span>
          {s.currentlyViolatingPeople.map((p) => `${p.name} (${p.role})`).join(", ")}
        </div>
      )}
      <div className="text-xs text-text-mute italic border-t border-border-soft pt-2">
        <span className="font-mono uppercase tracking-widest text-[10px] not-italic mr-2 text-text-faint">Mitigation</span>
        {s.mitigation}
      </div>
      {s.linkedControlIds.length > 0 && (
        <div className="text-[10px] font-mono text-text-faint">
          Linked controls: {s.linkedControlIds.join(", ")}
        </div>
      )}
    </Card>
  );
}

export default function FinanceComplyControls() {
  const controls = useInternalControls();
  const sod = useSoDConflicts();
  const [areaFilter, setAreaFilter] = React.useState<"all" | InternalControlRow["area"]>("all");

  const visible = areaFilter === "all" ? controls : controls.filter((c) => c.area === areaFilter);
  const exceptions = controls.reduce((n, c) => n + c.exceptionsOpen, 0);
  const sodOpen = sod.filter((s) => s.currentlyViolatingPeople.length > 0).length;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <div className="container-atelier">
          <BackLink href="/finance/comply">Finance · Comply</BackLink>
        </div>
        <Eyebrow>Manage · Finance · Comply · Controls</Eyebrow>
        <h1 className="headline mt-3">Internal controls catalogue</h1>
        <p className="lede mt-3 max-w-3xl">
          SOX-lite control library seeded from services-firm best practice
          across revenue, AR, cash, AP, payroll, journals and IT general
          controls. Each control names its owner, cadence, evidence
          requirement, last-tested date and any open exceptions.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs font-mono">
          <MonoChip>{controls.length} controls</MonoChip>
          <MonoChip tone={exceptions > 0 ? "amber" : "green"}>{exceptions} open exception(s)</MonoChip>
          <MonoChip tone={sodOpen > 0 ? "amber" : "green"}>{sodOpen} SoD conflict(s) live</MonoChip>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="controls-area-filters">
          {(["all", "revenue", "ar", "cash", "ap", "payroll", "journals", "itgc"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAreaFilter(a)}
              className={`px-3 py-1 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                areaFilter === a ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
              }`}
              data-testid={`controls-filter-${a}`}
            >
              {a === "all" ? "All" : AREA_LABEL[a]}
            </button>
          ))}
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-8">
        <section className="space-y-3">
          <SectionHead headline={`Controls (${visible.length})`} />
          {visible.map((c) => <ControlCard key={c.id} c={c} />)}
        </section>

        <section className="space-y-3">
          <SectionHead
            headline="Segregation-of-duties matrix"
            lede="Mapped to the firm role model. Conflicts the firm currently violates are flagged as exceptions and back-link to the controls that depend on them."
          />
          <div className="grid lg:grid-cols-2 gap-3" data-testid="sod-matrix">
            {sod.map((s) => <SoDRow key={s.id} s={s} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
