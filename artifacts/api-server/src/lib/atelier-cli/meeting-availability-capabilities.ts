/**
 * Task #570 — calendar-availability tools for chat:
 *
 *   check_availability — "is Gökhan free tomorrow at 3pm?" / "what does
 *     my Thursday look like?" — busy/free verdict for one or more roster
 *     people at a specific time, or their busy blocks across a day.
 *   find_free_slot — "when are Selin and I both free on Friday?" —
 *     earliest common free slot within working hours (08:00–18:00 Dubai).
 *
 * Read-only: nothing here books anything. Uses each person's OWN
 * Microsoft 365 connection via collectBusyTimes; people without a
 * connection are reported honestly as unknown, never guessed.
 */
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { resolveRosterAttendees } from "./meeting-attendee-resolver.js";
import { normalizeTimeInput } from "./chat-normalizers.js";
import { isPastSlot } from "./meeting-reliability.js";
import {
  WORK_END_HOUR,
  WORK_START_HOUR,
  collectBusyTimes,
  dubaiWallToUtc,
  findEarliestCommonSlot,
  fmtDubai,
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dayWindow(dateStr: string): { start: Date; end: Date } | null {
  const start = dubaiWallToUtc(dateStr, "00:00");
  if (!start) return null;
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

async function resolvePeople(
  input: Record<string, unknown>,
  ctx: { persona: { id: string; orgId: string; name: string } },
): Promise<
  | { kind: "ok"; people: AvailabilityPerson[] }
  | { kind: "result"; result: Record<string, unknown> }
> {
  const names = Array.isArray(input.people)
    ? (input.people as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
  const resolution = await resolveRosterAttendees(names, ctx.persona, { allowSelf: true });
  if (resolution.kind === "result") return { kind: "result", result: resolution.result };
  const people: AvailabilityPerson[] = [...resolution.people];
  // Default to the requester's own calendar when no (other) names given,
  // and always include self when the phrasing referenced it.
  if (resolution.includesSelf || people.length === 0) {
    people.unshift({ userId: ctx.persona.id, name: ctx.persona.name, email: "" });
  }
  return { kind: "ok", people };
}

// ---------------------------------------------------------------------
// meeting.check_availability — text verdict
// ---------------------------------------------------------------------
defineCapability({
  id: "meeting.check_availability",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "check_availability",
  description:
    "Check Microsoft 365 calendar availability WITHOUT booking anything: whether one or more roster colleagues (and/or the requester) are free at a specific time, or their busy blocks across a whole day. Use for \"is X free at 3pm?\" / \"what does my Thursday look like?\". date must be absolute YYYY-MM-DD. For workload/utilisation questions (staffing capacity, billable load) use person_workload instead.",
  slashAliases: { en: ["/availability", "/free"] },
  inputSchema: {
    type: "object",
    properties: {
      people: {
        type: "array",
        items: { type: "string" },
        description: "Roster colleague names; omit (or say \"me\") for the requester's own calendar.",
      },
      date: { type: "string", description: "Absolute date YYYY-MM-DD." },
      time: {
        type: "string",
        description: "Optional specific time HH:MM (Dubai). Omit for the whole day's busy blocks.",
      },
      durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
    },
    required: ["date"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Is Gökhan free tomorrow at 3pm?", "What does my Thursday look like?"],
    ar: ["هل جوكهان متاح غدًا الساعة ٣؟"],
    fr: ["Gökhan est-il libre demain à 15h ?"],
  },
  async run(input, ctx) {
    const dateStr = typeof input.date === "string" ? input.date.trim() : "";
    if (!YMD.test(dateStr)) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage: "date must be YYYY-MM-DD — resolve relative dates against today's date first.",
      };
    }
    const durationMin = Math.max(15, Math.min(480, Number(input.durationMinutes ?? 30)));

    const timeRaw = typeof input.time === "string" ? input.time.trim() : "";
    const timeStr = timeRaw ? normalizeTimeInput(timeRaw) ?? timeRaw : "";

    // Task #570 — reject explicitly-past slots/days up front (before any
    // roster/calendar lookups) instead of "checking" history.
    if (timeStr) {
      const startProbe = dubaiWallToUtc(dateStr, timeStr);
      if (startProbe && isPastSlot(startProbe)) {
        return {
          ok: false,
          errorCode: "past_time",
          errorMessage: `${dateStr} ${timeStr} (Dubai) is in the past — availability checks only make sense for upcoming times.`,
        };
      }
    } else {
      const w = dayWindow(dateStr);
      if (w && w.end.getTime() <= Date.now()) {
        return {
          ok: false,
          errorCode: "past_time",
          errorMessage: `${dateStr} is in the past — availability checks only make sense for upcoming days.`,
        };
      }
    }

    const resolved = await resolvePeople(input, ctx);
    if (resolved.kind === "result") return resolved.result as never;
    const people = resolved.people;

    if (timeStr) {
      const start = dubaiWallToUtc(dateStr, timeStr);
      if (!start) {
        return {
          ok: false,
          errorCode: "invalid_input",
          errorMessage: `Couldn't parse the time "${timeRaw}" — try something like "8am", "08:00" or "14:30".`,
        };
      }
      const end = new Date(start.getTime() + durationMin * 60 * 1000);
      const avail = await collectBusyTimes({ people, windowStart: start, windowEnd: end });
      const busyPeople: string[] = [];
      for (const p of avail.checked) {
        // Re-check per person so the verdict names WHO is busy.
        const own = await collectBusyTimes({ people: [p], windowStart: start, windowEnd: end });
        if (own.busy.some((b) => b.start < end && b.end > start)) busyPeople.push(p.name);
      }
      const parts: string[] = [];
      const freeNames = avail.checked.map((p) => p.name).filter((n) => !busyPeople.includes(n));
      const whenLabel = `${fmtDubai(start)}–${fmtDubai(end).slice(-5)} (Dubai)`;
      if (freeNames.length > 0) parts.push(`Free at ${whenLabel}: ${freeNames.join(", ")}.`);
      if (busyPeople.length > 0) parts.push(`Busy at ${whenLabel}: ${busyPeople.join(", ")}.`);
      if (avail.notConnected.length > 0) {
        parts.push(
          `No Microsoft 365 connection for ${avail.notConnected.map((p) => p.name).join(", ")} — their availability is unknown.`,
        );
      }
      if (avail.failed.length > 0) {
        parts.push(
          `Couldn't check ${avail.failed.map((p) => p.name).join(", ")} (calendar lookup failed).`,
        );
      }
      return {
        ok: true,
        data: {
          verdict: busyPeople.length === 0 && avail.checked.length > 0 ? "free" : busyPeople.length > 0 ? "busy" : "unknown",
          summary: parts.join(" ") || "No calendars could be checked.",
          whenLabel,
        },
      };
    }

    // Whole-day view.
    const window = dayWindow(dateStr);
    if (!window) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "Couldn't parse that date." };
    }
    const perPerson: Array<{ name: string; busy: string[] }> = [];
    const notConnected: string[] = [];
    const failed: string[] = [];
    for (const p of people) {
      const own = await collectBusyTimes({ people: [p], windowStart: window.start, windowEnd: window.end });
      if (own.notConnected.length > 0) {
        notConnected.push(p.name);
        continue;
      }
      if (own.failed.length > 0) {
        failed.push(p.name);
        continue;
      }
      const blocks = own.busy
        .filter((b) => b.end > window.start && b.start < window.end)
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map((b) => `${fmtDubai(b.start).slice(-5)}–${fmtDubai(b.end).slice(-5)}`);
      perPerson.push({ name: p.name, busy: blocks });
    }
    const lines = perPerson.map((p) =>
      p.busy.length === 0
        ? `${p.name}: no meetings on ${dateStr} — fully free.`
        : `${p.name}: busy ${p.busy.join(", ")} (Dubai) on ${dateStr}.`,
    );
    if (notConnected.length > 0) {
      lines.push(`No Microsoft 365 connection for ${notConnected.join(", ")} — availability unknown.`);
    }
    if (failed.length > 0) lines.push(`Couldn't check ${failed.join(", ")} (calendar lookup failed).`);
    return {
      ok: true,
      data: { summary: lines.join("\n") || "No calendars could be checked.", date: dateStr },
    };
  },
});

// ---------------------------------------------------------------------
// meeting.find_free_slot — earliest common free slot
// ---------------------------------------------------------------------
defineCapability({
  id: "meeting.find_free_slot",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "find_free_slot",
  description:
    "Find the earliest common FREE slot (within working hours 08:00–18:00 Dubai) for the requester and one or more roster colleagues on/after a given date — WITHOUT booking anything. Use for \"when are X and I both free?\". date must be absolute YYYY-MM-DD. To actually book, follow up with schedule_internal_meeting.",
  slashAliases: { en: ["/find-slot"] },
  inputSchema: {
    type: "object",
    properties: {
      people: {
        type: "array",
        items: { type: "string" },
        description: "Roster colleague names (the requester is always included).",
      },
      date: { type: "string", description: "Absolute date YYYY-MM-DD to search from." },
      durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
    },
    required: ["people", "date"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: [...SCHEDULER_ROLES],
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["When are Selin and I both free on Friday?", "Find a free hour with Gökhan next Monday"],
    ar: ["متى نكون أنا وسيلين متفرغين يوم الجمعة؟"],
    fr: ["Quand Selin et moi sommes-nous libres vendredi ?"],
  },
  async run(input, ctx) {
    const dateStr = typeof input.date === "string" ? input.date.trim() : "";
    if (!YMD.test(dateStr)) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage: "date must be YYYY-MM-DD — resolve relative dates against today's date first.",
      };
    }
    // Task #570 — a search window that ends before now can never contain
    // a bookable slot; reject clearly instead of returning "no slot".
    {
      const w = dayWindow(dateStr);
      if (w && w.start.getTime() + 5 * 24 * 3600 * 1000 <= Date.now()) {
        return {
          ok: false,
          errorCode: "past_time",
          errorMessage: `${dateStr} is in the past — pick today or a future date to search for free slots.`,
        };
      }
    }
    const resolved = await resolvePeople(input, ctx);
    if (resolved.kind === "result") return resolved.result as never;
    const people = resolved.people.some((p) => p.userId === ctx.persona.id)
      ? resolved.people
      : [{ userId: ctx.persona.id, name: ctx.persona.name, email: "" }, ...resolved.people];
    const durationMin = Math.max(15, Math.min(480, Number(input.durationMinutes ?? 30)));

    const dayStart = dubaiWallToUtc(dateStr, `${String(WORK_START_HOUR).padStart(2, "0")}:00`);
    if (!dayStart) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "Couldn't parse that date." };
    }
    // Search up to 5 working-window days out so "Friday" spills honestly
    // into the following days when fully booked.
    const searchEnd = new Date(dayStart.getTime() + 5 * 24 * 3600 * 1000);
    const earliest = new Date(Math.max(dayStart.getTime(), Date.now()));
    const avail = await collectBusyTimes({ people, windowStart: earliest, windowEnd: searchEnd });
    const slot = findEarliestCommonSlot({
      busy: avail.busy,
      durationMin,
      earliest,
      latest: searchEnd,
    });
    const notes: string[] = [];
    if (avail.notConnected.length > 0) {
      notes.push(
        `No Microsoft 365 connection for ${avail.notConnected.map((p) => p.name).join(", ")} — their availability couldn't be checked.`,
      );
    }
    if (avail.failed.length > 0) {
      notes.push(`Couldn't check ${avail.failed.map((p) => p.name).join(", ")} (calendar lookup failed).`);
    }
    if (!slot) {
      return {
        ok: true,
        data: {
          slot: null,
          summary: `No common free ${durationMin}-minute slot within working hours (0${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 Dubai) in the ${people.map((p) => p.name).join(", ")} calendars over the next few days.${notes.length ? ` ${notes.join(" ")}` : ""}`,
        },
      };
    }
    const whenLabel = `${fmtDubai(slot.start)}–${fmtDubai(slot.end).slice(-5)} (Dubai)`;
    return {
      ok: true,
      data: {
        slot: { start: slot.start.toISOString(), end: slot.end.toISOString(), whenLabel },
        people: people.map((p) => p.name),
        summary: `Earliest common free slot: ${whenLabel} for ${people.map((p) => p.name).join(", ")}.${notes.length ? ` ${notes.join(" ")}` : ""} Want me to book it?`,
      },
    };
  },
});
