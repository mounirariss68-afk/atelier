/**
 * Task #867 — opportunity-creation parity + validation probe.
 *
 * Covers:
 *   - REST: invalid body -> 400 with field-level `fields` map (names the field)
 *   - REST: punctuation-only name never produces an empty slug; runScout:false
 *     surfaces scout.status "skipped" in the 201 response
 *   - Chat/CLI: proposal phase lists "description" as missing (web parity)
 *   - Chat/CLI: commit without description rejected
 *   - Chat/CLI: commit persists description as offeringAnchor, deal-size
 *     default 250000, salesStage derived (prospect at 25%), non-empty slug
 *
 * Deterministic: runScout:false everywhere; no LLM calls.
 * Run: pnpm exec tsx tests/crm/opp-create-parity-probe.ts
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
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities } = D;
  const { eq, sql, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe867_${Date.now()}`;
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

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe EightSixSeven",
      initials: "PE",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Parity Probe Co ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      partnerOwnerId: userId,
    } as any);

    // ---- REST: missing description -> 400 naming the field ----
    const noDesc = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "Missing Description Deal",
      runScout: false,
    });
    check("REST missing description -> 400", noDesc.status === 400, noDesc);
    check(
      "400 body carries field-level messages",
      noDesc.body?.error === "invalid-body" &&
        typeof noDesc.body?.fields?.description === "string" &&
        typeof noDesc.body?.message === "string" &&
        noDesc.body.message.includes("description"),
      noDesc.body,
    );

    // ---- REST: punctuation-only name -> non-empty slug, scout skipped ----
    const punct = await api("POST", "/opportunities", {
      accountId: acctId,
      name: "!!! *** !!!",
      description: "Punctuation-name probe",
      runScout: false,
    });
    check("REST punctuation-only name -> 201", punct.status === 201, punct);
    const punctId = punct.body?.opportunity?.id as string | undefined;
    if (punctId) createdOppIds.push(punctId);
    if (punctId) {
      const [row] = await db
        .select({ slug: atelierOpportunities.slug })
        .from(atelierOpportunities)
        .where(eq(atelierOpportunities.id, punctId));
      check(
        "REST slug non-empty for punctuation-only name",
        typeof row?.slug === "string" && row.slug.length > 0,
        row,
      );
      check(
        "REST opp id has no empty slug segment (no 'opp__')",
        !punctId.startsWith("opp__"),
        punctId,
      );
    }
    check(
      "REST runScout:false -> scout.status 'skipped'",
      punct.body?.scout?.status === "skipped",
      punct.body?.scout,
    );

    // ---- chat/CLI capability ----
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

      // Proposal phase without description -> listed as missing (web parity).
      const preview: any = await cap.run(
        { name: `Chat Parity Deal ${runTag}`, accountId: acctId, runScout: false },
        ctx,
      );
      check("chat proposal ok:true", preview?.ok === true, preview);
      check(
        "chat proposal lists description as missing",
        Array.isArray(preview?.data?.missingFields) &&
          preview.data.missingFields.includes("description"),
        preview?.data?.missingFields,
      );

      // Commit without description -> rejected.
      const commitNoDesc: any = await cap.run(
        {
          name: `Chat Parity Deal ${runTag}`,
          accountId: acctId,
          runScout: false,
          confirm: true,
        },
        ctx,
      );
      check(
        "chat commit without description rejected",
        commitNoDesc?.ok === false &&
          String(commitNoDesc?.errorMessage ?? "").includes("description"),
        commitNoDesc,
      );

      // Commit with description + punctuation-only name -> REST-parity row.
      const commit: any = await cap.run(
        {
          name: "??? ### ???",
          accountId: acctId,
          description: "Chat parity probe description",
          runScout: false,
          confirm: true,
        },
        ctx,
      );
      check("chat commit ok:true", commit?.ok === true, commit);
      const chatOppId = commit?.data?.id as string | undefined;
      if (chatOppId) createdOppIds.push(chatOppId);
      if (chatOppId) {
        const [row] = await db
          .select({
            slug: atelierOpportunities.slug,
            offeringAnchor: atelierOpportunities.offeringAnchor,
            dealSizeHypothesis: atelierOpportunities.dealSizeHypothesis,
            probabilityPct: atelierOpportunities.probabilityPct,
            salesStage: atelierOpportunities.salesStage,
          })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.id, chatOppId));
        check(
          "chat slug non-empty for punctuation-only name",
          typeof row?.slug === "string" && row.slug.length > 0,
          row,
        );
        check(
          "chat description persisted as offeringAnchor",
          row?.offeringAnchor === "Chat parity probe description",
          row,
        );
        check(
          "chat deal-size default = 250000 (REST parity)",
          Number(row?.dealSizeHypothesis) === 250000,
          row,
        );
        check(
          "chat stage derived from probability (25% -> prospect)",
          Number(row?.probabilityPct) === 25 && row?.salesStage === "prospect",
          row,
        );
      }
      check(
        "chat commit surfaces scout.status 'skipped'",
        commit?.data?.scout?.status === "skipped",
        commit?.data?.scout,
      );
    }
  } finally {
    try {
      if (createdOppIds.length) {
        await db
          .execute(
            sql`delete from atelier_audit_events where entity_id in (${sql.join(
              createdOppIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
          .catch(() => undefined);
        await db
          .delete(atelierOpportunities)
          .where(inArray(atelierOpportunities.id, createdOppIds));
      }
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    } catch (err) {
      console.warn("cleanup failed", err);
    }
    server.close();
    await pool.end().catch(() => undefined);
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(1);
});
