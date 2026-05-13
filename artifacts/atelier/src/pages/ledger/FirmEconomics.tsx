import * as React from "react";
import { Link } from "wouter";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface PartnerSummary { partnerId: string; partnerName: string; utilPct: number; targetPct: number; peopleCount: number; people: { personId: string; name: string; utilPct: number; targetPct: number }[]; }
interface SectorSummary { sector: string; plannedMarginPct: number; realizedMarginPct: number; engagementCount: number; revenueUsd: number; }
interface EngagementRollup { engagementId: string; engagementName: string; accountName: string; sector: string; partnerOwnerId: string; opportunityId: string | null; plannedMarginPct: number; realizedMarginPct: number; targetMarginPct: number; belowTarget: boolean; reLookHref: string | null; leakageHours: number; }

interface FirmResp {
  period: { weeks: number; weekIsos: string[] };
  realizationRatePct: number;
  fullRateInvoicedHours: number;
  fullRateAvailableHours: number;
  partnerSummary: PartnerSummary[];
  sectorSummary: SectorSummary[];
  engagementRollup: EngagementRollup[];
  snapshotsAvailable: boolean;
  computedAt: string | null;
}

function pct(n: number): string { return `${(n * 100).toFixed(0)}%`; }
function fmtMoney(n: number): string { try { return new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); } catch { return `$${n.toFixed(0)}`; } }
function tone(util: number, target: number): "green" | "amber" | "red" {
  if (util >= target) return "green";
  if (util >= target - 0.1) return "amber";
  return "red";
}

export default function FirmEconomics() {
  const [data, setData] = React.useState<FirmResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [busyMsg, setBusyMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/ledger/utilization/firm`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function runJob(path: string, label: string) {
    setBusy(label);
    setBusyMsg(null);
    try {
      const r = await fetch(`/api/atelier/${path}`, { method: "POST", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setBusyMsg(`${label}: ${JSON.stringify(j)}`);
      await load();
    } catch (e) {
      setBusyMsg(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero>
        <div className="flex items-start justify-between gap-4">
          <SectionHead
            eyebrow={<MonoChip tone="gold">Ledger · Firm economics</MonoChip>}
            headline="Firm utilization, realization, and leakage"
            lede={data ? `Rolling ${data.period.weeks} weeks. Realization rate ${pct(data.realizationRatePct)} (${data.fullRateInvoicedHours.toFixed(0)} of ${data.fullRateAvailableHours.toFixed(0)} full-rate hours).` : "Loading…"}
          />
          <div className="flex flex-col items-end gap-2">
            <PillButton onClick={() => runJob("ledger/utilization/snapshot/run", "Snapshot tick")} disabled={!!busy}>
              {busy === "Snapshot tick" ? "Running…" : "Recompute snapshots"}
            </PillButton>
            <PillButton variant="ghost" onClick={() => runJob("ledger/burn-sentinel/run", "Burn Sentinel")} disabled={!!busy}>
              {busy === "Burn Sentinel" ? "Running…" : "Run Burn Sentinel"}
            </PillButton>
            {busyMsg && <span className="text-xs text-text-mute max-w-xs text-right">{busyMsg}</span>}
          </div>
        </div>
      </PageHero>

      {error && <Card className="border-red-500/40 p-3 text-sm text-red-300">{error}</Card>}
      {loading && <Card className="p-4 text-text-mute">Loading…</Card>}

      {data && !data.snapshotsAvailable && (
        <Card className="border-amber-500/40 p-4 text-sm text-amber-200">
          No snapshots yet. Click <strong>Recompute snapshots</strong> to materialise utilization for the last 8 ISO weeks.
        </Card>
      )}

      {data && (
        <>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Utilization by partner owner</h3>
            {data.partnerSummary.length === 0 ? (
              <p className="text-sm text-text-mute">No partner-attributed utilization in window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Partner</th>
                    <th className="py-1 text-right">People</th>
                    <th className="py-1 text-right">Utilization</th>
                    <th className="py-1 text-right">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {data.partnerSummary.map((p) => (
                    <tr key={p.partnerId} className="border-t border-white/5">
                      <td className="py-2">{p.partnerName}</td>
                      <td className="py-2 text-right">{p.peopleCount}</td>
                      <td className="py-2 text-right"><MonoChip tone={tone(p.utilPct, p.targetPct)}>{pct(p.utilPct)}</MonoChip></td>
                      <td className="py-2 text-right text-text-mute">{pct(p.targetPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Margin realization by sector</h3>
            {data.sectorSummary.length === 0 ? (
              <p className="text-sm text-text-mute">No sector data yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Sector</th>
                    <th className="py-1 text-right">Engagements</th>
                    <th className="py-1 text-right">Realized margin</th>
                    <th className="py-1 text-right">Planned margin</th>
                    <th className="py-1 text-right">Revenue (actual)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sectorSummary.map((s) => (
                    <tr key={s.sector} className="border-t border-white/5">
                      <td className="py-2">{s.sector}</td>
                      <td className="py-2 text-right">{s.engagementCount}</td>
                      <td className="py-2 text-right"><MonoChip tone={s.realizedMarginPct < s.plannedMarginPct - 0.05 ? "red" : s.realizedMarginPct < s.plannedMarginPct ? "amber" : "green"}>{pct(s.realizedMarginPct)}</MonoChip></td>
                      <td className="py-2 text-right text-text-mute">{pct(s.plannedMarginPct)}</td>
                      <td className="py-2 text-right">{fmtMoney(s.revenueUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Engagement-by-engagement realization & leakage</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-text-mute">
                <tr>
                  <th className="py-1">Engagement</th>
                  <th className="py-1">Account</th>
                  <th className="py-1 text-right">Realized margin</th>
                  <th className="py-1 text-right">Target</th>
                  <th className="py-1 text-right">Leakage (hrs)</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {data.engagementRollup.map((e) => (
                  <tr key={e.engagementId} className="border-t border-white/5">
                    <td className="py-2">
                      <Link href={`/ledger/engagement-economics/${e.engagementId}`} className="hover:underline">{e.engagementName}</Link>
                    </td>
                    <td className="py-2 text-text-mute">{e.accountName}</td>
                    <td className="py-2 text-right"><MonoChip tone={e.belowTarget ? "red" : "green"}>{pct(e.realizedMarginPct)}</MonoChip></td>
                    <td className="py-2 text-right text-text-mute">{pct(e.targetMarginPct)}</td>
                    <td className="py-2 text-right">{e.leakageHours.toFixed(0)}</td>
                    <td className="py-2 text-right">
                      {e.reLookHref ? <Link href={e.reLookHref} className="text-xs text-gold-400 hover:underline">Re-look pricing →</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
