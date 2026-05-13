/* eslint-disable no-console */
/**
 * Task #275 — Cartographer backfill.
 *
 * Walks the 7 seeded Atelier accounts and runs the (now web_search-grounded)
 * Account Cartographer for each one, direct-writing strategic priorities,
 * source signals, decision-makers and reports_to edges. Idempotent: signals
 * dedupe on URL and contacts upsert by lower-cased fullName.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run cartographer:backfill
 */

import {
  db,
  pool,
  atelierAccounts,
  atelierContacts,
  atelierContactRelationships,
  atelierAuditEvents,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { runAccountCartographer } from "../lib/atelier-agents/runner.js";

const ACCOUNT_IDS = [
  "acc_tasama",
  "acc_dubai_municipality",
  "acc_dge",
  "acc_tahakom",
  "acc_nhc",
  "acc_stc",
  "acc_aldrees",
];

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

async function backfillOne(accountId: string): Promise<void> {
  const [a] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, accountId))
    .limit(1);
  if (!a) {
    console.warn(`[backfill] ${accountId} not found — skipping.`);
    return;
  }
  console.log(`[backfill] ${accountId} (${a.name}) — calling cartographer…`);

  const { output, source, warning } = await runAccountCartographer({
    accountId: a.id,
    accountName: a.name,
    accountSector: a.sector,
    accountCountry: a.country,
    accountHqCity: a.hqCity ?? null,
    triggeredByUserId: "p_mounir_ariss",
    actorLabel: "Account Cartographer (backfill)",
    focusOpportunityId: null,
  });

  if (warning) console.warn(`[backfill] ${accountId} warning: ${warning}`);
  console.log(
    `[backfill] ${accountId} source=${source} priorities=${output.account.strategicPriorities?.length ?? 0} signals=${output.sourceSignals?.length ?? 0} dms=${output.decisionMakers?.length ?? 0}`,
  );

  const incomingSignals = output.sourceSignals ?? [];
  const existingSignals = a.sourceSignals ?? [];
  const seenSignalUrls = new Set(existingSignals.map((s) => s.url));
  const mergedSignals = [
    ...existingSignals,
    ...incomingSignals.filter((s) => !seenSignalUrls.has(s.url)),
  ].slice(-20);

  const priorities = output.account.strategicPriorities ?? [];
  const priorityTexts = priorities.map((p) => p.text);
  const priorityRefs = priorities.map((p) => ({
    text: p.text,
    sourceUrls: Array.isArray(p.sourceUrls)
      ? p.sourceUrls.filter((u): u is string => typeof u === "string")
      : [],
  }));

  await db.transaction(async (tx) => {
    const accountUpdate: Partial<typeof atelierAccounts.$inferInsert> = {
      sourceSignals: mergedSignals,
      enrichedAt: new Date(),
      updatedAt: new Date(),
    };
    if (priorityTexts.length > 0) {
      accountUpdate.strategicPriorities = priorityTexts;
      accountUpdate.strategicPriorityRefs = priorityRefs;
    }
    if (output.account.aicoHypothesis && output.account.aicoHypothesis.trim().length > 0) {
      accountUpdate.aicoHypothesis = output.account.aicoHypothesis;
    }
    if (output.account.refreshedSummary && output.account.refreshedSummary.trim().length > 0) {
      accountUpdate.notes = output.account.refreshedSummary;
    }
    await tx.update(atelierAccounts).set(accountUpdate).where(eq(atelierAccounts.id, a.id));

    const existingContacts = await tx
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)));
    const byName = new Map<string, (typeof existingContacts)[number]>();
    for (const c of existingContacts) byName.set(c.fullName.toLowerCase(), c);
    const fullNameToId = new Map<string, string>();
    for (const c of existingContacts) fullNameToId.set(c.fullName.toLowerCase(), c.id);

    let inserted = 0;
    let updated = 0;
    for (const dm of output.decisionMakers ?? []) {
      const key = dm.fullName.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        await tx
          .update(atelierContacts)
          .set({
            title: dm.title ?? existing.title,
            seniority: dm.seniority ?? existing.seniority,
            buyerPersona: dm.buyerPersona ?? existing.buyerPersona,
            sourceUrl: dm.sourceUrl ?? existing.sourceUrl,
            confidence: dm.confidence ?? existing.confidence,
            updatedAt: new Date(),
          })
          .where(eq(atelierContacts.id, existing.id));
        updated += 1;
      } else {
        const newId = rid("ct");
        await tx.insert(atelierContacts).values({
          id: newId,
          accountId: a.id,
          fullName: dm.fullName,
          title: dm.title ?? null,
          seniority: dm.seniority ?? null,
          buyerPersona: dm.buyerPersona ?? null,
          influenceScore: dm.seniority === "c_suite" ? 5 : dm.seniority === "vp" ? 4 : 3,
          disposition: "unknown",
          notes: dm.rationale ?? null,
          sourceUrl: dm.sourceUrl ?? null,
          confidence: dm.confidence,
          createdByUserId: "p_mounir_ariss",
        });
        fullNameToId.set(key, newId);
        inserted += 1;
      }
    }

    const reportsEdges: Array<{ fromId: string; toId: string }> = [];
    for (const dm of output.decisionMakers ?? []) {
      if (!dm.reportsToName) continue;
      const fromId = fullNameToId.get(dm.fullName.toLowerCase());
      const toId = fullNameToId.get(dm.reportsToName.toLowerCase());
      if (fromId && toId && fromId !== toId) reportsEdges.push({ fromId, toId });
    }
    if (reportsEdges.length > 0) {
      const existingEdges = await tx
        .select()
        .from(atelierContactRelationships)
        .where(
          and(
            eq(atelierContactRelationships.accountId, a.id),
            eq(atelierContactRelationships.type, "reports_to"),
            isNull(atelierContactRelationships.deletedAt),
          ),
        );
      const haveEdge = new Set(
        existingEdges.map((e) => `${e.fromContactId}->${e.toContactId}`),
      );
      for (const e of reportsEdges) {
        const k = `${e.fromId}->${e.toId}`;
        if (haveEdge.has(k)) continue;
        await tx.insert(atelierContactRelationships).values({
          id: rid("cr"),
          accountId: a.id,
          fromContactId: e.fromId,
          toContactId: e.toId,
          type: "reports_to",
        });
        haveEdge.add(k);
      }
    }

    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: a.id,
      actorType: "agent",
      actorId: "ag_account_cartographer",
      actorLabel: "Account Cartographer (backfill)",
      action: "cartographer.backfill",
      payload: {
        signalCount: incomingSignals.length,
        priorityCount: priorityTexts.length,
        contactsInserted: inserted,
        contactsUpdated: updated,
        source,
        warning: warning ?? null,
      },
      payloadSummary: `Backfill ${source === "claude" ? "wrote" : "(mock) wrote"} ${priorityTexts.length} priorities, ${incomingSignals.length} signals, ${inserted}+${updated} contacts for ${a.name}.`,
    });

    console.log(
      `[backfill] ${accountId} done — contacts inserted=${inserted} updated=${updated} edges=${reportsEdges.length}`,
    );
  });
}

async function main(): Promise<void> {
  console.log(`[backfill] starting cartographer backfill for ${ACCOUNT_IDS.length} accounts…`);
  for (const accountId of ACCOUNT_IDS) {
    try {
      await backfillOne(accountId);
    } catch (err) {
      console.error(`[backfill] ${accountId} failed:`, err);
    }
  }
  console.log("[backfill] done.");
  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
