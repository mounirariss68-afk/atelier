/**
 * Task #49 — guard against orphan-leaving opportunity deletes.
 *
 * Opportunities have polymorphic children (meetings, transcripts,
 * win/loss debriefs, dashboard pane rows) that are NOT all covered by
 * FK cascades, so every hard delete must go through the shared helper
 * `src/lib/atelier-opportunity-delete.ts` (hardDeleteOpportunities).
 *
 * This lint scans src/ and tests/ for raw `.delete(atelierOpportunities`
 * call sites outside the allow-list and returns them as violations.
 * The coverage suite (`tests/cli-catalog/run.ts`) imports
 * `lintOpportunityDeletes` and fails if any are found.
 *
 * Allow-listed files:
 *   - src/lib/atelier-opportunity-delete.ts — the shared cascade helper
 *     itself (the single legitimate raw delete).
 *   - tests/crm/probe-winloss-orphans.ts — deliberately simulates an
 *     orphaning raw delete to verify FK cascade + defensive read
 *     filters. Do not "fix" that probe to use the helper.
 *
 * Invocation:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/atelier-lint-opportunity-deletes.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_SERVER_ROOT = new URL("../..", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../..", import.meta.url).pathname;

const SCAN_DIRS = ["src", "tests"];

/** Paths relative to the api-server root, POSIX separators. */
const ALLOWED_FILES = new Set([
  "src/lib/atelier-opportunity-delete.ts",             // the shared cascade helper
  "tests/crm/probe-winloss-orphans.ts",                // intentionally simulates an orphaning delete
  "tests/crm/pricing-structures-probe.ts",             // scratch-DB cleanup: children deleted explicitly first, belt + suspenders only
  "tests/cli-catalog/workload-scope.ts",               // scratch-DB cleanup of its own fixture rows
  "tests/crm/margin-reports-probe.ts",                 // scratch-DB cleanup of its own fixture rows
  "tests/crm/partner-opportunity-filter-report-probe.ts", // isolated fixture cleanup; joint-pipeline children and audits removed first
  "src/scripts/atelier-lint-opportunity-deletes.ts",   // this lint (pattern appears in docs/regex)
]);

// Matches `.delete(atelierOpportunities` — covers db.delete(...),
// tx.delete(...), dbc.delete(...) etc. Whitespace-tolerant.
const RAW_DELETE_RE = /\.\s*delete\s*\(\s*atelierOpportunities\b/;

export interface OpportunityDeleteViolation {
  file: string; // relative to repo root, for readable reports
  line: number;
  snippet: string;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

export function lintOpportunityDeletes(): OpportunityDeleteViolation[] {
  const out: OpportunityDeleteViolation[] = [];
  for (const scanDir of SCAN_DIRS) {
    const abs = join(API_SERVER_ROOT, scanDir);
    for (const file of listTsFiles(abs)) {
      const relToApiServer = relative(API_SERVER_ROOT, file).split("\\").join("/");
      if (ALLOWED_FILES.has(relToApiServer)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (RAW_DELETE_RE.test(lines[i])) {
          out.push({
            file: relative(REPO_ROOT, file),
            line: i + 1,
            snippet: lines[i].trim().slice(0, 120),
          });
        }
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = lintOpportunityDeletes();
  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[atelier-lint-opportunity-deletes] OK — no raw opportunity deletes outside the shared helper.");
    process.exit(0);
  }
  // eslint-disable-next-line no-console
  console.error(`[atelier-lint-opportunity-deletes] ${violations.length} raw opportunity delete(s) found — use hardDeleteOpportunities() from src/lib/atelier-opportunity-delete.ts:`);
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.line}  ${v.snippet}`);
  }
  process.exit(1);
}
