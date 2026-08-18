/**
 * Task #1302 — Non-Equity Partner (NEP) chat lookup ACL probe.
 *
 * Task #1297 clamped non_equity_partner chat to the identity-locked me.*
 * perimeter plus the generic `entity.detail` lookup, whose account /
 * opportunity providers resolve NEP visibility through the grant / invite /
 * ownership set in lib/atelier-nep-access.ts. This probe pins that contract
 * (pattern: chat-account-acl-probe.ts):
 *
 *   1. Tool menu — capabilitiesForPersona(non_equity_partner) is exactly
 *      me.* + entity.detail + meta.find_screen. Nothing else, ever.
 *
 *   2. entity_detail on a GRANTED account → resolves (card, correct id).
 *
 *   3. entity_detail on an UNGRANTED account → refused, and the refusal
 *      payload never contains the account's name or id (by query, and by
 *      direct id — the id path must not confirm existence either).
 *
 *   4. entity_detail on an INVITED opportunity → resolves; an UNINVITED
 *      opportunity on an ungranted account → refused without leaking the
 *      opportunity or account name/id.
 *
 *   5. Positive control — a founding_partner resolves the "secret" account
 *      normally, proving the negative results above come from the NEP
 *      clamp and not from missing data.
 *
 * Deterministic — in-process capability `.run()` calls on an isolated
 * scratch DB, ephemeral p_test_* personas, no live AI calls, no HTTP.
 *
 * Run: pnpm --filter @workspace/api-server run test:nep-chat-acl
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

const TAG = `probe1302_${Date.now()}`;
// Unique substrings embedded in the out-of-perimeter record names — if any
// of them ever appear in a result payload for the NEP, the ACL is broken.
const SECRET_ACC_NAME = `SecretAccount Probe1302 ${TAG}`;
const SECRET_OPP_NAME = `SecretDeal Probe1302 ${TAG}`;
const GRANTED_ACC_NAME = `GrantedAccount Probe1302 ${TAG}`;
const PARENT_ACC_NAME = `ParentAccount Probe1302 ${TAG}`;
const INVITED_OPP_NAME = `InvitedDeal Probe1302 ${TAG}`;

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierNepAccountGrants,
    atelierNepOppInvites,
  } = D as any;
  const { eq, inArray } = await import("drizzle-orm");

  const { findByToolName, capabilitiesForPersona } = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );
  // Ensure all capabilities are registered.
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");

  const ORG = "aico";
  const IDS = {
    fp: `p_test_${TAG}_fp`,
    nep: `p_test_${TAG}_nep`,
  };
  const GRANTED_ACC = `acc_${TAG}_granted`;
  const PARENT_ACC = `acc_${TAG}_parent`;
  const SECRET_ACC = `acc_${TAG}_secret`;
  const INVITED_OPP = `opp_${TAG}_invited`;
  const SECRET_OPP = `opp_${TAG}_secret`;

  const userIds = Object.values(IDS);

  const ctxFor = (id: string, role: string) =>
    ({ persona: { id, name: id, role, orgId: ORG } }) as any;

  try {
    // ----------------------------------------------------------------
    // Seed users (ephemeral p_test_* personas)
    // ----------------------------------------------------------------
    await (db as any)
      .insert(atelierUsers)
      .values([
        {
          id: IDS.fp,
          orgId: ORG,
          email: `${TAG}.fp@cognirise.ai`,
          name: "Probe FP 1302",
          initials: "PF",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
        {
          id: IDS.nep,
          orgId: ORG,
          email: `${TAG}.nep@cognirise.ai`,
          name: "Probe NEP 1302",
          initials: "PN",
          role: "non_equity_partner",
          roleLabel: "Non-Equity Partner",
          title: "Non-Equity Partner",
          permissions: [],
        },
      ] as any)
      .onConflictDoNothing();

    // ----------------------------------------------------------------
    // Seed accounts: one granted to the NEP, one secret (no grant).
    // ----------------------------------------------------------------
    await (db as any)
      .insert(atelierAccounts)
      .values([
        {
          id: GRANTED_ACC,
          orgId: ORG,
          name: GRANTED_ACC_NAME,
          country: "AE",
          sector: "technology",
        },
        {
          id: PARENT_ACC,
          orgId: ORG,
          name: PARENT_ACC_NAME,
          country: "AE",
          sector: "technology",
        },
        {
          id: SECRET_ACC,
          orgId: ORG,
          name: SECRET_ACC_NAME,
          country: "AE",
          sector: "technology",
        },
      ] as any)
      .onConflictDoNothing();

    await (db as any)
      .insert(atelierNepAccountGrants)
      .values({
        id: `nepag_${TAG}`,
        orgId: ORG,
        userId: IDS.nep,
        accountId: GRANTED_ACC,
        createdByUserId: IDS.fp,
      } as any)
      .onConflictDoNothing();

    // ----------------------------------------------------------------
    // Seed opportunities: the invited one lives on PARENT_ACC (whose
    // read-limited visibility for the NEP is BY DESIGN via the invite);
    // the secret one lives on SECRET_ACC, which has no grant and no
    // invite anywhere — it must stay completely invisible.
    // ----------------------------------------------------------------
    await (db as any)
      .insert(atelierOpportunities)
      .values([
        {
          id: INVITED_OPP,
          orgId: ORG,
          accountId: PARENT_ACC,
          slug: `invited-${TAG}`,
          name: INVITED_OPP_NAME,
          salesStage: "qualify",
          partnerOwnerId: IDS.fp,
          engagementLeadId: IDS.fp,
          dealSizeHypothesis: 100000,
          probabilityPct: 30,
          nextMilestone: "meet",
          sourceLead: "probe",
        },
        {
          id: SECRET_OPP,
          orgId: ORG,
          accountId: SECRET_ACC,
          slug: `secret-${TAG}`,
          name: SECRET_OPP_NAME,
          salesStage: "qualify",
          partnerOwnerId: IDS.fp,
          engagementLeadId: IDS.fp,
          dealSizeHypothesis: 100000,
          probabilityPct: 30,
          nextMilestone: "meet",
          sourceLead: "probe",
        },
      ] as any)
      .onConflictDoNothing();

    await (db as any)
      .insert(atelierNepOppInvites)
      .values({
        id: `nepoi_${TAG}`,
        orgId: ORG,
        userId: IDS.nep,
        opportunityId: INVITED_OPP,
        createdByUserId: IDS.fp,
      } as any)
      .onConflictDoNothing();

    const entityDetail = findByToolName("entity_detail");
    check("catalog: entity_detail registered", !!entityDetail);

    // ================================================================
    // 1. Tool menu — NEP chat surface is exactly me.* + entity.detail
    //    + meta.find_screen.
    // ================================================================
    {
      const caps = capabilitiesForPersona({
        id: IDS.nep,
        name: IDS.nep,
        role: "non_equity_partner",
        orgId: ORG,
      } as any);
      const ids: string[] = caps.map((e: any) => e.id);
      const offenders = ids.filter(
        (id) =>
          !id.startsWith("me.") &&
          id !== "entity.detail" &&
          id !== "meta.find_screen",
      );
      check(
        "tool menu: NEP gets ONLY me.* + entity.detail + meta.find_screen",
        offenders.length === 0,
        offenders,
      );
      check("tool menu: NEP has entity.detail", ids.includes("entity.detail"), ids);
      check(
        "tool menu: NEP has meta.find_screen",
        ids.includes("meta.find_screen"),
        ids,
      );
      check(
        "tool menu: NEP has at least one me.* capability",
        ids.some((id) => id.startsWith("me.")),
        ids,
      );
      // No org-wide CRM lookup tools ever.
      check(
        "tool menu: NEP never gets account_lookup / account_dossier",
        !ids.some((id) => id.startsWith("account.")),
        ids.filter((id) => id.startsWith("account.")),
      );
    }

    const noLeak = (out: unknown, extra: string[] = []) => {
      const str = JSON.stringify(out);
      const leaked = [
        SECRET_ACC,
        SECRET_ACC_NAME,
        SECRET_OPP,
        SECRET_OPP_NAME,
        ...extra,
      ].filter((needle) => str.includes(needle));
      return { ok: leaked.length === 0, leaked, head: str.slice(0, 300) };
    };

    // ================================================================
    // 2. Granted account resolves for the NEP.
    // ================================================================
    {
      const out: any = await entityDetail!.run(
        { kind: "account", query: `GrantedAccount Probe1302` },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail: NEP resolves a GRANTED account",
        out?.ok === true && out?.data?.id === GRANTED_ACC,
        out,
      );
    }

    // ================================================================
    // 3. Ungranted account — refused by query and by direct id,
    //    never leaking the name or id.
    // ================================================================
    {
      const out: any = await entityDetail!.run(
        { kind: "account", query: `SecretAccount Probe1302` },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail (query): NEP refused on UNGRANTED account",
        out?.ok === false,
        out,
      );
      const leak = noLeak(out);
      check(
        "entity_detail (query): refusal never leaks secret account name/id",
        leak.ok,
        leak,
      );
    }
    {
      const out: any = await entityDetail!.run(
        { kind: "account", id: SECRET_ACC },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail (direct id): NEP refused on UNGRANTED account",
        out?.ok === false,
        out,
      );
      const leak = noLeak(out);
      check(
        "entity_detail (direct id): refusal never leaks secret account name/id",
        leak.ok,
        leak,
      );
    }
    // Untyped ask (no kind hint) must not leak either — the untyped probe
    // fans out across providers and filters visibility BEFORE capping.
    {
      const out: any = await entityDetail!.run(
        { query: `SecretAccount Probe1302` },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail (untyped query): NEP refused on UNGRANTED account",
        out?.ok === false ||
          // A disambiguation/other match is only acceptable if it does not
          // name the secret records.
          noLeak(out).ok,
        out,
      );
      const leak = noLeak(out);
      check(
        "entity_detail (untyped query): payload never leaks secret records",
        leak.ok,
        leak,
      );
    }

    // ================================================================
    // 4. Opportunities — invited resolves, uninvited refused, no leak.
    // ================================================================
    {
      const out: any = await entityDetail!.run(
        { kind: "opportunity", query: `InvitedDeal Probe1302` },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail: NEP resolves an INVITED opportunity",
        out?.ok === true && out?.data?.opportunity?.id === INVITED_OPP,
        out,
      );
    }
    {
      const out: any = await entityDetail!.run(
        { kind: "opportunity", query: `SecretDeal Probe1302` },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail (query): NEP refused on UNINVITED opportunity",
        out?.ok === false,
        out,
      );
      const leak = noLeak(out);
      check(
        "entity_detail (query): refusal never leaks secret opportunity name/id",
        leak.ok,
        leak,
      );
    }
    {
      const out: any = await entityDetail!.run(
        { kind: "opportunity", id: SECRET_OPP },
        ctxFor(IDS.nep, "non_equity_partner"),
      );
      check(
        "entity_detail (direct id): NEP refused on UNINVITED opportunity",
        out?.ok === false,
        out,
      );
      const leak = noLeak(out);
      check(
        "entity_detail (direct id): refusal never leaks secret opportunity name/id",
        leak.ok,
        leak,
      );
    }

    // ================================================================
    // 5. Positive control — founding_partner sees the secret account
    //    and opportunity (proves the data exists; refusals above are
    //    the NEP clamp, not missing rows).
    // ================================================================
    {
      const out: any = await entityDetail!.run(
        { kind: "account", id: SECRET_ACC },
        ctxFor(IDS.fp, "founding_partner"),
      );
      check(
        "entity_detail: founding_partner sees the secret account",
        out?.ok === true && out?.data?.id === SECRET_ACC,
        out,
      );
      const out2: any = await entityDetail!.run(
        { kind: "opportunity", id: SECRET_OPP },
        ctxFor(IDS.fp, "founding_partner"),
      );
      check(
        "entity_detail: founding_partner sees the secret opportunity",
        out2?.ok === true && out2?.data?.opportunity?.id === SECRET_OPP,
        out2,
      );
    }
  } finally {
    try {
      await (db as any)
        .delete(atelierNepOppInvites)
        .where(eq(atelierNepOppInvites.id, `nepoi_${TAG}`));
      await (db as any)
        .delete(atelierNepAccountGrants)
        .where(eq(atelierNepAccountGrants.id, `nepag_${TAG}`));
      await (db as any)
        .delete(atelierOpportunities)
        .where(inArray(atelierOpportunities.id, [INVITED_OPP, SECRET_OPP]));
      await (db as any)
        .delete(atelierAccounts)
        .where(inArray(atelierAccounts.id, [GRANTED_ACC, PARENT_ACC, SECRET_ACC]));
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
