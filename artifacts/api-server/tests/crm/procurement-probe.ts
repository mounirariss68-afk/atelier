/**
 * Task #722 — Procurement Navigator + procurement section probe (offline).
 *
 * Asserts, with Anthropic + Perplexity stubbed locally:
 *   1. POST /accounts/:id/agents/procurement-navigator/run → 202 immediately;
 *      status polls running → drafted with the structured, cited guide.
 *   2. Duplicate start while running → 409.
 *   3. Approve applies the guide to accounts.procurement (preserving the
 *      human-tracked status/notes), audits agent.approved, and the draft
 *      stops being offered.
 *   4. Dismiss on a fresh draft audits agent.dismissed and clears the draft.
 *   5. PATCH /accounts/:id/procurement edits status/notes, audits
 *      account.procurement_status_updated; invalid status → 400; a later
 *      approve keeps the manual status.
 *   6. ACLs: consultant (non-CREATE role) → 403 on run/approve/patch;
 *      unknown persona → 401/403 by the global gate.
 *   7. Fail-loud: an empty/ungrounded guide from the model marks the run
 *      failed and stores nothing (status → failed, procurement unchanged).
 *   8. Auto-run degrade: POST /accounts (create) returns 201 immediately
 *      even when the research stub is failing — creation never blocks.
 *   9. Workspace payload carries account.procurement.
 *
 * Run: pnpm exec tsx tests/crm/procurement-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const GUIDE_OUTPUT = {
  guide: {
    jurisdiction: "saudi_gov",
    summary:
      "Probe Ministry procures via Etimad; Cognirise must register as a foreign supplier on the Ministry of Finance platform.",
    channel: {
      name: "Etimad",
      type: "government_portal",
      portalUrl: "https://etimad.sa",
    },
    responsibleContact: {
      department: "Supplier Registration — Ministry of Finance",
      title: null,
      email: null,
      phone: null,
      notes: null,
    },
    steps: [
      {
        order: 1,
        title: "Obtain Saudi commercial registration or foreign-supplier eligibility",
        detail: "Register with the Saudi Business Center or use the foreign supplier path.",
        sourceUrls: ["https://etimad.sa/help"],
      },
      {
        order: 2,
        title: "Create the Etimad supplier account",
        detail: "Submit company profile, licence and bank details on etimad.sa.",
        sourceUrls: ["https://etimad.sa"],
      },
    ],
    requiredInformation: ["Legal name", "CR / licence number", "IBAN", "VAT number"],
    requiredDocuments: ["Trade licence", "VAT certificate", "Bank letter"],
    fees: "No registration fee published",
    timeline: "1–2 weeks after document submission",
    renewal: "Annual profile revalidation",
    sources: [{ url: "https://etimad.sa", title: "Etimad — Ministry of Finance" }],
    confidence: "green",
  },
  rationale: "Saudi public-sector entity — Etimad is the mandated channel.",
  confidence: "green",
};

const EMPTY_OUTPUT = {
  guide: {
    jurisdiction: "private_sector",
    summary: "",
    channel: { name: "", type: "other", portalUrl: null },
    steps: [],
    requiredInformation: [],
    requiredDocuments: [],
    sources: [],
    confidence: "red",
  },
  rationale: "",
  confidence: "red",
};

// Mutable stub behaviour.
let synthMode: "guide" | "empty" = "guide";
let perplexityFail = false;
let stubDelayMs = 0;

async function main() {
  // ---- stub Anthropic (SSE) ----
  const anthropicStub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      setTimeout(() => {
        const text = JSON.stringify(synthMode === "guide" ? GUIDE_OUTPUT : EMPTY_OUTPUT);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const ev = (event: string, data: unknown) =>
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        ev("message_start", {
          type: "message_start",
          message: {
            id: "msg_procprobe",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        });
        ev("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        });
        ev("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        });
        ev("content_block_stop", { type: "content_block_stop", index: 0 });
        ev("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 20 },
        });
        ev("message_stop", { type: "message_stop" });
        res.end();
      }, stubDelayMs);
    });
  });
  anthropicStub.listen(0);
  await new Promise<void>((r) => anthropicStub.once("listening", () => r()));
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropicStub.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "procprobe-stub-key";

  // ---- stub Perplexity ----
  const perplexityQueries: string[] = [];
  const perplexityStub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      perplexityQueries.push(body);
      if (perplexityFail) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "stub forced failure" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Etimad is the Saudi government procurement platform.",
              },
            },
          ],
          search_results: [{ title: "Etimad", url: "https://etimad.sa" }],
        }),
      );
    });
  });
  perplexityStub.listen(0);
  await new Promise<void>((r) => perplexityStub.once("listening", () => r()));
  process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${(perplexityStub.address() as AddressInfo).port}`;
  delete process.env.ATELIER_RESEARCH_PROVIDER;
  delete process.env.PDL_API_KEY;

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierAuditEvents } = D;
  const { eq, and, desc } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `procprobe_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const consultantId = `u_${runTag}_c`;
  const acctA = `acct_${runTag}_a`; // happy path run/draft/approve
  const acctB = `acct_${runTag}_b`; // dismiss path
  const acctC = `acct_${runTag}_c`; // fail-loud empty guide

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown, persona = fpId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(persona ? { cookie: `atelier_persona=${persona}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };
  const pollStatus = async (acctId: string, until: (s: any) => boolean, tries = 120) => {
    let s: any = null;
    for (let i = 0; i < tries; i++) {
      const r = await api("GET", `/accounts/${acctId}/agents/procurement-navigator/status`);
      s = r.body;
      if (until(s)) return s;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    return s;
  };

  try {
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Procurement Probe FP",
      initials: "PP",
      email: `${runTag}-fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierUsers).values({
      id: consultantId,
      orgId: "aico",
      name: "Procurement Probe Consultant",
      initials: "PC",
      email: `${runTag}-c@example.test`,
      role: "consultant",
      roleLabel: "Consultant",
      title: "Consultant",
    } as any);
    for (const id of [acctA, acctB, acctC]) {
      await db.insert(atelierAccounts).values({
        id,
        orgId: "aico",
        name: `Probe Ministry ${id}`,
        country: "Saudi Arabia",
        sector: "Government",
        tier: "B",
        partnerOwnerId: fpId,
      } as any);
    }

    // ---- 1–2. run → 202, running, duplicate 409, drafted ----
    stubDelayMs = 1200;
    const t0 = Date.now();
    const start = await api("POST", `/accounts/${acctA}/agents/procurement-navigator/run`, {});
    check("run -> 202 immediately", start.status === 202 && Date.now() - t0 < 1000, start);
    const dup = await api("POST", `/accounts/${acctA}/agents/procurement-navigator/run`, {});
    check("duplicate start -> 409", dup.status === 409, dup);
    const running = await api("GET", `/accounts/${acctA}/agents/procurement-navigator/status`);
    check("status running mid-run", running.body?.status === "running", running.body);
    const drafted = await pollStatus(acctA, (s) => s?.status !== "running");
    check("status settles to drafted", drafted?.status === "drafted", drafted);
    check(
      "draft carries cited Etimad guide",
      drafted?.draft?.guide?.channel?.name === "Etimad" &&
        drafted.draft.guide.jurisdiction === "saudi_gov" &&
        drafted.draft.guide.sources.length >= 1 &&
        drafted.draft.guide.steps.length === 2,
      drafted?.draft?.guide,
    );
    check(
      "jurisdiction-aware retrieval asked about Etimad",
      perplexityQueries.some((q) => q.includes("Etimad")),
    );
    stubDelayMs = 0;

    // ---- 5a. PATCH status BEFORE approve (manual state must survive) ----
    const patch1 = await api("PATCH", `/accounts/${acctA}/procurement`, {
      status: "in_progress",
      statusNotes: "Submitted on Etimad, awaiting approval",
    });
    check(
      "PATCH status -> 200 with payload",
      patch1.status === 200 &&
        patch1.body?.procurement?.status === "in_progress" &&
        patch1.body.procurement.statusNotes === "Submitted on Etimad, awaiting approval",
      patch1,
    );
    const badPatch = await api("PATCH", `/accounts/${acctA}/procurement`, { status: "done" });
    check("invalid status -> 400", badPatch.status === 400, badPatch);

    // ---- 3. approve applies guide, preserves manual status, audits ----
    const approve = await api("POST", `/accounts/${acctA}/agents/procurement-navigator/approve`, {
      runId: drafted.runId,
    });
    check("approve -> 200", approve.status === 200 && approve.body?.ok === true, approve);
    const [rowA] = await db
      .select({ procurement: atelierAccounts.procurement })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctA));
    const pA = rowA?.procurement as any;
    check(
      "guide persisted on account.procurement",
      pA?.guide?.channel?.name === "Etimad" && !!pA?.lastResearchedAt && !!pA?.lastResearchRunId,
      pA,
    );
    check(
      "manual status/notes survive approve",
      pA?.status === "in_progress" &&
        pA?.statusNotes === "Submitted on Etimad, awaiting approval",
      pA,
    );
    const afterApprove = await api(
      "GET",
      `/accounts/${acctA}/agents/procurement-navigator/status`,
    );
    check("draft no longer offered after approve", afterApprove.body?.status === "idle", afterApprove.body);
    const auditsA = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, acctA), eq(atelierAuditEvents.action, "agent.approved")))
      .orderBy(desc(atelierAuditEvents.createdAt));
    check(
      "agent.approved audit written",
      auditsA.some((a) => (a.payload as any)?.agentId === "ag_procurement_navigator"),
      auditsA.map((a) => a.payload),
    );
    const statusAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, acctA),
          eq(atelierAuditEvents.action, "account.procurement_status_updated"),
        ),
      );
    check("procurement status edit audited", statusAudits.length === 1, statusAudits.length);

    // ---- 9. workspace payload carries procurement ----
    const ws = await api("GET", `/accounts/${acctA}`);
    check(
      "workspace payload carries account.procurement",
      ws.body?.account?.procurement?.guide?.channel?.name === "Etimad",
      ws.body?.account?.procurement,
    );

    // ---- 4. dismiss path ----
    const startB = await api("POST", `/accounts/${acctB}/agents/procurement-navigator/run`, {});
    check("run B -> 202", startB.status === 202, startB);
    const draftedB = await pollStatus(acctB, (s) => s?.status !== "running");
    check("B drafted", draftedB?.status === "drafted", draftedB);
    const dismiss = await api("POST", `/accounts/${acctB}/agents/procurement-navigator/dismiss`, {
      runId: draftedB.runId,
      reason: "Not relevant yet",
    });
    check("dismiss -> 200", dismiss.status === 200, dismiss);
    const afterDismiss = await api("GET", `/accounts/${acctB}/agents/procurement-navigator/status`);
    check("draft cleared after dismiss", afterDismiss.body?.status === "idle", afterDismiss.body);
    const [rowB] = await db
      .select({ procurement: atelierAccounts.procurement })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctB));
    check("dismiss stores nothing on the account", rowB?.procurement == null, rowB?.procurement);
    const auditsB = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, acctB), eq(atelierAuditEvents.action, "agent.dismissed")));
    check(
      "agent.dismissed audit written",
      auditsB.some((a) => (a.payload as any)?.agentId === "ag_procurement_navigator"),
      auditsB.map((a) => a.payload),
    );

    // ---- 6. ACLs ----
    const c1 = await api("POST", `/accounts/${acctA}/agents/procurement-navigator/run`, {}, consultantId);
    const c2 = await api("PATCH", `/accounts/${acctA}/procurement`, { status: "registered" }, consultantId);
    const c3 = await api("POST", `/accounts/${acctA}/agents/procurement-navigator/approve`, {}, consultantId);
    check("consultant run -> 403", c1.status === 403, c1);
    check("consultant patch -> 403", c2.status === 403, c2);
    check("consultant approve -> 403", c3.status === 403, c3);
    const anon = await api("GET", `/accounts/${acctA}/agents/procurement-navigator/status`, undefined, "");
    check("anonymous -> 401/403", anon.status === 401 || anon.status === 403, anon.status);

    // ---- 7. fail-loud on empty/ungrounded guide ----
    synthMode = "empty";
    const startC = await api("POST", `/accounts/${acctC}/agents/procurement-navigator/run`, {});
    check("run C -> 202", startC.status === 202, startC);
    const failedC = await pollStatus(acctC, (s) => s?.status !== "running");
    check("empty guide marks run failed", failedC?.status === "failed", failedC);
    check(
      "failure explains the ungrounded guide",
      String(failedC?.phase ?? "").includes("empty or ungrounded"),
      failedC?.phase,
    );
    const [rowC] = await db
      .select({ procurement: atelierAccounts.procurement })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctC));
    check("nothing stored on failed run", rowC?.procurement == null, rowC?.procurement);
    synthMode = "guide";

    // ---- 8. auto-run degrade: create never blocks ----
    perplexityFail = true;
    const t1 = Date.now();
    const created = await api("POST", `/accounts`, {
      name: `Degrade Probe Co ${runTag}`,
      country: "United Arab Emirates",
      sector: "Technology",
      tier: "C",
      status: "active",
      primaryCurrency: "AED",
      primaryLanguage: "en",
    });
    const createMs = Date.now() - t1;
    check("create -> 201 despite failing research", created.status === 201, created);
    check("create returns promptly (<15s)", createMs < 15_000, `${createMs}ms`);
    const newId = created.body?.id;
    if (newId) {
      const degraded = await pollStatus(newId, (s) => s?.status === "failed" || s?.status === "drafted");
      check(
        "auto-run degrades to failed (not stuck running)",
        degraded?.status === "failed" || degraded?.status === "drafted",
        degraded,
      );
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, newId));
    }
    perplexityFail = false;
  } finally {
    // cleanup — tag sweep
    const { like, or } = await import("drizzle-orm");
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `%${runTag}%`));
    await db.delete(atelierAccounts).where(like(atelierAccounts.id, `%${runTag}%`));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `%${runTag}%`));
    server.close();
    anthropicStub.close();
    perplexityStub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
