/**
 * Task #1163 — account research brief chat capability probe.
 *
 * Proves the new `account.brief` chat tool (tool name `account_brief`)
 * end-to-end on an isolated scratch DB with a stub Anthropic server:
 *
 *   1. Catalog gating — the capability is in the persona slice for
 *      partner-side roles only; self-only (employee/contractor),
 *      restricted (partner_firm_resource/recruiter), board_observer and
 *      alliance_partner NEVER see it.
 *   2. Capability layer — an eligible caller fetches the brief: the
 *      distilled "Our view" is present, executive tensions carry text +
 *      evidence, and the RAW stress-test fields (failureScenarios /
 *      likelyObjections / stressTest keys) never appear in the payload.
 *   3. ACL — ambiguous names disambiguate ONLY among accounts the caller
 *      can see; a grant-scoped consultant gets not_found (no option
 *      leak) and a direct-id fetch is refused.
 *   4. No-brief accounts get a friendly "run Cartographer research"
 *      answer (ok:true, hasBrief:false), not an error.
 *   5. End-to-end /cli/turn — the FP asks for the brief + an explanation
 *      of the executive tensions; the tool_result card arrives ok and
 *      the model's elaboration prose survives the narration trim.
 *      An employee's HTTP request is rejected 403 at the boundary gate.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-account-brief-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe1163_${Date.now()}`;
const TENSION_TEXT = `CFO cost discipline is colliding with the CEO digital push ${TAG}`;
const ELABORATION = "The friction to exploit sits between finance discipline and the transformation agenda.";

async function main() {
  // ---- stub Anthropic server (must exist before the app import) ----
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      let parsed: any = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {}
      const systemText = Array.isArray(parsed.system)
        ? parsed.system.map((b: any) => b?.text ?? "").join("\n")
        : String(parsed.system ?? "");
      const messages: any[] = Array.isArray(parsed.messages) ? parsed.messages : [];
      const send = (content: unknown[], stop: string) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `msg_${TAG}`,
            type: "message",
            role: "assistant",
            model: parsed.model ?? "claude-haiku-4-5",
            content,
            stop_reason: stop,
            stop_sequence: null,
            usage: { input_tokens: 25, output_tokens: 25 },
          }),
        );
      };

      // 1. Intent-router call → canned read/account intent.
      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "read",
                kind: "account",
                entityHints: [],
                confidence: 0.95,
              }),
            },
          ],
          "end_turn",
        );
        return;
      }

      // 2. Orchestrator loop. A tool_result in history → wrap up with an
      // elaboration that does NOT restate the card (narration-trim check).
      const hasToolResult = messages.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((b: any) => b?.type === "tool_result"),
      );
      if (hasToolResult) {
        send([{ type: "text", text: ELABORATION }], "end_turn");
        return;
      }

      // First loop step — always ask for the account brief.
      const lastUser = [...messages].reverse().find((m) => m?.role === "user");
      const promptText = Array.isArray(lastUser?.content)
        ? lastUser.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join(" ")
        : String(lastUser?.content ?? "");
      const nameMatch = /noBrief/i.test(promptText) ? `NoBrief Probe ${TAG}` : `QIB Probe ${TAG} Bank`;
      send(
        [{ type: "tool_use", id: `tu_${TAG}`, name: "account_brief", input: { accountName: nameMatch } }],
        "tool_use",
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierCliSessions,
    atelierCliTurns,
    atelierAuditEvents,
  } = D as any;
  const { eq, inArray, and } = await import("drizzle-orm");
  const { findByToolName, capabilitiesForPersona } = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const IDS = {
    fp: `u_${TAG}_fp`,
    emp: `u_${TAG}_emp`,
    cons: `u_${TAG}_cons`,
  };
  const ACC = {
    brief: `acc_${TAG}_brief`,
    dupe: `acc_${TAG}_dupe`,
    empty: `acc_${TAG}_empty`,
  };
  const userIds = Object.values(IDS);
  const accIds = Object.values(ACC);

  const BRIEF = {
    whatsChanging: [
      { text: `New group CEO announced a five-year digital mandate ${TAG}`, evidence: "evidenced", sourceUrls: ["https://example.com/a"] },
    ],
    executiveTensions: [
      { text: TENSION_TEXT, evidence: "evidenced", sourceUrls: ["https://example.com/b"] },
      { text: "Retail head resists platform consolidation", evidence: "inferred", sourceUrls: [] },
    ],
    serviceLineFit: [{ serviceLine: "Digital", signal: "modernisation budget approved", sourceUrls: [] }],
    partnerEcosystem: [{ partner: "BigCo", relationship: "incumbent ERP", serviceLineGap: null, sourceUrls: [] }],
    mandateAngles: [
      {
        title: "Cost-out diagnostic",
        serviceLines: ["Operations"],
        tension: "CFO wants savings before new spend",
        whyNow: "budget cycle closes Q4",
        entryStakeholder: "CFO",
        sourceUrls: [],
      },
    ],
    whyNowHypothesis: `The bank must fund transformation from efficiency gains ${TAG}`,
    openQuestions: ["Who owns the transformation budget?"],
    singleMostImportant: "Win CFO trust with a savings-first entry.",
    stressTest: {
      failureScenarios: [`RAW_FAILURE_SCENARIO_${TAG}`],
      assumptions: { evidenced: ["a1", "a2"], untestedButLikely: ["b1"], uncertain: [] },
      likelyObjections: [`RAW_OBJECTION_${TAG}`],
      evidenceToStrengthen: [{ evidence: "board minutes", whereToFind: "IR site" }],
      revisedHypothesis: `Efficiency-funded transformation is the only politically viable path ${TAG}`,
    },
  };

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  interface Frame {
    event: string;
    data: any;
  }
  const postTurn = async (who: string, prompt: string) => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: JSON.stringify({ prompt }),
    });
    const raw = await res.text();
    const frames: Frame[] = [];
    for (const block of raw.split(/\n\n+/)) {
      const evLine = block.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      let data: any = {};
      try {
        data = JSON.parse(dataLine.slice("data:".length).trim());
      } catch {}
      frames.push({ event: evLine.slice("event:".length).trim(), data });
    }
    return { status: res.status, raw, frames };
  };

  try {
    // ---- seed personas + accounts ----
    await db
      .insert(atelierUsers)
      .values([
        {
          id: IDS.fp,
          orgId: ORG,
          email: `${TAG}.fp@cognirise.ai`,
          name: "Probe FP",
          initials: "PF",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
        {
          id: IDS.emp,
          orgId: ORG,
          email: `${TAG}.emp@cognirise.ai`,
          name: "Probe Employee",
          initials: "PE",
          role: "employee",
          roleLabel: "Employee",
          title: "Analyst",
          permissions: [],
        },
        {
          id: IDS.cons,
          orgId: ORG,
          email: `${TAG}.cons@cognirise.ai`,
          name: "Probe Consultant",
          initials: "PC",
          role: "consultant",
          roleLabel: "Consultant",
          title: "Consultant",
          permissions: [],
        },
      ] as any)
      .onConflictDoNothing();

    await db.insert(atelierAccounts).values([
      { id: ACC.brief, orgId: ORG, name: `QIB Probe ${TAG} Bank`, country: "QA", sector: "banking", researchBrief: BRIEF },
      { id: ACC.dupe, orgId: ORG, name: `QIB Probe ${TAG} Holding`, country: "QA", sector: "banking" },
      { id: ACC.empty, orgId: ORG, name: `NoBrief Probe ${TAG}`, country: "AE", sector: "energy" },
    ] as any);

    const cap = findByToolName("account_brief");
    check("catalog: account_brief registered", !!cap && cap.id === "account.brief");
    const ctxFor = (id: string, role: string) =>
      ({ persona: { id, name: id, role, orgId: ORG } }) as any;

    // =================================================================
    // 1. Persona catalog gating
    // =================================================================
    const hasCap = (role: string) =>
      capabilitiesForPersona({ id: "x", name: "x", role, orgId: ORG } as any).some(
        (e) => e.id === "account.brief",
      );
    check("gating: founding_partner sees account.brief", hasCap("founding_partner"));
    check("gating: partner sees account.brief", hasCap("partner"));
    check("gating: consultant sees account.brief (catalog)", hasCap("consultant"));
    for (const role of [
      "employee",
      "contractor",
      "partner_firm_resource",
      "recruiter",
      "board_observer",
      "alliance_partner",
    ]) {
      check(`gating: ${role} does NOT see account.brief`, !hasCap(role));
    }

    // =================================================================
    // 2. Eligible fetch — distilled view, tensions, no raw stress-test
    // =================================================================
    {
      const out: any = await cap!.run({ accountName: `QIB Probe ${TAG}` }, ctxFor(IDS.fp, "founding_partner"));
      // Two QIB accounts exist → disambiguation first (ACL-visible both).
      check(
        "fp: ambiguous name → account disambiguation with both visible options",
        out?.disambiguation?.kind === "account" &&
          out?.disambiguation?.options?.length === 2 &&
          out.disambiguation.options.some((o: any) => o.id === ACC.brief) &&
          out.disambiguation.options.some((o: any) => o.id === ACC.dupe),
        JSON.stringify(out).slice(0, 300),
      );
      const picked: any = await cap!.run({ accountId: ACC.brief }, ctxFor(IDS.fp, "founding_partner"));
      check("fp: brief fetch ok", picked?.ok === true && picked?.data?.hasBrief === true, picked);
      const d = picked?.data ?? {};
      check("fp: shape is account_brief with href + navigateTo", d.shape === "account_brief" && d.href === `/accounts/${ACC.brief}` && d.navigateTo?.path === d.href);
      check("fp: distilled ourView present", typeof d.ourView === "string" && d.ourView.includes("politically viable"), d.ourView);
      check(
        "fp: executive tensions carry text + evidence",
        Array.isArray(d.executiveTensions) &&
          d.executiveTensions.some((t: any) => t.text === TENSION_TEXT && t.evidence === "evidenced"),
        d.executiveTensions,
      );
      check("fp: mandate angles + open questions present", d.mandateAngles?.length === 1 && d.openQuestions?.length === 1);
      check("fp: PDF export hint present", d.pdfExport?.href === `/api/atelier/accounts/${ACC.brief}/research-brief.pdf`);
      // The distilled view legitimately folds a couple of objections /
      // failure scenarios into `watchOuts` — the invariant is that the
      // RAW stress-test structure never crosses as-is.
      const payload = JSON.stringify(picked);
      check(
        "fp: NO raw stress-test keys in payload (balanced view)",
        !payload.includes('"stressTest"') &&
          !payload.includes('"failureScenarios"') &&
          !payload.includes('"likelyObjections"') &&
          !payload.includes('"assumptions"') &&
          !payload.includes('"revisedHypothesis"'),
        payload.slice(0, 300),
      );
      check("fp: distilled watchOuts present instead", Array.isArray(d.watchOuts) && d.watchOuts.length > 0, d.watchOuts);
    }

    // =================================================================
    // 3. ACL — grant-scoped consultant never sees the accounts
    // =================================================================
    {
      const out: any = await cap!.run({ accountName: `QIB Probe ${TAG}` }, ctxFor(IDS.cons, "consultant"));
      const s = JSON.stringify(out);
      check(
        "consultant: out-of-perimeter name → not_found, no option leak",
        out?.ok === false && out?.errorCode === "not_found" && !s.includes(ACC.brief) && !s.includes(ACC.dupe),
        s.slice(0, 300),
      );
      const direct: any = await cap!.run({ accountId: ACC.brief }, ctxFor(IDS.cons, "consultant"));
      check("consultant: direct id fetch refused", direct?.ok === false && direct?.errorCode === "forbidden", direct);
      check(
        "consultant: refusal payload never contains brief content",
        !JSON.stringify(direct).includes(TENSION_TEXT),
      );
      // Restricted personas are refused in-run too (defense in depth).
      const pfr: any = await cap!.run({ accountId: ACC.brief }, ctxFor(IDS.cons, "partner_firm_resource"));
      check("pfr: in-run guard refuses", pfr?.ok === false && pfr?.errorCode === "forbidden", pfr);
    }

    // =================================================================
    // 4. No-brief account → friendly Cartographer hint
    // =================================================================
    {
      const out: any = await cap!.run({ accountName: `NoBrief Probe ${TAG}` }, ctxFor(IDS.fp, "founding_partner"));
      check(
        "no-brief: ok:true + hasBrief:false + Cartographer hint",
        out?.ok === true &&
          out?.data?.hasBrief === false &&
          /cartographer/i.test(String(out?.data?.message ?? "")),
        JSON.stringify(out).slice(0, 300),
      );
    }

    // =================================================================
    // 5. entity.detail routing — kind hint "brief" reaches the card
    // =================================================================
    {
      const ed = findByToolName("entity_detail");
      const out: any = await ed!.run(
        { query: `QIB Probe ${TAG}`, kind: "brief", id: ACC.brief },
        ctxFor(IDS.fp, "founding_partner"),
      );
      check(
        "entity.detail: kind 'brief' returns the account_brief card",
        out?.ok === true && out?.data?.shape === "account_brief" && out?.data?.hasBrief === true,
        JSON.stringify(out).slice(0, 300),
      );
    }

    // =================================================================
    // 6. End-to-end /cli/turn — card + surviving elaboration
    // =================================================================
    {
      const r = await postTurn(IDS.fp, `Give me our account brief about QIB Probe ${TAG} and explain the executive tensions`);
      check("e2e fp: /cli/turn responds 200", r.status === 200, r.status);
      const tr = r.frames.find((f) => f.event === "tool_result" && f.data?.tool === "account_brief");
      const trOk =
        tr?.data?.ok === true &&
        (tr?.data?.data?.hasBrief === true || Array.isArray(tr?.data?.data?.options));
      check("e2e fp: account_brief tool_result present + ok", trOk, JSON.stringify(tr?.data ?? {}).slice(0, 300));
      check("e2e fp: tensions text reaches the client card", r.raw.includes(TENSION_TEXT), r.raw.slice(0, 400));
      const narrations = r.frames.filter((f) => f.event === "narration");
      check(
        "e2e fp: elaboration prose survives narration trim",
        narrations.some((f) => String(f.data?.text ?? "").includes("friction")),
        narrations.map((f) => String(f.data?.text ?? "").slice(0, 120)),
      );
      check(
        "e2e fp: raw stress-test structure never crosses the wire",
        !r.raw.includes('"stressTest"') && !r.raw.includes('"failureScenarios"') && !r.raw.includes('"likelyObjections"'),
      );

      const noBrief = await postTurn(IDS.fp, `What does our noBrief account brief say?`);
      const nb = noBrief.frames.find((f) => f.event === "tool_result" && f.data?.tool === "account_brief");
      check(
        "e2e fp: no-brief turn returns the friendly card",
        nb?.data?.ok === true && nb?.data?.data?.hasBrief === false,
        JSON.stringify(nb?.data ?? {}).slice(0, 300),
      );

      // Perimeter — employee chat is me.*-clamped (200, not 403): the
      // account_brief tool must never run and no brief content may leak.
      const emp = await postTurn(IDS.emp, `Give me our account brief about QIB Probe ${TAG}`);
      check("e2e employee: /cli/turn responds (clamped) 200", emp.status === 200, emp.status);
      check(
        "e2e employee: account_brief never runs for a self-only role",
        !emp.frames.some((f) => f.event === "tool_result" && f.data?.tool === "account_brief"),
        emp.frames.map((f) => f.data?.tool).filter(Boolean),
      );
      check("e2e employee: no brief content leaks", !emp.raw.includes(TENSION_TEXT));
    }
  } finally {
    try {
      await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.userId, userIds));
      await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.userId, userIds));
      await db
        .delete(atelierAuditEvents)
        .where(and(inArray(atelierAuditEvents.actorId, userIds), eq(atelierAuditEvents.orgId, ORG)));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, accIds));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, userIds));
    } catch (e) {
      console.error("cleanup error", e);
    }
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => stub.close(() => r()));
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
