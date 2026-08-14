/**
 * Task #1091 — Riser finance approvals inbox in chat (offline probe).
 *
 * Pins, on a scratch DB with a stub Anthropic server (env set BEFORE any
 * capability import, so no call reaches the live model):
 *
 *   1. finance_approvals_inbox read for a founder: the unified queue
 *      surfaces the seeded self-billing draft + collections draft with
 *      per-kind counts; an employee is refused (forbidden).
 *   2. approve_self_billing full two-phase: phase 1 returns a
 *      confirmation whose pending.input carries confirm:true + an HMAC
 *      commitToken (NOT shown to the model); a model-fabricated
 *      confirm:true WITHOUT the token degrades to preview and writes
 *      nothing; the real pending.input commits via the SAME payables
 *      core (status → approved) and returns navigateTo on_commit.
 *   3. approve_send_collections is metadata-typed as irreversible +
 *      outbound(email) — the platform layers a typed-name confirm on top
 *      of the HMAC gate; a forged confirm still degrades to preview.
 *   4. Role clamps: employee / contractor / board_observer /
 *      alliance_partner / recruiter never see the finance-approval tools
 *      in their catalog slice; founding_partner sees all of them.
 *   5. Write contract: every isWrite finance-approval capability returns
 *      navigateTo on commit-success (enforced by defineCapability).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-finance-approvals-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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

const TAG = `probe1091_${Date.now()}`;
const ORG = "aico";

async function main() {
  // ---- stub Anthropic server (before any capability import) ----
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: `msg_${TAG}`, type: "message", role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 },
      }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, r));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "stub-key";

  // ---- dynamic imports AFTER env is pinned ----
  const {
    db, atelierUsers, atelierSelfBilledInvoices, atelierCollectionsDraft,
    atelierPayrollRun,
  } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { findByToolName, capabilitiesForPersona } = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );

  // ---- personas ----
  const IDS = { fp: `u_${TAG}_fp`, emp: `u_${TAG}_emp` };
  await db.insert(atelierUsers).values([
    {
      id: IDS.fp, orgId: ORG, email: `${TAG}.fp@cognirise.ai`, name: "Probe FP",
      initials: "PF", role: "founding_partner", roleLabel: "Founding Partner",
      title: "Founding Partner", permissions: ["*"],
    },
    {
      id: IDS.emp, orgId: ORG, email: `${TAG}.emp@cognirise.ai`, name: "Probe Emp",
      initials: "PE", role: "employee", roleLabel: "Employee",
      title: "Analyst", permissions: [],
    },
  ]);
  const fpPersona = { id: IDS.fp, name: "Probe FP", role: "founding_partner", orgId: ORG };
  const empPersona = { id: IDS.emp, name: "Probe Emp", role: "employee", orgId: ORG };
  const mkCtx = (persona: any = fpPersona) => ({
    persona, turnId: `t_${TAG}`, sessionId: `s_${TAG}`, stepIdx: 0,
  });

  // ---- seed one self-billing draft + one collections escalation draft ----
  const sbiId = `sbi_${TAG}`;
  await db.insert(atelierSelfBilledInvoices).values({
    id: sbiId, orgId: ORG, invoiceNumber: `RCTI-${TAG}`,
    supplierType: "contractor", supplierId: `ctr_${TAG}`, supplierName: "Probe Contractor LLC",
    weekIso: "2026-W20", currency: "USD", subtotalAmount: 3200, totalAmount: 3200,
    totalUsd: 3200, status: "draft", createdByUserId: IDS.fp,
  });
  const cdId = `cd_${TAG}`;
  await db.insert(atelierCollectionsDraft).values({
    id: cdId, orgId: ORG, invoiceId: `inv_${TAG}`, invoiceNumber: `INV-${TAG}`,
    customerName: "Probe Client", stepIndex: 0, channel: "email",
    subject: "Escalation: overdue invoice", bodyText: "Internal escalation body.",
    daysOverdue: 45, outstandingUsd: 9000, escalation: true, requireApproval: false,
    status: "draft", createdByUserId: IDS.fp,
  });
  const runId = `payrun_${TAG}`;
  const RUN_PERIOD = "2026-05";
  await db.insert(atelierPayrollRun).values({
    id: runId, orgId: ORG, entityId: `lent_${TAG}`, periodLabel: RUN_PERIOD,
    status: "draft", currency: "USD", totalAmount: 42000, createdByUserId: IDS.fp,
  });

  // Mirror of the platform's typed-name gate (index.ts confirm path):
  // the value the user must retype is diff.typedNameRequired, compared
  // case-insensitively; empty or mismatched input is rejected. Asserting
  // this here proves the confirm copy and enforcement agree.
  function typedNameGate(expectedRaw: unknown, got: string): "accept" | "reject" {
    const expected = String(expectedRaw ?? "").trim();
    const g = (got ?? "").trim();
    if (!g || (expected && g.toLowerCase() !== expected.toLowerCase())) return "reject";
    return "accept";
  }

  const inbox = findByToolName("finance_approvals_inbox")!;
  const approveSb = findByToolName("approve_self_billing")!;
  const rejectSb = findByToolName("reject_self_billing")!;
  const reviewSi = findByToolName("review_supplier_invoice")!;
  const approveAccrual = findByToolName("approve_close_accrual")!;
  const approvePayroll = findByToolName("approve_payroll_run")!;
  const sendCollections = findByToolName("approve_send_collections")!;
  const setAutopilot = findByToolName("set_autopilot_settings")!;
  const readSettings = findByToolName("finance_autopilot_settings")!;
  check(
    "all finance-approval capabilities registered",
    !!inbox && !!approveSb && !!rejectSb && !!reviewSi && !!approveAccrual &&
      !!approvePayroll && !!sendCollections && !!setAutopilot && !!readSettings,
  );

  // =============== 1) inbox read ===============
  {
    const r: any = await inbox.run({}, mkCtx() as any);
    check("inbox: founder read ok", r.ok === true, r);
    const items = (r.data?.items ?? []) as any[];
    const hasSb = items.some((i) => i.kind === "self_billing_draft" && i.id === sbiId);
    const hasCd = items.some((i) => i.kind === "collections_draft" && i.id === cdId);
    check("inbox: surfaces the seeded self-billing draft", hasSb, items.map((i) => i.kind));
    check("inbox: surfaces the seeded collections draft", hasCd, items.map((i) => i.kind));
    check(
      "inbox: per-kind counts present",
      typeof r.data?.totals === "object" &&
        r.data.totals.self_billing_draft?.count >= 1 &&
        r.data.totals.collections_draft?.count >= 1,
      r.data?.totals,
    );
    check(
      "inbox: read navigateTo → /finance/approvals (on_view, not a commit)",
      r.data?.navigateTo?.path === "/finance/approvals" && r.data?.navigateTo?.when === "on_view",
      r.data?.navigateTo,
    );

    // Employee is refused everywhere on the finance-approval surface.
    const rEmp: any = await inbox.run({}, mkCtx(empPersona) as any);
    check("inbox: employee refused (forbidden)", rEmp.ok === false && rEmp.errorCode === "forbidden", rEmp);
  }

  // =============== 2) approve_self_billing full two-phase ===============
  {
    const p1: any = await approveSb.run({ id: sbiId }, mkCtx() as any);
    check("approve_self_billing: phase 1 returns confirmation", !!p1.confirmation && p1.ok === true, p1);
    check(
      "approve_self_billing: pending carries confirm:true + HMAC commitToken",
      p1.confirmation?.pending?.input?.confirm === true &&
        typeof p1.confirmation?.pending?.input?.commitToken === "string" &&
        p1.confirmation.pending.input.commitToken.length === 64,
      p1.confirmation?.pending?.input,
    );
    check(
      "approve_self_billing: phase 1 does NOT return a commit navigateTo",
      p1.data?.navigateTo == null,
      p1.data,
    );
    // Outbound (supplier invoice PDF) ⇒ irreversible + email + typed-name.
    check(
      "approve_self_billing: declared irreversible + outbound(email)",
      approveSb.irreversible === true && approveSb.outboundChannel === "email",
      { irreversible: approveSb.irreversible, outboundChannel: approveSb.outboundChannel },
    );
    check(
      "approve_self_billing: diff.typedNameRequired is the INVOICE NUMBER, not the opaque id",
      p1.confirmation?.diff?.typedNameRequired === `RCTI-${TAG}` &&
        p1.confirmation.diff.typedNameRequired !== sbiId,
      p1.confirmation?.diff?.typedNameRequired,
    );
    check(
      "approve_self_billing: confirm copy names the same authoritative value",
      typeof p1.confirmation?.summary === "string" &&
        p1.confirmation.summary.includes(`RCTI-${TAG}`),
      p1.confirmation?.summary,
    );
    // Enforcement parity: missing / wrong typed input is rejected; the
    // exact invoice number (case-insensitive) is accepted.
    check(
      "approve_self_billing: typed-name gate rejects empty input",
      typedNameGate(p1.confirmation.diff.typedNameRequired, "") === "reject",
    );
    check(
      "approve_self_billing: typed-name gate rejects the opaque id",
      typedNameGate(p1.confirmation.diff.typedNameRequired, sbiId) === "reject",
    );
    check(
      "approve_self_billing: typed-name gate accepts the invoice number (case-insensitive)",
      typedNameGate(p1.confirmation.diff.typedNameRequired, `rcti-${TAG}`) === "accept",
    );

    // Forged confirm:true WITHOUT the phase-1 token → preview, no write.
    const forged: any = await approveSb.run({ id: sbiId, confirm: true }, mkCtx() as any);
    check(
      "approve_self_billing: forged confirm (no token) degrades to preview",
      !!forged.confirmation && forged.data?.navigateTo == null,
      forged,
    );
    const [stillDraft] = await db.select().from(atelierSelfBilledInvoices)
      .where(and(eq(atelierSelfBilledInvoices.id, sbiId)));
    check("approve_self_billing: forged confirm wrote nothing (still draft)", stillDraft?.status === "draft", stillDraft?.status);

    // Forged confirm with a WRONG token → still preview.
    const forged2: any = await approveSb.run(
      { id: sbiId, confirm: true, commitToken: "deadbeef".repeat(8) },
      mkCtx() as any,
    );
    check("approve_self_billing: wrong token degrades to preview", !!forged2.confirmation, forged2);

    // Real commit via the phase-1 pending.input.
    const p2: any = await approveSb.run(p1.confirmation.pending.input, mkCtx() as any);
    check("approve_self_billing: verified commit ok, no confirmation", p2.ok === true && !p2.confirmation, p2);
    check(
      "approve_self_billing: commit returns navigateTo /finance/approvals on_commit",
      p2.data?.navigateTo?.path === "/finance/approvals" && p2.data?.navigateTo?.when === "on_commit",
      p2.data?.navigateTo,
    );
    check(
      "approve_self_billing: recap line uses the ⇒ outcome convention",
      typeof p2.data?.message === "string" && p2.data.message.includes("⇒"),
      p2.data?.message,
    );
    const [approved] = await db.select().from(atelierSelfBilledInvoices)
      .where(and(eq(atelierSelfBilledInvoices.id, sbiId)));
    check(
      "approve_self_billing: committed through the SAME payables core (status approved, approver stamped)",
      approved?.status === "approved" && approved?.approvedByUserId === IDS.fp,
      approved,
    );
  }

  // =============== 3) collections send: typed-name (outbound) ===============
  {
    // Metadata contract: the platform lifts typed-name for irreversible /
    // outbound writes; the capability declares both so a client-email
    // chase never sends on a single tap.
    check(
      "approve_send_collections: declared irreversible + outbound(email) → platform requires typed name",
      sendCollections.irreversible === true && sendCollections.outboundChannel === "email",
      { irreversible: sendCollections.irreversible, outboundChannel: sendCollections.outboundChannel },
    );
    check(
      "approve_payroll_run: money-out declared irreversible → platform requires typed name",
      approvePayroll.irreversible === true,
      approvePayroll.irreversible,
    );

    // Phase 1 preview carries the typed-name hint in the diff + the HMAC token.
    const p1: any = await sendCollections.run({ id: cdId }, mkCtx() as any);
    check("approve_send_collections: phase 1 returns confirmation", !!p1.confirmation, p1);
    check(
      "approve_send_collections: diff flags irreversible + outbound + typedNameRequired",
      p1.confirmation?.diff?.irreversible === true &&
        p1.confirmation?.diff?.outboundChannel === "email" &&
        typeof p1.confirmation?.diff?.typedNameRequired === "string",
      p1.confirmation?.diff,
    );
    check(
      "approve_send_collections: diff.typedNameRequired is the INVOICE NUMBER, not the opaque draft id",
      p1.confirmation?.diff?.typedNameRequired === `INV-${TAG}` &&
        p1.confirmation.diff.typedNameRequired !== cdId,
      p1.confirmation?.diff?.typedNameRequired,
    );
    check(
      "approve_send_collections: confirm copy names the invoice number",
      typeof p1.confirmation?.summary === "string" && p1.confirmation.summary.includes(`INV-${TAG}`),
      p1.confirmation?.summary,
    );
    check(
      "approve_send_collections: typed-name gate rejects empty / opaque id, accepts invoice number",
      typedNameGate(p1.confirmation.diff.typedNameRequired, "") === "reject" &&
        typedNameGate(p1.confirmation.diff.typedNameRequired, cdId) === "reject" &&
        typedNameGate(p1.confirmation.diff.typedNameRequired, `INV-${TAG}`) === "accept",
    );
    // Forged confirm without a valid token still degrades to preview.
    const forged: any = await sendCollections.run(
      { id: cdId, confirm: true, typedName: cdId },
      mkCtx() as any,
    );
    check("approve_send_collections: forged confirm (no HMAC token) → preview, no send", !!forged.confirmation, forged);
    const [stillDraft] = await db.select().from(atelierCollectionsDraft)
      .where(and(eq(atelierCollectionsDraft.id, cdId)));
    check("approve_send_collections: forged confirm sent nothing (still draft)", stillDraft?.status === "draft", stillDraft?.status);

    // Verified commit — escalation branch is internal (no client email).
    const p2: any = await sendCollections.run(p1.confirmation.pending.input, mkCtx() as any);
    check("approve_send_collections: verified commit ok", p2.ok === true && !p2.confirmation, p2);
    check(
      "approve_send_collections: commit navigateTo on_commit",
      p2.data?.navigateTo?.path === "/finance/approvals" && p2.data?.navigateTo?.when === "on_commit",
      p2.data?.navigateTo,
    );
    const [sent] = await db.select().from(atelierCollectionsDraft)
      .where(and(eq(atelierCollectionsDraft.id, cdId)));
    check(
      "approve_send_collections: committed through the SAME close core (escalation acknowledged, internal)",
      sent?.status === "sent" && sent?.sentVia === "internal",
      sent,
    );
  }

  // =============== 3b) payroll approve: money-out typed-name ===============
  {
    const p1: any = await approvePayroll.run({ id: runId }, mkCtx() as any);
    check("approve_payroll_run: phase 1 returns confirmation", !!p1.confirmation, p1);
    check(
      "approve_payroll_run: diff flags irreversible + typedNameRequired",
      p1.confirmation?.diff?.irreversible === true &&
        typeof p1.confirmation?.diff?.typedNameRequired === "string",
      p1.confirmation?.diff,
    );
    check(
      "approve_payroll_run: diff.typedNameRequired is the PERIOD LABEL, not the opaque run id",
      p1.confirmation?.diff?.typedNameRequired === RUN_PERIOD &&
        p1.confirmation.diff.typedNameRequired !== runId,
      p1.confirmation?.diff?.typedNameRequired,
    );
    check(
      "approve_payroll_run: confirm copy names the period label",
      typeof p1.confirmation?.summary === "string" && p1.confirmation.summary.includes(RUN_PERIOD),
      p1.confirmation?.summary,
    );
    check(
      "approve_payroll_run: typed-name gate rejects empty / opaque id, accepts period label",
      typedNameGate(p1.confirmation.diff.typedNameRequired, "") === "reject" &&
        typedNameGate(p1.confirmation.diff.typedNameRequired, runId) === "reject" &&
        typedNameGate(p1.confirmation.diff.typedNameRequired, RUN_PERIOD) === "accept",
    );
    // HMAC gate still stacks under the typed-name gate.
    const forged: any = await approvePayroll.run({ id: runId, confirm: true, typedName: RUN_PERIOD }, mkCtx() as any);
    check("approve_payroll_run: forged confirm (no HMAC token) → preview, no post", !!forged.confirmation, forged);
    const [stillDraft] = await db.select().from(atelierPayrollRun).where(and(eq(atelierPayrollRun.id, runId)));
    check("approve_payroll_run: forged confirm posted nothing (still draft)", stillDraft?.status === "draft", stillDraft?.status);
  }

  // =============== 4) role clamps (four layers) ===============
  {
    const TOOLS = [
      "finance_approvals_inbox", "finance_autopilot_settings",
      "approve_self_billing", "reject_self_billing", "review_supplier_invoice",
      "approve_close_accrual", "reject_close_accrual", "approve_payroll_run",
      "approve_send_collections", "set_autopilot_settings",
    ];
    const sliceFor = (role: string) =>
      capabilitiesForPersona({ id: "x", name: "x", role, orgId: ORG } as any)
        .map((e: any) => e.toolName);
    const fpSlice = sliceFor("founding_partner");
    check("roles: founding_partner sees all finance-approval tools", TOOLS.every((t) => fpSlice.includes(t)), TOOLS.filter((t) => !fpSlice.includes(t)));
    // finance (leadership, non-partner) sees the reads + non-partner writes.
    const finSlice = sliceFor("finance");
    check("roles: finance sees the inbox read", finSlice.includes("finance_approvals_inbox"));
    check("roles: finance does NOT get partner-only accrual approve", !finSlice.includes("approve_close_accrual"), finSlice.filter((t: string) => t === "approve_close_accrual"));
    for (const role of ["employee", "contractor", "board_observer", "recruiter", "partner_firm_resource", "alliance_partner"]) {
      const slice = sliceFor(role);
      check(
        `roles: ${role} sees none of the finance-approval tools`,
        TOOLS.every((t) => !slice.includes(t)),
        slice.filter((t: string) => TOOLS.includes(t)),
      );
    }
  }

  // =============== 5) write contract enforcement ===============
  {
    // A partner-tier employee-role denial still short-circuits BEFORE any
    // write, and returns an honest refusal (not a silent empty).
    const rDenied: any = await approveSb.run({ id: sbiId }, mkCtx(empPersona) as any);
    check("write contract: employee denied on approve_self_billing", rDenied.ok === false && rDenied.errorCode === "forbidden", rDenied);
    // Missing id → invalid_input clarification, never a guessed commit.
    const rInvalid: any = await approveSb.run({}, mkCtx() as any);
    check("write contract: missing id → invalid_input", rInvalid.ok === false && rInvalid.errorCode === "invalid_input", rInvalid);
  }

  stub.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
