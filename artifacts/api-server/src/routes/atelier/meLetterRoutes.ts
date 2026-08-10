/**
 * Task #845 — /me/letters: self-service employment & salary letters.
 *
 * Employees request official letters (salary certificates, employment
 * verification, visa NOCs…) issued on Cognirise letterhead, signed by
 * the employing entity's signatory and emailed to their Cognirise inbox
 * (or, for wet signature, to the signatory to print/sign/hand over).
 *
 * Strictly self-scope: the subject is always the caller's own roster
 * row; salary figures come from the caller's own comp record. Employees
 * only — contractors and non-roster personas get clean refusals. The
 * read-only demo account is blocked by the global demoReadOnlyGuard.
 *
 * Chat parity: POST /me/letters ↔ me.letter_request (me-chat-parity).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierEmployees,
  atelierLetterIssuances,
  atelierUsers,
} from "@workspace/db";
import { audit } from "./engagementRoutes.js";
import { LETTER_TYPES, LETTER_TYPE_IDS, letterTypeById } from "../../lib/atelier-letters/catalog.js";
import {
  issueLetter,
  previewLetterIssue,
  resolveEmployingEntity,
} from "../../lib/atelier-letters/service.js";

const router: IRouter = Router();

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

/** Resolve the caller's own employee roster row; employees only. */
async function requireSelfEmployee(
  req: Request,
  res: Response,
): Promise<{
  me: typeof atelierUsers.$inferSelect;
  emp: typeof atelierEmployees.$inferSelect;
} | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, me.orgId),
        eq(atelierEmployees.userId, me.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (!emp) {
    res.status(403).json({
      error: "employees-only",
      message:
        "Official employment and salary letters are issued to employees only. No employee roster record is linked to your login.",
    });
    return null;
  }
  // Authoritative persona check (mirrors the chat capability's
  // isContractorCaller): a contractor persona that is erroneously or
  // historically linked to an employee roster row must not obtain
  // salary-bearing official letters.
  if (me.role === "contractor") {
    res.status(403).json({
      error: "employees-only",
      message:
        "Official employment and salary letters are issued to employees only. Contractor logins can't request them.",
    });
    return null;
  }
  return { me, emp };
}

function issuanceWire(row: typeof atelierLetterIssuances.$inferSelect) {
  const def = letterTypeById(row.letterType);
  return {
    id: row.id,
    letterType: row.letterType,
    letterLabel: def?.label ?? row.letterType,
    language: row.language,
    deliveryMode: row.deliveryMode,
    addresseeName: row.addresseeName,
    addresseeInstitution: row.addresseeInstitution,
    purpose: row.purpose,
    travelStart: row.travelStart,
    travelEnd: row.travelEnd,
    refNumber: row.refNumber,
    entityName: row.entityName,
    signatoryName: row.signatoryName,
    signatoryTitle: row.signatoryTitle,
    status: row.status,
    emailVia: row.emailVia,
    emailTo: row.emailTo,
    delivered: row.emailVia === "resend",
    documentId: row.documentId,
    fileName: row.fileName,
    createdAt: row.createdAt,
  };
}

// List own letter requests + the request catalog (for the Me surface).
// @cli-skip: self-scope letters read; chat exposes it via me.letter_request (Task #845)
router.get("/me/letters", async (req, res) => {
  const ctx = await requireSelfEmployee(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(atelierLetterIssuances)
    .where(
      and(
        eq(atelierLetterIssuances.orgId, ctx.me.orgId),
        eq(atelierLetterIssuances.personId, ctx.emp.id),
        isNull(atelierLetterIssuances.deletedAt),
      ),
    )
    .orderBy(desc(atelierLetterIssuances.createdAt));
  const resolution = await resolveEmployingEntity(ctx.me.orgId, ctx.emp);
  res.json({
    letters: rows.map(issuanceWire),
    catalog: LETTER_TYPES,
    entity: resolution.entity
      ? {
          id: resolution.entity.id,
          name: resolution.entity.name,
          via: resolution.via,
          signatoryName: resolution.entity.signatoryName || null,
          signatoryTitle: resolution.entity.signatoryTitle || null,
          hasSignature: !!resolution.entity.signatureFileRef,
          hasStamp: !!resolution.entity.stampFileRef,
          wetSignatureAvailable:
            !!resolution.entity.signatoryName && !!resolution.entity.signatoryEmail,
        }
      : null,
  });
});

const createBody = z.object({
  letterType: z.string().trim().min(1),
  language: z.enum(["en", "ar", "tr"]),
  deliveryMode: z.enum(["digital", "wet_signature"]).default("digital"),
  addresseeName: z.string().trim().max(200).optional(),
  addresseeInstitution: z.string().trim().max(300).optional(),
  purpose: z.string().trim().max(500).optional(),
  travelStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  travelEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  destination: z.string().trim().max(200).optional(),
});

// Issue a letter (generate PDF, log, store, email). Self-scope write.
// @cli-skip: chat parity via me.letter_request (Task #845)
router.post("/me/letters", async (req, res) => {
  const ctx = await requireSelfEmployee(req, res);
  if (!ctx) return;
  const parsed = createBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  if (!LETTER_TYPE_IDS.has(b.letterType)) {
    res.status(400).json({ error: "unknown-type", allowed: [...LETTER_TYPE_IDS] });
    return;
  }
  const result = await issueLetter(
    { userId: ctx.me.id, orgId: ctx.me.orgId, userName: ctx.me.name },
    ctx.emp,
    b,
  );
  if (!result.ok) {
    res.status(422).json({ error: result.error, message: result.message });
    return;
  }
  await audit({
    entityType: "letter_issuance",
    entityId: result.issuanceId,
    actor: ctx.me,
    action: "letter.issued",
    payload: {
      letterType: b.letterType,
      language: b.language,
      deliveryMode: b.deliveryMode,
      refNumber: result.refNumber,
      entityName: result.entityName,
      emailVia: result.emailVia,
      status: result.status,
    },
    summary: `Issued ${letterTypeById(b.letterType)?.label ?? b.letterType} (${result.refNumber}) — ${b.deliveryMode === "wet_signature" ? "sent to signatory for wet signature" : "digital"}`,
  });
  const [row] = await db
    .select()
    .from(atelierLetterIssuances)
    .where(eq(atelierLetterIssuances.id, result.issuanceId));
  res.status(201).json({ letter: issuanceWire(row), delivered: result.delivered });
});

// Preview the confirm-step summary (entity, signatory, salary presence).
// @cli-skip: self-scope preview read; chat exposes it via me.letter_request (Task #845)
router.post("/me/letters/preview", async (req, res) => {
  const ctx = await requireSelfEmployee(req, res);
  if (!ctx) return;
  const parsed = createBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const preview = await previewLetterIssue(ctx.me.orgId, ctx.emp, parsed.data);
  if (!preview.ok) {
    res.status(422).json({ error: preview.error, message: preview.message });
    return;
  }
  res.json({
    ok: true,
    entity: {
      id: preview.entity.id,
      name: preview.entity.name,
      via: preview.entityVia,
      signatoryName: preview.entity.signatoryName || null,
      signatoryTitle: preview.entity.signatoryTitle || null,
      hasSignature: !!preview.entity.signatureFileRef,
      hasStamp: !!preview.entity.stampFileRef,
    },
    salary: preview.salary
      ? { currency: preview.salary.currency, hasSalary: true }
      : { hasSalary: false },
  });
});

// Task #863 — close out a wet-signature letter once the signed hard copy
// has been handed to the employee. Wet issuances otherwise stay at
// sent_to_signatory forever. This is NOT a self-scope route: the person
// closing the loop is the signatory/HR (the employee only receives the
// paper), so it lives outside /me/* and the self-only persona gate keeps
// employees/contractors away. Roles: founding partners, partners
// (signatories) and HR.
// @cli-skip: administrative close-out of a wet-signature letter; no chat surface (Task #863)
router.post("/letters/issuances/:id/handed-over", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "founding_partner" && me.role !== "partner" && me.role !== "hr") {
    res.status(403).json({
      error: "forbidden",
      message:
        "Only the signatory (a partner) or HR can mark a letter as handed over.",
    });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierLetterIssuances)
    .where(
      and(
        eq(atelierLetterIssuances.orgId, me.orgId),
        eq(atelierLetterIssuances.id, req.params.id),
        isNull(atelierLetterIssuances.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (row.deliveryMode !== "wet_signature") {
    res.status(409).json({
      error: "not-wet-signature",
      message: "Only wet-signature letters have a hand-over step.",
    });
    return;
  }
  // Idempotent: re-marking an already handed-over letter is a no-op 200.
  if (row.status === "handed_over") {
    res.json({ letter: issuanceWire(row), alreadyHandedOver: true });
    return;
  }
  if (row.status !== "sent_to_signatory") {
    res.status(409).json({
      error: "invalid-status",
      message: `Letter is in status "${row.status}" — only letters awaiting hand-over can be marked handed over.`,
    });
    return;
  }
  const [updated] = await db
    .update(atelierLetterIssuances)
    .set({ status: "handed_over", updatedAt: new Date() })
    .where(
      and(
        eq(atelierLetterIssuances.id, row.id),
        eq(atelierLetterIssuances.orgId, me.orgId),
        // CAS guard: a concurrent marker loses cleanly (idempotent anyway).
        eq(atelierLetterIssuances.status, "sent_to_signatory"),
      ),
    )
    .returning();
  const finalRow = updated ?? { ...row, status: "handed_over" };
  if (updated) {
    await audit({
      entityType: "letter_issuance",
      entityId: row.id,
      actor: me,
      action: "letter.handed_over",
      payload: {
        letterType: row.letterType,
        refNumber: row.refNumber,
        deliveryMode: row.deliveryMode,
        previousStatus: row.status,
        status: "handed_over",
        signatoryName: row.signatoryName,
      },
      summary: `Marked ${letterTypeById(row.letterType)?.label ?? row.letterType} (${row.refNumber}) as signed and handed over`,
    });
  }
  res.json({ letter: issuanceWire(finalRow), alreadyHandedOver: !updated });
});

export default router;
