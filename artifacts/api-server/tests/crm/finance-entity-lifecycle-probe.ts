/**
 * Task #273 — Finance plan/reports vs legal-entity registry lifecycle probe.
 *
 * Guards the listFinanceEntities() read model that every finance surface
 * builds its entity list from:
 *   - Empty registry → GET /finance/plan/entities returns only the firm
 *     pseudo-entity; GET /finance/reports/pnl perEntity is the firm
 *     pseudo-entity fallback ("Cognirise (firm)", USD).
 *   - Created entity (POST /finance/entities) appears on both surfaces
 *     with its shortName + baseCurrency; pnl fallback row disappears.
 *   - Archived entity disappears again from both; fallback returns.
 *
 * Deterministic: no LLM paths touched. Cleanup deletes the test entity,
 * audit rows and ephemeral personas via db.delete (harness convention).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/finance-entity-lifecycle-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
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

const FIRM_ID = "firm";

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierLegalEntities, atelierAuditEvents } = D;
  const { and, eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe273_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const entityIds: string[] = [];

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${fpId}` },
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
      id: fpId,
      orgId: "aico",
      name: "Probe273 Partner",
      initials: "PP",
      email: `${runTag}_fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);

    // Defensive: the scratch DB should have an empty registry, but assert it
    // so a future seeding change makes this probe fail loudly, not weirdly.
    const preexisting = await db
      .select({ id: atelierLegalEntities.id })
      .from(atelierLegalEntities)
      .where(eq(atelierLegalEntities.orgId, "aico"));
    check("scratch registry starts empty", preexisting.length === 0, preexisting);

    // ---- Phase 1: empty registry → firm fallback ----
    const plan0 = await api("GET", "/finance/plan/entities");
    check(
      "empty registry: plan entities = firm pseudo-entity only",
      plan0.status === 200 &&
        Array.isArray(plan0.body?.items) &&
        plan0.body.items.length === 1 &&
        plan0.body.items[0].id === FIRM_ID &&
        plan0.body.items[0].baseCurrency === "USD",
      plan0.body,
    );

    const pnl0 = await api("GET", "/finance/reports/pnl");
    check(
      "empty registry: pnl perEntity = firm pseudo-entity fallback",
      pnl0.status === 200 &&
        Array.isArray(pnl0.body?.perEntity) &&
        pnl0.body.perEntity.length === 1 &&
        pnl0.body.perEntity[0].entityId === FIRM_ID &&
        pnl0.body.perEntity[0].entityName === "Cognirise (firm)" &&
        pnl0.body.perEntity[0].baseCurrency === "USD",
      pnl0.body?.perEntity,
    );

    // ---- Phase 2: created entity appears on both surfaces ----
    const created = await api("POST", "/finance/entities", {
      legalNameEn: `Probe273 Entities FZ-LLC ${runTag}`,
      shortName: "P273",
      country: "AE",
      legalForm: "FZ-LLC",
      jurisdiction: "DIFC",
      baseCurrency: "AED",
    });
    check("entity create -> 201", created.status === 201, created);
    const entity = created.body?.entity;
    if (entity?.id) entityIds.push(entity.id);
    if (!entity?.id) throw new Error("no entity id — aborting");

    const plan1 = await api("GET", "/finance/plan/entities");
    const planRow = (plan1.body?.items ?? []).find((e: any) => e.id === entity.id);
    check(
      "created entity appears in plan entities with shortName + baseCurrency",
      plan1.status === 200 &&
        planRow?.shortName === "P273" &&
        planRow?.baseCurrency === "AED",
      plan1.body,
    );
    check(
      "plan entities still includes firm pseudo-entity alongside registry",
      (plan1.body?.items ?? []).some((e: any) => e.id === FIRM_ID),
      plan1.body,
    );

    const pnl1 = await api("GET", "/finance/reports/pnl");
    const pnlRow = (pnl1.body?.perEntity ?? []).find((e: any) => e.entityId === entity.id);
    check(
      "created entity appears in pnl perEntity with shortName + baseCurrency",
      pnl1.status === 200 &&
        pnlRow?.entityName === "P273" &&
        pnlRow?.baseCurrency === "AED",
      pnl1.body?.perEntity,
    );
    check(
      "pnl firm fallback row gone once registry is non-empty",
      !(pnl1.body?.perEntity ?? []).some((e: any) => e.entityId === FIRM_ID),
      pnl1.body?.perEntity,
    );

    // ---- Phase 3: archived entity disappears; fallback returns ----
    const archived = await api("POST", `/finance/entities/${entity.id}/archive`);
    check(
      "archive -> 200 status archived",
      archived.status === 200 && archived.body?.entity?.status === "archived",
      archived,
    );

    const plan2 = await api("GET", "/finance/plan/entities");
    check(
      "archived entity gone from plan entities (firm-only again)",
      plan2.status === 200 &&
        !(plan2.body?.items ?? []).some((e: any) => e.id === entity.id) &&
        (plan2.body?.items ?? []).length === 1 &&
        plan2.body.items[0].id === FIRM_ID,
      plan2.body,
    );

    const pnl2 = await api("GET", "/finance/reports/pnl");
    check(
      "archived entity gone from pnl; firm fallback restored",
      pnl2.status === 200 &&
        !(pnl2.body?.perEntity ?? []).some((e: any) => e.entityId === entity.id) &&
        pnl2.body?.perEntity?.length === 1 &&
        pnl2.body.perEntity[0].entityId === FIRM_ID,
      pnl2.body?.perEntity,
    );
  } finally {
    try {
      await db
        .delete(atelierLegalEntities)
        .where(inArray(atelierLegalEntities.id, entityIds.length ? entityIds : ["_"]));
      await db
        .delete(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "atelier_legal_entity"),
            inArray(atelierAuditEvents.entityId, entityIds.length ? entityIds : ["_"]),
          ),
        );
      await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
