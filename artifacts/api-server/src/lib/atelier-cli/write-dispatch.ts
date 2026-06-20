/**
 * Task #411 — propose_write commit dispatcher.
 *
 * Single source of truth for the (verb, kind) → backing toolName
 * mapping. On `propose_write` commit (`confirm:true`), the
 * orchestrator looks up the typed write capability here and runs it
 * in-process via the same executor (so audit / RLS / writeStepCount
 * stay consistent). Replaces the no-op `stage:"dispatched"` envelope
 * that #406 shipped.
 *
 * IMPORTANT: every entry in `DISPATCH_TABLE` must reference a
 * `toolName` that is actually registered in the catalog for the
 * caller's persona. The startup self-test
 * `assertDispatchTableTargetsExist()` (called from boot) will throw
 * if a mapping points at a non-existent tool — so a typo here fails
 * the server fast instead of silently breaking confirm-time.
 *
 * Adding a new chat-owned kind:
 *   1. Add the kind to `WriteKind` (orchestrator-capabilities.ts).
 *   2. Add a route hint in `ROUTE_HINTS` (orchestrator-capabilities.ts).
 *   3. Add a row here mapping (verb, kind) → an EXISTING capability
 *      `toolName`. The capability must accept `{ ...payload, confirm:true }`
 *      and return its standard `ToolResult` shape.
 *   4. If the target tool's input field names differ from the
 *      generic propose_write payload (e.g. `raid_close` wants
 *      `raidId`, not `id`), add a translator in `PAYLOAD_TRANSLATORS`.
 */

export type DispatchVerb = "create" | "update" | "link" | "transition" | "delete";

/**
 * (verb, kind) → toolName the dispatcher should invoke. Only
 * combinations whose target tool actually exists are listed.
 * Combinations omitted here cause `propose_write` commit to hard-
 * fail with `unsupported_dispatch` and the user-facing route hint.
 *
 * Round-5 audit: removed account.update, contact.create,
 * engagement.create, engagement.update, partner_link.*,
 * deliverable.update, opportunity.update, expense.update — those
 * mappings pointed at `*_v2` / `partner_link_create` /
 * `wallet_update_expense` tools that were never registered. Hard-
 * failing on commit (with a typed errorCode) is the correct
 * behavior for those combinations until typed wrappers land.
 *
 * Round-7: typed wrappers landed in coverage-capabilities.ts for the
 * highest-traffic combos — account.update, contact.create,
 * opportunity.update, deliverable.update, expense.update — so they
 * are restored here. Combos still intentionally omitted (and which
 * therefore stay reachable via their legacy chat-write specialists):
 *   - engagement.create / engagement.update — full charter workflow
 *     (kickoff date, partner lead, scope brief …) lives in
 *     `engagement_open_charter`; a chat wrapper would mis-shape it.
 *   - partner_link.create — there is no `atelier_partner_link` table;
 *     partner relationships are modelled via `atelier_partner_firms`
 *     + opportunity FKs. Listing it would create a phantom kind.
 */
export const DISPATCH_TABLE: Record<string, Partial<Record<DispatchVerb, string>>> = {
  account: {
    create: "account_create",
    update: "account_update",
    delete: "account_delete",
  },
  opportunity: {
    create: "opportunity_create",
    update: "opportunity_update",
    transition: "opportunity_move_stage",
  },
  contact: {
    create: "contact_create",
    update: "contact_update",
    delete: "contact_delete",
  },
  // Task #567 — contact relationship edges (org-chart structure).
  contact_relationship: {
    create: "contact_relationship_create",
    link: "contact_relationship_create",
    delete: "contact_relationship_delete",
  },
  deliverable: {
    create: "engagement_create_deliverable",
    update: "deliverable_update",
  },
  expense: {
    create: "wallet_create_expense",
    update: "expense_update",
  },
  // — 15 new entities for Task #411.
  meeting: {
    // `opportunity_capture_meeting` is upsert-style: when caller
    // supplies a meetingId it patches; otherwise it inserts.
    create: "opportunity_capture_meeting",
    update: "opportunity_capture_meeting",
  },
  raid_item: {
    create: "raid_add",
    // `raid_close` is the only typed mutating verb on a RAID row;
    // expects { raidId, mitigation? }, so the dispatcher payload
    // translator below remaps `id` → `raidId`.
    update: "raid_close",
  },
  proposal: {
    create: "proposal_compose",
    update: "proposal_update",
  },
  pov: {
    create: "opportunity_draft_pov",
    update: "pov_update",
  },
  change_order: {
    create: "change_order_propose",
    update: "change_order_update",
  },
  timesheet_entry: {
    create: "timesheet_entry_create",
    update: "timesheet_entry_update",
  },
  invoice: {
    create: "invoice_create",
    update: "invoice_update",
  },
  contract: {
    create: "codex_contract_compose",
    update: "contract_update",
  },
  rate_card: {
    create: "rate_card_create",
    update: "rate_card_update",
  },
  renewal: {
    create: "renewal_create",
    update: "renewal_update",
  },
  partner_firm: {
    create: "partner_firm_create",
    update: "partner_firm_update",
  },
  win_theme: {
    create: "win_theme_create",
    update: "win_theme_update",
  },
  win_loss_debrief: {
    create: "win_loss_debrief_create",
    update: "win_loss_debrief_update",
  },
  brief: {
    create: "brief_create",
    update: "brief_update",
  },
  agent_design: {
    create: "agent_design_create",
    update: "agent_design_update",
  },
};

/**
 * Per-(verb, kind) payload translators. The dispatcher passes the
 * propose_write `payload` straight through by default; when the
 * target tool's required field names differ, register a translator
 * here so commit-time succeeds. Translators run AFTER `id` injection
 * but BEFORE `confirm:true` injection.
 */
type Translator = (payload: Record<string, unknown>, targetId: string | null) => Record<string, unknown>;
const PAYLOAD_TRANSLATORS: Record<string, Partial<Record<DispatchVerb, Translator>>> = {
  raid_item: {
    update: (payload, targetId) => {
      const out: Record<string, unknown> = { ...payload };
      const id = (typeof payload.id === "string" && payload.id) || targetId || "";
      if (id) out.raidId = id;
      return out;
    },
  },
  // Task #492 — chat-create-account prefill returns a rich payload
  // (strategicPriorities as {text, sourceUrls} objects, plus
  // sourceSignals / decisionMakers / cogniriseHypothesis / refreshedSummary)
  // so the propose_write confirm card can SHOW the research. The
  // backing `account_create` tool only accepts the writable
  // firmographic subset, so strip the display-only fields here. The
  // post-create cartographer auto-run on accountRoutes.ts will
  // re-research and persist the priorities + signals + DMs once the
  // row exists.
  account: {
    create: (payload) => {
      const allowed = new Set([
        "name",
        "country",
        "sector",
        "brandName",
        "hqCity",
        "tier",
        "primaryCurrency",
        "primaryLanguage",
        "partnerOwnerId",
      ]);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (allowed.has(k) && v != null && v !== "") out[k] = v;
      }
      // Cartographer outputs A|B|C only — "D" is reserved for
      // disqualified targets and should never be auto-set by the
      // researcher. Drop anything outside A|B|C to "C" rather than
      // fail account_create's tier enum validation.
      if (out.tier && !["A", "B", "C"].includes(String(out.tier))) {
        out.tier = "C";
      }
      return out;
    },
  },
};

/**
 * Set of kinds with at least one registered dispatch target. Drives
 * the retriever's decommission filter — only kinds the orchestrator
 * can actually commit are stripped from the legacy chat-write
 * surface. Kinds with NO valid dispatch entry stay reachable via
 * their legacy chat-write tools so users are never left without a
 * way to apply the change in chat.
 */
export const CHAT_OWNED_KINDS: ReadonlySet<string> = new Set(
  Object.entries(DISPATCH_TABLE)
    .filter(([, verbs]) => Object.keys(verbs).length > 0)
    .map(([k]) => k),
);

export function dispatchTarget(verb: DispatchVerb, kind: string): string | undefined {
  return DISPATCH_TABLE[kind]?.[verb];
}

export function translateDispatchPayload(
  verb: DispatchVerb,
  kind: string,
  payload: Record<string, unknown>,
  targetId: string | null,
): Record<string, unknown> {
  const t = PAYLOAD_TRANSLATORS[kind]?.[verb];
  return t ? t(payload, targetId) : payload;
}
