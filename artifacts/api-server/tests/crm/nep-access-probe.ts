/**
 * Task #1297 — Non-Equity Partner scoped-access probe.
 *
 * Boots the app in-process against an isolated scratch DB and asserts the
 * NEP access model end to end:
 *   1. An NEP sees a granted account and NOT an ungranted one (list + detail).
 *   2. An NEP sees an invited opportunity (plus its parent account read) and
 *      not other opportunities.
 *   3. An NEP can create their own account + opportunity; ownership is
 *      forced to self and origination attribution is stamped.
 *   4. An NEP gets 403 on finance / roster / pipeline-adjacent org surfaces.
 *   5. Revoking the grant removes account visibility; revoking the invite
 *      removes opportunity visibility.
 *   6. A founder's visibility is unchanged (sees everything created here).
 *
 * Cleans up all fixtures in finally.
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be first import.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";
import { inArray, eq } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra)?.slice(0, 400) : "");
  }
}

const FP = "p_mounir_ariss"; // founding_partner
const NEP = "p_test_nep_1297"; // ephemeral non_equity_partner persona

async function main() {
  const { default: app } = await import("../../src/app.ts");
  const {
    db,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierNepAccountGrants,
    atelierNepOppInvites,
  } = await import("@workspace/db");

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const call = async (method: string, path: string, persona: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        cookie: `atelier_persona=${persona}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch { /* non-json */ }
    return { status: res.status, json };
  };
  const get = (p: string, persona: string) => call("GET", p, persona);
  const post = (p: string, persona: string, body: unknown) => call("POST", p, persona, body);
  const del = (p: string, persona: string) => call("DELETE", p, persona);

  const STAMP = Date.now();
  const grantedAcctId = `__probe1297_acct_granted_${STAMP}`;
  const hiddenAcctId = `__probe1297_acct_hidden_${STAMP}`;
  const createdIds: { accounts: string[]; opps: string[] } = {
    accounts: [grantedAcctId, hiddenAcctId],
    opps: [],
  };

  try {
    // ---- fixtures ----------------------------------------------------
    await db.insert(atelierUsers).values({
      id: NEP,
      orgId: "aico",
      email: "test.nep.1297@example.test",
      name: "Test NEP Partner",
      initials: "TN",
      role: "non_equity_partner",
      roleLabel: "Non-Equity Partner",
      title: "Non-Equity Partner",
    } as any).onConflictDoNothing();

    for (const [id, name] of [
      [grantedAcctId, "Probe1297 Granted Corp"],
      [hiddenAcctId, "Probe1297 Hidden Corp"],
    ] as const) {
      await db.insert(atelierAccounts).values({
        id,
        orgId: "aico",
        name,
        brandName: name,
        sector: "technology",
        country: "AE",
        tier: "C",
        partnerOwnerId: FP,
      } as any).onConflictDoNothing();
    }

    // Opportunity on the HIDDEN account — NEP will be invited to it.
    console.log("\n[0] founder creates an opportunity on the hidden account");
    const oppRes = await post("/opportunities", FP, {
      name: `Probe1297 Invited Opp ${STAMP}`,
      accountId: hiddenAcctId,
      description: "Probe 1297 invited opportunity fixture.",
      dealSizeHypothesis: 100000,
    });
    check("founder opp create 2xx", oppRes.status < 300, { s: oppRes.status, j: oppRes.json });
    const invitedOppId: string = oppRes.json?.id ?? oppRes.json?.opportunity?.id;
    if (invitedOppId) createdIds.opps.push(invitedOppId);

    // ---- 1. pre-grant: NEP sees nothing ------------------------------
    console.log("\n[1] pre-grant visibility");
    const list0 = await get("/accounts", NEP);
    check("accounts list 200 for NEP", list0.status === 200, list0.status);
    const ids0 = new Set((Array.isArray(list0.json) ? list0.json : []).map((a: any) => a.id));
    check("pre-grant: granted acct NOT visible", !ids0.has(grantedAcctId));
    check("pre-grant: hidden acct NOT visible", !ids0.has(hiddenAcctId));
    const det0 = await get(`/accounts/${grantedAcctId}`, NEP);
    check("pre-grant account detail blocked", det0.status === 403 || det0.status === 404, det0.status);

    // ---- 2. founder grants the account --------------------------------
    console.log("\n[2] account grant");
    const g = await post(`/accounts/${grantedAcctId}/nep-access`, FP, { userId: NEP });
    check("grant create 201", g.status === 201, { s: g.status, j: g.json });
    const g2 = await post(`/accounts/${grantedAcctId}/nep-access`, FP, { userId: NEP });
    check("grant idempotent 200", g2.status === 200 && g2.json?.alreadyGranted === true, g2.json);
    const gBad = await post(`/accounts/${grantedAcctId}/nep-access`, FP, { userId: FP });
    check("granting a non-NEP user rejected 422", gBad.status === 422, gBad.status);
    const gForbidden = await post(`/accounts/${grantedAcctId}/nep-access`, NEP, { userId: NEP });
    check("NEP cannot self-grant (403)", gForbidden.status === 403, gForbidden.status);

    const list1 = await get("/accounts", NEP);
    const ids1 = new Set((Array.isArray(list1.json) ? list1.json : []).map((a: any) => a.id));
    check("post-grant: granted acct visible in list", ids1.has(grantedAcctId));
    check("post-grant: hidden acct still NOT visible", !ids1.has(hiddenAcctId));
    const det1 = await get(`/accounts/${grantedAcctId}`, NEP);
    check("post-grant account detail 200", det1.status === 200, det1.status);
    const detHidden = await get(`/accounts/${hiddenAcctId}`, NEP);
    check("hidden account detail still blocked", detHidden.status === 403 || detHidden.status === 404, detHidden.status);

    // ---- 3. opportunity invite ----------------------------------------
    console.log("\n[3] opportunity invite");
    const oppList0 = await get("/opportunities", NEP);
    const oppIds0 = new Set((Array.isArray(oppList0.json) ? oppList0.json : []).map((o: any) => o.id));
    check("pre-invite: invited opp NOT in NEP pipeline", !oppIds0.has(invitedOppId));
    const inv = await post(`/opportunities/${invitedOppId}/nep-invites`, FP, { userId: NEP });
    check("invite create 201", inv.status === 201, { s: inv.status, j: inv.json });
    const oppList1 = await get("/opportunities", NEP);
    const oppIds1 = new Set((Array.isArray(oppList1.json) ? oppList1.json : []).map((o: any) => o.id));
    check("post-invite: invited opp in NEP pipeline", oppIds1.has(invitedOppId), [...oppIds1].slice(0, 5));
    const oppDet = await get(`/opportunities/${invitedOppId}`, NEP);
    check("post-invite: opp detail 200", oppDet.status === 200, oppDet.status);
    // Read-limited parent account view: detail read should now pass.
    const parentRead = await get(`/accounts/${hiddenAcctId}`, NEP);
    check("post-invite: parent account readable", parentRead.status === 200, parentRead.status);
    // …but the NEP cannot WRITE the parent account they don't own.
    const parentWrite = await call("PATCH", `/accounts/${hiddenAcctId}`, NEP, { tier: "A" });
    check("post-invite: parent account write 403", parentWrite.status === 403, parentWrite.status);

    // ---- 4. NEP creates their own account + opportunity ----------------
    console.log("\n[4] NEP creation flows");
    const mine = await post("/accounts", NEP, {
      name: `Probe1297 NEP Own Co ${STAMP}`,
      sector: "technology",
      country: "AE",
      tier: "C",
      status: "active",
      primaryCurrency: "USD",
      primaryLanguage: "en",
      // NEP tries to assign someone else — server must clamp to self.
      partnerOwnerId: FP,
    });
    check("NEP account create 2xx", mine.status < 300, { s: mine.status, j: mine.json });
    const myAcctId: string | undefined =
      mine.json?.id ?? mine.json?.account?.id ?? mine.json?.accountId;
    if (myAcctId) {
      createdIds.accounts.push(myAcctId);
      const [row] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, myAcctId));
      check("ownership clamped to NEP", row?.partnerOwnerId === NEP, row?.partnerOwnerId);
      check("origination stamped (who)", (row as any)?.originatedByUserId === NEP, (row as any)?.originatedByUserId);
      check("origination stamped (when)", !!(row as any)?.originatedAt);
      const detMine = await get(`/accounts/${myAcctId}`, NEP);
      check("NEP sees own account", detMine.status === 200, detMine.status);
    }
    const myOpp = await post("/opportunities", NEP, {
      name: `Probe1297 NEP Own Opp ${STAMP}`,
      accountId: myAcctId,
      description: "Probe 1297 NEP-owned opportunity fixture.",
      dealSizeHypothesis: 50000,
    });
    check("NEP opp create on own account 2xx", myOpp.status < 300, { s: myOpp.status, j: myOpp.json });
    const myOppId = myOpp.json?.id ?? myOpp.json?.opportunity?.id;
    if (myOppId) createdIds.opps.push(myOppId);
    // NEP cannot attach an opp to a foreign (ungranted) account.
    const badOpp = await post("/opportunities", NEP, {
      name: `Probe1297 NEP Bad Opp ${STAMP}`,
      accountId: hiddenAcctId, // read-limited via invite, NOT full access
      description: "Probe 1297 forbidden opportunity attempt.",
      dealSizeHypothesis: 1,
    });
    check("NEP opp create on foreign account 403", badOpp.status === 403, { s: badOpp.status, j: badOpp.json });
    if (badOpp.json?.id) createdIds.opps.push(badOpp.json.id);

    // ---- 5. restricted org surfaces all 403 ----------------------------
    console.log("\n[5] restricted surfaces");
    for (const p of ["/home", "/reports/kpis", "/roster/people", "/finance/plan", "/engagements", "/activity", "/users", "/documents"]) {
      const r = await get(p, NEP);
      check(`NEP blocked on ${p}`, r.status === 403 || r.status === 404, `${p} → ${r.status}`);
    }
    const meRes = await get("/me", NEP);
    check("NEP /me 200", meRes.status === 200, meRes.status);
    check("/me reports non_equity_partner role", meRes.json?.role === "non_equity_partner", meRes.json?.role);

    // ---- 6. revocation --------------------------------------------------
    console.log("\n[6] revocation");
    const rg = await del(`/accounts/${grantedAcctId}/nep-access/${NEP}`, FP);
    check("grant revoke ok", rg.status === 200 && rg.json?.revoked >= 1, rg.json);
    const det2 = await get(`/accounts/${grantedAcctId}`, NEP);
    check("post-revoke account blocked again", det2.status === 403 || det2.status === 404, det2.status);
    const ri = await del(`/opportunities/${invitedOppId}/nep-invites/${NEP}`, FP);
    check("invite revoke ok", ri.status === 200 && ri.json?.revoked >= 1, ri.json);
    const oppDet2 = await get(`/opportunities/${invitedOppId}`, NEP);
    check("post-revoke opp blocked again", oppDet2.status === 403 || oppDet2.status === 404, oppDet2.status);
    const parentRead2 = await get(`/accounts/${hiddenAcctId}`, NEP);
    check("post-revoke parent account blocked again", parentRead2.status === 403 || parentRead2.status === 404, parentRead2.status);

    // ---- 7. founder visibility unchanged --------------------------------
    console.log("\n[7] founder visibility unchanged");
    const fpList = await get("/accounts", FP);
    const fpIds = new Set((Array.isArray(fpList.json) ? fpList.json : []).map((a: any) => a.id));
    check("founder sees granted acct", fpIds.has(grantedAcctId));
    check("founder sees hidden acct", fpIds.has(hiddenAcctId));
    if (myAcctId) check("founder sees NEP-created acct", fpIds.has(myAcctId));
    const fpOpp = await get(`/opportunities/${invitedOppId}`, FP);
    check("founder sees invited opp", fpOpp.status === 200, fpOpp.status);
  } finally {
    // ---- cleanup ---------------------------------------------------------
    try {
      const {
        db,
        atelierAccounts: acc,
        atelierOpportunities: opps,
        atelierNepAccountGrants: grants,
        atelierNepOppInvites: invites,
        atelierUsers: users,
      } = await import("@workspace/db");
      if (createdIds.opps.length) await db.delete(opps).where(inArray(opps.id, createdIds.opps));
      await db.delete(grants).where(eq(grants.userId, NEP));
      await db.delete(invites).where(eq(invites.userId, NEP));
      if (createdIds.accounts.length) await db.delete(acc).where(inArray(acc.id, createdIds.accounts));
      await db.delete(users).where(eq(users.id, NEP));
    } catch (e) {
      console.log("cleanup error", e);
    }
    server.close();
  }

  console.log(failures.length ? `\nFAILED: ${failures.length}\n- ${failures.join("\n- ")}` : "\nALL CHECKS PASSED");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
