/**
 * Clarification durability probe.
 *
 * Pins the rehydration surfaces added after clarification questions were
 * observed to vanish on page reload / server restart:
 *   1. GET /cli/turns/pending-clarification returns the question when the
 *      persona's most recent turn is awaiting_clarification.
 *   2. It returns null when a newer turn supersedes the question.
 *   3. It returns null for a persona with no turns.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/pending-clarification-probe.ts
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
  const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns } = D as any;
  const { like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probepc_${Date.now()}`;
  const userId = `u_${runTag}`;
  const sessId = `clis_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

  const get = async (path: string, who: string = userId) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: `atelier_persona=${who}` },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      email: `${runTag}@test.local`,
      name: `Probe ${runTag}`,
      initials: "PB",
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Probe",
    });
    await db.insert(atelierCliSessions).values({
      id: sessId,
      orgId: "aico",
      userId,
      title: runTag,
    });
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_1`,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "awaiting_clarification",
      prompt: "create new account masdar (probe)",
      frames: [
        { type: "narration", data: { text: "researching" } },
        {
          type: "needs_clarification",
          data: {
            step: 0,
            tool: "prefill_from_specialist",
            field: "entityRole",
            question: "HQ or branch?",
            partial: { kind: "account" },
            suggestions: [{ id: "hq", label: "Global headquarters" }],
          },
        },
      ],
    });

    const r1 = await get("/cli/turns/pending-clarification");
    check("returns pending question", r1.status === 200 && r1.json?.pending?.turnId === `clit_${runTag}_1`, r1);
    check(
      "clarification payload intact",
      r1.json?.pending?.clarification?.field === "entityRole" &&
        r1.json?.pending?.clarification?.question === "HQ or branch?" &&
        r1.json?.pending?.clarification?.suggestions?.[0]?.label === "Global headquarters" &&
        r1.json?.pending?.sessionId === sessId,
      r1.json,
    );

    // Newer completed turn supersedes the question.
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_2`,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "success",
      prompt: "something else",
      frames: [],
      createdAt: new Date(Date.now() + 1000),
    });
    const r2 = await get("/cli/turns/pending-clarification");
    check("superseded → null", r2.status === 200 && r2.json?.pending === null, r2.json);

    const r3 = await get("/cli/turns/pending-clarification", "u_no_such_user");
    check("unknown persona rejected", r3.status === 401 || r3.json?.pending === null, r3);
  } finally {
    await db.delete(atelierCliTurns).where(like(atelierCliTurns.id, `clit_${runTag}%`));
    await db.delete(atelierCliSessions).where(like(atelierCliSessions.id, sessId));
    await db.delete(atelierUsers).where(like(atelierUsers.id, userId));
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
