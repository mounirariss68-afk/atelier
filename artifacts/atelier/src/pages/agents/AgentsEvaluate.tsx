/**
 * Agents lens — Evaluate stage (Task #370).
 *
 * Eval suites with rubric, case count, and last-run pass-rate.
 */
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  Eyebrow,
  HeroStat,
} from "@/components/ui/primitives";
import { useEvalSuites } from "@/lib/agents-lens-seed";

export default function AgentsEvaluate() {
  const suites = useEvalSuites();
  const avgPass = suites.length
    ? Math.round((suites.reduce((s, x) => s + x.passRate, 0) / suites.length) * 100)
    : 0;
  const totalCases = suites.reduce((s, x) => s + x.caseCount, 0);

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Manage · Agents · Evaluate</Eyebrow>
        <SectionHead
          headline="Evaluate — eval suites and scorecards"
          lede="Regression, red-team and A/B suites graded against golden datasets. Failing cases feed the Improve loop."
          className="mt-3"
        />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
          <HeroStat size="md" value={suites.length} caption={<span>Active suites</span>} />
          <HeroStat size="md" value={totalCases} caption={<span>Cases under coverage</span>} />
          <HeroStat size="md" value={`${avgPass}%`} caption={<span>Average pass rate</span>} />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-3">
        {suites.map((s) => {
          const pct = Math.round(s.passRate * 100);
          const tone = pct >= 90 ? "green" : pct >= 75 ? "gold" : "default";
          return (
            <Card key={s.id} className="p-5 space-y-3" data-testid={`eval-suite-${s.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-text">{s.name}</h3>
                    <MonoChip>{s.kind.replace("_", "-")}</MonoChip>
                    <MonoChip>{s.agentName}</MonoChip>
                  </div>
                  <p className="text-xs text-text-mute font-mono">{s.rubric}</p>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="text-xs font-mono text-text-faint">cases</div>
                    <div className="text-text">{s.caseCount}</div>
                  </div>
                  <div>
                    <div className="text-xs font-mono text-text-faint">pass</div>
                    <MonoChip tone={tone}>{pct}%</MonoChip>
                  </div>
                </div>
              </div>
              <div className="text-xs font-mono text-text-faint flex justify-between">
                <span>owner: {s.ownedBy}</span>
                <span>last run: {new Date(s.lastRunAt).toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-bg-deep rounded overflow-hidden">
                <div
                  className="h-full bg-gold/70"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
