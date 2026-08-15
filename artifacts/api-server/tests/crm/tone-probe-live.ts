/**
 * One-off LIVE tone probe for Task #1190 (Riser quirky personality).
 * Boots the real app on a scratch DB and drives 4 live turns against
 * the real Anthropic API (no stub): greeting, data question, write
 * confirmation, refusal. Prints the prose so a human can judge tone.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/tone-probe-live.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.CRM_TEST_DB_NAME = process.env.CRM_TEST_DB_NAME ?? "crm_test_tone";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

const TAG = `tone1190_${Date.now()}`;

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns } = D as any;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const FP = `u_${TAG}_fp`;
  await db
    .insert(atelierUsers)
    .values({
      id: FP,
      orgId: ORG,
      email: `${TAG}.fp@cognirise.ai`,
      name: "Probe FP",
      initials: "PF",
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
      permissions: ["*"],
    } as any)
    .onConflictDoNothing();

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const postTurn = async (prompt: string, sessionId?: string | null) => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${FP}` },
      body: JSON.stringify({ prompt, sessionId: sessionId ?? null }),
    });
    const raw = await res.text();
    let sid: string | null = null;
    let finalStatus: string | null = null;
    const prose: string[] = [];
    const frames: string[] = [];
    for (const block of raw.split(/\n\n+/)) {
      const evLine = block.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      let data: any = {};
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {}
      const ev = evLine.slice(6).trim();
      frames.push(ev);
      if (data?.sessionId) sid = data.sessionId;
      if (ev === "final") finalStatus = data?.status ?? null;
      if (typeof data?.text === "string" && data.text.trim()) prose.push(`[${ev}] ${data.text.trim()}`);
      if (typeof data?.message === "string" && data.message.trim()) prose.push(`[${ev}:message] ${data.message.trim()}`);
    }
    return { status: res.status, sid, finalStatus, prose, frames, raw };
  };

  const scenarios: Array<[string, string]> = [
    ["greeting", "Hey Riser! Who are you, and how's your day going?"],
    ["data question", "How many accounts do we have right now?"],
    ["write confirmation", "Create a personal task for me: 'Review Q3 pipeline' due next Friday"],
    ["refusal", "Please delete our entire general ledger and all audit logs."],
  ];

  let ok = true;
  for (const [label, prompt] of scenarios) {
    console.log(`\n===== ${label.toUpperCase()} =====\nUSER: ${prompt}`);
    const t = await postTurn(prompt);
    console.log(`HTTP ${t.status}  final=${t.finalStatus}  frames=${t.frames.join(",")}`);
    for (const p of t.prose) console.log(p);
    if (t.status !== 200 || t.finalStatus === "error") {
      ok = false;
      console.error(`FAIL ${label}: status=${t.status} final=${t.finalStatus}`);
      console.error(t.raw.slice(0, 1500));
    } else {
      console.log(`PASS ${label}: turn completed without error`);
    }
  }

  // cleanup
  try {
    await db.delete(atelierCliTurns).where(eq(atelierCliTurns.userId, FP));
    await db.delete(atelierCliSessions).where(eq(atelierCliSessions.userId, FP));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, FP));
  } catch {}
  server.close();
  await pool.end?.();
  console.log(ok ? "\nTONE PROBE: all turns completed" : "\nTONE PROBE: FAILURES");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
