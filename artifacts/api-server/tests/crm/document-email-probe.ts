/**
 * Task #637 — email own personal documents from chat via Outlook.
 *
 * Deterministic probe (no real Microsoft, no LLM): the Graph API is a
 * local HTTP stub via MS_LOGIN_BASE_URL / MS_GRAPH_BASE_URL and the
 * capability is invoked directly through the registry.
 *
 * Covers:
 *   1. Catalog surface: email_my_documents registered, isWrite,
 *      two-phase, outboundChannel email, id under me.* (self-only
 *      personas see it), no person/user selector fields.
 *   2. matchOwnDocuments pure fuzzy matcher.
 *   3. No MS connection → ms_not_connected (before any confirm card).
 *   4. Draft happy path: confirm frame first (no Graph traffic), then
 *      commit → POST /me/messages with base64 attachments, webLink in
 *      the result, navigateTo: null, audit row written.
 *   5. National ID front+back → BOTH sides attached.
 *   6. Multi-doc query ("passport and visa") → both attached.
 *   7. Ambiguous query (two visas) → options prompt, no Graph call.
 *   8. Send mode: diff carries irreversible + typedNameRequired; commit
 *      → POST /me/sendMail.
 *   9. Stale consent (token refresh returns no Mail scopes) →
 *      ms_reconnect_required, nothing sent.
 *  10. Oversize file (>3 MB) → attachment_too_large before confirm.
 *  11. Invalid recipient → invalid_recipients.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/document-email-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import http from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierPersonDocuments,
    atelierMsConnections,
    atelierAuditEvents,
  } = D as any;
  const { and, eq, like } = await import("drizzle-orm");

  process.env.MS_TOKEN_ENC_SECRET = "probe-enc-secret";
  process.env.MS_CLIENT_ID = process.env.MS_CLIENT_ID || "probe-client";
  process.env.MS_TENANT_ID = process.env.MS_TENANT_ID || "probe-tenant";
  process.env.MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || "probe-secret";

  // ---- Microsoft stub ------------------------------------------------
  // tokenScope is mutable so one probe run can simulate both a modern
  // connection (Mail scopes granted) and a stale one (no Mail scopes).
  let tokenScope =
    "openid profile offline_access User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send";
  const graphCalls: Array<{ method: string; url: string; body: any }> = [];
  const stub = http.createServer((req, res) => {
    const url = req.url ?? "";
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "POST" && url.includes("/oauth2/v2.0/token")) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            access_token: "stub-access",
            refresh_token: "stub-refresh-2",
            expires_in: 3600,
            scope: tokenScope,
          }),
        );
        return;
      }
      if (req.method === "POST" && url.startsWith("/me/messages")) {
        let parsed: any = null;
        try {
          parsed = JSON.parse(body);
        } catch {}
        graphCalls.push({ method: "POST", url, body: parsed });
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: `draft_${graphCalls.length}`,
            webLink: `https://outlook.test/draft/${graphCalls.length}`,
            subject: parsed?.subject,
          }),
        );
        return;
      }
      if (req.method === "POST" && url.startsWith("/me/sendMail")) {
        let parsed: any = null;
        try {
          parsed = JSON.parse(body);
        } catch {}
        graphCalls.push({ method: "POST", url, body: parsed });
        res.statusCode = 202;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.MS_LOGIN_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.MS_GRAPH_BASE_URL = `http://127.0.0.1:${stubPort}`;

  const gm = await import("../../src/lib/msGraph.js");
  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { findByToolName, capabilitiesForPersona } = catalog as any;
  const mw = await import("../../src/lib/atelier-cli/me-write-capabilities.js");
  const { storePersonDocBytes } = await import("../../src/lib/personDocStorage.js");

  const STAMP = Date.now();
  const TAG = `__t637_${STAMP}`;
  const ORG = "aico";
  const UID = `p_test_de_${STAMP}`;
  const PERSON = `emp_test_de_${STAMP}`;
  const persona = { id: UID, name: "Doc Emailer", role: "employee", orgId: ORG };

  const runTool = async (input: Record<string, unknown>) => {
    const entry = findByToolName("email_my_documents");
    if (!entry) throw new Error("email_my_documents not registered");
    return entry.run(input, { persona } as any);
  };

  const docIds: string[] = [];
  const seedDoc = async (args: {
    kind: string;
    title: string;
    fileName: string;
    mime: string;
    bytes: Buffer;
    backBytes?: Buffer;
    sizeOverride?: number;
  }) => {
    const stored = await storePersonDocBytes(args.bytes, args.mime);
    let backFileRef: string | null = null;
    let backSizeBytes: number | null = null;
    if (args.backBytes) {
      const b = await storePersonDocBytes(args.backBytes, args.mime);
      backFileRef = b.fileRef;
      backSizeBytes = b.sizeBytes;
    }
    const id = `pdoc_${TAG}_${docIds.length}`;
    docIds.push(id);
    await db.insert(atelierPersonDocuments).values({
      id,
      orgId: ORG,
      personType: "employee",
      personId: PERSON,
      kind: args.kind,
      title: args.title,
      fileRef: stored.fileRef,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: args.sizeOverride ?? stored.sizeBytes,
      backFileRef,
      backFileName: backFileRef ? `${args.fileName}-back.jpg` : null,
      backMime: backFileRef ? args.mime : null,
      backSizeBytes,
      uploadedByUserId: UID,
      createdByUserId: UID,
    });
    return id;
  };

  try {
    // ---- seed persona + roster --------------------------------------
    await db.insert(atelierUsers).values({
      id: UID,
      orgId: ORG,
      name: `Doc Emailer ${TAG}`,
      initials: "DE",
      email: `de${STAMP}@test.local`,
      role: "employee",
      roleLabel: "Employee",
      title: "Consultant",
    });
    await db.insert(atelierEmployees).values({
      id: PERSON,
      orgId: ORG,
      userId: UID,
      fullName: `Doc Emailer ${TAG}`,
      email: `de${STAMP}@test.local`,
      role: "consultant",
      status: "active",
    });

    // ---- 1. catalog surface -----------------------------------------
    const entry = findByToolName("email_my_documents");
    check("registered", Boolean(entry));
    check("isWrite + twoPhase", entry?.isWrite === true && entry?.twoPhaseConfirm === true);
    check("outboundChannel email", entry?.outboundChannel === "email");
    check("id is me.*", entry?.id === "me.document_email");
    const props = Object.keys(entry?.inputSchema?.properties ?? {});
    check(
      "no selector fields",
      !props.some((p) => ["userId", "personId", "email", "forUser", "user"].includes(p)),
    );
    const empTools = capabilitiesForPersona("employee").map((e: any) => e.id);
    check("employee persona sees it", empTools.includes("me.document_email"));

    // ---- 2. pure matcher ---------------------------------------------
    const fakeDocs = [
      { id: "a", kind: "passport", title: "UAE Passport", fileName: "pass.pdf" },
      { id: "b", kind: "national_id", title: "Emirates ID", fileName: "eid.pdf" },
    ] as any[];
    check(
      "matcher: 'passport' hits kind",
      (mw as any).matchOwnDocuments(fakeDocs, "passport").length === 1,
    );
    check(
      "matcher: 'national id' normalizes underscore",
      (mw as any).matchOwnDocuments(fakeDocs, "national id")[0]?.id === "b",
    );
    check(
      "matcher: 'emirates' hits title",
      (mw as any).matchOwnDocuments(fakeDocs, "emirates id")[0]?.id === "b",
    );
    check("matcher: junk misses", (mw as any).matchOwnDocuments(fakeDocs, "driving licence").length === 0);

    // ---- seed documents ------------------------------------------------
    const passportId = await seedDoc({
      kind: "passport",
      title: "UAE Passport",
      fileName: "passport.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(`%PDF-passport-${TAG}`),
    });
    const nidId = await seedDoc({
      kind: "national_id",
      title: "Emirates ID",
      fileName: "eid-front.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from(`front-${TAG}`),
      backBytes: Buffer.from(`back-${TAG}`),
    });
    const visa1 = await seedDoc({
      kind: "visa",
      title: "UAE Visa 2025",
      fileName: "visa25.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(`visa25-${TAG}`),
    });
    await seedDoc({
      kind: "visa",
      title: "UAE Visa 2026",
      fileName: "visa26.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(`visa26-${TAG}`),
    });
    const bigId = await seedDoc({
      kind: "other",
      title: "Huge Scan",
      fileName: "huge.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("small-but-lies"),
      sizeOverride: 5 * 1024 * 1024,
    });

    // ---- 3. no connection ---------------------------------------------
    const noConn = await runTool({ query: "passport", to: ["jane@x.com"] });
    check("no connection → ms_not_connected", noConn.ok === false && noConn.errorCode === "ms_not_connected");

    // connect
    await db.insert(atelierMsConnections).values({
      id: `msc_${TAG}`,
      orgId: ORG,
      userId: UID,
      msOid: "ms-oid-de",
      msEmail: `de${STAMP}@test.local`,
      msDisplayName: "Doc Emailer",
      encRefreshToken: gm.encryptToken("stub-refresh-1"),
      scopes: tokenScope.split(" "),
    });

    // ---- 11. unresolvable recipient --------------------------------------
    // Non-email entries are now treated as people names and looked up in
    // the roster + CRM contacts; a miss is an honest recipient_not_found.
    const badTo = await runTool({ query: "passport", to: ["not-an-email"] });
    check("unknown name → recipient_not_found", badTo.ok === false && badTo.errorCode === "recipient_not_found");

    // ---- 10. oversize refused before confirm ---------------------------
    const big = await runTool({ documentIds: [bigId], to: ["jane@x.com"] });
    check("oversize → attachment_too_large", big.ok === false && big.errorCode === "attachment_too_large");

    // ---- 7. ambiguous query (two visas) --------------------------------
    const ambiguous = await runTool({ query: "visa", to: ["jane@x.com"] });
    check(
      "ambiguous → options prompt",
      ambiguous.ok === true &&
        Array.isArray(ambiguous.data?.options) &&
        ambiguous.data.options.length === 2 &&
        !ambiguous.confirmation,
      JSON.stringify(ambiguous).slice(0, 300),
    );
    check("no Graph traffic yet", graphCalls.length === 0);

    // ---- 4. draft happy path -------------------------------------------
    const first = await runTool({ query: "passport", to: ["Jane@X.com"] });
    check("draft: confirm frame", first.ok === true && Boolean(first.confirmation), JSON.stringify(first).slice(0, 300));
    check(
      "draft: diff NOT typed-name gated",
      first.confirmation?.diff?.typedNameRequired === undefined &&
        first.confirmation?.diff?.irreversible === undefined,
    );
    check("draft: still no Graph traffic", graphCalls.length === 0);
    const commit = await runTool(first.confirmation.pending.input);
    check("draft: commit ok", commit.ok === true, JSON.stringify(commit).slice(0, 300));
    check("draft: webLink returned", String(commit.data?.outlookDraftLink ?? "").startsWith("https://outlook.test/draft/"));
    check("draft: navigateTo null", commit.data?.navigateTo === null);
    const draftCall = graphCalls.find((c) => c.url.startsWith("/me/messages"));
    check("draft: POST /me/messages", Boolean(draftCall));
    check(
      "draft: recipient lowercased",
      draftCall?.body?.toRecipients?.[0]?.emailAddress?.address === "jane@x.com",
    );
    check(
      "draft: attachment base64 matches",
      draftCall?.body?.attachments?.length === 1 &&
        Buffer.from(draftCall.body.attachments[0].contentBytes, "base64").toString() ===
          `%PDF-passport-${TAG}`,
    );
    const [auditRow] = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.action, "person_document.self_emailed"),
          eq(atelierAuditEvents.entityId, passportId),
        ),
      );
    check("draft: audit row", Boolean(auditRow) && auditRow.payload?.mode === "draft");

    // ---- 5. national ID front+back -------------------------------------
    graphCalls.length = 0;
    const nidFirst = await runTool({ documentIds: [nidId], to: ["jane@x.com"] });
    check("nid: summary mentions front + back", String(nidFirst.confirmation?.summary ?? "").includes("front + back"));
    const nidCommit = await runTool(nidFirst.confirmation.pending.input);
    const nidCall = graphCalls.find((c) => c.url.startsWith("/me/messages"));
    check(
      "nid: both sides attached",
      nidCommit.ok === true && nidCall?.body?.attachments?.length === 2,
      JSON.stringify(nidCall?.body?.attachments?.map((a: any) => a.name)),
    );

    // ---- 6. multi-doc query ---------------------------------------------
    graphCalls.length = 0;
    const multiFirst = await runTool({
      query: "passport and UAE Visa 2025",
      to: ["jane@x.com"],
      subject: "My documents",
    });
    check(
      "multi: two docs resolved",
      Array.isArray(multiFirst.confirmation?.pending?.input?.documentIds) &&
        multiFirst.confirmation.pending.input.documentIds.length === 2,
      JSON.stringify(multiFirst).slice(0, 300),
    );
    const multiCommit = await runTool(multiFirst.confirmation.pending.input);
    const multiCall = graphCalls.find((c) => c.url.startsWith("/me/messages"));
    check(
      "multi: two attachments + subject",
      multiCommit.ok === true &&
        multiCall?.body?.attachments?.length === 2 &&
        multiCall?.body?.subject === "My documents",
    );

    // ---- 8. direct send ---------------------------------------------------
    graphCalls.length = 0;
    const sendFirst = await runTool({ documentIds: [visa1], to: ["jane@x.com"], mode: "send" });
    check(
      "send: typed-name + irreversible in diff",
      sendFirst.confirmation?.diff?.irreversible === true &&
        sendFirst.confirmation?.diff?.typedNameRequired === "jane@x.com" &&
        sendFirst.confirmation?.diff?.outboundChannel === "email",
      JSON.stringify(sendFirst.confirmation?.diff),
    );
    const sendCommit = await runTool(sendFirst.confirmation.pending.input);
    check(
      "send: POST /me/sendMail",
      sendCommit.ok === true && graphCalls.some((c) => c.url.startsWith("/me/sendMail")),
      JSON.stringify(sendCommit).slice(0, 300),
    );
    check("send: navigateTo null", sendCommit.data?.navigateTo === null);

    // ---- 9. stale consent (refresh drops Mail scopes) ----------------------
    graphCalls.length = 0;
    tokenScope = "openid profile offline_access User.Read Calendars.ReadWrite";
    const staleFirst = await runTool({ documentIds: [passportId], to: ["jane@x.com"] });
    check("stale: confirm frame still offered", Boolean(staleFirst.confirmation));
    const staleCommit = await runTool(staleFirst.confirmation.pending.input);
    check(
      "stale: ms_reconnect_required",
      staleCommit.ok === false && staleCommit.errorCode === "ms_reconnect_required",
      JSON.stringify(staleCommit).slice(0, 300),
    );
    check("stale: no message calls", !graphCalls.some((c) => c.url.startsWith("/me/")));
    tokenScope =
      "openid profile offline_access User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send";

    // ====================================================================
    // 12. Recipient NAME resolution (roster + CRM contacts)
    // ====================================================================
    await db.insert(atelierUsers).values([
      {
        id: `p_test_g1_${STAMP}`,
        orgId: ORG,
        name: `Gokhanx One ${TAG}`,
        initials: "G1",
        email: `gokhanx1.${STAMP}@test.local`,
        role: "consultant",
        roleLabel: "Consultant",
        title: "Consultant",
      },
      {
        id: `p_test_g2_${STAMP}`,
        orgId: ORG,
        name: `Gokhanx Two ${TAG}`,
        initials: "G2",
        email: `gokhanx2.${STAMP}@test.local`,
        role: "consultant",
        roleLabel: "Consultant",
        title: "Consultant",
      },
      {
        id: `p_test_z_${STAMP}`,
        orgId: ORG,
        name: `Zeynepx Unique ${TAG}`,
        initials: "ZU",
        email: `zeynepx.${STAMP}@test.local`,
        role: "consultant",
        roleLabel: "Consultant",
        title: "Consultant",
      },
    ]);

    graphCalls.length = 0;
    // single roster match → straight to the confirm card with the email
    const byName = await runTool({ documentIds: [passportId], to: ["Zeynepx"] });
    check(
      "name: single match → confirm frame",
      byName.ok === true && Boolean(byName.confirmation),
      JSON.stringify(byName).slice(0, 300),
    );
    check(
      "name: summary shows Name <email>",
      String(byName.confirmation?.summary ?? "").includes(
        `Zeynepx Unique ${TAG} <zeynepx.${STAMP}@test.local>`,
      ),
      byName.confirmation?.summary,
    );
    check(
      "name: pending input carries resolved email",
      byName.confirmation?.pending?.input?.to?.[0] === `zeynepx.${STAMP}@test.local`,
    );

    // multiple roster matches → disambiguation options, no confirm card
    const multiName = await runTool({ documentIds: [passportId], to: ["Gokhanx"] });
    check(
      "name: multi-match → options",
      multiName.ok === true &&
        !multiName.confirmation &&
        Array.isArray(multiName.data?.options) &&
        multiName.data.options.length === 2 &&
        multiName.disambiguation?.kind === "email_recipient",
      JSON.stringify(multiName).slice(0, 400),
    );
    check(
      "name: option ids are emails",
      multiName.data?.options?.every((o: any) => String(o.id).includes("@")),
    );
    check("name: no Graph traffic on lookup", graphCalls.length === 0);

    // ====================================================================
    // 13. email_company_documents (Document Library)
    // ====================================================================
    const dc = await import("../../src/lib/atelier-cli/document-email-capabilities.js");
    void dc;
    const compEntry = findByToolName("email_company_documents");
    check("company: registered", Boolean(compEntry));
    check(
      "company: isWrite + twoPhase + email channel",
      compEntry?.isWrite === true &&
        compEntry?.twoPhaseConfirm === true &&
        compEntry?.outboundChannel === "email",
    );

    const FP_UID = `p_test_fp_${STAMP}`;
    await db.insert(atelierUsers).values({
      id: FP_UID,
      orgId: ORG,
      name: `Founder Probe ${TAG}`,
      initials: "FP",
      email: `fp.${STAMP}@test.local`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    });
    const fpPersona = { id: FP_UID, name: `Founder Probe ${TAG}`, role: "founding_partner", orgId: ORG };
    const runCompany = async (input: Record<string, unknown>, p = fpPersona) =>
      compEntry.run(input, { persona: p } as any);

    const { createDocument } = await import("../../src/lib/atelier-documents.js");
    const created = await createDocument({
      orgId: ORG,
      uploader: { id: FP_UID, name: `Founder Probe ${TAG}` },
      title: `Commercial Registration Certificate Dubai ${TAG}`,
      category: "other",
      docKind: "commercial_register",
      fileName: "registration-cert.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(`%PDF-regcert-${TAG}`),
    });
    check("company: library doc created", created.ok === true, JSON.stringify(created).slice(0, 200));
    const libDocId = created.ok ? created.document.id : "";

    // CRM contact for recipient resolution via contacts
    const ACC_ID = `acc_${TAG}`;
    await db.insert(D.atelierAccounts).values({
      id: ACC_ID,
      orgId: ORG,
      name: `Probe Account ${TAG}`,
      country: "AE",
      sector: "technology",
    });
    await db.insert(D.atelierContacts).values({
      id: `ct_${TAG}`,
      orgId: ORG,
      accountId: ACC_ID,
      fullName: `Contactx Person ${TAG}`,
      email: `contactx.${STAMP}@client.test`,
    });

    // FP needs an MS connection before the confirm card
    await db.insert(atelierMsConnections).values({
      id: `msc_fp_${TAG}`,
      orgId: ORG,
      userId: FP_UID,
      msOid: "ms-oid-fp",
      msEmail: `fp.${STAMP}@test.local`,
      msDisplayName: "Founder Probe",
      encRefreshToken: gm.encryptToken("stub-refresh-1"),
      scopes: tokenScope.split(" "),
    });

    graphCalls.length = 0;
    // fuzzy library match + roster-name recipient → confirm card
    const compFirst = await runCompany({
      query: "company registration certificate in Dubai",
      to: ["Zeynepx"],
    });
    check(
      "company: confirm frame with resolved recipient",
      compFirst.ok === true &&
        Boolean(compFirst.confirmation) &&
        String(compFirst.confirmation?.summary ?? "").includes(`zeynepx.${STAMP}@test.local`),
      JSON.stringify(compFirst).slice(0, 400),
    );
    check(
      "company: pending tool is email_company_documents",
      compFirst.confirmation?.pending?.tool === "email_company_documents",
    );
    const compCommit = await runCompany(compFirst.confirmation.pending.input);
    check("company: commit ok", compCommit.ok === true, JSON.stringify(compCommit).slice(0, 300));
    const compCall = graphCalls.find((c) => c.url.startsWith("/me/messages"));
    check(
      "company: attachment bytes match",
      compCall?.body?.attachments?.length === 1 &&
        Buffer.from(compCall.body.attachments[0].contentBytes, "base64").toString() ===
          `%PDF-regcert-${TAG}`,
      JSON.stringify(compCall?.body?.attachments?.map((a: any) => a.name)),
    );
    const [compAudit] = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(eq(atelierAuditEvents.action, "document.emailed"), eq(atelierAuditEvents.entityId, libDocId)),
      );
    check("company: audit row", Boolean(compAudit) && compAudit.payload?.mode === "draft");

    // CRM-contact recipient resolves too
    const compContact = await runCompany({ documentIds: [libDocId], to: ["Contactx"] });
    check(
      "company: CRM contact resolves",
      compContact.ok === true &&
        String(compContact.confirmation?.summary ?? "").includes(`contactx.${STAMP}@client.test`),
      JSON.stringify(compContact).slice(0, 300),
    );

    // visibility: the employee persona cannot see the FP's org-level doc
    const compHidden = await runCompany(
      { query: "registration certificate", to: [`zeynepx.${STAMP}@test.local`] },
      persona,
    );
    check(
      "company: hidden from non-privileged persona",
      compHidden.ok === false && compHidden.errorCode === "doc_not_found",
      JSON.stringify(compHidden).slice(0, 200),
    );

    // ====================================================================
    // 14. Task #679 — fold search, embedding floor, typed-name, card shapes
    // ====================================================================
    // 14a. accent-folded contact name search: "Gokhan" must find "Gökhan"
    await db.insert(D.atelierContacts).values({
      id: `ct_fold_${TAG}`,
      orgId: ORG,
      accountId: ACC_ID,
      fullName: `Gökhan Foldprobe ${TAG}`,
      email: `gokhanfold.${STAMP}@client.test`,
    });
    const contactDetail = findByToolName("contact_detail");
    check("fold: contact_detail registered", Boolean(contactDetail));
    const foldRes = await contactDetail.run(
      { name: "Gokhan Foldprobe" },
      { persona: fpPersona } as any,
    );
    const foldStr = JSON.stringify(foldRes);
    check(
      "fold: ASCII query matches diacritic contact",
      foldRes.ok === true && foldStr.includes(`Gökhan Foldprobe ${TAG}`),
      foldStr.slice(0, 300),
    );

    // 14b. document floor includes the email tools
    const retriever = await import("../../src/lib/atelier-cli/capability-retriever.js");
    const docFloor = (retriever as any).CORE_TOOLS_BY_KIND?.document ?? [];
    check(
      "floor: email tools in document floor",
      docFloor.includes("email_company_documents") && docFloor.includes("email_my_documents"),
      JSON.stringify(docFloor),
    );

    // 14c. typed-name guard: self-scoped downgrade + derived expected value
    const pg = await import("../../src/lib/atelier-cli/prompt-guard.js");
    check(
      "guard: benign self-scoped save NOT typed-name gated by attachment verbs",
      pg.shouldRequireTypedNameForAttachmentTurn({
        hasAttachments: true,
        prompt: "save my visa scan",
        attachmentsMentionDestructive: true,
        tool: { name: "save_my_document", selfScoped: true },
      }) === false,
    );
    check(
      "guard: destructive PROMPT still forces typed-name",
      pg.shouldRequireTypedNameForAttachmentTurn({
        hasAttachments: true,
        prompt: "delete my old visa",
        attachmentsMentionDestructive: false,
        tool: { name: "save_my_document", selfScoped: true },
      }) === true,
    );
    check(
      "guard: non-self-scoped write still gated on attachment verbs",
      pg.shouldRequireTypedNameForAttachmentTurn({
        hasAttachments: true,
        prompt: "file this",
        attachmentsMentionDestructive: true,
        tool: { name: "update_account", selfScoped: false },
      }) === true,
    );
    check(
      "guard: outbound self-scoped write still gated",
      pg.shouldRequireTypedNameForAttachmentTurn({
        hasAttachments: true,
        prompt: "file this",
        attachmentsMentionDestructive: true,
        tool: { name: "email_my_documents", selfScoped: true, outboundChannel: "email" },
      }) === true,
    );
    check(
      "guard: derived typed-name is typeable (title)",
      pg.deriveTypedNameExpected({ create: { title: "UAE Visa 2026" } }) === "UAE Visa 2026",
    );
    check(
      "guard: derived typed-name falls back to CONFIRM",
      pg.deriveTypedNameExpected({}) === pg.TYPED_NAME_FALLBACK &&
        pg.TYPED_NAME_FALLBACK === "CONFIRM",
    );
    check(
      "guard: legacy placeholder constant unchanged",
      pg.LEGACY_TYPED_NAME_PLACEHOLDER === "(re-type to confirm; attachment-derived)",
    );

    // 14d. my_documents card shape: ranked_list with labels + /me/profile hrefs
    const myDocsEntry = findByToolName("my_documents");
    check("card: my_documents resultCard ranked_list", myDocsEntry?.resultCard === "ranked_list");
    const myDocs = await myDocsEntry.run({}, { persona } as any);
    check(
      "card: my_documents items carry label + /me/profile href",
      myDocs.ok === true &&
        Array.isArray(myDocs.data?.items) &&
        myDocs.data.items.length > 0 &&
        myDocs.data.items.every((i: any) => typeof i.label === "string" && i.label.length > 0) &&
        myDocs.data.items.every((i: any) => i.href === "/me/profile") &&
        myDocs.data.href === "/me/profile",
      JSON.stringify(myDocs.data?.items?.[0] ?? myDocs).slice(0, 300),
    );

    // 14e. document_list entityName filter
    const docList = findByToolName("document_list");
    const badEntity = await docList.run(
      { entityName: `NoSuchEntity ${TAG}` },
      { persona: fpPersona } as any,
    );
    check(
      "entity: unknown entity → not_found",
      badEntity.ok === false && badEntity.errorCode === "not_found",
      JSON.stringify(badEntity).slice(0, 200),
    );
    // positive match by LEGAL name where shortName differs
    await db.insert(D.atelierLegalEntities).values({
      id: `le_${TAG}`,
      orgId: ORG,
      legalNameEn: `Cognirise Probe Entity ${TAG} L.L.C.`,
      shortName: `FZ Probe ${TAG}`,
      country: "AE",
      baseCurrency: "AED",
      status: "active",
    });
    const byLegal = await docList.run(
      { entityName: `Cognirise Probe Entity ${TAG}` },
      { persona: fpPersona } as any,
    );
    check(
      "entity: legal-name query resolves (shortName differs)",
      byLegal.ok === true && Array.isArray(byLegal.data?.items),
      JSON.stringify(byLegal).slice(0, 200),
    );
    const byShort = await docList.run(
      { entityName: `FZ Probe ${TAG}` },
      { persona: fpPersona } as any,
    );
    check(
      "entity: short-name query resolves",
      byShort.ok === true && Array.isArray(byShort.data?.items),
      JSON.stringify(byShort).slice(0, 200),
    );
  } finally {
    // ---- cleanup + tag sweep ------------------------------------------
    try {
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorLabel, `%${TAG}%`));
      await db.delete(atelierPersonDocuments).where(like(atelierPersonDocuments.id, `%${TAG}%`));
      await db.delete(atelierMsConnections).where(like(atelierMsConnections.id, `%${TAG}%`));
      await db.delete(atelierMsConnections).where(eq(atelierMsConnections.userId, UID));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, PERSON));
      await db.delete(D.atelierDocumentVersions).where(like(D.atelierDocumentVersions.fileName, `registration-cert.pdf`));
      await db.delete(D.atelierDocuments).where(like(D.atelierDocuments.title, `%${TAG}%`));
      await db.delete(D.atelierContacts).where(like(D.atelierContacts.id, `%${TAG}%`));
      await db.delete(D.atelierLegalEntities).where(like(D.atelierLegalEntities.id, `%${TAG}%`));
      await db.delete(D.atelierAccounts).where(like(D.atelierAccounts.id, `%${TAG}%`));
      await db.delete(atelierUsers).where(like(atelierUsers.name, `%${TAG}%`));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, UID));
    } catch (e) {
      console.error("cleanup failed", e);
    }
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(1);
});
