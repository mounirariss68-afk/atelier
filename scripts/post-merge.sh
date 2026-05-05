#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Rebuild composite TS projects so consumers see fresh .d.ts after merges.
# (lib/maven-content is `composite: true` with a dist/ output that other
# packages resolve through; a stale dist will hide newly-added exports.)
rm -f lib/maven-content/tsconfig.tsbuildinfo
pnpm --filter @workspace/maven-content exec tsc -p tsconfig.json

# Re-seed the Tasama Payroll Hub demo so the dashboards always have
# data after merges. The seeder TRUNCATEs and re-inserts deterministically,
# so this is safe to re-run on every merge. Skip with SKIP_TASAMA_SEED=1.
if [ "${SKIP_TASAMA_SEED:-0}" != "1" ]; then
  pnpm --filter @workspace/scripts run seed:tasama
fi
