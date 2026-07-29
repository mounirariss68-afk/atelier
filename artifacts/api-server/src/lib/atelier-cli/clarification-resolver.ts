/**
 * Task #740 — shared clarification resolver.
 *
 * One subsystem owns the resolution of a user's reply to a pending
 * clarification: given the pending question (tool, asked fields,
 * partial args) and conversation context (typed session facts), it
 * resolves the reply into correctly-TYPED argument values instead of
 * raw-text merges — relative dates ("tomorrow", "next Tuesday"),
 * durations ("5 nights"), referential answers ("same dates I
 * specified"), ordinal choices ("the second one"), and explicit
 * confirmations ("confirmed") all resolve deterministically, with an
 * optional model-assisted fallback for free-form replies.
 *
 * Design rules:
 * - Everything except `resolveWithModel` is PURE (offline probes).
 * - Deterministic degradation: a parse miss NEVER clears pending state
 *   — it falls back to the legacy raw merge (the tool re-validates and
 *   re-asks) or routes to the model WITH the question as context.
 * - Locale-aware: EN / Turkish / Arabic phrasing, Arabic-Indic digits.
 * - Feature flag: ATELIER_CLI_CLARIFICATION_RESOLVER = on (default) |
 *   off (legacy path, no data migration needed to flip back).
 */

import { normalizeControlIntent, type ControlIntent } from "./session-facts.js";

export const RESOLVER_CONTRACT_VERSION = 1;

export type ResolverMode = "on" | "off";

export function clarificationResolverMode(): ResolverMode {
  const v = String(process.env.ATELIER_CLI_CLARIFICATION_RESOLVER ?? "on").toLowerCase();
  return v === "off" ? "off" : "on";
}

export interface PendingFieldSpec {
  field: string;
  label?: string;
  hint?: string;
  inputType?: string;
  options?: string[];
}

export interface PendingClarificationSpec {
  tool: string;
  field: string;
  question: string;
  partial: Record<string, unknown>;
  fields?: PendingFieldSpec[] | null;
}

export interface FactRow {
  kind: string;
  key: string;
  value: unknown;
  display: string;
}

export type ResolverOutcome =
  /** Typed field values resolved — merge each and re-run the tool. */
  | { kind: "values"; values: Record<string, string>; via: string }
  /** Explicit confirmation — run the tool with current partial (+fills). */
  | { kind: "confirm"; values: Record<string, string>; via: string }
  /** Explicit cancel/decline of the pending question. */
  | { kind: "cancel" }
  /** Plausibly an answer but not deterministically parseable. */
  | { kind: "unparsed" }
  /** Not an answer — route to the model WITH the pending question. */
  | { kind: "fresh_request" };

// ---------------------------------------------------------------------
// Digit + text normalization (Arabic-Indic digits, RTL marks)
// ---------------------------------------------------------------------

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = AR_DIGITS.indexOf(ch);
    if (i >= 0) return String(i);
    const j = FA_DIGITS.indexOf(ch);
    return j >= 0 ? String(j) : ch;
  });
}

const clean = (s: string): string =>
  normalizeDigits(s)
    .replace(/[\u200e\u200f\u061c]/g, "") // LRM/RLM/ALM marks
    .replace(/\s+/g, " ")
    .trim();

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14,
  bir: 1, iki: 2, "üç": 3, "dört": 4, "beş": 5, "altı": 6, yedi: 7,
  sekiz: 8, dokuz: 9, on: 10,
  "واحد": 1, "اثنين": 2, "اثنان": 2, "ثلاثة": 3, "أربعة": 4, "اربعة": 4,
  "خمسة": 5, "ستة": 6, "سبعة": 7, "ثمانية": 8, "تسعة": 9, "عشرة": 10,
};

const wordOrDigitNumber = (tok: string): number | null => {
  const t = tok.toLowerCase();
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
};

// ---------------------------------------------------------------------
// Timezone-aware date math
// ---------------------------------------------------------------------

/** Y-M-D of `now` as seen on the wall clock of `tz`. */
export function wallDateInTz(now: Date, tz: string): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

const isoOf = (y: number, m: number, d: number): string => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
};

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

const WEEKDAYS: Array<{ idx: number; names: string[] }> = [
  { idx: 0, names: ["sunday", "sun", "pazar", "الأحد", "الاحد"] },
  { idx: 1, names: ["monday", "mon", "pazartesi", "الاثنين", "الإثنين"] },
  { idx: 2, names: ["tuesday", "tue", "tues", "salı", "sali", "الثلاثاء"] },
  { idx: 3, names: ["wednesday", "wed", "çarşamba", "carsamba", "الأربعاء", "الاربعاء"] },
  { idx: 4, names: ["thursday", "thu", "thurs", "perşembe", "persembe", "الخميس"] },
  { idx: 5, names: ["friday", "fri", "cuma", "الجمعة"] },
  { idx: 6, names: ["saturday", "sat", "cumartesi", "السبت"] },
];

/**
 * Parse a relative or explicit date phrase into a resolved ISO date in
 * the given timezone. Returns null when the text is not a date.
 * Handles: ISO dates, today/tomorrow/day-after (EN/TR/AR), weekday
 * names ("next Tuesday", "cuma", "الخميس"), "in N days/weeks",
 * "N gün sonra", "بعد N أيام", and "D Mon"/"Mon D" month forms.
 */
export function parseRelativeDate(raw: string, tz: string, now: Date = new Date()): string | null {
  const t = clean(raw).toLowerCase();
  if (!t || t.length > 60) return null;
  const today = wallDateInTz(now, tz);
  const todayIso = isoOf(today.y, today.m, today.d);

  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1]!;

  if (/^(today|bugün|bugun|اليوم)$/.test(t)) return todayIso;
  if (/^(tomorrow|tmrw|tmr|yarın|yarin|غدا|غداً|بكرة|بكره)$/.test(t)) return addDaysIso(todayIso, 1);
  if (/^(day after tomorrow|öbür gün|obur gun|بعد غد|بعد غدٍ)$/.test(t)) return addDaysIso(todayIso, 2);

  // "in N days/weeks" | "N gün/hafta sonra" | "بعد N يوم/أيام/أسبوع"
  const rel =
    t.match(/^in (\S+) (day|days|week|weeks)$/) ||
    t.match(/^(\S+) (gün|gun|hafta) sonra$/) ||
    t.match(/^بعد (\S+) (يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع)$/);
  if (rel) {
    const n = wordOrDigitNumber(rel[1]!);
    if (n !== null) {
      const isWeek = /week|hafta|أسبوع|اسبوع|أسابيع|اسابيع/.test(rel[2]!);
      return addDaysIso(todayIso, isWeek ? n * 7 : n);
    }
  }

  // Weekday names (optionally prefixed "next"/"this"/"on" or Arabic "يوم").
  const wd = t.replace(/^(next|this|on|coming|önümüzdeki|onumuzdeki|gelecek|يوم|القادم)\s+/g, "").trim();
  for (const w of WEEKDAYS) {
    if (w.names.includes(wd)) {
      // JS weekday of today's wall date.
      const jsDow = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
      let delta = (w.idx - jsDow + 7) % 7;
      if (delta === 0) delta = 7; // "Tuesday" said on a Tuesday → next week
      return addDaysIso(todayIso, delta);
    }
  }

  // "3 March" / "March 3" / "3 Mar 2027"
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const md =
    t.match(/^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/) ||
    t.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/);
  if (md) {
    const a = md[1]!, b = md[2]!;
    const dayTok = /^\d/.test(a) ? a : b;
    const monTok = /^\d/.test(a) ? b : a;
    const mi = MONTHS.findIndex((m) => monTok.startsWith(m));
    const dayN = Number(dayTok);
    if (mi >= 0 && dayN >= 1 && dayN <= 31) {
      const year = md[3] ? Number(md[3]) : today.y;
      let out = isoOf(year, mi + 1, dayN);
      // No explicit year and the date already passed → next year.
      if (!md[3] && out < todayIso) out = isoOf(year + 1, mi + 1, dayN);
      return out;
    }
  }
  return null;
}

/** "5 nights", "for 5 nights", "5 gece", "٥ ليال" → night count. */
export function parseNightsDuration(raw: string): number | null {
  const t = clean(raw).toLowerCase();
  const m =
    t.match(/^(?:for |stay(?:ing)? )?(\S+) ?(night|nights|gece|ليال|ليالي|ليلة)$/) ||
    t.match(/^(\S+) ?(night|nights|gece)\b.{0,12}$/);
  if (!m) return null;
  const n = wordOrDigitNumber(m[1]!);
  return n !== null && n >= 1 && n <= 60 ? n : null;
}

/** "the second one", "option 2", "2nd", "ikinci", "الثاني" → 0-based index. */
export function parseOrdinalChoice(raw: string, optionCount: number): number | null {
  const t = clean(raw).toLowerCase().replace(/^(the|pick|choose|take|option|number|no\.?)\s+/g, "").trim();
  const ORDINALS: Record<string, number> = {
    first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3,
    "4th": 3, fifth: 4, "5th": 4, last: -1,
    birinci: 0, ilk: 0, ikinci: 1, "üçüncü": 2, ucuncu: 2, "dördüncü": 3,
    sonuncu: -1,
    "الأول": 0, "الاول": 0, "الثاني": 1, "الثالث": 2, "الرابع": 3, "الأخير": -1, "الاخير": -1,
  };
  const bare = t.replace(/\s+(one|option|seçenek|secenek|خيار)$/g, "").trim();
  let idx: number | null = null;
  if (bare in ORDINALS) idx = ORDINALS[bare]!;
  else if (/^\d{1,2}$/.test(bare)) idx = Number(bare) - 1;
  if (idx === null) return null;
  if (idx === -1) idx = optionCount - 1;
  return idx >= 0 && idx < optionCount ? idx : null;
}

/** Match a reply against a field's declared options (exact/loose). */
export function matchOption(raw: string, options: string[]): string | null {
  const t = clean(raw).toLowerCase();
  if (!t) return null;
  const exact = options.find((o) => o.toLowerCase() === t);
  if (exact) return exact;
  const ord = parseOrdinalChoice(raw, options.length);
  if (ord !== null) return options[ord]!;
  const contains = options.filter(
    (o) => o.toLowerCase().includes(t) || t.includes(o.toLowerCase()),
  );
  return contains.length === 1 ? contains[0]! : null;
}

// ---------------------------------------------------------------------
// Referential answers — "same dates I specified", "aynı tarihler"
// ---------------------------------------------------------------------

const SAME_DATES_RE =
  /^(the )?same (dates?|days?)( (i|as i|that i) (specified|said|mentioned|gave|used|told you))?( (before|earlier))?$|^aynı tarih(ler)?$|^نفس (التواريخ|المواعيد)$/i;

const isBeginKey = (k: string): boolean => /(departure|check_?in|start|begin|from)/i.test(k);
const isEndKey = (k: string): boolean => /(return|check_?out|end|until|to_date)/i.test(k);
const isBeginField = (f: string): boolean => /(check_?in|start|begin|departure|from|^date$)/i.test(f);
const isEndField = (f: string): boolean => /(check_?out|end|until|return)/i.test(f);

/**
 * Resolve "same dates" against typed session facts: find the stated
 * begin/end date pair and map it onto the asked date fields.
 */
export function resolveSameDates(
  askedFields: PendingFieldSpec[],
  facts: FactRow[],
): Record<string, string> | null {
  const dateFacts = facts.filter(
    (f) => f.kind === "date" && typeof f.value === "string" && /^\d{4}-\d{2}-\d{2}/.test(f.value as string),
  );
  if (dateFacts.length === 0) return null;
  const begin = dateFacts.find((f) => isBeginKey(f.key))?.value as string | undefined;
  const end = dateFacts.find((f) => isEndKey(f.key))?.value as string | undefined;
  const out: Record<string, string> = {};
  for (const f of askedFields) {
    if (f.inputType !== "date" && !/date|check/i.test(f.field)) continue;
    if (isEndField(f.field) && end) out[f.field] = end.slice(0, 10);
    else if (isBeginField(f.field) && begin) out[f.field] = begin.slice(0, 10);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------
// Core resolution
// ---------------------------------------------------------------------

const askedFieldSpecs = (pending: PendingClarificationSpec): PendingFieldSpec[] => {
  const fields = (pending.fields ?? []).filter((f) => f && f.field);
  if (fields.length > 0) return fields;
  return [{ field: pending.field }];
};

const valueAtPath = (obj: Record<string, unknown>, path: string): unknown => {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
};

const isDateField = (f: PendingFieldSpec): boolean =>
  f.inputType === "date" || /date|check_?in|check_?out/i.test(f.field);

/**
 * Fill asked date fields from context: referential facts, and
 * night-count derivation (checkOut = checkIn + nights) using the
 * partial args or already-resolved values as the anchor.
 */
function deriveDates(args: {
  asked: PendingFieldSpec[];
  values: Record<string, string>;
  pending: PendingClarificationSpec;
  facts: FactRow[];
  nights?: number | null;
}): void {
  const { asked, values, pending, facts, nights } = args;
  const anchorFor = (endField: string): string | null => {
    // Sibling begin field: same dotted prefix, begin-ish name.
    const prefix = endField.includes(".") ? endField.slice(0, endField.lastIndexOf(".") + 1) : "";
    for (const cand of ["checkIn", "check_in", "start", "startDate", "date", "from"]) {
      const v = values[prefix + cand] ?? valueAtPath(pending.partial, prefix + cand);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
    const beginFact = facts.find(
      (f) => f.kind === "date" && isBeginKey(f.key) && typeof f.value === "string",
    );
    return beginFact ? (beginFact.value as string).slice(0, 10) : null;
  };
  for (const f of asked) {
    if (values[f.field] || !isDateField(f)) continue;
    if (isEndField(f.field) && typeof nights === "number") {
      const anchor = anchorFor(f.field);
      if (anchor) {
        values[f.field] = addDaysIso(anchor, nights);
        // If the begin field is ALSO asked and unanswered, fill it from the anchor.
        const beginAsked = asked.find((a) => isBeginField(a.field) && !values[a.field]);
        if (beginAsked && valueAtPath(pending.partial, beginAsked.field) === undefined) {
          values[beginAsked.field] = anchor;
        }
      }
    }
  }
}

/**
 * Resolve a user reply against a pending clarification. Pure and
 * deterministic — the model-assisted fallback lives separately in
 * `resolveWithModel` and is only consulted on `unparsed`.
 */
export function resolveClarificationReply(args: {
  reply: string;
  pending: PendingClarificationSpec;
  facts: FactRow[];
  timezone: string;
  now?: Date;
}): ResolverOutcome {
  const reply = clean(args.reply ?? "");
  if (!reply) return { kind: "unparsed" };
  const asked = askedFieldSpecs(args.pending);
  const now = args.now ?? new Date();

  // 1. Control intents bound to the pending question.
  const control: ControlIntent | null = normalizeControlIntent(reply);
  if (control === "cancel") return { kind: "cancel" };
  if (control === "affirm" || control === "decline") {
    // A yes/no reply may BE the literal answer when an asked field has
    // yes/no-ish options — prefer the typed option value. Checked across
    // ALL asked fields (unanswered first), with localized variants, so
    // a valid negative answer is never mis-read as a cancellation.
    const YES = new Set(["yes", "evet", "نعم", "true"]);
    const NO = new Set(["no", "none", "hayır", "hayir", "لا", "false"]);
    const target = control === "affirm" ? YES : NO;
    const candidates = [
      ...asked.filter((f) => valueAtPath(args.pending.partial, f.field) === undefined),
      ...asked,
    ];
    for (const f of candidates) {
      const opt = f.options?.find((o) => target.has(o.toLowerCase()));
      if (opt) return { kind: "values", values: { [f.field]: opt }, via: "option_yesno" };
    }
    if (control === "decline") return { kind: "cancel" };
    // Confirmation: run the tool with the confirmed values; fill asked
    // date fields from facts when derivable so "confirmed" after
    // "same dates" style exchanges executes instead of re-asking.
    const fills: Record<string, string> = {};
    const same = resolveSameDates(asked, args.facts);
    if (same) for (const [k, v] of Object.entries(same)) if (!fills[k]) fills[k] = v;
    return { kind: "confirm", values: fills, via: "confirm" };
  }

  // 2. Referential — "same dates I specified".
  if (SAME_DATES_RE.test(reply)) {
    const same = resolveSameDates(asked, args.facts);
    if (same) {
      const values = { ...same };
      const nightsFact = args.facts.find((f) => f.kind === "quantity" && /night/i.test(f.key));
      deriveDates({ asked, values, pending: args.pending, facts: args.facts,
        nights: typeof nightsFact?.value === "number" ? (nightsFact.value as number) : null });
      return { kind: "values", values, via: "referential" };
    }
    return { kind: "unparsed" };
  }

  // 3. Duration — "5 nights" answers an end-date question via anchor+N.
  const nights = parseNightsDuration(reply);
  if (nights !== null && asked.some((f) => isDateField(f))) {
    const values: Record<string, string> = {};
    deriveDates({ asked, values, pending: args.pending, facts: args.facts, nights });
    if (Object.keys(values).length > 0) return { kind: "values", values, via: "nights" };
    return { kind: "unparsed" }; // no anchor date known yet — let the tool re-ask
  }

  // 4. Date parse for the asked date field.
  const dateAsked = asked.find((f) => isDateField(f) && valueAtPath(args.pending.partial, f.field) === undefined)
    ?? asked.find((f) => isDateField(f));
  if (dateAsked) {
    const d = parseRelativeDate(reply, args.timezone, now);
    if (d) return { kind: "values", values: { [dateAsked.field]: d }, via: "date_parse" };
  }

  // 5. Options / ordinal choice.
  const withOptions = asked.find((f) => f.options && f.options.length > 0);
  if (withOptions) {
    const opt = matchOption(reply, withOptions.options!);
    if (opt) return { kind: "values", values: { [withOptions.field]: opt }, via: "option_match" };
  }

  // 6. Bare number for a numeric-looking field.
  const numAsked = asked.find((f) => /adults|guests|nights|count|quantity|passengers|seats|rooms/i.test(f.field));
  if (numAsked) {
    const n = wordOrDigitNumber(reply.toLowerCase());
    if (n !== null) return { kind: "values", values: { [numAsked.field]: String(n) }, via: "number" };
  }

  // 7. Answer-vs-fresh-request shape check (multi-line / long / fresh
  // command openers route back to the model WITH the question).
  if (/[\r\n]/.test(args.reply) || reply.length > 120) return { kind: "fresh_request" };
  const firstWord = (reply.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z']/g, "").replace(/'/g, "");
  if (FRESH_COMMAND_OPENERS.has(firstWord)) return { kind: "fresh_request" };

  return { kind: "unparsed" };
}

/** Mirrors the legacy COMMAND_OPENERS list (kept in sync deliberately). */
export const FRESH_COMMAND_OPENERS = new Set([
  "add", "create", "make", "new", "show", "list", "get", "find", "search",
  "open", "update", "edit", "change", "set", "rename", "move", "mark",
  "delete", "remove", "archive", "merge", "assign", "log", "schedule",
  "draft", "send", "email", "close", "approve", "reject", "override",
  "cancel",
  "run", "generate", "export", "pull", "give", "help", "what", "whats",
  "who", "whos", "how", "why", "when", "where", "which", "can", "could",
  "please", "tell",
  "setup", "book", "reschedule", "invite", "plan", "check",
]);

// ---------------------------------------------------------------------
// Model-assisted fallback (only on `unparsed`; never clears pending)
// ---------------------------------------------------------------------

export function resolverLlmEnabled(): boolean {
  return String(process.env.ATELIER_CLI_RESOLVER_LLM ?? "on").toLowerCase() !== "off";
}

/**
 * Ask a small model to map a free-form reply onto the asked fields.
 * Returns a values map or null on ANY failure (timeout, refusal,
 * malformed output) — callers then fall back to the legacy raw merge.
 */
export async function resolveWithModel(args: {
  reply: string;
  pending: PendingClarificationSpec;
  timezone: string;
  model: string;
  todayIso: string;
}): Promise<Record<string, string> | null> {
  if (!resolverLlmEnabled()) return null;
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const asked = askedFieldSpecs(args.pending);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Number(process.env.ATELIER_CLI_RESOLVER_LLM_TIMEOUT_MS ?? 8_000));
    let resp;
    try {
      resp = await anthropic.messages.create(
        {
          model: args.model,
          max_tokens: 300,
          system: [
            "You resolve a user's reply to a clarification question into typed field values.",
            `Today is ${args.todayIso} in timezone ${args.timezone}. Dates must be resolved to YYYY-MM-DD.`,
            "Reply with ONLY a JSON object mapping field names to string values for fields the reply answers.",
            "Use ONLY the listed field names. If the reply does not answer the question, reply with {}.",
          ].join("\n"),
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                question: args.pending.question,
                fields: asked.map((f) => ({
                  field: f.field, label: f.label, inputType: f.inputType, options: f.options,
                })),
                reply: args.reply.slice(0, 500),
              }),
            },
          ],
        },
        { signal: ac.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    let text = "";
    for (const b of resp.content) if (b.type === "text") text += b.text;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const allowed = new Set(asked.map((f) => f.field));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!allowed.has(k)) continue;
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 300);
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null; // deterministic degradation — caller falls back
  }
}
