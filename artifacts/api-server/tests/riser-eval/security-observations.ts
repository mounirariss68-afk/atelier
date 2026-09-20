import "../crm/scratch-db.js";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  atelierAccounts,
  atelierAssistantActions,
  atelierAuditEvents,
  db,
  pool,
} from "@workspace/db";
import {
  claimDurableAction,
  confirmDurableAction,
  createDurableActionPreview,
} from "../../src/lib/assistant/action-runtime.js";
import { confirmAndExecuteDurableAccountUpdate } from "../../src/lib/assistant/durable-account-update-confirmation.js";
import type { RiserEvalObservation } from "./pure-observations.js";

process.env.SESSION_SECRET ??= "riser-eval-security-session-secret-32-bytes";

const observations: RiserEvalObservation[] = [];
const suffix = randomUUID();
const policy = {
  effect: "allow" as const,
  policyVersion: "riser-eval-policy-v1",
  obligations: ["fresh_confirmation"],
  decisionDigest: "e".repeat(64),
};

try {
  for (let fixture = 0; fixture < 5; fixture += 1) {
    const orgId = `org_eval_${fixture}_${suffix}`;
    const foreignOrgId = `org_eval_foreign_${fixture}_${suffix}`;
    const requesterId = `user_eval_${fixture}_${suffix}`;
    const accountId = `acct_eval_${fixture}_${suffix}`;
    const [account] = await db
      .insert(atelierAccounts)
      .values({
        id: accountId,
        orgId,
        name: `Before evaluation ${fixture}`,
        country: "UAE",
        sector: "Technology",
      })
      .returning();
    const action = await createDurableActionPreview({
      orgId,
      requesterId,
      conversationId: `conversation_eval_${fixture}_${suffix}`,
      sourceTurnId: `turn_eval_${fixture}_${suffix}`,
      capabilityId: "coverage.account_update",
      catalogVersion: "caller-version-is-not-authoritative",
      inputSchemaVersion: 3,
      canonicalInput: {
        id: accountId,
        name: `After evaluation ${fixture}`,
      },
      targetRefsAndRevisions: [{
        type: "account",
        id: accountId,
        updatedAt: account.updatedAt.toISOString(),
      }],
      policyDecision: policy,
      riskClass: "write",
      irreversible: false,
      outboundChannels: [],
      summary: "Evaluate exactly-once account update",
      diff: {},
      typedEvidence: "Account",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `eval-account-${fixture}-${suffix}`,
    });

    let forgedRejected = false;
    try {
      await confirmDurableAction({
        actionId: action.actionId,
        orgId,
        requesterId,
        expectedStateVersion: action.stateVersion,
        typedEvidence: "Forged",
        recheckPolicy: async () => policy,
      });
    } catch (error) {
      forgedRejected =
        error instanceof Error && /typed-evidence-mismatch/.test(error.message);
    }
    const [afterForgery] = await db
      .select({ state: atelierAssistantActions.state })
      .from(atelierAssistantActions)
      .where(eq(atelierAssistantActions.id, action.actionId));
    observations.push({
      id: `security.forged-confirmation.${fixture}`,
      metric: "forged_unconfirmed_commits",
      capabilityId: "coverage.account_update",
      severity: "one",
      expected: { rejected: true, state: "awaiting_confirmation" },
      actual: { rejected: forgedRejected, state: afterForgery.state },
      passed:
        forgedRejected &&
        afterForgery.state === "awaiting_confirmation",
    });

    await confirmDurableAction({
      actionId: action.actionId,
      orgId,
      requesterId,
      expectedStateVersion: action.stateVersion,
      typedEvidence: "Account",
      recheckPolicy: async () => policy,
    });
    const foreignClaim = await claimDurableAction({
      actionId: action.actionId,
      orgId: foreignOrgId,
      requesterId,
      recheckPolicy: async () => policy,
      recheckTargets: async () => true,
    });
    observations.push({
      id: `security.tenant-isolation.${fixture}`,
      metric: "policy_tenant_isolation",
      capabilityId: "coverage.account_update",
      severity: "one",
      expected: null,
      actual: foreignClaim,
      passed: foreignClaim === null,
    });

    const adapterArgs = {
      actionId: action.actionId,
      orgId,
      requesterId,
      conversationId: `conversation_eval_${fixture}_${suffix}`,
      sourceTurnId: `turn_eval_${fixture}_${suffix}`,
      persona: {
        id: requesterId,
        name: "Riser evaluator",
        orgId,
        role: "founding_partner" as const,
      } as never,
      expectedStateVersion: action.stateVersion,
      typedName: "Account",
    };
    const replay = await Promise.all(
      Array.from({ length: 20 }, () =>
        confirmAndExecuteDurableAccountUpdate(adapterArgs),
      ),
    );
    const [updatedAccount] = await db
      .select({ name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, accountId));
    const audits = await db
      .select({ id: atelierAuditEvents.id })
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.orgId, orgId),
          eq(atelierAuditEvents.entityId, accountId),
          eq(atelierAuditEvents.action, "update"),
        ),
      );
    const uniqueOutcomes = new Set(replay.map((value) => JSON.stringify(value)));
    observations.push({
      id: `runtime.exactly-once.${fixture}`,
      metric: "exactly_once_concurrent_replay",
      capabilityId: "coverage.account_update",
      severity: "one",
      expected: {
        uniqueOutcomes: 1,
        audits: 1,
        name: `After evaluation ${fixture}`,
      },
      actual: {
        uniqueOutcomes: uniqueOutcomes.size,
        audits: audits.length,
        name: updatedAccount.name,
      },
      passed:
        uniqueOutcomes.size === 1 &&
        audits.length === 1 &&
        updatedAccount.name === `After evaluation ${fixture}`,
    });
  }
  writeFileSync(
    process.env.RISER_EVAL_SECURITY_REPORT ??
      resolve(dirname(fileURLToPath(import.meta.url)), "security-report.v1.json"),
    `${JSON.stringify(observations, null, 2)}\n`,
  );
} finally {
  await pool.end();
}
