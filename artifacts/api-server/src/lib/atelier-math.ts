/**
 * Canonical renewal financial math for the Atelier domain.
 *
 * Net Revenue Retention (NRR) delta percentage is computed from the
 * current vs. proposed annual recurring revenue. Every surface that
 * opens or updates a renewal — REST routes, chat capabilities, and any
 * watchdog sweep — MUST reuse this helper so the figure is identical
 * regardless of where the renewal was created or edited.
 *
 * Returns a percentage rounded to one decimal place (e.g. 10.5 for a
 * 10.5% expansion). When there is no current ARR baseline the delta is
 * undefined in business terms, so we return 0.
 */
export function computeNrrDeltaPct(
  currentArrUsd: number,
  proposedArrUsd: number,
): number {
  if (!(currentArrUsd > 0)) return 0;
  return Math.round(((proposedArrUsd - currentArrUsd) / currentArrUsd) * 1000) / 10;
}
