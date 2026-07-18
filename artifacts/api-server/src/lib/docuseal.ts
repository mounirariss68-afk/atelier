/**
 * Task #62 — DocuSeal API client.
 *
 * Thin, fail-loud wrapper over the DocuSeal REST API (Cloud or a
 * self-hosted instance). DocuSeal itself always runs OUTSIDE this Repl
 * (Docker isn't available here); Atelier talks to it over HTTPS.
 *
 * Configuration:
 *   DOCUSEAL_API_KEY   — required for any live call (X-Auth-Token).
 *   DOCUSEAL_BASE_URL  — optional; defaults to DocuSeal Cloud
 *                        (https://api.docuseal.com). Point it at a
 *                        self-hosted instance's API root to swap later.
 *
 * Every failure throws DocusealError with the HTTP status + response
 * body snippet — the route layer surfaces these as 502s. No silent
 * fallbacks anywhere.
 */

export class DocusealError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "DocusealError";
    this.status = status;
  }
}

export function docusealBaseUrl(): string {
  const raw = process.env.DOCUSEAL_BASE_URL?.trim();
  const url = raw && raw.length > 0 ? raw : "https://api.docuseal.com";
  return url.replace(/\/+$/, "");
}

export function docusealConfigured(): boolean {
  return !!process.env.DOCUSEAL_API_KEY?.trim();
}

function apiKey(): string {
  const key = process.env.DOCUSEAL_API_KEY?.trim();
  if (!key) {
    throw new DocusealError(
      "DOCUSEAL_API_KEY is not configured. Add the DocuSeal API key secret before sending signature requests.",
    );
  }
  return key;
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${docusealBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "X-Auth-Token": apiKey(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new DocusealError(
      `DocuSeal unreachable (${method} ${path}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new DocusealError(
      `DocuSeal ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DocusealError(
      `DocuSeal ${method} ${path} returned non-JSON response: ${text.slice(0, 120)}`,
      res.status,
    );
  }
}

// ---------------------------------------------------------------------------
// Wire shapes (the subset we consume)
// ---------------------------------------------------------------------------

export interface DocusealSubmitter {
  id: number;
  submission_id?: number;
  name?: string | null;
  email: string;
  status: string; // pending | sent | opened | completed | declined
  sent_at?: string | null;
  opened_at?: string | null;
  completed_at?: string | null;
  declined_at?: string | null;
}

export interface DocusealSubmission {
  id: number;
  status?: string; // pending | completed | declined | expired | archived
  archived_at?: string | null;
  completed_at?: string | null;
  expire_at?: string | null;
  submitters: DocusealSubmitter[];
  documents?: Array<{ name?: string; url: string }>;
  audit_log_url?: string | null;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Role name for the Nth signer (1-based) — must match createSubmission. */
export function signerRole(order: number): string {
  return `Signer ${order}`;
}

/**
 * Create a DocuSeal template from raw PDF bytes.
 *
 * DocuSeal Cloud rejects submissions on templates without fields
 * ("Template does not contain fields", 422), so a signature field is
 * stamped for every signer on the last page of the document. Fields are
 * laid out in two columns from ~2/3 down the page.
 */
export async function createTemplateFromPdf(args: {
  name: string;
  fileName: string;
  pdfBytes: Buffer;
  signerCount: number;
  /** 0-based index of the page that carries the signature blocks. */
  lastPageIndex: number;
}): Promise<{ id: number }> {
  const fields = Array.from({ length: Math.max(1, args.signerCount) }, (_, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    return {
      name: `Signature ${i + 1}`,
      type: "signature",
      role: signerRole(i + 1),
      required: true,
      areas: [
        {
          x: col === 0 ? 0.08 : 0.55,
          y: 0.66 + row * 0.065,
          w: 0.32,
          h: 0.05,
          // DocuSeal pages are 1-based.
          page: args.lastPageIndex + 1,
        },
      ],
    };
  });
  const out = await request<{ id: number }>("POST", "/templates/pdf", {
    name: args.name,
    documents: [
      {
        name: args.fileName,
        file: args.pdfBytes.toString("base64"),
        fields,
      },
    ],
  });
  if (!out || typeof out.id !== "number") {
    throw new DocusealError("DocuSeal template creation returned no id.");
  }
  return out;
}

/**
 * Create a submission (signature request) on a template. Signing order
 * is preserved (sequential) — DocuSeal emails the next signer only when
 * the previous one has completed.
 */
export async function createSubmission(args: {
  templateId: number;
  signers: Array<{ name: string; email: string }>;
  message?: string | null;
  subject?: string | null;
  expiresAt?: Date | null;
}): Promise<{ submissionId: number; submitters: DocusealSubmitter[] }> {
  const payload: Record<string, unknown> = {
    template_id: args.templateId,
    send_email: true,
    order: "preserved",
    submitters: args.signers.map((s, i) => ({
      name: s.name,
      email: s.email,
      role: signerRole(i + 1),
    })),
  };
  if (args.expiresAt) payload.expire_at = args.expiresAt.toISOString();
  if (args.message) {
    payload.message = {
      subject: args.subject ?? "Signature requested",
      body: args.message,
    };
  }
  const out = await request<unknown>("POST", "/submissions", payload);
  // DocuSeal returns either an array of submitters or an object with
  // {id, submitters}. Accept both shapes.
  if (Array.isArray(out)) {
    const submitters = out as DocusealSubmitter[];
    const sid = submitters[0]?.submission_id;
    if (!sid) {
      throw new DocusealError("DocuSeal submission response missing submission_id.");
    }
    return { submissionId: sid, submitters };
  }
  const obj = out as { id?: number; submitters?: DocusealSubmitter[] };
  if (typeof obj?.id !== "number") {
    throw new DocusealError("DocuSeal submission creation returned no id.");
  }
  return { submissionId: obj.id, submitters: obj.submitters ?? [] };
}

/** Authoritative submission state (statuses, documents, audit log). */
export async function getSubmission(submissionId: number): Promise<DocusealSubmission> {
  return request<DocusealSubmission>("GET", `/submissions/${submissionId}`);
}

/** Archive (void) a submission — pending signers can no longer sign. */
export async function archiveSubmission(submissionId: number): Promise<void> {
  await request<unknown>("DELETE", `/submissions/${submissionId}`);
}

/** Re-send the signature email to one submitter (reminder). */
export async function resendSubmitterEmail(submitterId: number): Promise<void> {
  await request<unknown>("PUT", `/submitters/${submitterId}`, { send_email: true });
}

/** Download a signed document / audit-log file from a DocuSeal URL. */
export async function downloadDocusealFile(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Auth-Token": apiKey() },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new DocusealError(
      `DocuSeal file download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new DocusealError(`DocuSeal file download failed with ${res.status}`, res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}
