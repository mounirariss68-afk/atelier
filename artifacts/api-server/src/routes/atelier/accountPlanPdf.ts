// ============================================================
// Task #571 — One-page account-plan / QBR PDF export.
// ------------------------------------------------------------
// GET /atelier/accounts/:accountId/plan.pdf
//
// Assembles a partner-facing account plan / QBR brief: strategy
// (win hypothesis, objectives, target service lines, key plays),
// goal progress, account team & key stakeholders, a financial
// summary (gated), the account risk register, and the next actions.
//
// Access: canSeeAccount (read parity with the workspace). The
// financial block is only rendered for account-wide authority
// (firm-wide partners or the account owner) and never for
// restricted / board personas — mirroring the account-360 gate.
// ============================================================
import type { Request, Response } from "express";
import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierUsers,
  atelierEngagements,
  atelierOpportunities,
  atelierContacts,
  atelierAccountTeamMembers,
} from "@workspace/db";
import {
  computeAccountFinancials,
  type AccountFinancials,
} from "../../lib/atelier-account-360.js";
import { buildAccountPlan } from "../../lib/atelier-account-plan.js";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { canSeeAccount } from "./accountRoutes.js";
import { accessibleEngagementIds } from "./engagementRoutes.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  createBrandDoc,
  addBrandPage,
  glassSection,
  writeBrandFooters,
  block,
  BRAND,
  FONT,
  PAGE,
  type BrandBlock,
} from "../../lib/atelier-pdf-brand.js";

type Persona = { id: string; role: string; name: string; orgId?: string };


const RISK_SEVERITY_COLOR: Record<string, string> = {
  red: "#C0392B",
  amber: "#E89E2C",
  green: "#2E7D5B",
};
const GOAL_STATUS_LABEL: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};
const ACTION_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export async function accountPlanPdfHandler(
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

  // Load the account inside the persona's org. RLS also enforces org
  // isolation, but the explicit orgId guard keeps the 404 semantics clean.
  const [account] = await db
    .select()
    .from(atelierAccounts)
    .where(
      and(
        eq(atelierAccounts.id, accountId),
        isNull(atelierAccounts.deletedAt),
      ),
    );
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }

  // Read gate: parity with the workspace account view (canSeeAccount) — a
  // firm-wide partner, a holder of an engagement grant on the account, or the
  // account owner. Scoped consultants who can read the account plan in the
  // workspace can also export this brief.
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({
      error: "account-forbidden",
      reason: "You do not have access to this account.",
    });
    return;
  }

  // Financial block gate: account-WIDE authority (firm-wide partners or the
  // account owner) AND not restricted / board. Mirrors the account-360 gate so
  // a scoped engagement-grant holder never sees account-wide financial totals.
  const accountWide = access.all || account.partnerOwnerId === me.id;
  const canSeeFinancials =
    accountWide &&
    !isRestrictedPersona(me.role) &&
    !isBoardObserver(me.role);

  // Strategy.
  const strategy = account.accountStrategy ?? null;
  const objectives = (strategy?.objectives ?? []) as Array<{
    id: string;
    text: string;
    targetValue?: string | null;
    targetDate?: string | null;
  }>;

  // Account plan (actions / risks / goal progress).
  const plan = await buildAccountPlan({ accountId: account.id, objectives });

  // Owner + team + key stakeholders.
  const teamRows = await db
    .select()
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.accountId, account.id),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    )
    .orderBy(atelierAccountTeamMembers.createdAt);
  const teamUserIds = Array.from(
    new Set([
      ...teamRows.map((r) => r.userId),
      ...(account.partnerOwnerId ? [account.partnerOwnerId] : []),
    ]),
  );
  const teamUsers = teamUserIds.length
    ? await db
        .select({ id: atelierUsers.id, name: atelierUsers.name, title: atelierUsers.title })
        .from(atelierUsers)
        .where(inArray(atelierUsers.id, teamUserIds))
    : [];
  const userById = new Map(teamUsers.map((u) => [u.id, u]));
  const ownerName = account.partnerOwnerId
    ? userById.get(account.partnerOwnerId)?.name ?? null
    : null;

  const contacts = await db
    .select()
    .from(atelierContacts)
    .where(
      and(
        eq(atelierContacts.accountId, account.id),
        isNull(atelierContacts.deletedAt),
      ),
    )
    .orderBy(desc(atelierContacts.influenceScore))
    .limit(6);

  // Financials (only when allowed).
  let financials: AccountFinancials | null = null;
  if (canSeeFinancials) {
    const [engagements, opportunities] = await Promise.all([
      db
        .select()
        .from(atelierEngagements)
        .where(
          and(
            eq(atelierEngagements.accountId, account.id),
            isNull(atelierEngagements.deletedAt),
          ),
        ),
      db
        .select()
        .from(atelierOpportunities)
        .where(
          and(
            eq(atelierOpportunities.accountId, account.id),
            isNull(atelierOpportunities.deletedAt),
          ),
        ),
    ]);
    financials = await computeAccountFinancials({
      orgId: account.orgId,
      accountId: account.id,
      engagements,
      opportunities,
    });
  }

  // ---------- render ----------
  // Task #1007 — rendered on the shared glassmorphism brand kit.
  const brand = account.brandName ?? account.name;
  const filename = `atelier-account-plan-${brand.replace(/\s+/g, "_")}-${account.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    contentDispositionFilename("attachment", filename),
  );

  const doc = createBrandDoc();
  doc.pipe(res);
  addBrandPage(doc);

  // Header band.
  doc.font(FONT.bold).fontSize(17).fillColor(BRAND.navy).text(brand, PAGE.left, doc.y);
  doc
    .font(FONT.medium)
    .fontSize(9.5)
    .fillColor(BRAND.gold)
    .text("Account Plan & QBR Brief", PAGE.left, doc.y + 2);
  const meta = [
    account.sector,
    account.country,
    `Tier ${account.tier}`,
    account.status,
    ownerName ? `Owner: ${ownerName}` : null,
  ].filter(Boolean) as string[];
  doc.font(FONT.regular).fontSize(9).fillColor(BRAND.muted).text(meta.join("   ·   "), PAGE.left, doc.y + 4);
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(BRAND.faint)
    .text(
      `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · by ${me.name}`,
      PAGE.left,
      doc.y + 1,
    );
  doc.moveDown(0.8);
  doc.x = PAGE.left;

  // ---------- Strategy ----------
  {
    const blocks: BrandBlock[] = [];
    if (strategy?.winHypothesis) {
      blocks.push(block.label("Win hypothesis"), block.body(strategy.winHypothesis));
    }
    if (account.cogniriseHypothesis) {
      blocks.push(block.label("Cognirise hypothesis"), block.body(account.cogniriseHypothesis));
    }
    const serviceLines = strategy?.targetServiceLines ?? [];
    if (serviceLines.length) {
      blocks.push(block.label("Target service lines"), block.body(serviceLines.join(" · ")));
    }
    const keyPlays = strategy?.keyPlays ?? [];
    if (keyPlays.length) {
      blocks.push(block.label("Key plays"), ...keyPlays.map((p) => block.bullet(p)));
    }
    const priorities = account.strategicPriorities ?? [];
    if (priorities.length) {
      blocks.push(block.label("Client strategic priorities"), ...priorities.map((p) => block.bullet(p)));
    }
    if (!blocks.length) blocks.push(block.italic("No strategy captured yet."));
    glassSection(doc, "Account Strategy", blocks);
  }

  // ---------- Goal progress ----------
  {
    const blocks: BrandBlock[] = [];
    if (!plan.goalProgress.length) {
      blocks.push(block.italic("No strategy objectives defined."));
    } else {
      for (const g of plan.goalProgress) {
        blocks.push({
          kind: "row",
          cells: [
            { text: g.text, width: 365, font: FONT.semibold, size: 9.5, color: BRAND.navy },
            { text: GOAL_STATUS_LABEL[g.status] ?? g.status, width: 90, align: "right", font: FONT.semibold, size: 8.5, color: BRAND.muted },
          ],
          gapAfter: 2,
        });
        const bits: string[] = [];
        if (g.currentValue || g.targetValue) {
          bits.push(`${g.currentValue ?? "—"} of ${g.targetValue ?? "—"}`);
        }
        if (g.targetDate) bits.push(`by ${g.targetDate}`);
        if (g.note) bits.push(g.note);
        if (bits.length) blocks.push(block.muted(bits.join("  ·  "), { indent: 6, size: 8.5 }));
        blocks.push(block.gap(4));
      }
    }
    glassSection(doc, "Goal Progress", blocks);
  }

  // ---------- Team & stakeholders ----------
  {
    const blocks: BrandBlock[] = [block.label("Cognirise team")];
    const teamLines: string[] = [];
    if (ownerName) teamLines.push(`${ownerName} — Account owner`);
    for (const t of teamRows) {
      const u = userById.get(t.userId);
      if (!u || u.id === account.partnerOwnerId) continue;
      teamLines.push(`${u.name} — ${t.roleOnAccount.replace(/_/g, " ")}`);
    }
    if (teamLines.length) blocks.push(...teamLines.map((l) => block.bullet(l)));
    else blocks.push(block.italic("No team assigned.", { indent: 6 }));
    blocks.push(block.gap(4), block.label("Client stakeholders"));
    if (contacts.length) {
      for (const c of contacts) {
        const role = [c.title, c.disposition].filter(Boolean).join(" · ");
        blocks.push(block.bullet(`${c.fullName}${role ? ` — ${role}` : ""}`));
      }
    } else {
      blocks.push(block.italic("No contacts recorded.", { indent: 6 }));
    }
    glassSection(doc, "Account Team & Key Stakeholders", blocks);
  }

  // ---------- Financials (gated) ----------
  {
    const blocks: BrandBlock[] = [];
    if (!canSeeFinancials || !financials) {
      blocks.push(block.italic("Financial detail is restricted for this persona."));
    } else {
      const f = financials;
      const pairs: Array<[string, string]> = [
        ["Contract value", fmtUsd(f.contractValueUsd)],
        ["Active engagement value", fmtUsd(f.activeEngagementValueUsd)],
        ["Recognised revenue", fmtUsd(f.recognisedRevenueUsd)],
        ["Gross margin", `${Math.round(f.grossMarginPct * 100)}%`],
        ["Open pipeline", fmtUsd(f.openPipelineUsd)],
        ["Weighted pipeline", fmtUsd(f.weightedPipelineUsd)],
        ["AR outstanding", fmtUsd(f.arOutstandingUsd)],
        ["AR overdue", fmtUsd(f.arOverdueUsd)],
      ];
      for (let i = 0; i < pairs.length; i += 2) {
        const cells: Array<{ text: string; width: number; align?: "left" | "right"; font?: string; size?: number; color?: string }> = [];
        for (const pair of [pairs[i], pairs[i + 1]].filter(Boolean) as Array<[string, string]>) {
          cells.push(
            { text: pair[0], width: 130, size: 8.5, color: BRAND.muted },
            { text: pair[1], width: 90, align: "right", font: FONT.semibold, size: 9.5, color: BRAND.navy },
          );
        }
        blocks.push({ kind: "row", cells, gapAfter: 5 });
      }
      blocks.push(
        block.muted(
          `${f.activeEngagementCount} active / ${f.engagementCount} engagements · ${f.openOpportunityCount} open opportunities · ${f.overdueInvoiceCount} overdue invoices`,
          { size: 8 },
        ),
      );
    }
    glassSection(doc, "Financial Summary", blocks);
  }

  // ---------- Risk register ----------
  {
    const blocks: BrandBlock[] = [];
    const openRisks = plan.riskRegister.filter((r) => r.status !== "closed");
    if (!openRisks.length) {
      blocks.push(block.italic("No open risks."));
    } else {
      for (const r of openRisks) {
        blocks.push({
          kind: "text",
          text: `${r.kind.toUpperCase()} · ${r.description}`,
          font: FONT.semibold,
          size: 9.5,
          color: RISK_SEVERITY_COLOR[r.severity] ?? BRAND.gold,
          gapAfter: 1,
        });
        const sub: string[] = [];
        if (r.ownerName) sub.push(`Owner: ${r.ownerName}`);
        if (r.dueDate) sub.push(`Due ${r.dueDate}`);
        sub.push(r.status);
        if (r.mitigation) sub.push(`Mitigation: ${r.mitigation}`);
        blocks.push(block.muted(sub.join("  ·  "), { indent: 6, size: 8.5 }), block.gap(4));
      }
    }
    glassSection(doc, "Account Risk Register", blocks);
  }

  // ---------- Next actions ----------
  {
    const blocks: BrandBlock[] = [];
    const openActions = plan.actionPlan.filter(
      (a) => a.status !== "done" && a.status !== "cancelled",
    );
    if (!openActions.length) {
      blocks.push(block.italic("No open actions."));
    } else {
      for (const a of openActions) {
        blocks.push(block.strong(`[${a.priority.toUpperCase()}] ${a.title}`, { size: 9.5 }));
        const sub: string[] = [];
        if (a.ownerName) sub.push(`Owner: ${a.ownerName}`);
        if (a.dueDate) sub.push(`Due ${a.dueDate}`);
        sub.push(ACTION_STATUS_LABEL[a.status] ?? a.status);
        if (a.linkedObjectiveText) sub.push(`Objective: ${a.linkedObjectiveText}`);
        else if (a.linkedPlay) sub.push(`Play: ${a.linkedPlay}`);
        if (a.source === "promoted") sub.push("from AI suggestion");
        blocks.push(block.muted(sub.join("  ·  "), { indent: 6, size: 8.5 }), block.gap(4));
      }
    }
    glassSection(doc, "Next Actions", blocks);
  }

  // ---------- Footer ----------
  writeBrandFooters(doc, { label: `Cognirise · Atelier · ${brand} account plan · confidential` });

  doc.end();
}
