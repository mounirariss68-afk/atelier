/**
 * Task #1175 — Partner self-service change requests + smarter portal chat.
 *
 * Standalone offline probe (stub-Anthropic pattern from
 * chat-finance-docs-probe.ts: a local stub Anthropic server + env set
 * BEFORE any capability import, so the /cli turn stays offline). Boots the
 * app in-process; NODE_ENV=test enables the persona-cookie bypass.
 *
 * Coverage:
 *   REST
 *     - submit change request (allowed field) → pending proposal carrying
 *       partnerSubmitted meta
 *     - bank field → 400 with the finance-path message
 *     - unsupported field → 400
 *     - supersede on resubmit (prior pending partner proposal → rejected)
 *     - GET list shows own partner-submitted proposals only (no internal
 *       agent proposals, no decider identity)
 *     - internal decide approve → field applied + change_request_decided
 *       notification row; reject → not applied + notification row
 *     - preview submit (leadership preview) → 403 preview-read-only
 *     - firm B cannot see firm A's change requests
 *   CHAT
 *     - each new read tool returns firm-scoped data; nothing for an
 *       ungranted firm (delivery/contracts/documents cross-firm denial)
 *     - internal roles denied every partnerportal.* tool
 *     - alliance_partner still denied me.* / entity / attachment tools
 *     - write tool: two-phase preview then confirm commits proposal +
 *       navigateTo; a bank field via chat → refusal, no proposal created
 *     - at least one stubbed /cli turn exercising a read tool
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const TAG = `probe1175_${Date.now()}`;
const ORG = "aico";

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail !== undefined ? ` \u2014 ${JSON.stringify(detail)?.slice(0, 220)}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  // ---- stub Anthropic server (before any capability import) ----
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      let parsed: any = {};
      try { parsed = JSON.parse(body || "{}"); } catch {}
      const systemText = Array.isArray(parsed.system)
        ? parsed.system.map((b: any) => b?.text ?? "").join("\n")
        : String(parsed.system ?? "");
      const messages: any[] = Array.isArray(parsed.messages) ? parsed.messages : [];
      const send = (content: unknown[], stop: string) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: `msg_${TAG}`, type: "message", role: "assistant",
          model: parsed.model ?? "claude-haiku-4-5",
          content, stop_reason: stop, stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 20 },
        }));
      };
      // Intent router → canned read intent.
      if (systemText.startsWith("You are an intent router")) {
        send([{ type: "text", text: JSON.stringify({ verb: "read", kind: "opportunity", entityHints: [], confidence: 0.9 }) }], "end_turn");
        return;
      }
      // Orchestrator loop: after a tool_result, wrap up.
      const hasToolResult = messages.some(
        (m) => Array.isArray(m?.content) && m.content.some((b: any) => b?.type === "tool_result"),
      );
      if (hasToolResult) {
        send([{ type: "text", text: "Here are your delivery engagements." }], "end_turn");
        return;
      }
      // First loop step → call the delivery read tool.
      send([{ type: "tool_use", id: `tu_${TAG}`, name: "partner_portal_delivery", input: {} }], "tool_use");
    });
  });
  await new Promise<void>((r) => stub.listen(0, () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;

  // ---- dynamic imports AFTER env is pinned ----
  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierPartnerFirms,
    atelierPartnerOppGrants,
    atelierPartnerEngagementGrants,
    atelierEngagements,
    atelierPartnerContractShares,
    atelierContractRecords,
    atelierPartnerFirmInvoices,
    atelierPartnerSharedDocuments,
    atelierPartnerNotifications,
    atelierAuditEvents,
  } = D as any;
  const { and, eq, inArray, like } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const cat = await import("../../src/lib/atelier-cli/capability-catalog.js");
  const cli = await import("../../src/lib/atelier-cli/index.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string, path: string, personaId: string,
    body?: Record<string, unknown>, headers?: Record<string, string>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
        ...(headers ?? {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const FP_ID = `p_test_cr_fp_${TAG}`;
  const PA_ID = `p_test_cr_pa_${TAG}`;
  const PB_ID = `p_test_cr_pb_${TAG}`;
  const EMP_ID = `p_test_cr_emp_${TAG}`;
  const accId = `acct_cr_${TAG}`;
  const oppAId = `opp_cr_a_${TAG}`;
  const engAId = `eng_cr_a_${TAG}`;
  const firmAId = `pfrm_cr_a_${TAG}`;
  const firmBId = `pfrm_cr_b_${TAG}`;
  const contractId = `ctr_cr_${TAG}`;

  const mkCtx = (persona: any) => ({
    persona, turnId: `t_${TAG}`, sessionId: `s_${TAG}`, stepIdx: 0, progress: () => {},
  });

  try {
    // ---- seed personas ----
    for (const p of [
      { id: FP_ID, role: "founding_partner", name: "CR FP", firm: null },
      { id: PA_ID, role: "alliance_partner", name: "CR Partner A", firm: firmAId },
      { id: PB_ID, role: "alliance_partner", name: "CR Partner B", firm: firmBId },
      { id: EMP_ID, role: "employee", name: "CR Employee", firm: null },
    ]) {
      await db.insert(atelierUsers).values({
        id: p.id, orgId: ORG, email: `${p.id}@example.com`, name: p.name,
        initials: "CR", role: p.role, roleLabel: p.name, title: p.name,
        permissions: [], bdActive: false, partnerFirmId: p.firm,
      }).onConflictDoNothing();
    }

    await db.insert(atelierAccounts).values({
      id: accId, orgId: ORG, name: `CR Account ${TAG}`, country: "AE",
      sector: "Technology", tier: "B", status: "active",
      primaryCurrency: "AED", primaryLanguage: "en", createdByUserId: FP_ID,
    });
    await db.insert(atelierOpportunities).values({
      id: oppAId, orgId: ORG, accountId: accId, slug: `cr-${oppAId}`,
      name: `CR Opp A ${TAG}`, salesStage: "prospect", partnerOwnerId: FP_ID,
      engagementLeadId: FP_ID, dealSizeHypothesis: 100000, probabilityPct: 20,
      nextMilestone: "probe", forecastCategory: "pipeline", buyerPersona: "CIO",
      offeringAnchor: "advisory", sourceLead: "cr-probe", daysInStage: 0,
      createdByUserId: FP_ID,
    });
    await db.insert(atelierEngagements).values({
      id: engAId, orgId: ORG, accountId: accId, slug: `cr-eng-${TAG}`,
      name: `CR Engagement A ${TAG}`, plmStage: "deliver", raidStatus: "green",
      partnerOwnerId: FP_ID, engagementLeadId: FP_ID,
      startDate: "2026-01-01", plannedEndDate: "2026-12-31",
    } as any);
    for (const [id, name] of [
      [firmAId, `CR Firm A ${TAG}`],
      [firmBId, `CR Firm B ${TAG}`],
    ] as const) {
      await db.insert(atelierPartnerFirms).values({
        id, orgId: ORG, name, status: "active",
        partnershipStage: "agreed", agreementStage: "signed",
        legalName: `${name} Legal`, registrationNumber: "REG-OLD",
        speciality: "Cloud migration", country: "AE",
        capabilities: { "Existing capability": 4 },
        createdByUserId: FP_ID,
      });
    }
    // Grants: firm A gets the opp + engagement. Firm B gets nothing.
    await db.insert(atelierPartnerOppGrants).values({
      id: `pog_${TAG}`, orgId: ORG, partnerFirmId: firmAId, opportunityId: oppAId,
      createdByUserId: FP_ID,
    });
    await db.insert(atelierPartnerEngagementGrants).values({
      id: `peg_${TAG}`, orgId: ORG, partnerFirmId: firmAId, engagementId: engAId,
      createdByUserId: FP_ID,
    });
    // A shared contract for firm A.
    await db.insert(atelierContractRecords).values({
      id: contractId, orgId: ORG, title: `CR Contract ${TAG}`,
      contractType: "msa", counterpartyKind: "account", accountId: accId,
      counterpartyLabel: `CR Account ${TAG}`, status: "signed",
      ownerUserId: FP_ID, ownerLabel: "CR FP",
      effectiveDate: new Date("2026-01-01"), expiryDate: new Date("2026-12-31"),
    } as any).onConflictDoNothing();
    await db.insert(atelierPartnerContractShares).values({
      id: `pcs_${TAG}`, orgId: ORG, partnerFirmId: firmAId, contractId,
      note: "shared", sharedByUserId: FP_ID,
    }).onConflictDoNothing();
    // A partner-submitted invoice for firm A.
    await db.insert(atelierPartnerFirmInvoices).values({
      id: `pfi_${TAG}`, orgId: ORG, partnerFirmId: firmAId,
      partnerFirmName: `CR Firm A ${TAG}`, weekIso: "2026-W01",
      costAmount: 5000, costCurrency: "AED", status: "submitted",
      source: "partner_submitted", reference: "INV-CR-1", invoiceDate: "2026-01-05",
      submittedByUserId: PA_ID,
    }).onConflictDoNothing();
    // A shared document for firm A.
    await db.insert(atelierPartnerSharedDocuments).values({
      id: `psd_${TAG}`, orgId: ORG, partnerFirmId: firmAId, direction: "shared",
      title: `CR Shared Doc ${TAG}`, fileName: "shared.pdf", mime: "application/pdf",
      sizeBytes: 1234, status: "active", blobRef: `blob_${TAG}`, sha256: "x".repeat(64),
      note: "please review", sharedByUserId: FP_ID, sharedByLabel: "CR FP",
    }).onConflictDoNothing();
    // A portal notification for firm A.
    await db.insert(atelierPartnerNotifications).values({
      id: `pnotif_${TAG}`, orgId: ORG, partnerFirmId: firmAId,
      kind: "grant_shared", title: "Welcome", body: "You have access.",
      href: "/partner/opportunities",
    }).onConflictDoNothing();

    // =================================================================
    group("REST — submit / validate / supersede / list");
    // =================================================================
    let firstProposalId: string | null = null;
    {
      const r = await call("POST", "/partner-portal/change-requests", PA_ID, {
        field: "legalName", toValue: "New Legal Name Ltd", rationale: "rebrand",
      });
      check("submit allowed field → 201 pending", r.status === 201 && r.body?.changeRequest?.status === "pending", r.body);
      firstProposalId = r.body?.changeRequest?.id ?? null;

      // Meta on the proposal row.
      const [firm] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      const prop = (firm?.pendingUpdates ?? []).find((p: any) => p.id === firstProposalId);
      check(
        "proposal carries partnerSubmitted meta",
        prop && prop.status === "pending" && (prop.meta as any)?.partnerSubmitted === true &&
          (prop.meta as any)?.submittedByUserId === PA_ID,
        prop?.meta,
      );
    }
    {
      const r = await call("POST", "/partner-portal/change-requests", PA_ID, {
        field: "iban", toValue: "AE99...",
      });
      check(
        "bank field → 400 with finance-path message",
        r.status === 400 && /bank/i.test(String(r.body?.message ?? "")) && /billing|finance/i.test(String(r.body?.message ?? "")),
        r.body,
      );
    }
    {
      const r = await call("POST", "/partner-portal/change-requests", PA_ID, {
        field: "tier", toValue: "strategic",
      });
      check("unsupported field (tier) → 400", r.status === 400, r.body);
    }
    {
      // Resubmit legalName → supersedes the first pending partner proposal.
      const r = await call("POST", "/partner-portal/change-requests", PA_ID, {
        field: "legalName", toValue: "Second Legal Name Ltd",
      });
      check("resubmit → 201", r.status === 201, r.body);
      const [firm] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      const first = (firm?.pendingUpdates ?? []).find((p: any) => p.id === firstProposalId);
      const pendingLegal = (firm?.pendingUpdates ?? []).filter(
        (p: any) => p.field === "legalName" && p.status === "pending" && (p.meta as any)?.partnerSubmitted,
      );
      check(
        "supersede: prior pending marked rejected w/ note, only one pending remains",
        first?.status === "rejected" &&
          /superseded/i.test(String((first?.meta as any)?.decisionNote ?? "")) &&
          pendingLegal.length === 1,
        { firstStatus: first?.status, note: (first?.meta as any)?.decisionNote, pending: pendingLegal.length },
      );
    }
    {
      // Seed an internal (agent) proposal directly — must NOT appear in list.
      const [firm] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      const q = [...(firm?.pendingUpdates ?? [])];
      q.push({
        id: `prop_agent_${TAG}`, proposedBy: "ag_alliance_cartographer",
        proposedAt: new Date().toISOString(), field: "tier", fromValue: null,
        toValue: "strategic", rationale: "agent", status: "pending",
      });
      await db.update(atelierPartnerFirms).set({ pendingUpdates: q }).where(eq(atelierPartnerFirms.id, firmAId));

      const r = await call("GET", "/partner-portal/change-requests", PA_ID);
      const ids = (r.body?.items ?? []).map((i: any) => i.field);
      const hasAgent = (r.body?.items ?? []).some((i: any) => i.id === `prop_agent_${TAG}`);
      const leaksDecider = JSON.stringify(r.body ?? {}).includes("decidedByUserId");
      check(
        "GET list shows own partner-submitted only (no internal agent, no decider identity)",
        r.status === 200 && !hasAgent && !leaksDecider && ids.every((f: string) => f === "legalName"),
        r.body,
      );
    }
    {
      // Firm B cannot see firm A's requests.
      const r = await call("GET", "/partner-portal/change-requests", PB_ID);
      check("firm B sees none of firm A's requests", r.status === 200 && (r.body?.items ?? []).length === 0, r.body);
    }

    // =================================================================
    group("REST — internal decide approve/reject + notification");
    // =================================================================
    {
      // Approve the current pending legalName proposal.
      const [firm] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      const pending = (firm?.pendingUpdates ?? []).find(
        (p: any) => p.field === "legalName" && p.status === "pending" && (p.meta as any)?.partnerSubmitted,
      );
      const r = await call(
        "POST", `/partners/firms/${firmAId}/proposals/${pending.id}/decide`, FP_ID,
        { action: "approve", note: "Looks good" },
      );
      check("decide approve → 200", r.status === 200, r.body);
      const [firm2] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      check("approved change applied to firm.legalName", firm2?.legalName === "Second Legal Name Ltd", firm2?.legalName);
      const notifs = await db.select().from(atelierPartnerNotifications).where(
        and(eq(atelierPartnerNotifications.partnerFirmId, firmAId), eq(atelierPartnerNotifications.kind, "change_request_decided")),
      );
      const approvedNotif = notifs.find((n: any) => /approved/i.test(n.title) && n.href === "/partner/company");
      check("approve → change_request_decided notification (href /partner/company)", !!approvedNotif, notifs.map((n: any) => n.title));
    }
    {
      // Submit + reject a speciality change.
      const sub = await call("POST", "/partner-portal/change-requests", PA_ID, {
        field: "speciality", toValue: "Data platforms",
      });
      const propId = sub.body?.changeRequest?.id;
      const r = await call(
        "POST", `/partners/firms/${firmAId}/proposals/${propId}/decide`, FP_ID,
        { action: "reject", note: "Not now" },
      );
      check("decide reject → 200", r.status === 200, r.body);
      const [firm3] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      check("rejected change NOT applied to speciality", firm3?.speciality === "Cloud migration", firm3?.speciality);
      const notifs = await db.select().from(atelierPartnerNotifications).where(
        and(eq(atelierPartnerNotifications.partnerFirmId, firmAId), eq(atelierPartnerNotifications.kind, "change_request_decided")),
      );
      const rejNotif = notifs.find((n: any) => /not approved/i.test(n.title));
      check("reject → change_request_decided notification", !!rejNotif, notifs.map((n: any) => n.title));
    }

    // =================================================================
    group("REST — preview read-only + company-profile capability summary");
    // =================================================================
    {
      const r = await call(
        "POST", "/partner-portal/change-requests", FP_ID,
        { field: "legalName", toValue: "Preview attempt" },
        { "x-partner-preview-firm": firmAId },
      );
      check("leadership preview submit → 403 preview-read-only", r.status === 403 && r.body?.error === "preview-read-only", r.body);
    }
    {
      const r = await call("GET", "/partner-portal/company-profile", PA_ID);
      const f = r.body?.firm ?? {};
      check(
        "company-profile exposes capability summary section",
        r.status === 200 && Array.isArray(f.capabilities) && "speciality" in f && "capabilityProfile" in f,
        f,
      );
    }

    // =================================================================
    group("CHAT — read tools firm-scoped + cross-firm denial");
    // =================================================================
    const personaA = { id: PA_ID, name: "CR Partner A", role: "alliance_partner", orgId: ORG };
    const personaB = { id: PB_ID, name: "CR Partner B", role: "alliance_partner", orgId: ORG };
    const findTool = (id: string) => cat.listCapabilities().find((c: any) => c.id === id);
    {
      const t = findTool("partnerportal.delivery");
      const a = await t.run({}, mkCtx(personaA));
      const b = await t.run({}, mkCtx(personaB));
      check("delivery: firm A sees its granted engagement", a?.ok === true && a?.data?.count === 1, a?.data);
      check("delivery: firm B sees nothing (cross-firm denial)", b?.ok === true && b?.data?.count === 0, b?.data);
    }
    {
      const t = findTool("partnerportal.contracts");
      const a = await t.run({}, mkCtx(personaA));
      const b = await t.run({}, mkCtx(personaB));
      check("contracts: firm A sees its shared contract", a?.ok === true && a?.data?.count === 1, a?.data);
      check("contracts: firm B sees nothing (cross-firm denial)", b?.ok === true && b?.data?.count === 0, b?.data);
    }
    {
      const t = findTool("partnerportal.documents");
      const a = await t.run({}, mkCtx(personaA));
      const b = await t.run({}, mkCtx(personaB));
      const noBytes = !JSON.stringify(a?.data ?? {}).includes("blob") && !JSON.stringify(a?.data ?? {}).includes("sha256");
      check("documents: firm A sees shared doc metadata (no bytes/blob)", a?.ok === true && a?.data?.shared?.length === 1 && noBytes, a?.data);
      check("documents: firm B sees nothing (cross-firm denial)", b?.ok === true && (b?.data?.shared?.length ?? 0) === 0, b?.data);
    }
    {
      const t = findTool("partnerportal.invoices");
      const a = await t.run({}, mkCtx(personaA));
      check("invoices: firm A sees its submitted invoice", a?.ok === true && a?.data?.count === 1 && a?.data?.items?.[0]?.reference === "INV-CR-1", a?.data);
    }
    {
      const t = findTool("partnerportal.notifications");
      const a = await t.run({}, mkCtx(personaA));
      check("notifications: firm A sees recent notifications", a?.ok === true && a?.data?.count >= 1, a?.data);
    }
    {
      const t = findTool("partnerportal.firm_profile");
      const a = await t.run({}, mkCtx(personaA));
      const raw = JSON.stringify(a?.data ?? {});
      check(
        "firm_profile: masked bank summary, never raw IBAN",
        a?.ok === true && a?.data?.bank && !raw.includes('"iban"') && !("bankIban" in (a?.data?.bank ?? {})),
        a?.data?.bank,
      );
    }

    // =================================================================
    group("CHAT — role clamps (internal denied; partner denied me.*/entity)");
    // =================================================================
    {
      const internalPersona = { id: FP_ID, name: "CR FP", role: "founding_partner", orgId: ORG };
      let allDenied = true;
      for (const id of [
        "partnerportal.contracts", "partnerportal.invoices", "partnerportal.documents",
        "partnerportal.delivery", "partnerportal.notifications", "partnerportal.firm_profile",
        "partnerportal.request_change",
      ]) {
        const t = findTool(id);
        const r = await t.run({ field: "legalName", newValue: "x" }, mkCtx(internalPersona));
        if (!(r?.ok === false && r?.errorCode === "forbidden")) allDenied = false;
      }
      check("internal role denied every partnerportal.* tool", allDenied);
    }
    {
      // alliance_partner never resolves me.* / entity / attachment tools.
      let leak = false;
      for (const name of ["request_leave", "entity_detail", "search_documents", "account_create"]) {
        if (cli.findToolByName(name, personaA as any) !== undefined) leak = true;
      }
      check("alliance_partner denied me.*/entity/attachment tools (findToolByName)", !leak);
    }

    // =================================================================
    group("CHAT — write tool two-phase + bank refusal");
    // =================================================================
    {
      const t = findTool("partnerportal.request_change");
      // Preview.
      const preview = await t.run({ field: "registeredAddress", newValue: "1 New Street, Dubai" }, mkCtx(personaA));
      check(
        "write preview → confirmation envelope, no commit",
        preview?.ok === true && !!preview?.confirmation && preview?.confirmation?.pending?.tool === "partner_portal_request_change",
        preview?.confirmation?.summary,
      );
      // Commit.
      const commit = await t.run({ field: "registeredAddress", newValue: "1 New Street, Dubai", confirm: true }, mkCtx(personaA));
      check(
        "write commit → proposal created + navigateTo /partner/company",
        commit?.ok === true && commit?.data?.status === "pending" &&
          commit?.data?.navigateTo?.path === "/partner/company" && commit?.data?.navigateTo?.when === "on_commit",
        commit?.data,
      );
      const [firm] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId));
      const p = (firm?.pendingUpdates ?? []).find((x: any) => x.id === commit?.data?.id);
      check("write commit persists a pending partner proposal", p?.status === "pending" && p?.field === "registeredAddress", p);

      // Bank field via chat → refusal, no proposal created.
      const before = ((await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId)))[0]?.pendingUpdates ?? []).length;
      const bank = await t.run({ field: "iban", newValue: "AE99...", confirm: true }, mkCtx(personaA));
      const after = ((await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmAId)))[0]?.pendingUpdates ?? []).length;
      check(
        "bank field via chat → refusal, no proposal created",
        bank?.ok === false && bank?.errorCode === "forbidden" && before === after,
        { bank: bank?.errorMessage, before, after },
      );
    }

    // =================================================================
    group("CHAT — stubbed /cli turn (read tool)");
    // =================================================================
    {
      const res = await fetch(`${API}/cli/turn`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `atelier_persona=${PA_ID}` },
        body: JSON.stringify({ prompt: "show our delivery work" }),
      });
      const raw = await res.text();
      check(
        "/cli turn → delivery tool ran, granted engagement surfaced in SSE",
        res.status === 200 && raw.includes(`CR Engagement A ${TAG}`),
        raw.slice(0, 200),
      );
    }
  } finally {
    // ---- cleanup ----
    try {
      await db.delete(atelierPartnerNotifications).where(like(atelierPartnerNotifications.id, `%${TAG}%`));
      await db.delete(atelierPartnerSharedDocuments).where(like(atelierPartnerSharedDocuments.id, `%${TAG}%`));
      await db.delete(atelierPartnerFirmInvoices).where(like(atelierPartnerFirmInvoices.id, `%${TAG}%`));
      await db.delete(atelierPartnerContractShares).where(like(atelierPartnerContractShares.id, `%${TAG}%`));
      await db.delete(atelierContractRecords).where(like(atelierContractRecords.id, `%${TAG}%`));
      await db.delete(atelierPartnerEngagementGrants).where(like(atelierPartnerEngagementGrants.id, `%${TAG}%`));
      await db.delete(atelierPartnerOppGrants).where(like(atelierPartnerOppGrants.id, `%${TAG}%`));
      await db.delete(atelierEngagements).where(like(atelierEngagements.id, `%${TAG}%`));
      await db.delete(atelierOpportunities).where(like(atelierOpportunities.id, `%${TAG}%`));
      await db.delete(atelierPartnerFirms).where(like(atelierPartnerFirms.id, `%${TAG}%`));
      await db.delete(atelierAccounts).where(like(atelierAccounts.id, `%${TAG}%`));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `%${TAG}%`));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `%${TAG}%`));
    } catch (err) {
      console.error("cleanup error", err);
    }
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => stub.close(() => r()));
    await pool.end().catch(() => {});
  }

  console.log(`\n${failures.length === 0 ? "\u2713 partner-selfservice-chat probes passed" : `\u2717 ${failures.length} check(s) failed`}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
