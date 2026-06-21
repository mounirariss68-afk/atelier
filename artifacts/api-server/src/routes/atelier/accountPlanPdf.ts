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
import PDFDocument from "pdfkit";
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

type Persona = { id: string; role: string; name: string; orgId?: string };

const NAVY = "#0E1F3D";
const GOLD = "#E89E2C";
const INK = "#333333";
const MUTE = "#777777";
const LINE = "#D8DCE4";

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
  const brand = account.brandName ?? account.name;
  const filename = `atelier-account-plan-${brand.replace(/\s+/g, "_")}-${account.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
  );

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const LEFT = 48;
  const RIGHT = 547; // 595 - 48
  const WIDTH = RIGHT - LEFT;
  doc.pipe(res);

  const hr = () => {
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.moveDown(0.5);
  };
  const sectionTitle = (label: string) => {
    if (doc.y > 720) doc.addPage();
    doc.moveDown(0.4);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(label.toUpperCase(), LEFT);
    doc.moveTo(LEFT, doc.y + 1).lineTo(RIGHT, doc.y + 1).strokeColor(GOLD).lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  // Header band.
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(20).text("THE ATELIER", LEFT);
  doc
    .fillColor(GOLD)
    .font("Helvetica")
    .fontSize(9.5)
    .text("Cognirise · Account Plan & QBR Brief", LEFT);
  doc.moveDown(0.6);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(16).text(brand, LEFT);
  doc.fillColor(MUTE).font("Helvetica").fontSize(9.5);
  const meta = [
    account.sector,
    account.country,
    `Tier ${account.tier}`,
    account.status,
    ownerName ? `Owner: ${ownerName}` : null,
  ].filter(Boolean) as string[];
  doc.text(meta.join("   ·   "), LEFT);
  doc.fillColor(MUTE).fontSize(8.5).text(
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · by ${me.name}`,
    LEFT,
  );
  doc.moveDown(0.4);
  hr();

  // ---------- Strategy ----------
  sectionTitle("Account Strategy");
  if (strategy?.winHypothesis) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Win hypothesis", LEFT);
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(strategy.winHypothesis, LEFT, doc.y, {
      width: WIDTH,
    });
    doc.moveDown(0.3);
  }
  if (account.cogniriseHypothesis) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Cognirise hypothesis", LEFT);
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(account.cogniriseHypothesis, LEFT, doc.y, {
      width: WIDTH,
    });
    doc.moveDown(0.3);
  }
  const serviceLines = strategy?.targetServiceLines ?? [];
  if (serviceLines.length) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Target service lines", LEFT);
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(serviceLines.join(" · "), LEFT, doc.y, {
      width: WIDTH,
    });
    doc.moveDown(0.3);
  }
  const keyPlays = strategy?.keyPlays ?? [];
  if (keyPlays.length) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Key plays", LEFT);
    doc.fillColor(INK).font("Helvetica").fontSize(9.5);
    for (const p of keyPlays) doc.text(`•  ${p}`, LEFT + 6, doc.y, { width: WIDTH - 6 });
    doc.moveDown(0.3);
  }
  const priorities = account.strategicPriorities ?? [];
  if (priorities.length) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Client strategic priorities", LEFT);
    doc.fillColor(INK).font("Helvetica").fontSize(9.5);
    for (const p of priorities) doc.text(`•  ${p}`, LEFT + 6, doc.y, { width: WIDTH - 6 });
    doc.moveDown(0.3);
  }
  if (
    !strategy?.winHypothesis &&
    !account.cogniriseHypothesis &&
    !serviceLines.length &&
    !keyPlays.length &&
    !priorities.length
  ) {
    doc.fillColor(MUTE).font("Helvetica-Oblique").fontSize(9.5).text("No strategy captured yet.", LEFT);
  }
  doc.moveDown(0.2);

  // ---------- Goal progress ----------
  sectionTitle("Goal Progress");
  if (!plan.goalProgress.length) {
    doc.fillColor(MUTE).font("Helvetica-Oblique").fontSize(9.5).text("No strategy objectives defined.", LEFT);
  } else {
    for (const g of plan.goalProgress) {
      if (doc.y > 740) doc.addPage();
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(g.text, LEFT, doc.y, {
        width: WIDTH - 90,
        continued: false,
      });
      const statusY = doc.y - 12;
      doc
        .fillColor(MUTE)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text(GOAL_STATUS_LABEL[g.status] ?? g.status, RIGHT - 90, statusY < 0 ? doc.y : statusY, {
          width: 90,
          align: "right",
        });
      const bits: string[] = [];
      if (g.currentValue || g.targetValue) {
        bits.push(`${g.currentValue ?? "—"} of ${g.targetValue ?? "—"}`);
      }
      if (g.targetDate) bits.push(`by ${g.targetDate}`);
      if (g.note) bits.push(g.note);
      if (bits.length) {
        doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(bits.join("  ·  "), LEFT + 6, doc.y, {
          width: WIDTH - 6,
        });
      }
      doc.moveDown(0.35);
    }
  }
  doc.moveDown(0.1);

  // ---------- Team & stakeholders ----------
  sectionTitle("Account Team & Key Stakeholders");
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Cognirise team", LEFT);
  doc.fillColor(INK).font("Helvetica").fontSize(9.5);
  const teamLines: string[] = [];
  if (ownerName) teamLines.push(`${ownerName} — Account owner`);
  for (const t of teamRows) {
    const u = userById.get(t.userId);
    if (!u || u.id === account.partnerOwnerId) continue;
    teamLines.push(`${u.name} — ${t.roleOnAccount.replace(/_/g, " ")}`);
  }
  if (teamLines.length) {
    for (const l of teamLines) doc.text(`•  ${l}`, LEFT + 6, doc.y, { width: WIDTH - 6 });
  } else {
    doc.fillColor(MUTE).font("Helvetica-Oblique").text("No team assigned.", LEFT + 6);
  }
  doc.moveDown(0.3);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text("Client stakeholders", LEFT);
  doc.fillColor(INK).font("Helvetica").fontSize(9.5);
  if (contacts.length) {
    for (const c of contacts) {
      const role = [c.title, c.disposition].filter(Boolean).join(" · ");
      doc.text(`•  ${c.fullName}${role ? ` — ${role}` : ""}`, LEFT + 6, doc.y, { width: WIDTH - 6 });
    }
  } else {
    doc.fillColor(MUTE).font("Helvetica-Oblique").text("No contacts recorded.", LEFT + 6);
  }
  doc.moveDown(0.2);

  // ---------- Financials (gated) ----------
  sectionTitle("Financial Summary");
  if (!canSeeFinancials || !financials) {
    doc
      .fillColor(MUTE)
      .font("Helvetica-Oblique")
      .fontSize(9.5)
      .text("Financial detail is restricted for this persona.", LEFT);
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
    const colW = WIDTH / 2;
    let startY = doc.y;
    pairs.forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = LEFT + col * colW;
      const y = startY + row * 16;
      doc.fillColor(MUTE).font("Helvetica").fontSize(8.5).text(label, x, y, { width: colW - 10 });
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(val, x + colW - 90, y - 1, {
        width: 80,
        align: "right",
      });
    });
    doc.y = startY + Math.ceil(pairs.length / 2) * 16 + 2;
    doc
      .fillColor(MUTE)
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${f.activeEngagementCount} active / ${f.engagementCount} engagements · ${f.openOpportunityCount} open opportunities · ${f.overdueInvoiceCount} overdue invoices`,
        LEFT,
        doc.y,
      );
  }
  doc.moveDown(0.2);

  // ---------- Risk register ----------
  sectionTitle("Account Risk Register");
  const openRisks = plan.riskRegister.filter((r) => r.status !== "closed");
  if (!openRisks.length) {
    doc.fillColor(MUTE).font("Helvetica-Oblique").fontSize(9.5).text("No open risks.", LEFT);
  } else {
    for (const r of openRisks) {
      if (doc.y > 745) doc.addPage();
      const dotY = doc.y + 4;
      doc
        .circle(LEFT + 3, dotY, 3)
        .fillColor(RISK_SEVERITY_COLOR[r.severity] ?? GOLD)
        .fill();
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(
        `${r.kind.toUpperCase()} · ${r.description}`,
        LEFT + 12,
        doc.y,
        { width: WIDTH - 12 },
      );
      const sub: string[] = [];
      if (r.ownerName) sub.push(`Owner: ${r.ownerName}`);
      if (r.dueDate) sub.push(`Due ${r.dueDate}`);
      sub.push(r.status);
      if (r.mitigation) sub.push(`Mitigation: ${r.mitigation}`);
      doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(sub.join("  ·  "), LEFT + 12, doc.y, {
        width: WIDTH - 12,
      });
      doc.moveDown(0.35);
    }
  }
  doc.moveDown(0.1);

  // ---------- Next actions ----------
  sectionTitle("Next Actions");
  const openActions = plan.actionPlan.filter(
    (a) => a.status !== "done" && a.status !== "cancelled",
  );
  if (!openActions.length) {
    doc.fillColor(MUTE).font("Helvetica-Oblique").fontSize(9.5).text("No open actions.", LEFT);
  } else {
    for (const a of openActions) {
      if (doc.y > 745) doc.addPage();
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(
        `[${a.priority.toUpperCase()}] ${a.title}`,
        LEFT,
        doc.y,
        { width: WIDTH },
      );
      const sub: string[] = [];
      if (a.ownerName) sub.push(`Owner: ${a.ownerName}`);
      if (a.dueDate) sub.push(`Due ${a.dueDate}`);
      sub.push(ACTION_STATUS_LABEL[a.status] ?? a.status);
      if (a.linkedObjectiveText) sub.push(`Objective: ${a.linkedObjectiveText}`);
      else if (a.linkedPlay) sub.push(`Play: ${a.linkedPlay}`);
      if (a.source === "promoted") sub.push("from AI suggestion");
      doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(sub.join("  ·  "), LEFT + 6, doc.y, {
        width: WIDTH - 6,
      });
      doc.moveDown(0.35);
    }
  }

  // ---------- Footer ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fillColor(MUTE)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `Cognirise · The Atelier · ${brand} account plan · confidential · page ${i + 1} of ${range.count}`,
        LEFT,
        805,
        { width: WIDTH, align: "center" },
      );
  }

  doc.end();
}
