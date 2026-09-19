import { authorizeAssistantProviderPayload } from "@workspace/assistant-protocol";
/**
 * Task #1316 — CogniDocs API client.
 *
 * Submit a document → poll the parse job → return the completed job.
 * Fail-loud: every failure throws a typed CognidocsError; callers map it
 * onto their existing error contracts (422/502, chat errorCodes) — never
 * a silent fallback to guessed values.
 *
 * Key selection:
 *   - production (REPLIT_DEPLOYMENT set) → COGNIDOCS_API_KEY
 *   - dev/test → COGNIDOCS_SANDBOX_API_KEY, falling back to the main key
 *   - neither present → "not-configured" error (loud, actionable)
 *
 * Base URL is env-overridable (COGNIDOCS_BASE_URL) so tests run against a
 * deterministic local stub — same pattern as the Anthropic stub probes.
 */

import type {
  CognidocsDeclaredType,
  CognidocsParseJob,
} from "./types.js";

const DEFAULT_BASE_URL = "https://cognidocs.cognirise.ai/api";
/** CogniDocs hard cap on uploads. */
export const COGNIDOCS_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Media types CogniDocs accepts (no GIF, no HEIC — convert first). */
export const COGNIDOCS_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
]);

export type CognidocsErrorCode =
  | "not-configured"
  | "auth"
  | "file-too-large"
  | "unsupported-media-type"
  | "pdf_password_required"
  | "pdf_password_incorrect"
  | "request-failed"
  | "parse-failed"
  | "timeout";

export class CognidocsError extends Error {
  code: CognidocsErrorCode;
  status: number | null;
  constructor(code: CognidocsErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "CognidocsError";
    this.code = code;
    this.status = status;
  }
}

export function cognidocsBaseUrl(): string {
  return (process.env.COGNIDOCS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function resolveApiKey(): string | null {
  const main = process.env.COGNIDOCS_API_KEY?.trim() || null;
  const sandbox = process.env.COGNIDOCS_SANDBOX_API_KEY?.trim() || null;
  if (process.env.REPLIT_DEPLOYMENT) return main;
  return sandbox ?? main;
}

/** True when a usable API key is present for this environment. */
export function cognidocsConfigured(): boolean {
  return resolveApiKey() != null;
}

function requireApiKey(): string {
  const key = resolveApiKey();
  if (!key) {
    throw new CognidocsError(
      "not-configured",
      "Document parsing is not configured yet (CogniDocs API key missing). An admin needs to add COGNIDOCS_API_KEY / COGNIDOCS_SANDBOX_API_KEY.",
    );
  }
  return key;
}

async function cognidocsFetch(path: string, init: RequestInit): Promise<Response> {
  const key = requireApiKey();
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", key);
  let resp: Response;
  try {
    resp = await fetch(`${cognidocsBaseUrl()}${path}`, { ...init, headers });
  } catch (err) {
    throw new CognidocsError(
      "request-failed",
      `CogniDocs request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (resp.ok) return resp;
  let body: Record<string, unknown> = {};
  try {
    body = (await resp.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body — keep the status-based mapping */
  }
  const apiCode = typeof body.code === "string" ? body.code : null;
  const apiMessage =
    typeof body.error === "string" && body.error
      ? body.error
      : `CogniDocs responded ${resp.status}`;
  if (apiCode === "pdf_password_required" || apiCode === "pdf_password_incorrect") {
    throw new CognidocsError(apiCode, apiMessage, resp.status);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new CognidocsError("auth", apiMessage, resp.status);
  }
  if (resp.status === 413) {
    throw new CognidocsError("file-too-large", apiMessage, resp.status);
  }
  throw new CognidocsError("request-failed", apiMessage, resp.status);
}

export interface SubmitDocumentArgs {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  declaredType: CognidocsDeclaredType;
  /** Password for protected PDFs (retry path after pdf_password_required). */
  password?: string;
}

/** POST /documents — returns the (usually queued) parse job. */
export async function submitCognidocsDocument(args: SubmitDocumentArgs): Promise<CognidocsParseJob> {
  if (args.bytes.length === 0) {
    throw new CognidocsError("request-failed", "Empty file — nothing to parse.");
  }
  if (args.bytes.length > COGNIDOCS_MAX_FILE_BYTES) {
    throw new CognidocsError(
      "file-too-large",
      "File exceeds the 20MB document-parsing limit — upload a smaller file.",
    );
  }
  const mime = args.mimeType.toLowerCase().split(";")[0].trim();
  if (!COGNIDOCS_MEDIA_TYPES.has(mime)) {
    throw new CognidocsError(
      "unsupported-media-type",
      `Document parsing supports PDF, PNG, JPEG, WEBP and CSV — not ${mime || "this file type"}.`,
    );
  }
  const authorized = authorizeAssistantProviderPayload({
    provider: "cognidocs",
    declaredDataClasses: ["secret"],
    payload: {
      fileBase64: args.bytes.toString("base64"),
      fileName: args.fileName,
      mimeType: mime,
      declaredType: args.declaredType,
      ...(args.password ? { password: args.password } : {}),
    },
  });
  const resp = await cognidocsFetch("/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authorized.payload),
  });
  return (await resp.json()) as CognidocsParseJob;
}

/** GET /jobs/{id} — results are retained indefinitely, so re-fetching by
 * jobId is the deterministic preview→confirm replay mechanism. */
export async function getCognidocsJob(jobId: string): Promise<CognidocsParseJob> {
  const resp = await cognidocsFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  return (await resp.json()) as CognidocsParseJob;
}

/** Poll a job to a terminal state. Throws on failed/timeout. */
export async function waitForCognidocsJob(
  jobId: string,
  opts: { timeoutMs?: number } = {},
): Promise<CognidocsParseJob> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.COGNIDOCS_TIMEOUT_MS ?? 180_000);
  const deadline = Date.now() + timeoutMs;
  let delay = 750;
  for (;;) {
    const job = await getCognidocsJob(jobId);
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new CognidocsError("parse-failed", job.error || "CogniDocs could not parse this document.");
    }
    if (Date.now() + delay > deadline) {
      throw new CognidocsError(
        "timeout",
        `Document parsing timed out after ${Math.round(timeoutMs / 1000)}s (job ${jobId} still ${job.status}).`,
      );
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.5), 8_000);
  }
}

/** Submit + wait — the common one-shot path. Completed job or throw. */
export async function parseCognidocsDocument(
  args: SubmitDocumentArgs & { timeoutMs?: number },
): Promise<CognidocsParseJob> {
  const job = await submitCognidocsDocument(args);
  if (job.status === "completed") return job;
  if (job.status === "failed") {
    throw new CognidocsError("parse-failed", job.error || "CogniDocs could not parse this document.");
  }
  return waitForCognidocsJob(job.id, { timeoutMs: args.timeoutMs });
}
