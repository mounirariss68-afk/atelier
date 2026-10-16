/**
 * Riser live regression gate.
 *
 * Sends the cases in questions.json to a RUNNING Atelier deployment through
 * the same endpoint, headers and body the web client uses, then judges the
 * raw SSE frames. This is the only Riser suite that talks to a real model;
 * every other riser-* suite stubs Anthropic. Run it at the end of every
 * repair session and paste the table into the session notes.
 *
 *   ATELIER_BASE_URL=https://<host> ATELIER_SESSION_COOKIE=<atelier_auth_session value> \
 *     pnpm --filter @workspace/api-server exec tsx tests/riser-live-eval/run.ts [--only id,id] [--json out.json]
 *
 * The cookie is the value of `atelier_auth_session` from a signed-in browser
 * (DevTools → Application → Cookies). Never commit it.
 *
 * Protocol mode is negotiated the way lib/chat-core does: if GET
 * /cli/capabilities advertises protocolVersion the run uses semantic headers
 * and a "card" means a `presentation` frame; otherwise legacy headers and a
 * "card" means a successful tool_result carrying data.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Expect = {
  tools?: string[];
  toolsAny?: string[];
  maxToolCalls?: number;
  card?: boolean;
  textContainsAny?: string[];
  textNotContains?: string[];
  dataHasKey?: string;
  dataNotContains?: string[];
  frames?: string[];
  noErrors?: boolean;
  visibleFailure?: boolean;
  confirmPayloadOnlyKnownFields?: string;
  afterCommit?: { card?: boolean; orProse?: boolean };
  finalNotRedacted?: string[];
  modelContains?: string;
};

type Case = {
  id: string;
  prompt: string;
  expect: Expect;
  finding?: string;
  continuesSession?: string;
  noLocalePreamble?: boolean;
  cancelAfter?: boolean;
  commit?: boolean;
  cleanup?: string;
};

type Frame = { ev: string; data: Record<string, unknown> };

// Fields the dispatch target of propose_write accepts per kind. Keep in step
// with write-dispatch.ts DISPATCH_TABLE targets' inputSchema; the repair
// makes propose_write reject anything outside this set at preview time.
const KNOWN_WRITE_FIELDS: Record<string, string[]> = {
  account: ["id", "name", "status", "notes", "website", "sector", "country", "tier", "brandName"],
};

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
// --replay <file>: judge frames recorded elsewhere (e.g. captured in a
// browser tab that already holds the session cookie) instead of calling the
// API. File shape: { mode, base?, cases: { [id]: { frames, afterCommit?, ms? } } }.
const replayFile = (() => {
  const i = args.indexOf("--replay");
  return i >= 0 ? args[i + 1] : null;
})();
const BASE = (process.env.ATELIER_BASE_URL ?? "").replace(/\/$/, "");
const COOKIE = process.env.ATELIER_SESSION_COOKIE ?? "";
if (!replayFile && (!BASE || !COOKIE)) {
  console.error("ATELIER_BASE_URL and ATELIER_SESSION_COOKIE are required (or --replay <file>).");
  process.exit(2);
}
const only = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? new Set(args[i + 1].split(",")) : null;
})();
const jsonOut = (() => {
  const i = args.indexOf("--json");
  return i >= 0 ? args[i + 1] : null;
})();

const spec = JSON.parse(readFileSync(join(here, "questions.json"), "utf8")) as { cases: Case[] };

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(BASE + path, {
    ...init,
    headers: {
      Cookie: `atelier_auth_session=${COOKIE}`,
      ...(init.headers ?? {}),
    },
  });
}

async function negotiate(): Promise<"semantic" | "legacy"> {
  const r = await api("/api/atelier/cli/capabilities");
  if (!r.ok) throw new Error(`capabilities ${r.status}`);
  const j = (await r.json()) as { protocolVersion?: number };
  return Number.isInteger(j.protocolVersion) ? "semantic" : "legacy";
}

function headersFor(mode: "semantic" | "legacy"): Record<string, string> {
  return mode === "semantic"
    ? {
        "Content-Type": "application/json",
        "X-Assistant-Protocol-Version": "1",
        "X-Assistant-Presentation-Versions": "1",
        "X-Assistant-Protocol-Mode": "semantic",
      }
    : { "Content-Type": "application/json" };
}

async function readSse(res: Response): Promise<Frame[]> {
  const frames: Frame[] = [];
  const text = await res.text();
  for (const chunk of text.split("\n\n")) {
    const ev = /^event:\s*(.*)$/m.exec(chunk)?.[1];
    const data = chunk
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!ev && !data) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      /* keep empty */
    }
    frames.push({ ev: ev ?? String(parsed.type ?? "unknown"), data: parsed });
  }
  return frames;
}

async function turn(
  mode: "semantic" | "legacy",
  prompt: string,
  sessionId: string | null,
  noLocale: boolean,
): Promise<{ frames: Frame[]; ms: number }> {
  const body = {
    sessionId,
    prompt: (noLocale ? "" : "Respond in English.\n\n") + prompt,
    attachmentIds: [],
    pageContext: null,
    dryRun: false,
    clientTurnKey: `live-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent: null,
    continuesTurnId: null,
    clarificationValues: null,
    disambigOptionId: null,
    timezone: "Asia/Dubai",
  };
  const t0 = Date.now();
  const res = await api("/api/atelier/cli/turn", {
    method: "POST",
    headers: headersFor(mode),
    body: JSON.stringify(body),
  });
  const frames = await readSse(res);
  return { frames, ms: Date.now() - t0 };
}

function pick<T = unknown>(f: Frame, key: string): T | undefined {
  return f.data[key] as T | undefined;
}

function judge(mode: "semantic" | "legacy", c: Case, frames: Frame[], extra: { afterCommit?: Frame[] }): string[] {
  const fails: string[] = [];
  const e = c.expect;
  const toolCalls = frames.filter((f) => f.ev === "tool_call").map((f) => String(pick(f, "tool")));
  const results = frames.filter((f) => f.ev === "tool_result");
  const okResults = results.filter((f) => pick(f, "ok") === true);
  const presentations = frames.filter((f) => f.ev === "presentation");
  const text = frames
    .filter((f) => f.ev === "narration" || f.ev === "text_delta")
    .map((f) => String(pick(f, "text") ?? ""))
    .join(" ");
  const errors = frames.filter((f) => f.ev === "error");
  const final = frames.find((f) => f.ev === "final");
  const models = new Set(frames.map((f) => String(pick(f, "model") ?? "")).filter(Boolean));
  const dataBlob = JSON.stringify(okResults.map((f) => f.data));
  const hasCard = mode === "semantic" ? presentations.length > 0 : okResults.some((f) => pick(f, "data") != null);

  if (e.noErrors && errors.length) fails.push(`error frame: ${JSON.stringify(errors[0].data).slice(0, 160)}`);
  if (e.tools) for (const t of e.tools) if (!toolCalls.includes(t)) fails.push(`expected tool ${t}, got [${toolCalls.join(", ")}]`);
  if (e.toolsAny && !e.toolsAny.some((t) => toolCalls.includes(t))) fails.push(`expected one of [${e.toolsAny.join(", ")}], got [${toolCalls.join(", ")}]`);
  if (e.maxToolCalls !== undefined && toolCalls.length > e.maxToolCalls) fails.push(`${toolCalls.length} tool calls > ${e.maxToolCalls}`);
  if (e.card && !hasCard) fails.push(mode === "semantic" ? "no presentation frame (card hidden)" : "no tool_result with data");
  if (e.textContainsAny && !e.textContainsAny.some((s) => text.toLowerCase().includes(s.toLowerCase()))) fails.push(`text lacks any of [${e.textContainsAny.join(" | ")}]: "${text.slice(0, 120)}"`);
  if (e.textNotContains) for (const s of e.textNotContains) if (text.toLowerCase().includes(s.toLowerCase())) fails.push(`text contains "${s}"`);
  if (e.dataHasKey && !dataBlob.includes(`"${e.dataHasKey}"`)) fails.push(`result data lacks key ${e.dataHasKey}`);
  if (e.dataNotContains) for (const s of e.dataNotContains) if (dataBlob.includes(s)) fails.push(`result data contains "${s}"`);
  if (e.frames) for (const ev of e.frames) if (!frames.some((f) => f.ev === ev)) fails.push(`missing frame ${ev}`);
  if (e.visibleFailure) {
    const visible = results.some((f) => pick(f, "ok") === false) || errors.length > 0;
    if (!visible) fails.push("failing read produced no visible failure frame");
  }
  if (e.confirmPayloadOnlyKnownFields) {
    const conf = frames.find((f) => f.ev === "needs_confirmation");
    const payload = ((conf?.data.diff as Record<string, unknown> | undefined)?.payload ?? {}) as Record<string, unknown>;
    const allowed = new Set(KNOWN_WRITE_FIELDS[e.confirmPayloadOnlyKnownFields] ?? []);
    const unknown = Object.keys(payload).filter((k) => !allowed.has(k));
    if (unknown.length) fails.push(`confirm card shows fields the target cannot write: ${unknown.join(", ")}`);
  }
  if (e.afterCommit && extra.afterCommit) {
    const ac = extra.afterCommit;
    const acCard = mode === "semantic" ? ac.some((f) => f.ev === "presentation") : ac.some((f) => f.ev === "tool_result" && pick(f, "ok") === true);
    const acProse = ac.some((f) => (f.ev === "narration" || f.ev === "text_delta") && String(pick(f, "text") ?? "").trim());
    if (!(acCard || (e.afterCommit.orProse && acProse))) fails.push("after commit: neither card nor prose");
  }
  if (e.finalNotRedacted && final) for (const k of e.finalNotRedacted) if (String(final.data[k]) === "[REDACTED]") fails.push(`final.${k} is [REDACTED]`);
  if (e.modelContains && ![...models].some((m) => m.includes(e.modelContains!))) fails.push(`model(s) [${[...models].join(", ")}] do not contain ${e.modelContains}`);
  return fails;
}

async function main() {
  if (replayFile) {
    const rec = JSON.parse(readFileSync(replayFile, "utf8")) as {
      mode: "semantic" | "legacy";
      base?: string;
      cases: Record<string, { frames: Frame[]; afterCommit?: Frame[]; ms?: number }>;
    };
    console.log(`Riser eval — replaying recorded frames from ${replayFile} (${rec.base ?? "?"}, mode ${rec.mode})\n`);
    const rows: Array<{ id: string; pass: boolean; ms: number; tools: string; fails: string[]; finding?: string }> = [];
    for (const c of spec.cases) {
      if (only && !only.has(c.id)) continue;
      const r = rec.cases[c.id];
      const frames = r?.frames ?? [{ ev: "error", data: { message: "not recorded" } }];
      const fails = judge(rec.mode, c, frames, { afterCommit: r?.afterCommit });
      const tools = frames.filter((f) => f.ev === "tool_call").map((f) => String(pick(f, "tool"))).join(", ");
      rows.push({ id: c.id, pass: fails.length === 0, ms: r?.ms ?? 0, tools, fails, finding: c.finding });
      console.log(`${fails.length === 0 ? "PASS" : "FAIL"}  ${c.id.padEnd(30)} ${String(r?.ms ?? 0).padStart(6)} ms  [${tools}]`);
      for (const f of fails) console.log(`      - ${f}`);
    }
    const passed = rows.filter((r) => r.pass).length;
    console.log(`\n${passed}/${rows.length} passed.`);
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base: rec.base ?? null, mode: rec.mode, ranAt: new Date().toISOString(), rows }, null, 2));
    process.exit(passed === rows.length ? 0 : 1);
  }
  const mode = await negotiate();
  console.log(`Riser live eval against ${BASE} — protocol mode: ${mode}\n`);
  const sessions = new Map<string, string | null>();
  const rows: Array<{ id: string; pass: boolean; ms: number; tools: string; fails: string[]; finding?: string }> = [];

  for (const c of spec.cases) {
    if (only && !only.has(c.id)) continue;
    const sessionId = c.continuesSession ? sessions.get(c.continuesSession) ?? null : null;
    let frames: Frame[] = [];
    let ms = 0;
    const extra: { afterCommit?: Frame[] } = {};
    try {
      const t = await turn(mode, c.prompt, sessionId, c.noLocalePreamble === true);
      frames = t.frames;
      ms = t.ms;
      const final = frames.find((f) => f.ev === "final");
      const sid = (final?.data.sessionId as string | undefined) ?? (frames.map((f) => f.data.sessionId as string | undefined).find(Boolean) ?? null);
      sessions.set(c.id, sid);
      const turnId = (final?.data.turnId as string | undefined) ?? (frames.find((f) => f.ev === "needs_confirmation")?.data.turnId as string | undefined);
      if (c.cancelAfter && turnId) {
        await api(`/api/atelier/cli/turn/${turnId}/cancel`, { method: "POST", headers: headersFor(mode), body: "{}" });
      }
      if (c.commit && turnId) {
        const r = await api(`/api/atelier/cli/turn/${turnId}/confirm`, { method: "POST", headers: headersFor(mode), body: JSON.stringify({ allowRetry: false }) });
        extra.afterCommit = await readSse(r);
      }
    } catch (err) {
      frames = [{ ev: "error", data: { message: String(err) } }];
    }
    const fails = judge(mode, c, frames, extra);
    const tools = frames.filter((f) => f.ev === "tool_call").map((f) => String(pick(f, "tool"))).join(", ");
    rows.push({ id: c.id, pass: fails.length === 0, ms, tools, fails, finding: c.finding });
    console.log(`${fails.length === 0 ? "PASS" : "FAIL"}  ${c.id.padEnd(30)} ${String(ms).padStart(6)} ms  [${tools}]`);
    for (const f of fails) console.log(`      - ${f}`);
  }

  const passed = rows.filter((r) => r.pass).length;
  console.log(`\n${passed}/${rows.length} passed.`);
  const cleanup = spec.cases.filter((c) => c.cleanup && (!only || only.has(c.id))).map((c) => c.cleanup);
  if (cleanup.length) console.log(`Cleanup needed: ${cleanup.join("; ")}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base: BASE, mode, ranAt: new Date().toISOString(), rows }, null, 2));
  process.exit(passed === rows.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
