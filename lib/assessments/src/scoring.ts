import type {
  AssessmentDefinition,
  ScoreResult,
  SubmissionInput,
  Tier,
  Question,
  Dimension,
  RecommendationSet,
  UvrUseCaseResult,
} from "./types";
import { tierFor } from "./types";
import { detectAntiPatterns } from "./antiPatterns";
import { computeSovereignSubScore } from "./sovereign";
import { computeCostOfInaction } from "./costOfInaction";
import { getPeerBenchmark } from "./benchmarks";

export function isQuestionActive(q: Question, answers: Record<string, string>): boolean {
  if (!q.skipIf) return true;
  const target = answers[q.skipIf.questionId];
  if (!target) return true;
  return !q.skipIf.optionIds.includes(target);
}

function scoreDimension(dim: Dimension, answers: Record<string, string>): { score: number; answeredCount: number } {
  let total = 0;
  let count = 0;
  for (const q of dim.questions) {
    if (!isQuestionActive(q, answers)) continue;
    const aId = answers[q.id];
    if (!aId) continue;
    const opt = q.options.find((o) => o.id === aId);
    if (!opt) continue;
    const w = q.weight ?? 1;
    total += opt.score * w;
    count += w;
  }
  return { score: count > 0 ? total / count : 0, answeredCount: count };
}

function pickRecommendations(def: AssessmentDefinition, dimensionScores: Record<string, number>): RecommendationSet {
  const out: RecommendationSet = { quickWins90d: [], roadmap6m: [], strategic12m: [] };
  const sorted = Object.entries(dimensionScores).sort((a, b) => a[1] - b[1]);
  for (const [dimId, dimScore] of sorted) {
    const tier = tierFor(dimScore);
    const recs = def.recommendations[dimId]?.[tier];
    if (!recs) continue;
    out.quickWins90d.push(...recs.quickWins90d);
    out.roadmap6m.push(...recs.roadmap6m);
    out.strategic12m.push(...recs.strategic12m);
    if (out.quickWins90d.length >= 5 && out.roadmap6m.length >= 4 && out.strategic12m.length >= 3) break;
  }
  out.quickWins90d = out.quickWins90d.slice(0, 6);
  out.roadmap6m = out.roadmap6m.slice(0, 5);
  out.strategic12m = out.strategic12m.slice(0, 4);
  return out;
}

function pickStrengthsAndGaps(def: AssessmentDefinition, dimensionScores: Record<string, number>) {
  const sorted = Object.entries(dimensionScores).sort((a, b) => b[1] - a[1]);
  const strengths = sorted.slice(0, 2).filter(([, s]) => s >= 3.2).map(([id]) => id);
  const gaps = sorted.slice(-2).filter(([, s]) => s < 3.2).map(([id]) => id);
  return { strengths, gaps };
}

export function scoreAssessment(def: AssessmentDefinition, sub: SubmissionInput): ScoreResult {
  const dimensionScores: Record<string, number> = {};
  let weightedTotal = 0;
  let weightSum = 0;
  for (const dim of def.dimensions) {
    const { score } = scoreDimension(dim, sub.answers);
    dimensionScores[dim.id] = +score.toFixed(2);
    if (score > 0) {
      weightedTotal += score * dim.weight;
      weightSum += dim.weight;
    }
  }
  const overallScore = weightSum > 0 ? +(weightedTotal / weightSum).toFixed(2) : 0;
  const tier = tierFor(overallScore);

  const sovereign = computeSovereignSubScore(def, sub.answers);
  const { strengths, gaps } = pickStrengthsAndGaps(def, dimensionScores);
  const antiPatterns = detectAntiPatterns({
    slug: def.slug,
    dimensionScores,
    overallScore,
    answers: sub.answers,
  });
  const recommendations = pickRecommendations(def, dimensionScores);
  const peerBenchmark = getPeerBenchmark(def.slug, sub.profile.industry, def.dimensions.map((d) => d.id));
  const costOfInaction = computeCostOfInaction(def.slug, tier, sub.profile);

  let useCases: UvrUseCaseResult[] | undefined;
  if (def.slug === "uvr" && sub.useCases) {
    useCases = scoreUvrUseCases(def, sub.useCases);
  }

  return {
    slug: def.slug,
    dimensionScores,
    overallScore,
    tier,
    sovereignSubScore: sovereign,
    strengths,
    gaps,
    antiPatterns,
    recommendations,
    peerBenchmark,
    costOfInaction,
    useCases,
  };
}

export function scoreUvrUseCases(
  def: AssessmentDefinition,
  cases: { id: string; name: string; answers: Record<string, string> }[]
): UvrUseCaseResult[] {
  return cases.map((uc) => {
    const valueDim = def.dimensions.find((d) => d.id === "value")!;
    const readyDim = def.dimensions.find((d) => d.id === "readiness")!;
    const effortDim = def.dimensions.find((d) => d.id === "effort")!;
    const value = scoreDimension(valueDim, uc.answers).score;
    const readiness = scoreDimension(readyDim, uc.answers).score;
    const effort = scoreDimension(effortDim, uc.answers).score;
    const valueScore = +value.toFixed(2);
    const readinessScore = +readiness.toFixed(2);
    const effortScore = +effort.toFixed(2);
    let quadrant: UvrUseCaseResult["quadrant"];
    if (value >= 3.5 && readiness >= 3.5) quadrant = "Quick Wins";
    else if (value >= 3.5 && readiness < 3.5) quadrant = "Strategic Bets";
    else if (value < 3.5 && readiness >= 3.5) quadrant = "Park";
    else quadrant = "Avoid";
    return {
      id: uc.id,
      name: uc.name,
      valueScore,
      readinessScore,
      effort: effortScore,
      quadrant,
    };
  });
}

export interface ReinventionInput {
  ari?: number;
  mvi?: number;
  dafi?: number;
}

export interface ReinventionResult {
  score: number;
  tier: Tier;
  components: { slug: string; score: number; weight: number }[];
}

export function computeReinventionIndex(input: ReinventionInput): ReinventionResult {
  const components: { slug: string; score: number; weight: number }[] = [];
  if (input.ari !== undefined) components.push({ slug: "ari", score: input.ari, weight: 0.4 });
  if (input.mvi !== undefined) components.push({ slug: "mvi", score: input.mvi, weight: 0.3 });
  if (input.dafi !== undefined) components.push({ slug: "dafi", score: input.dafi, weight: 0.3 });
  const totalW = components.reduce((s, c) => s + c.weight, 0);
  const score = totalW > 0 ? +(components.reduce((s, c) => s + c.score * c.weight, 0) / totalW).toFixed(2) : 0;
  return { score, tier: tierFor(score), components };
}
