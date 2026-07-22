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
 * Out of scope (per task): reschedule/cancel, rooms, recurring meetings,
 * external attendees.
 */
import { and, eq, ilike, ne } from "drizzle-orm";
import { db, atelierUsers, atelierMeetings, atelierAuditEvents } from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { rid } from "./index.js";
import {
  SchedulingError,
  WORK_END_HOUR,
  WORK_START_HOUR,
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

defineCapability({
  id: "meeting.schedule_internal",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "schedule_internal_meeting",
  description:
    "Schedule an internal meeting with colleagues: checks their Microsoft 365 availability (when connected), finds the earliest common free slot or uses an explicit time, and on confirm sends a real Outlook calendar invite (Teams link when online). Attendees are roster colleagues by name; date must be an absolute YYYY-MM-DD (resolve relative dates yourself from the current date). Not for client meetings — those attach to an opportunity or engagement.",
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
    const locationType = input.locationType === "in_person" ? "in_person" : input.locationType === "online" ? "online" : null;

    // ---- attendee resolution (roster users, org-scoped, never self) ----
    const resolved: ResolvedAttendee[] = [];
    for (const name of names) {
      const matches = await db
        .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email })
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.orgId, ctx.persona.orgId),
            ne(atelierUsers.id, ctx.persona.id),
            ilike(atelierUsers.name, `%${name}%`),
          ),
        )
        .limit(6);
      if (matches.length === 0) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `I couldn't find a colleague named "${name}" on the roster.`,
        };
      }
      if (matches.length > 1) {
        const options = matches.slice(0, 5).map((m) => ({ id: m.id, label: m.name, secondary: m.email }));
        return {
          ok: true,
          data: { prompt: `Which "${name}" did you mean?`, options },
          disambiguation: { kind: "user", options },
        };
      }
      const m = matches[0]!;
      if (!resolved.some((r) => r.userId === m.id)) {
        resolved.push({ userId: m.id, name: m.name, email: m.email });
      }
    }

    // ---- clarifications: topic then online/in-person ----
    const partial = {
      attendees: resolved.map((r) => r.name),
      date: dateStr,
      time: typeof input.time === "string" ? input.time : undefined,
      durationMinutes: durationMin,
      topic: topic || undefined,
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
      return {
        ok: true,
        data: { partial },
        clarification: {
          field: "locationType",
          question: 'Should this be online (Teams link) or in person? Reply "online" or "in person".',
          tool: "schedule_internal_meeting",
          partial,
        },
      };
    }

    // ---- slot: explicit time OR earliest common availability ----
    const timeStr = typeof input.time === "string" ? input.time.trim() : "";
    let slotStart: Date;
    let slotEnd: Date;
    let availabilityNote = "";
    if (timeStr) {
      const s = dubaiWallToUtc(dateStr, timeStr);
      if (!s) {
        return { ok: false, errorCode: "invalid_input", errorMessage: `Couldn't parse the time "${timeStr}" — use HH:MM.` };
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
    if (input.confirm !== true) {
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
              locationType,
              confirm: true,
            },
          },
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
        bodyText: `Internal meeting scheduled via the Atelier by ${ctx.persona.name}.`,
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
