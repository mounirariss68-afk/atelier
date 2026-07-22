/**
 * Task #553 — chat scheduling assistant for standalone INTERNAL meetings.
 *
 * "Set up a meeting with Gokhan tomorrow morning at 8:00, general
 * catch-up" — resolves roster attendees (with disambiguation), asks for
 * the topic and online/in-person when missing (clarification), finds the
 * earliest common free slot across connected colleagues' Microsoft 365
 * calendars when no explicit time is given, previews via the standard
 * two-phase confirm, then books: a real Outlook invite from the
 * requester's own Microsoft account (Teams link when online) plus an
 * Atelier internal-meeting record carrying the Graph event id/iCalUId so
 * calendar views and the auto-logger never show it twice.
 *
 * Task #559 adds reschedule/cancel of these meetings (organizer or
 * founding partner) — Graph PATCH/DELETE on the organizer's event so
 * Outlook attendees get standard update/cancellation notices, via the
 * shared lifecycle helpers in `internalMeetingLifecycle.ts`.
 *
 * Out of scope: rooms, recurring meetings, external attendees.
 */
import { and, eq, gte, ilike, inArray, isNull, ne } from "drizzle-orm";
import { db, atelierMeetings, atelierAuditEvents } from "@workspace/db";
import { resolveRosterAttendees } from "./meeting-attendee-resolver.js";
import {
  buildDuplicateWarning,
  findSameSlotMeetings,
  isPastSlot,
  pickReplayMatch,
} from "./meeting-reliability.js";
import {
  MeetingLifecycleError,
  cancelInternalMeeting,
  canManageInternalMeeting,
  rescheduleInternalMeeting,
  updateInternalMeetingDetails,
} from "../internalMeetingLifecycle.js";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { rid } from "./index.js";
import {
  SchedulingError,
  WORK_END_HOUR,
  WORK_START_HOUR,
  cancelInternalInvite,
  collectBusyTimes,
  dubaiWallToUtc,
  findEarliestCommonSlot,
  fmtDubai,
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

interface ResolvedAttendee extends AvailabilityPerson {}

// Task #567 — pure normalization helpers live in the side-effect-free
// ./chat-normalizers.js so lightweight resolvers can use them without
// pulling in this capability-registration module.
import {
  foldRosterName,
  normalizeLocationAnswer,
  normalizeTimeInput,
  LOCATION_SUGGESTIONS,
} from "./chat-normalizers.js";
export { foldRosterName, normalizeLocationAnswer, normalizeTimeInput, LOCATION_SUGGESTIONS };

defineCapability({
  id: "meeting.schedule_internal",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "schedule_internal_meeting",
  description:
    "Schedule a ONE-OFF internal meeting with colleagues: checks their Microsoft 365 availability (when connected), finds the earliest common free slot or uses an explicit time, and on confirm sends a real Outlook calendar invite (Teams link when online). Attendees are roster colleagues by name; date must be an absolute YYYY-MM-DD (resolve relative dates yourself from the current date). Not for client meetings — use schedule_client_meeting for those. Recurring/repeating meetings (e.g. \"every Monday\") are NOT supported — tell the user honestly that recurring series must be set up in Outlook directly; never book only the first occurrence as a workaround unless the user explicitly agrees. Meeting-room booking is also NOT supported — say so honestly rather than pretending a room was reserved.",
  slashAliases: { en: ["/schedule", "/schedule-meeting"], fr: ["/planifier"] },
  inputSchema: {
    type: "object",
    properties: {
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Colleague names (roster), excluding the requester.",
      },
      date: { type: "string", description: "YYYY-MM-DD (Dubai)." },
      time: {
        type: "string",
        description:
          "Optional explicit start time HH:MM (Dubai). Omit to find the earliest common free slot.",
      },
      durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
      topic: { type: "string", maxLength: 200 },
      agenda: {
        type: "string",
        maxLength: 2000,
        description: "Optional agenda / description — included in the invite body.",
      },
      locationType: { enum: ["online", "in_person"] },
      confirm: { type: "boolean" },
    },
    required: ["attendees", "date"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  examplePhrases: {
    en: [
      "Set up a meeting with Gokhan tomorrow morning at 8:00, general catch-up",
      "Find me 30 minutes with Gokhan and Yavuz tomorrow at their earliest availability",
      "/schedule catch-up with Mounir on Friday",
    ],
  },
  twoPhaseConfirm: true,
  // Not the rate-limited email channel — the invite goes out via the
  // requester's own Microsoft calendar (Graph), not the firm's mailer.
  outboundChannel: null,
  resultCard: "meeting_card",
  async run(input, ctx) {
    const names = Array.isArray(input.attendees)
      ? input.attendees.map((n) => String(n).trim()).filter(Boolean)
      : [];
    if (names.length === 0) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "At least one attendee name is required." };
    }
    const dateStr = String(input.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage: "date must be YYYY-MM-DD — resolve relative dates against today's date first.",
      };
    }
    const durationMin = Math.max(15, Math.min(480, Number(input.durationMinutes ?? 30)));
    const topic = typeof input.topic === "string" ? input.topic.trim() : "";
    const agenda = typeof input.agenda === "string" ? input.agenda.trim().slice(0, 2000) : "";
    // Task #567 — tolerant location parsing: "teams"/"virtual" → online,
    // "in person"/"face to face"/"office" → in_person, etc.
    const locationType = normalizeLocationAnswer(input.locationType);

    // ---- attendee resolution (roster users, org-scoped, never self) ----
    // Task #570 — ONE shared accent-insensitive resolver for every
    // meeting surface ("gokhan" finds "Gökhan Güney"; raw emails refused).
    const resolution = await resolveRosterAttendees(names, ctx.persona);
    if (resolution.kind === "result") return resolution.result as never;
    const resolved: ResolvedAttendee[] = resolution.people;
    if (resolved.length === 0) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "At least one attendee name is required." };
    }

    // ---- clarifications: topic then online/in-person ----
    const partial = {
      attendees: resolved.map((r) => r.name),
      date: dateStr,
      time: typeof input.time === "string" ? input.time : undefined,
      durationMinutes: durationMin,
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
          tool: "schedule_internal_meeting",
          partial,
        },
      };
    }
    if (!locationType) {
      // Task #567 — if the user DID answer but we couldn't parse it,
      // re-ask with clearer wording (never the identical framing), and
      // always attach tappable suggestions.
      const rawLoc = typeof input.locationType === "string" ? input.locationType.trim() : "";
      return {
        ok: true,
        data: { partial },
        clarification: {
          field: "locationType",
          question: rawLoc
            ? `Sorry, I didn't recognize "${rawLoc}" as a meeting format. Tap an option below, or reply "online" (Teams link) or "in person".`
            : 'Should this be online (Teams link) or in person? Tap an option below, or reply "online" or "in person".',
          tool: "schedule_internal_meeting",
          partial,
          suggestions: LOCATION_SUGGESTIONS,
        },
      };
    }

    // ---- slot: explicit time OR earliest common availability ----
    // Task #567 — tolerant time parsing ("8am", "0800", "8.00"…).
    const timeRaw = typeof input.time === "string" ? input.time.trim() : "";
    const timeStr = timeRaw ? normalizeTimeInput(timeRaw) ?? timeRaw : "";
    let slotStart: Date;
    let slotEnd: Date;
    let availabilityNote = "";
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
      // An explicit user-stated time is honored even outside working hours.
      slotStart = s;
      slotEnd = new Date(s.getTime() + durationMin * 60 * 1000);
      // Still surface who we couldn't check.
      const avail = await collectBusyTimes({
        people: resolved,
        windowStart: slotStart,
        windowEnd: slotEnd,
      });
      const conflictNames = avail.checked.length > 0 && avail.busy.some((b) => b.start < slotEnd && b.end > slotStart)
        ? " Note: at least one attendee already has something on their calendar at that time."
        : "";
      availabilityNote = buildAvailabilityNote(avail.notConnected, avail.failed) + conflictNames;
    } else {
      const windowStart = dubaiWallToUtc(dateStr, `${String(WORK_START_HOUR).padStart(2, "0")}:00`)!;
      // Search up to 7 days ahead so "earliest availability" can spill
      // into following days when the requested day is fully booked.
      const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 3600 * 1000);
      const people: AvailabilityPerson[] = [
        { userId: ctx.persona.id, name: ctx.persona.name, email: "" },
        ...resolved,
      ];
      const avail = await collectBusyTimes({ people, windowStart, windowEnd });
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
          errorMessage: `I couldn't find a common free ${durationMin}-minute slot between ${WORK_START_HOUR}:00 and ${WORK_END_HOUR}:00 (Dubai) in the week from ${dateStr}. Try a specific time and I'll book it anyway.`,
        };
      }
      slotStart = slot.start;
      slotEnd = slot.end;
      availabilityNote = buildAvailabilityNote(avail.notConnected.filter((p) => p.userId !== ctx.persona.id), avail.failed);
    }

    // ---- two-phase confirm ----
    const attendeeNames = resolved.map((r) => r.name).join(", ");
    const whenLabel = `${fmtDubai(slotStart)}–${fmtDubai(slotEnd).slice(-5)} (Dubai)`;
    // Task #570 — duplicate-booking awareness + idempotent confirm replay.
    const sameSlot = await findSameSlotMeetings(ctx.persona.orgId, slotStart);
    if (input.confirm !== true) {
      const dupWarning = buildDuplicateWarning(sameSlot, {
        title: topic,
        attendeeUserIds: resolved.map((r) => r.userId),
      });
      availabilityNote = `${availabilityNote}${dupWarning}`;
      return {
        ok: true,
        data: {
          preview: {
            topic,
            attendees: resolved.map((r) => ({ name: r.name, email: r.email })),
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            whenLabel,
            locationType,
            note: availabilityNote || undefined,
          },
        },
        confirmation: {
          summary:
            `Book "${topic}" with ${attendeeNames} — ${whenLabel}, ${locationType === "online" ? "online (Teams)" : "in person"}. ` +
            `A calendar invite will be sent from your Microsoft account.${availabilityNote ? ` ${availabilityNote}` : ""}`,
          diff: {
            create: {
              table: "atelier_meetings",
              values: { title: topic, attendees: attendeeNames, start: slotStart.toISOString(), locationType },
            },
          },
          pending: {
            tool: "schedule_internal_meeting",
            input: {
              attendees: resolved.map((r) => r.name),
              // The PROPOSED slot's Dubai date — not the originally requested
              // date. The earliest-slot search may spill into a later day;
              // confirm must rebook exactly what was previewed.
              date: fmtDubai(slotStart).slice(0, 10),
              time: `${fmtDubai(slotStart).slice(-5)}`,
              durationMinutes: durationMin,
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
      parentType: "internal",
    });
    if (replay) {
      return {
        ok: true,
        data: {
          meeting: {
            id: replay.id,
            title: replay.title,
            date: fmtDubai(slotStart).slice(0, 10),
            kind: "internal",
            status: "scheduled",
            attendees: (replay.internalAttendees ?? []).map((a) => a.name).filter(Boolean),
            startAt: slotStart.toISOString(),
            endAt: replay.endAt?.toISOString() ?? slotEnd.toISOString(),
            whenLabel,
            locationType: replay.locationType ?? locationType,
            joinUrl: replay.joinUrl,
            summary: "Already booked — this confirmation was a repeat, so no second invite was sent.",
            decisions: [],
            actionItems: [],
          },
          parent: { kind: "internal", id: "internal", name: "Internal" },
          href: "/me?tab=calendar",
          navigateTo: null,
        },
      };
    }

    // ---- commit: send the invite, then persist the internal record ----
    let eventId: string | null = null;
    let eventUid: string | null = null;
    let joinUrl: string | null = null;
    let webLink: string | null = null;
    try {
      const { event } = await sendInternalInvite({
        requesterUserId: ctx.persona.id,
        subject: topic,
        bodyText: agenda
          ? `Agenda:\n${agenda}\n\nScheduled via the Atelier by ${ctx.persona.name}.`
          : `Internal meeting scheduled via the Atelier by ${ctx.persona.name}.`,
        start: slotStart,
        end: slotEnd,
        attendees: resolved.map((r) => ({ email: r.email, name: r.name })),
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
        parentType: "internal",
        parentId: "internal",
        mode: "scheduled",
        kind: "internal",
        title: topic,
        date: fmtDubai(slotStart).slice(0, 10),
        startAt: slotStart,
        endAt: slotEnd,
        locationType,
        joinUrl,
        webLink,
        msEventId: eventId,
        msEventUid: eventUid,
        internalAttendees: resolved.map((r) => ({ userId: r.userId, name: r.name, email: r.email })),
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
        attendees: resolved.map((r) => r.name),
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        locationType,
        msEventId: eventId,
        viaCli: true,
        turnId: ctx.turnId,
      },
      payloadSummary: `${ctx.persona.name} scheduled internal meeting "${topic}" (${whenLabel}).`,
    });

    return {
      ok: true,
      data: {
        meeting: {
          id,
          title: topic,
          date: fmtDubai(slotStart).slice(0, 10),
          kind: "internal",
          status: "scheduled",
          attendees: resolved.map((r) => r.name),
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          whenLabel,
          locationType,
          joinUrl,
          summary: `Invite sent from your Microsoft account to ${attendeeNames}.`,
          decisions: [],
          actionItems: [],
        },
        parent: { kind: "internal", id: "internal", name: "Internal" },
        href: "/me?tab=calendar",
        navigateTo: null,
      },
    };
  },
});

// ------------------------------------------------------------------
// Task #559 — reschedule / cancel internal meetings from chat.
// ------------------------------------------------------------------

interface ManagedMeetingRow {
  id: string;
  title: string;
  parentType: string;
  startAt: Date | null;
  endAt: Date | null;
  createdByUserId: string | null;
  internalAttendees: Array<{ userId?: string; name?: string; email?: string | null }> | null;
}

/**
 * Upcoming (or started within the last hour) meetings the requester may
 * manage — organizer's own meetings, or all for a founding partner.
 * Task #570: covers BOTH standalone internal meetings AND client
 * meetings scheduled via chat (parentType opportunity/engagement, mode
 * "scheduled" so recorded-transcript rows never surface here). Optional
 * case-insensitive title filter.
 */
async function findManagedMeetings(
  persona: { id: string; orgId: string; role: string },
  titleQuery: string,
): Promise<ManagedMeetingRow[]> {
  const cutoff = new Date(Date.now() - 3600 * 1000);
  const conds = [
    eq(atelierMeetings.orgId, persona.orgId),
    inArray(atelierMeetings.parentType, ["internal", "opportunity", "engagement"]),
    eq(atelierMeetings.mode, "scheduled"),
    isNull(atelierMeetings.deletedAt),
    ne(atelierMeetings.status, "cancelled"),
    gte(atelierMeetings.startAt, cutoff),
  ];
  if (titleQuery) conds.push(ilike(atelierMeetings.title, `%${titleQuery}%`));
  const rows = await db
    .select({
      id: atelierMeetings.id,
      title: atelierMeetings.title,
      parentType: atelierMeetings.parentType,
      startAt: atelierMeetings.startAt,
      endAt: atelierMeetings.endAt,
      createdByUserId: atelierMeetings.createdByUserId,
      internalAttendees: atelierMeetings.internalAttendees,
    })
    .from(atelierMeetings)
    .where(and(...conds));
  return rows
    .filter((m) => canManageInternalMeeting(persona, m))
    .sort((a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0))
    .slice(0, 10);
}

function meetingLabel(m: ManagedMeetingRow): string {
  const tag = m.parentType === "internal" ? "" : " (client meeting)";
  return m.startAt
    ? `"${m.title}"${tag} — ${fmtDubai(m.startAt)} (Dubai)`
    : `"${m.title}"${tag}`;
}

/**
 * Resolve which meeting the user means: by explicit meetingId, else by
 * title match. Returns a ToolResult envelope for the not-found and
 * ambiguous cases, or the single matching row.
 */
/**
 * When the user identifies a meeting by TIME rather than topic
 * ("tomorrow's 7:00am meeting", "the 8:30"), the title ILIKE filter can
 * never match. Extract a time-of-day from the query so we can instead
 * match candidates on their Dubai-wall-clock start time.
 */
export function timeFromMeetingQuery(query: string): string | null {
  // Whole query is a time ("7", "8:30", "0800") — unambiguous.
  const direct = normalizeTimeInput(query);
  if (direct) return direct;
  // Strip date-like tokens so year/day numbers are never read as times
  // ("2026-07-22", "12/09/2026", "22.07.2026", bare years).
  const s = query
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");
  // Only EXPLICIT time forms may fire inside a longer phrase: "H:MM"
  // (am/pm optional), "H am/pm", or "at H"/"at HHMM". Bare numbers
  // without such context ("phase 2 planning") are NOT times.
  const m =
    s.match(/\b(\d{1,2}:\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?!\w)/) ??
    s.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?!\w)/) ??
    s.match(/\bat\s+(\d{3,4}|\d{1,2})(?!\w)()/);
  if (!m) return null;
  // "7 p.m." → "7pm"; normalizeTimeInput handles the rest ("0800"…).
  const token = `${m[1]!}${m[2] ?? ""}`.replace(/([ap])\.m\./, "$1m");
  return normalizeTimeInput(token);
}

/** Explicit YYYY-MM-DD in the query (if any) for date-aware narrowing. */
export function dateFromMeetingQuery(query: string): string | null {
  const m = query.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1]! : null;
}

async function resolveTargetMeeting(
  persona: { id: string; orgId: string; role: string },
  input: Record<string, unknown>,
): Promise<
  | { row: ManagedMeetingRow }
  | { result: { ok: boolean; [k: string]: unknown } }
> {
  const meetingId = typeof input.meetingId === "string" ? input.meetingId.trim() : "";
  const query = typeof input.meeting === "string" ? input.meeting.trim() : "";
  let candidates = await findManagedMeetings(persona, meetingId ? "" : query);
  // Title match came up empty but the query looks like a time (e.g.
  // "7:00am") — retry against ALL manageable meetings, matching on the
  // Dubai start time instead of the title.
  if (!meetingId && query && candidates.length === 0) {
    const hm = timeFromMeetingQuery(query);
    if (hm) {
      const ymd = dateFromMeetingQuery(query);
      const all = await findManagedMeetings(persona, "");
      candidates = all.filter(
        (m) =>
          m.startAt &&
          fmtDubai(m.startAt).slice(-5) === hm &&
          (!ymd || fmtDubai(m.startAt).slice(0, 10) === ymd),
      );
    }
  }
  if (meetingId) {
    const row = candidates.find((m) => m.id === meetingId);
    if (!row) {
      return {
        result: {
          ok: false,
          errorCode: "not_found",
          errorMessage: "I couldn't find that upcoming meeting (it may have been cancelled already, or you may not be its organizer).",
        },
      };
    }
    return { row };
  }
  if (candidates.length === 0) {
    return {
      result: {
        ok: false,
        errorCode: "not_found",
        errorMessage: query
          ? `I couldn't find an upcoming meeting matching "${query}" that you can manage. Only the organizer (or a founding partner) can change a meeting.`
          : "You have no upcoming meetings that you can manage.",
      },
    };
  }
  if (candidates.length > 1) {
    const options = candidates.slice(0, 5).map((m) => ({
      id: m.id,
      label: meetingLabel(m),
      secondary: m.internalAttendees?.map((a) => a.name).filter(Boolean).join(", ") || undefined,
    }));
    return {
      result: {
        ok: true,
        data: { prompt: "Which meeting do you mean?", options },
        disambiguation: { kind: "meeting", options, field: "meetingId" },
      },
    };
  }
  return { row: candidates[0]! };
}

defineCapability({
  id: "meeting.reschedule_internal",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "reschedule_internal_meeting",
  description:
    "Move a meeting you organized via the Atelier — internal OR client (founding partners can move anyone's) — to a new date/time. Updates the real Outlook event so attendees get a standard meeting update. Identify the meeting by topic words; date must be an absolute YYYY-MM-DD and time HH:MM (Dubai).",
  slashAliases: { en: ["/reschedule"], fr: ["/replanifier"] },
  inputSchema: {
    type: "object",
    properties: {
      meeting: { type: "string", description: "Words from the meeting topic/title to find it." },
      meetingId: { type: "string", description: "Exact meeting id (from disambiguation)." },
      date: { type: "string", description: "New date YYYY-MM-DD (Dubai)." },
      time: { type: "string", description: "New start time HH:MM (Dubai)." },
      durationMinutes: { type: "integer", minimum: 15, maximum: 480, description: "Optional new duration; defaults to the meeting's current length." },
      confirm: { type: "boolean" },
    },
    required: ["date", "time"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  examplePhrases: {
    en: [
      "Move my catch-up with Gokhan to Friday 14:00",
      "Reschedule the pipeline review to tomorrow at 9",
      "/reschedule strategy sync to 2026-07-30 10:30",
    ],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "meeting_card",
  async run(input, ctx) {
    const dateStr = String(input.date ?? "").trim();
    // Task #567 — tolerant time parsing ("8am", "0800", "8.00"…).
    const timeRaw = String(input.time ?? "").trim();
    const timeStr = timeRaw ? normalizeTimeInput(timeRaw) ?? timeRaw : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "date must be YYYY-MM-DD — resolve relative dates against today's date first." };
    }
    const newStart = dubaiWallToUtc(dateStr, timeStr);
    if (!newStart) {
      return { ok: false, errorCode: "invalid_input", errorMessage: `Couldn't parse the time "${timeRaw}" — try something like "8am", "08:00" or "14:30".` };
    }
    // Task #570 — reject moves into the past.
    if (isPastSlot(newStart)) {
      return {
        ok: false,
        errorCode: "past_time",
        errorMessage: `${fmtDubai(newStart)} (Dubai) is already in the past — give me a future date/time.`,
      };
    }
    const target = await resolveTargetMeeting(ctx.persona, input);
    if ("result" in target) return target.result as never;
    const row = target.row;
    const currentDurMin =
      row.startAt && row.endAt
        ? Math.max(15, Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60000))
        : 30;
    const durationMin = Math.max(15, Math.min(480, Number(input.durationMinutes ?? currentDurMin)));
    const newEnd = new Date(newStart.getTime() + durationMin * 60 * 1000);
    const whenLabel = `${fmtDubai(newStart)}–${fmtDubai(newEnd).slice(-5)} (Dubai)`;

    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            topic: row.title,
            currentStart: row.startAt?.toISOString() ?? null,
            newStart: newStart.toISOString(),
            newEnd: newEnd.toISOString(),
            whenLabel,
          },
        },
        confirmation: {
          summary:
            `Move ${meetingLabel(row)} to ${whenLabel}. ` +
            "Attendees will receive a standard Outlook meeting update.",
          diff: {
            update: {
              table: "atelier_meetings",
              id: row.id,
              values: { start: newStart.toISOString(), end: newEnd.toISOString() },
            },
          },
          pending: {
            tool: "reschedule_internal_meeting",
            input: {
              meetingId: row.id,
              date: dateStr,
              time: `${fmtDubai(newStart).slice(-5)}`,
              durationMinutes: durationMin,
              confirm: true,
            },
          },
        },
      };
    }

    try {
      const { meeting, graphUpdated } = await rescheduleInternalMeeting({
        actor: { id: ctx.persona.id, orgId: ctx.persona.orgId, name: ctx.persona.name, role: ctx.persona.role },
        meetingId: row.id,
        start: newStart,
        end: newEnd,
        via: "cli",
        turnId: ctx.turnId,
        scope: "any",
      });
      return {
        ok: true,
        data: {
          meeting: {
            id: meeting.id,
            title: meeting.title,
            date: fmtDubai(newStart).slice(0, 10),
            kind: "internal",
            status: "scheduled",
            startAt: newStart.toISOString(),
            endAt: newEnd.toISOString(),
            whenLabel,
            summary: graphUpdated
              ? "Rescheduled — attendees get an Outlook meeting update."
              : "Rescheduled in the Atelier (no linked Outlook event to update).",
            decisions: [],
            actionItems: [],
          },
          parent: { kind: "internal", id: "internal", name: "Internal" },
          href: "/me?tab=calendar",
          navigateTo: null,
        },
      };
    } catch (err) {
      if (err instanceof SchedulingError) {
        return { ok: false, errorCode: `ms_${err.code}`, errorMessage: err.message };
      }
      if (err instanceof MeetingLifecycleError) {
        return { ok: false, errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  },
});

defineCapability({
  id: "meeting.cancel_internal",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "cancel_internal_meeting",
  description:
    "Cancel a meeting you organized via the Atelier — internal OR client (founding partners can cancel anyone's). Deletes the real Outlook event so attendees get a standard cancellation notice; the Atelier record is marked cancelled. Identify the meeting by topic words.",
  slashAliases: { en: ["/cancel-meeting"], fr: ["/annuler-reunion"] },
  inputSchema: {
    type: "object",
    properties: {
      meeting: { type: "string", description: "Words from the meeting topic/title to find it." },
      meetingId: { type: "string", description: "Exact meeting id (from disambiguation)." },
      confirm: { type: "boolean" },
    },
    required: [],
  },
  isWrite: true,
  irreversible: true,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  examplePhrases: {
    en: [
      "Cancel my catch-up with Gokhan tomorrow",
      "Cancel the pipeline review meeting",
      "/cancel-meeting strategy sync",
    ],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "meeting_card",
  async run(input, ctx) {
    const target = await resolveTargetMeeting(ctx.persona, input);
    if ("result" in target) return target.result as never;
    const row = target.row;

    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            topic: row.title,
            start: row.startAt?.toISOString() ?? null,
            attendees: row.internalAttendees?.map((a) => a.name).filter(Boolean) ?? [],
          },
        },
        confirmation: {
          summary:
            `Cancel ${meetingLabel(row)}. ` +
            "Attendees will receive a standard Outlook cancellation notice. This can't be undone.",
          diff: {
            delete: {
              table: "atelier_meetings",
              id: row.id,
              label: row.title,
            },
          },
          pending: {
            tool: "cancel_internal_meeting",
            input: { meetingId: row.id, confirm: true },
          },
        },
      };
    }

    try {
      const { graphCancelled } = await cancelInternalMeeting({
        actor: { id: ctx.persona.id, orgId: ctx.persona.orgId, name: ctx.persona.name, role: ctx.persona.role },
        meetingId: row.id,
        via: "cli",
        turnId: ctx.turnId,
        scope: "any",
      });
      return {
        ok: true,
        data: {
          meeting: {
            id: row.id,
            title: row.title,
            kind: "internal",
            status: "cancelled",
            startAt: row.startAt?.toISOString() ?? null,
            endAt: row.endAt?.toISOString() ?? null,
            summary: graphCancelled
              ? "Cancelled — attendees get an Outlook cancellation notice."
              : "Cancelled in the Atelier (no linked Outlook event to remove).",
            decisions: [],
            actionItems: [],
          },
          parent: { kind: "internal", id: "internal", name: "Internal" },
          href: "/me?tab=calendar",
          navigateTo: null,
        },
      };
    } catch (err) {
      if (err instanceof SchedulingError) {
        return { ok: false, errorCode: `ms_${err.code}`, errorMessage: err.message };
      }
      if (err instanceof MeetingLifecycleError) {
        return { ok: false, errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  },
});

// ------------------------------------------------------------------
// Task #568 — edit an internal meeting's topic / attendee list from chat.
// ------------------------------------------------------------------

defineCapability({
  id: "meeting.update_internal",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "update_internal_meeting",
  description:
    "Change a meeting you organized via the Atelier (founding partners can change anyone's): rename the topic and/or — for INTERNAL meetings only — add or remove roster attendees (client-meeting attendee lists can't be edited from chat; say so honestly). Updates the real Outlook invite — attendees get a standard meeting update, newly added colleagues receive the invite. Identify the meeting by topic words. Time changes go through reschedule_internal_meeting instead. Recurring meetings are NOT supported — say so honestly.",
  slashAliases: { en: ["/edit-meeting"], fr: ["/modifier-reunion"] },
  inputSchema: {
    type: "object",
    properties: {
      meeting: { type: "string", description: "Words from the meeting topic/title to find it." },
      meetingId: { type: "string", description: "Exact meeting id (from disambiguation)." },
      topic: { type: "string", maxLength: 200, description: "New meeting topic/subject." },
      addAttendees: {
        type: "array",
        items: { type: "string" },
        description: "Colleague names (roster) to add to the invite.",
      },
      removeAttendees: {
        type: "array",
        items: { type: "string" },
        description: "Names of current attendees to remove from the invite.",
      },
      confirm: { type: "boolean" },
    },
    required: [],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  examplePhrases: {
    en: [
      "Rename my catch-up with Gokhan to 'Q3 planning'",
      "Add Yavuz to the pipeline review meeting",
      "Remove Mounir from tomorrow's strategy sync",
    ],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "meeting_card",
  async run(input, ctx) {
    const newTopic = typeof input.topic === "string" ? input.topic.trim() : "";
    const addNames = Array.isArray(input.addAttendees)
      ? input.addAttendees.map((n) => String(n).trim()).filter(Boolean)
      : [];
    const removeNames = Array.isArray(input.removeAttendees)
      ? input.removeAttendees.map((n) => String(n).trim()).filter(Boolean)
      : [];
    if (!newTopic && addNames.length === 0 && removeNames.length === 0) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage:
          "Tell me what to change: a new topic, attendees to add, or attendees to remove. (To change the time, ask me to reschedule it.)",
      };
    }

    const target = await resolveTargetMeeting(ctx.persona, input);
    if ("result" in target) return target.result as never;
    const row = target.row;

    // Task #570 — attendee edits are internal-only: a client meeting's
    // Outlook invite includes client contacts that aren't stored as
    // roster attendees, so a replacement would silently drop them.
    if (row.parentType !== "internal" && (addNames.length > 0 || removeNames.length > 0)) {
      return {
        ok: false,
        errorCode: "unsupported",
        errorMessage:
          `${meetingLabel(row)} is a client meeting — I can rename, reschedule, or cancel it, but I can't edit its attendee list from chat (the client invitees live on the Outlook invite). Update the invite in Outlook directly.`,
      };
    }

    const current = (row.internalAttendees ?? [])
      .filter((a) => a.userId && a.name)
      .map((a) => ({ userId: a.userId as string, name: a.name as string, email: a.email ?? null }));

    // ---- resolve additions against the roster (never self — the
    // organizer is on the event implicitly) ----
    // Task #570 — shared accent-insensitive resolver ("gokhan" finds
    // "Gökhan Güney"); raw email addresses are refused gracefully.
    const additions: Array<{ userId: string; name: string; email: string | null }> = [];
    const addResolution = await resolveRosterAttendees(addNames, ctx.persona);
    if (addResolution.kind === "result") return addResolution.result as never;
    for (const m of addResolution.people) {
      if (!current.some((a) => a.userId === m.userId) && !additions.some((a) => a.userId === m.userId)) {
        additions.push({ userId: m.userId, name: m.name, email: m.email });
      }
    }

    // ---- resolve removals against the CURRENT attendee list ----
    const removals: Array<{ userId: string; name: string }> = [];
    for (const name of removeNames) {
      const needle = foldRosterName(name);
      const matches = current.filter((a) => foldRosterName(a.name).includes(needle));
      if (matches.length === 0) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `"${name}" isn't on ${meetingLabel(row)} — current attendees: ${
            current.map((a) => a.name).join(", ") || "none"
          }.`,
        };
      }
      if (matches.length > 1) {
        const options = matches.slice(0, 5).map((m) => ({ id: m.userId, label: m.name }));
        return {
          ok: true,
          data: { prompt: `Which "${name}" should I remove?`, options },
          disambiguation: { kind: "user", options },
        };
      }
      const m = matches[0]!;
      if (!removals.some((r) => r.userId === m.userId)) removals.push({ userId: m.userId, name: m.name });
    }

    const nextAttendees = [
      ...current.filter((a) => !removals.some((r) => r.userId === a.userId)),
      ...additions,
    ];
    const attendeesChanged = additions.length > 0 || removals.length > 0;
    if (attendeesChanged && nextAttendees.length === 0) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage:
          "That would leave the meeting with no attendees besides you — cancel it instead if it's no longer needed.",
      };
    }
    const topicChanged = Boolean(newTopic) && newTopic !== row.title;
    if (!topicChanged && !attendeesChanged) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage: `Nothing to change — ${meetingLabel(row)} already looks like that.`,
      };
    }

    const changeBits: string[] = [];
    if (topicChanged) changeBits.push(`rename it to "${newTopic}"`);
    if (additions.length > 0) changeBits.push(`add ${additions.map((a) => a.name).join(", ")}`);
    if (removals.length > 0) changeBits.push(`remove ${removals.map((r) => r.name).join(", ")}`);

    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            topic: topicChanged ? newTopic : row.title,
            previousTopic: row.title,
            attendees: nextAttendees.map((a) => a.name),
            added: additions.map((a) => a.name),
            removed: removals.map((r) => r.name),
            start: row.startAt?.toISOString() ?? null,
          },
        },
        confirmation: {
          summary:
            `Update ${meetingLabel(row)}: ${changeBits.join(", ")}. ` +
            "The Outlook invite will be updated — attendees get a standard meeting update.",
          diff: {
            update: {
              table: "atelier_meetings",
              id: row.id,
              values: {
                ...(topicChanged ? { title: newTopic } : {}),
                ...(attendeesChanged ? { attendees: nextAttendees.map((a) => a.name).join(", ") } : {}),
              },
            },
          },
          pending: {
            tool: "update_internal_meeting",
            input: {
              meetingId: row.id,
              ...(topicChanged ? { topic: newTopic } : {}),
              ...(additions.length > 0 ? { addAttendees: additions.map((a) => a.name) } : {}),
              ...(removals.length > 0 ? { removeAttendees: removals.map((r) => r.name) } : {}),
              confirm: true,
            },
          },
        },
      };
    }

    try {
      const { meeting, graphUpdated } = await updateInternalMeetingDetails({
        actor: { id: ctx.persona.id, orgId: ctx.persona.orgId, name: ctx.persona.name, role: ctx.persona.role },
        meetingId: row.id,
        title: topicChanged ? newTopic : undefined,
        internalAttendees: attendeesChanged ? nextAttendees : undefined,
        via: "cli",
        turnId: ctx.turnId,
        scope: "any",
      });
      return {
        ok: true,
        data: {
          meeting: {
            id: meeting.id,
            title: meeting.title,
            kind: "internal",
            status: "scheduled",
            attendees: nextAttendees.map((a) => a.name),
            startAt: meeting.startAt?.toISOString() ?? null,
            endAt: meeting.endAt?.toISOString() ?? null,
            summary: graphUpdated
              ? "Updated — attendees get an Outlook meeting update."
              : "Updated in the Atelier (no linked Outlook event to update).",
            decisions: [],
            actionItems: [],
          },
          parent: { kind: "internal", id: "internal", name: "Internal" },
          href: "/me?tab=calendar",
          navigateTo: null,
        },
      };
    } catch (err) {
      if (err instanceof SchedulingError) {
        return { ok: false, errorCode: `ms_${err.code}`, errorMessage: err.message };
      }
      if (err instanceof MeetingLifecycleError) {
        return { ok: false, errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  },
});

function buildAvailabilityNote(
  notConnected: AvailabilityPerson[],
  failed: Array<AvailabilityPerson & { reason: string }>,
): string {
  const parts: string[] = [];
  if (notConnected.length > 0) {
    parts.push(
      `${notConnected.map((p) => p.name).join(" and ")} ${notConnected.length === 1 ? "hasn't" : "haven't"} connected Microsoft 365, so I couldn't check their availability — the invite will still reach their inbox.`,
    );
  }
  if (failed.length > 0) {
    parts.push(
      `I couldn't check ${failed.map((p) => p.name).join(" and ")}'s calendar (connection issue).`,
    );
  }
  return parts.join(" ");
}
