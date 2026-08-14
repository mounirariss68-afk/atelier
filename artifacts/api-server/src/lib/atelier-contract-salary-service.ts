/**
 * Task #1137 — Salary-proposal lifecycle service.
 *
 * Orchestrates the proposal row + fire-and-forget extraction so both the
 * e-sign sync trigger and the on-demand back-process route share the same
 * idempotency + fail-loud semantics. NOTHING writes payroll here — this
 * module only produces/updates PROPOSALS.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  atelierContractRecords,
  atelierContractSalaryProposals,
  atelierEmployees,
} from "@workspace/db";
import {
  extractContractSalary,
  ContractSalaryExtractionError,
} from "./atelier-contract-salary.js";
import { rid } from "./atelier-contracts.js";
import type { ContractRow } from "./atelier-contract-service.js";

const LIVE_STATUSES = ["processing", "pending"] as const;

/** Contract types that carry employee salary data. */
export const SALARY_CONTRACT_TYPES = new Set([
  "employment",
  "non_equity_partner_employment",
]);

export type SalaryProposalRow = typeof atelierContractSalaryProposals.$inferSelect;

/**
 * Return the existing live (processing|pending) proposal for a contract,
 * if any. Used to enforce one-live-proposal-per-contract idempotency.
 */
export async function findLiveProposal(
  orgId: string,
  contractId: string,
): Promise<SalaryProposalRow | null> {
  const [row] = await db
    .select()
    .from(atelierContractSalaryProposals)
    .where(
      and(
        eq(atelierContractSalaryProposals.orgId, orgId),
        eq(atelierContractSalaryProposals.contractId, contractId),
        inArray(atelierContractSalaryProposals.status, [...LIVE_STATUSES]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Is this signed contract eligible for salary extraction? Employment-type
 * AND the counterparty resolves to an atelier_employees row. Contractors
 * are skipped (payroll is employee-only).
 */
export async function isSalaryEligible(
  contract: Pick<
    ContractRow,
    "orgId" | "contractType" | "counterpartyKind" | "personId"
  >,
): Promise<{ eligible: boolean; employeeId: string | null }> {
  if (!SALARY_CONTRACT_TYPES.has(contract.contractType)) {
    return { eligible: false, employeeId: null };
  }
  if (contract.counterpartyKind !== "person" || !contract.personId) {
    return { eligible: false, employeeId: null };
  }
  const [emp] = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.id, contract.personId),
        eq(atelierEmployees.orgId, contract.orgId),
      ),
    )
    .limit(1);
  return { eligible: !!emp, employeeId: emp?.id ?? null };
}

/**
 * Race-safely create a "processing" proposal for a contract. The DB partial
 * unique index (uniq_atelier_csp_live_per_contract: one processing|pending
 * row per contract) is the source of truth — we insert with
 * onConflictDoNothing and, when the insert loses the race (or a live row
 * already existed), return the existing live row with created:false. This
 * guarantees exactly one live proposal per contract under concurrency.
 */
export async function createSalaryProposal(args: {
  orgId: string;
  contractId: string;
  personId: string;
}): Promise<{ proposal: SalaryProposalRow; created: boolean }> {
  // Attempt the insert unconditionally and let the partial unique index
  // (uniq_atelier_csp_live_per_contract) arbitrate. We catch the
  // unique-violation (SQLSTATE 23505) rather than relying on ON CONFLICT
  // arbiter inference, which is brittle for partial indexes. On a lost race
  // we return the incumbent live row with created:false.
  const attempt = async (): Promise<SalaryProposalRow | null> => {
    try {
      const [row] = await db
        .insert(atelierContractSalaryProposals)
        .values({
          id: rid("csp"),
          orgId: args.orgId,
          contractId: args.contractId,
          personId: args.personId,
          status: "processing",
        })
        .returning();
      return row ?? null;
    } catch (err) {
      if (isLiveProposalUniqueViolation(err)) return null;
      throw err;
    }
  };

  const first = await attempt();
  if (first) return { proposal: first, created: true };
  // Lost the race (or a live row already existed) — return the incumbent.
  const existing = await findLiveProposal(args.orgId, args.contractId);
  if (existing) return { proposal: existing, created: false };
  // Extremely unlikely: the conflicting live row was decided away between the
  // failed insert and the re-read. Retry once.
  const retry = await attempt();
  if (retry) return { proposal: retry, created: true };
  const again = await findLiveProposal(args.orgId, args.contractId);
  if (again) return { proposal: again, created: false };
  throw new Error(
    `createSalaryProposal: unable to create or find a live proposal for contract ${args.contractId}`,
  );
}

/**
 * True when the error is the partial-unique-index violation for our
 * one-live-proposal-per-contract guard (Postgres SQLSTATE 23505 naming the
 * uniq_atelier_csp_live_per_contract index). Any other error re-throws.
 */
function isLiveProposalUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  const constraint = e?.constraint ?? e?.cause?.constraint ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === "23505" &&
    (constraint.includes("uniq_atelier_csp_live_per_contract") ||
      msg.includes("uniq_atelier_csp_live_per_contract"))
  );
}

/**
 * Run extraction for a proposal (long-running; call fire-and-forget).
 * On success → status "pending" with source/extracted/snippets. On any
 * failure → status "failed" with the reason. NEVER throws to the caller.
 */
export async function runSalaryExtraction(proposalId: string): Promise<void> {
  try {
    const [proposal] = await db
      .select()
      .from(atelierContractSalaryProposals)
      .where(eq(atelierContractSalaryProposals.id, proposalId));
    if (!proposal || proposal.status !== "processing") return;

    const [contract] = await db
      .select()
      .from(atelierContractRecords)
      .where(eq(atelierContractRecords.id, proposal.contractId));
    if (!contract) {
      await failProposal(proposalId, "Contract not found for extraction.");
      return;
    }

    const result = await extractContractSalary(contract);
    await db
      .update(atelierContractSalaryProposals)
      .set({
        status: "pending",
        source: result.source,
        extracted: result.extracted,
        sourceSnippets: result.snippets,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierContractSalaryProposals.id, proposalId));
  } catch (err) {
    const reason =
      err instanceof ContractSalaryExtractionError
        ? err.message
        : `Salary extraction failed: ${err instanceof Error ? err.message : String(err)}`;
    await failProposal(proposalId, reason);
  }
}

async function failProposal(proposalId: string, reason: string): Promise<void> {
  try {
    await db
      .update(atelierContractSalaryProposals)
      .set({ status: "failed", error: reason, updatedAt: new Date() })
      .where(eq(atelierContractSalaryProposals.id, proposalId));
  } catch (err) {
    console.error(
      `[contract-salary] failed to record failure on proposal ${proposalId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Trigger hook for the e-sign signed transition. Eligible contracts get a
 * proposal + fire-and-forget extraction; ineligible contracts (contractor
 * counterparties, non-employment types) are skipped with no row. NEVER
 * throws — the e-sign sync must not break.
 */
export async function triggerSalaryExtractionOnSigned(
  contract: Pick<
    ContractRow,
    "id" | "orgId" | "contractType" | "counterpartyKind" | "personId"
  >,
): Promise<void> {
  try {
    const { eligible, employeeId } = await isSalaryEligible(contract);
    if (!eligible || !employeeId) return;
    const { proposal, created } = await createSalaryProposal({
      orgId: contract.orgId,
      contractId: contract.id,
      personId: employeeId,
    });
    if (!created) return; // a live proposal already exists — idempotent
    // Fire-and-forget: never block the sync/webhook thread.
    void runSalaryExtraction(proposal.id).catch((err) =>
      console.error(
        `[contract-salary] extraction crashed for ${proposal.id}:`,
        err instanceof Error ? err.message : err,
      ),
    );
  } catch (err) {
    console.error(
      `[contract-salary] trigger failed for contract ${contract.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
