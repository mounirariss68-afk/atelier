/**
 * One-off probe for Task #35 — leftover dashboard cards for deleted
 * engagements and deliverables. Boots the app in-process and verifies:
 *  1. GET /home shows engagement/deliverable-linked Pane A cards while
 *     their targets are live.
 *  2. Defensive filter: /home hides cards whose engagement/deliverable
 *     target is soft-deleted or missing entirely.
 *  3. DELETE /deliverables/:id resolves that deliverable's Pane A items.
 *  4. PATCH /engagements/:id plmStage→closed resolves engagement items.
 *  5. Account archive cascade (close engagements) resolves engagement items.
 */
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { eq, and, isNull, inArray, sql as dsql } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

async function main() {
  const D = await import("@workspace/db");
  const { db, atelierEngagements, atelierDeliverables, atelierPaneAItems } = D;
  const appMod = await import("../../src/app.js");
  const app = (appMod as any).app ?? (appMod as any).default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const FP = "p_mounir_ariss";
  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${FP}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  const STAMP = Date.now();
  const accId = `acc_probe35_${STAMP}`;
  const engA = `eng_probe35a_${STAMP}`;
  const engB = `eng_probe35b_${STAMP}`;
  const delA = `del_probe35a_${STAMP}`;
  const delB = `del_probe35b_${STAMP}`;
  const paneIds = [
    `pane_p35_enga_${STAMP}`,
    `pane_p35_engb_${STAMP}`,
    `pane_p35_engmiss_${STAMP}`,
    `pane_p35_dela_${STAMP}`,
    `pane_p35_delb_${STAMP}`,
    `pane_p35_delmiss_${STAMP}`,
  ];
  const [pEngA, pEngB, pEngMissing, pDelA, pDelB, pDelMissing] = paneIds;

  const mkEng = (id: string) => ({
    id, orgId: "aico", slug: id, name: `__probe35 eng ${id}`,
    accountId: accId, plmStage: "deliver", partnerOwnerId: FP,
    engagementLeadId: FP, startDate: "2026-01-01", plannedEndDate: "2026-12-31",
  });
  const mkDel = (id: string, engId: string) => ({
    id, orgId: "aico", engagementId: engId, type: "diagnostic",
    name: `__probe35 del ${id}`, status: "draft",
  });
  const mkPane = (id: string, kind: string, target: string) => ({
    id, orgId: "aico", userId: FP, title: `__probe35 ${id}`,
    summary: "probe", priority: "high", hrefKind: kind,
    hrefTargetId: target, dueLabel: "today", sortKey: 0,
  });

  try {
    await db.execute(dsql`insert into atelier_accounts (id, org_id, name, country, sector, partner_owner_id) values (${accId}, 'aico', ${"__probe35 acct " + STAMP}, 'SA', 'Test', ${FP})`);
    await db.insert(atelierEngagements).values([mkEng(engA), mkEng(engB)] as any);
    await db.insert(atelierDeliverables).values([mkDel(delA, engA), mkDel(delB, engA)] as any);
    await db.insert(atelierPaneAItems).values([
      mkPane(pEngA, "engagement", engA),
      mkPane(pEngB, "engagement", engB),
      mkPane(pEngMissing, "engagement", `eng_probe35_missing_${STAMP}`),
      mkPane(pDelA, "deliverable", delA),
      mkPane(pDelB, "deliverable", delB),
      mkPane(pDelMissing, "deliverable", `del_probe35_missing_${STAMP}`),
    ] as any);

    // 1. Live targets show; missing targets are hidden.
    const home1 = await api("GET", "/home");
    const ids1 = new Set((home1.body?.paneA ?? []).map((i: any) => i.id));
    check("/home shows cards for live engagement + deliverable",
      ids1.has(pEngA) && ids1.has(pEngB) && ids1.has(pDelA) && ids1.has(pDelB),
      `have=${[...ids1].filter((i: any) => String(i).includes("p35")).join(",")}`);
    check("/home hides cards whose target row is missing",
      !ids1.has(pEngMissing) && !ids1.has(pDelMissing));

    // 2. Soft-delete deliverable B directly → defensive filter hides it.
    await db.update(atelierDeliverables).set({ deletedAt: new Date() }).where(eq(atelierDeliverables.id, delB));
    // Soft-delete engagement B directly too.
    await db.update(atelierEngagements).set({ deletedAt: new Date() }).where(eq(atelierEngagements.id, engB));
    const home2 = await api("GET", "/home");
    const ids2 = new Set((home2.body?.paneA ?? []).map((i: any) => i.id));
    check("/home hides cards for soft-deleted engagement + deliverable",
      !ids2.has(pEngB) && !ids2.has(pDelB) && ids2.has(pEngA) && ids2.has(pDelA));

    // 3. DELETE deliverable A via API → pane item resolved.
    const delRes = await api("DELETE", `/deliverables/${delA}`);
    check("DELETE /deliverables → 204", delRes.status === 204, `status=${delRes.status}`);
    const dPanes = await db.select().from(atelierPaneAItems).where(and(eq(atelierPaneAItems.id, pDelA), isNull(atelierPaneAItems.resolvedAt)));
    check("deliverable delete resolves its Pane A item", dPanes.length === 0, `open=${dPanes.length}`);

    // 4. PATCH engagement A → closed via API → pane item resolved.
    const closeRes = await api("PATCH", `/engagements/${engA}`, { plmStage: "closed" });
    check("PATCH /engagements plmStage=closed → 200", closeRes.status === 200, `status=${closeRes.status}`);
    const ePanes = await db.select().from(atelierPaneAItems).where(and(eq(atelierPaneAItems.id, pEngA), isNull(atelierPaneAItems.resolvedAt)));
    check("engagement close resolves its Pane A item", ePanes.length === 0, `open=${ePanes.length}`);

    // 5. Account archive cascade resolves engagement-linked pane items.
    const engC = `eng_probe35c_${STAMP}`;
    const pEngC = `pane_p35_engc_${STAMP}`;
    paneIds.push(pEngC);
    await db.insert(atelierEngagements).values([mkEng(engC)] as any);
    await db.insert(atelierPaneAItems).values([mkPane(pEngC, "engagement", engC)] as any);
    const arch = await api("POST", `/accounts/${accId}/archive`, {});
    check("account archive → 200", arch.status === 200, `status=${arch.status}`);
    const cPanes = await db.select().from(atelierPaneAItems).where(and(eq(atelierPaneAItems.id, pEngC), isNull(atelierPaneAItems.resolvedAt)));
    check("account archive cascade resolves engagement Pane A item", cPanes.length === 0, `open=${cPanes.length}`);

    // Cleanup.
    await db.delete(atelierPaneAItems).where(inArray(atelierPaneAItems.id, paneIds));
    await db.delete(atelierDeliverables).where(inArray(atelierDeliverables.id, [delA, delB]));
    await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [engA, engB, engC]));
    await db.execute(dsql`delete from atelier_audit_events where entity_id in (${accId}, ${engA}, ${engC}, ${delA})`).catch(() => undefined);
    await db.execute(dsql`delete from atelier_accounts where id = ${accId}`);
  } finally {
    server.close();
  }
  if (failures.length) {
    console.error(`FAILED: ${failures.length}`);
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
