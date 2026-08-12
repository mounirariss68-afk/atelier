/**
 * Task #795 — chat-parity registry for /me self-service actions.
 *
 * Every MUTATING /me route must appear here, either:
 *   - mapped to the chat capability id that covers it, or
 *   - explicitly EXCLUDED with a reason + the real UI location(s) where
 *     the action lives (per platform), so chat can give an honest,
 *     platform-aware answer instead of inventing a workaround or a
 *     generic "not available in this interface" dead-end.
 *
 * Enforced by `lintMeChatParity` (src/scripts/atelier-lint-routes.ts) +
 * the cli-catalog suite: a new mutating /me route that ships without a
 * registry entry FAILS the build, so the parity gap can never silently
 * reopen. The honest-refusal prompt copy for excluded actions is
 * generated from this registry (`selfServiceExclusionGuidance`) — a
 * single source of truth for what chat says.
 *
 * PURE MODULE — no db/app imports (the lint script loads it directly).
 */

export type MeParityEntry =
  | { kind: "capability"; capability: string }
  | {
      kind: "excluded";
      /** Why chat deliberately does not do this (for maintainers). */
      reason: string;
      /** User-facing phrase for the action ("change your bank details"). */
      userLabel: string;
      /** Where to do it on the web portal, or null if web has no UI. */
      web: string | null;
      /** Where to do it in the mobile app, or null if mobile has no UI. */
      mobile: string | null;
    };

const cap = (capability: string): MeParityEntry => ({ kind: "capability", capability });
const excluded = (e: Omit<Extract<MeParityEntry, { kind: "excluded" }>, "kind">): MeParityEntry => ({
  kind: "excluded",
  ...e,
});

/**
 * Keyed exactly as the route appears in source: `METHOD /path` with the
 * Express param names kept verbatim.
 */
export const ME_CHAT_PARITY: Record<string, MeParityEntry> = {
  // ---- leave -------------------------------------------------------
  "post /me/leave": cap("me.leave_request"),
  "post /me/leave/:id/cancel": cap("me.leave_cancel"),

  // ---- expenses ----------------------------------------------------
  "post /me/expenses": cap("me.expense_create"),
  "patch /me/expenses/:id": cap("me.expense_update"),
  "delete /me/expenses/:id": cap("me.expense_delete"),
  "post /me/expenses/:id/submit": cap("me.expense_submit"),
  "post /me/expenses/receipt-upload": excluded({
    reason: "signed-URL upload plumbing; chat has its own receipt-attachment flow",
    userLabel: "upload a receipt file for an existing expense",
    web: "Me → Expenses (open the claim and attach the receipt)",
    mobile: "Expenses tab (open the claim and attach the receipt) — or just attach the receipt photo here in chat",
  }),
  "post /me/expenses/:id/parse-receipt": excluded({
    reason: "internal OCR plumbing behind the expense forms; chat parses receipts via its own attachment flow",
    userLabel: "re-run receipt scanning on an expense",
    web: "Me → Expenses (open the claim)",
    mobile: "Expenses tab (open the claim)",
  }),
  "post /me/expenses/:id/parse-receipt-async": excluded({
    reason: "internal async OCR plumbing (mobile launch/poll); chat parses receipts via its own attachment flow",
    userLabel: "re-run receipt scanning on an expense",
    web: "Me → Expenses (open the claim)",
    mobile: "Expenses tab (open the claim)",
  }),

  // ---- letters (Task #845) -------------------------------------------
  "post /me/letters": cap("me.letter_request"),
  "post /me/letters/preview": excluded({
    reason: "internal confirm-step preview plumbing; chat surfaces the same summary via me.letter_request's two-phase confirm",
    userLabel: "preview an employment/salary letter before issuing it",
    web: null,
    mobile: null,
  }),

  // ---- timesheets ----------------------------------------------------
  "post /me/timesheets/:weekId/entries": cap("me.timesheet_log"),
  "post /me/timesheets/:weekId/submit": cap("me.timesheet_submit"),
  "delete /me/timesheets/entries/:entryId": cap("me.timesheet_entry_delete"),
  "post /me/timesheets/:weekId/draft": excluded({
    reason: "runs the Time Steward agent over the whole week; a chat trigger would race the interactive review UI",
    userLabel: "auto-draft your timesheet with the Time Steward",
    web: "Me → Time (Draft my week)",
    mobile: null,
  }),
  "post /me/timesheets/:weekId/entries/:entryId/confirm": excluded({
    reason: "confirming agent-drafted rows needs the side-by-side review grid to be meaningful",
    userLabel: "confirm agent-drafted timesheet rows",
    web: "Me → Time (review the drafted rows)",
    mobile: null,
  }),

  // ---- profile / documents / photo ----------------------------------
  "patch /me/profile": cap("me.profile_update"),
  "put /me/travel": cap("me.travel_profile_save"),
  "post /me/documents": cap("me.document_save"),
  "delete /me/documents/:id": cap("me.document_delete"),
  "patch /me/documents/:id": excluded({
    reason: "detail edits (numbers, expiry dates) are error-prone by voice/typo; the form shows the scanned doc alongside",
    userLabel: "edit the details of a saved ID document",
    web: "Me → Profile (Documents card)",
    mobile: "Me tab → Documents",
  }),
  "post /me/documents/:id/file": excluded({
    reason: "multipart scan replace; chat covers new uploads via save_my_document attachments instead",
    userLabel: "replace the scan file on an existing document",
    web: "Me → Profile (Documents card)",
    mobile: "Me tab → Documents",
  }),
  "post /me/bio": excluded({
    reason: "templated PPTX upload with version review; needs the biography editor",
    userLabel: "upload or update your biography document",
    web: "Me → Profile (Biography card)",
    mobile: null,
  }),
  "post /me/photo": excluded({
    reason: "needs the crop/preview picker to end up with a usable headshot",
    userLabel: "change your profile photo",
    web: "Me → Profile (photo card)",
    mobile: "Me tab → Profile photo",
  }),

  // ---- dependents & emergency contacts -------------------------------
  "post /me/dependents": cap("me.dependent_save"),
  "patch /me/dependents/:id": cap("me.dependent_save"),
  "delete /me/dependents/:id": cap("me.dependent_delete"),
  "post /me/emergency-contacts": cap("me.emergency_contact_save"),
  "patch /me/emergency-contacts/:id": cap("me.emergency_contact_save"),
  "delete /me/emergency-contacts/:id": cap("me.emergency_contact_delete"),

  // ---- personal tasks & reminders (Task #1002) ------------------------
  "post /me/tasks": cap("me.task_create"),
  // PATCH covers edit/complete/snooze/reschedule; chat parity is split
  // across me.task_complete + me.task_reschedule (both hit this route's
  // shared helper). Registered against the complete capability.
  "patch /me/tasks/:id": cap("me.task_complete"),
  "delete /me/tasks/:id": excluded({
    reason: "list housekeeping; completing covers the conversational need — deletion stays a deliberate list action",
    userLabel: "delete a personal task or reminder",
    web: "Me → Tasks",
    mobile: "Me tab → My tasks",
  }),

  // ---- display preferences (Task #827) --------------------------------
  "patch /me/preferences": excluded({
    reason: "trivial per-user UI preference (display currency); a chat write adds risk without conversational value",
    userLabel: "change your display currency preference",
    web: "Me → Expenses (display currency selector)",
    mobile: "Expenses tab (display currency selector)",
  }),

  // ---- device push tokens (Task #1010) --------------------------------
  "post /me/push-tokens": excluded({
    reason: "device plumbing — the token only exists on the phone; chat can't register a device",
    userLabel: "turn on phone push alerts for reminders",
    web: null,
    mobile: "Me tab → My tasks & reminders (Phone alerts toggle)",
  }),
  "delete /me/push-tokens": excluded({
    reason: "device plumbing — the token only exists on the phone; chat can't unregister a device",
    userLabel: "turn off phone push alerts for reminders",
    web: null,
    mobile: "Me tab → My tasks & reminders (Phone alerts toggle)",
  }),

  // ---- learning & notifications --------------------------------------
  "post /me/learning/:id/complete": cap("me.learning_complete"),
  "post /me/notifications/:id/dismiss": cap("me.notification_dismiss"),

  // ---- pay / self-billing (sensitive) ---------------------------------
  "post /me/pay/bank-change-request": excluded({
    reason: "bank-detail changes are fraud-sensitive: they go through the HR-approved change-request flow, never a conversational write",
    userLabel: "change your bank details (IBAN)",
    web: "Me → Pay & Benefits (Request bank change)",
    mobile: null,
  }),
  "post /me/self-billing/:id/dispute": excluded({
    reason: "contractual dispute with financial consequences; needs the invoice detail view",
    userLabel: "dispute a self-billing invoice",
    web: "Me → Pay & Benefits (Self-billing)",
    mobile: null,
  }),
  "post /me/self-billing/:id/withdraw-dispute": excluded({
    reason: "contractual dispute withdrawal; needs the invoice detail view",
    userLabel: "withdraw a self-billing dispute",
    web: "Me → Pay & Benefits (Self-billing)",
    mobile: null,
  }),

  // ---- Microsoft 365 connection & calendar infra ----------------------
  "post /me/msauth/mobile/start": excluded({
    reason: "OAuth handshake must run in a browser/system webview, not a chat turn",
    userLabel: "connect your Microsoft 365 account",
    web: "Me → Overview (Microsoft 365 card)",
    mobile: "Settings tab → Microsoft 365",
  }),
  "delete /me/msconnection": excluded({
    reason: "disconnecting revokes calendar/mail access for every surface; deliberate settings action",
    userLabel: "disconnect your Microsoft 365 account",
    web: "Me → Overview (Microsoft 365 card)",
    mobile: "Settings tab → Microsoft 365",
  }),
  "post /me/calendar/autolog/run": excluded({
    reason: "calendar auto-log administration; background sync tuning, not a conversational action",
    userLabel: "run the calendar meeting auto-log",
    web: "Me → Overview (Microsoft 365 card)",
    mobile: null,
  }),
  "delete /me/calendar/autolog/:logId": excluded({
    reason: "calendar auto-log administration; background sync tuning, not a conversational action",
    userLabel: "remove a calendar auto-log entry",
    web: "Me → Overview (Microsoft 365 card)",
    mobile: null,
  }),
  // Internal-meeting reschedule/cancel already have chat parity.
  "patch /me/calendar/internal/:id": cap("meeting.reschedule_internal"),
  "delete /me/calendar/internal/:id": cap("meeting.cancel_internal"),

  // ---- EA delegation suite (Task #386) ---------------------------------
  // Grant management + partner approve/reject stay web-only (setup and
  // review need the Delegates UI with overlap hints). The EA ASSIST
  // surface (prepare/edit/resubmit items on behalf of a partner) gained
  // chat parity in Task #800 — acting-for context comes only from the
  // caller's own grants, every write carries dual attribution, and the
  // live grant is re-checked per edit.
  "post /me/delegates": excluded({
    reason: "EA delegation grants have dual-attribution + approval semantics unsuited to a chat write",
    userLabel: "set up or manage an assistant (EA) delegation",
    web: "Me → Delegates",
    mobile: null,
  }),
  "patch /me/delegates/:id": excluded({
    reason: "EA delegation edit; see post /me/delegates",
    userLabel: "set up or manage an assistant (EA) delegation",
    web: "Me → Delegates",
    mobile: null,
  }),
  "post /me/delegates/:id/revoke": excluded({
    reason: "EA delegation revoke; see post /me/delegates",
    userLabel: "set up or manage an assistant (EA) delegation",
    web: "Me → Delegates",
    mobile: null,
  }),
  "post /me/delegates/review/:id/approve": excluded({
    reason: "partner review of delegated items; needs the review queue UI",
    userLabel: "approve or reject items your assistant prepared",
    web: "Me → Delegates (review queue)",
    mobile: null,
  }),
  "post /me/delegates/review/:id/reject": excluded({
    reason: "partner review of delegated items; needs the review queue UI",
    userLabel: "approve or reject items your assistant prepared",
    web: "Me → Delegates (review queue)",
    mobile: null,
  }),
  // Task #800 — EA assist prepare/edit/resubmit have chat parity.
  "post /me/assist/:delegationId/items": cap("me.ea_item_submit"),
  "patch /me/assist/items/:id": cap("me.ea_item_update"),
  "post /me/assist/items/:id/resubmit": cap("me.ea_item_resubmit"),
  "post /me/assist/receipt-upload": excluded({
    reason: "signed-URL upload plumbing behind the Assist form; chat-prepared items get receipts attached there",
    userLabel: "attach a receipt file to an assist item prepared for a partner",
    web: "Me → Assist (open the item and attach the receipt)",
    mobile: null,
  }),

  // ---- msauth web flow (non-/me path variants live elsewhere) ---------
};

export function lookupMeParity(method: string, path: string): MeParityEntry | null {
  return ME_CHAT_PARITY[`${method.toLowerCase()} ${path}`] ?? null;
}

/**
 * Honest-refusal prompt copy for the deliberately excluded self-service
 * actions, generated from the registry so chat never invents a
 * workaround or names a place that doesn't exist on the user's
 * platform. Deduped by userLabel (several routes share one action).
 */
export function selfServiceExclusionGuidance(): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of Object.values(ME_CHAT_PARITY)) {
    if (entry.kind !== "excluded") continue;
    if (seen.has(entry.userLabel)) continue;
    seen.add(entry.userLabel);
    const places: string[] = [];
    if (entry.web) places.push(`on the web portal under ${entry.web}`);
    if (entry.mobile) places.push(`in the mobile app under ${entry.mobile}`);
    const where =
      places.length > 0
        ? `Direct the user to do it ${places.join(", or ")}.`
        : "There is currently no self-service UI for this — direct the user to HR.";
    const platformNote =
      entry.web && !entry.mobile
        ? " (web only — do NOT claim the mobile app can do this)"
        : !entry.web && entry.mobile
          ? " (mobile app only — do NOT claim the web portal can do this)"
          : "";
    lines.push(`- To ${entry.userLabel}: not available in chat. ${where}${platformNote}`);
  }
  return [
    "SELF-SERVICE ACTIONS NOT AVAILABLE IN CHAT — when the user asks for one of these,",
    "answer honestly and specifically: say chat cannot do it and name the exact place",
    "below. Never invent an alternative flow, never name internal tools, and never",
    "point to a screen that is not listed for the user's platform.",
    ...lines,
  ].join("\n");
}
