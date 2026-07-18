/**
 * Task #121 — e-sign account-link probe.
 *
 * Pins the server half of the in-context signature flow: POST
 * /esign/requests with an accountId (what the locked-account
 * SendForSignatureDialog sends) must link the resulting signature
 * request to that account — on the 201 response, in the DB row, and on
 * the account-filtered list. Also pins the duplicate-signer-email 400
 * the dialog's client-side dedupe mirrors.
 *
 * DocuSeal is stubbed with a local node:http server (same pattern as
 * the stub-Anthropic probes): DOCUSEAL_BASE_URL/DOCUSEAL_API_KEY are
 * set before the app is imported, so no live calls are made and the
 * probe is fully deterministic.
 *
 * Run: pnpm --filter @workspace/api-server test:esign-link
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  // ---- stub DocuSeal BEFORE the app import ----
  const docusealCalls: Array<{ method: string; url: string; body: any }> = [];
  const stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      docusealCalls.push({ method: req.method ?? "", url: req.url ?? "", body });
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/templates/pdf") {
        res.end(JSON.stringify({ id: 7001 }));
        return;
      }
      if (req.method === "POST" && req.url === "/submissions") {
        const submitters = (body?.submitters ?? []).map((s: any, i: number) => ({
          id: 9100 + i,
          submission_id: 5500,
          name: s.name,
          email: s.email,
          status: i === 0 ? "sent" : "pending",
        }));
        res.end(JSON.stringify(submitters));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "unexpected-docuseal-call" }));
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.DOCUSEAL_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.DOCUSEAL_API_KEY = "probe-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierDocuments,
    atelierAuditEvents,
    atelierSignatureRequests,
    atelierSignatureSigners,
  } = D;
  const { and, eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe121_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  let accountId: string | null = null;
  let otherAccountId: string | null = null;
  let docId: string | null = null;
  const sigRequestIds: string[] = [];

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${fpId}`,
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

  try {
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Probe121 Partner",
      initials: "PP",
      email: `${runTag}_fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);

    // ---- account + a second account (to prove the link isn't incidental) ----
    const acctRes = await api("POST", "/accounts", {
      name: `Esign Probe Account ${runTag}`,
      sector: "Logistics",
      country: "AE",
      tier: "C",
      status: "active",
      primaryCurrency: "USD",
      primaryLanguage: "en",
    });
    check("account create -> 201", acctRes.status === 201, acctRes);
    accountId = acctRes.body?.id ?? null;
    const otherRes = await api("POST", "/accounts", {
      name: `Esign Probe Other ${runTag}`,
      sector: "Logistics",
      country: "AE",
      tier: "C",
      status: "active",
      primaryCurrency: "USD",
      primaryLanguage: "en",
    });
    otherAccountId = otherRes.body?.id ?? null;
    if (!accountId || !otherAccountId) throw new Error("no account ids — aborting");

    // ---- upload an ORG-LEVEL pdf (mirrors the library PDFs the dialog lists;
    // also proves the accountId on the request comes from the BODY, not from
    // the document's own scope) ----
    const fd = new FormData();
    fd.set("title", `Esign Probe NDA ${runTag}`);
    fd.set("category", "template");
    fd.set(
      "file",
      new Blob([new Uint8Array(randomBytes(1024))], { type: "application/pdf" }),
      "nda.pdf",
    );
    const upRes = await fetch(`${BASE}/documents`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${fpId}` },
      body: fd,
    });
    const upBody: any = await upRes.json();
    check("pdf upload -> 201", upRes.status === 201, upBody);
    docId = upBody?.document?.id ?? null;
    if (!docId) throw new Error("no document id — aborting");

    // ---- duplicate signer emails -> 400 (server contract the dialog mirrors) ----
    const dup = await api("POST", "/esign/requests", {
      title: `Dup ${runTag}`,
      documentId: docId,
      accountId,
      signers: [
        { name: "A", email: "same@example.test" },
        { name: "B", email: "SAME@example.test" },
      ],
    });
    check(
      "duplicate signer emails -> 400 duplicate-signer-email",
      dup.status === 400 && dup.body?.error === "duplicate-signer-email",
      dup,
    );
    check("no DocuSeal call made for rejected request", docusealCalls.length === 0, docusealCalls);

    // ---- create with accountId set (locked-account dialog payload) ----
    const createRes = await api("POST", "/esign/requests", {
      title: `NDA ${runTag}`,
      documentId: docId,
      accountId,
      signers: [
        { name: "Aisha CEO", email: `${runTag}_aisha@client.test` },
        { name: "Bob CFO", email: `${runTag}_bob@client.test` },
      ],
      expiresInDays: 30,
    });
    check("create with accountId -> 201", createRes.status === 201, createRes);
    const request = createRes.body?.request;
    if (request?.id) sigRequestIds.push(request.id);
    check(
      "201 response carries the linked accountId",
      request?.accountId === accountId,
      { got: request?.accountId, expected: accountId },
    );
    check(
      "response signers preserved in order",
      request?.signers?.length === 2 &&
        request.signers[0].email === `${runTag}_aisha@client.test` &&
        request.signers[1].email === `${runTag}_bob@client.test`,
      request?.signers,
    );

    // ---- DB row links to the account ----
    const [row] = await db
      .select()
      .from(atelierSignatureRequests)
      .where(eq(atelierSignatureRequests.id, request.id));
    check("DB row exists with accountId link", row?.accountId === accountId, row);
    check(
      "DB row recorded the stub DocuSeal template + submission ids",
      row?.docusealTemplateId === "7001" && row?.docusealSubmissionId === "5500",
      { t: row?.docusealTemplateId, s: row?.docusealSubmissionId },
    );

    // ---- stub actually received the template + submission calls ----
    check(
      "DocuSeal stub got template + submission calls",
      docusealCalls.some((c) => c.url === "/templates/pdf") &&
        docusealCalls.some((c) => c.url === "/submissions"),
      docusealCalls.map((c) => c.url),
    );

    // ---- account-filtered list surfaces it; the OTHER account does not ----
    const listLinked = await api("GET", `/esign/requests?accountId=${accountId}`);
    check(
      "list filtered by the linked account includes the request",
      listLinked.status === 200 &&
        listLinked.body?.requests?.some((r: any) => r.id === request.id),
      listLinked.body?.requests?.map((r: any) => r.id),
    );
    const listOther = await api("GET", `/esign/requests?accountId=${otherAccountId}`);
    check(
      "list filtered by a different account excludes it",
      listOther.status === 200 &&
        !listOther.body?.requests?.some((r: any) => r.id === request.id),
      listOther.body?.requests?.map((r: any) => r.id),
    );
  } finally {
    try {
      const ids = sigRequestIds.length ? sigRequestIds : ["_"];
      await db
        .delete(atelierSignatureSigners)
        .where(inArray(atelierSignatureSigners.requestId, ids));
      await db
        .delete(atelierSignatureRequests)
        .where(inArray(atelierSignatureRequests.id, ids));
      await db
        .delete(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "signature_request"),
            inArray(atelierAuditEvents.entityId, ids),
          ),
        );
      if (docId) {
        const lib = await import("../../src/lib/atelier-documents.js");
        await lib
          .purgeDocument({
            orgId: "aico",
            documentId: docId,
            actor: { id: fpId, name: "Probe121 cleanup" },
          })
          .catch(() => {});
        await db.delete(atelierDocuments).where(eq(atelierDocuments.id, docId));
        await db
          .delete(atelierAuditEvents)
          .where(
            and(
              eq(atelierAuditEvents.entityType, "atelier_document"),
              eq(atelierAuditEvents.entityId, docId),
            ),
          );
      }
      const acctIds = [accountId, otherAccountId].filter(Boolean) as string[];
      if (acctIds.length) {
        await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, acctIds));
      }
      await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
