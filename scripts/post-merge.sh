#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Rebuild composite TS projects so consumers see fresh .d.ts after merges.
# (lib/maven-content is `composite: true` with a dist/ output that other
# packages resolve through; a stale dist will hide newly-added exports.)
rm -f lib/maven-content/tsconfig.tsbuildinfo
pnpm --filter @workspace/maven-content exec tsc -p tsconfig.json
