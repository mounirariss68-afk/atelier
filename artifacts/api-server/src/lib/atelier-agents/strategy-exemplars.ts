/**
 * Task #699 — Account-strategy exemplar index (Strategy Developer RAG).
 *
 * Partner-defined (or agent-drafted-and-approved) account strategies are
 * serialized to text, embedded with the local offline model, and stored one
 * row per account in `atelier_strategy_exemplars`. When the Strategy
 * Developer drafts a strategy for an account, the top exemplars from OTHER
 * accounts in the SAME org are retrieved so the draft learns how the firm's
 * partners actually write strategy.
 *
 * Lifecycle:
 *   - `indexAccountStrategyExemplar(accountId)` is called after every
 *     strategy write (PATCH /accounts/:id and Strategy Developer approve).
 *     Empty strategy → the exemplar row is deleted.
 *   - Retrieval is brute-force cosine over the org's rows (the account
 *     roster is small) and NEVER crosses org boundaries.
 */

import { db, atelierAccounts, atelierStrategyExemplars } from "@workspace/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { embedText } from "../atelier-cli/embeddings.js";

export interface AccountStrategyShape {
  objectives: Array<{
    id: string;
    text: string;
    targetValue?: string | null;
    targetDate?: string | null;
  }>;
  targetServiceLines: string[];
  winHypothesis: string;
  keyPlays: string[];
}

/** True when the strategy carries no meaningful content. */
export function isStrategyEmpty(s: AccountStrategyShape | null | undefined): boolean {
  if (!s) return true;
  return (
    (s.objectives ?? []).filter((o) => (o.text ?? "").trim()).length === 0 &&
    (s.targetServiceLines ?? []).filter((l) => (l ?? "").trim()).length === 0 &&
    !(s.winHypothesis ?? "").trim() &&
    (s.keyPlays ?? []).filter((p) => (p ?? "").trim()).length === 0
  );
}

/** Serialize a strategy (plus light account context) into exemplar text. */
export function serializeStrategy(args: {
  accountName: string;
  sector?: string | null;
  strategy: AccountStrategyShape;
  guidance?: string | null;
}): string {
  const s = args.strategy;
  const lines: string[] = [
    `Account: ${args.accountName}${args.sector ? ` (${args.sector})` : ""}`,
  ];
  if ((s.objectives ?? []).length) {
    lines.push("Objectives:");
    for (const o of s.objectives) {
      const extras = [o.targetValue, o.targetDate].filter(Boolean).join(", ");
      lines.push(`- ${o.text}${extras ? ` [${extras}]` : ""}`);
    }
  }
  if ((s.targetServiceLines ?? []).length) {
    lines.push(`Target service lines: ${s.targetServiceLines.join("; ")}`);
  }
  if ((s.winHypothesis ?? "").trim()) {
    lines.push(`Win hypothesis: ${s.winHypothesis.trim()}`);
  }
  if ((s.keyPlays ?? []).length) {
    lines.push("Key plays:");
    for (const p of s.keyPlays) lines.push(`- ${p}`);
  }
  if ((args.guidance ?? "").trim()) {
    lines.push(`Partner guidance: ${(args.guidance ?? "").trim()}`);
  }
  return lines.join("\n");
}

/**
 * (Re)index the exemplar for one account from its CURRENT stored strategy.
 * Deletes the row when the strategy is empty/cleared. Fail-soft: indexing
 * problems are logged, never thrown into the write path that triggered it.
 */
export async function indexAccountStrategyExemplar(accountId: string): Promise<void> {
  try {
    const [a] = await db
      .select()
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, accountId), isNull(atelierAccounts.deletedAt)));
    if (!a) return;
    const strategy = (a.accountStrategy ?? null) as AccountStrategyShape | null;
    if (isStrategyEmpty(strategy)) {
      await db
        .delete(atelierStrategyExemplars)
        .where(eq(atelierStrategyExemplars.accountId, accountId));
      return;
    }
    const text = serializeStrategy({
      accountName: a.brandName ?? a.name,
      sector: a.sector,
      strategy: strategy as AccountStrategyShape,
    });
    const emb = await embedText(text);
    const row = {
      accountId,
      orgId: a.orgId,
      accountName: a.brandName ?? a.name,
      sector: a.sector ?? null,
      text,
      provider: emb.provider,
      dim: emb.dim,
      vec: emb.vec,
      updatedAt: new Date(),
    };
    await db
      .insert(atelierStrategyExemplars)
      .values(row)
      .onConflictDoUpdate({
        target: atelierStrategyExemplars.accountId,
        set: {
          orgId: row.orgId,
          accountName: row.accountName,
          sector: row.sector,
          text: row.text,
          provider: row.provider,
          dim: row.dim,
          vec: row.vec,
          updatedAt: row.updatedAt,
        },
      });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[strategy-exemplars] failed to index account ${accountId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface StrategyExemplar {
  accountId: string;
  accountName: string;
  sector: string | null;
  text: string;
  score: number;
}

/**
 * Retrieve the top exemplar strategies from OTHER accounts in the same org.
 * Strictly org-scoped; the target account's own strategy is excluded.
 */
export async function retrieveStrategyExemplars(args: {
  orgId: string;
  excludeAccountId: string;
  queryText: string;
  limit?: number;
}): Promise<StrategyExemplar[]> {
  const limit = args.limit ?? 3;
  const rows = await db
    .select()
    .from(atelierStrategyExemplars)
    .where(
      and(
        eq(atelierStrategyExemplars.orgId, args.orgId),
        ne(atelierStrategyExemplars.accountId, args.excludeAccountId),
      ),
    );
  if (rows.length === 0) return [];
  const q = await embedText(args.queryText);
  return rows
    .map((r) => ({
      accountId: r.accountId,
      accountName: r.accountName,
      sector: r.sector ?? null,
      text: r.text,
      score: cosine(q.vec, (r.vec as number[]) ?? []),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
