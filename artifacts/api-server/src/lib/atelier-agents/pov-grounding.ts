/**
 * Task #1022 — POV draft background grounding.
 *
 * Assembles clearly-labeled, NON-CITABLE background context for the POV
 * draft chain: opportunity/account summary, relevant org-scoped
 * document-library chunks, alliance-partner capability profiles, and prior
 * POV exemplars retrieved via the Strategy Developer pattern (embedText +
 * brute-force cosine, org-scoped, excluding self). The model uses this to
 * add perspective; citations may ONLY reference the snapshotted fact set —
 * the prompt and the deterministic gate both enforce that.
 *
 * Every part is fail-soft: a retrieval error degrades to omitting that part
 * (with a console warning), never failing a multi-minute draft run.
 */

import { db, atelierAccounts, atelierOpportunities, atelierPovs, atelierPovVersions } from "@workspace/db";
import { and, eq, isNull, desc, ne, inArray } from "drizzle-orm";
import { buildAllianceCapabilityContext } from "./alliance-capability-context.js";
import { loadPublishedFirmProfile } from "../atelier-contract-service.js";
import type { FirmProfileLite } from "../atelier-proposal-html.js";
import { searchDocumentChunks } from "../atelier-cli/attachments/retrieval.js";
import { embedText } from "../atelier-cli/embeddings.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function stripHtml(s: string): string {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export interface PovBackgroundContext {
  context: string;
  /**
   * Task #1051 — whether the org's published firm profile made it into the
   * context. When false, positioning sections must lean on generic firm
   * framing, and the run output notes the degradation.
   */
  firmProfileIncluded: boolean;
}

/**
 * Task #1051 — render the published firm profile as the positioning source
 * for POV drafts: what Cognirise actually does, in the firm's own words.
 */
function renderFirmProfileBlock(p: FirmProfileLite): string {
  const lines: string[] = [];
  const push = (label: string, v: string | undefined | null) => {
    const t = (v ?? "").trim();
    if (t) lines.push(`${label}: ${t}`);
  };
  push("Firm", p.firmName);
  push("Tagline", p.tagline);
  push("Mission", p.missionStatement);
  push("Capabilities pitch", p.capabilitiesPitch);
  if (Array.isArray(p.differentiators) && p.differentiators.length > 0) {
    lines.push(`Differentiators:\n${p.differentiators.map((d) => `- ${d}`).join("\n")}`);
  }
  if (Array.isArray(p.proofPoints) && p.proofPoints.length > 0) {
    lines.push(
      `Proof points:\n${p.proofPoints
        .filter((pp) => pp && (pp.label || pp.metric))
        .map((pp) => `- ${pp.label}: ${pp.metric}`)
        .join("\n")}`,
    );
  }
  if (Array.isArray(p.principles) && p.principles.length > 0) {
    lines.push(
      `Principles:\n${p.principles
        .filter((pr) => pr && pr.name)
        .map((pr) => `- ${pr.name}: ${pr.description ?? ""}`.trim())
        .join("\n")}`,
    );
  }
  if (Array.isArray(p.voiceAttributes) && p.voiceAttributes.length > 0) {
    lines.push(`Voice attributes: ${p.voiceAttributes.join(", ")}`);
  }
  push("Boilerplate (short)", p.boilerplateShort);
  push("Boilerplate (long)", p.boilerplateLong);
  push("Contact block", p.contactBlock);
  return lines.join("\n");
}

export async function buildPovBackgroundContext(args: {
  povId: string;
  opportunityId: string;
  orgId: string;
  persona: { id: string; role: string; orgId: string };
  audience: string;
  objective: string;
}): Promise<PovBackgroundContext> {
  const parts: string[] = [];
  let firmProfileIncluded = false;

  // ── Cognirise firm profile (positioning source, Task #1051) ─────────────
  try {
    const profile = await loadPublishedFirmProfile(args.orgId);
    const payload = (profile?.payload ?? null) as FirmProfileLite | null;
    const block = payload ? renderFirmProfileBlock(payload).trim() : "";
    if (block) {
      firmProfileIncluded = true;
      parts.push(
        "### Cognirise firm profile (POSITIONING SOURCE — never client evidence)\n" +
          "Ground positioning sections (approach, roadmap, About Cognirise, next step) in THIS material: " +
          "real service capabilities, differentiators, proof points, voice. Do not cite it.\n" +
          block.slice(0, 4000),
      );
    } else {
      parts.push(
        "### Cognirise firm profile\nNo published firm profile is available. Positioning sections must use generic, honest firm framing — do not invent capabilities, proof points or contact details.",
      );
    }
  } catch (e) {
    console.warn("[pov-grounding] firm profile skipped", e);
  }

  // ── opportunity / account summary ──────────────────────────────────────
  try {
    const [opp] = await db
      .select()
      .from(atelierOpportunities)
      .where(eq(atelierOpportunities.id, args.opportunityId));
    if (opp) {
      const [acct] = opp.accountId
        ? await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, opp.accountId))
        : [];
      const lines = [
        `Opportunity: ${opp.name}${opp.salesStage ? ` (stage: ${opp.salesStage})` : ""}`,
        acct?.cogniriseHypothesis ? `Hypothesis: ${acct.cogniriseHypothesis}` : null,
        acct
          ? `Account: ${acct.name}${acct.sector ? ` — sector ${acct.sector}` : ""}${acct.country ? `, ${acct.country}` : ""}`
          : null,
        acct?.notes ? `Account notes: ${String(acct.notes).slice(0, 800)}` : null,
      ].filter(Boolean);
      if (lines.length) parts.push(`### Opportunity & account\n${lines.join("\n")}`);
    }
  } catch (e) {
    console.warn("[pov-grounding] account summary skipped", e);
  }

  // ── document-library chunks (org-scoped, ACL-checked) ──────────────────
  try {
    const chunks = await searchDocumentChunks({
      persona: args.persona,
      query: `${args.objective} ${args.audience}`.trim(),
      limit: 5,
    });
    if (chunks.length > 0) {
      const body = chunks
        .map(
          (c, i) =>
            `${i + 1}. [${c.fileName}] ${String(c.summary || c.text || "").slice(0, 500)}`,
        )
        .join("\n");
      parts.push(`### Internal document extracts\n${body}`);
    }
  } catch (e) {
    console.warn("[pov-grounding] document chunks skipped", e);
  }

  // ── alliance capability profiles ────────────────────────────────────────
  try {
    const cap = await buildAllianceCapabilityContext(args.orgId);
    if (cap.block && cap.block.trim()) {
      parts.push(`### Firm & alliance capabilities\n${cap.block.trim().slice(0, 2000)}`);
    }
  } catch (e) {
    console.warn("[pov-grounding] capability context skipped", e);
  }

  // ── prior POV exemplars (embed + cosine, org-scoped, excluding self) ────
  try {
    const candidates = await db
      .select({
        povId: atelierPovs.id,
        title: atelierPovs.title,
        objective: atelierPovs.objective,
        body: atelierPovVersions.body,
      })
      .from(atelierPovs)
      .innerJoin(atelierPovVersions, eq(atelierPovVersions.id, atelierPovs.currentVersionId))
      .where(
        and(
          eq(atelierPovs.orgId, args.orgId),
          ne(atelierPovs.id, args.povId),
          inArray(atelierPovs.status, ["drafted", "approved"]),
          isNull(atelierPovs.deletedAt),
          isNull(atelierPovVersions.deletedAt),
        ),
      )
      .orderBy(desc(atelierPovs.updatedAt))
      .limit(10);
    if (candidates.length > 0) {
      const qv = (await embedText(`${args.objective} for ${args.audience}`)).vec;
      const scored = await Promise.all(
        candidates.map(async (c) => ({
          c,
          score: cosine(qv, (await embedText(`${c.title}\n${c.objective ?? ""}`)).vec),
        })),
      );
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 2).filter((s) => s.score > 0);
      if (top.length > 0) {
        const body = top
          .map(
            ({ c }) =>
              `— Exemplar "${c.title}":\n${stripHtml(c.body ?? "").slice(0, 1200)}`,
          )
          .join("\n\n");
        parts.push(`### Prior POV exemplars (style/structure reference only)\n${body}`);
      }
    }
  } catch (e) {
    console.warn("[pov-grounding] exemplar retrieval skipped", e);
  }

  if (parts.length === 0) return { context: "", firmProfileIncluded };
  return {
    context:
      "## BACKGROUND CONTEXT — NOT CITABLE\n" +
      "The material below is internal perspective/context only. It may inform tone, framing and implications, " +
      "but it is NOT evidence: never cite it, never attach a fact id to a claim that only appears here. " +
      "Claims requiring citation must come from the provided facts.\n\n" +
      parts.join("\n\n"),
    firmProfileIncluded,
  };
}
