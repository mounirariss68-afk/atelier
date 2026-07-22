/**
 * Task #332 — Shared resolvers used by capability-catalog entries.
 *
 * Resolvers translate fuzzy/free-text references in user prompts into
 * concrete entity ids the backing routes expect. Every resolver
 * returns either a single match (`{ kind:"match", id, label }`) or a
 * disambiguation envelope (`{ kind:"choices", options:[...] }`) the
 * orchestrator surfaces as a `needs_disambiguation` frame.
 *
 * Engagement-scoped resolvers honour the same ACL as the UI: they
 * filter by `accessibleEngagementIds(persona)` so the CLI cannot
 * return a hint about an engagement the persona isn't on.
 *
 * Date / hours / money / activity-code resolvers are pure and locale-
 * sensitive; they cope with "today", "yesterday", "last Friday",
 * "8h", "2.5h", "3 5000 MAD" / "5,000 USD" / "5k EUR", and the firm's
 * standard activity-code set ("delivery", "ramp-up", "internal", …).
 */

import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierEngagements,
  atelierUsers,
} from "@workspace/db";
import { accessibleEngagementIds } from "../../../routes/atelier/engagementRoutes.js";
import { foldRosterName } from "../chat-normalizers.js";
import type { CliPersona } from "../index.js";

export type ResolverResult<T> =
  | { kind: "match"; id: string; label: string; extra?: T }
  | { kind: "none" }
  | {
      kind: "choices";
      prompt: string;
      options: Array<{ id: string; label: string; secondary?: string }>;
    };

const MAX_CHOICES = 5;

/**
 * Account by free-text query. Task #332 — scoped to the persona's
 * org so the CLI cannot leak account names from other tenants.
 */
export async function resolveAccount(
  query: string,
  persona: CliPersona,
): Promise<ResolverResult<unknown>> {
  const q = query.trim();
  if (q.length < 2) return { kind: "none" };
  const rows = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name, country: atelierAccounts.country })
    .from(atelierAccounts)
    .where(
      and(
        ilike(atelierAccounts.name, `%${q}%`),
        eq(atelierAccounts.orgId, persona.orgId),
        isNull(atelierAccounts.deletedAt),
      ),
    )
    .limit(MAX_CHOICES + 1);
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) {
    const r = rows[0]!;
    return { kind: "match", id: r.id, label: r.name };
  }
  return {
    kind: "choices",
    prompt: `Which account did you mean by "${q}"?`,
    options: rows.slice(0, MAX_CHOICES).map((r) => ({
      id: r.id,
      label: r.name,
      secondary: r.country ?? undefined,
    })),
  };
}

/**
 * Contact, optionally scoped to a single account. Task #332 —
 * tenant-scoped via persona.orgId.
 */
export async function resolveContact(
  query: string,
  persona: CliPersona,
  opts: { accountId?: string } = {},
): Promise<ResolverResult<unknown>> {
  const q = query.trim();
  if (q.length < 2) return { kind: "none" };
  const where = and(
    or(
      ilike(atelierContacts.fullName, `%${q}%`),
      ilike(atelierContacts.email, `%${q}%`),
      // Task #538 — match structured person preferred/display name too.
      sql`EXISTS (SELECT 1 FROM atelier_persons p WHERE p.id = ${atelierContacts.personId} AND (p.preferred_name ILIKE ${`%${q}%`} OR p.display_name ILIKE ${`%${q}%`}))`,
    ),
    eq(atelierContacts.orgId, persona.orgId),
    isNull(atelierContacts.deletedAt),
    opts.accountId ? eq(atelierContacts.accountId, opts.accountId) : undefined,
  );
  const rows = await db
    .select({
      id: atelierContacts.id,
      name: atelierContacts.fullName,
      email: atelierContacts.email,
      title: atelierContacts.title,
    })
    .from(atelierContacts)
    .where(where)
    .limit(MAX_CHOICES + 1);
  // Task #570 — accent-insensitive fallback: SQL ILIKE can't fold
  // ö/ü/ş/ı ("gokhan" vs "Gökhan"); on a miss, fold-compare in JS over
  // the org's contacts.
  let candidates = rows;
  if (candidates.length === 0) {
    const needle = foldRosterName(q);
    if (needle) {
      const all = await db
        .select({
          id: atelierContacts.id,
          name: atelierContacts.fullName,
          email: atelierContacts.email,
          title: atelierContacts.title,
        })
        .from(atelierContacts)
        .where(
          and(
            eq(atelierContacts.orgId, persona.orgId),
            isNull(atelierContacts.deletedAt),
            opts.accountId ? eq(atelierContacts.accountId, opts.accountId) : undefined,
          ),
        );
      candidates = all
        .filter((r) => foldRosterName(r.name ?? "").includes(needle))
        .slice(0, MAX_CHOICES + 1);
    }
  }
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) {
    const r = candidates[0]!;
    return { kind: "match", id: r.id, label: r.name ?? r.email ?? r.id };
  }
  return {
    kind: "choices",
    prompt: `Which contact did you mean by "${q}"?`,
    options: candidates.slice(0, MAX_CHOICES).map((r) => ({
      id: r.id,
      label: r.name ?? r.email ?? r.id,
      secondary: r.title ?? r.email ?? undefined,
    })),
  };
}

/** Engagement — gated by per-persona accessible-id set. */
export async function resolveEngagement(
  query: string,
  persona: CliPersona,
): Promise<ResolverResult<unknown>> {
  const q = query.trim();
  if (q.length < 2) return { kind: "none" };
  const acl = await accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);
  const rows = await db
    .select({ id: atelierEngagements.id, name: atelierEngagements.name })
    .from(atelierEngagements)
    .where(
      and(
        or(ilike(atelierEngagements.name, `%${q}%`), ilike(atelierEngagements.id, `%${q}%`)),
        isNull(atelierEngagements.deletedAt),
      ),
    )
    .limit(MAX_CHOICES * 2);
  const filtered = acl.all === true ? rows : rows.filter((r) => acl.ids.has(r.id));
  if (filtered.length === 0) return { kind: "none" };
  if (filtered.length === 1) {
    const r = filtered[0]!;
    return { kind: "match", id: r.id, label: r.name ?? r.id };
  }
  return {
    kind: "choices",
    prompt: `Which engagement did you mean by "${q}"?`,
    options: filtered.slice(0, MAX_CHOICES).map((r) => ({
      id: r.id,
      label: r.name ?? r.id,
      secondary: r.id,
    })),
  };
}

/**
 * Person (firm employee) by name or email. Task #332 —
 * tenant-scoped via persona.orgId.
 */
export async function resolvePerson(
  query: string,
  persona: CliPersona,
): Promise<ResolverResult<unknown>> {
  const q = query.trim();
  if (q.length < 2) return { kind: "none" };
  // Task #567 — accent-insensitive matching ("gokhan" → "Gökhan Güney"):
  // fetch the org roster and fold diacritics in JS; a raw ILIKE cannot
  // fold ö/ü/ş/ı etc.
  const all = await db
    .select({
      id: atelierUsers.id,
      name: atelierUsers.name,
      email: atelierUsers.email,
      role: atelierUsers.role,
    })
    .from(atelierUsers)
    .where(eq(atelierUsers.orgId, persona.orgId));
  const needle = foldRosterName(q);
  const rows = all
    .filter(
      (r) =>
        foldRosterName(r.name ?? "").includes(needle) ||
        foldRosterName(r.email ?? "").includes(needle),
    )
    .slice(0, MAX_CHOICES + 1);
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) {
    const r = rows[0]!;
    return { kind: "match", id: r.id, label: r.name ?? r.email ?? r.id };
  }
  return {
    kind: "choices",
    prompt: `Which person did you mean by "${q}"?`,
    options: rows.slice(0, MAX_CHOICES).map((r) => ({
      id: r.id,
      label: r.name ?? r.email ?? r.id,
      secondary: r.role ?? undefined,
    })),
  };
}

// ---------------------------------------------------------------------
// Pure resolvers (no DB)
// ---------------------------------------------------------------------

/** Parse a date phrase into ISO yyyy-mm-dd. Returns null on failure. */
export function resolveDate(input: string, now: Date = new Date()): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const dayMs = 86400000;
  if (s === "today") return iso(now);
  if (s === "yesterday") return iso(new Date(now.getTime() - dayMs));
  if (s === "tomorrow") return iso(new Date(now.getTime() + dayMs));
  const lastMatch = s.match(/^last (mon|tue|wed|thu|fri|sat|sun)/);
  if (lastMatch) {
    const map: Record<string, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };
    const target = map[lastMatch[1]!]!;
    const diff = ((now.getDay() - target + 7) % 7) || 7;
    return iso(new Date(now.getTime() - diff * dayMs));
  }
  // ISO yyyy-mm-dd fast-path
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Lenient parse fallback
  const t = Date.parse(input);
  if (!Number.isNaN(t)) return iso(new Date(t));
  return null;
}

/** Parse "8h", "2.5h", "1h30", "90m" into decimal hours. */
export function resolveHours(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m?)?$/);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  m = s.match(/^(\d+(?:\.\d+)?)m$/);
  if (m) return Number(m[1]) / 60;
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);
  return null;
}

const CURRENCY_TOKENS: Record<string, string> = {
  usd: "USD", $: "USD", eur: "EUR", "€": "EUR",
  mad: "MAD", dh: "MAD", dhs: "MAD", dirham: "MAD", dirhams: "MAD",
  gbp: "GBP", "£": "GBP",
};

/** Parse "5,000 USD" / "$5k" / "5 000 MAD" into { amount, currency }. */
export function resolveMoney(
  input: string,
): { amount: number; currency: string } | null {
  // Strip thousand-separators (comma + non-breaking space + space
  // between digits) before matching so "5,000 USD" / "5 000 MAD"
  // collapse to "5000 usd" / "5000 mad".
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[,\u00a0]/g, "")
    .replace(/(\d)\s+(?=\d)/g, "$1");
  if (!s) return null;
  const m = s.match(
    /^([$€£]?)\s*(\d+(?:\.\d+)?)(k|m)?\s*([a-z$€£]+)?$/i,
  );
  if (!m) {
    const m2 = s.match(/^([a-z$€£]+)\s*([$€£]?)\s*(\d+(?:\.\d+)?)(k|m)?$/i);
    if (!m2) return null;
    const cur = CURRENCY_TOKENS[(m2[1] ?? m2[2] ?? "").toLowerCase()];
    if (!cur) return null;
    let amt = Number(m2[3]);
    if (m2[4] === "k") amt *= 1_000;
    if (m2[4] === "m") amt *= 1_000_000;
    return { amount: amt, currency: cur };
  }
  const symbol = m[1] ?? "";
  const tail = (m[4] ?? "").toLowerCase();
  const cur = CURRENCY_TOKENS[symbol.toLowerCase()] ?? CURRENCY_TOKENS[tail];
  if (!cur) return null;
  let amt = Number(m[2]);
  if (m[3] === "k") amt *= 1_000;
  if (m[3] === "m") amt *= 1_000_000;
  return { amount: amt, currency: cur };
}

/**
 * Firm activity-code vocabulary. Returns a normalized code or null;
 * the orchestrator falls back to disambiguation when null.
 */
const ACTIVITY_CODES = [
  "delivery",
  "ramp_up",
  "internal",
  "training",
  "leave",
  "business_dev",
  "knowledge_mgmt",
  "admin",
] as const;
const ACTIVITY_SYNONYMS: Record<string, (typeof ACTIVITY_CODES)[number]> = {
  delivery: "delivery", deliv: "delivery", client: "delivery", project: "delivery",
  rampup: "ramp_up", "ramp up": "ramp_up", ramp_up: "ramp_up", onboarding: "ramp_up",
  internal: "internal", ops: "internal",
  training: "training", learning: "training", course: "training",
  leave: "leave", pto: "leave", vacation: "leave", holiday: "leave",
  bd: "business_dev", "business dev": "business_dev", sales: "business_dev",
  km: "knowledge_mgmt", knowledge: "knowledge_mgmt",
  admin: "admin",
};

export function resolveActivityCode(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if ((ACTIVITY_CODES as readonly string[]).includes(s)) return s;
  return ACTIVITY_SYNONYMS[s] ?? null;
}

export const _internal = { ACTIVITY_CODES, ACTIVITY_SYNONYMS, CURRENCY_TOKENS };

// ---------------------------------------------------------------------
// Task #338 — Stage + charter-approval-role resolvers.
// Pure (no DB). Used by opportunity.move_stage and engagement.approve_charter.
// ---------------------------------------------------------------------

/**
 * Map free-text into the v2 sales-stage vocabulary. Covers EN/FR/AR
 * synonyms for the 5 canonical + 3 terminal stages so phrases like
 * "move Acme to pursue" or "marquer comme gagné" resolve cleanly.
 */
const SALES_STAGES = [
  "suspect",
  "prospect",
  "convert",
  "runner",
  "contract",
  "lost",
  "no_decision",
  "withdrawn",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

const STAGE_SYNONYMS: Record<string, SalesStage> = {
  // EN canonical + UI labels
  suspect: "suspect", shape: "suspect", lead: "suspect",
  prospect: "prospect", pursue: "prospect", pursuing: "prospect", qualified: "prospect",
  convert: "convert", propose: "convert", proposal: "convert", proposing: "convert",
  runner: "runner", negotiation: "runner", negotiating: "runner", "in flight": "runner",
  contract: "contract", won: "contract", closed: "contract", "closed won": "contract", signed: "contract",
  lost: "lost", "closed lost": "lost",
  "no decision": "no_decision", no_decision: "no_decision", "no go": "no_decision",
  withdrawn: "withdrawn", withdraw: "withdrawn", cancelled: "withdrawn", canceled: "withdrawn",
  // FR
  suspect_fr: "suspect", piste: "suspect",
  poursuite: "prospect", "à poursuivre": "prospect",
  proposition: "convert", proposer: "convert",
  négociation: "runner", negociation: "runner",
  gagné: "contract", gagne: "contract", remporté: "contract",
  perdu: "lost",
  retiré: "withdrawn", retire: "withdrawn", annulé: "withdrawn",
  // AR (light coverage)
  "فاز": "contract", "خسر": "lost", "متابعة": "prospect", "اقتراح": "convert",
};

export function resolveSalesStage(input: string): SalesStage | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if ((SALES_STAGES as readonly string[]).includes(s)) return s as SalesStage;
  return STAGE_SYNONYMS[s] ?? null;
}

/** Charter approval role — either lead or partner. */
export type CharterApprovalRole = "lead" | "partner";

export function resolveCharterApprovalRole(input: string): CharterApprovalRole | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/(partner|founding|associé|associe|شريك)/.test(s)) return "partner";
  if (/(lead|engagement\s*lead|senior\s*manager|sm|chef|قائد)/.test(s)) return "lead";
  return null;
}

