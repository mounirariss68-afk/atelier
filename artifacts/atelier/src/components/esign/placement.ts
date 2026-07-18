/**
 * Task #128 — pure signature-placement helpers (no pdf.js imports so
 * Node-based unit tests can consume them directly).
 *
 * Coordinates are normalized page fractions (0..1, top-left origin);
 * `page` is 1-based — matching the server's DocuSeal contract.
 */

export interface Placement {
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Mirror of the server's default two-column layout on `page` (1-based). */
export function defaultPlacement(index: number, page: number): Placement {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    page,
    x: col === 0 ? 0.08 : 0.55,
    y: 0.66 + row * 0.065,
    w: 0.32,
    h: 0.05,
  };
}

export function defaultPlacements(count: number, lastPage: number): Placement[] {
  return Array.from({ length: count }, (_, i) => defaultPlacement(i, lastPage));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep a box fully on the page and within the server's accepted ranges. */
export function clampPlacement(p: Placement, pageCount: number): Placement {
  const w = clamp(p.w, 0.02, 1);
  const h = clamp(p.h, 0.01, 0.5);
  return {
    page: clamp(Math.round(p.page), 1, Math.max(1, pageCount)),
    x: clamp(p.x, 0, 1 - w),
    y: clamp(p.y, 0, 1 - h),
    w,
    h,
  };
}
