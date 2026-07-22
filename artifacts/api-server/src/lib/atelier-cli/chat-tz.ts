/**
 * Task #581 — per-turn timezone support for the chat assistant.
 *
 * The mobile app and web portal both render meeting times in the
 * DEVICE's local timezone, but the chat resolver used to match typed
 * times against Dubai wall-clock — so "reschedule tomorrow's 7am"
 * failed for anyone outside UTC+4. Both chat clients now send the
 * device's IANA timezone with each turn; these pure helpers convert
 * between UTC and that zone's wall clock. Dubai remains the fallback
 * when no (or an invalid) timezone reaches the server.
 *
 * Pure + deterministic (Intl only) so the probe suite can cover them
 * without a database or network.
 */

export const DEFAULT_CHAT_TZ = "Asia/Dubai";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Coerce an untrusted client value to a usable IANA zone (Dubai fallback). */
export function normalizeChatTz(tz: unknown): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_CHAT_TZ;
}

const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    partsFmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of a UTC instant in `tz`. */
export function wallParts(
  d: Date,
  tz: string,
): { ymd: string; hm: string; weekday: number } {
  const parts = partsFmt(tz).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // hour12:false can yield "24" for midnight in some engines.
  const hour = get("hour") === "24" ? "00" : get("hour");
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  // Weekday computed from the wall date itself (0=Sunday).
  const wd = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return { ymd, hm: `${hour}:${get("minute")}`, weekday: wd };
}

/** "YYYY-MM-DD HH:MM" of a UTC instant rendered in `tz`. */
export function fmtInTz(d: Date, tz: string): string {
  const { ymd, hm } = wallParts(d, tz);
  return `${ymd} ${hm}`;
}

/**
 * "2026-07-23" + "07:30" wall clock in `tz` → UTC instant.
 * Two-pass offset resolution handles DST zones correctly for all
 * non-ambiguous wall times (ambiguous DST-overlap times resolve to
 * one of the two valid instants, which is fine for scheduling).
 */
export function wallToUtcInTz(dateYmd: string, timeHm: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeHm.trim());
  if (!m || !t) return null;
  const wallMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wallMs)) return null;
  let utc = wallMs;
  // Iterate: offset at the guessed instant refines the guess.
  for (let i = 0; i < 2; i++) {
    const p = wallParts(new Date(utc), tz);
    const seen = Date.UTC(
      Number(p.ymd.slice(0, 4)),
      Number(p.ymd.slice(5, 7)) - 1,
      Number(p.ymd.slice(8, 10)),
      Number(p.hm.slice(0, 2)),
      Number(p.hm.slice(3, 5)),
    );
    utc += wallMs - seen;
  }
  return new Date(utc);
}

/** Human label for time strings: "Dubai" for the firm default, else "your time (Europe/Istanbul)". */
export function tzShortLabel(tz: string): string {
  if (tz === DEFAULT_CHAT_TZ) return "Dubai";
  return `your time, ${tz}`;
}

/** Today's / tomorrow's wall date (YYYY-MM-DD) in `tz`. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return wallParts(now, tz).ymd;
}
export function tomorrowInTz(tz: string, now: Date = new Date()): string {
  // +24h then re-read the wall date; DST 23/25h days still land on the
  // next calendar day because we read the WALL date, not raw math.
  return wallParts(new Date(now.getTime() + 24 * 3600 * 1000), tz).ymd;
}
