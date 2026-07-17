/**
 * One-off probe for Task #33 — orphaned Win/Loss records.
 * Boots the app in-process and verifies:
 *  1. Closing an opp creates a debrief + Pane A item (hook baseline).
 *  2. Hard-deleting the opp cascades the debrief away (FK) and the
 *     dashboard + debrief library defensively hide the leftover pane item.
 *  3. The archive route soft-deletes debriefs and resolves pane items.
 */
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { eq, and, isNull, sql as dsql } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

async function main() {
  const D = await import("@workspace/db");
  const { db, atelierOpportunities, atelierWinLossDebriefs, atelierPaneAItems } = D;
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
  const oppIds: string[] = [];
  try {
    // Provision a scratch account.
    const accId = `acc_probe33_${STAMP}`;
    await db.execute(dsql`insert into atelier_accounts (id, org_id, name, country, sector, partner_owner_id) values (${accId}, 'aico', ${"__probe33 acct " + STAMP}, 'SA', 'Test', ${FP})`);

    const makeClosedOpp = async (tag: string) => {
      const name = `__probe33 ${tag} ${STAMP}`;
      const cr = await api("POST", "/opportunities", {
        name, description: "probe", accountId: accId, probabilityPct: 30, runScout: false,
      });
      const [row] = await db.select({ id: atelierOpportunities.id }).from(atelierOpportunities).where(eq(atelierOpportunities.name, name));
      const id = row?.id as string;
      oppIds.push(id);
      const st = await api("POST", `/opportunities/${id}/stage-transition`, {
        toStage: "lost", rationaleText: "probe close for winloss hook", partnerOverride: true,
      });
      check(`${tag}: create+close → 200/200`, cr.status < 300 && st.status === 200, `create=${cr.status} stage=${st.status}`);
      return id;
    };

    // ---- Scenario 1: hard delete cascades debrief; reads hide pane orphan.
    const opp1 = await makeClosedOpp("hard-delete");
    let debriefs = await db.select().from(atelierWinLossDebriefs).where(eq(atelierWinLossDebriefs.opportunityId, opp1));
    let panes = await db.select().from(atelierPaneAItems).where(and(eq(atelierPaneAItems.hrefKind, "opportunity"), eq(atelierPaneAItems.hrefTargetId, opp1)));
    check("hook created debrief + pane item", debriefs.length === 1 && panes.length >= 1, `d=${debriefs.length} p=${panes.length}`);

    const home1 = await api("GET", "/home");
    const shown1 = (home1.body?.paneA ?? []).some((i: any) => i.hrefTargetId === opp1);
    check("/home shows pane item while opp exists", shown1);

    // Intentionally a RAW row delete (not hardDeleteOpportunities): this
    // scenario simulates an orphaning hard-delete to verify FK cascade +
    // defensive read filters. Do not "fix" this to use the shared helper.
    await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, opp1));
    debriefs = await db.select().from(atelierWinLossDebriefs).where(eq(atelierWinLossDebriefs.opportunityId, opp1));
    check("hard delete cascades debrief (FK)", debriefs.length === 0, `left=${debriefs.length}`);

    const home2 = await api("GET", "/home");
    const shown2 = (home2.body?.paneA ?? []).some((i: any) => i.hrefTargetId === opp1);
    check("/home hides orphaned pane item after opp hard-delete", !shown2);

    const lib = await api("GET", "/win-loss/debriefs");
    const inLib = (lib.body?.items ?? []).some((i: any) => i.opportunityId === opp1);
    check("/win-loss/debriefs excludes deleted opp", !inLib);

    // Cleanup leftover pane orphan (defensive filter hid it; remove row).
    await db.delete(atelierPaneAItems).where(and(eq(atelierPaneAItems.hrefKind, "opportunity"), eq(atelierPaneAItems.hrefTargetId, opp1)));

    // ---- Scenario 2: archive route cleans dependents.
    const opp2 = await makeClosedOpp("archive");
    const arch = await api("POST", `/opportunities/${opp2}/archive`, { rationale: "probe archive path" });
    check("archive route → 200", arch.status === 200, `status=${arch.status}`);
    const d2 = await db.select().from(atelierWinLossDebriefs).where(and(eq(atelierWinLossDebriefs.opportunityId, opp2), isNull(atelierWinLossDebriefs.deletedAt)));
    const p2 = await db.select().from(atelierPaneAItems).where(and(eq(atelierPaneAItems.hrefKind, "opportunity"), eq(atelierPaneAItems.hrefTargetId, opp2), isNull(atelierPaneAItems.resolvedAt)));
    check("archive soft-deletes debrief + resolves pane items", d2.length === 0 && p2.length === 0, `d=${d2.length} p=${p2.length}`);

    // Final cleanup.
    const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
    await hardDeleteOpportunities([opp2]);
    await db.execute(dsql`delete from atelier_opportunity_stage_transitions where opportunity_id in (${opp1}, ${opp2})`).catch(() => undefined);
    await db.execute(dsql`delete from atelier_engagements where opportunity_id in (${opp1}, ${opp2})`).catch(() => undefined);
    await db.execute(dsql`delete from atelier_audit_events where entity_id in (${opp1}, ${opp2}, ${accId})`).catch(() => undefined);
    await db.execute(dsql`delete from atelier_agent_runs where target_id = ${accId}`).catch(() => undefined);
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
