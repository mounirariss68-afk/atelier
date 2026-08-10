/**
 * Task #871 — Partner-firm capability RAG.
 *
 * Keeps Riser's partner retrieval in sync with the registry:
 *
 *   - `refreshPartnerFirmRag` — upserts the firm's `partner_firm` entity
 *     embedding (resolver recall) and rebuilds its org-scoped capability
 *     chunks from the APPROVED capability profile (one chunk per domain
 *     plus a summary chunk). Called fire-and-forget after firm create,
 *     firmographic PATCHes and every applied proposal approval.
 *   - `removePartnerFirmRag` — deletes both on firm archive so an
 *     archived partner can never surface in retrieval again.
 *   - `searchPartnerCapabilities` — org-scoped brute-force cosine over
 *     the org's chunks (the partner registry is small) with a lexical
 *     boost, returning cited chunks for grounded chat answers.
 *
 * Org scoping is enforced in every query — chunks and embeddings carry
 * the firm's orgId and reads always filter on it.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  atelierPartnerFirms,
  atelierPartnerCapabilityChunks,
  atelierEntityEmbeddings,
} from "@workspace/db";
import { embedText, embedTexts } from "./embeddings.js";
import { mirrorEntityEmbedding } from "./entity-resolver.js";

type PartnerFirmRow = typeof atelierPartnerFirms.$inferSelect;

function firmSummaryText(firm: PartnerFirmRow): string {
  const parts: string[] = [];
  if (firm.speciality) parts.push(firm.speciality);
  const cp = firm.capabilityProfile;
  if (cp?.summary) parts.push(cp.summary);
  if (cp?.domains?.length) {
    parts.push(`Capabilities: ${cp.domains.map((d) => d.label).join(", ")}`);
  } else if (firm.capabilities && Object.keys(firm.capabilities).length > 0) {
    parts.push(`Capabilities: ${Object.keys(firm.capabilities).join(", ")}`);
  }
  return parts.join(" · ").slice(0, 700);
}

/**
 * Rebuild the firm's entity embedding + capability chunks. Best-effort:
 * failures are logged loudly but never break the source write (the same
 * contract as mirrorEntityEmbedding).
 */
export async function refreshPartnerFirmRag(firmId: string): Promise<void> {
  try {
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(eq(atelierPartnerFirms.id, firmId))
      .limit(1);
    if (!firm || firm.deletedAt) {
      if (firm?.deletedAt) await removePartnerFirmRag(firm.orgId, firm.id);
      return;
    }

    await mirrorEntityEmbedding(
      firm.orgId,
      "partner_firm",
      firm.id,
      firm.name,
      firmSummaryText(firm),
    );

    // Rebuild capability chunks wholesale.
    const cp = firm.capabilityProfile;
    const chunks: Array<{ domain: string; text: string; sourceUrls: string[] }> = [];
    if (cp?.summary) {
      chunks.push({
        domain: "summary",
        text: `${firm.name} — capability summary: ${cp.summary}`,
        sourceUrls: [...new Set(cp.domains.flatMap((d) => d.sourceUrls ?? []))].slice(0, 6),
      });
    }
    for (const d of cp?.domains ?? []) {
      chunks.push({
        domain: d.label,
        text: `${firm.name} — ${d.label}: ${d.description}`,
        sourceUrls: d.sourceUrls ?? [],
      });
    }

    await db
      .delete(atelierPartnerCapabilityChunks)
      .where(
        and(
          eq(atelierPartnerCapabilityChunks.orgId, firm.orgId),
          eq(atelierPartnerCapabilityChunks.firmId, firm.id),
        ),
      );
    if (chunks.length === 0) return;
    const embedded = await embedTexts(chunks.map((c) => c.text));
    await db.insert(atelierPartnerCapabilityChunks).values(
      chunks.map((c, i) => ({
        chunkId: `${firm.id}#c${String(i).padStart(3, "0")}`,
        orgId: firm.orgId,
        firmId: firm.id,
        firmName: firm.name,
        domain: c.domain,
        text: c.text,
        sourceUrls: c.sourceUrls,
        provider: embedded[i].provider,
        dim: embedded[i].dim,
        vec: embedded[i].vec,
        updatedAt: new Date(),
      })),
    );
  } catch (err) {
    console.error(
      "[partner-capability-rag] refresh failed",
      firmId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Delete the firm's chunks + entity embedding (firm archive). */
export async function removePartnerFirmRag(orgId: string, firmId: string): Promise<void> {
  try {
    await db
      .delete(atelierPartnerCapabilityChunks)
      .where(
        and(
          eq(atelierPartnerCapabilityChunks.orgId, orgId),
          eq(atelierPartnerCapabilityChunks.firmId, firmId),
        ),
      );
    await db
      .delete(atelierEntityEmbeddings)
      .where(
        and(
          eq(atelierEntityEmbeddings.orgId, orgId),
          eq(atelierEntityEmbeddings.kind, "partner_firm"),
          eq(atelierEntityEmbeddings.targetId, firmId),
        ),
      );
  } catch (err) {
    console.error(
      "[partner-capability-rag] remove failed",
      firmId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface PartnerCapabilityHit {
  firmId: string;
  firmName: string;
  domain: string;
  text: string;
  sourceUrls: string[];
  score: number;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : -1;
}

/**
 * Org-scoped semantic search over partner capability chunks. Brute-force
 * cosine over the org's rows plus a small lexical boost; optionally
 * restricted to one firm.
 */
export async function searchPartnerCapabilities(
  orgId: string,
  query: string,
  opts?: { firmId?: string; limit?: number },
): Promise<PartnerCapabilityHit[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 6, 1), 12);
  const where = opts?.firmId
    ? and(
        eq(atelierPartnerCapabilityChunks.orgId, orgId),
        eq(atelierPartnerCapabilityChunks.firmId, opts.firmId),
      )
    : eq(atelierPartnerCapabilityChunks.orgId, orgId);
  const rows = await db.select().from(atelierPartnerCapabilityChunks).where(where);
  if (rows.length === 0) return [];
  const { vec: qvec } = await embedText(query);
  const qTokens = query
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((t) => t.length > 2);
  return rows
    .map((r) => {
      const sem = cosine(qvec, r.vec);
      const lower = r.text.toLowerCase();
      const lex =
        qTokens.length > 0
          ? qTokens.filter((t) => lower.includes(t)).length / qTokens.length
          : 0;
      return {
        firmId: r.firmId,
        firmName: r.firmName,
        domain: r.domain,
        text: r.text,
        sourceUrls: r.sourceUrls ?? [],
        score: Math.round((0.8 * sem + 0.2 * lex) * 1000) / 1000,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
