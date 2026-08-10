/**
 * Task #874 — Partner onboarding (invite + registration link) probes.
 *
 * Runs standalone (tsx ./tests/partner-registration/run.ts) booting the
 * app in-process; NODE_ENV=test enables the persona-cookie bypass for the
 * /api/atelier routes. The /api/auth registration routes are public.
 *
 * Coverage:
 *   1. Invite gate — unsigned firm 422, consultant 403, signed firm 201
 *      with a /partner-register link, duplicate active login 409.
 *   2. Token lifecycle — info on garbage token 404; valid info 200 with
 *      firm prefill; bad body 400 (token NOT consumed); successful
 *      registration; replay 404; expired token 404.
 *   3. Registration effects — company fields on the firm, credential
 *      user-managed, pending bank request (masked), firm bank columns
 *      NOT yet set, audits written.
 *   4. Bank maker-checker — consultant 403 on review routes; finance
 *      approve applies firm bank columns + audit; double-decide 409;
 *      reject leaves columns untouched.
 *   5. Resend — supersedes the old token; 409 once registered.
 *   6. Revoke — deactivate clears the login.
 *
 * NOTE: the /api/auth routes share a per-IP rate limit (10 per 15 min) —
 * keep the number of /api/auth calls in this file under that budget.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_pr_fp_${STAMP}`;
const CONS_ID = `p_test_pr_cons_${STAMP}`;
const FIN_ID = `p_test_pr_fin_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierPartnerFirms,
    atelierPartnerFirmBankChangeRequests,
    atelierAuthCredentials,
    atelierLoginActivationTokens,
    atelierAuditEvents,
  } = D as any;
  const { eq, like, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}`;
  const API = `${BASE}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
        origin: BASE,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  async function pub(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}/api/auth${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const tokenFromUrl = (u: string): string => new URL(u, BASE).searchParams.get("token") ?? "";

  const firmSignedId = `pfrm_test_pr_signed_${STAMP}`;
  const firmUnsignedId = `pfrm_test_pr_unsigned_${STAMP}`;
  const firmBId = `pfrm_test_pr_b_${STAMP}`;
  const partnerEmailA = `pr-partner-a-${STAMP}@example.com`;
  const partnerEmailB = `pr-partner-b-${STAMP}@example.com`;
  const createdUserIds: string[] = [];

  try {
    for (const p of [
      { id: FP_ID, role: "founding_partner", name: "PR FP" },
      { id: CONS_ID, role: "consultant", name: "PR Consultant" },
      { id: FIN_ID, role: "finance", name: "PR Finance" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@example.com`,
          name: p.name,
          initials: "PR",
          role: p.role,
          roleLabel: p.name,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    for (const [id, name, signed] of [
      [firmSignedId, `PR Signed Firm ${STAMP}`, true],
      [firmUnsignedId, `PR Unsigned Firm ${STAMP}`, false],
      [firmBId, `PR Signed Firm B ${STAMP}`, true],
    ] as const) {
      await db.insert(atelierPartnerFirms).values({
        id,
        orgId: ORG,
        name,
        status: "active",
        partnershipStage: signed ? "agreed" : "target",
        agreementStage: signed ? "signed" : null,
        createdByUserId: FP_ID,
      });
    }

    // ===================================================================
    group("invite gate");
    // ===================================================================
    {
      const r = await call("POST", `/partners/firms/${firmUnsignedId}/logins`, FP_ID, {
        name: "Unsigned Partner",
        email: `pr-unsigned-${STAMP}@example.com`,
      });
      check("unsigned firm \u2192 422", r.status === 422, `status=${r.status}`);
    }
    {
      const r = await call("POST", `/partners/firms/${firmSignedId}/logins`, CONS_ID, {
        name: "X",
        email: `x-${STAMP}@example.com`,
      });
      check("consultant invite \u2192 403", r.status === 403, `status=${r.status}`);
    }
    let regUrlA = "";
    {
      const r = await call("POST", `/partners/firms/${firmSignedId}/logins`, FP_ID, {
        name: "Partner A User",
        email: partnerEmailA,
      });
      check("signed firm invite \u2192 201", r.status === 201, `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
      regUrlA = String(r.body?.activationUrl ?? "");
      check(
        "invite link is a /partner-register link",
        regUrlA.includes("/partner-register?token="),
        regUrlA,
      );
      if (r.body?.userId) createdUserIds.push(r.body.userId);
    }
    {
      const r = await call("POST", `/partners/firms/${firmSignedId}/logins`, FP_ID, {
        name: "Second User",
        email: `pr-second-${STAMP}@example.com`,
      });
      check("duplicate active login \u2192 409", r.status === 409, `status=${r.status}`);
    }

    // ===================================================================
    group("token lifecycle + registration");
    // ===================================================================
    const tokenA = tokenFromUrl(regUrlA);
    {
      const r = await pub("GET", `/partner-register-info?token=garbage`);
      check("garbage token info \u2192 404", r.status === 404, `status=${r.status}`);
    }
    {
      const r = await pub("GET", `/partner-register-info?token=${tokenA}`);
      check(
        "valid token info \u2192 200 with email + firm name",
        r.status === 200 && r.body?.email === partnerEmailA && typeof r.body?.firm?.name === "string",
        JSON.stringify(r.body)?.slice(0, 200),
      );
    }
    const goodBody = {
      token: tokenA,
      newPassword: `Str0ng-Pass-${STAMP}`,
      company: {
        legalName: "Partner A Legal FZ-LLC",
        registrationNumber: "REG-12345",
        taxId: "TAX-98765",
        registeredAddress: "1 Probe Street, Dubai",
      },
      bank: { iban: "AE070331234567890123456", swift: "PROBEAEXXX", bankName: "Probe Bank", currency: "AED" },
    };
    {
      const r = await pub("POST", "/partner-register", { ...goodBody, bank: { ...goodBody.bank, iban: "x" } });
      check("bad IBAN \u2192 400 (token not consumed)", r.status === 400, `status=${r.status}`);
    }
    {
      const r = await pub("POST", "/partner-register", goodBody);
      check("registration \u2192 200 ok", r.status === 200 && r.body?.ok === true, `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
    {
      const r = await pub("POST", "/partner-register", goodBody);
      check("token replay \u2192 404", r.status === 404, `status=${r.status}`);
    }
    // Registration effects
    {
      const [firm] = await db
        .select()
        .from(atelierPartnerFirms)
        .where(eq(atelierPartnerFirms.id, firmSignedId));
      check("company details saved to firm", firm?.legalName === "Partner A Legal FZ-LLC" && firm?.taxId === "TAX-98765", JSON.stringify({ l: firm?.legalName }));
      check("firm bank columns NOT applied pre-approval", firm?.bankIban == null, String(firm?.bankIban));
      check("registrationCompletedAt stamped", firm?.registrationCompletedAt != null);
      const [cred] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, partnerEmailA));
      check("credential is user-managed after registration", cred?.userManaged === true);
      const reqs = await db
        .select()
        .from(atelierPartnerFirmBankChangeRequests)
        .where(eq(atelierPartnerFirmBankChangeRequests.partnerFirmId, firmSignedId));
      check("exactly one pending bank request", reqs.length === 1 && reqs[0].status === "pending", JSON.stringify(reqs.map((x: any) => x.status)));
      const audits = await db
        .select()
        .from(atelierAuditEvents)
        .where(eq(atelierAuditEvents.entityId, firmSignedId));
      const actions = audits.map((a: any) => a.action);
      check(
        "registration + bank-request audits written",
        actions.includes("partner_firm.registration.completed") && actions.includes("partner_firm.bank_change.requested"),
        JSON.stringify(actions),
      );
      check(
        "no raw IBAN in audit payloads",
        !JSON.stringify(audits).includes("AE070331234567890123456"),
      );
    }
    // Resend refused once registered
    {
      const userIdA = createdUserIds[0];
      const r = await call(
        "POST",
        `/partners/firms/${firmSignedId}/logins/${userIdA}/resend-registration`,
        FP_ID,
      );
      check("resend after registration \u2192 409", r.status === 409, `status=${r.status}`);
    }

    // ===================================================================
    group("bank maker-checker");
    // ===================================================================
    const [pendingReq] = await db
      .select()
      .from(atelierPartnerFirmBankChangeRequests)
      .where(eq(atelierPartnerFirmBankChangeRequests.partnerFirmId, firmSignedId));
    {
      const r = await call("GET", "/partners/bank-changes", CONS_ID);
      check("consultant \u2192 403 on review list", r.status === 403, `status=${r.status}`);
      const r2 = await call("POST", `/partners/bank-changes/${pendingReq.id}/approve`, CONS_ID);
      check("consultant \u2192 403 on approve", r2.status === 403, `status=${r2.status}`);
    }
    {
      const r = await call("GET", "/partners/bank-changes", FIN_ID);
      const item = (r.body?.items ?? []).find((x: any) => x.id === pendingReq.id);
      check(
        "finance sees pending row with MASKED iban",
        r.status === 200 && item && item.newIbanMasked?.endsWith("3456") && !JSON.stringify(r.body).includes("AE070331234567890123456"),
        JSON.stringify(item)?.slice(0, 200),
      );
    }
    {
      const r = await call("POST", `/partners/bank-changes/${pendingReq.id}/approve`, FIN_ID, { note: "verified" });
      check("finance approve \u2192 200", r.status === 200 && r.body?.ok === true, `status=${r.status}`);
      const [firm] = await db
        .select()
        .from(atelierPartnerFirms)
        .where(eq(atelierPartnerFirms.id, firmSignedId));
      check(
        "approve applies bank columns to firm",
        firm?.bankIban === "AE070331234567890123456" && firm?.bankSwift === "PROBEAEXXX" && firm?.bankCurrency === "AED",
        JSON.stringify({ iban: firm?.bankIban, cur: firm?.bankCurrency }),
      );
      const audits = await db
        .select()
        .from(atelierAuditEvents)
        .where(eq(atelierAuditEvents.entityId, firmSignedId));
      check(
        "approve audit written",
        audits.some((a: any) => a.action === "partner_firm.bank_change.approved"),
      );
      const r2 = await call("POST", `/partners/bank-changes/${pendingReq.id}/approve`, FIN_ID);
      check("double approve \u2192 409", r2.status === 409, `status=${r2.status}`);
    }
    {
      // Task #874 review fix — approved bank columns must NEVER ride on the
      // general firm directory/detail reads (visible to consultants).
      const RAW_IBAN = "AE070331234567890123456";
      const list = await call("GET", "/partners/firms", CONS_ID);
      check(
        "consultant firm directory leaks NO bank fields",
        list.status === 200 &&
          !JSON.stringify(list.body).includes(RAW_IBAN) &&
          !JSON.stringify(list.body).includes("bankIban") &&
          !JSON.stringify(list.body).includes("bankSwift"),
        `status=${list.status}`,
      );
      const detail = await call("GET", `/partners/firms/${firmSignedId}`, CONS_ID);
      check(
        "consultant firm detail leaks NO bank fields",
        detail.status === 200 &&
          !JSON.stringify(detail.body).includes(RAW_IBAN) &&
          !JSON.stringify(detail.body).includes("bankIban"),
        `status=${detail.status}`,
      );
      const fpDetail = await call("GET", `/partners/firms/${firmSignedId}`, FP_ID);
      check(
        "even leadership firm detail carries only bankDetailsOnFile flag",
        fpDetail.status === 200 &&
          fpDetail.body?.bankDetailsOnFile === true &&
          !JSON.stringify(fpDetail.body).includes(RAW_IBAN),
        JSON.stringify({ flag: fpDetail.body?.bankDetailsOnFile }),
      );
    }

    // ===================================================================
    group("resend supersedes + firm B reject path");
    // ===================================================================
    let userIdB = "";
    let regUrlB1 = "";
    {
      const r = await call("POST", `/partners/firms/${firmBId}/logins`, FP_ID, {
        name: "Partner B User",
        email: partnerEmailB,
      });
      check("firm B invite \u2192 201", r.status === 201, `status=${r.status}`);
      userIdB = String(r.body?.userId ?? "");
      regUrlB1 = String(r.body?.activationUrl ?? "");
      if (userIdB) createdUserIds.push(userIdB);
    }
    let regUrlB2 = "";
    {
      const r = await call(
        "POST",
        `/partners/firms/${firmBId}/logins/${userIdB}/resend-registration`,
        FP_ID,
      );
      check("resend before registration \u2192 200", r.status === 200 && r.body?.ok === true, `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
      regUrlB2 = String(r.body?.registrationUrl ?? "");
      check("resend returns a fresh /partner-register link", regUrlB2.includes("/partner-register?token="), regUrlB2);
    }
    {
      // consultant may not resend
      const r = await call(
        "POST",
        `/partners/firms/${firmBId}/logins/${userIdB}/resend-registration`,
        CONS_ID,
      );
      check("consultant resend \u2192 403", r.status === 403, `status=${r.status}`);
    }
    {
      const r = await pub("GET", `/partner-register-info?token=${tokenFromUrl(regUrlB1)}`);
      check("superseded (old) token \u2192 404", r.status === 404, `status=${r.status}`);
    }
    {
      const r = await pub("POST", "/partner-register", {
        token: tokenFromUrl(regUrlB2),
        newPassword: `Str0ng-Pass-B-${STAMP}`,
        company: { legalName: "Partner B Legal LLC" },
        bank: { iban: "AE070339999999990123456", swift: null, bankName: "B Bank", currency: "USD" },
      });
      check("firm B registration via resent token \u2192 200", r.status === 200 && r.body?.ok === true, `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
    {
      const [reqB] = await db
        .select()
        .from(atelierPartnerFirmBankChangeRequests)
        .where(eq(atelierPartnerFirmBankChangeRequests.partnerFirmId, firmBId));
      const r = await call("POST", `/partners/bank-changes/${reqB.id}/reject`, FIN_ID, { note: "IBAN mismatch" });
      check("finance reject \u2192 200", r.status === 200, `status=${r.status}`);
      const [firmB] = await db
        .select()
        .from(atelierPartnerFirms)
        .where(eq(atelierPartnerFirms.id, firmBId));
      check("reject leaves firm bank columns empty", firmB?.bankIban == null, String(firmB?.bankIban));
    }

    // ===================================================================
    group("expired token + revoke");
    // ===================================================================
    {
      // Age firm B's used token record aside — instead expire a fresh row
      // for user B directly and confirm the info route refuses it.
      const raw = `expiredprobe_${STAMP}`;
      const { createHash } = await import("node:crypto");
      await db.insert(atelierLoginActivationTokens).values({
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        email: partnerEmailB,
        userId: userIdB,
        createdByUserId: FP_ID,
        purpose: "partner_registration",
        expiresAt: new Date(Date.now() - 60_000),
      });
      const r = await pub("GET", `/partner-register-info?token=${raw}`);
      check("expired token \u2192 404", r.status === 404, `status=${r.status}`);
    }
    {
      const r = await call("POST", `/partners/firms/${firmBId}/logins/${userIdB}/deactivate`, FP_ID);
      check("deactivate partner login \u2192 200", r.status === 200, `status=${r.status}`);
      const [u] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, userIdB));
      check("deactivated user is soft-deleted", u?.deletedAt != null);
    }
  } finally {
    try {
      const emails = [partnerEmailA, partnerEmailB];
      await db.delete(atelierLoginActivationTokens).where(inArray(atelierLoginActivationTokens.email, emails));
      await db.delete(atelierAuthCredentials).where(inArray(atelierAuthCredentials.email, emails));
      await db
        .delete(atelierPartnerFirmBankChangeRequests)
        .where(inArray(atelierPartnerFirmBankChangeRequests.partnerFirmId, [firmSignedId, firmUnsignedId, firmBId]));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmSignedId, firmUnsignedId, firmBId]));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_pr_%_${STAMP}`));
      if (createdUserIds.length > 0) {
        await db.delete(atelierUsers).where(inArray(atelierUsers.id, createdUserIds));
      }
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [firmSignedId, firmUnsignedId, firmBId]));
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`\u2717 ${failures.length} probe(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\u2713 All partner-registration probes passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
