/**
 * Per user request (2026-07-23) — canned chat showcase for the read-only
 * App Store demo persona.
 *
 * The demo user (see atelier-seed-auth DEMO_USER_ID) is hard-blocked from
 * every mutating route by demoReadOnlyGuard, which used to include POST
 * /cli/turn — so typing anything in chat returned 403. The guard now lets
 * the demo user's chat turns through, and /cli/turn routes them HERE
 * instead of the real orchestrator: no LLM call, no tools, no DB writes.
 * Every prompt gets a deterministic capability-showcase card so the
 * reviewer can see what the assistant does in the full product.
 */
import type { CliFrame } from "./index.js";

interface ShowcaseTopic {
  /** Keyword regexes that route a prompt to this topic. */
  match: RegExp;
  title: string;
  summary: string;
}

const CAPABILITY_FOLLOW_UPS: Array<{ label: string; prompt: string }> = [
  { label: "Add a new account", prompt: "Add a new account" },
  { label: "Update account details", prompt: "Update account details" },
  { label: "Set up a meeting", prompt: "Set up a meeting" },
];

const SHOWCASE_TITLE = "What you can do with the Atelier assistant";
const SHOWCASE_SUMMARY = [
  "In the full product, you can simply type what you need and the assistant does it for you — with a review step before anything is saved. For example:",
  "",
  "• Add a new account — \"Create an account for Acme Industries in the UAE\"",
  "• Update account details — \"Set Acme's annual revenue to $40M\"",
  "• Update documents — \"Attach this proposal to the Acme engagement\"",
  "• Set up meetings — \"Book a catch up with Sara next Tuesday at 10am\"",
  "• Log expenses — \"Log a $42 taxi receipt from yesterday's client visit\"",
  "• Fill timesheets — \"Log 6 hours on the Acme engagement for Monday\"",
  "",
  "This demo account is read-only, so the assistant shows you what it would do without changing any data.",
].join("\n");

const TOPICS: ShowcaseTopic[] = [
  {
    match: /account/i,
    title: "Accounts via chat",
    summary:
      "In the full product you'd say things like \"Create an account for Acme Industries\" or \"Update Acme's industry to manufacturing\" — the assistant researches the company, drafts the record, and asks you to confirm before saving. The demo account is read-only, so account changes are disabled here.",
  },
  {
    match: /document|file|upload|attach/i,
    title: "Documents via chat",
    summary:
      "In the full product you can upload contracts, proposals and briefs, link them to accounts or engagements, and ask questions about their contents. The demo account is read-only, so document changes are disabled here.",
  },
  {
    match: /meeting|calendar|schedule|catch\s*up/i,
    title: "Meetings via chat",
    summary:
      "In the full product you'd say \"Book a catch up with Sara next Tuesday at 10am\" — the assistant checks availability, sends real invites, and the meeting lands on your calendar. Your demo calendar already shows a few sample \"Catch up\" meetings. Booking is disabled for the read-only demo account.",
  },
  {
    match: /expense|receipt|reimburse/i,
    title: "Expenses via chat",
    summary:
      "In the full product you can snap a receipt photo and the assistant reads it, categorises it and drafts the claim for you. Your demo Expenses page shows a few sample claims. Submitting new expenses is disabled for the read-only demo account.",
  },
  {
    match: /timesheet|hours|time\s*entry/i,
    title: "Timesheets via chat",
    summary:
      "In the full product you'd say \"Log 6 hours on the Acme engagement for Monday\" and the assistant fills your weekly timesheet. Timesheet writes are disabled for the read-only demo account.",
  },
];

/**
 * Emit a complete, deterministic SSE turn for the demo persona. The
 * caller has already opened the SSE stream and validated the prompt.
 */
export function runDemoShowcaseTurn(
  prompt: string,
  emit: (frame: CliFrame) => void,
): void {
  const topic = TOPICS.find((t) => t.match.test(prompt));
  const isCapabilityQuestion =
    /what\s+can|show\s+me|help|capabilit|what\s+do/i.test(prompt);
  const card =
    topic && !isCapabilityQuestion
      ? {
          title: topic.title,
          summary: topic.summary,
          followUps: CAPABILITY_FOLLOW_UPS,
        }
      : {
          title: SHOWCASE_TITLE,
          summary: SHOWCASE_SUMMARY,
          followUps: CAPABILITY_FOLLOW_UPS,
        };
  emit({
    type: "final",
    data: {
      status: "success",
      turnId: `demo_${Date.now().toString(36)}`,
      sessionId: null,
      result: card,
    },
  });
}
