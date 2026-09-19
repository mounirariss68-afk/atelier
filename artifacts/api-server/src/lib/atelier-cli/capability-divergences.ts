export interface CapabilityDivergenceRecord {
  id: string;
  category: "route_parity" | "unsupported_executor" | "confirmation_compat";
  status: "approved";
  reason: string;
  owner: string;
  approvedAt: string;
  reviewBy: string;
  compensatingGate: string;
}

export const CAPABILITY_DIVERGENCES: readonly CapabilityDivergenceRecord[] = [
  {
    id: "cli-only-route-parity-v1",
    category: "route_parity",
    status: "approved",
    reason:
      "Legacy CLI-only registrations remain supported while route/service conformance migrates family by family under C16.",
    owner: "Agent Platform",
    approvedAt: "2026-09-19",
    reviewBy: "2027-03-31",
    compensatingGate: "test:cli-catalog route-coverage ratchet; baseline may shrink but never grow",
  },
  {
    id: "agent-executor-unsupported-v1",
    category: "unsupported_executor",
    status: "approved",
    reason:
      "Agent registry entries are discoverable in the reviewed manifest but cannot dispatch until durable adapters are authorized.",
    owner: "Agent Platform",
    approvedAt: "2026-09-19",
    reviewBy: "2027-03-31",
    compensatingGate: "all agent entries return unsupported and are excluded from dispatch lookup",
  },
  {
    id: "legacy-confirmation-compat-v1",
    category: "confirmation_compat",
    status: "approved",
    reason:
      "Existing write capabilities without durable two-phase confirmation remain compatibility-only until migrated behind action records.",
    owner: "Agent Platform",
    approvedAt: "2026-09-19",
    reviewBy: "2027-03-31",
    compensatingGate: "legacy_compat entries are explicit in the reviewed manifest and cannot claim executable status",
  },
] as const;

const BY_ID = new Map(CAPABILITY_DIVERGENCES.map((record) => [record.id, record]));

export function getCapabilityDivergence(id: string): CapabilityDivergenceRecord | undefined {
  return BY_ID.get(id);
}

export function assertCapabilityDivergences(
  ids: readonly string[],
  now = new Date(),
): void {
  for (const id of ids) {
    const record = getCapabilityDivergence(id);
    if (!record || record.status !== "approved") {
      throw new Error(`capability-divergence-unapproved:${id}`);
    }
    const reviewBy = new Date(`${record.reviewBy}T23:59:59.999Z`);
    if (!Number.isFinite(reviewBy.getTime()) || reviewBy.getTime() < now.getTime()) {
      throw new Error(`capability-divergence-review-expired:${id}`);
    }
    if (!record.owner.trim() || !record.reason.trim() || !record.compensatingGate.trim()) {
      throw new Error(`capability-divergence-incomplete:${id}`);
    }
  }
}