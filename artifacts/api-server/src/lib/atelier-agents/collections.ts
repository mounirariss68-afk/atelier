/**
 * Atelier — Collections Agent (Task #432).
 *
 * Rule-based, deterministic, draft-only: rides the existing dunning
 * ladder (atelier_dunning_ladder / _event / promise_to_pay). For every
 * issued invoice with an outstanding balance it drafts the next chase
 * email once the current ladder step's cadence is due — suppressed while
 * an open future promise-to-pay stands — and drafts a partner escalation
 * when the ladder is exhausted. NOTHING is ever sent by the agent; every
 * draft waits for an explicit approve-send in closeRoutes.ts, which
 * re-validates cadence + P2P and records the dunning event.
 *
 * Rules documented in prompts/atelier/collections.v1.md.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierInvoice,
  atelierDunningLadder,
  atelierDunningEvent,
  atelierPromiseToPay,
  atelierCollectionsDraft,
} from "@workspace/db";
import { runAgent } from "./runAgent.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CollectionsInput {
  asOf?: string;
  invoiceId?: string;
}

export interface CollectionsOutput {
  invoicesScanned: number;
  draftsCreated: number;
  draftsRefreshed: number;
  suppressedByPromise: number;
  notYetDue: number;
  escalationsDrafted: number;
  rationaleSummary: string;
}

/** Deterministic chase copy per ladder template. */
export function composeChase(args: {
  template: string;
  invoiceNumber: string;
  customerName: string;
  outstanding: number;
  currency: string;
  dueDate: string | null;
  daysOverdue: number;
  escalation: boolean;
}): { subject: string; bodyText: string } {
  const inv = args.invoiceNumber;
  const amt = `${args.currency} ${round2(args.outstanding).toLocaleString("en-US")}`;
  if (args.escalation) {
    return {
      subject: `[ESCALATION] Invoice ${inv} — ladder exhausted (${args.daysOverdue}d overdue, ${amt})`,
      bodyText:
        `Internal escalation — do not forward to the client.\n\n` +
        `Invoice ${inv} for ${args.customerName} remains unpaid ${args.daysOverdue} days past due (${amt} outstanding) ` +
        `and every step of the dunning ladder has been sent.\n\n` +
        `Recommended partner actions: call the client sponsor, agree a payment plan (record it as a promise-to-pay), ` +
        `pause new work under the engagement, or assess a write-off.\n`,
    };
  }
  const greeting = `Dear ${args.customerName},`;
  const due = args.dueDate ? ` (due ${args.dueDate})` : "";
  const tone = args.template.toLowerCase();
  if (tone.includes("final") || tone.includes("formal")) {
    return {
      subject: `Final notice — invoice ${inv} is ${args.daysOverdue} days overdue`,
      bodyText:
        `${greeting}\n\nDespite our previous reminders, invoice ${inv}${due} remains unpaid with ${amt} outstanding — ` +
        `now ${args.daysOverdue} days past due.\n\nPlease arrange settlement within 5 business days. If payment has ` +
        `already been made, kindly share the remittance advice. Otherwise we may need to pause ongoing work and refer ` +
        `the balance for formal follow-up.\n\nKind regards,\nAccounts Receivable`,
    };
  }
  if (tone.includes("firm") || tone.includes("second") || tone.includes("chase")) {
    return {
      subject: `Reminder — invoice ${inv} is ${args.daysOverdue} days overdue (${amt})`,
      bodyText:
        `${greeting}\n\nOur records show invoice ${inv}${due} is still open with ${amt} outstanding, ` +
        `${args.daysOverdue} days past due.\n\nCould you confirm the payment date this week? If there is an issue ` +
        `with the invoice, let us know and we will resolve it promptly.\n\nKind regards,\nAccounts Receivable`,
    };
  }
  return {
    subject: `Friendly reminder — invoice ${inv} (${amt})`,
    bodyText:
      `${greeting}\n\nA friendly reminder that invoice ${inv}${due} shows ${amt} outstanding on our side.\n\n` +
      `If payment is already on its way, please ignore this note — otherwise we would appreciate a quick confirmation ` +
      `of the expected date.\n\nMany thanks,\nAccounts Receivable`,
  };
}

export async function runCollectionsAgent(args: {
  orgId: string;
  input: CollectionsInput;
  triggeredByUserId: string | null;
}): Promise<{ runId: string; output: CollectionsOutput }> {
  const res = await runAgent<CollectionsInput, CollectionsOutput>(
    {
      agentId: "ag_collections",
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: "collections_run",
      targetId: `${args.orgId}:${args.input.asOf ?? new Date().toISOString().slice(0, 10)}`,
      targetLabel: "Collections draft run",
    },
    async (ctx) => {
      const output = await executeCollections(args.orgId, args.input, ctx.runId, ctx.progress);
      return { output, confidence: "green" };
    },
  );
  return { runId: res.runId, output: res.output };
}

async function executeCollections(
  orgId: string,
  input: CollectionsInput,
  agentRunId: string,
  progress: (pct: number, msg: string) => Promise<void>,
): Promise<CollectionsOutput> {
  const asOf = input.asOf ? new Date(input.asOf) : new Date();

  const invoices = (await db
    .select()
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.orgId, orgId),
      eq(atelierInvoice.status, "issued"),
      isNull(atelierInvoice.deletedAt),
    ))).filter((i) =>
      !i.voidedAt &&
      round2(i.total - i.amountPaid) > 0.011 &&
      (!input.invoiceId || i.id === input.invoiceId));

  await progress(20, `${invoices.length} outstanding invoice(s) to evaluate`);

  const ladders = await db
    .select()
    .from(atelierDunningLadder)
    .where(and(eq(atelierDunningLadder.orgId, orgId), eq(atelierDunningLadder.isDefault, true), isNull(atelierDunningLadder.deletedAt)));
  const ladderByJurisdiction = new Map(ladders.map((l) => [l.jurisdiction, l]));

  const invoiceIds = invoices.map((i) => i.id);
  const events = invoiceIds.length
    ? await db.select().from(atelierDunningEvent).where(inArray(atelierDunningEvent.invoiceId, invoiceIds))
    : [];
  const eventCount = new Map<string, number>();
  for (const e of events) eventCount.set(e.invoiceId, (eventCount.get(e.invoiceId) ?? 0) + 1);

  const promises = invoiceIds.length
    ? await db.select().from(atelierPromiseToPay).where(and(inArray(atelierPromiseToPay.invoiceId, invoiceIds), eq(atelierPromiseToPay.status, "open")))
    : [];
  const promisesByInvoice = new Map<string, typeof promises>();
  for (const p of promises) {
    const arr = promisesByInvoice.get(p.invoiceId) ?? [];
    arr.push(p);
    promisesByInvoice.set(p.invoiceId, arr);
  }

  const existingDrafts = invoiceIds.length
    ? await db.select().from(atelierCollectionsDraft).where(and(eq(atelierCollectionsDraft.orgId, orgId), inArray(atelierCollectionsDraft.invoiceId, invoiceIds), isNull(atelierCollectionsDraft.deletedAt)))
    : [];
  const draftByKey = new Map(existingDrafts.map((d) => [`${d.invoiceId}:${d.stepIndex}`, d]));

  let draftsCreated = 0;
  let draftsRefreshed = 0;
  let suppressedByPromise = 0;
  let notYetDue = 0;
  let escalationsDrafted = 0;

  for (const inv of invoices) {
    const outstanding = round2(inv.total - inv.amountPaid);
    const dueDate = inv.dueDate ? new Date(inv.dueDate) : asOf;
    const daysOverdue = Math.max(0, Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000));
    if (daysOverdue <= 0) { notYetDue++; continue; }

    const ladder = ladderByJurisdiction.get(inv.jurisdiction);
    if (!ladder || ladder.steps.length === 0) continue;

    // Open future promise-to-pay suppresses chasing.
    const openFuture = (promisesByInvoice.get(inv.id) ?? []).find(
      (p) => new Date(p.promisedDate).getTime() >= asOf.getTime(),
    );
    const promiseContext = openFuture
      ? { promiseId: openFuture.id, promisedAmount: openFuture.promisedAmount, promisedDate: openFuture.promisedDate }
      : null;
    if (openFuture) { suppressedByPromise++; continue; }

    const stepIndex = eventCount.get(inv.id) ?? 0;
    const escalation = stepIndex >= ladder.steps.length;
    const step = escalation ? null : ladder.steps[stepIndex];
    if (step && daysOverdue < step.offsetDays) { notYetDue++; continue; }

    const customerName = inv.billTo?.name ?? "Client";
    const { subject, bodyText } = composeChase({
      template: escalation ? "escalation" : step!.template,
      invoiceNumber: inv.invoiceNumber ?? inv.id,
      customerName,
      outstanding,
      currency: inv.currency,
      dueDate: inv.dueDate,
      daysOverdue,
      escalation,
    });

    const key = `${inv.id}:${stepIndex}`;
    const existing = draftByKey.get(key);
    if (existing) {
      // Sent / dismissed drafts are final; refresh live drafts only.
      if (existing.status !== "draft") continue;
      await db.update(atelierCollectionsDraft)
        .set({
          subject, bodyText, daysOverdue, outstandingUsd: outstanding,
          template: escalation ? "escalation" : step!.template,
          escalation, promiseContext, agentRunId, updatedAt: new Date(),
        })
        .where(eq(atelierCollectionsDraft.id, existing.id));
      draftsRefreshed++;
      if (escalation) escalationsDrafted++;
      continue;
    }
    await db.insert(atelierCollectionsDraft).values({
      id: rid("coldft"),
      orgId,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName,
      ladderId: ladder.id,
      stepIndex,
      template: escalation ? "escalation" : step!.template,
      channel: "email",
      subject,
      bodyText,
      daysOverdue,
      outstandingUsd: outstanding,
      escalation,
      requireApproval: escalation ? true : !!step!.requireApproval,
      promiseContext,
      agentRunId,
    }).onConflictDoNothing();
    draftsCreated++;
    if (escalation) escalationsDrafted++;
  }

  await progress(90, "Drafting complete");
  return {
    invoicesScanned: invoices.length,
    draftsCreated,
    draftsRefreshed,
    suppressedByPromise,
    notYetDue,
    escalationsDrafted,
    rationaleSummary:
      `Scanned ${invoices.length} outstanding invoice(s): ${draftsCreated} draft(s) created, ` +
      `${draftsRefreshed} refreshed, ${escalationsDrafted} escalation(s), ${suppressedByPromise} suppressed by open ` +
      `promise-to-pay, ${notYetDue} not yet due per ladder cadence. Nothing was sent — every draft awaits human approval.`,
  };
}
