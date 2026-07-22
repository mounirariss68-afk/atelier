/**
 * Task #570 — ONE shared roster-attendee resolver for every meeting
 * surface (internal scheduling, client-meeting colleagues, attendee
 * edits, availability checks). Accent/diacritic-insensitive: the org
 * roster is fetched and folded in JS (`foldRosterName`) because a raw
 * SQL ILIKE cannot fold ö/ü/ş/ı etc.
 *
 * Raw email addresses are refused gracefully here (roster-first policy:
 * external guests must be CRM contacts on a client meeting).
 */
import { eq } from "drizzle-orm";
import { db, atelierUsers } from "@workspace/db";
import { foldRosterName } from "./chat-normalizers.js";

export interface RosterAttendee {
  userId: string;
  name: string;
  email: string;
}

/** Pure — used by the raw-email refusal and its probes. */
export function looksLikeEmailAddress(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/** Pure — "me" / "myself" / the requester's own name folds to self. */
export function isSelfReference(name: string, personaName: string): boolean {
  const n = foldRosterName(name.trim());
  if (n === "me" || n === "myself" || n === "i") return true;
  const self = foldRosterName(personaName);
  return n.length > 1 && (self === n || self.startsWith(`${n} `) || self.endsWith(` ${n}`) || self === n);
}

export type AttendeeResolution =
  | { kind: "resolved"; people: RosterAttendee[]; includesSelf: boolean }
  | { kind: "result"; result: { ok: boolean; [k: string]: unknown } };

/**
 * Resolve free-text colleague names against the org roster
 * (accent-insensitive, disambiguation on multiple matches, never the
 * requester unless `allowSelf`). Returns either the resolved people or
 * a ToolResult envelope (not_found / disambiguation / refusal) the
 * capability should return verbatim.
 */
export async function resolveRosterAttendees(
  names: string[],
  persona: { id: string; orgId: string; name: string },
  opts: { allowSelf?: boolean } = {},
): Promise<AttendeeResolution> {
  const roster = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email })
    .from(atelierUsers)
    .where(eq(atelierUsers.orgId, persona.orgId));
  const people: RosterAttendee[] = [];
  let includesSelf = false;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (looksLikeEmailAddress(name)) {
      return {
        kind: "result",
        result: {
          ok: false,
          errorCode: "unsupported",
          errorMessage:
            `I can't invite raw email addresses (${name}) — I only invite roster colleagues by name, and external guests via a client meeting with a CRM contact. Add the person as a contact on the account first and I'll invite them properly.`,
        },
      };
    }
    if (opts.allowSelf && isSelfReference(name, persona.name)) {
      includesSelf = true;
      continue;
    }
    const needle = foldRosterName(name);
    const matches = roster
      .filter(
        (u) =>
          u.id !== persona.id &&
          needle.length > 0 &&
          foldRosterName(u.name).includes(needle),
      )
      .slice(0, 6);
    if (matches.length === 0) {
      // The only roster match may be the requester ("check my calendar").
      if (opts.allowSelf && foldRosterName(persona.name).includes(needle)) {
        includesSelf = true;
        continue;
      }
      return {
        kind: "result",
        result: {
          ok: false,
          errorCode: "not_found",
          errorMessage: `I couldn't find a colleague named "${name}" on the roster.`,
        },
      };
    }
    if (matches.length > 1) {
      const options = matches
        .slice(0, 5)
        .map((m) => ({ id: m.id, label: m.name, secondary: m.email }));
      return {
        kind: "result",
        result: {
          ok: true,
          data: { prompt: `Which "${name}" did you mean?`, options },
          disambiguation: { kind: "user", options },
        },
      };
    }
    const m = matches[0]!;
    if (!people.some((p) => p.userId === m.id)) {
      people.push({ userId: m.id, name: m.name, email: m.email });
    }
  }
  return { kind: "resolved", people, includesSelf };
}
