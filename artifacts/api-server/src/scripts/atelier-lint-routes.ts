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
// Task #795 — chat-parity registry for /me self-service actions (pure module).
import { ME_CHAT_PARITY } from "../lib/atelier-cli/me-chat-parity.js";

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

// ---------------------------------------------------------------------
// Task #795 — chat-parity lint for MUTATING /me routes.
//
// Every post/put/patch/delete route whose path starts with /me must
// appear in ME_CHAT_PARITY (src/lib/atelier-cli/me-chat-parity.ts):
// either mapped to a chat capability id or excluded with a reason and
// the real UI location(s). An @cli-skip marker is NOT enough for these
// routes — the registry is what drives the honest refusal copy.
// ---------------------------------------------------------------------
const MUTATING = new Set(["post", "put", "patch", "delete"]);

export interface MeParityViolation {
  file: string;
  line: number;
  method: string;
  path: string;
  problem: "missing_registry_entry" | "stale_registry_entry";
}

/** Scan every mutating router call across the route files. */
export function listMutatingMeRoutes(): RouteViolation[] {
  const out: RouteViolation[] = [];
  for (const file of listTsFiles(ROUTES_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      let m = lines[i].match(ROUTE_RE);
      let method: string;
      let path: string;
      if (m) {
        method = m[1];
        path = m[3];
      } else {
        // Multi-line declaration: `router.post(` with the path on the
        // next line (multipart routes with middleware args).
        const open = lines[i].match(/^\s*router\.(get|post|put|patch|delete)\s*\(\s*$/);
        if (!open || i + 1 >= lines.length) continue;
        const p = lines[i + 1].match(/^\s*(["'`])([^"'`]+)\1/);
        if (!p) continue;
        method = open[1];
        path = p[2];
      }
      if (!MUTATING.has(method)) continue;
      if (!path.startsWith("/me/") && path !== "/me") continue;
      out.push({ file: relative(ROOT, file), line: i + 1, method, path });
    }
  }
  return out;
}

/**
 * Returns violations: routes missing a registry entry, plus stale
 * registry keys that no longer match any route (so the registry can't
 * silently rot). `routes` is injectable for tests.
 */
export function lintMeChatParity(
  routes: RouteViolation[] = listMutatingMeRoutes(),
): MeParityViolation[] {
  const out: MeParityViolation[] = [];
  const seenKeys = new Set<string>();
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    seenKeys.add(key);
    if (!ME_CHAT_PARITY[key]) {
      out.push({ ...r, problem: "missing_registry_entry" });
    }
  }
  for (const key of Object.keys(ME_CHAT_PARITY)) {
    if (!seenKeys.has(key)) {
      const [method, path] = key.split(" ");
      out.push({ file: "(registry)", line: 0, method, path, problem: "stale_registry_entry" });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const parity = lintMeChatParity();
  if (parity.length > 0) {
    console.error(`[atelier-lint-routes] ${parity.length} /me chat-parity violation(s):`);
    for (const v of parity) {
      console.error(
        v.problem === "missing_registry_entry"
          ? `  ${v.file}:${v.line}  ${v.method.toUpperCase()} ${v.path}  → add a ME_CHAT_PARITY entry (capability id, or exclusion with reason + UI location) in me-chat-parity.ts`
          : `  registry key "${v.method} ${v.path}" matches no route — remove or fix it in me-chat-parity.ts`,
      );
    }
    process.exit(1);
  }
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
