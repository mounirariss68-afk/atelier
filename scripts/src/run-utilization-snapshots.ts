/**
 * Cron-friendly entrypoint to trigger an Atelier utilization-snapshot
 * recompute via the API server.
 *
 * The in-process scheduler in `artifacts/api-server` already calls
 * `runUtilizationSnapshotTick` every 15 minutes (gated to 12h cadence),
 * but ops also wants a standalone script that can be wired into an
 * external cron / CI without booting a second copy of the api-server
 * runtime. We talk to the existing api-server over HTTP so the
 * `scripts` package stays free of cross-package source imports
 * (preserves rootDir isolation in `pnpm --filter @workspace/scripts
 * exec tsc --noEmit`).
 *
 * Required env:
 *   ATELIER_API_BASE_URL  e.g. http://localhost:8080
 *   ATELIER_OPS_PERSONA   defaults to p_mounir_ariss (any partner persona)
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/run-utilization-snapshots.ts
 */

const BASE = process.env.ATELIER_API_BASE_URL ?? "http://localhost:8080";
const PERSONA = process.env.ATELIER_OPS_PERSONA ?? "p_mounir_ariss";

async function main(): Promise<void> {
  const meRes = await fetch(`${BASE}/api/atelier/me?persona=${encodeURIComponent(PERSONA)}`);
  if (!meRes.ok) throw new Error(`me handshake failed: ${meRes.status}`);
  const cookie = meRes.headers.get("set-cookie") ?? "";
  const runRes = await fetch(`${BASE}/api/atelier/ledger/utilization/snapshot/run`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
  if (!runRes.ok) throw new Error(`snapshot run failed: ${runRes.status}`);
  const out: unknown = await runRes.json();
  console.log(JSON.stringify({ ok: true, ...(out as Record<string, unknown>) }));
}

main().catch((err) => {
  console.error("snapshot tick failed:", err);
  process.exit(1);
});
