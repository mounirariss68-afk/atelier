import * as React from "react";
import { useParams } from "wouter";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface RollupRow { partnerFirmId: string; hours: number; costAmount: number; costCurrency: string; }
interface HoursRow { id: string; partnerFirmId: string; resourceName: string; weekIso: string; hours: number; costAmount: number; costCurrency: string; uploadedAt: string; }
interface EconResp { engagementId: string; engagementName: string; partnerFirmRollup: RollupRow[]; rows: HoursRow[]; }

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
  const fileInput = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/atelier/ledger/engagement-economics/${engagementId}`, { credentials: "include" }),
        fetch(`/api/atelier/ledger/utilization/engagement/${engagementId}`, { credentials: "include" }),
      ]);
      if (!r1.ok) {
        const j = await r1.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r1.status}`);
      }
      setData(await r1.json());
      if (r2.ok) setUtil(await r2.json());
      else setUtil(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [engagementId]);

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
      const numericBlock = {
        utilizationPct: util.burnPct,
        targetPct: 1.0,
        plannedHours: util.planned.hours,
        actualHours: util.actual.hours,
        plannedMarginPct: util.planned.marginPct,
        realizedMarginPct: util.actual.marginPct,
        burnPct: util.burnPct,
        weeksOfRunway: util.weeksOfRunway,
      };
      const r = await fetch(`/api/atelier/ledger/utilization/narrative`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: "engagement", targetId: util.engagementId, targetLabel: util.engagementName, period: "to-date", numericBlock }),
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
        <div className="flex items-start justify-between gap-4">
          <SectionHead
            eyebrow={<MonoChip tone="gold">Ledger · Engagement economics</MonoChip>}
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
              <table className="w-full text-sm">
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
