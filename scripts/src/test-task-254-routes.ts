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

test("comp policy lock — engagement_lead does NOT see comp fields", async () => {
  const role = await meRole("p_layla_haddad");
  assert.equal(role, "engagement_lead", `expected engagement_lead, got ${role}`);
  const r = await fetch(`${BASE}${TARGET}`, { headers: await asPersona("p_layla_haddad") });
  assert.equal(r.status, 200);
  const body = (await r.json()) as PersonResp;
  assert.equal(body.viewerCanSeeComp, false, "engagement_lead viewerCanSeeComp must be false");
  const person = body.person ?? {};
  for (const k of COMP_KEYS) assert.ok(!(k in person), `engagement_lead must NOT see ${k}`);
});

test("comp policy lock — sme does NOT see comp fields", async () => {
  const role = await meRole("p_omar_najjar");
  assert.equal(role, "sme", `expected sme, got ${role}`);
  const r = await fetch(`${BASE}${TARGET}`, { headers: await asPersona("p_omar_najjar") });
  assert.equal(r.status, 200);
  const body = (await r.json()) as PersonResp;
  assert.equal(body.viewerCanSeeComp, false, "sme viewerCanSeeComp must be false");
  const person = body.person ?? {};
  for (const k of COMP_KEYS) assert.ok(!(k in person), `sme must NOT see ${k}`);
});

test("access-matrix is Partner-only", async () => {
  const partner = await fetch(`${BASE}/api/atelier/roster/access-matrix`, {
    headers: await asPersona("p_mounir_ariss"),
  });
  assert.equal(partner.status, 200);
  const lead = await fetch(`${BASE}/api/atelier/roster/access-matrix`, {
    headers: await asPersona("p_layla_haddad"),
  });
  assert.equal(lead.status, 403);
  const sme = await fetch(`${BASE}/api/atelier/roster/access-matrix`, {
    headers: await asPersona("p_omar_najjar"),
  });
  assert.equal(sme.status, 403);
});

test("cross-realm boundary — partner_firm_resource blocked from /home", async () => {
  const role = await meRole("u_yara_bgts");
  assert.equal(role, "partner_firm_resource", `expected partner_firm_resource, got ${role}`);
  const home = await fetch(`${BASE}/api/atelier/home`, { headers: await asPersona("u_yara_bgts") });
  assert.equal(home.status, 403, "partner_firm_resource must be 403 on /home");
  const me = await fetch(`${BASE}/api/atelier/me`, { headers: await asPersona("u_yara_bgts") });
  assert.equal(me.status, 200, "partner_firm_resource must keep /me");
  const engs = await fetch(`${BASE}/api/atelier/engagements`, { headers: await asPersona("u_yara_bgts") });
  assert.equal(engs.status, 200, "partner_firm_resource must keep /engagements");
});
