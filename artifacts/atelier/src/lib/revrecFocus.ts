/**
 * Task #1082 — map a deep-linked GL revrec posting-line id to the schedule
 * row the Revrec page renders (posting lines themselves aren't shown).
 * Pure — exported for tests. Returns the schedule id, or null when the
 * line is unknown / has no schedule linkage (adjustment lines).
 */
export function scheduleIdForPostingLine(
  lines: Array<{ id: string; scheduleId: string | null }>,
  lineId: string,
): string | null {
  return lines.find((l) => l.id === lineId)?.scheduleId ?? null;
}
