// ============================================================
// Task #589 — First-meeting prep card (self-contained HTML).
// ------------------------------------------------------------
// GET /atelier/accounts/:accountId/meeting-prep.html
//   optional query: ?contactId=<id> spotlights one decision-maker.
//
// Projects the Account Cartographer's 4-step research (Client
// Present Brief, Origination Hypothesis, Stress-Test, deep person
// profiles) into a downloadable, self-contained HTML card a Partner
// can take into a first executive conversation.
//
// Access: canSeeAccount (read parity with the workspace account
// view) — mirrors the plan.pdf gate. The card carries no account-
// wide financials, so no financial sub-gate is needed.
// ============================================================
import type { Request, Response } from "express";
import { and, eq, isNull, desc } from "drizzle-orm";
import { db, atelierAccounts, atelierContacts } from "@workspace/db";
import {
  renderPrepCardHtml,
  type PrepCardContact,
} from "../../lib/atelier-prepcard-html.js";
import { distillBriefView } from "../../lib/atelier-brief-view.js";
import { getWatchOutTalkingPoints } from "../../lib/atelier-prepcard-talking-points.js";
import { canSeeAccount } from "./accountRoutes.js";
import { accessibleEngagementIds } from "./engagementRoutes.js";

type Persona = { id: string; role: string; name: string; orgId?: string };

function toPrepContact(c: typeof atelierContacts.$inferSelect): PrepCardContact {
  return {
    fullName: c.fullName,
    title: c.title ?? null,
    seniority: c.seniority ?? null,
    buyerPersona: c.buyerPersona ?? null,
    disposition: c.disposition ?? null,
    rationale: c.notes ?? null,
    notes: c.notes ?? null,
    sourceUrl: c.sourceUrl ?? null,
    confidence: c.confidence ?? null,
    timeInRole: c.timeInRole ?? null,
    careerHistory: (c.careerHistory ?? []).map((h) => ({
      role: h.role,
      company: h.company,
      period: h.period ?? null,
      highlight: h.highlight ?? null,
    })),
    education: (c.education ?? []).map((e) => ({
      institution: e.institution,
      programme: e.programme ?? null,
      year: e.year ?? null,
    })),
  };
}

export async function accountPrepCardHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const me = (req as Request & { atelierPersona?: Persona }).atelierPersona;
  if (!me) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const accountId = String(req.params.accountId ?? "");
  if (!accountId) {
    res.status(400).json({ error: "missing-account-id" });
    return;
  }

  const [account] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, accountId), isNull(atelierAccounts.deletedAt)));
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }

  // Read gate: parity with the workspace account view (canSeeAccount).
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({
      error: "account-forbidden",
      reason: "You do not have access to this account.",
    });
    return;
  }

  const contactRows = await db
    .select()
    .from(atelierContacts)
    .where(and(eq(atelierContacts.accountId, account.id), isNull(atelierContacts.deletedAt)))
    .orderBy(desc(atelierContacts.influenceScore));
  const contacts = contactRows.map(toPrepContact);

  const focusId = String(req.query.contactId ?? "");
  const focusRow = focusId ? contactRows.find((c) => c.id === focusId) : undefined;
  const focusContact = focusRow ? toPrepContact(focusRow) : null;

  // Task #1188 — suggested talking points for the "Our view" watch-outs,
  // cached inside the researchBrief blob (regeneration is free until the
  // Cartographer rewrites the research). Fail-soft: {} renders the
  // watch-outs without guidance.
  const view = distillBriefView(account.researchBrief ?? {});
  const watchOutAnswers = await getWatchOutTalkingPoints(
    {
      accountId: account.id,
      accountName: account.name,
      sector: account.sector,
      country: account.country,
      ourView: view.ourView,
      hypothesis: account.cogniriseHypothesis ?? null,
      researchBrief: account.researchBrief ?? null,
    },
    view.watchOuts,
  );

  const html = renderPrepCardHtml({
    accountName: account.name,
    brandName: account.brandName ?? null,
    sector: account.sector,
    country: account.country,
    tier: account.tier ?? null,
    hqCity: account.hqCity ?? null,
    cogniriseHypothesis: account.cogniriseHypothesis ?? null,
    strategicPriorities: account.strategicPriorities ?? [],
    researchBrief: account.researchBrief ?? null,
    contacts,
    focusContact,
    watchOutAnswers,
  });

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(html);
}
