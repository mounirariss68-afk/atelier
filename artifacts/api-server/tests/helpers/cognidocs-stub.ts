/**
 * Task #1316 — deterministic local CogniDocs stub for offline probes.
 *
 * Emulates the two endpoints the client uses:
 *   POST /documents  → registers a job and returns it (completed
 *                      immediately unless `pendingPolls` asks for a
 *                      queued phase first)
 *   GET  /jobs/{id}  → returns the stored job (re-fetch determinism:
 *                      the SAME job object every time, like production)
 *
 * Behavior is driven by a mutable `state` object the probe rewrites
 * between sections — same pattern as the stub-Anthropic probes. Start it
 * and set COGNIDOCS_BASE_URL + COGNIDOCS_SANDBOX_API_KEY BEFORE any
 * capability import.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  CognidocsInvoiceResult,
  CognidocsParseJob,
  CognidocsStatementResult,
} from "../../src/lib/cognidocs/types.js";

export interface CognidocsStubState {
  /** Next result payloads. `resolve` (if set) wins; else invoice/statement. */
  invoice: CognidocsInvoiceResult | null;
  statement: CognidocsStatementResult | null;
  /** Per-request resolver — receives the submitted body (fileName,
   * mimeType, declaredType, decoded bytes) so probes can key results off
   * the uploaded file. Return null to fall back to invoice/statement. */
  resolve:
    | ((req: {
        fileName: string;
        mimeType: string;
        declaredType: string;
        bytes: Buffer;
      }) => { invoice?: CognidocsInvoiceResult | null; statement?: CognidocsStatementResult | null; confidence?: number; fail?: string } | null)
    | null;
  /** Job confidence 0–100 stamped on new jobs. */
  confidence: number;
  /** When set, the next submit creates a FAILED job with this error. */
  failNext: string | null;
  /** Task #1318 — when set, submits must carry this exact password:
   *  missing → 422 pdf_password_required; wrong → 422 pdf_password_incorrect
   *  (same wire shape as the live service). */
  requiredPassword: string | null;
  /** Serve this many "processing" GETs before the job completes. */
  pendingPolls: number;
  /** Counters. */
  submits: number;
  jobGets: number;
  /** Last submitted body (decoded). */
  lastSubmit: { fileName: string; mimeType: string; declaredType: string; bytes: Buffer; password: string | null } | null;
}

export function defaultInvoicePayload(over: Partial<CognidocsInvoiceResult> = {}): CognidocsInvoiceResult {
  return {
    id: null,
    vendorKey: null,
    vendorName: "Gulf Office Supplies LLC",
    invoiceRef: "INV-2026-0815",
    issueDate: "2026-08-01",
    dueDate: null,
    currency: "AED",
    subtotalAmount10k: 45_004_800,
    taxAmount10k: 2_250_200,
    totalAmount10k: 47_255_000,
    categoryKey: null,
    lineItems: null,
    ...over,
  };
}

export interface CognidocsStub {
  state: CognidocsStubState;
  baseUrl: string;
  close(): Promise<void>;
}

/** Boot the stub, point COGNIDOCS_BASE_URL at it and pin a sandbox key. */
export async function startCognidocsStub(): Promise<CognidocsStub> {
  const state: CognidocsStubState = {
    invoice: null,
    statement: null,
    resolve: null,
    confidence: 95,
    failNext: null,
    requiredPassword: null,
    pendingPolls: 0,
    submits: 0,
    jobGets: 0,
    lastSubmit: null,
  };
  const jobs = new Map<string, { job: CognidocsParseJob; pendingPolls: number }>();
  let seq = 0;

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== "stub-sandbox-key") {
      return send(401, { error: "invalid api key" });
    }
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "POST" && url.pathname === "/documents") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(raw || "{}"); } catch {}
        const submitted = {
          fileName: String(body.fileName ?? ""),
          mimeType: String(body.mimeType ?? ""),
          declaredType: String(body.declaredType ?? ""),
          bytes: Buffer.from(String(body.fileBase64 ?? ""), "base64"),
          password: typeof body.password === "string" && body.password ? body.password : null,
        };
        state.submits++;
        state.lastSubmit = submitted;
        // Task #1318 — password-protected document emulation.
        if (state.requiredPassword != null) {
          if (!submitted.password) {
            return send(422, { code: "pdf_password_required", error: "document is password protected" });
          }
          if (submitted.password !== state.requiredPassword) {
            return send(422, { code: "pdf_password_incorrect", error: "wrong password" });
          }
        }
        const id = `cdj_stub_${++seq}`;
        const resolved = state.resolve ? state.resolve(submitted) : null;
        const fail = resolved?.fail ?? state.failNext;
        state.failNext = null;
        const invoice = resolved ? (resolved.invoice ?? null) : state.invoice;
        const statement = resolved ? (resolved.statement ?? null) : state.statement;
        const confidence = resolved?.confidence ?? state.confidence;
        const job: CognidocsParseJob = fail
          ? {
              id, status: "failed", declaredType: (body.declaredType as never) ?? "auto",
              detectedType: null, confidence: null, error: fail, result: null, sandbox: true,
            }
          : {
              id,
              status: "completed",
              declaredType: (body.declaredType as never) ?? "auto",
              detectedType: invoice ? "invoice" : statement ? "bank_statement" : "unknown",
              confidence,
              error: null,
              result: {
                documentType: invoice ? "invoice" : statement ? "bank_statement" : null,
                parserPath: "stub",
                confidence,
                statement,
                invoice,
              },
              sandbox: true,
            };
        jobs.set(id, { job, pendingPolls: state.pendingPolls });
        // Submit response mirrors the job; a pending-poll phase reports queued.
        send(200, jobs.get(id)!.pendingPolls > 0 ? { ...job, status: "queued", confidence: null, result: null, error: null } : job);
      });
      return;
    }
    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      state.jobGets++;
      const entry = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!entry) return send(404, { error: "job not found" });
      if (entry.pendingPolls > 0) {
        entry.pendingPolls--;
        return send(200, { ...entry.job, status: "processing", confidence: null, result: null, error: null });
      }
      return send(200, entry.job);
    }
    return send(404, { error: "not found" });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  process.env.COGNIDOCS_BASE_URL = baseUrl;
  process.env.COGNIDOCS_SANDBOX_API_KEY = "stub-sandbox-key";
  delete process.env.COGNIDOCS_API_KEY;
  return {
    state,
    baseUrl,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
