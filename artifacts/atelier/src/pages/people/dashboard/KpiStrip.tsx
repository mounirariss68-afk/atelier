import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Sparkline } from "./charts";
import {
  useOrgUnits,
  useEngagementSurveys,
  useFlightRisk,
  useInternalMobility,
  useReviews,
  useCalibrationCohorts,
  useMyLearning,
  useLearningCatalogue,
  useCertifications,
  useCompReview,
} from "../peopleSeed";

interface Kpi {
  id: string;
  eyebrow: string;
  value: string;
  caption: string;
  href: string;
  /** Tone for the chip (signal). */
  tone?: "default" | "gold" | "amber" | "red" | "green";
  chip?: string;
  /**
   * Real, seed-derived distributional spark — values across cohorts /
   * units / rows (NOT a fabricated time series). When omitted the
   * underlying seed has no comparable cross-section to draw.
   */
  spark?: number[];
  /**
   * Honest sub-caption describing what the spark represents
   * (e.g. "by cohort", "by unit"). The dashboard avoids "vs prior period"
   * deltas because the People seed currently has no time-series.
   */
  sparkCaption?: string;
}

export function KpiStrip() {
  const orgUnits = useOrgUnits();
  const engagement = useEngagementSurveys();
  const flightRisk = useFlightRisk();
  const mobility = useInternalMobility();
  const reviews = useReviews();
  const calibration = useCalibrationCohorts();
  const myLearning = useMyLearning();
  const catalogue = useLearningCatalogue();
  const certs = useCertifications();
  const compReview = useCompReview();

  const firm = orgUnits.find((o) => o.parentId === null);
  const headcount = firm?.headcount ?? orgUnits.reduce((s, o) => (o.parentId ? s + o.headcount : s), 0);
  // Open requisitions: prefer the firm aggregate row when it carries
  // openRoles; otherwise sum only the leaf (child) units to avoid
  // double-counting the root + children.
  const openReqs =
    firm && firm.openRoles > 0
      ? firm.openRoles
      : orgUnits.filter((o) => o.parentId !== null).reduce((s, o) => s + o.openRoles, 0);
  const firmEnps = engagement.find((e) => e.cohort === "Firm-wide")?.enpsScore ?? engagement[0]?.enpsScore ?? 0;
  const flightHigh = flightRisk.filter((r) => r.riskScore >= 0.5).length;
  const mobilityActive = mobility.filter((m) => m.status !== "moved").length;
  const mobilityRatePct = headcount ? Math.round((mobility.length / headcount) * 100) : 0;

  // Performance distribution health: % rated meets-or-better in calibration.
  const calibTotals = calibration.reduce(
    (acc, c) => {
      acc.exceeds += c.proposedExceeds;
      acc.meets += c.proposedMeets;
      acc.developing += c.proposedDeveloping;
      acc.pop += c.population;
      return acc;
    },
    { exceeds: 0, meets: 0, developing: 0, pop: 0 },
  );
  const meetsOrBetterPct = calibTotals.pop
    ? Math.round(((calibTotals.exceeds + calibTotals.meets) / calibTotals.pop) * 100)
    : 0;

  // Learning hours per FTE — sum durationHours of in-flight + completed for the
  // people with rows, normalized over headcount as a coarse proxy.
  const courseHoursById = new Map(catalogue.map((c) => [c.title, c.durationHours]));
  const totalLearningHours = myLearning.reduce((s, r) => {
    const hrs = courseHoursById.get(r.courseTitle) ?? 0;
    return s + hrs * (r.progressPct / 100);
  }, 0);
  const learningPerFte = headcount ? (totalLearningHours / headcount).toFixed(1) : "0.0";

  // Comp watch — count reviews that move people to/through bands or sit "below".
  const belowBand = compReview.filter((r) => r.bandPosition === "below").length;
  const compPending = compReview.filter((r) => r.status !== "approved").length;

  // Cert health
  const certsExpiring = certs.filter((c) => c.status === "expiring").length;
  const certsExpired = certs.filter((c) => c.status === "expired").length;

  // Reviews open
  const reviewsOpen = reviews.filter((r) => r.status === "open" || r.status === "self-done").length;

  // ---- Real, seed-derived distributional sparks (NOT time series). ----
  const unitHeadcounts = orgUnits.filter((o) => o.parentId !== null).map((o) => o.headcount);
  const unitOpenReqs = orgUnits.filter((o) => o.parentId !== null).map((o) => o.openRoles);
  const cohortEnps = engagement.map((e) => e.enpsScore);
  const flightScores = flightRisk.map((r) => Math.round(r.riskScore * 100));
  const calibMeetsByCohort = calibration.map((c) =>
    c.population ? Math.round(((c.proposedExceeds + c.proposedMeets) / c.population) * 100) : 0,
  );
  const learningProgress = myLearning.map((r) => r.progressPct);
  const compDeltas = compReview.map((r) => Math.round(r.deltaPct * 10) / 10);
  const mobilityProgress = mobility.map((m) =>
    m.status === "moved" ? 100 : m.status === "approved" ? 75 : m.status === "in-conversation" ? 50 : 25,
  );

  const enpsRange =
    cohortEnps.length > 1
      ? `cohorts ${Math.min(...cohortEnps)}–${Math.max(...cohortEnps)}`
      : undefined;

  const kpis: Kpi[] = [
    {
      id: "headcount",
      eyebrow: "Headcount",
      value: String(headcount),
      caption: "active people, firm-wide",
      href: "/people/people",
      tone: "gold",
      chip: `${orgUnits.filter((o) => o.parentId !== null).length} units`,
      spark: unitHeadcounts,
      sparkCaption: "by unit",
    },
    {
      id: "open-reqs",
      eyebrow: "Open requisitions",
      value: String(openReqs),
      caption: "across all business units",
      href: "/people/hire",
      tone: openReqs > 4 ? "amber" : "default",
      chip: "live",
      spark: unitOpenReqs,
      sparkCaption: "by unit",
    },
    {
      id: "flight-risk",
      eyebrow: "Flight-risk watch",
      value: String(flightHigh),
      caption: `of ${flightRisk.length} flagged ≥ 50%`,
      href: "/people/retain/flight-risk",
      tone: flightHigh > 0 ? "red" : "green",
      chip: "regrettable",
      spark: flightScores,
      sparkCaption: "risk-score per row",
    },
    {
      id: "enps",
      eyebrow: "Engagement (eNPS)",
      value: String(firmEnps),
      caption: `firm-wide · ${engagement[0]?.capturedOn ?? "latest"}${enpsRange ? ` · ${enpsRange}` : ""}`,
      href: "/people/retain/engagement",
      tone: firmEnps >= 40 ? "green" : firmEnps >= 20 ? "gold" : "amber",
      chip: "pulse",
      spark: cohortEnps,
      sparkCaption: "by cohort",
    },
    {
      id: "mobility",
      eyebrow: "Internal mobility",
      value: `${mobilityRatePct}%`,
      caption: `${mobilityActive} active moves in flight`,
      href: "/people/retain/mobility",
      tone: "gold",
      chip: "rate",
      spark: mobilityProgress,
      sparkCaption: "stage of in-flight moves",
    },
    {
      id: "perf-health",
      eyebrow: "Performance health",
      value: `${meetsOrBetterPct}%`,
      caption: `meets-or-better · ${reviewsOpen} review${reviewsOpen === 1 ? "" : "s"} still open`,
      href: "/people/perform",
      tone: meetsOrBetterPct >= 90 ? "green" : "gold",
      chip: "calibrated",
      spark: calibMeetsByCohort,
      sparkCaption: "by calibration cohort",
    },
    {
      id: "learning",
      eyebrow: "Learning · hrs / FTE",
      value: learningPerFte,
      caption: `${certsExpiring} cert${certsExpiring === 1 ? "" : "s"} expiring · ${certsExpired} expired`,
      href: "/people/develop",
      tone: certsExpired > 0 ? "amber" : "default",
      chip: "QTD",
      spark: learningProgress,
      sparkCaption: "progress per learner",
    },
    {
      id: "comp",
      eyebrow: "Comp · pay-equity",
      value: String(compPending),
      caption: `pending decisions · ${belowBand} below band`,
      href: "/people/reward/review",
      tone: belowBand > 0 ? "amber" : "gold",
      chip: "watch",
      spark: compDeltas,
      sparkCaption: "Δ% per proposed change",
    },
  ];

  return (
    <section className="space-y-3" data-testid="dashboard-kpi-strip">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
          Workforce pulse
        </h3>
        <span
          className="font-mono text-[10px] uppercase tracking-widest text-text-faint"
          data-testid="kpi-strip-baseline-note"
        >
          No prior-period baseline available · sparks are cross-sectional shapes
        </span>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 2xl:grid-cols-8">
        {kpis.map((k) => (
          <Link key={k.id} href={k.href} data-testid={`kpi-${k.id}`}>
            <Card hover className="p-3 cursor-pointer h-full flex flex-col justify-between min-h-[112px]">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint truncate">
                  {k.eyebrow}
                </div>
                {k.chip && <MonoChip tone={k.tone}>{k.chip}</MonoChip>}
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className={cn("text-2xl font-light leading-none", k.tone === "red" ? "text-danger" : "text-gold")}>
                  {k.value}
                </div>
                {k.spark && k.spark.length > 1 && (
                  <Sparkline values={k.spark} width={56} height={20} />
                )}
              </div>
              {k.spark && k.spark.length > 1 && k.sparkCaption && (
                <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-text-faint">
                  {k.sparkCaption}
                </div>
              )}
              <div className="mt-2 text-[11px] text-text-mute leading-snug line-clamp-2">
                {k.caption}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
