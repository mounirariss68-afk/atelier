import * as React from "react";
import { useParams, Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface WeekRow { weekIso: string; weekStartDate: string; billableHours: number; totalHours: number; utilizationPct: number; targetPct: number; }
interface MixRow { engagementId: string | null; name: string; hours: number; billable: boolean; }
interface PersonResp {
  personId: string;
  personLabel: string;
  role: string;
  seniority: string;
  targetPct: number;
  rolling4UtilPct: number;
  ytdUtilPct: number;
  variancePct: number;
  weeks: WeekRow[];
  engagementMix: MixRow[];
  snapshotsAvailable: boolean;
  computedAt: string | null;
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

function pct(n: number): string { return `${(n * 100).toFixed(0)}%`; }

function utilTone(util: number, target: number): "green" | "amber" | "red" {
  if (util >= target) return "green";
  if (util >= target - 0.1) return "amber";
  return "red";
}

export default function Utilization() {
  const params = useParams<{ personId?: string }>();
  const [me, setMe] = React.useState<{ id: string; role: string; name: string } | null>(null);
  const personId = params.personId ?? me?.id ?? "";

  const [data, setData] = React.useState<PersonResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [narrative, setNarrative] = React.useState<NarrativeResp | null>(null);
  const [narrLoading, setNarrLoading] = React.useState(false);

  React.useEffect(() => {
    void fetch("/api/atelier/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => setMe(j ?? null));
  }, []);

  const load = React.useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/ledger/utilization/person/${encodeURIComponent(personId)}`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [personId]);

  React.useEffect(() => { void load(); }, [load]);

  async function runAnalyst() {
    if (!data) return;
    setNarrLoading(true);
    setNarrative(null);
    try {
      // numericBlock is hydrated server-side from the snapshot store; we
      // only send the view + target so the analyst's numbers can never be
      // forged by the browser.
      const r = await fetch(`/api/atelier/ledger/utilization/narrative`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: "person", targetId: data.personId, targetLabel: data.personLabel, period: "rolling-4w" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setNarrative(j);
    } catch (e) {
      setNarrative({ runId: "", output: { refusal: (e as Error).message, headline: null, narrative: null, risks: [], actions: [], confidence: "red" } });
    } finally { setNarrLoading(false); }
  }

  if (!personId) return <Card className="p-4 text-text-mute">Loading persona…</Card>;

  return (
    <div className="space-y-6">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Ledger · Utilization"
          headline={data?.personLabel ?? personId}
          lede={data ? `${data.role} · ${data.seniority} · target ${pct(data.targetPct)}. Rolling 4-week + YTD + engagement mix from snapshot store.` : "Loading…"}
        />
      </PageHero>

      {error && <Card className="border-red-500/40 p-3 text-sm text-red-300">{error}</Card>}
      {loading && <Card className="p-4 text-text-mute">Loading…</Card>}

      {data && !data.snapshotsAvailable && (
        <Card className="border-amber-500/40 p-4 text-sm text-amber-200">
          No utilization snapshots have been computed for this person yet. Ask Operations to run the snapshot tick from Firm Economics.
        </Card>
      )}

      {data && data.snapshotsAvailable && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="p-4">
              <div className="text-xs text-text-mute">Rolling 4 weeks</div>
              <div className="mt-1 text-3xl font-semibold">
                <MonoChip tone={utilTone(data.rolling4UtilPct, data.targetPct)}>{pct(data.rolling4UtilPct)}</MonoChip>
              </div>
              <div className="mt-2 text-xs text-text-mute">Target {pct(data.targetPct)} · variance {data.variancePct >= 0 ? "+" : ""}{(data.variancePct * 100).toFixed(0)} pts</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-text-mute">Year to date</div>
              <div className="mt-1 text-3xl font-semibold"><MonoChip>{pct(data.ytdUtilPct)}</MonoChip></div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-text-mute">Snapshot age</div>
              <div className="mt-1 text-sm">{data.computedAt ? new Date(data.computedAt).toLocaleString() : "—"}</div>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Weekly utilization trend</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={data.weeks.map((w) => ({ week: w.weekIso.slice(5), util: Math.round(w.utilizationPct * 100), target: Math.round(w.targetPct * 100) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                  <XAxis dataKey="week" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={Math.round(data.targetPct * 100)} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "Target", position: "right", fill: "#fbbf24", fontSize: 11 }} />
                  <Line type="monotone" dataKey="util" name="Utilization %" stroke="#34d399" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-text-mute">
                <tr>
                  <th className="py-1">Week</th>
                  <th className="py-1 text-right">Billable hrs</th>
                  <th className="py-1 text-right">Total hrs</th>
                  <th className="py-1 text-right">Utilization</th>
                  <th className="py-1 text-right">Target</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((w) => (
                  <tr key={w.weekIso} className="border-t border-white/5">
                    <td className="py-2"><MonoChip>{w.weekIso}</MonoChip></td>
                    <td className="py-2 text-right">{w.billableHours.toFixed(1)}</td>
                    <td className="py-2 text-right">{w.totalHours.toFixed(1)}</td>
                    <td className="py-2 text-right"><MonoChip tone={utilTone(w.utilizationPct, w.targetPct)}>{pct(w.utilizationPct)}</MonoChip></td>
                    <td className="py-2 text-right text-text-mute">{pct(w.targetPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Engagement mix (rolling 4 weeks)</h3>
            {data.engagementMix.length === 0 ? (
              <p className="text-sm text-text-mute">No billable engagements in the window.</p>
            ) : (
              <>
              <div className="h-56 w-full">
                <ResponsiveContainer>
                  <BarChart data={data.engagementMix.slice(0, 8).map((m) => ({ name: m.name.length > 22 ? m.name.slice(0, 22) + "…" : m.name, hours: m.hours, billable: m.billable }))} layout="vertical" margin={{ left: 32 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis type="number" stroke="#94a3b8" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={140} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} />
                    <Bar dataKey="hours" name="Hours">
                      {data.engagementMix.slice(0, 8).map((m, i) => (
                        <Cell key={i} fill={m.billable ? "#34d399" : "#94a3b8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Engagement</th>
                    <th className="py-1 text-right">Hours</th>
                    <th className="py-1">Type</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.engagementMix.map((m, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="py-2">{m.name}</td>
                      <td className="py-2 text-right">{m.hours.toFixed(1)}</td>
                      <td className="py-2">{m.billable ? <MonoChip tone="green">Billable</MonoChip> : <MonoChip>Internal</MonoChip>}</td>
                      <td className="py-2 text-right">
                        {m.engagementId && <Link href={`/ledger/engagement-economics/${m.engagementId}`} className="text-xs text-gold-400 hover:underline">Open economics →</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-mute">Utilization Analyst narrative</h3>
              <PillButton onClick={runAnalyst} disabled={narrLoading}>{narrLoading ? "Running…" : "Generate"}</PillButton>
            </div>
            {!narrative && <p className="text-xs text-text-mute">Click Generate to produce a partner-grade narrative anchored on the numbers above.</p>}
            {narrative?.output.refusal && (
              <div className="rounded border border-red-500/40 p-3 text-sm text-red-300">
                Refused: {narrative.output.refusal}
              </div>
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
                <div className="mt-2 text-xs text-text-mute">Confidence: <MonoChip tone={narrative.output.confidence === "red" ? "red" : narrative.output.confidence === "amber" ? "amber" : "green"}>{narrative.output.confidence}</MonoChip></div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
