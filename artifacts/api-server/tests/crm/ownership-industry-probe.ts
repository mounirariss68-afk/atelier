/**
 * Task #698 — ownership edit surface + Cartographer industry persistence.
 *
 * Covers:
 *   A. resolveIndustryTaxonomy: exact codes, sub-code implies parent, label
 *      match, NAICS 2-digit fallback, unmappable → null
 *   B. buildCartographerProposals emits an "industry" proposal for mappable
 *      output and NO proposal for unmappable output (graceful skip)
 *   C. REST PATCH /accounts/:id ownership fields:
 *      - founding_partner can change owner/tier/status/hqCity/currency/language
 *      - partnerOwnerId is validated against real partner-tier users (400)
 *      - status "archived" is rejected by the schema (400)
 *      - employee persona gets 403
 *      - ownership changes are audited with before/after
 *   D. POST /accounts with reviewed research carrying a NAICS industry code →
 *      account ends up with the mapped taxonomy code (never the raw NAICS)
 *   E. approving a pending "industry" proposal writes the taxonomy codes
 *
 * Deterministic — no LLM calls. Run: pnpm exec tsx tests/crm/ownership-industry-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const { resolveIndustryTaxonomy } = await import(
    "../../src/lib/atelier-agents/industry-taxonomy.js"
  );

  // ---- A. resolver ----
  check(
    "resolver: exact industry code",
    JSON.stringify(resolveIndustryTaxonomy("FS")) ===
      JSON.stringify({ industryCode: "FS", subIndustryCode: null }),
    resolveIndustryTaxonomy("FS"),
  );
  check(
    "resolver: sub-code implies parent",
    JSON.stringify(resolveIndustryTaxonomy(null, "FS_BANKING")) ===
      JSON.stringify({ industryCode: "FS", subIndustryCode: "FS_BANKING" }),
    resolveIndustryTaxonomy(null, "FS_BANKING"),
  );
  check(
    "resolver: label match",
    resolveIndustryTaxonomy("Financial Services")?.industryCode === "FS",
    resolveIndustryTaxonomy("Financial Services"),
  );
  check(
    "resolver: NAICS 2-digit fallback (52 → FS)",
    resolveIndustryTaxonomy("52")?.industryCode === "FS",
    resolveIndustryTaxonomy("52"),
  );
  check(
    "resolver: NAICS 6-digit uses prefix (522110 → FS)",
    resolveIndustryTaxonomy("522110")?.industryCode === "FS",
    resolveIndustryTaxonomy("522110"),
  );
  check(
    "resolver: contradictory sub wins over industry",
    JSON.stringify(resolveIndustryTaxonomy("TMT", "FS_BANKING")) ===
      JSON.stringify({ industryCode: "FS", subIndustryCode: "FS_BANKING" }),
    resolveIndustryTaxonomy("TMT", "FS_BANKING"),
  );
  check(
    "resolver: unmappable → null",
    resolveIndustryTaxonomy("totally made up sector") === null &&
      resolveIndustryTaxonomy("11") === null &&
      resolveIndustryTaxonomy(null, null) === null,
  );

  // ---- B. proposal builder ----
  const runner = await import("../../src/lib/atelier-agents/runner.js");
  const { buildCartographerProposals } = runner as any;
  const emptyBrief = {
    whatsChanging: [],
    executiveTensions: [],
    serviceLineFit: [],
    partnerEcosystem: [],
    mandateAngles: [],
    whyNowHypothesis: "",
    openQuestions: [],
  };
  const baseAccount = {
    id: "acct_probe698",
    orgId: "aico",
    name: "Probe 698 Co",
    industryCode: null,
    subIndustryCode: null,
    cogniriseHypothesis: null,
    strategicPriorities: [],
    researchBrief: null,
    sourceSignals: [],
    pendingProfileUpdates: [],
  };
  const mkOutput = (industryCode: string | null, subIndustryCode: string | null = null) => ({
    account: {
      industryCode,
      subIndustryCode,
      strategicPriorities: [],
      cogniriseHypothesis: "",
    },
    sourceSignals: [],
    decisionMakers: [],
    researchBrief: emptyBrief,
  });
  const props1 = buildCartographerProposals({
    proposedBy: "ag_account_cartographer",
    output: mkOutput("52", "FS_BANKING"),
    account: baseAccount,
    existingContacts: [],
  });
  const indProp = props1.find((p: any) => p.field === "industry");
  check(
    "builder: industry proposal emitted with taxonomy codes",
    !!indProp &&
      (indProp.toValue as any).industryCode === "FS" &&
      (indProp.toValue as any).subIndustryCode === "FS_BANKING",
    props1,
  );
  const props2 = buildCartographerProposals({
    proposedBy: "ag_account_cartographer",
    output: mkOutput("999999"),
    account: baseAccount,
    existingContacts: [],
  });
  check(
    "builder: unmappable industry → no proposal",
    !props2.some((p: any) => p.field === "industry"),
    props2,
  );
  const props3 = buildCartographerProposals({
    proposedBy: "ag_account_cartographer",
    output: mkOutput("FS", "FS_BANKING"),
    account: { ...baseAccount, industryCode: "FS", subIndustryCode: "FS_BANKING" },
    existingContacts: [],
  });
  check(
    "builder: no-op when industry already live",
    !props3.some((p: any) => p.field === "industry"),
    props3,
  );

  // ---- REST setup ----
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierAuditEvents } = D;
  const { eq, and, desc, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const runTag = `probe698_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const partnerId = `u_${runTag}_p`;
  const empId = `u_${runTag}_emp`;
  const createdAccountIds: string[] = [];

  const api = async (asUser: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${asUser}` },
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
    await db.insert(atelierUsers).values([
      {
        id: fpId,
        orgId: "aico",
        name: "Probe FP 698",
        initials: "PF",
        email: `${runTag}_fp@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: partnerId,
        orgId: "aico",
        name: "Probe Partner 698",
        initials: "PP",
        email: `${runTag}_p@example.test`,
        role: "partner",
        roleLabel: "Partner",
        title: "Partner",
      },
      {
        id: empId,
        orgId: "aico",
        name: "Probe Emp 698",
        initials: "PE",
        email: `${runTag}_emp@example.test`,
        role: "employee",
        roleLabel: "Consultant",
        title: "Consultant",
      },
    ] as any);

    // ---- C. ownership PATCH ----
    const created = await api(fpId, "POST", "/accounts", {
      name: `Ownership Probe ${runTag}`,
      sector: "Logistics",
      country: "AE",
      tier: "C",
      status: "active",
      primaryCurrency: "USD",
      primaryLanguage: "en",
    });
    check("setup: account created", created.status === 201, created);
    const acctId = created.body?.id;
    if (acctId) createdAccountIds.push(acctId);

    const patch = await api(fpId, "PATCH", `/accounts/${acctId}`, {
      partnerOwnerId: partnerId,
      tier: "A",
      status: "dormant",
      hqCity: "Dubai",
      primaryCurrency: "AED",
      primaryLanguage: "ar",
    });
    check("ownership PATCH -> 200", patch.status === 200, patch);
    const acct = patch.body?.account;
    check(
      "ownership fields reflected in workspace",
      acct?.partnerOwnerId === partnerId &&
        acct?.tier === "A" &&
        acct?.status === "dormant" &&
        acct?.hqCity === "Dubai" &&
        acct?.primaryCurrency === "AED" &&
        acct?.primaryLanguage === "ar",
      acct && {
        partnerOwnerId: acct.partnerOwnerId,
        tier: acct.tier,
        status: acct.status,
        hqCity: acct.hqCity,
        primaryCurrency: acct.primaryCurrency,
        primaryLanguage: acct.primaryLanguage,
      },
    );

    const [audit] = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, acctId),
          eq(atelierAuditEvents.action, "account.update"),
        ),
      )
      .orderBy(desc(atelierAuditEvents.createdAt))
      .limit(1);
    const changes = (audit?.payload as any)?.changes ?? [];
    check(
      "ownership edit audited with before/after",
      changes.some(
        (c: any) => c.field === "partnerOwnerId" && c.before === fpId && c.after === partnerId,
      ) && changes.some((c: any) => c.field === "tier" && c.before === "C" && c.after === "A"),
      changes,
    );

    const badOwner = await api(fpId, "PATCH", `/accounts/${acctId}`, {
      partnerOwnerId: empId,
    });
    check(
      "non-partner owner rejected -> 400 invalid-partner-owner",
      badOwner.status === 400 && badOwner.body?.error === "invalid-partner-owner",
      badOwner,
    );
    const ghostOwner = await api(fpId, "PATCH", `/accounts/${acctId}`, {
      partnerOwnerId: "u_does_not_exist",
    });
    check("ghost owner rejected -> 400", ghostOwner.status === 400, ghostOwner);

    const archived = await api(fpId, "PATCH", `/accounts/${acctId}`, { status: "archived" });
    check("status archived rejected by schema -> 400", archived.status === 400, archived);

    const empPatch = await api(empId, "PATCH", `/accounts/${acctId}`, { tier: "B" });
    check("employee persona -> 403", empPatch.status === 403, empPatch);

    const unassign = await api(fpId, "PATCH", `/accounts/${acctId}`, { partnerOwnerId: null });
    check(
      "owner unassign (null) -> 200",
      unassign.status === 200 && unassign.body?.account?.partnerOwnerId === null,
      unassign.body?.account?.partnerOwnerId,
    );

    // ---- C2. archived accounts are frozen for ownership edits ----
    const frozen = await api(fpId, "POST", "/accounts", {
      name: `Archived Probe ${runTag}`,
      sector: "Logistics",
      country: "AE",
      tier: "C",
      status: "active",
      primaryCurrency: "USD",
      primaryLanguage: "en",
    });
    check("setup: archive-target account created", frozen.status === 201, frozen);
    const frozenId = frozen.body?.id;
    if (frozenId) createdAccountIds.push(frozenId);
    const arch = await api(fpId, "POST", `/accounts/${frozenId}/archive`, {});
    check("setup: account archived", arch.status === 200, arch);
    const reactivate = await api(fpId, "PATCH", `/accounts/${frozenId}`, { status: "active" });
    check(
      "archived: status reactivation via PATCH blocked -> 409 account-archived",
      reactivate.status === 409 && reactivate.body?.error === "account-archived",
      reactivate,
    );
    const archTier = await api(fpId, "PATCH", `/accounts/${frozenId}`, { tier: "A" });
    check("archived: ownership edit blocked -> 409", archTier.status === 409, archTier);
    const [frozenRow] = await db
      .select({ status: atelierAccounts.status })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, frozenId));
    check("archived: DB status still archived", frozenRow?.status === "archived", frozenRow);

    // ---- D. reviewed research with NAICS industry maps to taxonomy ----
    const withResearch = await api(fpId, "POST", "/accounts", {
      name: `Industry Probe ${runTag}`,
      sector: "Banking",
      country: "AE",
      tier: "B",
      status: "active",
      primaryCurrency: "AED",
      primaryLanguage: "en",
      research: {
        industryCode: "52",
        subIndustryCode: null,
        refreshedSummary: "A bank.",
        sourceSignals: [],
        strategicPriorityRefs: [],
        decisionMakers: [],
      },
    });
    check("create-with-research -> 201", withResearch.status === 201, withResearch);
    const acct2Id = withResearch.body?.id;
    if (acct2Id) createdAccountIds.push(acct2Id);
    const [row2] = await db
      .select({
        industryCode: atelierAccounts.industryCode,
        subIndustryCode: atelierAccounts.subIndustryCode,
      })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acct2Id));
    check(
      "reviewed NAICS industry resolved to taxonomy (52 → FS), raw code never stored",
      row2?.industryCode === "FS" && row2?.subIndustryCode === null,
      row2,
    );

    // ---- E. approving an industry proposal applies taxonomy codes ----
    const proposalId = `pp_${runTag}`;
    await db
      .update(atelierAccounts)
      .set({
        pendingProfileUpdates: [
          {
            id: proposalId,
            proposedBy: "ag_account_cartographer",
            proposedAt: new Date().toISOString(),
            field: "industry",
            fromValue: { industryCode: null, subIndustryCode: null },
            toValue: { industryCode: "TTH", subIndustryCode: "TTH_LOGISTICS" },
            rationale: "probe",
            status: "pending",
          },
        ],
      })
      .where(eq(atelierAccounts.id, acctId));
    const decide = await api(fpId, "POST", `/accounts/${acctId}/profile-updates/${proposalId}/decision`, {
      decision: "approve",
    });
    check("industry proposal approve -> 200", decide.status === 200, decide);
    const [row1] = await db
      .select({
        industryCode: atelierAccounts.industryCode,
        subIndustryCode: atelierAccounts.subIndustryCode,
      })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctId));
    check(
      "approved industry proposal written to account",
      row1?.industryCode === "TTH" && row1?.subIndustryCode === "TTH_LOGISTICS",
      row1,
    );
  } finally {
    // cleanup (scratch DB, but keep the tag-sweep habit)
    if (createdAccountIds.length > 0) {
      await db
        .delete(atelierAuditEvents)
        .where(inArray(atelierAuditEvents.entityId, createdAccountIds));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, createdAccountIds));
    }
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, partnerId, empId]));
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASH", err);
  process.exit(1);
});
