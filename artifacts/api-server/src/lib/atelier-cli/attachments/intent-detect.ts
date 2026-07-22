/**
 * Task #334 — Document intent detection.
 *
 * Heuristic classifier that maps an extracted document to one of the
 * intent flows the CLI knows how to drive:
 *
 *   rfp            → ingest_rfp_to_opportunity
 *   transcript     → ingest_transcript_to_raid
 *   receipt_batch  → ingest_receipts_to_expenses
 *   brand_deck     → ingest_deck_to_brand_profile
 *   spreadsheet    → ingest_spreadsheet_summary
 *   email          → routed through transcript (it carries decisions)
 *   unknown        → no auto-route; user must pick a tool explicitly
 *
 * The detector returns a list of weighted candidates so the orchestrator
 * can present a disambiguation chip when two intents tie.
 */

import type { ExtractedDoc, DocKind } from "./extractors.js";

export type DocIntent =
  | "rfp"
  | "transcript"
  | "receipt_batch"
  | "brand_deck"
  | "spreadsheet"
  | "email"
  | "identity_doc"
  | "unknown";

// Task #583 — identity documents (passport / national ID / residency /
// visa scans) uploaded for the personal-documents flow. Images share
// their kind with receipts, so both candidates surface on an ambiguous
// image and the orchestrator asks ONE clarifying question.
const IDENTITY_PATTERNS = [
  /\bpassport\b/i,
  /\bnational\s*id(entity)?\b/i,
  /\bemirates\s*id\b/i,
  /\biqama\b/i,
  /\bresiden(ce|cy)\s*(permit|visa|card)?\b/i,
  /\bvisa\b/i,
  /\bdate of birth\b/i,
  /\bnationality\b/i,
  /\bplace of (birth|issue)\b/i,
  /P<[A-Z]{3}/, // MRZ line
];

const RFP_PATTERNS = [
  /\brequest for proposal\b/i,
  /\brfp\b/i,
  /\bscope of work\b/i,
  /\bsubmission deadline\b/i,
  /\bevaluation criteria\b/i,
  /\bresponse format\b/i,
];
const TRANSCRIPT_PATTERNS = [
  /\b(speaker|attendees?)\s*[:\-]/i,
  /\b\d{1,2}:\d{2}\s*(am|pm)?\s*[\-—]\s*\w+/i,
  /\b(action items?|next steps?)\b/i,
  /\b(decision(s)?|agreed|owner)\b/i,
];
const BRAND_DECK_PATTERNS = [
  /\b(mission|values?|tagline|boilerplate)\b/i,
  /\bbrand (voice|guidelines?)\b/i,
  /\bdifferentiators?\b/i,
  /\bproof points?\b/i,
];

function score(text: string, patterns: RegExp[]): number {
  let s = 0;
  for (const re of patterns) if (re.test(text)) s++;
  return s;
}

export interface IntentCandidate {
  intent: DocIntent;
  weight: number;
  reason: string;
}

export function detectIntent(doc: ExtractedDoc): IntentCandidate[] {
  const out: IntentCandidate[] = [];
  const text = doc.normalizedText ?? "";

  // Kind-driven shortcuts -------------------------------------------------
  if (doc.kind === "image") {
    out.push({
      intent: "receipt_batch",
      weight: 5,
      reason: "image attachment routed through OCR fixture",
    });
    // Task #583 — an image could equally be an identity-document scan.
    // Push a tying candidate so the orchestrator disambiguates with one
    // clarifying question unless content markers break the tie below.
    out.push({
      intent: "identity_doc",
      weight: 5,
      reason: "image attachment could be an identity-document scan",
    });
  }
  if (doc.kind === "csv" || doc.kind === "xlsx") {
    out.push({
      intent: "spreadsheet",
      weight: 4,
      reason: `${doc.kind} attachment carries tabular data`,
    });
    if (doc.tableSummary) {
      const cols = doc.tableSummary.columns.join(" ").toLowerCase();
      if (/(merchant|amount|currency|date|total|vat)/.test(cols)) {
        out.push({
          intent: "receipt_batch",
          weight: 3,
          reason: "spreadsheet column headers look like an expense register",
        });
      }
    }
  }
  if (doc.kind === "pptx") {
    out.push({
      intent: "brand_deck",
      weight: 3,
      reason: "pptx attachment treated as deck unless content overrides",
    });
  }
  if (doc.kind === "eml") {
    out.push({ intent: "email", weight: 4, reason: "rfc822 message" });
  }

  // Content-driven scoring -----------------------------------------------
  const rfp = score(text, RFP_PATTERNS);
  if (rfp >= 2) out.push({ intent: "rfp", weight: rfp + 2, reason: `${rfp} RFP markers` });
  else if (rfp === 1) out.push({ intent: "rfp", weight: 1, reason: "1 RFP marker" });

  const tr = score(text, TRANSCRIPT_PATTERNS);
  if (tr >= 2) out.push({ intent: "transcript", weight: tr + 1, reason: `${tr} transcript markers` });

  const bd = score(text, BRAND_DECK_PATTERNS);
  if (bd >= 2) out.push({ intent: "brand_deck", weight: bd + 1, reason: `${bd} brand markers` });

  const idm = score(text, IDENTITY_PATTERNS);
  if (idm >= 2)
    out.push({
      intent: "identity_doc",
      weight: idm + 4,
      reason: `${idm} identity-document markers`,
    });

  if (out.length === 0) {
    out.push({ intent: "unknown", weight: 1, reason: "no strong signal detected" });
  }

  // De-dupe by intent (keep highest weight + concatenate reasons).
  const merged = new Map<DocIntent, IntentCandidate>();
  for (const c of out) {
    const prev = merged.get(c.intent);
    if (!prev || prev.weight < c.weight) merged.set(c.intent, c);
  }
  return [...merged.values()].sort((a, b) => b.weight - a.weight);
}

export function topIntent(doc: ExtractedDoc): DocIntent {
  return detectIntent(doc)[0]?.intent ?? "unknown";
}

export const __testing = { score };
export type { DocKind };
