#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Apply Atelier RLS policies (org_id + engagement_id ACL).
if [ -f lib/db/src/atelier-rls.sql ] && [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/src/atelier-rls.sql || \
    echo "[post-merge] WARN: atelier-rls.sql apply failed (non-fatal in dev)"
fi
# Rebuild composite TS projects so consumers see fresh .d.ts after merges.
# (lib/cognirise-content is `composite: true` with a dist/ output that other
# packages resolve through; a stale dist will hide newly-added exports.)
rm -f lib/cognirise-content/tsconfig.tsbuildinfo
pnpm --filter @workspace/cognirise-content exec tsc -p tsconfig.json

# Re-seed the Tasama Payroll Hub demo so the dashboards always have
# data after merges. The seeder TRUNCATEs and re-inserts deterministically,
# so this is safe to re-run on every merge. Skip with SKIP_TASAMA_SEED=1.
if [ "${SKIP_TASAMA_SEED:-0}" != "1" ]; then
  pnpm --filter @workspace/scripts run seed:tasama
fi

# Re-seed The Atelier (employee portal) on every merge so the demo data is
# always present. TRUNCATE-then-INSERT in dependency order; deterministic.
if [ "${SKIP_ATELIER_SEED:-0}" != "1" ]; then
  pnpm --filter @workspace/scripts run seed:atelier
fi
