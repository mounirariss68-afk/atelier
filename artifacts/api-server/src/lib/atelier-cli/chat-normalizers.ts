// Pure, side-effect-free normalization helpers shared by the chat
// capability layer AND the lightweight resolvers. Kept in their own
// module deliberately: resolvers are imported by non-chat routes/tools,
// so these helpers must NOT ride along with capability-registration
// modules (which pull in the agent stack and its hard env checks).

/**
 * Accent/diacritic-insensitive name folding so "gokhan" matches
 * "Gökhan Güney". Turkish dotless ı (and dotted İ) do NOT decompose
 * under NFKD, so they're mapped explicitly before the generic
 * combining-mark strip handles ş/ü/ö/ç/ğ/é/….
 */
export function foldRosterName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae");
}

/**
 * Tolerant location answer parsing. Accepts natural phrasings
 * ("in person", "In-Person", "teams", "face to face", "virtual",
 * "at the office"…) and returns the canonical enum value, or null
 * when unrecognizable (conflicting keywords also return null so the
 * question is re-asked rather than silently guessed).
 */
export function normalizeLocationAnswer(raw: unknown): "online" | "in_person" | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  const online = /\b(online|teams|team|virtual|virtually|video|remote|remotely|zoom|webex|meet|call|digital)\b/.test(s);
  const inPerson = /\b(in ?person|person|face to face|f2f|office|on ?site|onsite|physical|physically|irl|room)\b/.test(s);
  if (inPerson && !online) return "in_person";
  if (online && !inPerson) return "online";
  return null;
}

/**
 * Tolerant start-time parsing. Accepts "8", "8am", "8.00", "8:00am",
 * "0800", "8 am", "19:30", "7:30 pm" and returns canonical "HH:MM"
 * (24h), or null when unparseable.
 */
export function normalizeTimeInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/\s+/g, "").replace(/h(rs?)?$/, "");
  if (!s) return null;
  let h: number;
  let min: number;
  let ap: string | undefined;
  let m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/);
  if (m) {
    h = Number(m[1]);
    min = m[2] ? Number(m[2]) : 0;
    ap = m[3];
  } else if ((m = s.match(/^(\d{1,2})(\d{2})(am|pm|a|p)?$/)) && s.replace(/am|pm|a|p/g, "").length >= 3) {
    // Military-style "800" / "0800" / "1930".
    h = Number(m[1]);
    min = Number(m[2]);
    ap = m[3];
  } else {
    return null;
  }
  if (ap === "pm" || ap === "p") {
    if (h < 12) h += 12;
  } else if (ap === "am" || ap === "a") {
    if (h === 12) h = 0;
  }
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Tappable-chip contract for the location clarification. */
export const LOCATION_SUGGESTIONS = [
  { id: "online", label: "Online (Teams)" },
  { id: "in_person", label: "In person" },
];
