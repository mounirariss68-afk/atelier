/**
 * Task #873 — Alliance-partner portal security probes.
 *
 * Runs standalone (tsx ./tests/partner-portal/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass so requests act as ephemeral p_test_* personas. All rows created
 * here are removed in `finally`.
 *
 * Coverage (the leak paths named in the task):
 *   1. Shell boundary: alliance_partner is 403'd on every org route
 *      (accounts, opportunities, partners lens, roster, finance, users,
 *      documents) and 200 only on /me, /personas (self-only), and
 *      /partner-portal/*.
 *   2. Grants drive visibility: firm A's login sees exactly firm A's
 *      granted opportunity; firm B's login sees none and 404s on A's
 *      detail (foreign-firm access).
 *   3. Redacted account overview: exact field allowlist — nothing else.
 *   4. Revoked grant + archived firm revoke visibility immediately.
 *   5. Chat clamping: capabilitiesForPersona(alliance_partner) is exactly
 *      the partnerportal.* read set; attachment.search_documents run()
 *      refuses the role (RAG isolation); partnerportal tools re-check
 *      grants per-call.
 *   6. Provisioning: leadership creates a firm-linked login via the
 *      shared portal-login helper; deactivation kills persona resolution.
 *   7. Admin gates: grant assign/revoke + login provisioning are
 *      leadership-only (consultant 403).
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { inArray, like, eq } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_pp_fp_${STAMP}`;
const CONS_ID = `p_test_pp_cons_${STAMP}`;
const PA_ID = `p_test_pp_pa_${STAMP}`; // firm A partner login
const PB_ID = `p_test_pp_pb_${STAMP}`; // firm B partner login
const PX_ID = `p_test_pp_px_${STAMP}`; // partner login with NO firm link

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
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierPartnerFirms,
    atelierPartnerOppGrants,
    atelierAuditEvents,
  } = D as any;
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

  const accId = `acct_test_pp_${STAMP}`;
  const oppAId = `opp_test_pp_a_${STAMP}`;
  const oppBId = `opp_test_pp_b_${STAMP}`;
  const firmAId = `pfrm_test_pp_a_${STAMP}`;
  const firmBId = `pfrm_test_pp_b_${STAMP}`;
  let provisionedUserId: string | null = null;
  let raceUserId: string | null = null;

  try {
    const personas = [
      { id: FP_ID, role: "founding_partner", name: "PP FP", firm: null },
      { id: CONS_ID, role: "consultant", name: "PP Consultant", firm: null },
      { id: PA_ID, role: "alliance_partner", name: "PP Partner A", firm: firmAId },
      { id: PB_ID, role: "alliance_partner", name: "PP Partner B", firm: firmBId },
      { id: PX_ID, role: "alliance_partner", name: "PP Partner X", firm: null },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@example.com`,
          name: p.name,
          initials: "PP",
          role: p.role,
          roleLabel: p.name,
          title: p.name,
          permissions: [],
          bdActive: false,
          partnerFirmId: p.firm,
        })
        .onConflictDoNothing();
    }

    await db.insert(atelierAccounts).values({
      id: accId,
      orgId: ORG,
      name: `PP Probe Account ${STAMP}`,
      country: "AE",
      sector: "Technology",
      tier: "B",
      status: "active",
      primaryCurrency: "AED",
      primaryLanguage: "en",
      createdByUserId: FP_ID,
    });
    for (const [id, name] of [
      [oppAId, `PP Probe Opp A ${STAMP}`],
      [oppBId, `PP Probe Opp B ${STAMP}`],
    ] as const) {
      await db.insert(atelierOpportunities).values({
        id,
        orgId: ORG,
        accountId: accId,
        slug: `pp-probe-${id}`,
        name,
        salesStage: "prospect",
        partnerOwnerId: FP_ID,
        engagementLeadId: FP_ID,
        dealSizeHypothesis: 100000,
        probabilityPct: 20,
        nextMilestone: "probe",
        forecastCategory: "pipeline",
        buyerPersona: "CIO",
        offeringAnchor: "advisory",
        sourceLead: "pp-probe",
        daysInStage: 0,
        createdByUserId: FP_ID,
      });
    }
    for (const [id, name] of [
      [firmAId, `PP Firm A ${STAMP}`],
      [firmBId, `PP Firm B ${STAMP}`],
    ] as const) {
      await db.insert(atelierPartnerFirms).values({
        id,
        orgId: ORG,
        name,
        status: "active",
        createdByUserId: FP_ID,
      });
    }

    // =====================================================================
    group("shell boundary \u2014 alliance_partner 403 on every org route");
    // =====================================================================
    for (const path of [
      "/accounts",
      `/accounts/${accId}`,
      "/opportunities",
      `/opportunities/${oppAId}`,
      "/partners/firms",
      "/roster/people",
      "/wallet/expenses",
      "/finance/entities",
      "/users",
      "/documents",
      "/activity",
      "/reports/pipeline",
      `/opportunities/${oppAId}/partner-grants`,
    ]) {
      const r = await call("GET", path, PA_ID);
      check(`alliance_partner \u2192 403 on ${path}`, r.status === 403, `status=${r.status}`);
    }
    {
      const me = await call("GET", "/me", PA_ID);
      check("alliance_partner \u2192 200 on /me", me.status === 200, `status=${me.status}`);
      const ps = await call("GET", "/personas", PA_ID);
      check(
        "/personas is self-only (1 row, own id)",
        ps.status === 200 && Array.isArray(ps.body) && ps.body.length === 1 && ps.body[0]?.id === PA_ID,
        JSON.stringify(ps.body)?.slice(0, 120),
      );
    }

    // =====================================================================
    group("admin gates \u2014 leadership-only grant + login management");
    // =====================================================================
    {
      const r = await call("POST", `/opportunities/${oppAId}/partner-grants`, CONS_ID, {
        partnerFirmId: firmAId,
      });
      check("consultant \u2192 403 on grant assign", r.status === 403, `status=${r.status}`);
      const r2 = await call("POST", `/partners/firms/${firmAId}/logins`, CONS_ID, {
        name: "X",
        email: "x@example.com",
      });
      check("consultant \u2192 403 on login provisioning", r2.status === 403, `status=${r2.status}`);
      const r3 = await call("POST", `/opportunities/${oppAId}/partner-grants`, PA_ID, {
        partnerFirmId: firmAId,
      });
      check("alliance_partner \u2192 403 on grant assign", r3.status === 403, `status=${r3.status}`);
    }

    // =====================================================================
    group("grants drive visibility \u2014 assign to firm A");
    // =====================================================================
    let grantId = "";
    {
      const r = await call("POST", `/opportunities/${oppAId}/partner-grants`, FP_ID, {
        partnerFirmId: firmAId,
      });
      check("FP assigns firm A \u2192 201", r.status === 201 && r.body?.grantId, `status=${r.status}`);
      grantId = r.body?.grantId ?? "";
      const again = await call("POST", `/opportunities/${oppAId}/partner-grants`, FP_ID, {
        partnerFirmId: firmAId,
      });
      check("re-assign is idempotent 200", again.status === 200 && again.body?.alreadyGranted === true);
      const auditRows = await db
        .select()
        .from(atelierAuditEvents)
        .where(eq(atelierAuditEvents.entityId, oppAId));
      check(
        "assign is audited",
        auditRows.some((a: any) => a.action === "partner_grant.assigned"),
      );

      const listA = await call("GET", "/partner-portal/opportunities", PA_ID);
      check(
        "firm A login sees exactly its granted opp",
        listA.status === 200 &&
          listA.body?.opportunities?.length === 1 &&
          listA.body.opportunities[0].id === oppAId,
        JSON.stringify(listA.body)?.slice(0, 200),
      );
      const oppKeys = Object.keys(listA.body?.opportunities?.[0] ?? {}).sort();
      check(
        "opportunity wire excludes economics (dealSize/probability/forecast)",
        !oppKeys.some((k) => /deal|probab|forecast|rubric|owner|lead/i.test(k)),
        oppKeys.join(","),
      );
      check(
        "opportunity wire carries a sharedAt stamp (Task #886)",
        typeof listA.body?.opportunities?.[0]?.sharedAt === "string",
        JSON.stringify(listA.body?.opportunities?.[0]?.sharedAt),
      );
      const detailA = await call("GET", `/partner-portal/opportunities/${oppAId}`, PA_ID);
      check("firm A detail \u2192 200", detailA.status === 200 && detailA.body?.opportunity?.id === oppAId);
      check(
        "detail carries firm context + sharedAt (Task #886)",
        typeof detailA.body?.firm?.name === "string" &&
          typeof detailA.body?.opportunity?.sharedAt === "string",
        JSON.stringify({ firm: detailA.body?.firm, sharedAt: detailA.body?.opportunity?.sharedAt }),
      );

      const listB = await call("GET", "/partner-portal/opportunities", PB_ID);
      check(
        "firm B login sees no opportunities",
        listB.status === 200 && listB.body?.opportunities?.length === 0,
        JSON.stringify(listB.body)?.slice(0, 120),
      );
      const detailB = await call("GET", `/partner-portal/opportunities/${oppAId}`, PB_ID);
      check("foreign-firm detail \u2192 404", detailB.status === 404, `status=${detailB.status}`);
      const acctB = await call("GET", `/partner-portal/opportunities/${oppAId}/account`, PB_ID);
      check("foreign-firm account overview \u2192 404", acctB.status === 404, `status=${acctB.status}`);
      const noFirm = await call("GET", "/partner-portal/opportunities", PX_ID);
      check("firm-less partner login \u2192 403", noFirm.status === 403, `status=${noFirm.status}`);
    }

    // =====================================================================
    group("redacted account overview \u2014 exact field allowlist");
    // =====================================================================
    {
      const r = await call("GET", `/partner-portal/opportunities/${oppAId}/account`, PA_ID);
      check("firm A account overview \u2192 200", r.status === 200, `status=${r.status}`);
      const keys = Object.keys(r.body?.account ?? {}).sort();
      const allow = ["brandName", "country", "employeeCount", "hqCity", "name", "sector", "size"];
      check(
        "overview keys === allowlist",
        JSON.stringify(keys) === JSON.stringify(allow),
        keys.join(","),
      );
    }

    // =====================================================================
    group("chat clamping \u2014 catalog slice + RAG isolation");
    // =====================================================================
    {
      const cat = await import("../../src/lib/atelier-cli/capability-catalog.js");
      await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
      const persona = { id: PA_ID, name: "PP Partner A", role: "alliance_partner", orgId: ORG };
      const caps = cat.capabilitiesForPersona(persona as any);
      const ids = caps.map((c: any) => c.id).sort();
      check(
        "alliance_partner catalog slice is exactly the partnerportal.* reads",
        JSON.stringify(ids) ===
          JSON.stringify([
            "partnerportal.account_overview",
            "partnerportal.opportunities",
            "partnerportal.opportunity_detail",
          ]),
        ids.join(","),
      );
      check(
        "no surfaced tool is a write",
        caps.every((c: any) => !c.isWrite),
      );

      const all = cat.listCapabilities ? cat.listCapabilities() : null;
      const ragEntry = (all ?? []).find?.((c: any) => c.id === "attachment.search_documents");
      if (ragEntry) {
        const ctx = {
          persona,
          turnId: `t_${STAMP}`,
          sessionId: `s_${STAMP}`,
          stepIdx: 0,
          progress: () => {},
        };
        const res = await ragEntry.run({ query: "internal strategy" }, ctx as any);
        check(
          "attachment.search_documents refuses alliance_partner (RAG isolation)",
          res?.ok === false && res?.errorCode === "forbidden",
          JSON.stringify(res)?.slice(0, 160),
        );
      } else {
        check("attachment.search_documents entry found for RAG probe", false, "not in catalog listing");
      }

      // Tool-level grant scoping: firm B's persona gets nothing via chat.
      const listTool = caps.find((c: any) => c.id === "partnerportal.opportunities");
      const resA = await listTool.run({}, {
        persona,
        turnId: `t_${STAMP}a`,
        sessionId: `s_${STAMP}a`,
        stepIdx: 0,
        progress: () => {},
      } as any);
      check(
        "chat list tool returns firm A's granted opp",
        resA?.ok === true && resA?.data?.count === 1 && resA?.data?.items?.[0]?.id === oppAId,
        JSON.stringify(resA)?.slice(0, 200),
      );
      const resB = await listTool.run({}, {
        persona: { ...persona, id: PB_ID },
        turnId: `t_${STAMP}b`,
        sessionId: `s_${STAMP}b`,
        stepIdx: 0,
        progress: () => {},
      } as any);
      check(
        "chat list tool returns nothing for firm B",
        resB?.ok === true && resB?.data?.count === 0,
        JSON.stringify(resB)?.slice(0, 160),
      );
      const resInternal = await listTool.run({}, {
        persona: { id: FP_ID, name: "PP FP", role: "founding_partner", orgId: ORG },
        turnId: `t_${STAMP}c`,
        sessionId: `s_${STAMP}c`,
        stepIdx: 0,
        progress: () => {},
      } as any);
      check(
        "partnerportal tool refuses internal roles",
        resInternal?.ok === false && resInternal?.errorCode === "forbidden",
        JSON.stringify(resInternal)?.slice(0, 160),
      );
    }

    // =====================================================================
    group("orchestrator tool list + attachment side channel");
    // =====================================================================
    {
      const cli = await import("../../src/lib/atelier-cli/index.js");
      const tools = cli.getToolsForPersona({
        id: PA_ID,
        name: "PP Partner A",
        role: "alliance_partner",
        orgId: ORG,
      } as any);
      const names = tools.map((t: any) => t.name).sort();
      check(
        "getToolsForPersona = exactly the 3 partnerportal tools (no legacy fallthrough)",
        names.length === 3 && names.every((n: string) => n.startsWith("partner_")),
        names.join(","),
      );
      // Dispatch-time clamp: hallucinated tool names must NOT resolve via
      // the catalog/legacy fallthrough for this role.
      check(
        "findToolByName refuses non-partnerportal tools for the role",
        cli.findToolByName("resolve_account_by_name", {
          id: PA_ID,
          name: "PP Partner A",
          role: "alliance_partner",
          orgId: ORG,
        } as any) === undefined,
      );
      check(
        "findToolByName still resolves the clamped surface + meta tools",
        !!cli.findToolByName("partner_portal_opportunities", {
          id: PA_ID, name: "PP Partner A", role: "alliance_partner", orgId: ORG,
        } as any) &&
          !!cli.findToolByName("recap", {
            id: PA_ID, name: "PP Partner A", role: "alliance_partner", orgId: ORG,
          } as any),
      );
      // /cli sub-path allowlist: chat-turn surface reachable, everything
      // else under /cli 403s.
      for (const denied of ["/cli/help", "/cli/admin/metrics", "/cli/turns/x/recording"]) {
        const rr = await call("GET", denied, PA_ID);
        check(`alliance_partner \u2192 403 on ${denied}`, rr.status === 403, `status=${rr.status}`);
      }
      const sess = await call("GET", "/cli/sessions", PA_ID);
      check("alliance_partner \u2192 /cli/sessions allowed", sess.status === 200, `status=${sess.status}`);
      const att = await call("GET", "/cli/attachments/att_anything", PA_ID);
      check("/cli/attachments/:id \u2192 403 for alliance_partner", att.status === 403, `status=${att.status}`);
      const attUp = await call("POST", "/cli/attachments", PA_ID, {});
      check("/cli/attachments upload \u2192 403 for alliance_partner", attUp.status === 403, `status=${attUp.status}`);
    }

    // =====================================================================
    group("provisioning hardening \u2014 no identity reuse");
    // =====================================================================
    {
      // Email colliding with an EXISTING internal user must hard-409,
      // never attach an activation link to that user's identity.
      const r = await call("POST", `/partners/firms/${firmBId}/logins`, FP_ID, {
        name: "Evil Twin",
        email: `${CONS_ID}@example.com`, // consultant persona's email
      });
      check(
        "provisioning with an internal user's email \u2192 409, no reuse",
        r.status === 409,
        `status=${r.status} body=${JSON.stringify(r.body)?.slice(0, 120)}`,
      );

      // Concurrent provisioning race: same brand-new email, two parallel
      // requests → exactly one 201 (unique credential PK serializes; the
      // loser maps 23505 to 409, never a 500 or a duplicate identity).
      const raceEmail = `pp_race_${STAMP}@example.com`;
      const [ra, rb] = await Promise.all([
        call("POST", `/partners/firms/${firmBId}/logins`, FP_ID, { name: "Race A", email: raceEmail }),
        call("POST", `/partners/firms/${firmBId}/logins`, FP_ID, { name: "Race B", email: raceEmail }),
      ]);
      const statuses = [ra.status, rb.status].sort();
      check(
        "concurrent same-email provisioning \u2192 one 201, one 409",
        JSON.stringify(statuses) === JSON.stringify([201, 409]),
        statuses.join(","),
      );
      const raceRows = await db.select().from(atelierUsers).where(eq(atelierUsers.email, raceEmail));
      check("race leaves exactly one user row", raceRows.length === 1, `rows=${raceRows.length}`);
      raceUserId = raceRows[0]?.id ?? null;
    }

    // =====================================================================
    group("revocation \u2014 grant revoke + firm archive");
    // =====================================================================
    {
      const r = await call(
        "POST",
        `/opportunities/${oppAId}/partner-grants/${grantId}/revoke`,
        FP_ID,
      );
      check("FP revokes grant \u2192 200", r.status === 200 && r.body?.ok === true);
      const list = await call("GET", "/partner-portal/opportunities", PA_ID);
      check(
        "revoked grant \u2192 firm A sees nothing",
        list.status === 200 && list.body?.opportunities?.length === 0,
        JSON.stringify(list.body)?.slice(0, 120),
      );
      const detail = await call("GET", `/partner-portal/opportunities/${oppAId}`, PA_ID);
      check("revoked grant \u2192 detail 404", detail.status === 404, `status=${detail.status}`);
      // Historical grant row retained (soft revoke).
      const rows = await db
        .select()
        .from(atelierPartnerOppGrants)
        .where(eq(atelierPartnerOppGrants.id, grantId));
      check("grant row retained with revokedAt", rows.length === 1 && rows[0].revokedAt != null);

      // Re-grant, then archive the firm — visibility must drop too.
      const re = await call("POST", `/opportunities/${oppAId}/partner-grants`, FP_ID, {
        partnerFirmId: firmAId,
      });
      check("re-grant after revoke \u2192 201 (new row)", re.status === 201);
      await db
        .update(atelierPartnerFirms)
        .set({ deletedAt: new Date() })
        .where(eq(atelierPartnerFirms.id, firmAId));
      const listArchived = await call("GET", "/partner-portal/opportunities", PA_ID);
      check(
        "archived firm \u2192 partner login 403",
        listArchived.status === 403,
        `status=${listArchived.status}`,
      );
      await db
        .update(atelierPartnerFirms)
        .set({ deletedAt: null })
        .where(eq(atelierPartnerFirms.id, firmAId));
    }

    // =====================================================================
    group("provisioning \u2014 shared helper + deactivation");
    // =====================================================================
    {
      const r = await call("POST", `/partners/firms/${firmBId}/logins`, FP_ID, {
        name: `PP Provisioned ${STAMP}`,
        email: `pp_prov_${STAMP}@example.com`,
      });
      check(
        "FP provisions firm B login \u2192 201 with activation link",
        r.status === 201 && !!r.body?.userId && !!r.body?.activationUrl,
        JSON.stringify(r.body)?.slice(0, 160),
      );
      provisionedUserId = r.body?.userId ?? null;
      if (provisionedUserId) {
        const [row] = await db
          .select()
          .from(atelierUsers)
          .where(eq(atelierUsers.id, provisionedUserId));
        check(
          "provisioned user is alliance_partner linked to firm",
          row?.role === "alliance_partner" && row?.partnerFirmId === firmBId,
          JSON.stringify({ role: row?.role, firm: row?.partnerFirmId }),
        );
        const asProv = await call("GET", "/partner-portal/opportunities", provisionedUserId);
        check("provisioned login can read portal \u2192 200", asProv.status === 200, `status=${asProv.status}`);
        const listLogins = await call("GET", `/partners/firms/${firmBId}/logins`, FP_ID);
        check(
          "FP lists firm logins",
          listLogins.status === 200 &&
            listLogins.body?.logins?.some((l: any) => l.id === provisionedUserId && l.active),
        );
        const deact = await call(
          "POST",
          `/partners/firms/${firmBId}/logins/${provisionedUserId}/deactivate`,
          FP_ID,
        );
        check("FP deactivates login \u2192 200", deact.status === 200 && deact.body?.ok === true);
        const after = await call("GET", "/partner-portal/opportunities", provisionedUserId);
        check(
          "deactivated login \u2192 401 (persona no longer resolves)",
          after.status === 401,
          `status=${after.status}`,
        );
      }
    }
  } finally {
    // Cleanup — remove everything this probe created.
    try {
      await db.delete(atelierPartnerOppGrants).where(inArray(atelierPartnerOppGrants.opportunityId, [oppAId, oppBId]));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmAId, firmBId]));
      const { hardDeleteOpportunities } = await import(
        "../../src/lib/atelier-opportunity-delete.js"
      );
      await hardDeleteOpportunities([oppAId, oppBId]);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, accId));
      const ids = [
        FP_ID,
        CONS_ID,
        PA_ID,
        PB_ID,
        PX_ID,
        ...(provisionedUserId ? [provisionedUserId] : []),
        ...(raceUserId ? [raceUserId] : []),
      ];
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, ids));
      await db
        .delete(atelierAuditEvents)
        .where(inArray(atelierAuditEvents.entityId, [oppAId, oppBId, firmAId, firmBId]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    await pool?.end?.().catch(() => {});
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 partner-portal probes passed"
      : `\n\u2717 ${failures.length} failure(s): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
