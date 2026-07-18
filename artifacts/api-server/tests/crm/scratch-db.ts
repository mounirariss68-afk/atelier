/**
 * Task #40 — CRM harness DB isolation bootstrap (SYNCHRONOUS on purpose).
 *
 * MUST be the FIRST import of tests/crm/run.ts: it rewrites
 * process.env.DATABASE_URL to point at an isolated scratch database BEFORE
 * any module (directly or transitively) imports @workspace/db, whose pg Pool
 * binds the connection string at import time.
 *
 * WHY SYNCHRONOUS: top-level await in an ESM module does NOT stop sibling
 * imports from evaluating — an async bootstrap here would let @workspace/db
 * bind the LIVE DATABASE_URL while we were still awaiting. Everything below
 * therefore runs via spawnSync (the pg work happens in the
 * ./scratch-db-admin.ts child process).
 *
 * Behavior:
 *  - If TEST_DATABASE_URL is set, it is honored as an explicit override
 *    (still refusing to run if it equals the live DATABASE_URL).
 *  - Otherwise a dedicated scratch database (`crm_test`) is created (or
 *    reused) on the same Postgres server as DATABASE_URL, and the Drizzle
 *    schema + RLS SQL are pushed into it on every run.
 *  - There is NO fallback to the live database. Any failure to establish
 *    isolation aborts the process with instructions.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRATCH_DB_NAME = process.env.CRM_TEST_DB_NAME || "crm_test";

function fatal(msg: string): never {
  console.error(`FATAL (CRM harness isolation): ${msg}`);
  console.error(
    "The CRM harness never writes to the live database. Fix the isolation " +
      "problem above (or point TEST_DATABASE_URL at a throwaway database) " +
      "and re-run.",
  );
  process.exit(1);
}

const LIVE_URL = process.env.DATABASE_URL;
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const adminScript = fileURLToPath(new URL("./scratch-db-admin.ts", import.meta.url));

function runAdmin(phase: "create" | "rls", scratchUrl: string): void {
  const res = spawnSync("pnpm", ["exec", "tsx", adminScript, phase], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: {
      ...process.env,
      CRM_LIVE_URL: LIVE_URL ?? "",
      CRM_SCRATCH_URL: scratchUrl,
      CRM_SCRATCH_DB_NAME: SCRATCH_DB_NAME,
    },
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 120_000,
  });
  if (res.status !== 0) {
    fatal(`scratch-db admin step "${phase}" failed (exit ${res.status}).`);
  }
}

let scratchUrl: string;

if (process.env.TEST_DATABASE_URL) {
  if (LIVE_URL && process.env.TEST_DATABASE_URL === LIVE_URL) {
    fatal("TEST_DATABASE_URL equals DATABASE_URL — that is not an isolated database.");
  }
  scratchUrl = process.env.TEST_DATABASE_URL;
  console.log("[crm-harness] Using explicit TEST_DATABASE_URL override.");
} else {
  if (!LIVE_URL) {
    fatal(
      "DATABASE_URL is not set, so no Postgres server is available to host " +
        "the scratch database. Provision a database or set TEST_DATABASE_URL.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(LIVE_URL);
  } catch {
    fatal("DATABASE_URL is not a parseable URL; cannot derive a scratch database.");
  }
  if (parsed.pathname.replace(/^\//, "") === SCRATCH_DB_NAME) {
    fatal(
      `DATABASE_URL already points at "${SCRATCH_DB_NAME}" — refusing to treat the live DB as scratch.`,
    );
  }
  parsed.pathname = `/${SCRATCH_DB_NAME}`;
  scratchUrl = parsed.toString();
  runAdmin("create", scratchUrl);
}

if (LIVE_URL && scratchUrl === LIVE_URL) {
  fatal("Scratch URL resolved to the live DATABASE_URL — refusing to run.");
}

// Push the Drizzle schema into the scratch DB on every run so it always
// matches the current code, then (re)apply the RLS SQL the harness's scoping
// assertions depend on.
console.log("[crm-harness] Pushing Drizzle schema into the scratch database…");
const push = spawnSync(
  "pnpm",
  ["--filter", "@workspace/db", "run", "push-force"],
  {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: scratchUrl },
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 180_000,
  },
);
if (push.status !== 0) {
  fatal(
    `drizzle-kit push into the scratch database failed (exit ${push.status}). ` +
      "See output above; the harness will not run without a current schema.",
  );
}

runAdmin("rls", scratchUrl);

// Mirror the minimal live boot seed (founder users, auth credentials,
// reference data) so scripts that anchor on the seeded personas work against
// the scratch database. Runs as a child so this module stays synchronous.
{
  const seedScript = fileURLToPath(new URL("./scratch-db-boot-seed.ts", import.meta.url));
  const res = spawnSync("pnpm", ["exec", "tsx", seedScript], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: {
      ...process.env,
      CRM_LIVE_URL: LIVE_URL ?? "",
      CRM_SCRATCH_URL: scratchUrl,
    },
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 120_000,
  });
  if (res.status !== 0) {
    fatal(`scratch-db boot seed failed (exit ${res.status}).`);
  }
}

// Finalize env BEFORE anything imports @workspace/db. This module is fully
// synchronous, so no sibling import can have evaluated yet.
process.env.DATABASE_URL = scratchUrl;
process.env.TEST_DATABASE_URL = scratchUrl;
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// Runtime tripwire: if the pool somehow still binds elsewhere this constant
// lets assertions compare against the intended target.
export const SCRATCH_DATABASE_URL = scratchUrl;

console.log("[crm-harness] DATABASE_URL now points at the isolated scratch database.");
