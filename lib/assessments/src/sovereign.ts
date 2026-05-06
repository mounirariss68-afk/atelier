import type { AssessmentDefinition, BiText, SovereignSubScore } from "./types";

export function computeSovereignSubScore(
  def: AssessmentDefinition,
  answers: Record<string, string>
): SovereignSubScore {
  const components: { id: string; label: BiText; value: number }[] = [];
  let total = 0;
  let count = 0;
  for (const dim of def.dimensions) {
    let dimScore = 0;
    let dimCount = 0;
    for (const q of dim.questions) {
      const aId = answers[q.id];
      if (!aId) continue;
      const opt = q.options.find((o) => o.id === aId);
      if (!opt || opt.sovereign === undefined) continue;
      dimScore += opt.sovereign;
      dimCount += 1;
    }
    if (dimCount > 0) {
      const v = dimScore / dimCount;
      components.push({ id: dim.id, label: dim.title, value: +v.toFixed(2) });
      total += v;
      count += 1;
    }
  }
  const score = count > 0 ? +(total / count).toFixed(2) : 0;
  return { score, components };
}
