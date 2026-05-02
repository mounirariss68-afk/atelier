export * from "./types";
export * from "./scoring";
export * from "./antiPatterns";
export * from "./sovereign";
export * from "./costOfInaction";
export * from "./benchmarks";
export * from "./i18n";

import { ari } from "./ari";
import { mvi } from "./mvi";
import { dafi } from "./dafi";
import { uvr } from "./uvr";
import type { AssessmentDefinition, AssessmentSlug } from "./types";

export const assessments: Record<AssessmentSlug, AssessmentDefinition> = {
  ari,
  mvi,
  dafi,
  uvr,
};

export const assessmentsList: AssessmentDefinition[] = [ari, mvi, dafi, uvr];

export function getAssessment(slug: AssessmentSlug): AssessmentDefinition {
  const a = assessments[slug];
  if (!a) throw new Error(`Unknown assessment slug: ${slug}`);
  return a;
}
