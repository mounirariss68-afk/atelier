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

    // ---- 11. invalid recipient -----------------------------------------
    const badTo = await runTool({ query: "passport", to: ["not-an-email"] });
    check("invalid recipient", badTo.ok === false && badTo.errorCode === "invalid_recipients");

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
  } finally {
    // ---- cleanup + tag sweep ------------------------------------------
    try {
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorLabel, `%${TAG}%`));
      await db.delete(atelierPersonDocuments).where(like(atelierPersonDocuments.id, `%${TAG}%`));
      await db.delete(atelierMsConnections).where(eq(atelierMsConnections.userId, UID));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, PERSON));
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
