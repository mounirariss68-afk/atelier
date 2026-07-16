/* eslint-disable no-console */
/**
 * Task #12 — One-off wipe of ALL dummy CRM data (clients/accounts,
 * opportunities and every dependent record) so the user can start testing
 * client & opportunity functionality from a clean slate.
 *
 * Deletes, in child→parent order:
 *   - salon (client-portal) workspaces + access/decisions/requests/notifications
 *   - L2C chain: invoices (+lines/e-invoice/dunning/promise-to-pay/cash),
 *     revenue-rec rows, renewals, contracts/DPAs/change orders, counterparties
 *   - engagement financials (budget, cost-to-date, ETC, P&L CO/audit, margin/WIP)
 *   - engagements, deliverables (+versions/publishes/acceptance), meetings,
 *     transcripts, charters, hypothesis trees, RAID, processes, agent designs
 *   - BD chain: briefs, research facts, POVs (+versions), proposals
 *     (+sections/recipients), prototypes, deal pricings, win/loss debriefs,
 *     win themes, opportunity stage transitions
 *   - account satellites: contacts, contact relationships, insights, team
 *     members, actions, risks, goal progress, activities, credentials
 *   - opportunities and accounts themselves
 *   - RAG/entity embeddings and doc-chunk embeddings scoped to those entities
 *   - audit events, agent runs, notifications, Pane-A items and artifacts
 *     that reference the wiped entity types
 *
 * NOT touched: users/personas, auth credentials/sessions, org & reference
 * data, employees/contractors/HR, agents/prompts/assets, rate cards,
 * pricing/margin policies, press/alliances/studio/guardhouse/IP demo data,
 * capability embeddings, timesheet/expense rows not tied to an engagement.
 *
 * Idempotent — safe to re-run; every statement is a plain DELETE guarded by
 * table existence.
 */
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Entity kinds whose polymorphic references (audit, runs, notifications,
// artifacts, embeddings…) must be purged along with the rows themselves.
const CRM_KINDS = [
  "account",
  "opportunity",
  "engagement",
  "contact",
  "deliverable",
  "meeting",
  "brief",
  "research_fact",
  "pov",
  "proposal",
  "prototype",
  "renewal",
  "contract",
  "invoice",
  "counterparty",
  "change_order",
  "win_loss_debrief",
  "winloss_debrief",
  "win_theme",
  "credential",
  "activity",
  "account_insight",
  "account_action",
  "account_risk",
  "salon_workspace",
];

const FULL_WIPE_TABLES = [
  // Salon (client portal) — engagement-scoped
  "atelier_salon_audit_events",
  "atelier_salon_notifications",
  "atelier_salon_requests",
  "atelier_salon_decisions",
  "atelier_salon_user_engagement_access",
  "atelier_salon_users",
  "atelier_salon_workspaces",
  "atelier_deliverable_publishes",
  // L2C / billing chain (all rows reference dummy engagements/accounts)
  "atelier_einvoice_submission",
  "atelier_dunning_event",
  "atelier_promise_to_pay",
  "atelier_cash_application",
  "atelier_cash_receipt",
  "atelier_invoice_line",
  "atelier_invoice",
  "atelier_invoice_line_drafts",
  "atelier_revenue_period_posting_line",
  "atelier_revenue_adjustment",
  "atelier_revenue_schedule",
  "atelier_revenue_milestone",
  "atelier_revenue_method",
  "atelier_unbilled_wip_snapshot",
  "atelier_engagement_margin_snapshot",
  "atelier_renewal",
  "atelier_deliverable_acceptance",
  "atelier_change_order",
  "atelier_dpa",
  "atelier_contract_clause",
  "atelier_contract_party",
  "atelier_contract",
  "atelier_counterparty",
  // Engagement financials
  "atelier_engagement_budget",
  "atelier_engagement_cost_to_date",
  "atelier_engagement_etc",
  "atelier_engagement_pnl_change_order",
  "atelier_engagement_pnl_audit",
  // Engagement working surfaces
  "atelier_charter_versions",
  "atelier_hypothesis_trees",
  "atelier_raid_items",
  "atelier_processes",
  "atelier_agent_designs",
  "atelier_engagement_access",
  "atelier_deliverable_versions",
  "atelier_deliverables",
  "atelier_meetings",
  "atelier_transcripts",
  // BD / opportunity chain
  "atelier_briefs",
  "atelier_research_facts",
  "atelier_pov_versions",
  "atelier_povs",
  "atelier_proposal_recipients",
  "atelier_proposal_sections",
  "atelier_proposals",
  "atelier_prototypes",
  "atelier_deal_pricings",
  "atelier_winloss_debriefs",
  "atelier_win_themes",
  "atelier_opportunity_stage_transitions",
  // Account satellites
  "atelier_activities",
  "atelier_account_goal_progress",
  "atelier_account_risks",
  "atelier_account_actions",
  "atelier_account_team_members",
  "atelier_account_insights",
  "atelier_credentials",
  "atelier_contact_relationships",
  "atelier_contacts",
  // Core CRM entities
  "atelier_engagements",
  "atelier_opportunities",
  "atelier_accounts",
];

async function tableExists(name: string): Promise<boolean> {
  const res = await db.execute(
    sql`select to_regclass(${"public." + name}) as reg`,
  );
  return Boolean(res.rows[0]?.reg);
}

async function wipe(name: string, where?: string): Promise<void> {
  if (!(await tableExists(name))) {
    console.log(`  · ${name} — table absent, skipped`);
    return;
  }
  const stmt = where
    ? `DELETE FROM ${name} WHERE ${where}`
    : `DELETE FROM ${name}`;
  const res = await db.execute(sql.raw(stmt));
  console.log(`  ✓ ${name}${where ? ` (${where})` : ""} — ${res.rowCount} rows deleted`);
}

const kindsList = CRM_KINDS.map((k) => `'${k}'`).join(",");

async function main() {
  console.log("[wipe-crm] deleting dummy CRM data…");
  for (const t of FULL_WIPE_TABLES) {
    await wipe(t);
  }

  // Engagement-linked rows in otherwise non-CRM tables (HR/finance rows not
  // tied to an engagement are preserved).
  for (const t of [
    "atelier_timesheet_entries",
    "atelier_expenses",
    "atelier_contractor_payments",
    "atelier_partner_firm_hours",
    "atelier_partner_firm_invoices",
  ]) {
    await wipe(t, "engagement_id IS NOT NULL");
  }

  // RAG document chunks scoped to a wiped account/engagement.
  await wipe(
    "atelier_document_chunk_embeddings",
    "account_id IS NOT NULL OR engagement_id IS NOT NULL",
  );

  // RAG entity embeddings — CRM kinds only (rate_card / timesheet_entry /
  // expense / partner_firm / agent_design embeddings belong to kept data).
  await wipe("atelier_entity_embeddings", `kind IN (${kindsList})`);

  // Polymorphic references to the wiped entity kinds.
  await wipe("atelier_audit_events", `entity_type IN (${kindsList})`);
  await wipe("atelier_agent_runs", `target_type IN (${kindsList})`);
  await wipe("atelier_notifications", `ref_type IN (${kindsList})`);
  await wipe("atelier_pane_a_items", `href_kind IN (${kindsList})`);
  await wipe("atelier_artifacts", `parent_type IN (${kindsList})`);

  // Final verification.
  const check = await db.execute(
    sql.raw(
      `select (select count(*) from atelier_accounts) accounts,
              (select count(*) from atelier_opportunities) opportunities,
              (select count(*) from atelier_contacts) contacts,
              (select count(*) from atelier_engagements) engagements,
              (select count(*) from atelier_users) users,
              (select count(*) from atelier_auth_credentials) auth_credentials`,
    ),
  );
  console.log("[wipe-crm] post-wipe counts:", check.rows[0]);
  const row = check.rows[0] as Record<string, unknown>;
  if (Number(row.accounts) !== 0 || Number(row.opportunities) !== 0) {
    throw new Error("wipe incomplete — accounts/opportunities remain");
  }
  if (Number(row.users) < 2 || Number(row.auth_credentials) < 2) {
    throw new Error("safety check failed — users/credentials were touched");
  }
  console.log("[wipe-crm] done — CRM slate is clean; users/auth untouched.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("[wipe-crm] FAILED:", err);
    pool.end();
    process.exit(1);
  });
