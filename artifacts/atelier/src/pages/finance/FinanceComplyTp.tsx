/**
 * FinanceComplyTp — Transfer-pricing register (Task #419).
 *
 * One row per inter-company link, surfacing the TP method already on
 * the entity model, master/local file slots with version history, and
 * the related-party transactions schedule auto-derived from IC links.
 */
import * as React from "react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, BackLink } from "@/components/ui/primitives";
import { useTpRegister, useFinanceEntities, type TpRegisterRow, type TpFileVersionRow } from "@/lib/v5-hooks";

function FileSlot({ label, file, history }: { label: string; file: TpFileVersionRow | null; history: TpFileVersionRow[] }) {
  return (
    <div className="border border-border-soft rounded p-3 space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{label}</div>
      {file ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <MonoChip tone="green">{file.version}</MonoChip>
            <span className="font-mono text-xs text-text">{file.publishedOn}</span>
          </div>
          <div className="text-xs text-text-mute">By {file.author}</div>
          <div className="text-xs text-text-mute italic">{file.notes}</div>
        </>
      ) : (
        <div className="text-xs text-text-faint italic">— not required (consolidated with parent)</div>
      )}
      {history.length > 1 && (
        <details className="text-[10px] font-mono text-text-faint mt-1">
          <summary className="cursor-pointer hover:text-text-mute">{history.length} versions</summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((v) => (
              <li key={v.version}>{v.version} · {v.publishedOn} · {v.author}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TpCard({ row, entityName }: { row: TpRegisterRow; entityName: (id: string) => string }) {
  const totalRpt = row.relatedPartyTransactions.reduce((s, r) => s + r.fyAmountUsdK, 0);
  return (
    <Card className="p-5 space-y-4" data-testid={`tp-${row.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>{row.id}</Eyebrow>
          <h3 className="text-base font-semibold mt-1">
            {entityName(row.entityAId)} <span className="text-text-faint mx-2">→</span> {entityName(row.entityBId)}
          </h3>
          <p className="text-sm text-text-mute mt-1">{row.relationship}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MonoChip tone="gold">{row.tpMethod}</MonoChip>
          {row.intercoServiceFeePct != null && (
            <MonoChip>{(row.intercoServiceFeePct * 100).toFixed(1)}%</MonoChip>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Benchmark range</div>
          <div className="text-text mt-0.5">{row.benchmarkRange}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Source</div>
          <div className="text-text-mute mt-0.5">{row.benchmarkSource}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <FileSlot label="Master file" file={row.masterFile.current} history={row.masterFile.history} />
        <FileSlot label="Local file" file={row.localFile.current} history={row.localFile.history} />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Related-party transactions (FY)</div>
          <div className="text-xs font-mono text-text">${totalRpt.toLocaleString()}k total</div>
        </div>
        <div className="space-y-1">
          {row.relatedPartyTransactions.map((rpt) => (
            <div key={rpt.id} className="flex flex-wrap justify-between gap-2 text-xs border-b border-border-soft last:border-b-0 pb-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-text">{rpt.description}</div>
                <div className="text-text-mute text-[10px]">{rpt.basis}</div>
              </div>
              <div className="font-mono text-text">${rpt.fyAmountUsdK.toLocaleString()}k</div>
            </div>
          ))}
        </div>
      </div>

      {row.notes && (
        <div className="text-xs text-text-mute italic border-t border-border-soft pt-3">{row.notes}</div>
      )}
    </Card>
  );
}

export default function FinanceComplyTp() {
  const tp = useTpRegister();
  const entities = useFinanceEntities();
  const entityName = React.useCallback(
    (id: string) => entities.find((e) => e.id === id)?.shortName ?? id,
    [entities],
  );

  const totalRpt = tp.reduce(
    (s, r) => s + r.relatedPartyTransactions.reduce((s2, x) => s2 + x.fyAmountUsdK, 0),
    0,
  );
  const localFilesMissing = tp.filter((r) => r.localFile.current === null).length;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <div className="container-atelier">
          <BackLink href="/finance/comply">Finance · Comply</BackLink>
        </div>
        <Eyebrow>Manage · Finance · Comply · Transfer pricing</Eyebrow>
        <h1 className="headline mt-3">Transfer-pricing register</h1>
        <p className="lede mt-3 max-w-3xl">
          One row per inter-company link, with the TP method already on the
          entity model, master/local file slots and version history, and a
          seeded sample related-party transactions schedule. KSA / UAE / UK
          all have active TP regimes — these are the artefacts that document
          an arm's-length position to tax authorities.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs font-mono">
          <MonoChip>{tp.length} IC links</MonoChip>
          <MonoChip>${totalRpt.toLocaleString()}k FY related-party</MonoChip>
          <MonoChip tone={localFilesMissing > 0 ? "default" : "green"}>{localFilesMissing} local file(s) waived</MonoChip>
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-4">
        {tp.map((r) => <TpCard key={r.id} row={r} entityName={entityName} />)}
      </div>
    </div>
  );
}
