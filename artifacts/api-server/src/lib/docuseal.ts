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
 * Sender-chosen placement for one signer's signature box. All
 * coordinates are normalized fractions of the page (0..1, origin at
 * the top-left corner); `page` is 1-based.
 */
export interface SignaturePlacement {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Optional extra (non-signature) field the sender placed for one signer:
 * a "date signed" box or an initials box. `signerIndex` is 0-based;
 * coordinates use the same normalized page-fraction space.
 */
export interface ExtraSignerField extends SignaturePlacement {
  signerIndex: number;
  type: "date" | "initials" | "text";
  /**
   * Optional display label for the box (shown to the signer in the
   * DocuSeal form). Mostly used for text fields ("Name", "Title", …);
   * date/initials fall back to their standard labels.
   */
  label?: string | null;
}

/**
 * Default two-column layout on the given page (1-based) — used when the
 * sender hasn't customized placement. Index is 0-based signer index.
 */
export function defaultSignaturePlacement(index: number, page: number): SignaturePlacement {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    page,
    x: col === 0 ? 0.08 : 0.55,
    y: 0.66 + row * 0.065,
    w: 0.32,
    h: 0.05,
  };
}

/**
 * Create a DocuSeal template from raw PDF bytes.
 *
 * DocuSeal Cloud rejects submissions on templates without fields
 * ("Template does not contain fields", 422), so a signature field is
 * stamped for every signer. By default fields are laid out in two
 * columns from ~2/3 down the LAST page; callers may override each
 * signer's box via `placements` (one entry per signer, in order).
 */
export async function createTemplateFromPdf(args: {
  name: string;
  fileName: string;
  pdfBytes: Buffer;
  signerCount: number;
  /** 0-based index of the page that carries the signature blocks. */
  lastPageIndex: number;
  /** Optional sender-chosen boxes, one per signer (overrides layout). */
  placements?: SignaturePlacement[] | null;
  /** Optional extra date/initials boxes tied to signers by 0-based index. */
  extraFields?: ExtraSignerField[] | null;
}): Promise<{ id: number }> {
  const count = Math.max(1, args.signerCount);
  if (args.placements && args.placements.length !== count) {
    throw new DocusealError(
      `Signature placements (${args.placements.length}) must match signer count (${count}).`,
    );
  }
  if (args.extraFields?.some((f) => f.signerIndex < 0 || f.signerIndex >= count)) {
    throw new DocusealError(
      `Extra fields must reference a valid signer index (0..${count - 1}).`,
    );
  }
  const fields: Array<Record<string, unknown>> = Array.from({ length: count }, (_, i) => {
    const area =
      args.placements?.[i] ?? defaultSignaturePlacement(i, args.lastPageIndex + 1);
    return {
      name: `Signature ${i + 1}`,
      type: "signature",
      role: signerRole(i + 1),
      required: true,
      areas: [
        {
          x: area.x,
          y: area.y,
          w: area.w,
          h: area.h,
          // DocuSeal pages are 1-based.
          page: area.page,
        },
      ],
    };
  });
  // Append the optional date/initials boxes. Names must be unique per
  // template, so number them per signer.
  const perSignerCounts = new Map<string, number>();
  for (const f of args.extraFields ?? []) {
    const label =
      (typeof f.label === "string" && f.label.trim()) ||
      (f.type === "date" ? "Date signed" : f.type === "initials" ? "Initials" : "Text");
    const key = `${f.type}:${f.signerIndex}:${label.toLowerCase()}`;
    const n = (perSignerCounts.get(key) ?? 0) + 1;
    perSignerCounts.set(key, n);
    fields.push({
      name: `${label} ${f.signerIndex + 1}${n > 1 ? `.${n}` : ""}`,
      type: f.type,
      role: signerRole(f.signerIndex + 1),
      required: true,
      areas: [{ x: f.x, y: f.y, w: f.w, h: f.h, page: f.page }],
    });
  }
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
