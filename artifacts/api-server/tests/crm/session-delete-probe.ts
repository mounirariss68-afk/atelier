/**
 * Task #490 — chat session delete probe.
 *
 * Covers:
 *   - DELETE /cli/sessions/:id soft-deletes (deletedAt set) -> 200 + audit row
 *   - Deleted session disappears from GET /cli/sessions
 *   - awaiting_clarification turn in the deleted session is cancelled, so
 *     GET /cli/turns/pending-clarification no longer returns it
 *   - Another user's session -> 404 (scope, not a leak)
 *   - Repeat delete -> 404 (already deleted)
 *
 * Run: pnpm exec tsx tests/crm/session-delete-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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
  const {
    db,
    pool,
    atelierUsers,
    atelierCliSessions,
    atelierCliTurns,
    atelierAuditEvents,
  } = D;
  const { and, eq, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe490_${Date.now()}`;
  const ownerId = `u_${runTag}_a`;
  const otherId = `u_${runTag}_b`;
  const sessId = `sess_${runTag}_1`;
  const keepSessId = `sess_${runTag}_keep`;
  const turnId = `turn_${runTag}_1`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${who}`,
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
    await db.insert(atelierUsers).values([
      {
        id: ownerId,
        orgId: "aico",
        name: "Probe490 Owner",
        initials: "PO",
        email: `${runTag}_a@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: otherId,
        orgId: "aico",
        name: "Probe490 Other",
        initials: "PT",
        email: `${runTag}_b@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
    ]);
    await db.insert(atelierCliSessions).values([
      { id: sessId, orgId: "aico", userId: ownerId, title: "Doomed chat", lastTurnAt: new Date() },
      { id: keepSessId, orgId: "aico", userId: ownerId, title: "Keeper", lastTurnAt: new Date() },
    ] as any);
    // A paused clarification turn inside the doomed session.
    await db.insert(atelierCliTurns).values({
      id: turnId,
      orgId: "aico",
      sessionId: sessId,
      userId: ownerId,
      prompt: "add an expense",
      status: "awaiting_clarification",
      frames: [
        {
          type: "needs_clarification",
          data: { field: "amount", question: "How much?", tool: "wallet_create_expense" },
        },
      ],
    } as any);

    // Pending clarification is visible before the delete.
    let r = await api(ownerId, "GET", "/cli/turns/pending-clarification");
    check("pending visible before delete", r.body?.pending?.turnId === turnId || r.body?.pending?.id === turnId || !!r.body?.pending, r.body);

    // Scope: other user cannot delete.
    r = await api(otherId, "DELETE", `/cli/sessions/${sessId}`);
    check("other user 404", r.status === 404, r);

    // Owner deletes -> 200.
    r = await api(ownerId, "DELETE", `/cli/sessions/${sessId}`);
    check("delete 200", r.status === 200 && r.body?.ok === true, r);

    const [row] = await db
      .select()
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, sessId));
    check("deletedAt set", row?.deletedAt instanceof Date, row?.deletedAt);

    // List no longer contains the deleted session (keeper remains).
    r = await api(ownerId, "GET", "/cli/sessions");
    const ids = (r.body?.sessions ?? []).map((s: any) => s.id);
    check("list hides deleted", !ids.includes(sessId) && ids.includes(keepSessId), ids);

    // Clarification turn cancelled + pending lookup empty.
    const [turnRow] = await db
      .select()
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, turnId));
    check("clarification turn cancelled", turnRow?.status === "cancelled", turnRow?.status);
    r = await api(ownerId, "GET", "/cli/turns/pending-clarification");
    check("pending gone after delete", r.body?.pending === null, r.body);

    // Audit row written.
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, sessId),
          eq(atelierAuditEvents.action, "cli.session.deleted"),
        ),
      );
    check("audit row written", audits.length === 1, audits.length);
    check(
      "audit payload title",
      (audits[0]?.payload as any)?.title === "Doomed chat",
      audits[0]?.payload,
    );

    // Repeat delete -> 404.
    r = await api(ownerId, "DELETE", `/cli/sessions/${sessId}`);
    check("repeat delete 404", r.status === 404, r);
  } finally {
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `sess_${runTag}%`));
    await db.delete(atelierCliTurns).where(like(atelierCliTurns.id, `turn_${runTag}%`));
    await db.delete(atelierCliSessions).where(like(atelierCliSessions.id, `sess_${runTag}%`));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `u_${runTag}%`));
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(1);
});
