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

# All demo-data seeding was removed on 2026-07-16 (moving to production):
# no seeder may run here. The only boot-time seed left is the auth
# credential seed inside the API server itself.
