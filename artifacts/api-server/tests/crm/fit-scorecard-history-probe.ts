/**
 * Task #541 — fit-scorecard adjust history + revert probe.
 *
 * Covers:
 *   - GET /partners/firms/:id/fit-scorecard/history returns per-dimension
 *     entries projected from partner_firm.fitScorecard.adjust audit rows
 *     (adjuster name, ISO date, from -> to), newest first
 *   - Revert path: PATCH with the recorded prior value succeeds and is
 *     itself audited (a second adjust event appears in history)
 *   - 404 for an unknown firm id; empty history for an untouched firm
 *
 * Deterministic: no LLM calls.
 * Run: pnpm exec tsx tests/crm/fit-scorecard-history-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierPartnerFirms, atelierAuditEvents } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const { ALLIANCE_FIT_DIMENSIONS, computeFitTotals } = await import(
    "../../src/lib/atelier-agents/alliance-cartographer.js"
  );

  const runTag = `probe541_${Date.now()}`;
  const userId = `u_${runTag}`;
  const firmId = `pf_${runTag}`;
  const firm2Id = `pf2_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${userId}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe FiveFortyOne",
      initials: "PF",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);

    const dimensions = ALLIANCE_FIT_DIMENSIONS.map((d: any) => ({
      id: d.id,
      label: d.label,
      weight: d.weight,
      score: 3,
      evidence: "inferred" as const,
      rationale: null,
    }));
    const totals = computeFitTotals(dimensions as any);
    const scorecard = {
      dimensions,
      weightedTotal: totals.weightedTotal,
      verdict: totals.verdict,
      watchouts: totals.watchouts,
      scoredAt: new Date().toISOString(),
      scoredBy: "alliance_cartographer",
    };
    await db.insert(atelierPartnerFirms).values([
      {
        id: firmId,
        orgId: "aico",
        name: `Fit History Probe ${runTag}`,
        status: "active",
        fitScorecard: scorecard,
      } as any,
      {
        id: firm2Id,
        orgId: "aico",
        name: `Fit History Probe Untouched ${runTag}`,
        status: "active",
        fitScorecard: scorecard,
      } as any,
    ]);

    // ---- unknown firm -> 404 ----
    const nf = await api("GET", `/partners/firms/pf_nope_${runTag}/fit-scorecard/history`);
    check("unknown firm -> 404", nf.status === 404, nf);

    // ---- untouched firm -> empty history ----
    const empty = await api("GET", `/partners/firms/${firm2Id}/fit-scorecard/history`);
    check(
      "untouched firm -> 200 empty items",
      empty.status === 200 && Array.isArray(empty.body?.items) && empty.body.items.length === 0,
      empty,
    );

    // ---- adjust two dimensions ----
    const adj = await api("PATCH", `/partners/firms/${firmId}/fit-scorecard`, {
      scores: { service_alignment: 5, references: 2 },
    });
    check("adjust -> 200", adj.status === 200, adj);

    const h1 = await api("GET", `/partners/firms/${firmId}/fit-scorecard/history`);
    check("history -> 200", h1.status === 200, h1);
    const items1 = (h1.body?.items ?? []) as any[];
    check("history has 2 entries", items1.length === 2, items1);
    const sa = items1.find((i) => i.dimensionId === "service_alignment");
    check(
      "service_alignment entry has actor/from/to/at",
      !!sa &&
        sa.from === 3 &&
        sa.to === 5 &&
        sa.actorLabel === "Probe FiveFortyOne" &&
        typeof sa.at === "string" &&
        !Number.isNaN(Date.parse(sa.at)) &&
        sa.label === "Service alignment",
      sa,
    );
    const refEntry = items1.find((i) => i.dimensionId === "references");
    check("references entry 3 -> 2", !!refEntry && refEntry.from === 3 && refEntry.to === 2, refEntry);

    // ---- revert service_alignment back to its prior value ----
    const rev = await api("PATCH", `/partners/firms/${firmId}/fit-scorecard`, {
      scores: { service_alignment: sa.from },
    });
    check("revert -> 200", rev.status === 200, rev);
    const revDim = (rev.body?.fitScorecard?.dimensions ?? []).find(
      (d: any) => d.id === "service_alignment",
    );
    check("reverted score applied", revDim?.score === 3, revDim);

    // ---- revert is itself audited and visible in history, newest first ----
    const h2 = await api("GET", `/partners/firms/${firmId}/fit-scorecard/history`);
    const items2 = (h2.body?.items ?? []) as any[];
    check("history now has 3 entries", items2.length === 3, items2.length);
    check(
      "newest entry is the revert 5 -> 3",
      items2[0]?.dimensionId === "service_alignment" && items2[0]?.from === 5 && items2[0]?.to === 3,
      items2[0],
    );
    const auditRows = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, firmId));
    check(
      "2 adjust audit rows on the firm",
      auditRows.filter((r: any) => r.action === "partner_firm.fitScorecard.adjust").length === 2,
      auditRows.map((r: any) => r.action),
    );
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [firmId, firm2Id]));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmId, firm2Id]));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error("PROBE CRASH", e);
  process.exit(1);
});
