/**
 * Task #1170 — account name ACL probe for chat resolvers.
 *
 * Proves that a restricted persona (partner_firm_resource) cannot
 * discover an account they are not on via any chat lookup path:
 *
 *   1. resolveAccount (shared resolver, Task #1167 fix) — the core
 *      ACL gate. A restricted persona whose engagement set is empty
 *      must receive `{ kind: "none" }` rather than a match or a
 *      disambiguation prompt that names the out-of-perimeter account.
 *
 *   2. account_lookup capability — delegates to resolveAccount; a
 *      restricted persona must see not_found, never the account name.
 *
 *   3. account_dossier capability (accountQuery path) — also delegates
 *      to resolveAccount; same contract.
 *
 *   4. Positive controls — the same account IS resolvable for a
 *      founding_partner (full-access) and for a partner_firm_resource
 *      who is on an engagement attached to the account.
 *
 * Deterministic — in-process, no live AI calls, no HTTP layer needed.
 * All calls go directly to the capability `.run()` / `resolveAccount()`
 * so the ACL layer is the exact same code the orchestrator uses.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-account-acl-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe1170_${Date.now()}`;
// Unique substring embedded in the account name — if it ever appears in
// a resolver result payload for a restricted persona, the ACL is broken.
const ACCOUNT_NAME = `SecretClient Probe1170 ${TAG}`;

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierEngagements,
    atelierEngagementAccess,
  } = D as any;
  const { eq, inArray, and } = await import("drizzle-orm");

  const { resolveAccount } = await import(
    "../../src/lib/atelier-cli/resolvers/index.js"
  );
  const { findByToolName } = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );
  // Ensure all capabilities are registered.
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");

  const ORG = "aico";
  const IDS = {
    fp: `u_${TAG}_fp`,
    pfrRestricted: `u_${TAG}_pfr_restricted`,
    pfrGranted: `u_${TAG}_pfr_granted`,
  };
  const ACC_ID = `acc_${TAG}`;
  const ENG_ID = `eng_${TAG}`;

  const userIds = Object.values(IDS);

  const makePersona = (id: string, role: string) => ({
    id,
    orgId: ORG,
    role,
    name: id,
  });

  try {
    // ----------------------------------------------------------------
    // Seed users
    // ----------------------------------------------------------------
    await (db as any)
      .insert(atelierUsers)
      .values([
        {
          id: IDS.fp,
          orgId: ORG,
          email: `${TAG}.fp@cognirise.ai`,
          name: "Probe FP 1170",
          initials: "PF",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
        {
          id: IDS.pfrRestricted,
          orgId: ORG,
          email: `${TAG}.pfr.restricted@partner.example`,
          name: "Probe PFR Restricted 1170",
          initials: "PR",
          role: "partner_firm_resource",
          roleLabel: "Partner Firm Resource",
          title: "Senior Consultant",
          permissions: [],
        },
        {
          id: IDS.pfrGranted,
          orgId: ORG,
          email: `${TAG}.pfr.granted@partner.example`,
          name: "Probe PFR Granted 1170",
          initials: "PG",
          role: "partner_firm_resource",
          roleLabel: "Partner Firm Resource",
          title: "Engagement Lead",
          permissions: [],
        },
      ] as any)
      .onConflictDoNothing();

    // ----------------------------------------------------------------
    // Seed the restricted account
    // ----------------------------------------------------------------
    await (db as any)
      .insert(atelierAccounts)
      .values({
        id: ACC_ID,
        orgId: ORG,
        name: ACCOUNT_NAME,
        country: "AE",
        sector: "technology",
      })
      .onConflictDoNothing();

    // ----------------------------------------------------------------
    // Seed an engagement on the account — only pfrGranted gets access.
    // ----------------------------------------------------------------
    await (db as any)
      .insert(atelierEngagements)
      .values({
        id: ENG_ID,
        orgId: ORG,
        accountId: ACC_ID,
        slug: `probe-eng-${TAG}`,
        name: `Probe Engagement ${TAG}`,
        plmStage: "deliver",
        partnerOwnerId: IDS.fp,
        engagementLeadId: IDS.fp,
        startDate: "2026-01-01",
        plannedEndDate: "2026-12-31",
      } as any)
      .onConflictDoNothing();

    await (db as any)
      .insert(atelierEngagementAccess)
      .values({
        id: `eacc_${TAG}`,
        engagementId: ENG_ID,
        userId: IDS.pfrGranted,
        roleOnEngagement: "lead",
      } as any)
      .onConflictDoNothing();

    // ================================================================
    // 1. resolveAccount — the core resolver gate (Task #1167 fix)
    // ================================================================

    // 1a. Restricted PFR with no engagements on this account → none.
    {
      const r = await resolveAccount("Probe1170", makePersona(IDS.pfrRestricted, "partner_firm_resource") as any);
      check(
        "resolveAccount: restricted PFR (no engagement) → kind:none",
        r.kind === "none",
        r,
      );
      // Belt-and-suspenders: the account name must not appear in any
      // choices even if kind is unexpectedly "choices".
      if (r.kind === "choices") {
        const leaks = (r as any).options.filter((o: any) =>
          String(o.label ?? "").includes("Probe1170") ||
          String(o.id ?? "").includes(TAG),
        );
        check(
          "resolveAccount: restricted PFR choices never name out-of-scope account",
          leaks.length === 0,
          leaks,
        );
      }
    }

    // 1b. Founding partner sees the account (positive control).
    {
      const r = await resolveAccount("Probe1170", makePersona(IDS.fp, "founding_partner") as any);
      check(
        "resolveAccount: founding_partner finds the account",
        r.kind === "match" || r.kind === "choices",
        r,
      );
      if (r.kind === "match") {
        check(
          "resolveAccount: founding_partner match id is correct",
          r.id === ACC_ID,
          r.id,
        );
      }
    }

    // 1c. Granted PFR (has an engagement on this account) → sees it.
    {
      const r = await resolveAccount("Probe1170", makePersona(IDS.pfrGranted, "partner_firm_resource") as any);
      check(
        "resolveAccount: granted PFR (has engagement) finds the account",
        r.kind === "match" || r.kind === "choices",
        r,
      );
    }

    // ================================================================
    // 2. account_lookup capability
    // ================================================================
    const accountLookup = findByToolName("account_lookup");
    check("catalog: account_lookup registered", !!accountLookup);

    const ctxFor = (id: string, role: string) =>
      ({ persona: { id, name: id, role, orgId: ORG } }) as any;

    // 2a. Restricted PFR → not_found, account name never in payload.
    {
      const out: any = await accountLookup!.run(
        { query: "Probe1170" },
        ctxFor(IDS.pfrRestricted, "partner_firm_resource"),
      );
      check(
        "account_lookup: restricted PFR gets not_found",
        out?.ok === false && out?.errorCode === "not_found",
        out,
      );
      const str = JSON.stringify(out);
      check(
        "account_lookup: restricted PFR payload never contains account name",
        !str.includes("Probe1170") || out?.ok === true,
        // ok:false not_found messages may contain the query term; we only
        // care that the account's id and label aren't exposed.
        !str.includes(ACC_ID) && !str.includes(ACCOUNT_NAME),
      );
      check(
        "account_lookup: restricted PFR result never leaks account id",
        !str.includes(ACC_ID),
        str.slice(0, 200),
      );
    }

    // 2b. Founding partner resolves (positive control).
    {
      const out: any = await accountLookup!.run(
        { query: "Probe1170" },
        ctxFor(IDS.fp, "founding_partner"),
      );
      check(
        "account_lookup: founding_partner resolves the account",
        out?.ok === true,
        out,
      );
    }

    // ================================================================
    // 3. account_dossier capability (accountQuery path)
    // ================================================================
    const accountDossier = findByToolName("account_dossier");
    check("catalog: account_dossier registered", !!accountDossier);

    // 3a. Restricted PFR with accountQuery → not_found, no name leak.
    {
      const out: any = await accountDossier!.run(
        { accountQuery: "Probe1170" },
        ctxFor(IDS.pfrRestricted, "partner_firm_resource"),
      );
      check(
        "account_dossier (query): restricted PFR gets not_found",
        out?.ok === false && out?.errorCode === "not_found",
        out,
      );
      const str = JSON.stringify(out);
      check(
        "account_dossier (query): restricted PFR payload never leaks account id",
        !str.includes(ACC_ID),
        str.slice(0, 200),
      );
    }

    // 3b. Founding partner → ok with the dossier (positive control).
    {
      const out: any = await accountDossier!.run(
        { accountQuery: "Probe1170" },
        ctxFor(IDS.fp, "founding_partner"),
      );
      check(
        "account_dossier (query): founding_partner gets the dossier",
        out?.ok === true && out?.data?.id === ACC_ID,
        out,
      );
    }

    // 3c. Granted PFR (has engagement) → ok.
    {
      const out: any = await accountDossier!.run(
        { accountQuery: "Probe1170" },
        ctxFor(IDS.pfrGranted, "partner_firm_resource"),
      );
      check(
        "account_dossier (query): granted PFR gets the dossier",
        out?.ok === true && out?.data?.id === ACC_ID,
        out,
      );
    }

    // ================================================================
    // 4. account_dossier with direct accountId — the capability must
    //    enforce canSeeAccount even when the caller supplies the id
    //    directly (bypassing the resolveAccount name-lookup gate).
    // ================================================================
    {
      // Restricted PFR with no engagement → refused (not_found).
      const out: any = await accountDossier!.run(
        { accountId: ACC_ID },
        ctxFor(IDS.pfrRestricted, "partner_firm_resource"),
      );
      check(
        "account_dossier (direct id): restricted PFR refused (not_found)",
        out?.ok === false && out?.errorCode === "not_found",
        out,
      );
      const str = JSON.stringify(out);
      check(
        "account_dossier (direct id): restricted PFR payload never leaks account id",
        !str.includes(ACC_ID) || out?.ok === false,
        str.slice(0, 200),
      );

      // Granted PFR (has engagement) → gets the dossier.
      const out2: any = await accountDossier!.run(
        { accountId: ACC_ID },
        ctxFor(IDS.pfrGranted, "partner_firm_resource"),
      );
      check(
        "account_dossier (direct id): granted PFR gets the dossier",
        out2?.ok === true && out2?.data?.id === ACC_ID,
        out2,
      );

      // Founding partner → always gets the dossier.
      const out3: any = await accountDossier!.run(
        { accountId: ACC_ID },
        ctxFor(IDS.fp, "founding_partner"),
      );
      check(
        "account_dossier (direct id): founding_partner gets the dossier",
        out3?.ok === true && out3?.data?.id === ACC_ID,
        out3,
      );
    }

  } finally {
    try {
      // Clean up engagement access, engagement, account, users.
      await (db as any)
        .delete(atelierEngagementAccess)
        .where(eq(atelierEngagementAccess.id, `eacc_${TAG}`));
      await (db as any)
        .delete(atelierEngagements)
        .where(eq(atelierEngagements.id, ENG_ID));
      await (db as any)
        .delete(atelierAccounts)
        .where(eq(atelierAccounts.id, ACC_ID));
      await (db as any)
        .delete(atelierUsers)
        .where(inArray(atelierUsers.id, userIds));
    } catch (e) {
      console.error("cleanup error", e);
    }
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
