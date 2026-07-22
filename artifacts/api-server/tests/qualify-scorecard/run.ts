/**
 * Task #530 — Qualify fit-scorecard adjustment probe.
 *
 * Runs standalone (tsx ./tests/qualify-scorecard/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. consultant (reader) → 403 on PATCH /partners/firms/:id/fit-scorecard
 *   2. firm without a scorecard → 409 no-fit-scorecard
 *   3. unknown dimension id → 400 unknown-dimension
 *   4. out-of-range / empty scores → 400 invalid body
 *   5. valid adjust → recomputed weightedTotal + verdict match the shared
 *      computeFitTotals framework function; adjusted dimension stamped with
 *      adjustedByUserId/adjustedAt; top-level adjust stamps set
 *   6. audit row partner_firm.fitScorecard.adjust written with changes
 *   7. noop adjust (same score) → 200, no additional audit row
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_qs_fp_${STAMP}`;
const CONS_ID = `p_test_qs_cons_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierPartnerFirms, atelierAuditEvents } = D as any;
  const { ALLIANCE_FIT_DIMENSIONS, computeFitTotals } = await import(
    "../../src/lib/atelier-agents/alliance-cartographer.js"
  );
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const firmId = `pfrm_test_qs_${STAMP}`;
  const bareFirmId = `pfrm_test_qs_bare_${STAMP}`;

  try {
    for (const p of [
      { id: FP_ID, role: "founding_partner", name: "QS FP" },
      { id: CONS_ID, role: "consultant", name: "QS Consultant" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "QS",
          role: p.role,
          roleLabel: p.name,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }

    // Agent-shaped scorecard: every framework dimension scored 3.
    const dimensions = ALLIANCE_FIT_DIMENSIONS.map((d: any) => ({
      id: d.id,
      label: d.label,
      weight: d.weight,
      score: 3,
      rationale: "probe fixture",
      evidence: "unverified",
    }));
    const base = computeFitTotals(dimensions);
    await db.insert(atelierPartnerFirms).values({
      id: firmId,
      orgId: ORG,
      name: `QS Probe Firm ${STAMP}`,
      kind: "boutique SI",
      status: "active",
      fitScorecard: {
        dimensions,
        weightedTotal: base.weightedTotal,
        verdict: base.verdict,
        watchouts: base.watchouts,
        scoredAt: new Date().toISOString(),
        scoredBy: "alliance_cartographer",
      },
      createdByUserId: FP_ID,
    });
    await db.insert(atelierPartnerFirms).values({
      id: bareFirmId,
      orgId: ORG,
      name: `QS Bare Firm ${STAMP}`,
      kind: "boutique SI",
      status: "active",
      createdByUserId: FP_ID,
    });

    // =====================================================================
    group("access + preconditions");
    // =====================================================================
    const consAdj = await call("PATCH", `/partners/firms/${firmId}/fit-scorecard`, CONS_ID, {
      scores: { service_alignment: 4 },
    });
    check("consultant \u2192 403 on adjust", consAdj.status === 403, `status=${consAdj.status}`);

    const noSc = await call("PATCH", `/partners/firms/${bareFirmId}/fit-scorecard`, FP_ID, {
      scores: { service_alignment: 4 },
    });
    check(
      "no scorecard \u2192 409 no-fit-scorecard",
      noSc.status === 409 && noSc.body?.error === "no-fit-scorecard",
      `status=${noSc.status} body=${JSON.stringify(noSc.body)?.slice(0, 150)}`,
    );

    const unknown = await call("PATCH", `/partners/firms/${firmId}/fit-scorecard`, FP_ID, {
      scores: { nonsense_dimension: 4 },
    });
    check(
      "unknown dimension \u2192 400 unknown-dimension",
      unknown.status === 400 && unknown.body?.error === "unknown-dimension",
      `status=${unknown.status}`,
    );

    const outOfRange = await call("PATCH", `/partners/firms/${firmId}/fit-scorecard`, FP_ID, {
      scores: { service_alignment: 9 },
    });
    check("score 9 \u2192 400", outOfRange.status === 400, `status=${outOfRange.status}`);
    const empty = await call("PATCH", `/partners/firms/${firmId}/fit-scorecard`, FP_ID, {
      scores: {},
    });
    check("empty scores \u2192 400", empty.status === 400, `status=${empty.status}`);

    // =====================================================================
    group("adjust recompute + stamps");
    // =====================================================================
    const adj = await call("PATCH", `/partners/firms/${firmId}/fit-scorecard`, FP_ID, {
      scores: { service_alignment: 5, references: 1 },
    });
    check("adjust \u2192 200", adj.status === 200, `status=${adj.status}`);
    const sc = adj.body?.fitScorecard;
    const expected = computeFitTotals(
      dimensions.map((d: any) =>
        d.id === "service_alignment" ? { ...d, score: 5 } : d.id === "references" ? { ...d, score: 1 } : d,
      ),
    );
    check(
      "weightedTotal recomputed via shared framework fn",
      sc?.weightedTotal === expected.weightedTotal,
      `got=${sc?.weightedTotal} want=${expected.weightedTotal}`,
    );
    check("verdict recomputed", sc?.verdict === expected.verdict, `got=${sc?.verdict} want=${expected.verdict}`);
    const adjDim = (sc?.dimensions ?? []).find((d: any) => d.id === "service_alignment");
    const refDim = (sc?.dimensions ?? []).find((d: any) => d.id === "references");
    const untouched = (sc?.dimensions ?? []).find((d: any) => d.id === "footprint");
    check("adjusted dim score applied", adjDim?.score === 5 && refDim?.score === 1);
    check(
      "adjusted dims stamped with adjuster + timestamp",
      adjDim?.adjustedByUserId === FP_ID && !!adjDim?.adjustedAt && refDim?.adjustedByUserId === FP_ID,
      JSON.stringify(adjDim)?.slice(0, 200),
    );
    check("untouched dim NOT stamped", untouched?.adjustedAt == null && untouched?.adjustedByUserId == null);
    check(
      "top-level adjust stamps set",
      sc?.adjustedByUserId === FP_ID && !!sc?.adjustedAt,
      `adjustedBy=${sc?.adjustedByUserId}`,
    );
    check("scoredBy preserved", sc?.scoredBy === "alliance_cartographer");

    const audits1 = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, firmId),
          eq(atelierAuditEvents.action, "partner_firm.fitScorecard.adjust"),
        ),
      );
    check(
      "audit row written with changes",
      audits1.length === 1 &&
        audits1[0]?.payload?.changes?.service_alignment?.to === 5 &&
        audits1[0]?.payload?.changes?.references?.from === 3,
      `n=${audits1.length} payload=${JSON.stringify(audits1[0]?.payload)?.slice(0, 200)}`,
    );

    // =====================================================================
    group("noop adjust");
    // =====================================================================
    const noop = await call("PATCH", `/partners/firms/${firmId}/fit-scorecard`, FP_ID, {
      scores: { service_alignment: 5 },
    });
    check("same score \u2192 200", noop.status === 200, `status=${noop.status}`);
    const audits2 = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, firmId),
          eq(atelierAuditEvents.action, "partner_firm.fitScorecard.adjust"),
        ),
      );
    check("noop writes no additional audit row", audits2.length === audits1.length, `n=${audits2.length}`);
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `p_test_qs_%_${STAMP}`));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmId, bareFirmId]));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_qs_%_${STAMP}`));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURES`}`);
  if (failures.length) {
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
