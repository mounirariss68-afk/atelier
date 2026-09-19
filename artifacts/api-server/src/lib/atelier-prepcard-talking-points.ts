// ============================================================
// Task #1188 — Suggested talking points for prep-card watch-outs.
// ------------------------------------------------------------
// Each stress-test watch-out on the first-meeting prep card gets a
// concise suggested answer the partner can use if the client raises
// it in the room. Generated one-shot from the account's research
// context (brief "our view" + hypothesis) and CACHED inside the
// account's researchBrief blob under `watchOutTalkingPoints`, keyed
// on the distilled watch-out list — so regenerating the card is free
// until the Cartographer rewrites the research (which replaces the
// whole blob and implicitly invalidates the cache).
//
// Fail-soft by design: any LLM/parse/persist failure returns {} and
// the card renders the watch-outs without guidance (never blocks the
// card, never throws to the route).
// ============================================================
import { createHash } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, atelierAccounts } from "@workspace/db";
import { distillBriefView } from "./atelier-brief-view.js";

const TALKING_POINTS_MODEL = process.env.ATELIER_CLI_HAIKU_MODEL ?? "claude-haiku-4-5";
const TIMEOUT_MS = Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 45000);

type ResearchBrief = NonNullable<typeof atelierAccounts.$inferSelect["researchBrief"]>;

export interface TalkingPointsContext {
  accountId: string;
  accountName: string;
  sector: string;
  country: string;
  ourView: string | null;
  hypothesis: string | null;
  researchBrief: ResearchBrief | null;
}

/** Stable cache key over the exact watch-out list (order-sensitive on
 *  purpose — the distiller's ordering is deterministic). */
export function watchOutCacheKey(watchOuts: string[]): string {
  return createHash("sha256").update(JSON.stringify(watchOuts)).digest("hex").slice(0, 32);
}

function cleanAnswer(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Strip `watchOutTalkingPoints` from a research brief when its cache key no
 * longer matches the distilled watch-out list. Call this server-side before
 * sending the brief to the client so the client never needs a crypto
 * dependency for validation. Handles both legacy { key, points } records and
 * newer { key, watchOuts, points } records identically (both validated by key).
 * Returns the same object reference when the cache is absent or still valid.
 */
export function stripStaleWatchOutCache<
  T extends {
    whyNowHypothesis?: string | null;
    stressTest?: unknown;
    watchOutTalkingPoints?: unknown;
  },
>(brief: T): T {
  const cached = brief.watchOutTalkingPoints as
    | { key?: unknown }
    | null
    | undefined;
  if (!cached || typeof cached.key !== "string") return brief; // nothing to validate
  const { watchOuts } = distillBriefView(brief as Parameters<typeof distillBriefView>[0]);
  if (watchOuts.length === 0 || cached.key === watchOutCacheKey(watchOuts)) return brief;
  // Key mismatch — strip the stale cache.
  const { watchOutTalkingPoints: _omit, ...rest } = brief as Record<string, unknown>;
  return rest as T;
}

/**
 * Return a map watchOut → suggested answer for the given watch-outs.
 * Serves from the researchBrief cache when the key matches; otherwise
 * generates via a one-shot Haiku call and persists the result. Returns
 * {} (no guidance) on any failure or when there is nothing to do.
 */
export async function getWatchOutTalkingPoints(
  ctx: TalkingPointsContext,
  watchOuts: string[],
): Promise<Record<string, string>> {
  if (watchOuts.length === 0 || !ctx.researchBrief) return {};
  const key = watchOutCacheKey(watchOuts);

  const cached = ctx.researchBrief.watchOutTalkingPoints;
  if (cached && cached.key === key && Array.isArray(cached.points)) {
    const map: Record<string, string> = {};
    for (const p of cached.points) {
      const a = cleanAnswer(p?.answer);
      if (a && typeof p.watchOut === "string") map[p.watchOut] = a;
    }
    return map;
  }

  try {
    const { anthropic } = await (
      await import("./assistant/provider-runtime.js")
    ).getPrivacyAuthorizedAnthropic({ dataClasses: ["confidential"] });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const system =
      "You are Riser, Cognirise's AI assistant, preparing a partner for a first client meeting. " +
      "For each watch-out (a risk/objection the client may raise), write ONE concise suggested answer " +
      "(1–2 sentences, confident, specific to this account's context) the partner can use in the room. " +
      "Never invent facts beyond the provided context; acknowledge uncertainty where the context is thin.\n\n" +
      'IMPORTANT: Reply with ONLY a single JSON object of the shape {"points":[{"watchOut":"<verbatim watch-out>","answer":"<suggested answer>"}]} — no prose, no code fences.';
    const user = JSON.stringify({
      account: { name: ctx.accountName, sector: ctx.sector, country: ctx.country },
      ourView: ctx.ourView,
      hypothesis: ctx.hypothesis,
      watchOuts,
    });
    const resp = await anthropic.messages
      .create(
        {
          model: TALKING_POINTS_MODEL,
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: user }],
        },
        { signal: ac.signal },
      )
      .finally(() => clearTimeout(timer));
    const block = resp.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(stripped) as { points?: Array<{ watchOut?: unknown; answer?: unknown }> };
    const points: Array<{ watchOut: string; answer: string }> = [];
    for (const p of parsed.points ?? []) {
      const w = typeof p?.watchOut === "string" ? p.watchOut : "";
      const a = cleanAnswer(p?.answer);
      // Only keep answers for watch-outs we actually asked about.
      if (w && a && watchOuts.includes(w)) points.push({ watchOut: w, answer: a });
    }
    if (points.length === 0) return {};

    // Persist the cache inside the researchBrief blob (best-effort — a lost
    // write just means one extra generation next time). Atomic jsonb_set
    // patches ONLY the watchOutTalkingPoints key, so a brief rewritten by
    // the Cartographer while the LLM call was in flight is never clobbered
    // by our stale snapshot — the new brief survives, its watch-outs won't
    // match this key, and the points regenerate on the next card build.
    try {
      // Include the watchOuts array so browser-side consumers can validate the
      // cache without a crypto dependency (JSON.stringify equality check).
      const cachePayload = JSON.stringify({ key, watchOuts, points });
      await db
        .update(atelierAccounts)
        .set({
          researchBrief: sql`jsonb_set(${atelierAccounts.researchBrief}, '{watchOutTalkingPoints}', ${cachePayload}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(and(eq(atelierAccounts.id, ctx.accountId), isNotNull(atelierAccounts.researchBrief)));
    } catch (err) {
      console.error(`[prep-card] talking-points cache write failed for ${ctx.accountId}:`, err);
    }

    const map: Record<string, string> = {};
    for (const p of points) map[p.watchOut] = p.answer;
    return map;
  } catch (err) {
    console.error(`[prep-card] talking-points generation failed for ${ctx.accountId}:`, err);
    return {};
  }
}
