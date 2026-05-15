import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { BarRows, Donut, type BarRowDatum, type DonutSegment } from "./charts";
import { useGoals, useReviews, useCheckIns, useCalibrationCohorts, useSkillGaps } from "../peopleSeed";

export function PerformanceDevelopment() {
  const goals = useGoals();
  const reviews = useReviews();
  const checkIns = useCheckIns();
  const calibration = useCalibrationCohorts();
  const skillGaps = useSkillGaps();

  const totals = calibration.reduce(
    (a, c) => ({
      exceeds: a.exceeds + c.proposedExceeds,
      meets: a.meets + c.proposedMeets,
      developing: a.developing + c.proposedDeveloping,
    }),
    { exceeds: 0, meets: 0, developing: 0 },
  );
  const ratingSegments: DonutSegment[] = [
    { label: "Exceeds", value: totals.exceeds, color: "var(--gold)" },
    { label: "Meets", value: totals.meets, color: "var(--gold-deep)" },
    { label: "Developing", value: totals.developing, color: "var(--warn)" },
  ];

  const goalsComplete = goals.filter((g) => g.status === "complete").length;
  const goalsOnTrack = goals.filter((g) => g.status === "on-track").length;
  const goalsAtRisk = goals.filter((g) => g.status === "at-risk" || g.status === "off-track").length;
  const goalCompletionPct = goals.length
    ? Math.round((goalsComplete / goals.length) * 100)
    : 0;

  const checkInsCompleted = checkIns.filter((c) => c.status === "completed").length;
  const checkInsScheduled = checkIns.filter((c) => c.status === "scheduled").length;
  const checkInsMissed = checkIns.filter((c) => c.status === "missed").length;

  const skillRows: BarRowDatum[] = skillGaps
    .slice()
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5)
    .map((s) => ({
      label: s.skill,
      value: s.gap,
      caption: `gap (${s.internalSupply}/${s.demandRoles})`,
      tone: s.gap >= 5 ? "red" : s.gap >= 3 ? "amber" : "default",
    }));

  return (
    <section className="space-y-3" data-testid="dashboard-performance">
      <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
        Performance &amp; development
      </h3>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/people/perform/calibration" data-testid="perf-rating">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Rating distribution
            </div>
            {ratingSegments.every((s) => s.value === 0) ? (
              <div className="text-xs text-text-faint">No calibration cohorts yet.</div>
            ) : (
              <Donut segments={ratingSegments} size={88} thickness={12} />
            )}
          </Card>
        </Link>

        <Link href="/people/perform/goals" data-testid="perf-goals">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Goal completion
            </div>
            <div className="text-3xl font-light text-gold leading-none">{goalCompletionPct}%</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <MonoChip tone="green">{goalsComplete} done</MonoChip>
              <MonoChip tone="gold">{goalsOnTrack} on-track</MonoChip>
              {goalsAtRisk > 0 && <MonoChip tone="amber">{goalsAtRisk} at-risk</MonoChip>}
            </div>
          </Card>
        </Link>

        <Link href="/people/perform" data-testid="perf-checkins">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Check-in cadence
            </div>
            <div className="text-3xl font-light text-gold leading-none">
              {checkInsCompleted}/{checkIns.length}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <MonoChip tone="green">{checkInsCompleted} done</MonoChip>
              <MonoChip tone="default">{checkInsScheduled} scheduled</MonoChip>
              {checkInsMissed > 0 && <MonoChip tone="red">{checkInsMissed} missed</MonoChip>}
            </div>
          </Card>
        </Link>

        <Link href="/people/develop" data-testid="perf-skills">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Top skill gaps
            </div>
            {skillRows.length === 0 ? (
              <div className="text-xs text-text-faint">No skill gaps logged.</div>
            ) : (
              <BarRows rows={skillRows} />
            )}
          </Card>
        </Link>
      </div>

      <Link href="/people/perform" data-testid="perf-reviews">
        <Card hover className="p-4 cursor-pointer">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
              Reviews · open cycle status
            </div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-mute">
              View all →
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(["open", "self-done", "manager-done", "calibrated"] as const).map((status) => {
              const count = reviews.filter((r) => r.status === status).length;
              const tone =
                status === "calibrated" ? "green" : status === "open" ? "amber" : "gold";
              return (
                <div
                  key={status}
                  className="flex items-center justify-between border border-border-soft rounded p-2"
                  data-testid={`perf-reviews-status-${status}`}
                >
                  <span className="text-xs text-text-mute capitalize">{status.replace("-", " ")}</span>
                  <MonoChip tone={tone}>{count}</MonoChip>
                </div>
              );
            })}
          </div>
        </Card>
      </Link>
    </section>
  );
}
