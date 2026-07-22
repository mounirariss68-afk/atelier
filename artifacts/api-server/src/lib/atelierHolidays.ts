/**
 * Task #602 — curated public-holiday dataset for Turkey + MENA markets the
 * firm operates in (TR, AE, SA, QA, KW, BH, OM, EG, JO), years 2026–2027.
 *
 * Islamic (Hijri) dates are moon-sighting dependent: those rows carry
 * `tentative: true` and reflect the commonly published astronomical
 * estimates. Fixed-date civil holidays are exact. This is deliberately a
 * static curated dataset (no external API) so the surface works offline
 * and deterministically; extend the table when 2028 approaches.
 *
 * Also owns the weekend + next-working-day logic used for auto-reply
 * return dates. Weekend days are configurable per country; every covered
 * market is currently Sat–Sun (Saudi moved in 2013, the Gulf states by
 * 2022), so the default applies everywhere — the map exists so a future
 * Fri–Sat market is a one-line change.
 */

export const HOLIDAY_COUNTRIES = [
  "TR",
  "AE",
  "SA",
  "QA",
  "KW",
  "BH",
  "OM",
  "EG",
  "JO",
] as const;
export type HolidayCountry = (typeof HOLIDAY_COUNTRIES)[number];

export const COUNTRY_NAMES: Record<HolidayCountry, string> = {
  TR: "Turkey",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  QA: "Qatar",
  KW: "Kuwait",
  BH: "Bahrain",
  OM: "Oman",
  EG: "Egypt",
  JO: "Jordan",
};

export interface PublicHoliday {
  /** ISO date (YYYY-MM-DD), inclusive start. */
  date: string;
  /** ISO date (YYYY-MM-DD), inclusive end (same as date for 1-day). */
  endDate: string;
  name: string;
  country: HolidayCountry;
  /** Islamic-calendar dates subject to moon sighting. */
  tentative: boolean;
}

function h(
  country: HolidayCountry,
  date: string,
  name: string,
  opts?: { end?: string; tentative?: boolean },
): PublicHoliday {
  return {
    date,
    endDate: opts?.end ?? date,
    name,
    country,
    tentative: opts?.tentative ?? false,
  };
}

// Common Islamic dates (astronomical estimates):
// 2026: Eid al-Fitr ~Mar 20, Arafat ~May 26, Eid al-Adha ~May 27,
//       Hijri New Year ~Jun 16, Mawlid ~Aug 25, Ramadan start ~Feb 18,
//       Isra & Mi'raj ~Jan 16.
// 2027: Eid al-Fitr ~Mar 10, Arafat ~May 15, Eid al-Adha ~May 16,
//       Hijri New Year ~Jun 6, Mawlid ~Aug 14, Isra & Mi'raj ~Jan 5.
const T = { tentative: true };

export const PUBLIC_HOLIDAYS: PublicHoliday[] = [
  // ---- Turkey (TR) ----
  h("TR", "2026-01-01", "New Year's Day"),
  h("TR", "2026-03-20", "Ramazan Bayramı (Eid al-Fitr)", { end: "2026-03-22", ...T }),
  h("TR", "2026-04-23", "National Sovereignty and Children's Day"),
  h("TR", "2026-05-01", "Labour and Solidarity Day"),
  h("TR", "2026-05-19", "Commemoration of Atatürk, Youth and Sports Day"),
  h("TR", "2026-05-26", "Kurban Bayramı (Eid al-Adha)", { end: "2026-05-29", ...T }),
  h("TR", "2026-07-15", "Democracy and National Unity Day"),
  h("TR", "2026-08-30", "Victory Day"),
  h("TR", "2026-10-29", "Republic Day"),
  h("TR", "2027-01-01", "New Year's Day"),
  h("TR", "2027-03-10", "Ramazan Bayramı (Eid al-Fitr)", { end: "2027-03-12", ...T }),
  h("TR", "2027-04-23", "National Sovereignty and Children's Day"),
  h("TR", "2027-05-01", "Labour and Solidarity Day"),
  h("TR", "2027-05-15", "Kurban Bayramı (Eid al-Adha)", { end: "2027-05-18", ...T }),
  h("TR", "2027-05-19", "Commemoration of Atatürk, Youth and Sports Day"),
  h("TR", "2027-07-15", "Democracy and National Unity Day"),
  h("TR", "2027-08-30", "Victory Day"),
  h("TR", "2027-10-29", "Republic Day"),

  // ---- United Arab Emirates (AE) ----
  h("AE", "2026-01-01", "New Year's Day"),
  h("AE", "2026-03-19", "Eid al-Fitr holiday", { end: "2026-03-22", ...T }),
  h("AE", "2026-05-26", "Arafat Day", T),
  h("AE", "2026-05-27", "Eid al-Adha", { end: "2026-05-29", ...T }),
  h("AE", "2026-06-16", "Islamic New Year", T),
  h("AE", "2026-08-25", "Prophet Muhammad's Birthday", T),
  h("AE", "2026-12-01", "Commemoration Day"),
  h("AE", "2026-12-02", "National Day", { end: "2026-12-03" }),
  h("AE", "2027-01-01", "New Year's Day"),
  h("AE", "2027-03-09", "Eid al-Fitr holiday", { end: "2027-03-12", ...T }),
  h("AE", "2027-05-15", "Arafat Day", T),
  h("AE", "2027-05-16", "Eid al-Adha", { end: "2027-05-18", ...T }),
  h("AE", "2027-06-06", "Islamic New Year", T),
  h("AE", "2027-08-14", "Prophet Muhammad's Birthday", T),
  h("AE", "2027-12-01", "Commemoration Day"),
  h("AE", "2027-12-02", "National Day", { end: "2027-12-03" }),

  // ---- Saudi Arabia (SA) ----
  h("SA", "2026-02-22", "Founding Day"),
  h("SA", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-23", ...T }),
  h("SA", "2026-05-26", "Arafat Day", T),
  h("SA", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-30", ...T }),
  h("SA", "2026-09-23", "Saudi National Day"),
  h("SA", "2027-02-22", "Founding Day"),
  h("SA", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-13", ...T }),
  h("SA", "2027-05-15", "Arafat Day", T),
  h("SA", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-19", ...T }),
  h("SA", "2027-09-23", "Saudi National Day"),

  // ---- Qatar (QA) ----
  h("QA", "2026-02-10", "National Sports Day"),
  h("QA", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-22", ...T }),
  h("QA", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-29", ...T }),
  h("QA", "2026-12-18", "Qatar National Day"),
  h("QA", "2027-02-09", "National Sports Day"),
  h("QA", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-12", ...T }),
  h("QA", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-18", ...T }),
  h("QA", "2027-12-18", "Qatar National Day"),

  // ---- Kuwait (KW) ----
  h("KW", "2026-01-01", "New Year's Day"),
  h("KW", "2026-01-16", "Isra and Mi'raj", T),
  h("KW", "2026-02-25", "National Day"),
  h("KW", "2026-02-26", "Liberation Day"),
  h("KW", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-22", ...T }),
  h("KW", "2026-05-26", "Arafat Day", T),
  h("KW", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-29", ...T }),
  h("KW", "2026-06-16", "Islamic New Year", T),
  h("KW", "2026-08-25", "Prophet Muhammad's Birthday", T),
  h("KW", "2027-01-01", "New Year's Day"),
  h("KW", "2027-01-05", "Isra and Mi'raj", T),
  h("KW", "2027-02-25", "National Day"),
  h("KW", "2027-02-26", "Liberation Day"),
  h("KW", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-12", ...T }),
  h("KW", "2027-05-15", "Arafat Day", T),
  h("KW", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-18", ...T }),
  h("KW", "2027-06-06", "Islamic New Year", T),
  h("KW", "2027-08-14", "Prophet Muhammad's Birthday", T),

  // ---- Bahrain (BH) ----
  h("BH", "2026-01-01", "New Year's Day"),
  h("BH", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-22", ...T }),
  h("BH", "2026-05-01", "Labour Day"),
  h("BH", "2026-05-26", "Arafat Day", T),
  h("BH", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-29", ...T }),
  h("BH", "2026-06-16", "Islamic New Year", T),
  h("BH", "2026-06-24", "Ashura", { end: "2026-06-25", ...T }),
  h("BH", "2026-08-25", "Prophet Muhammad's Birthday", T),
  h("BH", "2026-12-16", "National Day", { end: "2026-12-17" }),
  h("BH", "2027-01-01", "New Year's Day"),
  h("BH", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-12", ...T }),
  h("BH", "2027-05-01", "Labour Day"),
  h("BH", "2027-05-15", "Arafat Day", T),
  h("BH", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-18", ...T }),
  h("BH", "2027-06-06", "Islamic New Year", T),
  h("BH", "2027-06-13", "Ashura", { end: "2027-06-14", ...T }),
  h("BH", "2027-08-14", "Prophet Muhammad's Birthday", T),
  h("BH", "2027-12-16", "National Day", { end: "2027-12-17" }),

  // ---- Oman (OM) ----
  h("OM", "2026-01-01", "New Year's Day"),
  h("OM", "2026-01-16", "Isra and Mi'raj", T),
  h("OM", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-23", ...T }),
  h("OM", "2026-05-26", "Arafat Day", T),
  h("OM", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-30", ...T }),
  h("OM", "2026-06-16", "Islamic New Year", T),
  h("OM", "2026-08-25", "Prophet Muhammad's Birthday", T),
  h("OM", "2026-11-18", "National Day", { end: "2026-11-19" }),
  h("OM", "2027-01-01", "New Year's Day"),
  h("OM", "2027-01-05", "Isra and Mi'raj", T),
  h("OM", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-13", ...T }),
  h("OM", "2027-05-15", "Arafat Day", T),
  h("OM", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-19", ...T }),
  h("OM", "2027-06-06", "Islamic New Year", T),
  h("OM", "2027-08-14", "Prophet Muhammad's Birthday", T),
  h("OM", "2027-11-18", "National Day", { end: "2027-11-19" }),

  // ---- Egypt (EG) ----
  h("EG", "2026-01-07", "Coptic Christmas Day"),
  h("EG", "2026-01-25", "Revolution Day (January 25)"),
  h("EG", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-22", ...T }),
  h("EG", "2026-04-13", "Sham El-Nessim"),
  h("EG", "2026-04-25", "Sinai Liberation Day"),
  h("EG", "2026-05-01", "Labour Day"),
  h("EG", "2026-05-26", "Arafat Day", T),
  h("EG", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-29", ...T }),
  h("EG", "2026-06-16", "Islamic New Year", T),
  h("EG", "2026-06-30", "June 30 Revolution Day"),
  h("EG", "2026-07-23", "Revolution Day (July 23)"),
  h("EG", "2026-08-25", "Prophet Muhammad's Birthday", T),
  h("EG", "2026-10-06", "Armed Forces Day"),
  h("EG", "2027-01-07", "Coptic Christmas Day"),
  h("EG", "2027-01-25", "Revolution Day (January 25)"),
  h("EG", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-12", ...T }),
  h("EG", "2027-04-25", "Sinai Liberation Day"),
  h("EG", "2027-05-01", "Labour Day"),
  h("EG", "2027-05-03", "Sham El-Nessim"),
  h("EG", "2027-05-15", "Arafat Day", T),
  h("EG", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-18", ...T }),
  h("EG", "2027-06-06", "Islamic New Year", T),
  h("EG", "2027-06-30", "June 30 Revolution Day"),
  h("EG", "2027-07-23", "Revolution Day (July 23)"),
  h("EG", "2027-08-14", "Prophet Muhammad's Birthday", T),
  h("EG", "2027-10-06", "Armed Forces Day"),

  // ---- Jordan (JO) ----
  h("JO", "2026-01-01", "New Year's Day"),
  h("JO", "2026-03-20", "Eid al-Fitr holiday", { end: "2026-03-22", ...T }),
  h("JO", "2026-05-01", "Labour Day"),
  h("JO", "2026-05-25", "Independence Day"),
  h("JO", "2026-05-27", "Eid al-Adha holiday", { end: "2026-05-29", ...T }),
  h("JO", "2026-06-16", "Islamic New Year", T),
  h("JO", "2026-08-25", "Prophet Muhammad's Birthday", T),
  h("JO", "2026-12-25", "Christmas Day"),
  h("JO", "2027-01-01", "New Year's Day"),
  h("JO", "2027-03-10", "Eid al-Fitr holiday", { end: "2027-03-12", ...T }),
  h("JO", "2027-05-01", "Labour Day"),
  h("JO", "2027-05-16", "Eid al-Adha holiday", { end: "2027-05-18", ...T }),
  h("JO", "2027-05-25", "Independence Day"),
  h("JO", "2027-06-06", "Islamic New Year", T),
  h("JO", "2027-08-14", "Prophet Muhammad's Birthday", T),
  h("JO", "2027-12-25", "Christmas Day"),
];

/** All holidays intersecting [start, end] (both YYYY-MM-DD, inclusive),
 *  optionally restricted to a set of countries. */
export function holidaysInRange(
  start: string,
  end: string,
  countries?: ReadonlySet<string> | null,
): PublicHoliday[] {
  return PUBLIC_HOLIDAYS.filter(
    (p) =>
      p.date <= end &&
      p.endDate >= start &&
      (!countries || countries.size === 0 || countries.has(p.country)),
  ).sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
}

// ------------------------------------------------------------------
// Weekend + next-working-day logic
// ------------------------------------------------------------------

/** Weekend days per country as JS getUTCDay() numbers (0=Sun..6=Sat).
 *  Default Sat–Sun; the map allows per-country overrides. */
const WEEKENDS: Partial<Record<string, readonly number[]>> = {
  // All currently covered markets observe Sat–Sun. Add e.g.
  // XX: [5, 6] (Fri–Sat) here if a market with a different weekend joins.
};
const DEFAULT_WEEKEND: readonly number[] = [6, 0]; // Sat, Sun

export function weekendDaysFor(country: string | null | undefined): readonly number[] {
  return (country && WEEKENDS[country.toUpperCase()]) || DEFAULT_WEEKEND;
}

/** IANA timezone per covered market, for scheduling OOO events and
 *  auto-reply windows in the leave-taker's own local time. The firm's
 *  home base (Dubai) is the fallback for uncovered/blank countries. */
const COUNTRY_TIMEZONES: Record<string, string> = {
  TR: "Europe/Istanbul",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
  OM: "Asia/Muscat",
  EG: "Africa/Cairo",
  JO: "Asia/Amman",
};

export function timezoneFor(country: string | null | undefined): string {
  const code = countryToCode(country);
  return (code && COUNTRY_TIMEZONES[code]) || "Asia/Dubai";
}

/** Normalize a free-text roster country to a dataset code, when possible. */
export function countryToCode(country: string | null | undefined): HolidayCountry | null {
  if (!country) return null;
  const c = country.trim();
  if (!c) return null;
  const upper = c.toUpperCase();
  if ((HOLIDAY_COUNTRIES as readonly string[]).includes(upper)) {
    return upper as HolidayCountry;
  }
  const byName: Record<string, HolidayCountry> = {
    turkey: "TR",
    "türkiye": "TR",
    turkiye: "TR",
    "united arab emirates": "AE",
    uae: "AE",
    emirates: "AE",
    dubai: "AE",
    "abu dhabi": "AE",
    "saudi arabia": "SA",
    ksa: "SA",
    qatar: "QA",
    kuwait: "KW",
    bahrain: "BH",
    oman: "OM",
    egypt: "EG",
    jordan: "JO",
  };
  return byName[c.toLowerCase()] ?? null;
}

function isHolidayFor(dateYmd: string, country: HolidayCountry | null): boolean {
  if (!country) return false;
  return PUBLIC_HOLIDAYS.some(
    (p) => p.country === country && p.date <= dateYmd && p.endDate >= dateYmd,
  );
}

function addDaysYmd(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * First working day strictly after `lastLeaveDay` for someone based in
 * `country`: skips that country's weekend days and its public holidays.
 * Falls back to plain weekend-skipping when the country isn't covered.
 */
export function nextWorkingDayAfter(
  lastLeaveDay: string,
  country: string | null | undefined,
): string {
  const code = countryToCode(country);
  const weekend = weekendDaysFor(code ?? country);
  let d = addDaysYmd(lastLeaveDay, 1);
  let guard = 0;
  while (guard < 60) {
    guard += 1;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (!weekend.includes(dow) && !isHolidayFor(d, code)) return d;
    d = addDaysYmd(d, 1);
  }
  return d;
}
