/**
 * Task #514 — anchor DocuSeal signature/date/text boxes to the document's
 * actual signature block instead of a generic default position.
 *
 * The prepared contract PDFs end with a two-column signature block:
 *
 *   FOR AND ON BEHALF OF COGNIRISE        FOR AND ON BEHALF OF OTHER PARTY
 *   ____________________                  ____________________
 *   Authorised Signatory                  Signature
 *   ____________________                  ____________________
 *   Name & Title                          Full Name / Name & Title
 *   ____________________                  ____________________
 *   Date                                  Date
 *
 * The labels sit BELOW their ruled lines, so each field box is placed in
 * the blank area directly ABOVE its label. Text (+ coordinates) comes
 * from `unpdf`/pdf.js; coordinates there are bottom-left-origin points,
 * while DocuSeal wants top-left-origin page fractions — converted here.
 *
 * When no anchors can be found the caller falls back to the legacy
 * default layout (with a logged warning) — anchoring is best-effort,
 * never a reason to fail a send.
 */

// Normalized (0..1, top-left origin) label anchor: x is the label's left
// edge, yTop is the label's TOP edge as a fraction from the page top.
export interface LabelAnchor {
  x: number;
  yTop: number;
}

export interface SignatureColumnAnchors {
  kind: "firm" | "counterparty";
  signature: LabelAnchor;
  date?: LabelAnchor;
  name?: LabelAnchor;
}

export interface SignatureAnchors {
  /** 1-based page carrying the signature block. */
  page: number;
  /** Columns in left→right order. */
  columns: SignatureColumnAnchors[];
}

const SIG_FIRM_RE = /^authori[sz]ed signatory:?$/i;
const SIG_GENERIC_RE = /^signature:?$/i;
const DATE_RE = /^date:?$/i;
const NAME_RE = /^(name|full name|full legal name|name & title|printed name)\b/i;

interface TextItem {
  str: string;
  x: number;
  y: number; // baseline, bottom-left origin (points)
  h: number;
}

async function pageTextItems(
  proxy: { getPage: (n: number) => Promise<any> },
  pageNumber: number,
): Promise<{ items: TextItem[]; width: number; height: number }> {
  const page = await proxy.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items as Array<{
    str?: string;
    transform?: number[];
    height?: number;
  }>) {
    const str = (it.str ?? "").trim();
    if (!str || !it.transform) continue;
    items.push({
      str,
      x: it.transform[4],
      y: it.transform[5],
      h: typeof it.height === "number" && it.height > 0 ? it.height : 10,
    });
  }
  return { items, width: vp.width, height: vp.height };
}

/**
 * Locate the signature block. Scans from the last page backwards (up to
 * three pages — some templates end with a disclaimer page). Returns null
 * when no signature labels are found; the caller logs and falls back.
 */
export async function extractSignatureAnchors(
  pdfBytes: Buffer | Uint8Array,
): Promise<SignatureAnchors | null> {
  let proxy: { numPages: number; getPage: (n: number) => Promise<any> };
  try {
    const { getDocumentProxy } = await import("unpdf");
    proxy = await getDocumentProxy(
      pdfBytes instanceof Uint8Array ? new Uint8Array(pdfBytes) : new Uint8Array(pdfBytes),
    );
  } catch {
    return null;
  }
  const firstCandidate = Math.max(1, proxy.numPages - 2);
  for (let p = proxy.numPages; p >= firstCandidate; p--) {
    let pageData: Awaited<ReturnType<typeof pageTextItems>>;
    try {
      pageData = await pageTextItems(proxy, p);
    } catch {
      continue;
    }
    const { items, width, height } = pageData;
    if (width <= 0 || height <= 0) continue;
    const sigLabels = items.filter(
      (it) => SIG_FIRM_RE.test(it.str) || SIG_GENERIC_RE.test(it.str),
    );
    if (sigLabels.length === 0) continue;
    sigLabels.sort((a, b) => a.x - b.x);

    const toAnchor = (it: TextItem): LabelAnchor => ({
      x: it.x / width,
      yTop: 1 - (it.y + it.h) / height,
    });
    // Assign a secondary label (Date / Name) to the nearest column by x;
    // it must sit BELOW the column's signature label (labels stack
    // signature → name → date down the page).
    const nearestColumn = (it: TextItem): number => {
      let best = 0;
      let bestDist = Infinity;
      sigLabels.forEach((sig, i) => {
        const d = Math.abs(sig.x - it.x);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    };

    const columns: SignatureColumnAnchors[] = sigLabels.map((sig) => ({
      kind: SIG_FIRM_RE.test(sig.str) ? "firm" : "counterparty",
      signature: toAnchor(sig),
    }));
    for (const it of items) {
      if (!DATE_RE.test(it.str) && !NAME_RE.test(it.str)) continue;
      const ci = nearestColumn(it);
      if (it.y >= sigLabels[ci].y) continue; // must be below the signature label
      const col = columns[ci];
      if (DATE_RE.test(it.str)) {
        if (!col.date || it.y > height * (1 - col.date.yTop)) col.date = toAnchor(it);
      } else if (!col.name) {
        col.name = toAnchor(it);
      }
    }
    // When every label is a generic "Signature" (no "Authorised
    // Signatory"), mark the column under a Cognirise header as firm.
    if (columns.every((c) => c.kind === "counterparty")) {
      for (const it of items) {
        if (!/cognirise/i.test(it.str)) continue;
        const ci = nearestColumn(it);
        if (it.y > sigLabels[ci].y) columns[ci].kind = "firm";
      }
    }
    return { page: p, columns };
  }
  return null;
}

// Box sizes (normalized page fractions) — match the legacy defaults.
const SIG_W = 0.32;
const SIG_H = 0.05;
const DATE_W = 0.18;
const DATE_H = 0.03;
const TEXT_W = 0.32;
const TEXT_H = 0.03;
const GAP = 0.005; // gap between a box's bottom edge and its label

function boxAboveLabel(
  anchor: LabelAnchor,
  w: number,
  h: number,
  page: number,
): { page: number; x: number; y: number; w: number; h: number } {
  const x = Math.min(Math.max(0, anchor.x), 0.98 - w);
  const y = Math.max(0.01, anchor.yTop - GAP - h);
  return { page, x, y, w, h };
}

export interface AnchoredBoxes {
  /** One signature box per signer, in signer order. */
  placements: Array<{ page: number; x: number; y: number; w: number; h: number }>;
  /** Per-signer anchored date boxes (only for signers with a date line). */
  dateBoxes: Array<{
    signerIndex: number;
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  /** Anchored text boxes for the counterparty's fill-ins, in field order. */
  textBoxes: Array<{ page: number; x: number; y: number; w: number; h: number }>;
  /** Signers that could not be anchored (fell back to default layout). */
  unanchoredSignerIndexes: number[];
}

/**
 * Map signers onto the anchored columns:
 *  - the counterparty signer takes the first counterparty column;
 *  - remaining signers take the remaining columns in left→right order;
 *  - signers beyond the available columns are reported so the caller can
 *    default-place them (and log).
 * `textFieldCount` labelled fill-in boxes stack above the counterparty
 * column's name line (or, missing a name line, above its date line).
 */
export function computeAnchoredBoxes(args: {
  anchors: SignatureAnchors;
  signerCount: number;
  counterpartyIndex: number;
  textFieldCount: number;
  defaultPlacement: (index: number, page: number) => {
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  };
}): AnchoredBoxes {
  const { anchors, signerCount, counterpartyIndex } = args;
  const page = anchors.page;
  const columnBySigner = new Map<number, SignatureColumnAnchors>();
  const available = [...anchors.columns];
  const cpPos = available.findIndex((c) => c.kind === "counterparty");
  if (counterpartyIndex < signerCount && cpPos >= 0) {
    columnBySigner.set(counterpartyIndex, available[cpPos]);
    available.splice(cpPos, 1);
  }
  for (let i = 0; i < signerCount; i++) {
    if (columnBySigner.has(i)) continue;
    const next = available.shift();
    if (next) columnBySigner.set(i, next);
  }

  const placements: AnchoredBoxes["placements"] = [];
  const dateBoxes: AnchoredBoxes["dateBoxes"] = [];
  const unanchoredSignerIndexes: number[] = [];
  for (let i = 0; i < signerCount; i++) {
    const col = columnBySigner.get(i);
    if (!col) {
      placements.push(args.defaultPlacement(i, page));
      unanchoredSignerIndexes.push(i);
      continue;
    }
    placements.push(boxAboveLabel(col.signature, SIG_W, SIG_H, page));
    if (col.date) {
      dateBoxes.push({ signerIndex: i, ...boxAboveLabel(col.date, DATE_W, DATE_H, page) });
    }
  }

  const textBoxes: AnchoredBoxes["textBoxes"] = [];
  const cpCol = columnBySigner.get(counterpartyIndex);
  const nameAnchor = cpCol?.name ?? cpCol?.date;
  if (nameAnchor && args.textFieldCount > 0) {
    for (let k = 0; k < args.textFieldCount; k++) {
      const base = boxAboveLabel(nameAnchor, TEXT_W, TEXT_H, page);
      // Additional fill-ins stack downward beneath the first.
      textBoxes.push({ ...base, y: Math.min(0.95, base.y + k * (TEXT_H + GAP)) });
    }
  }
  return { placements, dateBoxes, textBoxes, unanchoredSignerIndexes };
}
