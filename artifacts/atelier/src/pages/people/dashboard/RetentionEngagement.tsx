import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { BarRows, LineChart, type BarRowDatum } from "./charts";
import {
  useFlightRisk,
  useEngagementSurveys,
  useStayInterviews,
  useAttritionHistory,
} from "../peopleSeed";

const MONTH_TICK_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function shortMonth(iso: string): string {
  const [, mm] = iso.split("-");
  const idx = Number(mm) - 1;
  return MONTH_TICK_LABELS[idx] ?? iso;
}

export function RetentionEngagement() {
  const flightRisk = useFlightRisk();
  const engagement = useEngagementSurveys();
  const stay = useStayInterviews();
  const attritionHistory = useAttritionHistory();

  const watchlist = flightRisk
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  function nextActionFor(score: number, lastConversation: string | null): string {
    if (score >= 0.7) return "Book stay interview this week";
    if (score >= 0.5) return lastConversation ? "Manager follow-up · refresh signals" : "Schedule stay interview";
    return "Hold for next pulse · monitor signals";
  }

  const enpsRows: BarRowDatum[] = engagement.map((e) => ({
    label: e.cohort,
    value: e.enpsScore,
    caption: `· ${e.participants}`,
    tone: e.enpsScore >= 40 ? "green" : e.enpsScore >= 20 ? "gold" : "amber",
  }));
  const enpsMax = Math.max(60, ...engagement.map((e) => e.enpsScore));

  return (
    <section className="space-y-3" data-testid="dashboard-retention">
      <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
        Retention &amp; engagement
      </h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2" data-testid="retention-watchlist">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
              Flight-risk watchlist
            </div>
            <Link
              href="/people/retain/flight-risk"
              className="font-mono text-[10px] uppercase tracking-widest text-text-mute hover:text-gold"
            >
              Open Retain
            </Link>
          </div>
          {watchlist.length === 0 ? (
            <div className="text-xs text-text-faint">No flight-risk signals.</div>
          ) : (
            <div className="space-y-1.5">
              {watchlist.map((r) => (
                <Link
                  key={r.id}
                  href="/people/retain/flight-risk"
                  data-testid={`flight-risk-${r.id}`}
                  className="flex items-center gap-3 p-2 rounded hover:bg-bg-elevate-2 transition-colors"
                >
                  <MonoChip
                    tone={r.riskScore > 0.6 ? "red" : r.riskScore > 0.4 ? "amber" : "default"}
                  >
                    {Math.round(r.riskScore * 100)}%
                  </MonoChip>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text truncate">
                      {r.personName}{" "}
                      <span className="text-text-faint text-xs">· {r.level}</span>
                    </div>
                    <div className="text-[11px] text-text-mute truncate">
                      {r.signals[0]}
                      {r.signals.length > 1 ? ` · +${r.signals.length - 1} more` : ""}
                    </div>
                    <div className="text-[11px] text-gold/90 truncate mt-0.5">
                      Next: {nextActionFor(r.riskScore, r.lastConversation)}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-text-faint shrink-0 hidden md:block">
                    owner · {r.ownerName}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <Link href="/people/retain/engagement" data-testid="retention-enps">
            <Card hover className="p-4 cursor-pointer">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                Engagement pulse · eNPS by cohort
              </div>
              {enpsRows.length === 0 ? (
                <div className="text-xs text-text-faint">No survey data yet.</div>
              ) : (
                <BarRows rows={enpsRows} max={enpsMax} />
              )}
            </Card>
          </Link>

          <Link href="/people/retain/stay" data-testid="retention-stay">
            <Card hover className="p-4 cursor-pointer">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
                Stay interviews · last 30 days
              </div>
              <div className="text-2xl font-light text-gold leading-none">{stay.length}</div>
              <div className="mt-2 text-xs text-text-mute">
                {stay[0]
                  ? `Latest: ${stay[0].personName} by ${stay[0].conductedBy}`
                  : "No stay interviews logged."}
              </div>
            </Card>
          </Link>
        </div>
      </div>

      <Link href="/people/retain" data-testid="retention-attrition">
        <Card hover className="p-4 cursor-pointer">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
              Attrition trend · rolling 12 months
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-text-faint">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-0.5" style={{ background: "var(--gold)" }} />
                Voluntary
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-0.5" style={{ background: "var(--danger)" }} />
                Regrettable
              </span>
            </div>
          </div>
          {attritionHistory.length === 0 ? (
            <div className="text-xs text-text-faint">No attrition history available.</div>
          ) : (
            <>
              <LineChart
                width={720}
                height={140}
                labels={attritionHistory.map((m) => shortMonth(m.month))}
                series={[
                  {
                    label: "Voluntary",
                    values: attritionHistory.map((m) => m.voluntaryLeavers),
                    color: "var(--gold)",
                  },
                  {
                    label: "Regrettable",
                    values: attritionHistory.map((m) => m.regrettableLeavers),
                    color: "var(--danger)",
                  },
                ]}
              />
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-text-mute">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
                    Voluntary · TTM
                  </div>
                  <div className="text-text">
                    {attritionHistory.reduce((s, m) => s + m.voluntaryLeavers, 0)} leavers
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
                    Regrettable · TTM
                  </div>
                  <div className="text-text">
                    {attritionHistory.reduce((s, m) => s + m.regrettableLeavers, 0)} leavers
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
                    Joiners · TTM
                  </div>
                  <div className="text-text">
                    {attritionHistory.reduce((s, m) => s + m.joiners, 0)} hires
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
                    Net headcount Δ
                  </div>
                  <div className="text-text">
                    {(() => {
                      const first = attritionHistory[0];
                      const last = attritionHistory[attritionHistory.length - 1];
                      const d = last.active - (first.active - first.joiners + first.leavers);
                      return `${d >= 0 ? "+" : ""}${d} vs ${attritionHistory[0].month}`;
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </Link>
    </section>
  );
}
