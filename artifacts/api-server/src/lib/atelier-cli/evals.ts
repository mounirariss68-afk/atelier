/**
 * Task #335 — Evals harness.
 *
 * The fixtures below are flagged prompts the orchestrator should
 * reliably classify into a specific `toolName` (in MOCK_MODE, the
 * deterministic mock router resolves these without Claude). The
 * runner POSTs to `/api/atelier/cli/turn` and asserts:
 *
 *   1. one of `expectToolNames` was called, OR
 *   2. when `expectError` is set, the turn ended `error` with the
 *      specified errorCode (e.g. unknown_tool, ambiguous).
 *
 * Re-run this whenever `CATALOG_SCHEMA_VERSION` bumps so we catch
 * silent regressions in tool selection.
 */

import type { CapabilityModule } from "./capability-catalog.js";

export interface EvalFixture {
  id: string;
  /** Module the prompt should be classified into (informational). */
  module: CapabilityModule;
  prompt: string;
  /** Tool names that count as "correctly classified". */
  expectToolNames?: string[];
  /** Or — assert the turn ended in error with this code. */
  expectError?: string;
  /** Optional intent override that the client would pass. */
  intent?: string;
}

/**
 * Stable seed list. Keep small (~12 entries) so the harness runs in
 * <2s in MOCK_MODE; expand per-module as the catalog grows.
 */
export const EVAL_FIXTURES: EvalFixture[] = [
  {
    id: "raid.list",
    module: "raid",
    prompt: "list my open raid items",
    expectToolNames: ["list_my_open_raid_items"],
  },
  {
    id: "raid.add",
    module: "raid",
    prompt: "add a raid item: vendor missed milestone",
    expectToolNames: ["add_raid_item", "raid_add_v2"],
  },
  {
    id: "account.find",
    module: "account",
    prompt: "find the Tasama account",
    expectToolNames: ["resolve_account_by_name", "account_lookup"],
  },
  {
    id: "account.who_is",
    module: "account",
    prompt: "who is Aramex?",
    expectToolNames: ["resolve_account_by_name", "account_lookup"],
  },
  {
    id: "meta.help",
    module: "meta",
    prompt: "/help",
    // The orchestrator may serve /help directly from the slash-router
    // (no tool_call frame) or via list_capabilities. Either is fine —
    // we just need a non-error final.
    expectToolNames: [],
  },
  {
    id: "meta.unknown",
    module: "meta",
    prompt: "asdf qwerty zxcv",
    // Mock router falls through to end_turn — we accept either a
    // benign read_only_no_op success OR an explicit error.
    expectToolNames: [],
  },
];

/**
 * Run the eval suite against a base URL. Returns one row per fixture
 * with `pass: boolean`, the called toolNames, and the final status.
 *
 * The runner is intentionally protocol-light — it spins up an SSE
 * fetch, scans frames for `tool_call` + `final`, and decides pass/fail
 * locally. No external test framework needed.
 */
export interface EvalResult {
  id: string;
  pass: boolean;
  status: string | null;
  toolsCalled: string[];
  reason?: string;
}

export async function runEvals(opts: {
  baseUrl: string;
  cookie: string;
  fixtures?: EvalFixture[];
}): Promise<EvalResult[]> {
  // Determinism guard — the harness asserts toolName classification, so
  // it is meaningless against a live LLM. Refuse to run if the api-server
  // is not in MOCK_MODE.
  if (process.env.MOCK_MODE === "0" || process.env.MOCK_MODE === "false") {
    throw new Error(
      "runEvals requires MOCK_MODE (deterministic router). Re-run with MOCK_MODE=1 (the default).",
    );
  }
  const fixtures = opts.fixtures ?? EVAL_FIXTURES;
  const out: EvalResult[] = [];
  for (const f of fixtures) {
    const res = await fetch(`${opts.baseUrl}/cli/turn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: opts.cookie,
      },
      body: JSON.stringify({
        prompt: f.prompt,
        intent: f.intent ?? null,
      }),
    });
    const text = await res.text();
    const toolsCalled: string[] = [];
    let status: string | null = null;
    let observedErrorCode: string | null = null;
    for (const block of text.split(/\n\n+/)) {
      const evLine = block.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      const event = evLine.slice("event:".length).trim();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataLine.slice("data:".length).trim());
      } catch {
        // ignore
      }
      if (event === "tool_call" && typeof data.tool === "string") {
        toolsCalled.push(data.tool);
      } else if (event === "final" && typeof data.status === "string") {
        status = data.status;
      } else if (event === "error" && typeof data.code === "string") {
        observedErrorCode = data.code;
      } else if (event === "tool_result" && data.ok === false && typeof data.errorCode === "string") {
        observedErrorCode = data.errorCode;
      }
    }
    let pass = true;
    let reason: string | undefined;
    if (f.expectError) {
      // Strict: the error/errorCode frame must match the documented code.
      pass = observedErrorCode === f.expectError;
      if (!pass) reason = `expected errorCode=${f.expectError}, got ${observedErrorCode ?? "none"} (status=${status})`;
    } else if (f.expectToolNames && f.expectToolNames.length > 0) {
      pass = toolsCalled.some((t) => f.expectToolNames!.includes(t));
      if (!pass) reason = `none of ${f.expectToolNames.join("|")} called (got ${toolsCalled.join(",") || "none"})`;
    } else {
      // Open-ended (e.g. unknown gibberish, /help served from slash
      // router) — accept any non-error final.
      pass = status !== null && status !== "error";
      if (!pass) reason = `no acceptable final (got ${status})`;
    }
    out.push({ id: f.id, pass, status, toolsCalled, reason });
  }
  return out;
}
