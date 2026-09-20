/* eslint-disable no-console */
/**
 * Task #275 — Cartographer backfill.
 *
 * Walks the legacy seeded-account IDs and runs Account Cartographer for each
 * one. All findings enter the governed partner-review queue; this command
 * never writes generated enrichment or contacts directly.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run cartographer:backfill
 */

import {
  db,
  pool,
  atelierAccounts,
  atelierContacts,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  runAccountCartographer,
  buildCartographerProposals,
  enqueueProfileUpdateProposals,
} from "../lib/atelier-agents/runner.js";

const ACCOUNT_IDS = [
  "acc_tasama",
  "acc_dubai_municipality",
  "acc_dge",
  "acc_tahakom",
  "acc_nhc",
  "acc_stc",
  "acc_aldrees",
];

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

  const { runId, output } = await runAccountCartographer({
    accountId: a.id,
    accountName: a.name,
    accountSector: a.sector,
    accountCountry: a.country,
    accountHqCity: a.hqCity ?? null,
    triggeredByUserId: "p_mounir_ariss",
    actorLabel: "Account Cartographer (backfill)",
    focusOpportunityId: null,
  });

  console.log(
    `[backfill] ${accountId} priorities=${output.account.strategicPriorities?.length ?? 0} signals=${output.sourceSignals?.length ?? 0} dms=${output.decisionMakers?.length ?? 0}`,
  );

  const existingContacts = await db
    .select({ fullName: atelierContacts.fullName })
    .from(atelierContacts)
    .where(and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)));
  const proposedCount = await enqueueProfileUpdateProposals({
    accountId: a.id,
    build: (lockedAccount) =>
      buildCartographerProposals({
        proposedBy: "ag_account_cartographer",
        output,
        account: lockedAccount,
        existingContacts,
      }),
    audit: {
      actorId: "ag_account_cartographer",
      actorLabel: "Account Cartographer (backfill)",
      auditWhenEmpty: true,
      payload: (accepted) => ({
        trigger: "backfill",
        runId,
        count: accepted.length,
        fields: accepted.map((p) => p.field),
        proposalIds: accepted.map((p) => p.id),
      }),
      summary: (lockedAccount, accepted) =>
        `Cartographer backfill proposed ${accepted.length} governed update(s) for ${lockedAccount.name}.`,
    },
  });
  console.log(`[backfill] ${accountId} done — queued ${proposedCount} proposal(s)`);
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
