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

/** Extra (non-signature) field kinds a sender can add per signer. */
export type ExtraFieldType = "date" | "initials";

/**
 * An optional extra box (date-signed or initials) tied to one signer by
 * 0-based `signerIndex`. Same normalized coordinate space as Placement.
 */
export interface ExtraField extends Placement {
  signerIndex: number;
  type: ExtraFieldType;
}

/** Server-side cap on total extra fields per request. */
export const MAX_EXTRA_FIELDS = 40;

/**
 * Default box for a newly added extra field: sits just below/right of
 * the signer's signature box so it's visible and grabbable immediately.
 */
export function defaultExtraField(
  signerIndex: number,
  type: ExtraFieldType,
  anchor: Placement,
  pageCount: number,
): ExtraField {
  const size =
    type === "date" ? { w: 0.18, h: 0.035 } : { w: 0.08, h: 0.035 };
  return {
    signerIndex,
    type,
    ...clampPlacement(
      {
        page: anchor.page,
        x: type === "date" ? anchor.x : anchor.x + anchor.w + 0.02,
        y: anchor.y + anchor.h + 0.015,
        ...size,
      },
      pageCount,
    ),
  };
}

/** Clamp an extra field's box, preserving its identity fields. */
export function clampExtraField(f: ExtraField, pageCount: number): ExtraField {
  return { ...f, ...clampPlacement(f, pageCount) };
}

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
