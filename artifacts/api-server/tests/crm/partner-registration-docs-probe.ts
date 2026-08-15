/**
 * Task #1172 — Partner registration document uploads + expiry tracking probe.
 *
 * Boots the real app in-process on an isolated scratch DB and exercises:
 *   1. Token-gated registration upload → list → delete of a pending doc.
 *   2. partner-register submit WITH contacts → contacts applied directly to
 *      the firm jsonb + roster promotion (pfr_pfc_* rows created).
 *   3. Partner-portal upload (uploadedVia "portal") + own-firm download.
 *   4. Cross-firm isolation: partner B cannot download partner A's doc (404).
 *   5. Internal review accept → the expiring accepted doc surfaces in
 *      /roster/compliance partnerBuckets (never as a compliance_records row).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/partner-registration-docs-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// Small valid-magic fixtures (leading signatures must match declared mime).
const PDF_BYTES = Buffer.from("%PDF-1.4 partner-doc-probe\n%%EOF\n");
const PDF_B64 = PDF_BYTES.toString("base64");
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("probe-png-body"),
]);
const PNG_B64 = PNG_BYTES.toString("base64");
// A >100KB PDF (~2MB) to prove the path-scoped 16mb parser is in effect
// (the global default 100KB parser would 413 this before routing).
const BIG_PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.alloc(2 * 1024 * 1024, 0x20),
  Buffer.from("\n%%EOF\n"),
]);
const BIG_PDF_B64 = BIG_PDF_BYTES.toString("base64");

function isoInDays(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAuthCredentials,
    atelierPartnerFirms,
    atelierPartnerFirmResources,
    atelierPartnerFirmDocuments,
    atelierComplianceRecords,
  } = D;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const authMod = await import("../../src/routes/auth/index.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const ROOT = `http://127.0.0.1:${port}/api`;
  const AUTH = `${ROOT}/auth`;
  const ATELIER = `${ROOT}/atelier`;

  const tag = `probe1172_${Date.now()}`;

  const jreq = async (
    url: string,
    method: string,
    body?: unknown,
    cookie?: string,
  ) => {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  // Internal partner-admin actor (senior_manager — inside canEditPartnersLens).
  const smId = `u_${tag}_sm`;
  // HR actor for /roster/compliance (sensitive-people gate).
  const hrId = `u_${tag}_hr`;

  // Firm A + its alliance-partner login.
  const firmAId = `pfrm_${tag}_a`;
  const userAId = `u_${tag}_pa`;
  const emailA = `${tag}_a@example.test`;
  // Firm B + its alliance-partner login (isolation).
  const firmBId = `pfrm_${tag}_b`;
  const userBId = `u_${tag}_pb`;
  const emailB = `${tag}_b@example.test`;

  try {
    await db.insert(atelierUsers).values([
      { id: smId, orgId: "aico", name: "P1172 SM", initials: "SM", email: `${tag}_sm@example.test`, role: "senior_manager", roleLabel: "Senior Manager", title: "Senior Manager" },
      { id: hrId, orgId: "aico", name: "P1172 HR", initials: "HR", email: `${tag}_hr@example.test`, role: "hr", roleLabel: "HR", title: "HR" },
      { id: userAId, orgId: "aico", name: "P1172 Partner A", initials: "PA", email: emailA, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmAId },
      { id: userBId, orgId: "aico", name: "P1172 Partner B", initials: "PB", email: emailB, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmBId },
    ] as any);

    await db.insert(atelierPartnerFirms).values([
      { id: firmAId, orgId: "aico", name: `P1172 Firm A ${tag}`, partnershipStage: "agreed", agreementStage: "signed" },
      { id: firmBId, orgId: "aico", name: `P1172 Firm B ${tag}`, partnershipStage: "agreed", agreementStage: "signed" },
    ] as any);

    await db.insert(atelierAuthCredentials).values([
      { email: emailA, userId: userAId, passwordHash: "x", userManaged: false },
      { email: emailB, userId: userBId, passwordHash: "x", userManaged: false },
    ] as any);

    // Mint partner_registration tokens (72h).
    const tokA = (await authMod.mintLoginToken({ email: emailA, userId: userAId, purpose: "partner_registration", ttlMs: 72 * 3600_000 })).rawToken;

    // --- 1. Registration upload → list → delete ------------------------
    const up1 = await jreq(`${AUTH}/partner-register-upload`, "POST", {
      token: tokA,
      kind: "trade_license",
      fileName: "trade-license.pdf",
      mime: "application/pdf",
      base64: PDF_B64,
      issuedDate: isoInDays(-30),
      expiryDate: isoInDays(20), // expiring within 30d
      title: "Trade License",
    });
    check("registration upload 201", up1.status === 201 && up1.body?.ok === true, up1);
    check("upload wire has no fileRef", up1.body?.document && !("fileRef" in up1.body.document), up1.body?.document);
    const docA1 = up1.body?.document?.id as string;

    // Note: the pre-auth /api/auth/* endpoints share a per-IP rate limit
    // (10 / 15 min), so this section is deliberately kept at exactly 10
    // auth calls (incl. the submit below). The large-payload + content
    // validation for the portal upload path is re-checked in section 3.

    // Large payload (~2MB PDF, >100KB) must succeed → proves the path-scoped
    // 16mb parser runs before the default 100KB parser (else 413). We keep
    // this doc (pending, never accepted) — it is harmless to the later flow.
    const bigUp = await jreq(`${AUTH}/partner-register-upload`, "POST", {
      token: tokA, kind: "other", fileName: "big.pdf", mime: "application/pdf", base64: BIG_PDF_B64,
    });
    check("large (>100KB) upload accepted (path-scoped 16mb parser)", bigUp.status === 201 && (bigUp.body?.document?.sizeBytes ?? 0) > 100_000, bigUp.status);

    // A second doc we will delete — PNG bytes with matching image/png mime.
    const up2 = await jreq(`${AUTH}/partner-register-upload`, "POST", {
      token: tokA, kind: "certificate", fileName: "cert.png", mime: "image/png", base64: PNG_B64,
    });
    check("registration upload #2 (valid PNG magic) 201", up2.status === 201, up2);
    const docA2 = up2.body?.document?.id as string;

    // Content/label mismatch: PDF bytes labeled image/png must be rejected.
    const mismatch = await jreq(`${AUTH}/partner-register-upload`, "POST", {
      token: tokA, kind: "other", fileName: "fake.png", mime: "image/png", base64: PDF_B64,
    });
    check("mime/content mismatch → 400 content-mismatch", mismatch.status === 400 && mismatch.body?.error === "content-mismatch", mismatch);

    // Invalid base64 → 400 invalid-base64.
    const badB64 = await jreq(`${AUTH}/partner-register-upload`, "POST", {
      token: tokA, kind: "other", fileName: "x.pdf", mime: "application/pdf", base64: "not*valid*base64==",
    });
    check("invalid base64 → 400", badB64.status === 400 && badB64.body?.error === "invalid-base64", badB64);

    const list1 = await jreq(`${AUTH}/partner-register-documents?token=${tokA}`, "GET");
    check("registration list shows 3 docs", list1.status === 200 && list1.body?.documents?.length === 3, list1.body);

    const del = await jreq(`${AUTH}/partner-register-document`, "DELETE", { token: tokA, documentId: docA2 });
    check("delete pending registration doc ok (now 2)", del.status === 200 && del.body?.ok === true, del);

    // info route surfaces documents + (empty) contacts before submit.
    const info = await jreq(`${AUTH}/partner-register-info?token=${tokA}`, "GET");
    check("register-info returns documents + contacts arrays", info.status === 200 && Array.isArray(info.body?.documents) && Array.isArray(info.body?.contacts) && info.body.documents.length === 2, info.body);

    // --- 2. Submit registration WITH contacts --------------------------
    const submit = await jreq(`${AUTH}/partner-register`, "POST", {
      token: tokA,
      newPassword: "Sup3r-Str0ng-Passw0rd!",
      company: { legalName: `Firm A Legal ${tag}`, registrationNumber: "RN-123", taxId: "TX-9", registeredAddress: "1 Road" },
      bank: { iban: "AE070331234567890123456", swift: "EBILAEAD", bankName: "ENBD", currency: "AED" },
      contacts: [
        { name: "Alice Partner", role: "CEO", email: "alice@firm-a.test" },
        { name: "Bob Partner", role: "CFO" },
      ],
    });
    check("partner-register submit ok", submit.status === 200 && submit.body?.ok === true, submit);

    const [firmARow] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
    const contacts = (firmARow?.contacts ?? []) as any[];
    check("contacts applied to firm jsonb (2)", contacts.length === 2 && contacts.every((c) => !!c.personId), contacts);

    const pfrRows = await db.select().from(atelierPartnerFirmResources).where(eq(atelierPartnerFirmResources.partnerFirmId, firmAId));
    check("roster promotion created PFR rows for contacts", pfrRows.length >= 2, pfrRows.map((r) => r.id));

    // Token consumed → further token calls 404.
    const afterSubmit = await jreq(`${AUTH}/partner-register-documents?token=${tokA}`, "GET");
    check("token consumed after submit → 404", afterSubmit.status === 404, afterSubmit);

    // --- 3. Partner-portal upload + own-firm download ------------------
    const cookieA = `atelier_persona=${userAId}`;
    const cookieB = `atelier_persona=${userBId}`;

    // Large (>100KB) portal upload proves app.ts path-scoped parser covers
    // /partner-portal/company-documents too.
    const portalBig = await jreq(`${ATELIER}/partner-portal/company-documents`, "POST", {
      kind: "other", fileName: "big.pdf", mime: "application/pdf", base64: BIG_PDF_B64,
    }, cookieA);
    check("portal large (>100KB) upload accepted", portalBig.status === 201 && (portalBig.body?.document?.sizeBytes ?? 0) > 100_000, portalBig.status);

    // Portal mime/content mismatch → 400 content-mismatch.
    const portalMismatch = await jreq(`${ATELIER}/partner-portal/company-documents`, "POST", {
      kind: "other", fileName: "fake.png", mime: "image/png", base64: PDF_B64,
    }, cookieA);
    check("portal mime/content mismatch → 400", portalMismatch.status === 400 && portalMismatch.body?.error === "content-mismatch", portalMismatch);

    const portalUp = await jreq(`${ATELIER}/partner-portal/company-documents`, "POST", {
      kind: "insurance", fileName: "insurance.pdf", mime: "application/pdf", base64: PDF_B64, expiryDate: isoInDays(45),
    }, cookieA);
    check("portal upload 201 (uploadedVia portal)", portalUp.status === 201 && portalUp.body?.document?.uploadedVia === "portal", portalUp);
    const portalDocId = portalUp.body?.document?.id as string;

    const profile = await jreq(`${ATELIER}/partner-portal/company-profile`, "GET", undefined, cookieA);
    // Bank details stay pending finance approval (never applied at
    // registration), so bankDetailsOnFile is false / iban not masked yet.
    check("company-profile returns docs + contacts + legal fields", profile.status === 200 && profile.body?.documents?.length >= 2 && profile.body?.contacts?.length >= 2 && profile.body?.firm?.legalName?.includes("Firm A Legal"), profile.body?.firm);

    const dlOwn = await fetch(`${ATELIER}/partner-portal/company-documents/${portalDocId}/download`, { headers: { cookie: cookieA } });
    check("own-firm download 200", dlOwn.status === 200, dlOwn.status);
    check("download sets X-Content-Type-Options: nosniff", dlOwn.headers.get("x-content-type-options") === "nosniff", dlOwn.headers.get("x-content-type-options"));

    // --- 4. Cross-firm isolation --------------------------------------
    const dlForeign = await fetch(`${ATELIER}/partner-portal/company-documents/${portalDocId}/download`, { headers: { cookie: cookieB } });
    check("partner B cannot download partner A doc (404)", dlForeign.status === 404, dlForeign.status);

    // partner B has no firm docs of its own.
    const profileB = await jreq(`${ATELIER}/partner-portal/company-profile`, "GET", undefined, cookieB);
    check("firm B profile isolated (0 docs)", profileB.status === 200 && profileB.body?.documents?.length === 0, profileB.body?.documents);

    // --- 5. Internal review accept → surfaces in compliance -----------
    // The registration doc (docA1) expires in 20d → will land in expiring_30.
    const queue = await jreq(`${ATELIER}/partners/firm-documents?status=pending`, "GET", undefined, `atelier_persona=${smId}`);
    check("internal pending queue lists docs", queue.status === 200 && queue.body?.items?.some((d: any) => d.id === docA1), queue.body?.items?.length);

    // Consultant-level (alliance_partner) cannot reach internal queue.
    const queueDenied = await jreq(`${ATELIER}/partners/firm-documents?status=pending`, "GET", undefined, cookieA);
    check("alliance_partner blocked from internal queue", queueDenied.status === 403, queueDenied.status);

    const review = await jreq(`${ATELIER}/partners/firm-documents/${docA1}/review`, "POST", { decision: "accepted", note: "ok" }, `atelier_persona=${smId}`);
    check("internal review accept ok", review.status === 200 && review.body?.ok === true, review);

    const reviewAgain = await jreq(`${ATELIER}/partners/firm-documents/${docA1}/review`, "POST", { decision: "rejected" }, `atelier_persona=${smId}`);
    check("re-review already-decided → 409", reviewAgain.status === 409, reviewAgain);

    const compliance = await jreq(`${ATELIER}/roster/compliance?horizonDays=90`, "GET", undefined, `atelier_persona=${hrId}`);
    const firmDocRecord = (compliance.body?.records ?? []).find((r: any) => r.id === docA1);
    check("accepted firm doc appears in compliance records", compliance.status === 200 && !!firmDocRecord, compliance.status);
    check("firm doc record shape (kind firm_doc:, no personId, partnerFirmId set)", firmDocRecord && firmDocRecord.kind === "firm_doc:trade_license" && firmDocRecord.personId === null && firmDocRecord.partnerFirmId === firmAId && firmDocRecord.metadata?.firmDocument === true, firmDocRecord);
    check("firm doc counts into partnerBuckets (expiring_30)", (compliance.body?.partnerBuckets?.expiring_30 ?? 0) >= 1, compliance.body?.partnerBuckets);

    // Never persisted to compliance_records.
    const persisted = await db.select().from(atelierComplianceRecords).where(eq(atelierComplianceRecords.id, docA1));
    check("firm doc NOT written to compliance_records table", persisted.length === 0, persisted.length);

    // --- 6. Portal contact-suggestion → internal approve (REPLACE) -----
    // The portal sends the FULL edited list: it edits Alice's role (matched
    // by email → keeps her id + personId), keeps Bob (matched by name), and
    // adds Carol. Approving REPLACES the firm's contact list — so we expect
    // exactly 3 contacts and NO duplicate PFR roster rows for Alice/Bob.
    const pfrBefore = await db.select().from(atelierPartnerFirmResources).where(eq(atelierPartnerFirmResources.partnerFirmId, firmAId));
    const pfrCountBefore = pfrBefore.filter((r) => !r.deletedAt).length;

    const sug = await jreq(`${ATELIER}/partner-portal/contact-suggestions`, "POST", {
      contacts: [
        { name: "Alice Partner", role: "Chief Executive", email: "alice@firm-a.test" }, // edited role, same email
        { name: "Bob Partner", role: "CFO" }, // unchanged (match by name)
        { name: "Carol New", role: "COO", email: "carol@firm-a.test" }, // added
      ],
      note: "edit alice + add carol",
    }, cookieA);
    check("portal contact-suggestion 201", sug.status === 201 && sug.body?.ok === true, sug);
    const sugId = sug.body?.suggestionId as string;

    const decide = await jreq(`${ATELIER}/partners/contact-suggestions/${sugId}/decide`, "POST", { decision: "approved" }, `atelier_persona=${smId}`);
    check("internal approve suggestion ok", decide.status === 200 && decide.body?.ok === true, decide);

    const [firmAAfter] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
    const contactsAfter = (firmAAfter?.contacts ?? []) as any[];
    check("approved suggestion REPLACES list (exactly 3 contacts)", contactsAfter.length === 3, contactsAfter.map((c) => c.name));
    check("edited contact kept its role (Alice → Chief Executive)", contactsAfter.some((c) => c.name === "Alice Partner" && c.role === "Chief Executive" && !!c.personId), contactsAfter);
    check("new contact promoted (Carol has personId)", contactsAfter.some((c) => c.name === "Carol New" && !!c.personId), contactsAfter);

    // No duplicate PFR roster rows: existing 2 preserved (same ids) + Carol = +1.
    const pfrAfter = await db.select().from(atelierPartnerFirmResources).where(eq(atelierPartnerFirmResources.partnerFirmId, firmAId));
    const pfrCountAfter = pfrAfter.filter((r) => !r.deletedAt).length;
    check("no duplicate PFR rows on edit (net +1 for the new contact)", pfrCountAfter === pfrCountBefore + 1, { pfrCountBefore, pfrCountAfter });
    // Alice/Bob personIds unchanged (not re-promoted).
    const alicePersonBefore = ((await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId)))[0]?.contacts as any[])?.find((c) => c.email === "alice@firm-a.test")?.personId;
    check("edited contact personId stable (no re-promotion)", typeof alicePersonBefore === "string" && alicePersonBefore.length > 0, alicePersonBefore);
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll partner-registration-docs checks passed.");
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
