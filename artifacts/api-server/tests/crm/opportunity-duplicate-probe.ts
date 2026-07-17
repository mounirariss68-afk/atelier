/**
 * Task #30 — duplicate-opportunity guard probe.
 *
 * Covers:
 *   - REST: exact normalized-name match on the same account -> structured 409
 *     ({error:"duplicate-opportunity", existing{id,name,salesStage}, similar})
 *   - REST: allowDuplicate:true override -> 201
 *   - REST: case/whitespace-normalized match still 409
 *   - REST: archived (deletedAt set) duplicates do NOT block
 *   - REST: fuzzy near-match does NOT block (201)
 *   - Chat/CLI: opportunity_create preview surfaces duplicateWarning and
 *     pre-sets allowDuplicate on the pending input; commit without the flag
 *     is rejected ok:false errorCode:"duplicate_opportunity".
 *
 * Deterministic: runScout:false everywhere; no LLM calls.
 * Run: pnpm exec tsx tests/crm/opportunity-duplicate-probe.ts
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
  const { eq, sql, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe30_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctId = `acct_${runTag}`;
  const createdOppIds: string[] = [];

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
  const track = (r: { status: number; body: any }) => {
    const id = r.body?.opportunity?.id ?? null;
    if (id) createdOppIds.push(id);
    return id;
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe Thirty",
      initials: "PT",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Dup Probe Co ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      partnerOwnerId: userId,
    } as any);

    // ---- seed the original opportunity ----
    const first = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "Digital Transformation Program",
      description: "Dup probe opportunity",
      runScout: false,
    });
    check("original create -> 201", first.status === 201, first);
    const firstId = track(first);
    check("original id present", !!firstId, first.body);

    // ---- exact duplicate blocked with structured 409 ----
    const dup = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "Digital Transformation Program",
      description: "Dup probe opportunity",
      runScout: false,
    });
    check("exact duplicate -> 409", dup.status === 409, dup);
    check(
      "409 body is structured duplicate-opportunity",
      dup.body?.error === "duplicate-opportunity" &&
        dup.body?.existing?.id === firstId &&
        dup.body?.existing?.name === "Digital Transformation Program" &&
        "salesStage" in (dup.body?.existing ?? {}) &&
        Array.isArray(dup.body?.similar) &&
        typeof dup.body?.message === "string",
      dup.body,
    );

    // ---- case/whitespace normalization still blocks ----
    const dupNorm = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "  digital   TRANSFORMATION program ",
      description: "Dup probe opportunity",
      runScout: false,
    });
    check("normalized (case/space) duplicate -> 409", dupNorm.status === 409, dupNorm);
    if (dupNorm.status === 201) track(dupNorm);

    // ---- explicit override creates anyway ----
    const override = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "Digital Transformation Program",
      description: "Dup probe opportunity",
      runScout: false,
      allowDuplicate: true,
    });
    check("allowDuplicate:true override -> 201", override.status === 201, override);
    const overrideId = track(override);

    // ---- fuzzy near-match warns but does NOT block ----
    const fuzzy = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "Digital Transformation Programme 2027",
      description: "Dup probe opportunity",
      runScout: false,
    });
    check("fuzzy near-match -> 201 (never blocks)", fuzzy.status === 201, fuzzy);
    track(fuzzy);

    // ---- archived duplicates don't count ----
    // Archive every open copy of the exact name, then re-create.
    const toArchive = [firstId, overrideId].filter(Boolean) as string[];
    if (toArchive.length) {
      await db
        .update(atelierOpportunities)
        .set({ deletedAt: new Date() } as any)
        .where(inArray(atelierOpportunities.id, toArchive));
    }
    const afterArchive = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "Digital Transformation Program",
      description: "Dup probe opportunity",
      runScout: false,
    });
    check(
      "archived duplicate does not block -> 201",
      afterArchive.status === 201,
      afterArchive,
    );
    track(afterArchive);

    // ---- chat/CLI capability: preview + commit guard ----
    const { findByToolName } = await import(
      "../../src/lib/atelier-cli/capability-catalog.js"
    );
    const cap = findByToolName("opportunity_create");
    check("opportunity_create capability registered", !!cap);
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

      // Preview phase (no confirm): duplicate warning surfaces, pending
      // input carries allowDuplicate:true (confirming the warned card is
      // the explicit override).
      const preview: any = await cap.run(
        { name: "digital transformation program", accountId: acctId, runScout: false },
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
        {
          name: "digital transformation program",
          accountId: acctId,
          description: "Dup probe opportunity",
      runScout: false,
          confirm: true,
        },
        ctx,
      );
      check("chat commit without flag rejected", commitNoFlag?.ok === false, commitNoFlag);
      check(
        "chat rejection is duplicate_opportunity with existing deal",
        commitNoFlag?.errorCode === "duplicate_opportunity" &&
          !!commitNoFlag?.data?.duplicate?.existing?.id &&
          typeof commitNoFlag?.errorMessage === "string",
        commitNoFlag,
      );

      // Commit with the override -> succeeds.
      const commitFlag: any = await cap.run(
        {
          name: "digital transformation program",
          accountId: acctId,
          description: "Dup probe opportunity",
      runScout: false,
          allowDuplicate: true,
          confirm: true,
        },
        ctx,
      );
      check("chat commit with override ok:true", commitFlag?.ok === true, commitFlag);
      const chatOppId =
        commitFlag?.data?.opportunityId ?? commitFlag?.data?.opportunity?.id ?? null;
      if (chatOppId) createdOppIds.push(chatOppId);
    }
  } finally {
    try {
      await db
        .execute(sql`delete from atelier_audit_events where entity_id = ${acctId}`)
        .catch(() => undefined);
      const opps = await db
        .select({ id: atelierOpportunities.id })
        .from(atelierOpportunities)
        .where(eq(atelierOpportunities.accountId, acctId));
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
        .where(eq(atelierOpportunities.accountId, acctId));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
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
