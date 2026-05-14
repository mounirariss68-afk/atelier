/**
 * Task #339 — capability-coverage lint for Atelier routes.
 *
 * Walks `src/routes/atelier/` and flags any `router.<method>(...)`
 * call that is not registered through `defineRouteCapability` and does
 * not carry an explicit `// @cli-skip: <reason>` opt-out comment. The
 * coverage test (`tests/cli-catalog/run.ts`) imports `lintAtelierRoutes`
 * and fails the build if the returned violations array is non-empty.
 *
 * Invocation:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/atelier-lint-routes.ts
 *
 * Output (machine-readable):
 *   <file>:<line>  <method> <path>  → add `// @cli-skip: <reason>` or wrap with defineRouteCapability(...)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROUTES_DIR = new URL("../routes/atelier", import.meta.url).pathname;
const ROOT = new URL("../../../..", import.meta.url).pathname;

/**
 * Files in routes/atelier/ that are not user-facing API surfaces and
 * therefore have no CLI shape (auth shims, ACL helpers, type modules,
 * audit pipeline glue). Adding to this list requires a one-line
 * justification.
 */
const NON_ROUTE_FILES = new Set([
  "index.ts",            // mounts every router; not itself a route
  "personaCookie.ts",    // auth shim for persona switching
  "personaRoles.ts",     // type-only
  "rls.ts",              // ACL helper
  "auditContract.ts",    // type-only contract
  "auditPdf.ts",         // PDF render helper
]);

export interface RouteViolation {
  file: string;
  line: number;
  method: string;
  path: string;
}

const ROUTE_RE = /^\s*router\.(get|post|put|patch|delete)\s*\(\s*(["'`])([^"'`]+)\2/;
const SKIP_RE = /@cli-skip:/;
const CAPABILITY_RE = /defineRouteCapability\s*\(/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (name.endsWith(".ts") && !NON_ROUTE_FILES.has(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse a single file and return any router method calls that are not
 * either (a) wrapped in `defineRouteCapability(...)` or (b) carry an
 * explicit opt-out marker on the same or preceding non-blank line.
 */
function scanFile(file: string): RouteViolation[] {
  const text = readFileSync(file, "utf8");
  // If the entire file is registered through defineRouteCapability the
  // ad-hoc `router.METHOD(...)` calls below it are still detected,
  // because we want each call site individually justified.
  const lines = text.split("\n");
  const out: RouteViolation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(ROUTE_RE);
    if (!m) continue;
    const method = m[1];
    const path = m[3];

    // Look back up to 5 lines for an opt-out marker or a wrapping
    // defineRouteCapability( call (the wrapper itself contains the
    // METHOD/path on a different line, but the helper is closer).
    let justified = false;
    for (let j = Math.max(0, i - 5); j <= i; j++) {
      const back = lines[j];
      if (SKIP_RE.test(back) || CAPABILITY_RE.test(back)) {
        justified = true;
        break;
      }
    }
    if (!justified) {
      out.push({
        file: relative(ROOT, file),
        line: i + 1,
        method,
        path,
      });
    }
  }
  return out;
}

/**
 * Run the lint across every route file. Returns the violations rather
 * than throwing so the coverage test can format the report and decide
 * whether to fail.
 */
export function lintAtelierRoutes(): RouteViolation[] {
  const files = listTsFiles(ROUTES_DIR);
  const out: RouteViolation[] = [];
  for (const f of files) out.push(...scanFile(f));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = lintAtelierRoutes();
  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[atelier-lint-routes] OK — every route is registered through defineRouteCapability or marked @cli-skip.");
    process.exit(0);
  }
  // eslint-disable-next-line no-console
  console.error(`[atelier-lint-routes] ${violations.length} route(s) missing capability metadata:`);
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.line}  ${v.method.toUpperCase()} ${v.path}  → wrap with defineRouteCapability(...) or add \`// @cli-skip: <reason>\``);
  }
  process.exit(1);
}
