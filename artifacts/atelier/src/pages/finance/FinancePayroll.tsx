/**
 * FinancePayroll — statutory payroll runs, EOSB liability and leaver
 * settlements per legal entity (Task #655).
 *
 * Raw fetch (finance-page convention, see FinanceClose.tsx) — the payroll
 * routes are bespoke and not in the OpenAPI spec. Country statutory rules
 * (GPSSA / GOSI / GRSIA / SGK, WPS, EOSB bands) live server-side as an
 * effective-dated rules-as-code registry; this page only displays and
 * drives runs.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, MonoChip, PillButton, Eyebrow, BackLink } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { PlayCircle, BookOpenCheck, RefreshCw, AlertTriangle } from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

async function jfetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new Error(b?.message || b?.error || `HTTP ${res.status}`);
  }
  return body;
}

interface RunTotals {
  headcount: number;
  grossSalaries: number;
  employerContributions: number;
  employeeWithholdings: number;
  eosbAccrual: number;
  netPay: number;
}
interface RunRow {
  id: string;
  legalEntityId: string;
  periodLabel: string;
  status: string;
  currency: string;
  countryCode: string;
  totals: RunTotals;
  validationErrors: Array<{ employeeId?: string; name?: string; message: string }> | null;
  postedAt: string | null;
}
interface LineRow {
  id: string;
  personName: string;
  nationality: string | null;
  monthlyGross: number;
  monthlyBasic: number;
  serviceYears: number;
  employerTotal: number;
  employeeTotal: number;
  eosbAccrual: number;
  detail: { contributions?: Array<{ schemeKey: string; name: string; employerAmount: number; employeeAmount: number }> } | null;
}
interface EntityCard {
  id: string;
  shortName: string;
  country: string;
  baseCurrency: string;
  covered: boolean;
  regime: {
    effectiveFrom: string;
    eosb: { name: string } | null;
    contributions: Array<{ key: string; name: string; authority: string }>;
    filings: Array<{ key: string; name: string; authority: string; cadence: string }>;
  } | null;
}
interface Overview {
  entities: EntityCard[];
  runs: RunRow[];
}
interface EosbReportRow {
  employeeId: string;
  personName: string;
  nationality: string | null;
  serviceYears: number;
  wageMonthly: number;
  liabilityToDate: number;
  accruedInGl: number;
  eligible: boolean;
  note: string | null;
}
interface SettlementRow {
  id: string;
  employeeId: string;
  personName: string;
  leaveDate: string;
  reason: string;
  status: string;
  currency: string;
  serviceYears: number;
  entitlementGross: number;
  adjustmentFactor: number;
  finalAmount: number;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function FinancePayroll() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const overviewQ = useQuery({
    queryKey: ["payroll-overview"],
    queryFn: async () => (await jfetch("/finance/payroll/overview")) as Overview,
  });
  const entities = overviewQ.data?.entities ?? [];
  const [entityId, setEntityId] = React.useState<string>("");
  React.useEffect(() => {
    if (!entityId && entities.length > 0) setEntityId(entities.find((e) => e.covered)?.id ?? entities[0].id);
  }, [entities, entityId]);
  const entity = entities.find((e) => e.id === entityId) ?? null;
  const [period, setPeriod] = React.useState(currentPeriod());
  const [busy, setBusy] = React.useState<string | null>(null);

  const runs = (overviewQ.data?.runs ?? []).filter((r) => r.legalEntityId === entityId);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const runQ = useQuery({
    queryKey: ["payroll-run", openRunId],
    enabled: !!openRunId,
    queryFn: async () => (await jfetch(`/finance/payroll/runs/${openRunId}`)) as { run: RunRow; lines: LineRow[] },
  });
  const coveredCount = entities.filter((e) => e.covered).length;
  const consolidatedQ = useQuery({
    queryKey: ["eosb-consolidated"],
    enabled: coveredCount > 1,
    queryFn: async () => (await jfetch("/finance/payroll/eosb/report")) as {
      consolidated: true;
      entities: Array<{ entityId: string; entityName: string; currency: string; headcount: number; totalLiability: number; totalAccruedInGl: number }>;
      groupTotals: Record<string, { totalLiability: number; totalAccruedInGl: number }>;
    },
  });
  const eosbQ = useQuery({
    queryKey: ["eosb-report", entityId],
    enabled: !!entityId && !!entity?.covered,
    queryFn: async () => (await jfetch(`/finance/payroll/eosb/report?entityId=${entityId}`)) as {
      rows: EosbReportRow[]; totalLiability: number; totalAccruedInGl: number; currency: string;
    },
  });
  const settlementsQ = useQuery({
    queryKey: ["eosb-settlements"],
    queryFn: async () => (await jfetch("/finance/payroll/eosb/settlements")) as { items: SettlementRow[] },
  });

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast({ title: ok });
      await qc.invalidateQueries({ queryKey: ["payroll-overview"] });
      await qc.invalidateQueries({ queryKey: ["payroll-run"] });
      await qc.invalidateQueries({ queryKey: ["eosb-report"] });
      await qc.invalidateQueries({ queryKey: ["eosb-settlements"] });
    } catch (e) {
      toast({ title: "Payroll", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <div className="container-atelier">
          <BackLink href="/finance/close">Finance · Close</BackLink>
        </div>
        <Eyebrow>Manage · Finance · Payroll</Eyebrow>
        <h1 className="headline mt-3">Statutory payroll</h1>
        <p className="lede mt-3 max-w-3xl">
          Country statutory layer per legal entity — end-of-service (EOSB) accrual bands,
          social-security contributions (GPSSA · GOSI · GRSIA · SGK) and wage-protection /
          filing calendars (WPS · MUHSGK), computed from an effective-dated rules registry
          and posted to the general ledger.
        </p>
        <div className="mt-6 flex flex-wrap gap-2" data-testid="payroll-entity-filters">
          {entities.map((e) => (
            <button
              key={e.id}
              onClick={() => { setEntityId(e.id); setOpenRunId(null); }}
              className={`px-3 py-1 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                entityId === e.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
              }`}
              data-testid={`payroll-entity-${e.id}`}
            >{e.shortName} · {e.country}</button>
          ))}
        </div>
      </PageHero>

      <div className="container-atelier pb-24 space-y-10">
        {overviewQ.isLoading && <p className="text-text-mute text-sm">Loading…</p>}
        {overviewQ.isError && (
          <Card className="p-6"><p className="text-sm text-red-400">{(overviewQ.error as Error).message}</p></Card>
        )}

        {entity && (
          <section>
            <SectionHead headline={`Statutory regime — ${entity.country}`} />
            {!entity.covered ? (
              <Card className="p-6 mt-4">
                <p className="text-sm text-text-mute flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  No statutory rules seeded for {entity.country}. Payroll runs are still available (salaries + GL posting) but no contributions or EOSB accrue.
                </p>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <Card className="p-6">
                  <p className="text-xs font-mono uppercase tracking-widest text-text-mute">Contribution schemes</p>
                  <ul className="mt-3 space-y-2">
                    {entity.regime?.contributions.map((c) => (
                      <li key={c.key} className="text-sm flex items-baseline justify-between gap-3">
                        <span>{c.name}</span>
                        <MonoChip>{c.authority}</MonoChip>
                      </li>
                    ))}
                    {entity.regime?.contributions.length === 0 && <li className="text-sm text-text-mute">None</li>}
                  </ul>
                </Card>
                <Card className="p-6">
                  <p className="text-xs font-mono uppercase tracking-widest text-text-mute">Statutory filings</p>
                  <ul className="mt-3 space-y-2">
                    {entity.regime?.filings.map((f) => (
                      <li key={f.key} className="text-sm flex items-baseline justify-between gap-3">
                        <span>{f.name}</span>
                        <MonoChip>{f.cadence}</MonoChip>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-mute mt-3">
                    Filing deadlines are auto-attached to the statutory filings register.
                  </p>
                </Card>
              </div>
            )}
          </section>
        )}

        <section>
          <SectionHead headline="Payroll runs" />
          <Card className="p-6 mt-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
                Period
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="block mt-1 bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="payroll-period-input"
                />
              </label>
              <PillButton
                disabled={!entityId || busy !== null}
                onClick={() => act("compute", () => jfetch("/finance/payroll/runs", {
                  method: "POST",
                  body: JSON.stringify({ entityId, periodLabel: period }),
                }), "Payroll run computed")}
                data-testid="payroll-compute-btn"
              >
                {busy === "compute" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} Compute run
              </PillButton>
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                    <th className="py-2 pr-4">Period</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">People</th>
                    <th className="py-2 pr-4 text-right">Gross</th>
                    <th className="py-2 pr-4 text-right">Employer contrib.</th>
                    <th className="py-2 pr-4 text-right">EOSB accrual</th>
                    <th className="py-2 pr-4 text-right">Net pay</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/50" data-testid={`payroll-run-${r.periodLabel}`}>
                      <td className="py-2 pr-4 font-mono">{r.periodLabel}</td>
                      <td className="py-2 pr-4">
                        <MonoChip tone={r.status === "posted" ? "green" : (r.validationErrors?.length ? "red" : "amber")}>
                          {r.status}{r.validationErrors?.length ? ` · ${r.validationErrors.length} issue(s)` : ""}
                        </MonoChip>
                      </td>
                      <td className="py-2 pr-4 text-right">{r.totals.headcount}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.grossSalaries)} {r.currency}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.employerContributions)}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.eosbAccrual)}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.netPay)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          className="text-xs font-mono uppercase tracking-widest text-text-mute hover:text-text mr-3"
                          onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)}
                          data-testid={`payroll-run-open-${r.periodLabel}`}
                        >{openRunId === r.id ? "Hide" : "Lines"}</button>
                        {r.status === "draft" && (
                          <PillButton
                            disabled={busy !== null || !!r.validationErrors?.length}
                            onClick={() => act(`post-${r.id}`, () => jfetch(`/finance/payroll/runs/${r.id}/post`, { method: "POST" }), "Payroll posted to GL")}
                            data-testid={`payroll-post-${r.periodLabel}`}
                          ><BookOpenCheck className="w-4 h-4" /> Post</PillButton>
                        )}
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr><td colSpan={8} className="py-4 text-text-mute">No payroll runs yet for this entity.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {openRunId && runQ.data && (
              <div className="mt-6 border-t border-border pt-4">
                {(runQ.data.run.validationErrors?.length ?? 0) > 0 && (
                  <div className="mb-3 text-sm text-red-400">
                    {runQ.data.run.validationErrors!.map((v, i) => (
                      <p key={i}>• {v.name ? `${v.name}: ` : ""}{v.message}</p>
                    ))}
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                      <th className="py-2 pr-4">Person</th>
                      <th className="py-2 pr-4">Nationality</th>
                      <th className="py-2 pr-4 text-right">Service yrs</th>
                      <th className="py-2 pr-4 text-right">Gross</th>
                      <th className="py-2 pr-4 text-right">Employer</th>
                      <th className="py-2 pr-4 text-right">Employee</th>
                      <th className="py-2 pr-4 text-right">EOSB Δ</th>
                      <th className="py-2 pr-4">Schemes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runQ.data.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border/50">
                        <td className="py-2 pr-4">{l.personName}</td>
                        <td className="py-2 pr-4">{l.nationality ?? "—"}</td>
                        <td className="py-2 pr-4 text-right font-mono">{l.serviceYears.toFixed(1)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.monthlyGross)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.employerTotal)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.employeeTotal)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.eosbAccrual)}</td>
                        <td className="py-2 pr-4 text-xs text-text-mute">
                          {(l.detail?.contributions ?? []).map((c) => c.schemeKey).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        {entity?.covered && (
          <section>
            <SectionHead headline="EOSB liability" />
            {consolidatedQ.data && consolidatedQ.data.entities.length > 1 && (
              <Card className="p-6 mt-4" data-testid="eosb-consolidated">
                <p className="text-xs font-mono uppercase tracking-widest text-text-mute mb-3">Group rollup — all covered entities</p>
                <div className="flex flex-wrap gap-2 mb-3 text-xs font-mono">
                  {Object.entries(consolidatedQ.data.groupTotals).map(([cur, t]) => (
                    <MonoChip key={cur}>{cur} liability {fmt(t.totalLiability)} · accrued {fmt(t.totalAccruedInGl)}</MonoChip>
                  ))}
                </div>
                <ul className="text-sm space-y-1">
                  {consolidatedQ.data.entities.map((e) => (
                    <li key={e.entityId} className="flex justify-between gap-4">
                      <span>{e.entityName} · {e.headcount} people</span>
                      <span className="font-mono">{fmt(e.totalLiability)} {e.currency}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card className="p-6 mt-4">
              {eosbQ.isLoading && <p className="text-sm text-text-mute">Loading…</p>}
              {eosbQ.data && (
                <>
                  <div className="flex flex-wrap gap-2 mb-4 text-xs font-mono">
                    <MonoChip>Liability to date {fmt(eosbQ.data.totalLiability)} {eosbQ.data.currency}</MonoChip>
                    <MonoChip tone={Math.abs(eosbQ.data.totalAccruedInGl - eosbQ.data.totalLiability) < 1 ? "green" : "amber"}>
                      Accrued in GL {fmt(eosbQ.data.totalAccruedInGl)} {eosbQ.data.currency}
                    </MonoChip>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                        <th className="py-2 pr-4">Person</th>
                        <th className="py-2 pr-4">Nationality</th>
                        <th className="py-2 pr-4 text-right">Service yrs</th>
                        <th className="py-2 pr-4 text-right">Wage / mo</th>
                        <th className="py-2 pr-4 text-right">Liability</th>
                        <th className="py-2 pr-4 text-right">Accrued</th>
                        <th className="py-2 pr-4">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eosbQ.data.rows.map((r) => (
                        <tr key={r.employeeId} className="border-b border-border/50">
                          <td className="py-2 pr-4">{r.personName}</td>
                          <td className="py-2 pr-4">{r.nationality ?? "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono">{r.serviceYears.toFixed(1)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(r.wageMonthly)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(r.liabilityToDate)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(r.accruedInGl)}</td>
                          <td className="py-2 pr-4 text-xs text-text-mute">{r.note ?? "—"}</td>
                        </tr>
                      ))}
                      {eosbQ.data.rows.length === 0 && (
                        <tr><td colSpan={7} className="py-4 text-text-mute">No EOSB-eligible people linked to this entity.</td></tr>
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          </section>
        )}

        <section>
          <SectionHead headline="Leaver settlements" />
          <Card className="p-6 mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                  <th className="py-2 pr-4">Person</th>
                  <th className="py-2 pr-4">Leave date</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {(settlementsQ.data?.items ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border/50" data-testid={`eosb-settlement-${s.id}`}>
                    <td className="py-2 pr-4">{s.personName}</td>
                    <td className="py-2 pr-4 font-mono">{s.leaveDate}</td>
                    <td className="py-2 pr-4">{s.reason}{s.adjustmentFactor !== 1 ? ` · ×${s.adjustmentFactor}` : ""}</td>
                    <td className="py-2 pr-4 text-right font-mono">{fmt(s.finalAmount)} {s.currency}</td>
                    <td className="py-2 pr-4"><MonoChip tone={s.status === "settled" ? "green" : "amber"}>{s.status}</MonoChip></td>
                    <td className="py-2 text-right">
                      {s.status === "draft" && (
                        <PillButton
                          disabled={busy !== null}
                          onClick={() => act(`settle-${s.id}`, () => jfetch(`/finance/payroll/eosb/settlements/${s.id}/settle`, { method: "POST" }), "Settlement posted to GL")}
                          data-testid={`eosb-settle-${s.id}`}
                        ><BookOpenCheck className="w-4 h-4" /> Settle & post</PillButton>
                      )}
                    </td>
                  </tr>
                ))}
                {(settlementsQ.data?.items ?? []).length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-text-mute">No settlements. Leaver settlements are created from the person's offboarding or via the API.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </section>
      </div>
    </div>
  );
}
