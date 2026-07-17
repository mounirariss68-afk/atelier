/**
 * Task #38 — duplicate-account guard probe (mirrors opportunity-duplicate-probe).
 *
 * Covers:
 *   - REST POST /accounts: exact normalized-name match -> structured 409
 *     ({error:"duplicate-name", existingAccountId, existingAccountName, similar})
 *   - REST: legal-suffix variant ("… Holdings LLC" vs "… Holdings") still 409
 *   - REST: allowDuplicate:true override -> 201
 *   - REST: archived (deletedAt set) duplicates do NOT block
 *   - REST: fuzzy near-match does NOT block (201)
 *   - POST /opportunities create-with-new-account branch: exact same name is
 *     silently reused (no new account); suffix variant -> 409 duplicate-account;
 *     allowDuplicateAccount:true override -> 201 with a NEW account
 *   - Chat/CLI: account_create preview surfaces duplicateWarning and pre-sets
 *     allowDuplicate on the pending input; commit without the flag is rejected
 *     ok:false errorCode:"duplicate_account"; commit with the flag succeeds.
 *
 * Deterministic: runScout:false everywhere; no LLM calls.
 * Run: pnpm exec tsx tests/crm/account-duplicate-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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
  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities } = D;
  const { eq, sql, inArray, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe38_${Date.now()}`;
  const userId = `u_${runTag}`;
  const baseName = `Dup Acct Probe ${runTag}`;
  const createdAccountIds: string[] = [];

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

  const acctBody = (name: string, extra?: Record<string, unknown>) => ({
    name,
    sector: "Logistics",
    country: "AE",
    tier: "C",
    status: "active",
    primaryCurrency: "USD",
    primaryLanguage: "en",
    ...extra,
  });
  const trackAcct = (r: { status: number; body: any }) => {
    const id = r.body?.id ?? null;
    if (id) createdAccountIds.push(id);
    return id;
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe ThirtyEight",
      initials: "PE",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);

    // ---- REST: seed the original account ----
    const first = await api("POST", "/accounts", acctBody(`${baseName} Holdings`));
    check("original create -> 201", first.status === 201, first);
    const firstId = trackAcct(first);
    check("original id present", !!firstId, first.body);

    // ---- exact duplicate blocked with structured 409 ----
    const dup = await api("POST", "/accounts", acctBody(`${baseName} Holdings`));
    check("exact duplicate -> 409", dup.status === 409, dup);
    check(
      "409 body is structured duplicate-name",
      dup.body?.error === "duplicate-name" &&
        dup.body?.existingAccountId === firstId &&
        dup.body?.existingAccountName === `${baseName} Holdings` &&
        Array.isArray(dup.body?.similar) &&
        dup.body?.similar.some((s: any) => s.id === firstId && s.exact === true) &&
        typeof dup.body?.message === "string",
      dup.body,
    );
    if (dup.status === 201) trackAcct(dup);

    // ---- legal-suffix / case variant still blocks ----
    const dupSuffix = await api(
      "POST",
      "/accounts",
      acctBody(`${baseName.toUpperCase()} HOLDINGS LLC`),
    );
    check("suffix/case variant -> 409", dupSuffix.status === 409, dupSuffix);
    if (dupSuffix.status === 201) trackAcct(dupSuffix);

    // ---- explicit override creates anyway ----
    const override = await api(
      "POST",
      "/accounts",
      acctBody(`${baseName} Holdings`, { allowDuplicate: true }),
    );
    check("allowDuplicate:true override -> 201", override.status === 201, override);
    const overrideId = trackAcct(override);

    // ---- fuzzy near-match (not exact) does NOT block ----
    const fuzzy = await api("POST", "/accounts", acctBody(`${baseName} Petroleum`));
    check("fuzzy near-match -> 201 (never blocks)", fuzzy.status === 201, fuzzy);
    trackAcct(fuzzy);

    // ---- archived duplicates don't count ----
    const toArchive = [firstId, overrideId].filter(Boolean) as string[];
    if (toArchive.length) {
      await db
        .update(atelierAccounts)
        .set({ deletedAt: new Date() } as any)
        .where(inArray(atelierAccounts.id, toArchive));
    }
    const afterArchive = await api("POST", "/accounts", acctBody(`${baseName} Holdings`));
    check("archived duplicate does not block -> 201", afterArchive.status === 201, afterArchive);
    const holdingsLiveId = trackAcct(afterArchive);

    // ---- POST /opportunities create-with-new-account branch ----
    // Exact same name -> silently reuses the existing account (no 409, no new acct).
    const oppReuse = await api("POST", "/opportunities", {
      accountName: `${baseName} Holdings`,
      accountCountry: "AE",
      accountSector: "Logistics",
      name: `Opp reuse ${runTag}`,
      description: "Dup account probe",
      runScout: false,
    });
    check("opp create exact-name -> 201 reuses account", oppReuse.status === 201, oppReuse);
    check(
      "opp create reused existing account id",
      oppReuse.body?.account?.id === holdingsLiveId ||
        oppReuse.body?.opportunity?.accountId === holdingsLiveId,
      { got: oppReuse.body?.account?.id ?? oppReuse.body?.opportunity?.accountId, want: holdingsLiveId },
    );

    // Suffix variant -> structured 409 duplicate-account.
    const oppDup = await api("POST", "/opportunities", {
      accountName: `${baseName} Holdings Ltd`,
      accountCountry: "AE",
      accountSector: "Logistics",
      name: `Opp dup ${runTag}`,
      description: "Dup account probe",
      runScout: false,
    });
    check("opp create suffix-variant account -> 409", oppDup.status === 409, oppDup);
    check(
      "409 body is structured duplicate-account",
      oppDup.body?.error === "duplicate-account" &&
        oppDup.body?.existing?.id === holdingsLiveId &&
        Array.isArray(oppDup.body?.similar) &&
        typeof oppDup.body?.message === "string",
      oppDup.body,
    );

    // Explicit override -> 201 and a NEW account.
    const oppOverride = await api("POST", "/opportunities", {
      accountName: `${baseName} Holdings Ltd`,
      accountCountry: "AE",
      accountSector: "Logistics",
      name: `Opp override ${runTag}`,
      description: "Dup account probe",
      runScout: false,
      allowDuplicateAccount: true,
    });
    check("allowDuplicateAccount:true override -> 201", oppOverride.status === 201, oppOverride);
    const newAcctId =
      oppOverride.body?.account?.id ?? oppOverride.body?.opportunity?.accountId ?? null;
    check(
      "override created a NEW account",
      !!newAcctId && newAcctId !== holdingsLiveId,
      { newAcctId, holdingsLiveId },
    );
    if (newAcctId) createdAccountIds.push(newAcctId);

    // ---- chat/CLI capability: preview + commit guard ----
    const { findByToolName } = await import(
      "../../src/lib/atelier-cli/capability-catalog.js"
    );
    const cap = findByToolName("account_create");
    check("account_create capability registered", !!cap);
    if (cap) {
      const [personaRow] = await db
        .select()
        .from(atelierUsers)
        .where(eq(atelierUsers.id, userId));
      const ctx: any = {
        persona: personaRow,
        locale: "en",
        requestId: `req_${runTag}`,
      };

      // Preview phase: duplicate warning surfaces, pending input carries
      // allowDuplicate:true (confirming the warned card is the override).
      const preview: any = await cap.run(
        { name: `${baseName} Holdings PJSC`, country: "AE", sector: "Logistics" },
        ctx,
      );
      check("chat preview ok:true", preview?.ok === true, preview);
      check(
        "chat preview surfaces duplicate warning",
        !!preview?.data?.duplicateWarning?.exact &&
          typeof preview?.confirmation?.summary === "string" &&
          preview.confirmation.summary.includes("Duplicate"),
        { data: preview?.data, summary: preview?.confirmation?.summary },
      );
      check(
        "chat preview pending input sets allowDuplicate override",
        preview?.confirmation?.pending?.input?.allowDuplicate === true,
        preview?.confirmation?.pending?.input,
      );

      // Commit without the override flag -> rejected with structured error.
      const commitNoFlag: any = await cap.run(
        { name: `${baseName} Holdings PJSC`, country: "AE", sector: "Logistics", confirm: true },
        ctx,
      );
      check("chat commit without flag rejected", commitNoFlag?.ok === false, commitNoFlag);
      check(
        "chat rejection is duplicate_account with existing account",
        // Several legitimate exact-normalized matches exist by this point
        // (the earlier override created "… Holdings Ltd" too), so assert the
        // structured contract rather than a specific winner id.
        commitNoFlag?.errorCode === "duplicate_account" &&
          !!commitNoFlag?.data?.duplicate?.existing?.id &&
          commitNoFlag?.data?.duplicate?.existing?.exact === true &&
          Array.isArray(commitNoFlag?.data?.duplicate?.similar) &&
          commitNoFlag.data.duplicate.similar.some((s: any) => s.id === holdingsLiveId) &&
          typeof commitNoFlag?.errorMessage === "string",
        commitNoFlag,
      );

      // Commit with the override -> succeeds with a new account.
      const commitFlag: any = await cap.run(
        {
          name: `${baseName} Holdings PJSC`,
          country: "AE",
          sector: "Logistics",
          allowDuplicate: true,
          confirm: true,
        },
        ctx,
      );
      check("chat commit with override ok:true", commitFlag?.ok === true, commitFlag);
      const chatAcctId = commitFlag?.data?.id ?? null;
      check(
        "chat override created a NEW account",
        !!chatAcctId && chatAcctId !== holdingsLiveId,
        commitFlag?.data,
      );
      if (chatAcctId) createdAccountIds.push(chatAcctId);
    }
  } finally {
    try {
      const acctRows = await db
        .select({ id: atelierAccounts.id })
        .from(atelierAccounts)
        .where(like(atelierAccounts.name, `${baseName}%`));
      const acctIds = Array.from(
        new Set([...createdAccountIds, ...acctRows.map((r) => r.id)]),
      );
      for (const id of acctIds) {
        await db
          .execute(sql`delete from atelier_audit_events where entity_id = ${id}`)
          .catch(() => undefined);
        const opps = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.accountId, id));
        for (const o of opps) {
          await db
            .execute(sql`delete from atelier_audit_events where entity_id = ${o.id}`)
            .catch(() => undefined);
          await db
            .execute(sql`delete from atelier_agent_runs where target_id = ${o.id}`)
            .catch(() => undefined);
        }
        await db
          .delete(atelierOpportunities)
          .where(eq(atelierOpportunities.accountId, id));
        await db
          .execute(sql`delete from atelier_agent_runs where target_id = ${id}`)
          .catch(() => undefined);
      }
      if (acctIds.length) {
        await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, acctIds));
      }
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
