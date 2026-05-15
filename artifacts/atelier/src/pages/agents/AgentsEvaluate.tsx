/**
 * Agents lens — Evaluate stage (Task #370).
 *
 * Eval suites with rubric, case count, and last-run pass-rate.
 */
import * as React from "react";
import { Play } from "lucide-react";
import {
  Card,
  MonoChip,
  Eyebrow,
  HeroStat,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import {
  useEvalSuites,
  useRunEvalSuite,
  type EvalRunResult,
} from "@/lib/agents-lens-seed";

export default function AgentsEvaluate() {
  const suites = useEvalSuites();
  const runSuite = useRunEvalSuite();
  const [results, setResults] = React.useState<Record<string, EvalRunResult>>({});
  const [pending, setPending] = React.useState<string | null>(null);

  const handleRun = (suiteId: string) => {
    setPending(suiteId);
    // Simulate a short scorecard run so the spinner is visible.
    setTimeout(() => {
      const r = runSuite(suiteId);
      if (r) setResults((prev) => ({ ...prev, [suiteId]: r }));
      setPending(null);
    }, 600);
  };
  const avgPass = suites.length
    ? Math.round((suites.reduce((s, x) => s + x.passRate, 0) / suites.length) * 100)
    : 0;
  const totalCases = suites.reduce((s, x) => s + x.caseCount, 0);

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Evaluate — eval suites and scorecards"
        lede="Regression, red-team and A/B suites graded against golden datasets. Failing cases feed the Improve loop."
      />
      <div className="container-atelier pt-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <HeroStat size="md" value={suites.length} caption={<span>Active suites</span>} />
          <HeroStat size="md" value={totalCases} caption={<span>Cases under coverage</span>} />
          <HeroStat size="md" value={`${avgPass}%`} caption={<span>Average pass rate</span>} />
        </div>
      </div>

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
              <div className="flex items-center justify-between gap-2 pt-1">
                {results[s.id] ? (
                  <span
                    className="text-xs font-mono text-text-mute"
                    data-testid={`eval-result-${s.id}`}
                  >
                    Last run: <span className="text-success">{results[s.id].passed} passed</span> ·{" "}
                    <span className="text-danger">{results[s.id].failed} failed</span>
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-text-faint">
                    Run produces a fresh scorecard.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRun(s.id)}
                  disabled={pending === s.id}
                  data-testid={`button-run-suite-${s.id}`}
                  className="inline-flex items-center gap-1.5 bg-gold text-bg-deep px-3 py-1.5 rounded text-xs font-medium hover:bg-gold/90 disabled:opacity-50 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  {pending === s.id ? "Running…" : "Run suite"}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
