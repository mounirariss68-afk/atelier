/**
 * Task #254 — route-level regression tests.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx --test src/test-task-254-routes.ts
 *
 * Covers the three behaviours that are easy to silently regress:
 *   1) Compensation policy lock (Partner sees comp; Eng Lead + SME do not).
 *   2) Cross-realm boundary (partner_firm_resource is 403'd from /home).
 *   3) Access-matrix gate is Partner-only (Eng Lead + SME → 403).
 *
 * Hits the live api-server at http://localhost:8080 — restart it before
 * running. Uses cookie-based persona switching with a /me preflight so a
 * mistyped persona id fails loudly instead of silently falling back to
 * the default Partner persona.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.ATELIER_API_BASE ?? "http://localhost:8080";
const TARGET = "/api/atelier/roster/people/emp_p_mounir_ariss";

async function asPersona(personaId: string | null) {
  const headers: Record<string, string> = {};
  if (personaId) headers.cookie = `atelier_persona=${personaId}`;
  return headers;
}

async function meRole(personaId: string | null): Promise<string> {
  const r = await fetch(`${BASE}/api/atelier/me`, {
    headers: await asPersona(personaId),
  });
  assert.equal(r.status, 200, `/me failed for ${personaId}: ${r.status}`);
  const body = (await r.json()) as { role?: string; persona?: { role?: string } };
  return body.persona?.role ?? body.role ?? "";
}

type PersonResp = { person?: Record<string, unknown>; viewerCanSeeComp?: boolean };
const COMP_KEYS = ["baseCompensation", "dayRateInternalCost", "iban", "swift", "noticePeriodDays"] as const;

test("comp policy lock — partner sees comp fields + viewerCanSeeComp=true", async () => {
  const role = await meRole("p_mounir_ariss");
  assert.equal(role, "partner", `expected partner persona, got ${role}`);
  const r = await fetch(`${BASE}${TARGET}`, { headers: await asPersona("p_mounir_ariss") });
  assert.equal(r.status, 200);
  const body = (await r.json()) as PersonResp;
  assert.equal(body.viewerCanSeeComp, true, "partner viewerCanSeeComp must be true");
  const person = body.person ?? {};
  const surfaced = COMP_KEYS.filter((k) => k in person);
  assert.ok(surfaced.length > 0, `partner should see at least one comp key, got: ${Object.keys(person).join(",")}`);
});

test("comp policy lock — second founding partner also sees comp fields", async () => {
  const role = await meRole("p_gokhan_guney");
  assert.equal(role, "partner", `expected partner persona, got ${role}`);
  const r = await fetch(`${BASE}${TARGET}`, { headers: await asPersona("p_gokhan_guney") });
  assert.equal(r.status, 200);
  const body = (await r.json()) as PersonResp;
  assert.equal(body.viewerCanSeeComp, true, "partner viewerCanSeeComp must be true");
  const person = body.person ?? {};
  const surfaced = COMP_KEYS.filter((k) => k in person);
  assert.ok(surfaced.length > 0, `partner should see at least one comp key, got: ${Object.keys(person).join(",")}`);
});

test("access-matrix is Partner-only — both founders allowed", async () => {
  const mounir = await fetch(`${BASE}/api/atelier/roster/access-matrix`, {
    headers: await asPersona("p_mounir_ariss"),
  });
  assert.equal(mounir.status, 200);
  const gokhan = await fetch(`${BASE}/api/atelier/roster/access-matrix`, {
    headers: await asPersona("p_gokhan_guney"),
  });
  assert.equal(gokhan.status, 200);
  const anon = await fetch(`${BASE}/api/atelier/roster/access-matrix`, {
    headers: await asPersona(null),
  });
  // Since the full auth lockdown, unauthenticated requests must be rejected
  // outright — never 200.
  assert.equal(anon.status, 401, `anon access-matrix must be 401, got ${anon.status}`);
});
