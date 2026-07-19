/**
 * Task #265 — Legal-entity registry + corporate_legal document linking probe.
 *
 * Covers:
 *   - POST /finance/entities (founding partner) → 201; consultant/recruiter → 403
 *   - PATCH /finance/entities/:id updates fields; consultant → 403
 *   - Upload doc with category=corporate_legal + entityId → 201 with entityId
 *     persisted; bogus entityId → 404 entity-not-found
 *   - GET /finance/entities/:id lists the linked active document
 *   - GET /documents?entityId= filters to the linked doc
 *   - GET /signing-entities includes the active registry entity
 *   - POST /finance/entities/:id/archive → archived entity disappears from
 *     signing-entities and from the default entity list (visible only with
 *     includeArchived=true); PATCH on archived → 409; re-archive idempotent
 *   - POST /finance/entities/extract served by a stub Anthropic server
 *     (canned proposal JSON) → 200 {proposal}; consultant → 403
 *
 * Deterministic: extraction LLM call hits a local stub Anthropic server
 * (env set BEFORE app import); doc bytes are plain text so extraction and
 * the local offline embedding pipeline never call external services.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/entity-registry-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// Canned extraction proposal — must have non-empty `fields` or the route
// returns 422 extraction-empty.
const EXTRACT_PROPOSAL = {
  documentKind: "trade_license",
  confidenceNote: "Stubbed extraction for probe265",
  fields: {
    legalNameEn: "Probe265 Ventures LLC",
    legalNameAr: null,
    legalForm: "Limited Liability Company",
    country: "AE",
    jurisdiction: "Dubai DET",
    incorporationDate: "2024-03-01",
    durationYears: null,
    registeredAddress: "Office 101, Probe Tower, Dubai",
    registrations: [
      {
        type: "trade_license",
        label: "Trade License",
        number: "TL-265265",
        issuer: "DET",
        issuedOn: "2024-03-01",
        expiresOn: "2027-03-01",
        notes: null,
      },
    ],
    activities: [],
    owners: [],
    premises: null,
    lease: null,
  },
};

const LICENSE_TEXT = `TRADE LICENSE — Department of Economy and Tourism, Dubai.
Licensee: Probe265 Ventures LLC. License No: TL-265265.
Legal form: Limited Liability Company. Issue date: 2024-03-01. Expiry: 2027-03-01.
Registered address: Office 101, Probe Tower, Dubai, United Arab Emirates.
Activity: Management consultancy services.`;

async function main() {
  // --- stub Anthropic server MUST exist before the app (and the anthropic
  // client) is imported, because the client reads env at import time. ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe265",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify(EXTRACT_PROPOSAL) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe265-stub-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierLegalEntities,
    atelierDocuments,
    atelierAuditEvents,
  } = D;
  const { and, eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe265_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const conId = `u_${runTag}_con`;
  const recId = `u_${runTag}_rec`;
  const docIds: string[] = [];
  const entityIds: string[] = [];

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
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

  const uploadDoc = async (
    who: string,
    fields: Record<string, string>,
    bytes: Buffer,
    fileName: string,
    mime: string,
  ) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
    const res = await fetch(`${BASE}/documents`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${who}` },
      body: fd,
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
    await db.insert(atelierUsers).values([
      {
        id: fpId,
        orgId: "aico",
        name: "Probe265 Partner",
        initials: "PP",
        email: `${runTag}_fp@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: conId,
        orgId: "aico",
        name: "Probe265 Consultant",
        initials: "PC",
        email: `${runTag}_con@example.test`,
        role: "consultant",
        roleLabel: "Consultant",
        title: "Consultant",
      },
      {
        id: recId,
        orgId: "aico",
        name: "Probe265 Recruiter",
        initials: "PR",
        email: `${runTag}_rec@example.test`,
        role: "recruiter",
        roleLabel: "Recruiter",
        title: "Recruiter",
      },
    ] as any);

    // ---- CRUD gating ----
    const entityName = `Probe265 Ventures LLC ${runTag}`;
    const createBody = {
      legalNameEn: entityName,
      country: "ae",
      legalForm: "LLC",
      jurisdiction: "Dubai DET",
      baseCurrency: "AED",
      registeredAddress: "Office 101, Probe Tower, Dubai",
      governingLaw: "UAE federal law",
      courts: "Dubai Courts",
      registrations: [
        { type: "trade_license", label: "Trade License", number: "TL-265265" },
      ],
    };

    const conCreate = await api(conId, "POST", "/finance/entities", createBody);
    check("consultant entity create -> 403", conCreate.status === 403, conCreate);
    const recList = await api(recId, "GET", "/finance/entities");
    check("recruiter entity list -> 403", recList.status === 403, recList);

    const created = await api(fpId, "POST", "/finance/entities", createBody);
    check("fp entity create -> 201", created.status === 201, created);
    const entity = created.body?.entity;
    if (entity?.id) entityIds.push(entity.id);
    check(
      "created entity shape: country uppercased + registration id assigned",
      entity?.country === "AE" &&
        entity?.status === "active" &&
        Array.isArray(entity?.registrations) &&
        entity.registrations.length === 1 &&
        typeof entity.registrations[0].id === "string" &&
        entity.registrations[0].id.length > 0,
      entity,
    );
    if (!entity?.id) throw new Error("no entity id — aborting");

    const conPatch = await api(conId, "PATCH", `/finance/entities/${entity.id}`, {
      shortName: "Nope",
    });
    check("consultant entity patch -> 403", conPatch.status === 403, conPatch);

    const patched = await api(fpId, "PATCH", `/finance/entities/${entity.id}`, {
      shortName: "P265V",
      notes: "Patched by probe265",
    });
    check(
      "fp entity patch -> 200 with updated fields",
      patched.status === 200 &&
        patched.body?.entity?.shortName === "P265V" &&
        patched.body?.entity?.notes === "Patched by probe265",
      patched,
    );

    // ---- corporate_legal document linking ----
    const bogus = await uploadDoc(
      fpId,
      { title: `Bogus link ${runTag}`, category: "corporate_legal", entityId: "lent_nope" },
      Buffer.from(LICENSE_TEXT, "utf8"),
      "license.txt",
      "text/plain",
    );
    check(
      "upload with unknown entityId -> 404 entity-not-found",
      bogus.status === 404 && bogus.body?.error === "entity-not-found",
      bogus,
    );
    if (bogus.body?.document?.id) docIds.push(bogus.body.document.id);

    const up = await uploadDoc(
      fpId,
      {
        title: `Trade License ${runTag}`,
        category: "corporate_legal",
        entityId: entity.id,
        aiRetrieval: "false",
      },
      Buffer.from(LICENSE_TEXT, "utf8"),
      "license.txt",
      "text/plain",
    );
    check("corporate_legal upload -> 201", up.status === 201, up);
    const doc = up.body?.document;
    if (doc?.id) docIds.push(doc.id);
    check(
      "uploaded doc carries entityId + category",
      doc?.entityId === entity.id && doc?.category === "corporate_legal",
      doc,
    );

    const detail = await api(fpId, "GET", `/finance/entities/${entity.id}`);
    check(
      "entity detail lists the linked doc",
      detail.status === 200 &&
        Array.isArray(detail.body?.documents) &&
        detail.body.documents.some((d: any) => d.id === doc?.id),
      detail.body,
    );

    const filtered = await api(fpId, "GET", `/documents?entityId=${entity.id}`);
    check(
      "GET /documents?entityId= returns only the linked doc",
      filtered.status === 200 &&
        Array.isArray(filtered.body?.documents) &&
        filtered.body.documents.length >= 1 &&
        filtered.body.documents.every((d: any) => d.entityId === entity.id),
      filtered.body,
    );

    // ---- signing-entities merge ----
    const signing = await api(conId, "GET", "/signing-entities");
    check(
      "signing-entities includes active registry entity",
      signing.status === 200 &&
        (signing.body?.entities ?? []).some(
          (e: any) => e.id === entity.id && e.name === entityName,
        ),
      signing.body,
    );

    // ---- extraction (stub Anthropic) ----
    const conExtract = await api(conId, "POST", "/finance/entities/extract", {
      documentId: doc.id,
    });
    check("consultant extract -> 403", conExtract.status === 403, conExtract);

    const noDoc = await api(fpId, "POST", "/finance/entities/extract", {});
    check("extract without documentId -> 400", noDoc.status === 400, noDoc);

    const extract = await api(fpId, "POST", "/finance/entities/extract", {
      documentId: doc.id,
    });
    check(
      "extract -> 200 with proposal fields",
      extract.status === 200 &&
        extract.body?.documentId === doc.id &&
        extract.body?.proposal?.documentKind === "trade_license" &&
        extract.body?.proposal?.fields?.legalNameEn === "Probe265 Ventures LLC",
      extract,
    );

    // ---- archive flow ----
    const conArchive = await api(conId, "POST", `/finance/entities/${entity.id}/archive`);
    check("consultant archive -> 403", conArchive.status === 403, conArchive);

    const archived = await api(fpId, "POST", `/finance/entities/${entity.id}/archive`);
    check(
      "fp archive -> 200 status archived",
      archived.status === 200 && archived.body?.entity?.status === "archived",
      archived,
    );

    const signingAfter = await api(fpId, "GET", "/signing-entities");
    check(
      "archived entity hidden from signing-entities",
      signingAfter.status === 200 &&
        !(signingAfter.body?.entities ?? []).some((e: any) => e.id === entity.id),
      signingAfter.body,
    );

    const listDefault = await api(fpId, "GET", "/finance/entities");
    check(
      "archived entity hidden from default list",
      listDefault.status === 200 &&
        !(listDefault.body?.items ?? []).some((e: any) => e.id === entity.id),
      listDefault.body,
    );
    const listAll = await api(fpId, "GET", "/finance/entities?includeArchived=true");
    check(
      "archived entity visible with includeArchived",
      listAll.status === 200 &&
        (listAll.body?.items ?? []).some(
          (e: any) => e.id === entity.id && e.status === "archived",
        ),
      listAll.body,
    );

    const patchArchived = await api(fpId, "PATCH", `/finance/entities/${entity.id}`, {
      shortName: "Zombie",
    });
    check("patch archived -> 409", patchArchived.status === 409, patchArchived);

    const rearchive = await api(fpId, "POST", `/finance/entities/${entity.id}/archive`);
    check(
      "re-archive idempotent -> alreadyArchived",
      rearchive.status === 200 && rearchive.body?.alreadyArchived === true,
      rearchive,
    );

    // ---- audit trail ----
    const auditRows = await db
      .select({ action: atelierAuditEvents.action })
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "atelier_legal_entity"),
          inArray(atelierAuditEvents.entityId, [entity.id, doc.id]),
        ),
      );
    const actions = new Set(auditRows.map((r) => r.action));
    check(
      "audit: create/update/archive/extract recorded",
      actions.has("legal_entity.create") &&
        actions.has("legal_entity.update") &&
        actions.has("legal_entity.archive") &&
        actions.has("legal_entity.extract"),
      Array.from(actions),
    );
  } finally {
    try {
      const lib = await import("../../src/lib/atelier-documents.js");
      const leftover = await db
        .select({ id: atelierDocuments.id })
        .from(atelierDocuments)
        .where(inArray(atelierDocuments.id, docIds.length ? docIds : ["_"]));
      for (const d of leftover) {
        await lib.purgeDocument({
          orgId: "aico",
          documentId: d.id,
          actor: { id: fpId, name: "Probe265 cleanup" },
        });
      }
      await db
        .delete(atelierDocuments)
        .where(inArray(atelierDocuments.id, docIds.length ? docIds : ["_"]));
      await db
        .delete(atelierLegalEntities)
        .where(inArray(atelierLegalEntities.id, entityIds.length ? entityIds : ["_"]));
      await db
        .delete(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "atelier_legal_entity"),
            inArray(atelierAuditEvents.entityId, [
              ...entityIds,
              ...docIds,
              "_",
            ]),
          ),
        );
      await db
        .delete(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "atelier_document"),
            inArray(atelierAuditEvents.entityId, docIds.length ? docIds : ["_"]),
          ),
        );
      await db
        .delete(atelierUsers)
        .where(inArray(atelierUsers.id, [fpId, conId, recId]));
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
