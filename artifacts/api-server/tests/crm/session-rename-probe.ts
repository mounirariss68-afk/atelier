/**
 * Task #485 — chat session rename probe.
 *
 * Covers:
 *   - PATCH /cli/sessions/:id renames the owner's session -> 200 + audit row
 *   - Whitespace normalization + trim; 60-char cap -> 400
 *   - Empty / missing title -> 400
 *   - Another user's session -> 404 (scope, not a leak)
 *   - Soft-deleted session -> 404
 *   - Manual title survives the auto-title guard (UPDATE ... WHERE title IS NULL)
 *
 * Run: pnpm exec tsx tests/crm/session-rename-probe.ts
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
  const { db, pool, atelierUsers, atelierCliSessions, atelierAuditEvents } = D;
  const { and, eq, isNull, like, sql } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe485_${Date.now()}`;
  const ownerId = `u_${runTag}_a`;
  const otherId = `u_${runTag}_b`;
  const sessId = `sess_${runTag}_1`;
  const delSessId = `sess_${runTag}_del`;

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
        name: "Probe485 Owner",
        initials: "PO",
        email: `${runTag}_a@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: otherId,
        orgId: "aico",
        name: "Probe485 Other",
        initials: "PT",
        email: `${runTag}_b@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
    ]);
    await db.insert(atelierCliSessions).values([
      { id: sessId, orgId: "aico", userId: ownerId, title: null },
      {
        id: delSessId,
        orgId: "aico",
        userId: ownerId,
        title: "old",
        deletedAt: new Date(),
      },
    ] as any);

    // Happy path — trims + collapses whitespace.
    let r = await api(ownerId, "PATCH", `/cli/sessions/${sessId}`, {
      title: "  Q3   pipeline review  ",
    });
    check("rename 200", r.status === 200, r);
    check("normalized title", r.body?.session?.title === "Q3 pipeline review", r.body);

    const [row] = await db
      .select()
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, sessId));
    check("db title persisted", row?.title === "Q3 pipeline review", row?.title);

    // Audit row written.
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, sessId),
          eq(atelierAuditEvents.action, "cli.session.renamed"),
        ),
      );
    check("audit row written", audits.length === 1, audits.length);
    check(
      "audit payload from/to",
      (audits[0]?.payload as any)?.to === "Q3 pipeline review" &&
        (audits[0]?.payload as any)?.from === null,
      audits[0]?.payload,
    );

    // Validation failures.
    r = await api(ownerId, "PATCH", `/cli/sessions/${sessId}`, { title: "   " });
    check("empty title 400", r.status === 400, r);
    r = await api(ownerId, "PATCH", `/cli/sessions/${sessId}`, {});
    check("missing title 400", r.status === 400, r);
    r = await api(ownerId, "PATCH", `/cli/sessions/${sessId}`, {
      title: "x".repeat(61),
    });
    check("too-long title 400", r.status === 400 && r.body?.error === "title-too-long", r);

    // Scope: other user's session -> 404.
    r = await api(otherId, "PATCH", `/cli/sessions/${sessId}`, { title: "hijack" });
    check("other user 404", r.status === 404, r);
    const [row2] = await db
      .select()
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, sessId));
    check("title unchanged after 404", row2?.title === "Q3 pipeline review", row2?.title);

    // Soft-deleted session -> 404.
    r = await api(ownerId, "PATCH", `/cli/sessions/${delSessId}`, { title: "revive" });
    check("deleted session 404", r.status === 404, r);

    // Auto-title guard: the auto-title job's UPDATE is guarded on
    // title IS NULL — simulate it and assert the manual title survives.
    await db
      .update(atelierCliSessions)
      .set({ title: "Auto Title" })
      .where(and(eq(atelierCliSessions.id, sessId), isNull(atelierCliSessions.title)));
    const [row3] = await db
      .select()
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, sessId));
    check("auto-title cannot overwrite", row3?.title === "Q3 pipeline review", row3?.title);
  } finally {
    // Cleanup — tracked rows + tag sweep.
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `sess_${runTag}%`));
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
