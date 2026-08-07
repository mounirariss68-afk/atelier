/**
 * Task #568 — chat scheduling for CLIENT meetings.
 *
 * "Schedule a meeting with Rania about the Tasama BPO opportunity next
 * Tuesday at 10" — resolves the CRM parent (opportunity or engagement,
 * with disambiguation; account-only references disambiguate across that
 * account's live opportunities/engagements), resolves client contacts by
 * name scoped to the parent's account (email required — the invite is
 * real), optional roster colleagues, checks INTERNAL availability only
 * (client calendars can't be read), previews via the standard two-phase
 * confirm, then books a real Outlook invite from the requester's own
 * Microsoft account and records the meeting on the parent so it appears
 * in the existing meetings surfaces.
 *
 * Out of scope: recurring meetings (say so honestly), rooms.
 */
import { and, eq, ilike, isNull } from "drizzle-orm";
import {
  db,
  atelierMeetings,
  atelierAuditEvents,
  atelierAccounts,
  atelierContacts,
  atelierEngagements,
  atelierOpportunities,
} from "@workspace/db";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { rid } from "./index.js";
import { resolveAccount, resolveContact } from "./resolvers/index.js";
import { resolveRosterAttendees } from "./meeting-attendee-resolver.js";
import { rankNearestNames } from "./nearest-suggestions.js";
import { normalizeLocationAnswer, normalizeTimeInput } from "./chat-normalizers.js";
import {
  buildDuplicateWarning,
  findSameSlotMeetings,
  isPastSlot,
  pickReplayMatch,
} from "./meeting-reliability.js";
import type { CliPersona } from "./index.js";
import {
  SchedulingError,
  WORK_END_HOUR,
  WORK_START_HOUR,
  collectBusyTimes,
  dubaiWallToUtc,
  findEarliestCommonSlot,
  fmtDubai,
  cancelInternalInvite,
  sendInternalInvite,
  type AvailabilityPerson,
} from "../msScheduling.js";

import type { AtelierRole } from "../../routes/atelier/personaRoles.js";

const SCHEDULER_ROLES: AtelierRole[] = [
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
];

const MEETING_KINDS = ["discovery", "workshop", "steering", "kickoff"] as const;

interface ResolvedParent {
  kind: "opportunity" | "engagement";
  id: string;
  name: string;
  accountId: string;
  accountName: string;
}

type ParentOutcome =
  | { parent: ResolvedParent }
  | { result: { ok: boolean; [k: string]: unknown } };

async function engAcl(persona: CliPersona) {
  return accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);
}

async function accountNameOf(accountId: string, orgId: string): Promise<string> {
  const [acc] = await db
    .select({ name: atelierAccounts.name })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, accountId), eq(atelierAccounts.orgId, orgId)))
    .limit(1);
  return acc?.name ?? accountId;
}

/**
 * Resolve the CRM parent from whichever reference the user gave:
 * parentRef ("opportunity:<id>" | "engagement:<id>", from disambiguation),
 * opportunityName, engagementName, or accountName (disambiguates across
 * the account's live opportunities + engagements). ACL mirrors REST.
 */
async function resolveClientMeetingParent(
  persona: CliPersona,
  input: Record<string, unknown>,
): Promise<ParentOutcome> {
  const access = await engAcl(persona);
  const me = { id: persona.id };

  const deny: ParentOutcome = {
    result: {
      ok: false,
      errorCode: "forbidden",
      errorMessage: "That account is outside your engagement scope.",
    },
  };

  const parentRef = typeof input.parentRef === "string" ? input.parentRef.trim() : "";
  if (parentRef) {
    const [kind, id] = parentRef.split(":", 2);
    if ((kind === "opportunity" || kind === "engagement") && id) {
      if (kind === "opportunity") {
        const [opp] = await db
          .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, accountId: atelierOpportunities.accountId })
          .from(atelierOpportunities)
          .where(and(eq(atelierOpportunities.id, id), eq(atelierOpportunities.orgId, persona.orgId), isNull(atelierOpportunities.deletedAt)))
          .limit(1);
        if (!opp) return { result: { ok: false, errorCode: "not_found", errorMessage: "That opportunity no longer exists." } };
        if (!(await canSeeAccount(access, me, opp.accountId))) return deny;
        return { parent: { kind: "opportunity", id: opp.id, name: opp.name, accountId: opp.accountId, accountName: await accountNameOf(opp.accountId, persona.orgId) } };
      }
      const [eng] = await db
        .select({ id: atelierEngagements.id, name: atelierEngagements.name, accountId: atelierEngagements.accountId })
        .from(atelierEngagements)
        .where(and(eq(atelierEngagements.id, id), eq(atelierEngagements.orgId, persona.orgId), isNull(atelierEngagements.deletedAt)))
        .limit(1);
      if (!eng) return { result: { ok: false, errorCode: "not_found", errorMessage: "That engagement no longer exists." } };
      const engOk = access.all === true || access.ids.has(eng.id) || (await canSeeAccount(access, me, eng.accountId));
      if (!engOk) return deny;
      return { parent: { kind: "engagement", id: eng.id, name: eng.name, accountId: eng.accountId, accountName: await accountNameOf(eng.accountId, persona.orgId) } };
    }
    return { result: { ok: false, errorCode: "invalid_input", errorMessage: "parentRef must look like opportunity:<id> or engagement:<id>." } };
  }

  const oppQuery = typeof input.opportunityName === "string" ? input.opportunityName.trim() : "";
  if (oppQuery.length >= 2) {
    const rows = await db
      .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, accountId: atelierOpportunities.accountId })
      .from(atelierOpportunities)
      .where(and(ilike(atelierOpportunities.name, `%${oppQuery}%`), eq(atelierOpportunities.orgId, persona.orgId), isNull(atelierOpportunities.deletedAt)))
      .limit(10);
    const visible = (
      await Promise.all(rows.map(async (r) => ((await canSeeAccount(access, me, r.accountId)) ? r : null)))
    ).filter((r): r is NonNullable<typeof r> => r !== null);
    if (visible.length === 0) {
      return { result: { ok: false, errorCode: "not_found", errorMessage: `I couldn't find an opportunity matching "${oppQuery}" that you can see.` } };
    }
    if (visible.length > 1) {
      const options = visible.slice(0, 5).map((r) => ({ id: `opportunity:${r.id}`, label: r.name }));
      return {
        result: {
          ok: true,
          data: { prompt: `Which opportunity did you mean by "${oppQuery}"?`, options },
          disambiguation: { kind: "opportunity", options, field: "parentRef" },
        },
      };
    }
    const r = visible[0]!;
    return { parent: { kind: "opportunity", id: r.id, name: r.name, accountId: r.accountId, accountName: await accountNameOf(r.accountId, persona.orgId) } };
  }

  const engQuery = typeof input.engagementName === "string" ? input.engagementName.trim() : "";
  if (engQuery.length >= 2) {
    const rows = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name, accountId: atelierEngagements.accountId })
      .from(atelierEngagements)
      .where(and(ilike(atelierEngagements.name, `%${engQuery}%`), eq(atelierEngagements.orgId, persona.orgId), isNull(atelierEngagements.deletedAt)))
      .limit(10);
    const visible = (
      await Promise.all(
        rows.map(async (r) =>
          access.all === true || access.ids.has(r.id) || (await canSeeAccount(access, me, r.accountId)) ? r : null,
        ),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null);
    if (visible.length === 0) {
      return { result: { ok: false, errorCode: "not_found", errorMessage: `I couldn't find an engagement matching "${engQuery}" that you can see.` } };
    }
    if (visible.length > 1) {
      const options = visible.slice(0, 5).map((r) => ({ id: `engagement:${r.id}`, label: r.name }));
      return {
        result: {
          ok: true,
          data: { prompt: `Which engagement did you mean by "${engQuery}"?`, options },
          disambiguation: { kind: "engagement", options, field: "parentRef" },
        },
      };
    }
    const r = visible[0]!;
    return { parent: { kind: "engagement", id: r.id, name: r.name, accountId: r.accountId, accountName: await accountNameOf(r.accountId, persona.orgId) } };
  }

  const accQuery = typeof input.accountName === "string" ? input.accountName.trim() : "";
  if (accQuery.length >= 2) {
    const acc = await resolveAccount(accQuery, persona);
    if (acc.kind === "none") {
      return { result: { ok: false, errorCode: "not_found", errorMessage: `I couldn't find an account matching "${accQuery}".` } };
    }
    if (acc.kind === "choices") {
      return {
        result: {
          ok: true,
          data: { prompt: acc.prompt, options: acc.options },
          disambiguation: { kind: "account", options: acc.options, field: "accountName" },
        },
      };
    }
    if (!(await canSeeAccount(access, me, acc.id))) return deny;
    // Client meetings hang off an opportunity or engagement — gather the
    // account's live ones and disambiguate when there's more than one.
    const opps = await db
      .select({ id: atelierOpportunities.id, name: atelierOpportunities.name })
      .from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.accountId, acc.id), eq(atelierOpportunities.orgId, persona.orgId), isNull(atelierOpportunities.deletedAt)))
      .limit(10);
    const engs = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name })
      .from(atelierEngagements)
      .where(and(eq(atelierEngagements.accountId, acc.id), eq(atelierEngagements.orgId, persona.orgId), isNull(atelierEngagements.deletedAt)))
      .limit(10);
    const candidates = [
      ...opps.map((o) => ({ ref: `opportunity:${o.id}` as const, label: `${o.name} (opportunity)` })),
      ...engs.map((e) => ({ ref: `engagement:${e.id}` as const, label: `${e.name} (engagement)` })),
    ];
    if (candidates.length === 0) {
      return {
        result: {
          ok: false,
          errorCode: "no_parent",
          errorMessage: `${acc.label} has no live opportunity or engagement to attach a client meeting to. Create an opportunity first and I can schedule against it.`,
        },
      };
    }
    if (candidates.length > 1) {
      const options = candidates.slice(0, 5).map((c) => ({ id: c.ref, label: c.label }));
      return {
        result: {
          ok: true,
          data: { prompt: `Which ${acc.label} work should this meeting attach to?`, options },
          disambiguation: { kind: "meeting_parent", options, field: "parentRef" },
        },
      };
    }
    const only = candidates[0]!;
    return resolveClientMeetingParent(persona, { parentRef: only.ref });
  }

  return {
    result: {
      ok: false,
      errorCode: "invalid_input",
      errorMessage: "Tell me which account, opportunity, or engagement this client meeting is about.",
    },
  };
}

defineCapability({
  id: "meeting.schedule_client",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "schedule_client_meeting",
  description:
    "Schedule a ONE-OFF client meeting attached to an account, opportunity, or engagement: resolves the CRM parent and the client contacts by name (contact email required — a real Outlook invite is sent from your Microsoft account, Teams link when online), optionally adds roster colleagues, checks INTERNAL availability only (client calendars can't be read), and records the meeting on the parent so it shows up in meeting lists and briefs. Date must be an absolute YYYY-MM-DD. Recurring/repeating meetings are NOT supported — say so honestly instead of booking a single occurrence.",
  slashAliases: { en: ["/client-meeting"], fr: ["/reunion-client"] },
  inputSchema: {
    type: "object",
    properties: {
      contacts: {
        type: "array",
        items: { type: "string" },
        description: "Client contact names (CRM contacts on the parent's account).",
      },
      colleagues: {
        type: "array",
        items: { type: "string" },
        description: "Optional roster colleagues to include, excluding the requester.",
      },
      accountName: { type: "string", description: "Account the meeting is about (when no specific opportunity/engagement named)." },
      opportunityName: { type: "string", description: "Opportunity the meeting attaches to." },
      engagementName: { type: "string", description: "Engagement the meeting attaches to." },
      parentRef: { type: "string", description: "Exact parent from disambiguation: opportunity:<id> or engagement:<id>." },
      date: { type: "string", description: "YYYY-MM-DD (Dubai)." },
      time: { type: "string", description: "Optional explicit start time HH:MM (Dubai). Omit to find the earliest free slot for the internal side." },
      durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
      topic: { type: "string", maxLength: 200 },
      agenda: {
        type: "string",
        maxLength: 2000,
        description: "Optional agenda / description — included in the invite body.",
      },
      kind: { enum: [...MEETING_KINDS], description: "Meeting kind; defaults to discovery." },
      locationType: { enum: ["online", "in_person"] },
      confirm: { type: "boolean" },
    },
    required: ["contacts", "date"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  examplePhrases: {
    en: [
      "Schedule a meeting with Rania about the Tasama BPO opportunity next Tuesday at 10",
      "Set up a discovery call with Ahmed from Al Noor for Friday morning",
      "/client-meeting kickoff with Sara on the GovTech engagement 2026-08-03 14:00",
    ],
  },
  twoPhaseConfirm: true,
  // Invite goes out via the requester's own Microsoft calendar (Graph),
  // not the firm's rate-limited mailer.
  outboundChannel: null,
  resultCard: "meeting_card",
  async run(input, ctx) {
    const contactNames = Array.isArray(input.contacts)
      ? input.contacts.map((n) => String(n).trim()).filter(Boolean)
      : [];
    if (contactNames.length === 0) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "At least one client contact name is required." };
    }
    const dateStr = String(input.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage: "date must be YYYY-MM-DD — resolve relative dates against today's date first.",
      };
    }
    const durationMin = Math.max(15, Math.min(480, Number(input.durationMinutes ?? 60)));
    const topic = typeof input.topic === "string" ? input.topic.trim() : "";
    const agenda = typeof input.agenda === "string" ? input.agenda.trim().slice(0, 2000) : "";
    const kind = MEETING_KINDS.includes(input.kind as (typeof MEETING_KINDS)[number])
      ? (input.kind as (typeof MEETING_KINDS)[number])
      : "discovery";
    // Task #570 — tolerant location parsing (shared with internal tool).
    const locationType = normalizeLocationAnswer(input.locationType);

    // ---- parent (opportunity/engagement, disambiguated) ----
    const parentOutcome = await resolveClientMeetingParent(ctx.persona, input);
    if ("result" in parentOutcome) return parentOutcome.result as never;
    const parent = parentOutcome.parent;

    // ---- client contacts, scoped to the parent's account ----
    const clientContacts: Array<{ id: string; name: string; email: string }> = [];
    for (const name of contactNames) {
      const res = await resolveContact(name, ctx.persona, { accountId: parent.accountId });
      if (res.kind === "none") {
        // Task #782 — friendly miss: offer the account's actual contacts
        // (closest names first) instead of a dead-end.
        const accountContacts = await db
          .select({
            id: atelierContacts.id,
            name: atelierContacts.fullName,
            email: atelierContacts.email,
          })
          .from(atelierContacts)
          .where(
            and(
              eq(atelierContacts.orgId, ctx.persona.orgId),
              eq(atelierContacts.accountId, parent.accountId),
              isNull(atelierContacts.deletedAt),
            ),
          )
          .limit(50);
        const pool = accountContacts.map((c) => ({
          id: c.id,
          label: c.name ?? c.email ?? c.id,
          secondary: c.email ?? undefined,
        }));
        const nearest = rankNearestNames(name, pool);
        if (nearest.length > 0) {
          return {
            ok: true,
            data: {
              prompt: `I couldn't find a contact named "${name}" at ${parent.accountName} — did you mean one of these?`,
              options: nearest,
            },
            disambiguation: { kind: "contact", options: nearest },
          };
        }
        // No plausibly-close contact: friendly copy with a genuine next
        // step (name a few real contacts in prose — never as pick-one
        // options, since none of them plausibly match what was typed).
        const sample = pool
          .slice(0, 3)
          .map((c) => c.label)
          .filter(Boolean);
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage:
            sample.length > 0
              ? `I couldn't find a contact named "${name}" at ${parent.accountName}. Contacts there include ${sample.join(", ")} — or add "${name}" as a contact on the account first and I'll invite them properly.`
              : `I couldn't find a contact named "${name}" at ${parent.accountName} — there are no contacts on that account yet. Add them as a contact first and I'll invite them properly.`,
        };
      }
      if (res.kind === "choices") {
        return {
          ok: true,
          data: { prompt: res.prompt, options: res.options },
          disambiguation: { kind: "contact", options: res.options },
        };
      }
      const [row] = await db
        .select({ id: atelierContacts.id, name: atelierContacts.fullName, email: atelierContacts.email })
        .from(atelierContacts)
        .where(and(eq(atelierContacts.id, res.id), eq(atelierContacts.orgId, ctx.persona.orgId)))
        .limit(1);
      if (!row) {
        return { ok: false, errorCode: "not_found", errorMessage: `Contact "${name}" no longer exists.` };
      }
      if (!row.email) {
        return {
          ok: false,
          errorCode: "missing_email",
          errorMessage: `${row.name ?? name} has no email on file — add one to their contact record first, the invite is a real Outlook invite.`,
        };
      }
      if (!clientContacts.some((c) => c.id === row.id)) {
        clientContacts.push({ id: row.id, name: row.name ?? name, email: row.email });
      }
    }

    // ---- optional roster colleagues (never self) ----
    const colleagueNames = Array.isArray(input.colleagues)
      ? input.colleagues.map((n) => String(n).trim()).filter(Boolean)
      : [];
    // Task #570 — shared accent-insensitive resolver ("gokhan" finds
    // "Gökhan Güney"); raw email addresses are refused gracefully.
    const colleagueResolution = await resolveRosterAttendees(colleagueNames, ctx.persona);
    if (colleagueResolution.kind === "result") return colleagueResolution.result as never;
    const colleagues: AvailabilityPerson[] = colleagueResolution.people;

    // ---- clarifications: topic then online/in-person ----
    const partial = {
      contacts: clientContacts.map((c) => c.name),
      colleagues: colleagues.map((c) => c.name),
      parentRef: `${parent.kind}:${parent.id}`,
      date: dateStr,
      time: typeof input.time === "string" ? input.time : undefined,
      durationMinutes: durationMin,
      kind,
      topic: topic || undefined,
      agenda: agenda || undefined,
      locationType: locationType ?? undefined,
    };
    if (!topic) {
      return {
        ok: true,
        data: { partial },
        clarification: {
          field: "topic",
          question: "What's the meeting about? I'll use it as the invite subject.",
          tool: "schedule_client_meeting",
          partial,
        },
      };
    }
    if (!locationType) {
      return {
        ok: true,
        data: { partial },
        clarification: {
          field: "locationType",
          question: 'Should this be online (Teams link) or in person? Reply "online" or "in person".',
          tool: "schedule_client_meeting",
          partial,
        },
      };
    }

    // ---- slot: explicit time OR earliest internal availability.
    // Client calendars can't be read — availability covers the internal
    // side only, and the preview says so. ----
    const timeRaw = typeof input.time === "string" ? input.time.trim() : "";
    const timeStr = timeRaw ? normalizeTimeInput(timeRaw) ?? timeRaw : "";
    let slotStart: Date;
    let slotEnd: Date;
    let availabilityNote = "";
    const internalPeople: AvailabilityPerson[] = [
      { userId: ctx.persona.id, name: ctx.persona.name, email: "" },
      ...colleagues,
    ];
    if (timeStr) {
      const s = dubaiWallToUtc(dateStr, timeStr);
      if (!s) {
        return { ok: false, errorCode: "invalid_input", errorMessage: `Couldn't parse the time "${timeRaw}" — try something like "8am", "08:00" or "14:30".` };
      }
      // Task #570 — reject times that are already in the past.
      if (isPastSlot(s)) {
        return {
          ok: false,
          errorCode: "past_time",
          errorMessage: `${fmtDubai(s)} (Dubai) is already in the past — give me a future date/time and I'll book it.`,
        };
      }
      slotStart = s;
      slotEnd = new Date(s.getTime() + durationMin * 60 * 1000);
      const avail = await collectBusyTimes({ people: internalPeople, windowStart: slotStart, windowEnd: slotEnd });
      const conflict = avail.checked.length > 0 && avail.busy.some((b) => b.start < slotEnd && b.end > slotStart)
        ? " Note: someone on your side already has something on their calendar at that time."
        : "";
      availabilityNote = conflict;
    } else {
      const windowStart = dubaiWallToUtc(dateStr, `${String(WORK_START_HOUR).padStart(2, "0")}:00`)!;
      const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 3600 * 1000);
      const avail = await collectBusyTimes({ people: internalPeople, windowStart, windowEnd });
      const slot = findEarliestCommonSlot({
        busy: avail.busy,
        durationMin,
        earliest: new Date(Math.max(windowStart.getTime(), Date.now())),
        latest: windowEnd,
      });
      if (!slot) {
        return {
          ok: false,
          errorCode: "no_slot",
          errorMessage: `I couldn't find a free ${durationMin}-minute slot on your side between ${WORK_START_HOUR}:00 and ${WORK_END_HOUR}:00 (Dubai) in the week from ${dateStr}. Try a specific time and I'll book it anyway.`,
        };
      }
      slotStart = slot.start;
      slotEnd = slot.end;
    }
    availabilityNote =
      "I can only check availability on your side — the client's calendar isn't visible." + availabilityNote;

    // ---- two-phase confirm ----
    const clientNames = clientContacts.map((c) => c.name).join(", ");
    const colleagueLabel = colleagues.length > 0 ? ` plus ${colleagues.map((c) => c.name).join(", ")}` : "";
    const whenLabel = `${fmtDubai(slotStart)}–${fmtDubai(slotEnd).slice(-5)} (Dubai)`;
    // Task #570 — duplicate-booking awareness + idempotent confirm replay.
    const sameSlot = await findSameSlotMeetings(ctx.persona.orgId, slotStart);
    if (input.confirm !== true) {
      availabilityNote += buildDuplicateWarning(sameSlot, {
        title: topic,
        attendeeUserIds: colleagues.map((c) => c.userId),
      });
      return {
        ok: true,
        data: {
          preview: {
            topic,
            kind,
            parent: { kind: parent.kind, id: parent.id, name: parent.name, account: parent.accountName },
            clients: clientContacts.map((c) => ({ name: c.name, email: c.email })),
            colleagues: colleagues.map((c) => ({ name: c.name, email: c.email })),
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            whenLabel,
            locationType,
            note: availabilityNote,
          },
        },
        confirmation: {
          summary:
            `Book "${topic}" with ${clientNames} (${parent.accountName})${colleagueLabel} — ${whenLabel}, ` +
            `${locationType === "online" ? "online (Teams)" : "in person"}, attached to ${parent.kind} "${parent.name}". ` +
            `A calendar invite will be sent from your Microsoft account. ${availabilityNote}`,
          diff: {
            create: {
              table: "atelier_meetings",
              values: {
                title: topic,
                kind,
                parent: `${parent.kind}:${parent.name}`,
                attendees: [clientNames, colleagues.map((c) => c.name).join(", ")].filter(Boolean).join(", "),
                start: slotStart.toISOString(),
                locationType,
              },
            },
          },
          pending: {
            tool: "schedule_client_meeting",
            input: {
              contacts: clientContacts.map((c) => c.name),
              colleagues: colleagues.map((c) => c.name),
              parentRef: `${parent.kind}:${parent.id}`,
              // The PROPOSED slot's Dubai date/time — confirm rebooks
              // exactly what was previewed.
              date: fmtDubai(slotStart).slice(0, 10),
              time: `${fmtDubai(slotStart).slice(-5)}`,
              durationMinutes: durationMin,
              kind,
              topic,
              ...(agenda ? { agenda } : {}),
              locationType,
              confirm: true,
            },
          },
        },
      };
    }

    // ---- commit: idempotency first — a replayed confirm (double-tap /
    // retried request) must NOT send a second Outlook invite. ----
    const replay = pickReplayMatch(sameSlot, {
      createdByUserId: ctx.persona.id,
      title: topic,
      parentType: parent.kind,
    });
    if (replay) {
      return {
        ok: true,
        data: {
          meeting: {
            id: replay.id,
            title: replay.title,
            date: fmtDubai(slotStart).slice(0, 10),
            kind,
            status: "scheduled",
            startAt: slotStart.toISOString(),
            endAt: replay.endAt?.toISOString() ?? slotEnd.toISOString(),
            whenLabel,
            locationType: replay.locationType ?? locationType,
            joinUrl: replay.joinUrl,
            summary: "Already booked — this confirmation was a repeat, so no second invite was sent.",
            decisions: [],
            actionItems: [],
          },
          parent: { kind: parent.kind, id: parent.id, name: parent.name },
          href: parent.kind === "opportunity" ? `/accounts/${parent.accountId}?tab=opportunities` : `/engagements/${parent.id}`,
          navigateTo: null,
        },
      };
    }

    // ---- commit: send the invite, then persist the meeting on the parent ----
    let eventId: string | null = null;
    let eventUid: string | null = null;
    let joinUrl: string | null = null;
    let webLink: string | null = null;
    try {
      const { event } = await sendInternalInvite({
        requesterUserId: ctx.persona.id,
        subject: topic,
        bodyText: agenda
          ? `Agenda:\n${agenda}\n\nClient meeting on ${parent.accountName} scheduled via the Atelier by ${ctx.persona.name}.`
          : `Client meeting on ${parent.accountName} (${parent.kind} "${parent.name}") scheduled via the Atelier by ${ctx.persona.name}.`,
        start: slotStart,
        end: slotEnd,
        attendees: [
          ...clientContacts.map((c) => ({ email: c.email, name: c.name })),
          ...colleagues.map((c) => ({ email: c.email, name: c.name })),
        ],
        online: locationType === "online",
      });
      eventId = event.id;
      eventUid = event.iCalUId ?? null;
      joinUrl = event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? null;
      webLink = event.webLink ?? null;
    } catch (err) {
      if (err instanceof SchedulingError) {
        return { ok: false, errorCode: `ms_${err.code}`, errorMessage: err.message };
      }
      throw err;
    }

    const id = rid("mtg");
    try {
      await db.insert(atelierMeetings).values({
        id,
        orgId: ctx.persona.orgId,
        parentType: parent.kind,
        parentId: parent.id,
        mode: "scheduled",
        kind,
        title: topic,
        date: fmtDubai(slotStart).slice(0, 10),
        startAt: slotStart,
        endAt: slotEnd,
        locationType,
        joinUrl,
        webLink,
        msEventId: eventId,
        msEventUid: eventUid,
        attendees: [...clientContacts.map((c) => c.name), ...colleagues.map((c) => c.name), ctx.persona.name],
        internalAttendees: colleagues.map((c) => ({ userId: c.userId, name: c.name, email: c.email })),
        status: "scheduled",
        createdByUserId: ctx.persona.id,
      });
    } catch (err) {
      // Task #570 — never leave an orphaned Outlook event: if the Atelier
      // row can't be written, best-effort delete the Graph event we just
      // created and fail loudly.
      if (eventId) {
        try {
          await cancelInternalInvite({
            organizerUserId: ctx.persona.id,
            actingUserId: ctx.persona.id,
            msEventId: eventId,
          });
        } catch {
          /* best-effort cleanup */
        }
      }
      return {
        ok: false,
        errorCode: "internal",
        errorMessage:
          "The Outlook invite couldn't be recorded in the Atelier, so I removed it from your calendar again — nothing was booked. Please try once more.",
      };
    }
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "meeting",
      entityId: id,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "meeting.scheduled.cli",
      payload: {
        topic,
        ...(agenda ? { agenda } : {}),
        kind,
        parentType: parent.kind,
        parentId: parent.id,
        accountId: parent.accountId,
        clients: clientContacts.map((c) => c.name),
        colleagues: colleagues.map((c) => c.name),
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        locationType,
        msEventId: eventId,
        viaCli: true,
        turnId: ctx.turnId,
      },
      payloadSummary: `${ctx.persona.name} scheduled client meeting "${topic}" with ${clientNames} on ${parent.kind} "${parent.name}" (${whenLabel}).`,
    });

    return {
      ok: true,
      data: {
        meeting: {
          id,
          title: topic,
          date: fmtDubai(slotStart).slice(0, 10),
          kind,
          status: "scheduled",
          attendees: [...clientContacts.map((c) => c.name), ...colleagues.map((c) => c.name)],
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          whenLabel,
          locationType,
          joinUrl,
          summary: `Invite sent from your Microsoft account to ${clientNames}${colleagueLabel}.`,
          decisions: [],
          actionItems: [],
        },
        parent: { kind: parent.kind, id: parent.id, name: parent.name },
        href: parent.kind === "opportunity" ? `/accounts/${parent.accountId}?tab=opportunities` : `/engagements/${parent.id}`,
        navigateTo: null,
      },
    };
  },
});
