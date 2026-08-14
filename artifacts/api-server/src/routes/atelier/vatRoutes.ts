/**
 * Task #654 — VAT return per legal entity & period, computed from the GL.
 *
 *   GET  /vat/return?entityId&period     compute the return (YYYY-MM or YYYY-Qn)
 *   POST /vat/return/file                mark filed → netting journal (Dr 2300 / Cr 1400)
 *                                        + roll fiscal.nextVatFilingDate forward
 *
 * Output VAT = credit balance movement on 2300 (VAT payable — output),
 * Input VAT  = debit balance movement on 1400 (VAT receivable — input),
 * over the period's months, excluding prior vat_return settlements.
 * Net payable stays on 2300 after netting (or net receivable on 1400) —
 * the cash payment is a separate bank event.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierAuditEvents,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";
import { computeVat201, collectGlVat, monthsOfVatPeriod, resolveEmirateBox, type Vat201Report } from "../../lib/atelier-vat201.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  createBrandDoc, addBrandPage, brandTable, glassSection, writeBrandFooters, block,
} from "../../lib/atelier-pdf-brand.js";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

type Me = typeof atelierUsers.$inferSelect;
function denyRead(req: Request, res: Response): Me | null {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  const partnerTier = me.role === "founding_partner" || me.role === "partner";
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !(partnerTier || me.role === "finance")) {
    res.status(403).json({ error: "forbidden", message: "VAT returns are limited to finance leadership." });
    return null;
  }
  return me;
}

// Period parsing + GL VAT collection are shared with the VAT 201 builder
// (lib/atelier-vat201.ts) so the two can never drift apart.
const computeVatReturn = collectGlVat;

/** Latest "VAT 201 exported" audit event for an entity + period, if any. */
async function latestVat201Export(entityId: string, period: string): Promise<{ exportedAt: Date | null; format: string | null }> {
  const rows = await db.select().from(atelierAuditEvents)
    .where(and(
      eq(atelierAuditEvents.entityType, "legal_entity"),
      eq(atelierAuditEvents.entityId, entityId),
      eq(atelierAuditEvents.action, "vat.vat201_exported"),
    ))
    .orderBy(desc(atelierAuditEvents.createdAt))
    .limit(50);
  const hit = rows.find((r) => (r.payload as { period?: string } | null)?.period === period);
  return { exportedAt: hit?.createdAt ?? null, format: (hit?.payload as { format?: string } | null)?.format ?? null };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/vat/return", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const period = String(req.query.period ?? "");
  const months = monthsOfVatPeriod(period);
  if (!entityId || !months)
    return res.status(400).json({ error: "invalid_input", message: "entityId and period (YYYY-MM or YYYY-Qn) are required." });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });
  const ret = await computeVatReturn(me.orgId, entityId, months);
  const [settlement] = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, me.orgId),
    eq(atelierGlJournalEntry.sourceKind, "vat_return"),
    eq(atelierGlJournalEntry.sourceRef, `${entityId}:${period}`),
    isNull(atelierGlJournalEntry.deletedAt),
  )).limit(1);
  const vat201 = ent.country === "AE" ? await latestVat201Export(entityId, period) : { exportedAt: null, format: null };
  return res.json({ ok: true, data: {
    entityId, period, months, ...ret,
    filed: !!settlement,
    settlementJournalEntryId: settlement?.id ?? null,
    filedAt: settlement?.createdAt ?? null,
    vatPeriodSetting: ent.fiscal?.vatPeriod ?? null,
    nextVatFilingDate: ent.fiscal?.nextVatFilingDate ?? null,
    vat201Available: ent.country === "AE" && !!resolveEmirateBox(ent),
    vat201LastExportedAt: vat201.exportedAt,
  } });
});

// ─────────────── Task #1102 — UAE FTA VAT 201 export ───────────────

function aedFmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function vat201Csv(rep: Vat201Report): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = [];
  out.push(`UAE FTA VAT 201 return,${esc(rep.entityName)},${esc(rep.period)},TRN,${esc(rep.trn ?? "not recorded")},AED`);
  out.push("");
  out.push("box,description,amount_aed,vat_aed");
  for (const b of rep.boxes) out.push([b.box, esc(b.label), b.netAed.toFixed(2), b.vatAed.toFixed(2)].join(","));
  out.push("");
  out.push("GL tie-back,output_vat_gl,input_vat_gl,net_vat_gl,output_vat_aed,input_vat_aed");
  out.push([",", rep.glTieBack.outputVat.toFixed(2), rep.glTieBack.inputVat.toFixed(2), rep.glTieBack.netVat.toFixed(2), rep.glTieBack.outputVatAed.toFixed(2), rep.glTieBack.inputVatAed.toFixed(2)].join(","));
  out.push("");
  out.push("box,date,ref,description,source_kind,net_currency,net_source,net_fx,net_aed,vat_currency,vat_source,vat_fx,vat_aed,note");
  for (const b of rep.boxes) for (const l of b.lines) {
    out.push([b.box, l.date, esc(l.ref), esc(l.description), l.sourceKind,
      l.netCurrency, l.netSource.toFixed(2), esc(l.netFxChain), l.netAed.toFixed(2),
      l.vatCurrency, l.vatSource.toFixed(2), esc(l.vatFxChain), l.vatAed.toFixed(2),
      esc(l.note ?? "")].join(","));
  }
  out.push("");
  for (const n of rep.notes) out.push(`note,${esc(n)}`);
  return out.join("\n");
}

function vat201Pdf(rep: Vat201Report, res: Response): void {
  const doc = createBrandDoc();
  doc.pipe(res);
  addBrandPage(doc);
  glassSection(doc, `UAE FTA VAT 201 — ${rep.entityName}`, [
    block.strong(`Tax period ${rep.period} (${rep.months.join(", ")})`),
    block.body(`TRN: ${rep.trn ?? "not recorded"}   ·   VAT period setting: ${rep.vatPeriodSetting ?? "—"}   ·   Currency: AED`),
    block.body(`Emirate attribution: box ${rep.emirate.box} — ${rep.emirate.label} (resolved from ${rep.emirate.basis})`),
    block.muted("Figures for manual transcription into EmaraTax. Built from the general ledger VAT accounts; see the GL tie-back and supporting schedules below."),
  ]);
  brandTable(doc, [
    { label: "Box", width: 36 },
    { label: "Description", width: 267 },
    { label: "Amount (AED)", width: 90, align: "right" },
    { label: "VAT (AED)", width: 90, align: "right" },
  ], rep.boxes.map((b) => [
    b.box, b.label,
    ["12", "13", "14"].includes(b.box) ? "" : aedFmt(b.netAed),
    aedFmt(b.vatAed),
  ]), { boldRows: new Set(rep.boxes.map((b, i) => (["8", "11", "12", "13", "14"].includes(b.box) ? i : -1)).filter((i) => i >= 0)) });

  glassSection(doc, "GL tie-back", [
    block.body(`Output VAT per GL (2300): ${aedFmt(rep.glTieBack.outputVat)} (recorded) → AED ${aedFmt(rep.glTieBack.outputVatAed)} = box 12.`),
    block.body(`Input VAT per GL (1400): ${aedFmt(rep.glTieBack.inputVat)} (recorded) → AED ${aedFmt(rep.glTieBack.inputVatAed)} = box 13.`),
    block.body(`Net VAT per GL: ${aedFmt(rep.glTieBack.netVat)} (recorded) — box 14: AED ${aedFmt(rep.totals.box14NetAed)} ${rep.totals.box14NetAed >= 0 ? "payable" : "refundable"}.`),
  ]);

  for (const b of rep.boxes) {
    if (!b.lines.length) continue;
    addBrandPage(doc);
    glassSection(doc, `Supporting schedule — Box ${b.box}: ${b.label}`, [
      block.body(`${b.lines.length} transaction${b.lines.length === 1 ? "" : "s"} · Amount AED ${aedFmt(b.netAed)} · VAT AED ${aedFmt(b.vatAed)}`),
      ...(b.note ? [block.muted(b.note)] : []),
    ]);
    brandTable(doc, [
      { label: "Date", width: 48 },
      { label: "Reference / description", width: 133 },
      { label: "Net (src)", width: 66, align: "right" },
      { label: "Net FX → AED", width: 92, align: "right" },
      { label: "VAT (src)", width: 52, align: "right" },
      { label: "VAT FX → AED", width: 92, align: "right" },
    ], b.lines.map((l) => [
      l.date,
      `${l.description}${l.note ? ` (${l.note})` : ""}`,
      `${l.netCurrency} ${aedFmt(l.netSource)}`,
      `${l.netFxChain} = ${aedFmt(l.netAed)}`,
      `${l.vatCurrency} ${aedFmt(l.vatSource)}`,
      l.vatSource === 0 ? "—" : `${l.vatFxChain} = ${aedFmt(l.vatAed)}`,
    ]), { fontSize: 6.5 });
  }

  addBrandPage(doc);
  glassSection(doc, "Notes", rep.notes.map((n) => block.bullet(n)));
  writeBrandFooters(doc, { label: `VAT 201 · ${rep.entityName} · ${rep.period}` });
  doc.end();
}

// @cli-skip: file download endpoint (PDF/CSV export), not chat-parity material
router.get("/vat/return/vat201", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const period = String(req.query.period ?? "");
  const format = String(req.query.format ?? "json");
  const months = monthsOfVatPeriod(period);
  if (!entityId || !months)
    return res.status(400).json({ error: "invalid_input", message: "entityId and period (YYYY-MM or YYYY-Qn) are required." });
  if (!["json", "pdf", "csv"].includes(format))
    return res.status(400).json({ error: "invalid_input", message: "format must be json, pdf or csv." });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });
  if (ent.country !== "AE")
    return res.status(400).json({ error: "vat201_uae_only", message: "The FTA VAT 201 format applies to UAE entities only." });
  // A wrong emirate allocation is a filing error — refuse to export when
  // the entity's emirate of establishment cannot be determined.
  const emirate = resolveEmirateBox(ent);
  if (!emirate)
    return res.status(400).json({
      error: "emirate_unresolved",
      message: "Cannot determine the entity's emirate of establishment from its jurisdiction/addresses — set the entity's jurisdiction (e.g. Dubai, Abu Dhabi) in the legal-entity registry before exporting a VAT 201.",
    });

  const rep = await computeVat201(me.orgId, ent, period, months, emirate);
  // Statutory export is blocked while any output transaction lacks
  // classification evidence — a wrong box allocation is a filing error.
  // JSON preview still returns the report so finance can see what to fix.
  if (format !== "json" && rep.unclassified.length > 0)
    return res.status(409).json({
      error: "unclassified_transactions",
      message: `${rep.unclassified.length} output-side transaction(s) lack VAT classification evidence (manual VAT journals, foreign-jurisdiction VAT, or domestic 0% invoices). Reclassify them before exporting the VAT 201.`,
      unclassified: rep.unclassified,
    });

  if (format === "json") return res.json({ ok: true, data: rep });

  // Downloads are recorded so the mark-filed audit trail can show that a
  // VAT 201 export was generated for the period.
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: "legal_entity", entityId,
    actorType: "human", actorId: me.id, actorLabel: me.name,
    action: "vat.vat201_exported",
    payload: {
      period, format,
      box12VatAed: rep.totals.box12VatAed, box13VatAed: rep.totals.box13VatAed, box14NetAed: rep.totals.box14NetAed,
    },
    payloadSummary: `VAT 201 ${format.toUpperCase()} export generated for ${rep.entityName} ${period}: due AED ${rep.totals.box12VatAed}, recoverable AED ${rep.totals.box13VatAed}, net AED ${rep.totals.box14NetAed}`,
  });

  const base = `vat201-${(rep.entityName || "entity").replace(/\s+/g, "_")}-${period}`;
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${base}.csv`));
    return res.send(vat201Csv(rep));
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${base}.pdf`));
  return vat201Pdf(rep, res);
});

const FileSchema = z.object({
  entityId: z.string().min(1),
  period: z.string().min(6).max(8),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/vat/return/file", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = FileSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const { entityId, period } = parsed.data;
  const months = monthsOfVatPeriod(period);
  if (!months) return res.status(400).json({ error: "invalid_input", message: "period must be YYYY-MM or YYYY-Qn." });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });

  const sourceRef = `${entityId}:${period}`;
  const [existing] = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, me.orgId),
    eq(atelierGlJournalEntry.sourceKind, "vat_return"),
    eq(atelierGlJournalEntry.sourceRef, sourceRef),
    isNull(atelierGlJournalEntry.deletedAt),
  )).limit(1);
  if (existing)
    return res.status(409).json({ error: "already_filed", settlementJournalEntryId: existing.id });

  const ret = await computeVatReturn(me.orgId, entityId, months);
  const filingDate = new Date().toISOString().slice(0, 10);
  const filingPeriod = filingDate.slice(0, 7);
  if (await isGlPeriodLocked(me.orgId, filingPeriod))
    return res.status(409).json({ error: "period_locked", message: `Filing period ${filingPeriod} is locked for the GL module.` });

  // Netting journal clears input VAT against output VAT; the net stays
  // on 2300 (payable) or 1400 (receivable) until the cash event.
  const netting = round2(Math.min(Math.max(ret.outputVat, 0), Math.max(ret.inputVat, 0)));
  let settlementJournalEntryId: string | null = null;
  if (netting > 0) {
    const accounts = await db.select().from(atelierGlAccount).where(and(
      eq(atelierGlAccount.orgId, me.orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt),
    ));
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const out = byCode.get("2300"); const inp = byCode.get("1400");
    if (!out || !inp)
      return res.status(400).json({ error: "missing_account", message: "Accounts 2300/1400 missing — seed the entity's chart of accounts first." });
    const entryId = rid("gljrn");
    await db.transaction(async (tx) => {
      await tx.insert(atelierGlJournalEntry).values({
        id: entryId, orgId: me.orgId, legalEntityId: entityId,
        periodLabel: filingPeriod, entryDate: filingDate, kind: "posting",
        sourceKind: "vat_return", sourceRef,
        memo: `VAT return ${period} filed — input netted against output (net ${ret.netVat >= 0 ? "payable" : "receivable"} USD ${Math.abs(ret.netVat)})`,
        currency: "USD", totalDebit: netting, totalCredit: netting, createdByUserId: me.id,
      });
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
        accountId: out.id, accountCode: out.code, accountName: out.name,
        debit: netting, credit: 0, memo: `VAT return ${period} — clear input against output`,
      });
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
        accountId: inp.id, accountCode: inp.code, accountName: inp.name,
        debit: 0, credit: netting, memo: `VAT return ${period} — clear input against output`,
      });
    });
    settlementJournalEntryId = entryId;
  } else {
    // Nothing to net (nil or one-sided return) — still record the filing
    // via a zero-amount marker entry so idempotency + "filed" state hold.
    const entryId = rid("gljrn");
    await db.insert(atelierGlJournalEntry).values({
      id: entryId, orgId: me.orgId, legalEntityId: entityId,
      periodLabel: filingPeriod, entryDate: filingDate, kind: "posting",
      sourceKind: "vat_return", sourceRef,
      memo: `VAT return ${period} filed — nothing to net (output ${ret.outputVat}, input ${ret.inputVat})`,
      currency: "USD", totalDebit: 0, totalCredit: 0, createdByUserId: me.id,
    });
    settlementJournalEntryId = entryId;
  }

  // Roll the fiscal calendar forward (+1 month monthly, +3 quarterly).
  let rolledTo: string | null = null;
  const fiscal = ent.fiscal;
  if (fiscal?.nextVatFilingDate) {
    const stepMonths = (fiscal.vatPeriod ?? "quarterly") === "monthly" ? 1 : 3;
    const d = new Date(`${fiscal.nextVatFilingDate}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCMonth(d.getUTCMonth() + stepMonths);
      rolledTo = d.toISOString().slice(0, 10);
      await db.update(atelierLegalEntities)
        .set({ fiscal: { ...fiscal, nextVatFilingDate: rolledTo }, updatedAt: new Date() })
        .where(eq(atelierLegalEntities.id, entityId));
    }
  }

  // Task #1102 — record whether a VAT 201 export was generated for this
  // period (UAE entities), so the filing audit shows the return artefact.
  const vat201 = ent.country === "AE" ? await latestVat201Export(entityId, period) : { exportedAt: null, format: null };
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: "gl_journal_entry", entityId: settlementJournalEntryId,
    actorType: "human", actorId: me.id, actorLabel: me.name,
    action: "vat.return_filed",
    payload: {
      entityId, period, outputVat: ret.outputVat, inputVat: ret.inputVat, netVat: ret.netVat, netting, rolledNextVatFilingDateTo: rolledTo,
      vat201ExportedAt: vat201.exportedAt ? vat201.exportedAt.toISOString() : null,
      vat201ExportFormat: vat201.format,
    },
    payloadSummary: `VAT return ${period} for ${ent.shortName || ent.legalNameEn} marked filed: output USD ${ret.outputVat}, input USD ${ret.inputVat}, net ${ret.netVat >= 0 ? "payable" : "receivable"} USD ${Math.abs(ret.netVat)}${rolledTo ? ` — next filing rolled to ${rolledTo}` : ""}`,
  });
  return res.json({ ok: true, data: {
    settlementJournalEntryId, outputVat: ret.outputVat, inputVat: ret.inputVat,
    netVat: ret.netVat, netting, rolledNextVatFilingDateTo: rolledTo,
  } });
});

export default router;
