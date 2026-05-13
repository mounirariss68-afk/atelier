/**
 * Cron-friendly entrypoint to recompute Atelier utilization snapshots.
 *
 * The in-process scheduler in `artifacts/api-server` already calls
 * `runUtilizationSnapshotTick` every 15 minutes (gated to 12h cadence),
 * but ops also wants a standalone script that can be wired into an
 * external cron / CI without booting the API server. This module exposes
 * exactly that: it imports the same tick function and runs it once with
 * `force: true` so the gate is bypassed for explicit operational runs.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/run-utilization-snapshots.ts
 */
import { runUtilizationSnapshotTick } from "../../artifacts/api-server/src/lib/atelier-agents/ledgerNudges.js";

async function main() {
  const out = await runUtilizationSnapshotTick({ force: true, weeksBack: 8 });
  console.log(JSON.stringify({ ok: true, ...out }));
}

main().catch((err) => {
  console.error("snapshot tick failed:", err);
  process.exit(1);
});
