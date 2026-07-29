import * as React from "react";
import { useParams } from "wouter";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";
import { BackLink, Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";
import { useChartPalette } from "@/lib/theme";

interface InvoiceDraftSummary {
  id: string;
  composedAt: string;
  rateCardId: string | null;
  totals: { hoursUsd: number; expensesNetUsd: number; markupUsd: number; totalUsd: number; lineCount: number };
}
interface ClientBillableSummary {
  count: number;
  netUsd: number;
  markupUsd: number;
  sentinel: { pass: number; warn: number; fail: number };
}
interface RollupRow { partnerFirmId: string; hours: number; costAmount: number; costCurrency: string; }
interface HoursRow { id: string; partnerFirmId: string; resourceName: string; weekIso: string; hours: number; costAmount: number; costCurrency: string; uploadedAt: string; }
interface EconResp { engagementId: string; engagementName: string; partnerFirmRollup: RollupRow[]; rows: HoursRow[]; }

function EngagementMarginCard({ engagementId }: { engagementId: string }) {
  const [data, setData] = React.useState<{
    snapshot: { revenueRecognised: number; directCost: number; grossMarginAmount: number; grossMarginPct: number; leakageAmount: number; realizationRate: number; periodLabel: string } | null;
    milestones: Array<{ id: string; label: string; status: string; amount: number; currency: string }>;
  } | null>(null);
  React.useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/atelier/margin/engagements/${engagementId}`, { credentials: "include" }).then((r) => r.json()).catch(() => null),
      fetch(`/api/atelier/revrec/milestones?engagementId=${engagementId}`, { credentials: "include" }).then((r) => r.json()).catch(() => ({ milestones: [] })),
    ]).then(([m, ms]) => {
      if (!alive) return;
      const raw = (m?.snapshots ?? [])[0] ?? null;
      const snap = raw ? {
        revenueRecognised: Number(raw.revenueRecognised ?? raw.revenue_recognised ?? 0),
        directCost: Number(raw.directCost ?? raw.direct_cost ?? 0),
        grossMarginAmount: Number(raw.grossMarginAmount ?? raw.gross_margin_amount ?? 0),
        grossMarginPct: Number(raw.grossMarginPct ?? raw.gross_margin_pct ?? 0),
        leakageAmount: Number(raw.leakageAmount ?? raw.leakage_amount ?? 0),
        realizationRate: Number(raw.realizationRate ?? raw.realization_rate ?? 0),
        periodLabel: String(raw.periodLabel ?? raw.period_label ?? ""),
      } : null;
      setData({ snapshot: snap, milestones: ms?.milestones ?? [] });
    });
    return () => { alive = false; };
  }, [engagementId]);
  if (!data || !data.snapshot) return null;
  const s = data.snapshot;
  const fmt = (n: number) => `$${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const pctFmt = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;
  const tone = s.grossMarginPct >= 0.45 ? "green" : s.grossMarginPct >= 0.3 ? "amber" : "red";
  return (
    <Card className="p-4" data-testid="engagement-margin-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm uppercase tracking-wider text-text-mute">Recognised revenue, margin & leakage · {s.periodLabel}</h3>
        <Link href="/wallet/revrec" className="text-xs text-gold underline">Open rev-rec</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div><div className="text-xs text-text-mute">Revenue</div><div className="font-mono">{fmt(s.revenueRecognised)}</div></div>
        <div><div className="text-xs text-text-mute">Direct cost</div><div className="font-mono">{fmt(s.directCost)}</div></div>
        <div><div className="text-xs text-text-mute">Margin</div><div className="font-mono">{fmt(s.grossMarginAmount)}</div><MonoChip tone={tone}>{pctFmt(s.grossMarginPct)}</MonoChip></div>
        <div><div className="text-xs text-text-mute">Realization</div><div className="font-mono">{pctFmt(s.realizationRate)}</div></div>
        <div><div className="text-xs text-text-mute">Leakage</div><div className="font-mono text-gold">{fmt(s.leakageAmount)}</div></div>
      </div>
      {data.milestones.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase text-text-mute mb-2">Milestones</div>
          <ul className="space-y-1 text-sm">
            {data.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <MonoChip tone={m.status === "earned" || m.status === "invoiceable" ? "green" : m.status === "client_accepted" ? "gold" : "default"}>{m.status}</MonoChip>
                <span className="flex-1 truncate">{m.label}</span>
                <span className="font-mono text-xs text-text-mute">{fmt(m.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

interface PlanVsActualRow { seniority: string; plannedHours: number; actualHours: number; variancePct: number; actualCostUsd: number; actualPriceUsd: number; }
interface UtilEngResp {
  engagementId: string;
  engagementSlug: string;
  engagementName: string;
  opportunityId: string | null;
  plmStage: string;
  planned: { hours: number; costUsd: number; priceUsd: number; marginPct: number; durationWeeks: number; pricingId: string | null };
  actual: { hours: number; costUsd: number; billedUsd: number; marginPct: number };
  planVsActual: PlanVsActualRow[];
  burnPct: number;
  weeksOfRunway: number | null;
  rateCardId: string | null;
}

interface NarrativeResp {
  runId: string;
  output: {
    refusal: string | null;
    headline: string | null;
    narrative: string | null;
    risks: { id: string; severity: "amber" | "red"; statement: string }[];
    actions: { id: string; action: string; owner: string }[];
    confidence: "green" | "amber" | "red";
  };
}

function fmtMoney(amount: number, currency: string = "USD"): string {
  try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${amount} ${currency}`; }
}
function pct(n: number): string { return `${(n * 100).toFixed(0)}%`; }
function burnTone(b: number): "green" | "amber" | "red" {
  if (b >= 1) return "red";
  if (b >= 0.8) return "amber";
  return "green";
}

export default function EngagementEconomics() {
  const palette = useChartPalette();
  const params = useParams<{ engagementId: string }>();
  const engagementId = params.engagementId;
  const [data, setData] = React.useState<EconResp | null>(null);
  const [util, setUtil] = React.useState<UtilEngResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadMsg, setUploadMsg] = React.useState<string | null>(null);
  const [narrative, setNarrative] = React.useState<NarrativeResp | null>(null);
  const [narrLoading, setNarrLoading] = React.useState(false);
  const [draft, setDraft] = React.useState<InvoiceDraftSummary | null>(null);
  const [billable, setBillable] = React.useState<ClientBillableSummary | null>(null);
  const [composerBusy, setComposerBusy] = React.useState(false);
  const [composerMsg, setComposerMsg] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        fetch(`/api/atelier/ledger/engagement-economics/${engagementId}`, { credentials: "include" }),
        fetch(`/api/atelier/ledger/utilization/engagement/${engagementId}`, { credentials: "include" }),
        fetch(`/api/atelier/wallet/invoice-drafts/${engagementId}`, { credentials: "include" }),
        fetch(`/api/atelier/wallet/client-billable/${engagementId}`, { credentials: "include" }),
      ]);
      if (!r1.ok) {
        const j = await r1.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r1.status}`);
      }
      setData(await r1.json());
      if (r2.ok) setUtil(await r2.json());
      else setUtil(null);
      if (r3.ok) {
        const j3 = await r3.json();
        setDraft(j3.draft ?? null);
      }
      if (r4.ok) {
        const j4 = await r4.json();
        setBillable(j4.totals ?? null);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [engagementId]);

  async function runComposer() {
    setComposerBusy(true);
    setComposerMsg(null);
    try {
      const r = await fetch(`/api/atelier/wallet/invoice-drafts/${engagementId}/run`, { method: "POST", credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setComposerMsg(`Composed ${j.draft.totals.lineCount} line(s); $${j.draft.totals.totalUsd.toFixed(2)}.`);
      await load();
    } catch (e) {
      setComposerMsg(`Compose failed: ${(e as Error).message}`);
    } finally {
      setComposerBusy(false);
    }
  }

  React.useEffect(() => { void load(); }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`/api/atelier/ledger/partner-firm-hours/${engagementId}`, { method: "POST", credentials: "include", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setUploadMsg(`Uploaded ${j.rows ?? 0} rows (batch ${j.batchRef ?? "?"}).`);
      await load();
    } catch (err) {
      setUploadMsg(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runAnalyst() {
    if (!util) return;
    setNarrLoading(true);
    setNarrative(null);
    try {
      // Server hydrates the numeric block from canonical sources; client is
      // not trusted to supply numbers the analyst will reason over.
      const r = await fetch(`/api/atelier/ledger/utilization/narrative`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: "engagement", targetId: util.engagementId, targetLabel: util.engagementName, period: "to-date" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setNarrative(j);
    } catch (e) {
      setNarrative({ runId: "", output: { refusal: (e as Error).message, headline: null, narrative: null, risks: [], actions: [], confidence: "red" } });
    } finally { setNarrLoading(false); }
  }

  return (
    <div className="space-y-6">
      <PageHero>
        <BackLink href="/finance/reports" className="mb-4" data-testid="link-back">
          Back to reports
        </BackLink>
        <div className="flex items-start justify-between gap-4">
          <SectionHead
            eyebrow="Firm · Ledger"
            headline={data?.engagementName ?? util?.engagementName ?? engagementId}
            lede="Planned vs actual hours, realized margin, burn-rate, runway, and partner-firm passthrough cost. Upload a CSV (resource_name, partner_firm_id, week_iso, hours, cost_amount, cost_currency) to record this week's hours."
          />
          <div className="flex flex-col items-end gap-2">
            <PillButton onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload CSV"}
            </PillButton>
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={onUpload} />
            {uploadMsg && <span className="text-xs text-text-mute">{uploadMsg}</span>}
          </div>
        </div>
      </PageHero>

      {error && <Card className="border-red-500/40 p-3 text-sm text-red-300">{error}</Card>}
      {loading && <Card className="p-4 text-text-mute">Loading…</Card>}

      <EngagementMarginCard engagementId={engagementId} />

      {util && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-text-mute">Burn rate</div>
              <div className="mt-1 text-3xl font-semibold"><MonoChip tone={burnTone(util.burnPct)}>{pct(util.burnPct)}</MonoChip></div>
              <div className="mt-2 text-xs text-text-mute">{util.actual.hours.toFixed(0)} / {util.planned.hours.toFixed(0)} hrs</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-text-mute">Realized margin</div>
              <div className="mt-1 text-3xl font-semibold">
                <MonoChip tone={util.actual.marginPct < util.planned.marginPct - 0.05 ? "red" : util.actual.marginPct < util.planned.marginPct ? "amber" : "green"}>
                  {pct(util.actual.marginPct)}
                </MonoChip>
              </div>
              <div className="mt-2 text-xs text-text-mute">vs planned {pct(util.planned.marginPct)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-text-mute">Billed (actual)</div>
              <div className="mt-1 text-2xl font-semibold">{fmtMoney(util.actual.billedUsd)}</div>
              <div className="mt-2 text-xs text-text-mute">cost {fmtMoney(util.actual.costUsd)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-text-mute">Runway</div>
              <div className="mt-1 text-2xl font-semibold">{util.weeksOfRunway != null ? `${util.weeksOfRunway.toFixed(1)} wk` : "—"}</div>
              <div className="mt-2 text-xs text-text-mute">at recent run-rate</div>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Planned vs actual by seniority</h3>
            {util.planVsActual.length === 0 ? (
              <p className="text-sm text-text-mute">No deal-pricing baseline; planned hours unavailable.</p>
            ) : (
              <>
              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <BarChart data={util.planVsActual.map((r) => ({ name: r.seniority, planned: Math.round(r.plannedHours), actual: Math.round(r.actualHours) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
                    <XAxis dataKey="name" stroke={palette.axis} fontSize={12} />
                    <YAxis stroke={palette.axis} fontSize={12} />
                    <Tooltip contentStyle={{ background: palette.tooltipBg, border: `1px solid ${palette.tooltipBorder}`, color: palette.tooltipText, fontSize: 12 }} labelStyle={{ color: palette.tooltipText }} itemStyle={{ color: palette.tooltipText }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: palette.axis }} />
                    <Bar dataKey="planned" name="Planned hrs" fill={palette.warnSoft} />
                    <Bar dataKey="actual" name="Actual hrs">
                      {util.planVsActual.map((r, i) => (
                        <Cell key={i} fill={r.plannedHours > 0 && r.variancePct > 0.1 ? palette.danger : r.plannedHours > 0 && r.variancePct > 0 ? palette.warn : palette.success} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Seniority</th>
                    <th className="py-1 text-right">Planned</th>
                    <th className="py-1 text-right">Actual</th>
                    <th className="py-1 text-right">Variance</th>
                    <th className="py-1 text-right">Cost</th>
                    <th className="py-1 text-right">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {util.planVsActual.map((r) => (
                    <tr key={r.seniority} className="border-t border-white/5">
                      <td className="py-2"><MonoChip>{r.seniority}</MonoChip></td>
                      <td className="py-2 text-right">{r.plannedHours.toFixed(0)}</td>
                      <td className="py-2 text-right">{r.actualHours.toFixed(0)}</td>
                      <td className="py-2 text-right">
                        {r.plannedHours > 0
                          ? <MonoChip tone={r.variancePct > 0.1 ? "red" : r.variancePct > 0 ? "amber" : "green"}>{r.variancePct >= 0 ? "+" : ""}{(r.variancePct * 100).toFixed(0)}%</MonoChip>
                          : <span className="text-text-mute">—</span>}
                      </td>
                      <td className="py-2 text-right">{fmtMoney(r.actualCostUsd)}</td>
                      <td className="py-2 text-right">{fmtMoney(r.actualPriceUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-mute">Utilization Analyst commentary</h3>
              <PillButton onClick={runAnalyst} disabled={narrLoading}>{narrLoading ? "Running…" : "Generate"}</PillButton>
            </div>
            {!narrative && <p className="text-xs text-text-mute">Click Generate to produce a partner-grade narrative anchored on the numbers above.</p>}
            {narrative?.output.refusal && (
              <div className="rounded border border-red-500/40 p-3 text-sm text-red-300">Refused: {narrative.output.refusal}</div>
            )}
            {narrative?.output.headline && (
              <div className="space-y-2">
                <div className="text-base font-semibold">{narrative.output.headline}</div>
                <div className="whitespace-pre-line text-sm text-text-soft">{narrative.output.narrative}</div>
                {narrative.output.risks.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs font-semibold text-text-mute">Risks</div>
                    {narrative.output.risks.map((r) => (
                      <div key={r.id} className="text-sm">
                        <MonoChip tone={r.severity === "red" ? "red" : "amber"}>{r.severity}</MonoChip> {r.statement}
                      </div>
                    ))}
                  </div>
                )}
                {narrative.output.actions.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs font-semibold text-text-mute">Actions</div>
                    {narrative.output.actions.map((a) => (
                      <div key={a.id} className="text-sm">• <span className="text-text-mute">{a.owner}:</span> {a.action}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <Card className="p-4 border-gold/30">
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-text-mute">Invoicing companion · client-billable + draft</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <PillButton onClick={runComposer} disabled={composerBusy} data-testid="btn-econ-compose">
              {composerBusy ? "Composing…" : "Run Invoice Composer"}
            </PillButton>
            {draft && (
              <a
                href={`/api/atelier/wallet/invoice-drafts/${engagementId}?format=csv`}
                className="text-xs text-gold underline"
                data-testid="link-econ-csv"
              >
                Download CSV
              </a>
            )}
            <Link href={`/wallet/client-billable/${engagementId}`} className="text-xs text-gold underline">
              Open client-billable queue →
            </Link>
          </div>
        </div>
        {composerMsg && <div className="mb-3 text-xs text-gold font-mono">{composerMsg}</div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-text-mute">Approved client-billable T&amp;E</div>
            <div className="mt-1 text-2xl font-semibold">{billable ? fmtMoney(billable.netUsd) : "—"}</div>
            <div className="mt-1 text-xs text-text-mute">
              {billable ? `${billable.count} item(s) · markup ${fmtMoney(billable.markupUsd)}` : "no rows yet"}
            </div>
            {billable && (
              <div className="mt-2 flex gap-1">
                {billable.sentinel.fail > 0 && <MonoChip tone="red">{billable.sentinel.fail} sentinel-fail</MonoChip>}
                {billable.sentinel.warn > 0 && <MonoChip tone="amber">{billable.sentinel.warn} sentinel-warn</MonoChip>}
                {billable.sentinel.pass > 0 && <MonoChip tone="green">{billable.sentinel.pass} clean</MonoChip>}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-text-mute">Latest invoice-line draft</div>
            <div className="mt-1 text-2xl font-semibold">{draft ? fmtMoney(draft.totals.totalUsd) : "—"}</div>
            <div className="mt-1 text-xs text-text-mute">
              {draft ? `${draft.totals.lineCount} line(s) · composed ${new Date(draft.composedAt).toLocaleDateString()}` : "no draft composed yet"}
            </div>
            {draft && (
              <div className="mt-2 flex gap-1 flex-wrap">
                <MonoChip>hours {fmtMoney(draft.totals.hoursUsd)}</MonoChip>
                <MonoChip>T&amp;E {fmtMoney(draft.totals.expensesNetUsd)}</MonoChip>
                <MonoChip tone="gold">+markup {fmtMoney(draft.totals.markupUsd)}</MonoChip>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-text-mute">Rate card</div>
            <div className="mt-1 text-sm font-mono">{draft?.rateCardId ?? "—"}</div>
            <div className="mt-2 text-xs text-text-mute">
              The Composer pulls hourly rates from the engagement's deal-pricing rate card (day-rate ÷ 8) and folds in approved client-billable expenses with their per-row markup.
            </div>
          </div>
        </div>
      </Card>

      {data && (
        <>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Partner-firm passthrough cost · roll-up</h3>
            {data.partnerFirmRollup.length === 0 ? (
              <p className="text-sm text-text-mute">No partner-firm hours recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Firm</th>
                    <th className="py-1 text-right">Hours</th>
                    <th className="py-1 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.partnerFirmRollup.map((r) => (
                    <tr key={r.partnerFirmId} className="border-t border-white/5">
                      <td className="py-2"><MonoChip>{r.partnerFirmId || "—"}</MonoChip></td>
                      <td className="py-2 text-right">{r.hours}</td>
                      <td className="py-2 text-right">{fmtMoney(r.costAmount, r.costCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Partner-firm hours · detail</h3>
            {data.rows.length === 0 ? (
              <p className="text-sm text-text-mute">No rows.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Week</th>
                    <th className="py-1">Firm</th>
                    <th className="py-1">Resource</th>
                    <th className="py-1 text-right">Hours</th>
                    <th className="py-1 text-right">Cost</th>
                    <th className="py-1">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-white/5">
                      <td className="py-2"><MonoChip>{r.weekIso}</MonoChip></td>
                      <td className="py-2"><MonoChip>{r.partnerFirmId || "—"}</MonoChip></td>
                      <td className="py-2">{r.resourceName}</td>
                      <td className="py-2 text-right">{r.hours}</td>
                      <td className="py-2 text-right">{fmtMoney(r.costAmount, r.costCurrency)}</td>
                      <td className="py-2 text-text-mute text-xs">{new Date(r.uploadedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
