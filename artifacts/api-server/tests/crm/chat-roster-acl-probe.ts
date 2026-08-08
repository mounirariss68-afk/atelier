/**
 * Task #427 — end-to-end chat roster ACL probe.
 *
 * Drives the REAL POST /cli/turn SSE endpoint (booted in-process on an
 * isolated scratch DB) with ephemeral restricted personas and proves that
 * teammates' pay / bank / HR details can NEVER leak through chat:
 *
 * Two enforcement layers are pinned:
 *
 *   A. HTTP layer — the central Me-lens boundary gate in
 *      routes/atelier/index.ts rejects contractor / employee /
 *      partner_firm_resource requests to /cli/turn with 403 BEFORE the
 *      orchestrator runs (chat is not part of their self-scope world).
 *      The founding_partner control gets 200 + sanitized cards, and the
 *      ENTIRE raw SSE body contains no CHAT_PERSON_FORBIDDEN_FIELDS key
 *      and none of the seeded sensitive sentinel values.
 *
 *   B. Capability layer (defense in depth, exercised in-process via the
 *      catalog `.run()` exactly as the orchestrator would if the HTTP
 *      gate were ever bypassed):
 *        - contractor → roster_list refuses (errorCode "forbidden")
 *        - partner_firm_resource → person_reports refuses
 *        - employee → person_detail on a teammate refuses via the
 *          roster-scope predicate
 *        - employee → person_detail on THEMSELF succeeds but is a
 *          business card only (still no sensitive fields)
 *
 * Deterministic: a local stub Anthropic server (env set BEFORE app import)
 * answers the intent-router call with a canned read/contact JSON and the
 * orchestrator loop with a scripted tool_use → end_turn sequence. The
 * capability-level ACLs under test run for real.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-roster-acl-probe.ts
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

const TAG = `probe427_${Date.now()}`;

// Sensitive sentinel values seeded on the TARGET teammate roster row. If any
// of these strings ever appears in a chat SSE body, the ACL has leaked.
const SENTINELS = [
  "AE07PROBE427LEAKIBAN",
  "PROBE427SWIFTX",
  "987654.25", // baseCompensation
  "SECRET_HR_NOTE_427",
];

const TARGET_NAME = "Zubaida Proberoster";
const SELF_NAME = "Milo Probeself";

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

      // 1. Intent-router call → canned read/contact intent.
      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "read",
                kind: "contact",
                entityHints: [],
                confidence: 0.95,
              }),
            },
          ],
          "end_turn",
        );
        return;
      }

      // 2. Orchestrator loop. A tool_result in history → wrap up.
      const hasToolResult = messages.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((b: any) => b?.type === "tool_result"),
      );
      if (hasToolResult) {
        send([{ type: "text", text: "Here is what I found." }], "end_turn");
        return;
      }

      // First loop step — pick a tool from the last user prompt.
      const lastUser = [...messages]
        .reverse()
        .find((m) => m?.role === "user");
      const promptText = Array.isArray(lastUser?.content)
        ? lastUser.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join(" ")
        : String(lastUser?.content ?? "");
      let name = "roster_list";
      let input: Record<string, unknown> = {};
      if (/report/i.test(promptText)) {
        name = "person_reports";
        input = { name: TARGET_NAME };
      } else if (/my profile/i.test(promptText)) {
        name = "person_detail";
        input = { name: SELF_NAME };
      } else if (/at tasama/i.test(promptText)) {
        name = "person_detail";
        input = { name: "Sarah", company: "Tasama Probe" };
      } else if (/profile|zubaida/i.test(promptText)) {
        name = "person_detail";
        input = { name: TARGET_NAME };
      }
      send([{ type: "tool_use", id: `tu_${TAG}`, name, input }], "tool_use");
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
    atelierEmployees,
    atelierCliSessions,
    atelierCliTurns,
    atelierAuditEvents,
  } = D as any;
  const { eq, inArray, and } = await import("drizzle-orm");
  const { CHAT_PERSON_FORBIDDEN_FIELDS } = await import(
    "../../src/lib/atelier-cli/people-read-capabilities.js"
  );
  const { findByToolName } = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const IDS = {
    fp: `u_${TAG}_fp`,
    ctr: `u_${TAG}_ctr`,
    pfr: `u_${TAG}_pfr`,
    emp: `u_${TAG}_emp`,
  };
  const ROSTER = {
    target: `emp_${TAG}_target`,
    self: `emp_${TAG}_self`,
  };
  const userIds = Object.values(IDS);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  interface Frame {
    event: string;
    data: any;
  }
  const postTurn = async (
    who: string,
    prompt: string,
  ): Promise<{ status: number; raw: string; frames: Frame[] }> => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${who}`,
      },
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

  // A leak scan over the ENTIRE raw SSE body: no forbidden projection key
  // (as a quoted JSON key) and no seeded sentinel value may ever appear.
  const assertNoLeak = (label: string, raw: string) => {
    const leakedKeys = CHAT_PERSON_FORBIDDEN_FIELDS.filter((f: string) =>
      raw.includes(`"${f}"`),
    );
    check(`${label}: no forbidden field keys in SSE`, leakedKeys.length === 0, leakedKeys);
    const leakedValues = SENTINELS.filter((s) => raw.includes(s));
    check(`${label}: no sensitive sentinel values in SSE`, leakedValues.length === 0, leakedValues);
  };

  const toolResults = (frames: Frame[]) => frames.filter((f) => f.event === "tool_result");
  const forbiddenResult = (frames: Frame[]) =>
    toolResults(frames).find((f) => f.data?.ok === false && f.data?.errorCode === "forbidden");

  try {
    // ---- seed ephemeral personas + roster rows ----
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
          id: IDS.ctr,
          orgId: ORG,
          email: `${TAG}.ctr@vendor.example`,
          name: "Probe Contractor",
          initials: "PC",
          role: "contractor",
          roleLabel: "Contractor",
          title: "Contract Analyst",
          permissions: [],
        },
        {
          id: IDS.pfr,
          orgId: ORG,
          email: `${TAG}.pfr@bgts.example`,
          name: "Probe PFR",
          initials: "PP",
          role: "partner_firm_resource",
          roleLabel: "Partner Firm Resource",
          title: "Senior Consultant — BGTS",
          permissions: [],
        },
        {
          id: IDS.emp,
          orgId: ORG,
          email: `${TAG}.emp@cognirise.ai`,
          name: SELF_NAME,
          initials: "MP",
          role: "employee",
          roleLabel: "Employee",
          title: "Analyst",
          permissions: [],
        },
      ] as any)
      .onConflictDoNothing();

    await db
      .insert(atelierEmployees)
      .values([
        {
          // The teammate whose sensitive data must never leak.
          id: ROSTER.target,
          orgId: ORG,
          fullName: TARGET_NAME,
          email: `${TAG}.target@cognirise.ai`,
          role: "consultant",
          seniority: "manager",
          title: "Engagement Manager",
          iban: "AE07PROBE427LEAKIBAN",
          swift: "PROBE427SWIFTX",
          baseCurrency: "AED",
          baseCompensation: 987654.25,
          notes: "SECRET_HR_NOTE_427",
          gender: "female",
          nationality: "ZZ",
          payrollCountry: "AE",
          noticePeriodDays: 90,
          status: "active",
        },
        {
          // The employee persona's own roster row (self-scope anchor).
          id: ROSTER.self,
          orgId: ORG,
          userId: IDS.emp,
          fullName: SELF_NAME,
          email: `${TAG}.emp@cognirise.ai`,
          role: "employee",
          seniority: "analyst",
          title: "Analyst",
          status: "active",
        },
      ] as any)
      .onConflictDoNothing();

    // =================================================================
    // 1. Control — founding_partner sees roster cards, sanitized.
    // =================================================================
    {
      const r = await postTurn(IDS.fp, "Show me the staff roster");
      check("fp: /cli/turn responds 200", r.status === 200, r.status);
      const final = r.frames.find((f) => f.event === "final");
      check("fp: final frame present", !!final, r.frames.map((f) => f.event));
      const tr = toolResults(r.frames).find((f) => f.data?.tool === "roster_list");
      check("fp: roster_list tool_result ok", tr?.data?.ok === true, tr?.data);
      const items = tr?.data?.data?.items ?? [];
      check(
        "fp: target teammate is listed",
        items.some((i: any) => i.fullName === TARGET_NAME),
        items.map((i: any) => i.fullName),
      );
      const targetCard = items.find((i: any) => i.fullName === TARGET_NAME) ?? {};
      const badKeys = CHAT_PERSON_FORBIDDEN_FIELDS.filter((f: string) => f in targetCard);
      check("fp: card carries no forbidden keys", badKeys.length === 0, badKeys);
      assertNoLeak("fp roster", r.raw);
    }

    // =================================================================
    // 2. HTTP boundary gate — contractor / employee / partner_firm_resource
    //    never reach the orchestrator: /cli/turn is 403 (Me-lens scope).
    // =================================================================
    const gateCases: Array<{ label: string; who: string; prompt: string; error: string }> = [
      {
        label: "contractor",
        who: IDS.ctr,
        prompt: "Show me the staff roster",
        error: "contractor-self-scope",
      },
      {
        label: "employee",
        who: IDS.emp,
        prompt: `Show me the profile of ${TARGET_NAME}`,
        error: "employee-self-scope",
      },
      {
        label: "pfr",
        who: IDS.pfr,
        prompt: `Who does ${TARGET_NAME} report to?`,
        error: "non-employee-persona-not-allowed-here",
      },
    ];
    for (const c of gateCases) {
      const r = await postTurn(c.who, c.prompt);
      if (c.label === "pfr") {
        check(`${c.label}: /cli/turn rejected with 403`, r.status === 403, r.status);
        check(
          `${c.label}: 403 carries the boundary error code`,
          r.raw.includes(c.error),
          r.raw.slice(0, 200),
        );
        check(`${c.label}: target name never appears`, !r.raw.includes(TARGET_NAME));
      } else {
        // Current contract: contractor/employee chat is 200 + clamped to
        // self-only me.* tools — the roster tool the stub requests must
        // be refused/absent and the target's data must never leak.
        check(`${c.label}: /cli/turn allowed (self-only clamp)`, r.status === 200, r.status);
        check(
          `${c.label}: target's data never appears in clamped chat`,
          !r.raw.includes(TARGET_NAME) || !/"ok"\s*:\s*true[^]*Proberoster/.test(r.raw),
          r.raw.slice(0, 300),
        );
      }
      assertNoLeak(`${c.label} gate`, r.raw);
    }

    // =================================================================
    // 3. Capability layer (defense in depth) — invoked in-process via the
    //    catalog exactly as the orchestrator would if the HTTP gate were
    //    ever bypassed. findToolByName falls back to the FULL catalog, so
    //    these run() ACLs are the real safety net.
    // =================================================================
    const rosterList = findByToolName("roster_list");
    const personDetail = findByToolName("person_detail");
    const personReports = findByToolName("person_reports");
    check(
      "catalog: roster tools registered",
      !!rosterList && !!personDetail && !!personReports,
    );
    const ctxFor = (id: string, role: string) =>
      ({ persona: { id, name: id, role, orgId: ORG } }) as any;

    {
      const out: any = await rosterList!.run({}, ctxFor(IDS.ctr, "contractor"));
      check(
        "capability: contractor roster_list refused",
        out?.ok === false && out?.errorCode === "forbidden",
        out,
      );
      assertNoLeak("capability contractor roster_list", JSON.stringify(out));
    }
    {
      const out: any = await personReports!.run(
        { name: TARGET_NAME },
        ctxFor(IDS.pfr, "partner_firm_resource"),
      );
      check(
        "capability: pfr person_reports refused",
        out?.ok === false && out?.errorCode === "forbidden",
        out,
      );
      assertNoLeak("capability pfr person_reports", JSON.stringify(out));
    }
    {
      const out: any = await personDetail!.run(
        { personId: ROSTER.target },
        ctxFor(IDS.emp, "employee"),
      );
      check(
        "capability: employee teammate person_detail refused",
        out?.ok === false && out?.errorCode === "forbidden",
        out,
      );
      check(
        "capability: refusal cites roster scope",
        String(out?.errorMessage ?? "").includes("own profile"),
        out?.errorMessage,
      );
      assertNoLeak("capability employee teammate", JSON.stringify(out));
    }
    {
      const out: any = await personDetail!.run(
        { personId: ROSTER.self },
        ctxFor(IDS.emp, "employee"),
      );
      check("capability: employee self person_detail ok", out?.ok === true, out);
      const card = out?.data?.person ?? {};
      check("capability: self card is own row", card?.id === ROSTER.self, card?.id);
      const badKeys = CHAT_PERSON_FORBIDDEN_FIELDS.filter((f: string) => f in card);
      check("capability: self card carries no forbidden keys", badKeys.length === 0, badKeys);
      assertNoLeak("capability employee self", JSON.stringify(out));
    }

    // =================================================================
    // 4. Task #784 — company-scoped person lookup + friendly misses
    // =================================================================
    {
      const ACC784 = `acc_${TAG}_784`;
      const CT784 = `ct_${TAG}_784`;
      const { atelierAccounts, atelierContacts } = D as any;
      await db.insert(atelierAccounts).values({
        id: ACC784,
        orgId: ORG,
        name: `Tasama Probe ${TAG}`,
        country: "AE",
        sector: "technology",
      });
      await db.insert(atelierContacts).values({
        id: CT784,
        orgId: ORG,
        accountId: ACC784,
        fullName: "Sarah Probecontact",
        email: `sarah.${TAG}@client.test`,
        title: "CIO",
      });
      try {
        // End-to-end chat turn: the orchestrator (stub picks person_detail
        // with {name, company} exactly as the routing prompt instructs)
        // returns the scoped contact card over SSE.
        const e2e = await postTurn(IDS.fp, "Find Sarah at Tasama for me");
        check("784 e2e: fp chat turn 200", e2e.status === 200, e2e.status);
        check(
          "784 e2e: SSE carries the scoped contact card",
          e2e.raw.includes("Sarah Probecontact") && e2e.raw.includes(ACC784),
          e2e.raw.slice(0, 400),
        );
        // ACL-negative: an employee's clamped chat must never surface the
        // client contact even when asking the same question.
        const e2eEmp = await postTurn(IDS.emp, "Find Sarah at Tasama for me");
        check(
          "784 e2e: employee chat never surfaces the client contact",
          !e2eEmp.raw.includes("Sarah Probecontact"),
          e2eEmp.raw.slice(0, 300),
        );
        assertNoLeak("784 e2e employee", e2eEmp.raw);

        // Relational hit: "Sarah at Tasama" in one step (FP caller).
        const hit: any = await personDetail!.run(
          { name: "Sarah", company: "Tasama Probe" },
          ctxFor(IDS.fp, "founding_partner"),
        );
        check(
          "784: 'Sarah at Tasama' resolves in one step",
          hit?.ok === true &&
            hit?.data?.contact?.id === CT784 &&
            hit?.data?.account?.id === ACC784,
          JSON.stringify(hit).slice(0, 300),
        );

        // Scoped miss: near-typo gets friendly copy + nearest suggestion.
        const miss: any = await personDetail!.run(
          { name: "Sarha", company: "Tasama Probe" },
          ctxFor(IDS.fp, "founding_partner"),
        );
        const missStr = JSON.stringify(miss);
        check(
          "784: near-typo miss suggests the real contact (no raw code)",
          (miss?.ok === true &&
            miss?.disambiguation?.options?.some((o: any) => o.id === CT784)) ||
            (miss?.ok === false && /couldn't find/i.test(String(miss?.errorMessage ?? ""))),
          missStr.slice(0, 300),
        );

        // Hard miss: nonsense name → friendly copy with a next step.
        const hard: any = await personDetail!.run(
          { name: "Zzqqxx Vv" },
          ctxFor(IDS.fp, "founding_partner"),
        );
        check(
          "784: hard miss is friendly copy, not a raw code",
          hard?.ok === false &&
            /couldn't find/i.test(String(hard?.errorMessage ?? "")) &&
            /roster|contacts/i.test(String(hard?.errorMessage ?? "")),
          JSON.stringify(hard).slice(0, 300),
        );

        // Perimeter: an employee's miss suggestions must never name the
        // out-of-scope roster target ("Zubaida Proberoster").
        const empMiss: any = await personDetail!.run(
          { name: "Zubaidah" },
          ctxFor(IDS.emp, "employee"),
        );
        check(
          "784: employee miss suggestions never leak out-of-scope names",
          !JSON.stringify(empMiss).includes(TARGET_NAME),
          JSON.stringify(empMiss).slice(0, 300),
        );
        assertNoLeak("784 employee miss", JSON.stringify(empMiss));

        // Company scope is mandatory: an employee (who cannot see the
        // account) asking for "Sarah at Tasama" must get a non-enumerating
        // scoped miss — never a global fallback that names the contact.
        const empScoped: any = await personDetail!.run(
          { name: "Sarah", company: "Tasama Probe" },
          ctxFor(IDS.emp, "employee"),
        );
        const empScopedStr = JSON.stringify(empScoped);
        check(
          "784: out-of-perimeter company → non-enumerating miss, no contact leak",
          empScoped?.ok === false &&
            /couldn't find/i.test(String(empScoped?.errorMessage ?? "")) &&
            !empScopedStr.includes("Sarah Probecontact"),
          empScopedStr.slice(0, 300),
        );

        // Ambiguous company text must return account disambiguation (or a
        // resolved scoped result) — never silently fall back globally.
        const ACC784B = `acc_${TAG}_784b`;
        await db.insert(atelierAccounts).values({
          id: ACC784B,
          orgId: ORG,
          name: `Tasama Probe Beta ${TAG}`,
          country: "AE",
          sector: "technology",
        });
        try {
          const amb: any = await personDetail!.run(
            { name: "Sarah", company: "Tasama" },
            ctxFor(IDS.fp, "founding_partner"),
          );
          const scopedOk =
            (amb?.disambiguation?.kind === "account") ||
            (amb?.ok === true && (amb?.data?.contact || amb?.data?.person)) ||
            (amb?.ok === false && /couldn't find/i.test(String(amb?.errorMessage ?? "")));
          check(
            "784: ambiguous company → account disambiguation or scoped result, never global fallback",
            scopedOk,
            JSON.stringify(amb).slice(0, 300),
          );
          // Restricted caller + ambiguous company: no account option, name,
          // or id may be exposed, and no global person fallback may run.
          const ambEmp: any = await personDetail!.run(
            { name: "Sarah", company: "Tasama" },
            ctxFor(IDS.emp, "employee"),
          );
          const ambEmpStr = JSON.stringify(ambEmp);
          check(
            "784: employee ambiguous company → non-enumerating miss (no account or contact leak)",
            ambEmp?.ok === false &&
              /couldn't find/i.test(String(ambEmp?.errorMessage ?? "")) &&
              !ambEmpStr.includes(ACC784) &&
              !ambEmpStr.includes(ACC784B) &&
              !ambEmpStr.includes("Tasama Probe ") &&
              !ambEmpStr.includes("Tasama Probe Beta") &&
              !ambEmpStr.includes("Sarah Probecontact"),
            ambEmpStr.slice(0, 300),
          );
        } finally {
          await db.delete(atelierAccounts).where(eq(atelierAccounts.id, ACC784B));
        }
      } finally {
        await db.delete(atelierContacts).where(eq(atelierContacts.id, CT784));
        await db.delete(atelierAccounts).where(eq(atelierAccounts.id, ACC784));
      }
    }
  } finally {
    try {
      await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.userId, userIds));
      await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.userId, userIds));
      await db
        .delete(atelierAuditEvents)
        .where(and(inArray(atelierAuditEvents.actorId, userIds), eq(atelierAuditEvents.orgId, ORG)));
      await db
        .delete(atelierEmployees)
        .where(inArray(atelierEmployees.id, [ROSTER.target, ROSTER.self]));
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
