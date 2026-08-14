/**
 * Task #363 — L2C Wave 4 bank statement + reconciliation routes.
 *
 *   POST   /wallet/bank/accounts                       create bank account
 *   GET    /wallet/bank/accounts                       list bank accounts
 *   POST   /wallet/bank/import                         import statement (csv|xero)
 *   GET    /wallet/bank/transactions                   list (filter by acct/state)
 *   POST   /wallet/bank/recon                          open recon period
 *   POST   /wallet/bank/recon/:id/finalise             irreversible close (partner)
 *   GET    /wallet/bank/recon                          list recon periods
 *
 * Restricted personas + board_observer denied (firm-cash domain).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { and, eq, isNull, desc, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  db,
  atelierUsers,
  atelierBankAccount,
  atelierBankStatementImport,
  atelierBankTransaction,
  atelierBankReconPeriod,
  atelierAuditEvents,
  atelierPeriodCloseLock,
} from "@workspace/db";
import { parseBankStatement } from "../../lib/bank-parsers/index.js";
import {
  parsePdfStatementText,
  pdfRowsToCanonicalCsv,
  PDF_STATEMENT_CONFIDENCE_FLOOR,
} from "../../lib/bank-parsers/pdf-statement.js";
import {
  autoMatchImport,
  deriveStatementExceptions,
  summarizeReconTxns,
} from "../../lib/atelier-cash-ops.js";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function ensure(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
function denyAll(req: Request, res: Response): boolean {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return true; }
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Bank capabilities are denied for this persona." });
    return true;
  }
  return false;
}
function isPartnerTier(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
function isFinanceLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return isPartnerTier(me) || me.role === "finance";
}
// Task #1065 — a bank account may only be linked to a legal entity that
// exists in the caller's org.
async function entityExistsInOrg(orgId: string, legalEntityId: string): Promise<boolean> {
  const { atelierLegalEntities } = await import("@workspace/db");
  const [row] = await db
    .select({ id: atelierLegalEntities.id })
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, legalEntityId), eq(atelierLegalEntities.orgId, orgId)));
  return !!row;
}
async function audit(args: {
  entityType: string; entityId: string; actor: typeof atelierUsers.$inferSelect;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: args.entityType, entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

// ─────────────────────── bank accounts ───────────────────────
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const rows = await db.select().from(atelierBankAccount)
    .where(and(eq(atelierBankAccount.orgId, me.orgId), isNull(atelierBankAccount.deletedAt)));
  // Task #1065 — IBAN/SWIFT/holder are banking credentials: full rows only
  // for finance leadership; everyone else gets a redacted shape (labels +
  // last4 keep the recon/cash UIs working).
  const data = isFinanceLeadership(me)
    ? rows
    : rows.map((r) => ({ ...r, iban: null, swift: null, accountHolderName: null }));
  return res.json({ ok: true, data });
});

/**
 * Task #1090 — shared bank-account creation core. Same validation /
 * normalization / audit whether the account is keyed in via the wallet
 * UI form or committed from the Riser bank-letter chat pipeline.
 * Caller owns the finance-leadership gate.
 */
export async function createBankAccountCore(args: {
  me: typeof atelierUsers.$inferSelect;
  bankName?: string; accountLabel?: string; accountNumberLast4?: string;
  currency?: string; openingBalance?: number; legalEntityId?: string;
  iban?: string; purpose?: string; debitCards?: unknown; swift?: string;
  accountHolderName?: string;
  /** Audit provenance: "ui" (default) or "chat". */
  via?: "ui" | "chat";
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  const b = args;
  if (!b.bankName || !b.accountLabel || !b.accountNumberLast4) return { status: 400, body: { error: "invalid_input" } };
  // Task #383 — entity-register extensions.
  const purposeCheck = normalizePurpose(b.purpose);
  if (purposeCheck.error) return { status: 400, body: { error: "invalid_purpose" } };
  const cardsCheck = normalizeDebitCards(b.debitCards);
  if (cardsCheck.error) return { status: 400, body: { error: "invalid_debit_cards" } };
  // Task #1065 — IBAN is normalized AND format-checked (same charset rule as
  // the pay/partner flows: 8-34 alphanumeric after whitespace strip).
  const ibanCheck = normalizeIban(b.iban);
  if (ibanCheck.error) return { status: 400, body: { error: "invalid_iban" } };
  if (b.legalEntityId && !(await entityExistsInOrg(me.orgId, b.legalEntityId)))
    return { status: 404, body: { error: "entity-not-found" } };
  const id = rid("bank");
  await db.insert(atelierBankAccount).values({
    id, orgId: me.orgId, legalEntityId: b.legalEntityId ?? null,
    bankName: b.bankName, accountLabel: b.accountLabel, accountNumberLast4: b.accountNumberLast4,
    currency: b.currency ?? "USD", openingBalance: b.openingBalance ?? 0,
    iban: ibanCheck.value,
    purpose: purposeCheck.value,
    debitCards: cardsCheck.value ?? [],
    swift: normalizeSwift(b.swift),
    accountHolderName: typeof b.accountHolderName === "string" && b.accountHolderName.trim() ? b.accountHolderName.trim().slice(0, 200) : null,
    createdByUserId: me.id,
  });
  await audit({ entityType: "bank_account", entityId: id, actor: me, action: "bank_account.create",
    payload: { bankName: b.bankName, label: b.accountLabel, via: args.via ?? "ui" },
    summary: `Created bank account ${b.accountLabel}` });
  return { status: 200, body: { ok: true, data: { id } } };
}

// @cli-skip: UI-workflow write; chat parity via save_bank_letter_account capability (Task #1090)
router.post("/accounts", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const out = await createBankAccountCore({
    me,
    bankName: typeof b.bankName === "string" ? b.bankName : undefined,
    accountLabel: typeof b.accountLabel === "string" ? b.accountLabel : undefined,
    accountNumberLast4: typeof b.accountNumberLast4 === "string" ? b.accountNumberLast4 : undefined,
    currency: typeof b.currency === "string" ? b.currency : undefined,
    openingBalance: typeof b.openingBalance === "number" ? b.openingBalance : undefined,
    legalEntityId: typeof b.legalEntityId === "string" ? b.legalEntityId : undefined,
    iban: typeof b.iban === "string" ? b.iban : undefined,
    purpose: typeof b.purpose === "string" ? b.purpose : undefined,
    debitCards: b.debitCards,
    swift: typeof b.swift === "string" ? b.swift : undefined,
    accountHolderName: typeof b.accountHolderName === "string" ? b.accountHolderName : undefined,
    via: "ui",
  });
  return res.status(out.status).json(out.body);
});

// Task #1065 — shared IBAN/SWIFT normalization for entity bank accounts.
function normalizeIban(v: unknown): { value: string | null; error?: boolean } {
  if (v === undefined || v === null || v === "") return { value: null };
  if (typeof v !== "string") return { value: null, error: true };
  const norm = v.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8,34}$/.test(norm)) return { value: null, error: true };
  return { value: norm };
}
function normalizeSwift(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const norm = v.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{8,11}$/.test(norm) ? norm : null;
}

// ─────────────────── Task #383 — account definition update ───────────────────
const ACCOUNT_PURPOSES = new Set(["operating", "payroll", "tax", "savings", "client_money", "other"]);
function normalizePurpose(v: unknown): { value: string | null; error?: boolean } {
  if (v === undefined || v === null || v === "") return { value: null };
  if (typeof v !== "string" || !ACCOUNT_PURPOSES.has(v)) return { value: null, error: true };
  return { value: v };
}
function normalizeDebitCards(v: unknown): {
  value: Array<{ id: string; holderName: string; last4: string; label: string | null; active: boolean }> | null;
  error?: boolean;
} {
  if (v === undefined) return { value: null };
  if (!Array.isArray(v)) return { value: null, error: true };
  const out: Array<{ id: string; holderName: string; last4: string; label: string | null; active: boolean }> = [];
  for (const raw of v as Array<Record<string, unknown>>) {
    const holderName = typeof raw?.holderName === "string" ? raw.holderName.trim().slice(0, 200) : "";
    const last4 = typeof raw?.last4 === "string" ? raw.last4.trim() : "";
    if (!holderName || !/^\d{4}$/.test(last4)) return { value: null, error: true };
    out.push({
      id: typeof raw?.id === "string" && raw.id ? raw.id : rid("card"),
      holderName,
      last4,
      label: typeof raw?.label === "string" ? raw.label.slice(0, 100) : null,
      active: raw?.active !== false,
    });
  }
  return { value: out };
}

// @cli-skip: UI-workflow write; entity-register maintenance (Task #383)
router.patch("/accounts/:id", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const [row] = await db.select().from(atelierBankAccount)
    .where(and(eq(atelierBankAccount.id, req.params.id), eq(atelierBankAccount.orgId, me.orgId), isNull(atelierBankAccount.deletedAt)));
  if (!row) return res.status(404).json({ error: "bank-account-not-found" });
  const b = req.body as { bankName?: string; accountLabel?: string; legalEntityId?: string | null; iban?: string | null; purpose?: string | null; debitCards?: unknown; isActive?: boolean; swift?: string | null; accountHolderName?: string | null; accountNumberLast4?: string; currency?: string };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.bankName === "string" && b.bankName) patch.bankName = b.bankName.slice(0, 200);
  if (typeof b.accountLabel === "string" && b.accountLabel) patch.accountLabel = b.accountLabel.slice(0, 200);
  if (b.legalEntityId !== undefined) {
    if (b.legalEntityId && !(await entityExistsInOrg(me.orgId, b.legalEntityId)))
      return res.status(404).json({ error: "entity-not-found" });
    patch.legalEntityId = b.legalEntityId || null;
  }
  if (b.iban !== undefined) {
    const i = normalizeIban(b.iban);
    if (i.error) return res.status(400).json({ error: "invalid_iban" });
    patch.iban = i.value;
  }
  if (b.swift !== undefined) patch.swift = normalizeSwift(b.swift);
  if (b.accountHolderName !== undefined) patch.accountHolderName = typeof b.accountHolderName === "string" && b.accountHolderName.trim() ? b.accountHolderName.trim().slice(0, 200) : null;
  if (typeof b.accountNumberLast4 === "string" && b.accountNumberLast4) patch.accountNumberLast4 = b.accountNumberLast4.slice(0, 20);
  if (typeof b.currency === "string" && /^[A-Za-z]{3}$/.test(b.currency)) patch.currency = b.currency.toUpperCase();
  if (b.purpose !== undefined) {
    const p = normalizePurpose(b.purpose);
    if (p.error) return res.status(400).json({ error: "invalid_purpose" });
    patch.purpose = p.value;
  }
  if (b.debitCards !== undefined) {
    const c = normalizeDebitCards(b.debitCards);
    if (c.error) return res.status(400).json({ error: "invalid_debit_cards" });
    patch.debitCards = c.value ?? [];
  }
  if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
  await db.update(atelierBankAccount).set(patch).where(eq(atelierBankAccount.id, row.id));
  const [updated] = await db.select().from(atelierBankAccount).where(eq(atelierBankAccount.id, row.id));
  await audit({ entityType: "bank_account", entityId: row.id, actor: me, action: "bank_account.update",
    payload: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") }, summary: `Updated bank account ${row.accountLabel}` });
  return res.json({ ok: true, data: updated });
});

// ─────────────────────── statement import ───────────────────────

/**
 * Task #1071 — shared import core used by both the JSON `/import` route
 * and the multipart `/import-file` upload. Idempotent per
 * (org, account, sha256(raw)) via the unique index + pre-check.
 */
export async function importStatementCore(args: {
  me: typeof atelierUsers.$inferSelect;
  bankAccountId: string;
  source: "csv" | "xero";
  raw: string;
  statementDate: string;
  notes?: string | null;
  fileUrl?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  const [acct] = await db.select().from(atelierBankAccount)
    .where(and(eq(atelierBankAccount.id, args.bankAccountId), eq(atelierBankAccount.orgId, me.orgId)));
  if (!acct) return { status: 404, body: { error: "not_found" } };
  const fileHash = createHash("sha256").update(args.raw).digest("hex").slice(0, 16);
  const dup = await db.select({ id: atelierBankStatementImport.id }).from(atelierBankStatementImport)
    .where(and(eq(atelierBankStatementImport.orgId, me.orgId),
      eq(atelierBankStatementImport.bankAccountId, args.bankAccountId),
      eq(atelierBankStatementImport.fileHash, fileHash)));
  if (dup.length > 0) {
    return { status: 409, body: { error: "duplicate", message: "Statement file already imported.", importId: dup[0].id } };
  }
  const parsed = parseBankStatement(args.source, args.raw, acct.currency);
  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    return { status: 400, body: { error: "parse_failed", message: "No rows could be parsed from the statement.", errors: parsed.errors } };
  }
  const importId = rid("bnkimp");
  try {
    // Import row + transactions land atomically; the unique index
    // (orgId, bankAccountId, fileHash) makes concurrent duplicate
    // uploads lose here even if both passed the pre-check.
    await db.transaction(async (tx) => {
      await tx.insert(atelierBankStatementImport).values({
        id: importId, orgId: me.orgId, bankAccountId: args.bankAccountId, statementDate: args.statementDate,
        source: args.source, fileUrl: args.fileUrl ?? null, fileHash, rowsCount: parsed.rows.length,
        importedBy: me.id, notes: args.notes ?? null, createdByUserId: me.id,
      });
      if (parsed.rows.length > 0) {
        await tx.insert(atelierBankTransaction).values(parsed.rows.map((r) => ({
          id: rid("bnktxn"), orgId: me.orgId, bankAccountId: args.bankAccountId, statementImportId: importId,
          postedDate: r.postedDate, amount: r.amount, currency: r.currency,
          counterpartyNameRaw: r.counterpartyNameRaw, referenceRaw: r.referenceRaw,
          kind: r.kind, matchedState: "unmatched", createdByUserId: me.id,
        })));
      }
    });
  } catch (err) {
    const code = (err as { code?: string })?.code
      ?? ((err as { cause?: { code?: string } })?.cause?.code);
    if (code === "23505") {
      return { status: 409, body: { error: "duplicate", message: "Statement file already imported." } };
    }
    throw err;
  }
  await audit({ entityType: "bank_statement_import", entityId: importId, actor: me,
    action: "bank_import.create",
    payload: { bankAccountId: args.bankAccountId, rowsCount: parsed.rows.length, errors: parsed.errors.length },
    summary: `Imported ${parsed.rows.length} bank rows (${parsed.errors.length} errors)` });
  // Task #431 — Cash Application Matcher auto-runs after every import:
  // inflows get cash-receipt rows + invoice proposals, outflows get
  // triage source candidates. Fail-soft: a matcher error never fails
  // the import itself, and is reported in the response.
  let matcher: { status: "ok" | "failed"; summary?: unknown; message?: string } = { status: "ok" };
  if (parsed.rows.length > 0) {
    try {
      const s = await autoMatchImport({
        orgId: me.orgId, statementImportId: importId,
        triggeredByUserId: me.id, actorLabel: me.name,
      });
      matcher = { status: s.errors.length > 0 ? "failed" : "ok", summary: s };
    } catch (err) {
      matcher = { status: "failed", message: err instanceof Error ? err.message : String(err) };
    }
  }
  return { status: 200, body: { ok: true, data: { importId, rowsImported: parsed.rows.length, errors: parsed.errors, matcher } } };
}

/** Detect the export flavour from the header line (Xero exports name a Payee column). */
export function detectStatementSource(raw: string): "csv" | "xero" {
  const header = raw.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return header.includes("payee") ? "xero" : "csv";
}

/**
 * Task #1071 — durably store the original statement bytes. The source file
 * is audit evidence, so storage success is a hard precondition of EVERY
 * import path; throws on any failure (callers return a retryable 503).
 */
export async function storeStatementObject(
  buffer: Buffer, originalName: string, mimetype: string,
): Promise<{ fileUrl: string; removeObject: () => Promise<void> }> {
  if (process.env.NODE_ENV === "test" && process.env.TEST_FORCE_STATEMENT_STORAGE_FAIL === "1")
    throw new Error("forced storage failure (test)");
  const { ObjectStorageService, objectStorageClient } = await import("../../lib/objectStorage.js");
  const svc = new ObjectStorageService();
  // Collision-resistant per-upload key: concurrent same-named uploads get
  // distinct objects, so a losing request's cleanup can never delete the
  // winner's audit evidence.
  const key = `${svc.getPrivateObjectDir()}/bank-statements/${randomUUID()}_${originalName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const slash = key.startsWith("/") ? key.slice(1) : key;
  const bucketName = slash.split("/")[0];
  const objectName = slash.split("/").slice(1).join("/");
  const obj = objectStorageClient.bucket(bucketName).file(objectName);
  await obj.save(buffer, { contentType: mimetype });
  return { fileUrl: key, removeObject: async () => { await obj.delete().catch(() => {}); } };
}

// @cli-skip: file-upload statement import; no CLI tool shape
router.post("/import", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { bankAccountId?: string; source?: "csv" | "xero"; raw?: string; statementDate?: string; notes?: string };
  if (!b.bankAccountId || !b.raw || !b.statementDate) return res.status(400).json({ error: "invalid_input" });
  // Same durable-storage precondition as the multipart route: the raw
  // statement text is persisted as the audit-evidence original.
  let stored: Awaited<ReturnType<typeof storeStatementObject>>;
  try {
    stored = await storeStatementObject(Buffer.from(b.raw, "utf8"), `statement-${b.statementDate}.csv`, "text/csv");
  } catch (err) {
    return res.status(503).json({
      error: "storage_unavailable",
      message: "Could not store the statement file — nothing was imported. Please retry.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  const out = await importStatementCore({
    me, bankAccountId: b.bankAccountId, source: b.source ?? "csv", raw: b.raw,
    statementDate: b.statementDate, notes: b.notes ?? null, fileUrl: stored.fileUrl,
  });
  if (out.status !== 200) await stored.removeObject();
  return res.status(out.status).json(out.body);
});

// Task #1071 — multipart statement-file upload (CSV / Xero export).
const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 4 * 1024 * 1024 },
});
// @cli-skip: file-upload statement import; no CLI tool shape
router.post("/import-file", (req, res) => {
  statementUpload.single("file")(req, res, async (err: unknown) => {
    if (err) return res.status(400).json({ error: "upload_failed", message: err instanceof Error ? err.message : String(err) });
    if (denyAll(req, res)) return;
    const me = ensure(req, res); if (!me) return;
    if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
    const b = req.body as { bankAccountId?: string; statementDate?: string; source?: string; notes?: string; confirm?: string };
    const file = req.file;
    if (!file || !b.bankAccountId || !b.statementDate)
      return res.status(400).json({ error: "invalid_input", message: "file, bankAccountId and statementDate are required." });
    const name = (file.originalname ?? "").toLowerCase();
    const isPdf =
      name.endsWith(".pdf") || file.mimetype === "application/pdf" ||
      file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    let raw: string;
    let source: "csv" | "xero";
    if (isPdf) {
      // Task #1111 — PDF statements go through the same GUARDED extraction
      // as the chat import (Task #1094): date-anchored rows with per-row
      // confidence; ambiguous rows are flagged and SKIPPED, never guessed;
      // low overall confidence refuses with CSV-export guidance. The web
      // flow is two-phase: without confirm=true the route returns a preview
      // of extracted + flagged rows and imports nothing.
      const [acct] = await db.select().from(atelierBankAccount)
        .where(and(eq(atelierBankAccount.id, b.bankAccountId), eq(atelierBankAccount.orgId, me.orgId)));
      if (!acct) return res.status(404).json({ error: "not_found", message: "Bank account not found." });
      const { extractAttachment } = await import("../../lib/atelier-cli/attachments/extractors.js");
      const extracted = await extractAttachment({
        fileName: file.originalname ?? "statement.pdf",
        mime: file.mimetype || "application/pdf",
        bytes: file.buffer,
      });
      const pdfText = (extracted.normalizedText ?? "").trim();
      const parsed = parsePdfStatementText(pdfText, acct.currency);
      if (parsed.rows.length === 0 || parsed.confidence < PDF_STATEMENT_CONFIDENCE_FLOOR) {
        return res.status(400).json({
          error: "pdf_low_confidence",
          message: `We couldn't confidently extract transaction rows from this PDF${parsed.flagged.length > 0 ? ` (${parsed.flagged.length} candidate row(s) were too ambiguous to trust — amounts are never guessed)` : ""} — export a CSV from your bank and upload that instead.`,
        });
      }
      // Deterministic parser: the confirm phase re-parses the same bytes and
      // must see identical rows, so the canonical CSV (and therefore the
      // dedupe hash) is stable across preview + confirm.
      raw = pdfRowsToCanonicalCsv(parsed.rows);
      source = "csv";
      if (b.confirm !== "true") {
        return res.json({
          ok: true,
          data: {
            preview: {
              source: "pdf",
              rowsExtracted: parsed.rows.length,
              flaggedRows: parsed.flagged.length,
              confidence: parsed.confidence,
              rows: parsed.rows.slice(0, 200).map((r) => ({
                postedDate: r.postedDate, amount: r.amount, currency: r.currency,
                counterparty: r.counterpartyNameRaw, reference: r.referenceRaw,
                kind: r.kind, confidence: r.confidence,
              })),
              flagged: parsed.flagged.slice(0, 25).map((f) => ({
                dateToken: f.dateToken, snippet: f.snippet, reason: f.reason,
              })),
            },
          },
        });
      }
    } else {
      raw = file.buffer.toString("utf8");
      if (!raw.trim()) return res.status(400).json({ error: "invalid_input", message: "Uploaded file is empty." });
      source = b.source === "csv" || b.source === "xero" ? b.source : detectStatementSource(raw);
    }
    // Idempotency pre-check BEFORE touching storage, so a duplicate upload
    // never leaves an orphaned object behind.
    const preHash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    const preDup = await db.select({ id: atelierBankStatementImport.id }).from(atelierBankStatementImport)
      .where(and(eq(atelierBankStatementImport.orgId, me.orgId),
        eq(atelierBankStatementImport.bankAccountId, b.bankAccountId),
        eq(atelierBankStatementImport.fileHash, preHash)));
    if (preDup.length > 0)
      return res.status(409).json({ error: "duplicate", message: "Statement file already imported.", importId: preDup[0].id });
    // Durable storage of the original statement is a precondition for a
    // successful import — the source file is audit evidence. Any storage
    // failure aborts with a retryable 503 before any rows are written.
    let stored: Awaited<ReturnType<typeof storeStatementObject>>;
    try {
      stored = await storeStatementObject(file.buffer, file.originalname ?? "statement.csv", file.mimetype || "text/csv");
    } catch (err) {
      return res.status(503).json({
        error: "storage_unavailable",
        message: "Could not store the statement file — nothing was imported. Please retry.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    const out = await importStatementCore({
      me, bankAccountId: b.bankAccountId, source, raw,
      statementDate: b.statementDate, notes: b.notes ?? null, fileUrl: stored.fileUrl,
    });
    // If the import was rejected after upload (e.g. lost the dedupe race or
    // parse failure), don't leave an orphaned object in storage.
    if (out.status !== 200) await stored.removeObject();
    return res.status(out.status).json(out.body);
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/transactions", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const acctId = req.query.bankAccountId as string | undefined;
  const state = req.query.state as string | undefined;
  const where = [eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)];
  if (acctId) where.push(eq(atelierBankTransaction.bankAccountId, acctId));
  if (state) where.push(eq(atelierBankTransaction.matchedState, state));
  const rows = await db.select().from(atelierBankTransaction).where(and(...where))
    .orderBy(desc(atelierBankTransaction.postedDate)).limit(500);
  return res.json({ ok: true, data: { rows } });
});

// ─────────────────────── reconciliation ───────────────────────
// @cli-skip: pending Task #340 read-parity migration
router.get("/recon", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const acctId = req.query.bankAccountId as string | undefined;
  const where = [eq(atelierBankReconPeriod.orgId, me.orgId), isNull(atelierBankReconPeriod.deletedAt)];
  if (acctId) where.push(eq(atelierBankReconPeriod.bankAccountId, acctId));
  const rows = await db.select().from(atelierBankReconPeriod).where(and(...where))
    .orderBy(desc(atelierBankReconPeriod.periodEnd)).limit(60);
  // Task #1071 — enrich each period with matched/unmatched totals and the
  // count of outstanding exceptions (derived at read time, never persisted).
  const acctIds = [...new Set(rows.map((r) => r.bankAccountId))];
  const txns = acctIds.length > 0
    ? await db.select().from(atelierBankTransaction).where(and(
        eq(atelierBankTransaction.orgId, me.orgId),
        inArray(atelierBankTransaction.bankAccountId, acctIds),
        isNull(atelierBankTransaction.deletedAt),
      ))
    : [];
  const enriched = rows.map((r) => ({
    ...r,
    reconSummary: summarizeReconTxns(txns.filter((t) =>
      t.bankAccountId === r.bankAccountId && t.postedDate >= r.periodStart && t.postedDate <= r.periodEnd)),
  }));
  return res.json({ ok: true, data: { rows: enriched } });
});

/** Load a period's (org-scoped) txns for exceptions/finalise checks. */
async function loadPeriodTxns(orgId: string, period: typeof atelierBankReconPeriod.$inferSelect) {
  return db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.orgId, orgId),
    eq(atelierBankTransaction.bankAccountId, period.bankAccountId),
    isNull(atelierBankTransaction.deletedAt),
    sql`${atelierBankTransaction.postedDate} >= ${period.periodStart}`,
    sql`${atelierBankTransaction.postedDate} <= ${period.periodEnd}`,
  ));
}

// Task #1071 — actionable exceptions for one reconciliation period.
// @cli-skip: pending Task #340 read-parity migration
router.get("/recon/:id/exceptions", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const [period] = await db.select().from(atelierBankReconPeriod)
    .where(and(eq(atelierBankReconPeriod.id, req.params.id), eq(atelierBankReconPeriod.orgId, me.orgId), isNull(atelierBankReconPeriod.deletedAt)));
  if (!period) return res.status(404).json({ error: "not_found" });
  const txns = await loadPeriodTxns(me.orgId, period);
  const exceptions = deriveStatementExceptions(txns).map((e) => ({
    txnId: e.txn.id,
    postedDate: e.txn.postedDate,
    amount: e.txn.amount,
    currency: e.txn.currency,
    counterpartyNameRaw: e.txn.counterpartyNameRaw,
    referenceRaw: e.txn.referenceRaw,
    matchedState: e.txn.matchedState,
    reasons: e.reasons,
    detail: e.detail,
  }));
  return res.json({ ok: true, data: { periodId: period.id, summary: summarizeReconTxns(txns), exceptions } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/recon", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { bankAccountId?: string; periodLabel?: string; periodStart?: string; periodEnd?: string; openingBalance?: number; closingBalance?: number };
  if (!b.bankAccountId || !b.periodLabel || !b.periodStart || !b.periodEnd) return res.status(400).json({ error: "invalid_input" });
  const id = rid("recon");
  // compute receipts/payments + variance
  const txns = await db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.orgId, me.orgId),
    eq(atelierBankTransaction.bankAccountId, b.bankAccountId),
    sql`${atelierBankTransaction.postedDate} >= ${b.periodStart}`,
    sql`${atelierBankTransaction.postedDate} <= ${b.periodEnd}`,
  ));
  const receipts = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const payments = txns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const opening = b.openingBalance ?? 0;
  const closing = b.closingBalance ?? Math.round((opening + receipts - payments) * 100) / 100;
  const variance = Math.round((closing - (opening + receipts - payments)) * 100) / 100;
  await db.insert(atelierBankReconPeriod).values({
    id, orgId: me.orgId, bankAccountId: b.bankAccountId, periodLabel: b.periodLabel,
    periodStart: b.periodStart, periodEnd: b.periodEnd, openingBalance: opening, closingBalance: closing,
    computedReceipts: receipts, computedPayments: payments, variance, status: "open",
    createdByUserId: me.id,
  });
  await audit({ entityType: "bank_recon_period", entityId: id, actor: me,
    action: "bank_recon.open",
    payload: { bankAccountId: b.bankAccountId, periodLabel: b.periodLabel, variance },
    summary: `Opened recon ${b.periodLabel} (variance ${variance})` });
  return res.json({ ok: true, data: { id, computedReceipts: receipts, computedPayments: payments, variance } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/recon/:id/finalise", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isPartnerTier(me)) return res.status(403).json({ error: "forbidden", message: "partner-tier only" });
  const reconId = req.params.id;
  const b = req.body as { rationale?: string; varianceAccepted?: boolean; exceptionsAcknowledged?: boolean };
  const [period] = await db.select().from(atelierBankReconPeriod)
    .where(and(eq(atelierBankReconPeriod.id, reconId), eq(atelierBankReconPeriod.orgId, me.orgId)));
  if (!period) return res.status(404).json({ error: "not_found" });
  if (period.status === "finalised") return res.status(409).json({ error: "already_finalised" });
  if (Math.abs(period.variance) > 0.01 && !b.varianceAccepted) {
    return res.status(409).json({ error: "variance_present", variance: period.variance, message: "Set varianceAccepted=true to finalise with variance." });
  }
  // Task #1071 — outstanding exceptions block finalisation unless
  // explicitly acknowledged by the partner.
  const periodTxns = await loadPeriodTxns(me.orgId, period);
  const openExceptions = deriveStatementExceptions(periodTxns);
  if (openExceptions.length > 0 && !b.exceptionsAcknowledged) {
    return res.status(409).json({
      error: "exceptions_present",
      count: openExceptions.length,
      message: "Resolve outstanding exceptions or set exceptionsAcknowledged=true to finalise anyway.",
    });
  }
  await db.update(atelierBankReconPeriod).set({
    status: "finalised", finalisedAt: new Date(), finalisedByUserId: me.id, approvedByUserId: me.id,
    rationaleText: b.rationale ?? null, updatedAt: new Date(),
  }).where(eq(atelierBankReconPeriod.id, reconId));
  // Add `bank_rec` to atelier_period_close_lock for the matching month, if present.
  const monthLabel = period.periodEnd.slice(0, 7); // YYYY-MM
  const [lock] = await db.select().from(atelierPeriodCloseLock)
    .where(and(eq(atelierPeriodCloseLock.orgId, me.orgId), eq(atelierPeriodCloseLock.periodLabel, monthLabel)));
  if (lock) {
    const next = Array.from(new Set([...(lock.lockedModules ?? []), "bank_rec"]));
    await db.update(atelierPeriodCloseLock).set({ lockedModules: next, updatedAt: new Date() })
      .where(eq(atelierPeriodCloseLock.id, lock.id));
  }
  await audit({ entityType: "bank_recon_period", entityId: reconId, actor: me,
    action: "bank_recon.finalise",
    payload: {
      variance: period.variance, varianceAccepted: !!b.varianceAccepted,
      openExceptions: openExceptions.length, exceptionsAcknowledged: !!b.exceptionsAcknowledged,
    },
    summary: `Finalised recon ${period.periodLabel}` });
  return res.json({ ok: true, data: { id: reconId, status: "finalised" } });
});

export default router;
