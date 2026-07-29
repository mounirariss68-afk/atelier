/**
 * Task #742 — chat reliability telemetry rollup.
 *
 * Parses `[cli-telemetry] {json}` lines from workflow/deployment logs and
 * prints a queryable reliability summary of the chat pipeline:
 *
 *   - clarification re-asks (same field asked again on a continuation)
 *   - post-confirm dead ends (affirmative answers that re-asked)
 *   - superseded questions (fresh request while one was pending)
 *   - duplicate answers ("already answered" consumption guard)
 *   - resolver outcome mix (values/confirm/cancel + via)
 *   - LLM-assist usage (deterministic parse gaps)
 *   - no-tool turns (tool_menu issued but no tool ran is NOT derivable
 *     from telemetry alone; we report menu kinds as a proxy)
 *   - replay-window truncation and session-fact ingest volume
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx tests/chat/telemetry-rollup.ts <log-file>...
 *   ...or pipe logs on stdin. Add --json for machine-readable output.
 *
 * Log sources: /tmp/logs/*.log (dev workflow console) or deployment logs.
 * See src/lib/atelier-cli/CHAT-RELIABILITY.md for the query cookbook.
 */
import { readFileSync } from "node:fs";

interface Evt {
  evt: string;
  [k: string]: unknown;
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const files = args.filter((a) => a !== "--json");

let raw = "";
if (files.length > 0) {
  raw = files.map((f) => readFileSync(f, "utf8")).join("\n");
} else {
  raw = readFileSync(0, "utf8");
}

const events: Evt[] = [];
for (const line of raw.split("\n")) {
  const idx = line.indexOf("[cli-telemetry] ");
  if (idx === -1) continue;
  try {
    const parsed = JSON.parse(line.slice(idx + "[cli-telemetry] ".length));
    if (parsed && typeof parsed.evt === "string") events.push(parsed);
  } catch {
    /* non-JSON telemetry line — skip */
  }
}

const by = (name: string) => events.filter((e) => e.evt === name);
const count = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
};

const issued = by("clarification_issued");
const resumed = by("clarification_resumed");
const superseded = by("clarification_superseded");
const alreadyAnswered = by("clarification_already_answered");
const llmAssist = by("clarification_llm_assist");
const replay = by("replay_window");
const facts = by("session_facts");
const menus = by("tool_menu");

const reasks = issued.filter((e) => e.reaskSameField === true);
const deadEnds = issued.filter((e) => e.confirmDeadEnd === true);

const summary = {
  totalEvents: events.length,
  clarifications: {
    issued: issued.length,
    resumed: resumed.length,
    reasksSameField: reasks.length,
    confirmDeadEnds: deadEnds.length,
    superseded: superseded.length,
    duplicateAnswers: alreadyAnswered.length,
    llmAssists: llmAssist.length,
    resolverOutcomes: count(resumed, (e) => `${String(e.resolver ?? "?")}/${String(e.via ?? "?")}`),
    reaskTools: count(reasks, (e) => String(e.tool ?? "?")),
  },
  replayWindow: {
    turns: replay.length,
    truncated: replay.filter((e) => e.truncated === true).length,
    crossSession: replay.filter((e) => e.crossSession === true).length,
  },
  sessionFacts: {
    turnsWithFacts: facts.filter((e) => Number(e.count ?? 0) > 0).length,
    turnsRendered: facts.filter((e) => e.rendered === true).length,
  },
  toolMenus: {
    total: menus.length,
    byIntentKind: count(menus, (e) => `${String(e.verb ?? "?")}/${String(e.kind ?? "?")}`),
  },
  // Health flags — the numbers a regression shows up in first.
  healthFlags: {
    reaskRate: issued.length > 0 ? +(reasks.length / issued.length).toFixed(3) : 0,
    deadEndRate: issued.length > 0 ? +(deadEnds.length / issued.length).toFixed(3) : 0,
    dupAnswerRate: resumed.length > 0 ? +(alreadyAnswered.length / resumed.length).toFixed(3) : 0,
  },
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("=== Chat reliability rollup ===");
  console.log(`telemetry events parsed: ${summary.totalEvents}`);
  console.log("\nClarifications:");
  console.log(`  issued            ${summary.clarifications.issued}`);
  console.log(`  resumed           ${summary.clarifications.resumed}`);
  console.log(`  re-asks (same fld) ${summary.clarifications.reasksSameField}`);
  console.log(`  confirm dead ends ${summary.clarifications.confirmDeadEnds}`);
  console.log(`  superseded        ${summary.clarifications.superseded}`);
  console.log(`  duplicate answers ${summary.clarifications.duplicateAnswers}`);
  console.log(`  LLM assists       ${summary.clarifications.llmAssists}`);
  console.log(`  resolver outcomes ${JSON.stringify(summary.clarifications.resolverOutcomes)}`);
  console.log("\nReplay window:");
  console.log(
    `  turns ${summary.replayWindow.turns}  truncated ${summary.replayWindow.truncated}  cross-session ${summary.replayWindow.crossSession}`,
  );
  console.log("\nSession facts:");
  console.log(
    `  turns with facts ${summary.sessionFacts.turnsWithFacts}  rendered ${summary.sessionFacts.turnsRendered}`,
  );
  console.log("\nTool menus:", JSON.stringify(summary.toolMenus.byIntentKind));
  console.log("\nHealth flags:", JSON.stringify(summary.healthFlags));
}
