/**
 * Task #3 — global auth-gate regression check.
 *
 * The whole API is 401-gated by a single `requireAuthSession` middleware in
 * src/routes/index.ts. If a future router is mounted BEFORE that gate by
 * mistake it would silently be public. This module catches that two ways:
 *
 * 1. Structurally: walk the top-level Express router stack and assert that
 *    the ONLY layers mounted before the gate are the known public routers
 *    (health + auth). Any new layer that sneaks in before the gate — whatever
 *    its path — fails the suite.
 * 2. Behaviorally: with the NODE_ENV=test auth bypass force-disabled (via
 *    REPLIT_DEPLOYMENT, the same guardrail production relies on), probe every
 *    protected mount plus an unmatched path without a session cookie and
 *    assert 401, while the public surfaces stay reachable.
 *
 * Future routes are covered without test edits: the gate is a bare
 * `router.use()` after the public mounts, so anything mounted after it —
 * including paths that match no router at all — answers 401 (asserted via
 * the unmatched-path probe), and the structural check fails if any new
 * layer is mounted before the gate. A count-parity check additionally flags
 * new post-gate mounts so the probe list below gets extended.
 */

import router from "../../src/routes/index.js";
import healthRouter from "../../src/routes/health.js";
import authRouter from "../../src/routes/auth/index.js";
import { requireAuthSession } from "../../src/lib/auth/session.js";

type Check = (name: string, cond: boolean, detail?: string) => void;
type Group = (title: string) => void;

interface Layer {
  handle: unknown;
  route?: { path: string } | null;
  matchers?: Array<(path: string) => false | { path: string }>;
}

// Every mount that sits behind the gate in src/routes/index.ts. When a new
// protected router is added, the count-parity check below fails until the
// new mount is added here (keeping the 401 probes exhaustive).
const PROTECTED_MOUNTS = [
  "/assessments",
  "/chat",
  "/arcelik",
  "/tasama",
  "/atelier",
  "/salon",
];

export async function runAuthGateChecks(
  port: number,
  check: Check,
  group: Group,
): Promise<void> {
  group("Auth \u00b7 global 401 gate (Task #3)");

  const stack = (router as unknown as { stack: Layer[] }).stack;
  const gateIdxs = stack
    .map((l, i) => (l.handle === requireAuthSession ? i : -1))
    .filter((i) => i >= 0);
  check(
    "gate: requireAuthSession is mounted exactly once",
    gateIdxs.length === 1,
    `found ${gateIdxs.length}`,
  );
  if (gateIdxs.length !== 1) return;
  const gateIdx = gateIdxs[0];

  // --- 1. Structural: nothing public except health + auth ---
  const preGate = stack.slice(0, gateIdx);
  const allowedPublic = new Set<unknown>([healthRouter, authRouter]);
  const rogue = preGate.filter((l) => !allowedPublic.has(l.handle));
  check(
    "gate: only health + auth routers are mounted before the gate",
    rogue.length === 0,
    rogue.length
      ? `${rogue.length} unexpected pre-gate layer(s): ` +
        rogue
          .map((l) => l.route?.path ?? (l.handle as { name?: string })?.name ?? "anonymous")
          .join(", ")
      : undefined,
  );
  const postGate = stack.slice(gateIdx + 1);
  check(
    "gate: protected routers exist after the gate",
    postGate.length > 0,
    `postGate=${postGate.length}`,
  );

  // Count-parity: every post-gate layer must correspond to an entry in
  // PROTECTED_MOUNTS. When someone adds a new protected router, this fails
  // until the probe list is extended — keeping the 401 probes exhaustive.
  // (Express 5 layer matchers only answer for paths under their own mount,
  // so mount prefixes cannot be recovered generically from the stack.)
  check(
    "gate: post-gate layer count matches the probed mount list",
    postGate.length === PROTECTED_MOUNTS.length,
    `postGate=${postGate.length} probed=${PROTECTED_MOUNTS.length} \u2014 update PROTECTED_MOUNTS in tests/crm/auth-gate.ts`,
  );
  // Each probed mount must actually be matched by some post-gate layer
  // (catches a mount being moved above the gate or renamed).
  for (const mount of PROTECTED_MOUNTS) {
    const matched = postGate.some((l) => l.matchers?.[0]?.(`${mount}/__gate_probe__`));
    check(`gate: ${mount} is mounted behind the gate`, matched);
  }

  // --- 2. Behavioral probes with the test bypass force-disabled ---
  const base = `http://127.0.0.1:${port}/api`;
  const hadDeployment = process.env.REPLIT_DEPLOYMENT;
  process.env.REPLIT_DEPLOYMENT = "1"; // kills isTestAuthBypass() per-request
  try {
    // Sanity: the bypass really is off — every protected mount 401s
    // without a cookie.
    for (const mount of PROTECTED_MOUNTS) {
      const res = await fetch(`${base}${mount}`, { redirect: "manual" });
      check(
        `unauthenticated GET ${mount} \u2192 401`,
        res.status === 401,
        `status=${res.status}`,
      );
    }
    // A nested resource path (not just the mount root) is also gated.
    const nested = await fetch(`${base}/atelier/accounts`);
    check(
      "unauthenticated GET /atelier/accounts \u2192 401",
      nested.status === 401,
      `status=${nested.status}`,
    );
    // The gate is a bare `use()` so even unknown future paths are covered:
    // an unmatched path must 401, never 404 (404 would mean it fell past
    // the gate).
    const unmatched = await fetch(`${base}/__no_such_route_${Date.now()}`);
    check(
      "unauthenticated GET <unmatched path> \u2192 401 (gate covers unknown routes)",
      unmatched.status === 401,
      `status=${unmatched.status}`,
    );
    // Public surfaces stay reachable without a session.
    const health = await fetch(`${base}/healthz`);
    check("GET /healthz stays public \u2192 200", health.status === 200, `status=${health.status}`);
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // Empty body → 400 invalid-body (or 429 if rate-limited by earlier
    // suites) — proves the endpoint is reachable pre-auth, i.e. NOT behind
    // the session gate (which would answer 401 unauthenticated).
    const loginBody = (await login.json().catch(() => null)) as { error?: string } | null;
    check(
      "POST /auth/login stays public (reachable without session)",
      (login.status === 400 && loginBody?.error === "invalid-body") || login.status === 429,
      `status=${login.status} error=${loginBody?.error}`,
    );
    const session = await fetch(`${base}/auth/session`);
    const sessionBody = (await session.json().catch(() => null)) as { error?: string } | null;
    check(
      "GET /auth/session stays public (401 unauthenticated from the route itself)",
      session.status === 401 && sessionBody?.error === "unauthenticated",
      `status=${session.status} error=${sessionBody?.error}`,
    );
  } finally {
    if (hadDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = hadDeployment;
  }
}
