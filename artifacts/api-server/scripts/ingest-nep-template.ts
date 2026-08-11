/**
 * Task #967 — ingest the templatized Non-Equity Partner Agreement v3 as
 * the ACTIVE version of the firm's "Non-Equity Partner Agreement"
 * template, via the live API (works against dev main AND production —
 * task-agent DB writes never merge, and prod data is only writable
 * through the deployed app).
 *
 * Idempotent: when the template's CURRENT version already carries the v3
 * file name and the reviewed schema matches scripts/nep-template-schema.ts,
 * the script reports "already ingested" and exits 0 without writing.
 *
 * Usage:
 *   ATELIER_BASE_URL=https://<host> \
 *   ATELIER_EMAIL=<founding-partner email> \
 *   ATELIER_PASSWORD=<password> \
 *   pnpm --filter @workspace/api-server exec tsx scripts/ingest-nep-template.ts
 *
 * Notes:
 *  - Field detection on upload runs the live LLM; its output is IGNORED —
 *    the reviewed schema submitted here is the curated NEP_FIELD_SCHEMA.
 *  - PUT /fields validates every placeholder against the uploaded docx
 *    (same matcher as generation), so success here guarantees prepare
 *    can never fail with "Could not locate placeholder".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEP_FIELD_SCHEMA } from "./nep-template-schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCX = path.resolve(HERE, "assets/non-equity-partner-agreement-template-v3.docx");
// ASCII-only on purpose: multipart filenames with non-ASCII chars get
// mangled server-side, which would break the idempotency check below.
const FILE_NAME = "Non-Equity Partner Agreement - v3 (template).docx";
const TEMPLATE_TYPE = "non_equity_partner_employment";
const TEMPLATE_NAME = "Non-Equity Partner Agreement";

const BASE = (process.env.ATELIER_BASE_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.ATELIER_EMAIL ?? "";
const PASSWORD = process.env.ATELIER_PASSWORD ?? "";
if (!BASE || !EMAIL || !PASSWORD) {
  console.error("Set ATELIER_BASE_URL, ATELIER_EMAIL, ATELIER_PASSWORD.");
  process.exit(2);
}

let cookie = "";
async function call(
  method: string,
  p: string,
  body?: BodyInit | Record<string, unknown>,
  isJson = true,
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { ...(cookie ? { cookie } : {}) };
  let payload: BodyInit | undefined;
  if (body !== undefined && isJson) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (body !== undefined) {
    payload = body as BodyInit;
  }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

function schemaMatches(current: unknown[]): boolean {
  const norm = (fields: any[]) =>
    JSON.stringify(
      fields
        .map((f) => ({
          key: f.key,
          label: f.label,
          placeholder: f.placeholder,
          dataType: f.dataType,
          autoFill: f.autoFill,
          required: f.required,
          role: f.role ?? "standard",
          ...(f.defaultHint ? { defaultHint: f.defaultHint } : {}),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    );
  return norm(current as any[]) === norm(NEP_FIELD_SCHEMA as any[]);
}

async function main() {
  const login = await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.json)}`);
  }
  console.log(`Logged in as ${EMAIL}`);

  const list = await call("GET", "/api/atelier/contract-templates");
  if (list.status !== 200) throw new Error(`Template list failed (${list.status})`);
  const templates: any[] = list.json.templates ?? [];
  let template = templates.find((t) => t.contractType === TEMPLATE_TYPE);

  if (!template) {
    // First-time environment (e.g. a fresh prod) — create the template.
    console.log("No existing non-equity partner template — creating one.");
    const fd = new FormData();
    fd.set("name", TEMPLATE_NAME);
    fd.set("contractType", TEMPLATE_TYPE);
    fd.set("file", new Blob([readFileSync(DOCX)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }), FILE_NAME);
    const created = await call("POST", "/api/atelier/contract-templates", fd, false);
    if (created.status !== 201) {
      throw new Error(`Template create failed (${created.status}): ${JSON.stringify(created.json)}`);
    }
    template = created.json.template;
  } else {
    const detail = await call("GET", `/api/atelier/contract-templates/${template.id}`);
    const current = detail.json?.template?.currentVersion;
    if (
      current &&
      current.fileName === FILE_NAME &&
      current.fieldStatus === "reviewed" &&
      schemaMatches(current.fieldSchema ?? []) &&
      detail.json.template.status === "active"
    ) {
      console.log(`Already ingested — active v${current.versionNumber} is the v3 template. No-op.`);
      return;
    }
    console.log(`Uploading v3 as a new version of "${template.name}" (${template.id})…`);
    const fd = new FormData();
    fd.set("file", new Blob([readFileSync(DOCX)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }), FILE_NAME);
    const up = await call("POST", `/api/atelier/contract-templates/${template.id}/versions`, fd, false);
    if (up.status !== 201) {
      throw new Error(`Version upload failed (${up.status}): ${JSON.stringify(up.json)}`);
    }
    console.log(`Uploaded version ${up.json.template?.currentVersion?.versionNumber}.`);
  }

  const put = await call("PUT", `/api/atelier/contract-templates/${template.id}/fields`, {
    fields: NEP_FIELD_SCHEMA,
  });
  if (put.status !== 200) {
    throw new Error(`Field review failed (${put.status}): ${JSON.stringify(put.json)}`);
  }
  if (put.json.template?.status !== "active") {
    const act = await call("PATCH", `/api/atelier/contract-templates/${template.id}`, {
      status: "active",
    });
    if (act.status !== 200) {
      throw new Error(`Activation failed (${act.status}): ${JSON.stringify(act.json)}`);
    }
  }
  const finalCheck = await call("GET", `/api/atelier/contract-templates/${template.id}`);
  const cv = finalCheck.json?.template?.currentVersion;
  console.log(
    `DONE — "${finalCheck.json?.template?.name}" status=${finalCheck.json?.template?.status}, ` +
      `current v${cv?.versionNumber} (${cv?.fileName}), fieldStatus=${cv?.fieldStatus}, ` +
      `${cv?.fieldSchema?.length} fields.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
