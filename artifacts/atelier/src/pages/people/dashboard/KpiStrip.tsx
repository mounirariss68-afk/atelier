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
  useHeadcountHistory,
  useEnpsHistory,
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
   * Spark values. Either a real monthly time-series (preferred — see
   * `sparkCaption`), or a cross-sectional shape across cohorts / units
   * when no time-series is available.
   */
  spark?: number[];
  /** Honest sub-caption describing what the spark represents. */
  sparkCaption?: string;
}

function formatSignedDelta(n: number, suffix = ""): string {
  if (n === 0) return `±0${suffix}`;
  return `${n > 0 ? "+" : ""}${n}${suffix}`;
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
  const headcountHistory = useHeadcountHistory();
  const enpsHistory = useEnpsHistory();

  const firm = orgUnits.find((o) => o.parentId === null);
  // Open requisitions: prefer the firm aggregate row when it carries
  // openRoles; otherwise sum only the leaf (child) units to avoid
  // double-counting the root + children.
  const openReqs =
    firm && firm.openRoles > 0
      ? firm.openRoles
      : orgUnits.filter((o) => o.parentId !== null).reduce((s, o) => s + o.openRoles, 0);

  // ---- Headcount: real monthly time-series + Δ vs prior month / quarter. ----
  const headcountSeries = headcountHistory.map((h) => h.active);
  const latestHeadcount = headcountSeries[headcountSeries.length - 1] ?? 0;
  const priorMonthHeadcount = headcountSeries[headcountSeries.length - 2] ?? latestHeadcount;
  const priorQuarterHeadcount = headcountSeries[headcountSeries.length - 4] ?? latestHeadcount;
  const headcountDeltaMo = latestHeadcount - priorMonthHeadcount;
  const headcountDeltaQtr = latestHeadcount - priorQuarterHeadcount;

  // ---- Voluntary / regrettable attrition rolling windows. ----
  // Annualized rate = sum(voluntary leavers in window) / avg active * (12 / window).
  function annualizedAttritionPct(window: number, end = headcountHistory.length): number {
    const slice = headcountHistory.slice(Math.max(0, end - window), end);
    if (slice.length === 0) return 0;
    const leavers = slice.reduce((s, m) => s + m.voluntaryLeavers, 0);
    const avgActive = slice.reduce((s, m) => s + m.active, 0) / slice.length;
    if (avgActive === 0) return 0;
    return (leavers / avgActive) * (12 / slice.length) * 100;
  }
  const volAttritionTtmPct = annualizedAttritionPct(12);
  const volAttritionPriorTtmPct = annualizedAttritionPct(12, headcountHistory.length - 3);
  const volAttritionDeltaPct = volAttritionTtmPct - volAttritionPriorTtmPct;
  const volLeaversByMonth = headcountHistory.map((h) => h.voluntaryLeavers);

  const firmEnps = engagement.find((e) => e.cohort === "Firm-wide")?.enpsScore ?? engagement[0]?.enpsScore ?? 0;
  const flightHigh = flightRisk.filter((r) => r.riskScore >= 0.5).length;
  const mobilityActive = mobility.filter((m) => m.status !== "moved").length;
  const mobilityRatePct = latestHeadcount ? Math.round((mobility.length / latestHeadcount) * 100) : 0;

  // ---- eNPS: real quarterly history + Δ vs prior survey. ----
  const enpsSeries = enpsHistory.map((e) => e.enpsScore);
  const enpsLatest = enpsSeries[enpsSeries.length - 1] ?? firmEnps;
  const enpsPrior = enpsSeries[enpsSeries.length - 2] ?? enpsLatest;
  const enpsDelta = enpsLatest - enpsPrior;

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
  const learningPerFte = latestHeadcount ? (totalLearningHours / latestHeadcount).toFixed(1) : "0.0";

  // Comp watch — count reviews that move people to/through bands or sit "below".
  const belowBand = compReview.filter((r) => r.bandPosition === "below").length;
  const compPending = compReview.filter((r) => r.status !== "approved").length;

  // Cert health
  const certsExpiring = certs.filter((c) => c.status === "expiring").length;
  const certsExpired = certs.filter((c) => c.status === "expired").length;

  // Reviews open
  const reviewsOpen = reviews.filter((r) => r.status === "open" || r.status === "self-done").length;

  // ---- Cross-sectional sparks for tiles without a real time-series. ----
  const unitOpenReqs = orgUnits.filter((o) => o.parentId !== null).map((o) => o.openRoles);
  const flightScores = flightRisk.map((r) => Math.round(r.riskScore * 100));
  const calibMeetsByCohort = calibration.map((c) =>
    c.population ? Math.round(((c.proposedExceeds + c.proposedMeets) / c.population) * 100) : 0,
  );
  const learningProgress = myLearning.map((r) => r.progressPct);
  const compDeltas = compReview.map((r) => Math.round(r.deltaPct * 10) / 10);
  const mobilityProgress = mobility.map((m) =>
    m.status === "moved" ? 100 : m.status === "approved" ? 75 : m.status === "in-conversation" ? 50 : 25,
  );

  const headcountChip = `${formatSignedDelta(headcountDeltaMo)} mo · ${formatSignedDelta(headcountDeltaQtr)} qtr`;
  const enpsChip = `${formatSignedDelta(enpsDelta)} pts vs prior`;
  const volChipDelta = volAttritionDeltaPct >= 0 ? "+" : "";
  const volAttritionChip = `${volChipDelta}${volAttritionDeltaPct.toFixed(1)} pp TTM`;

  const kpis: Kpi[] = [
    {
      id: "headcount",
      eyebrow: "Headcount",
      value: String(latestHeadcount),
      caption: `active firm-wide · prior mo ${priorMonthHeadcount} · prior qtr ${priorQuarterHeadcount}`,
      href: "/people/people",
      tone: headcountDeltaMo >= 0 ? "green" : "amber",
      chip: headcountChip,
      spark: headcountSeries,
      sparkCaption: "monthly · last 12mo",
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
      id: "voluntary-attrition",
      eyebrow: "Voluntary attrition",
      value: `${volAttritionTtmPct.toFixed(1)}%`,
      caption: `annualized · TTM · prior 9mo ${volAttritionPriorTtmPct.toFixed(1)}%`,
      href: "/people/retain",
      tone:
        volAttritionDeltaPct > 1
          ? "red"
          : volAttritionDeltaPct < -1
            ? "green"
            : "amber",
      chip: volAttritionChip,
      spark: volLeaversByMonth,
      sparkCaption: "voluntary leavers · monthly",
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
      value: String(enpsLatest),
      caption: `firm-wide · ${enpsHistory[enpsHistory.length - 1]?.capturedOn ?? "latest"}`,
      href: "/people/retain/engagement",
      tone: enpsLatest >= 40 ? "green" : enpsLatest >= 20 ? "gold" : "amber",
      chip: enpsChip,
      spark: enpsSeries,
      sparkCaption: "quarterly · last 4 surveys",
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
          Headcount · attrition · eNPS show real Δ vs prior period · others are cross-sectional
        </span>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 2xl:grid-cols-9">
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
