/**
 * Shared email-recipient resolver for chat email capabilities
 * (email_my_documents, email_company_documents, and any future outbound
 * mail surface).
 *
 * Contract the user expects:
 *   - "email X to Gokhan"   → look "Gokhan" up in the people database
 *     (org roster + CRM contacts), NOT ask a free-text question.
 *   - exactly one match     → resolve to their email; the tool's normal
 *     two-phase confirm card shows "Name <email>" so the user reconfirms.
 *   - multiple matches      → return a disambiguation card with options
 *     (the client renders them as a pick-one list); option ids are the
 *     email addresses so a pick re-invokes cleanly.
 *   - raw email addresses   → accepted verbatim (external recipients are
 *     legitimate for emailing documents).
 *
 * CRM contacts are ACL-filtered BEFORE candidates are capped, so a
 * restricted persona never sees out-of-perimeter people in the options.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, atelierUsers, atelierContacts, atelierAccounts } from "@workspace/db";
import { foldRosterName } from "./chat-normalizers.js";
import { rankNearestNames } from "./nearest-suggestions.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ResolvedRecipient {
  email: string;
  /** Display name when resolved from the people database; null for raw emails. */
  name: string | null;
  source: "roster" | "contact" | "email";
}

export type RecipientResolution =
  | { kind: "resolved"; recipients: ResolvedRecipient[] }
  | { kind: "result"; result: { ok: boolean; [k: string]: unknown } };

interface Candidate {
  email: string;
  name: string;
  source: "roster" | "contact";
  secondary: string;
  /** Set for CRM-contact candidates — used to prefer an account's own
   *  contacts when the request named the account (Task #783). */
  accountId?: string;
}

/** "Name <email>" labels for confirm summaries. */
export function recipientLabel(r: ResolvedRecipient): string {
  return r.name ? `${r.name} <${r.email}>` : r.email;
}

/**
 * Resolve a mixed list of raw emails and people names against the org
 * roster and CRM contacts. Returns either the resolved recipients or a
 * ToolResult envelope (not_found / disambiguation) to return verbatim.
 */
export async function resolveEmailRecipients(
  entries: string[],
  persona: { id: string; orgId: string; role: string | null },
  opts: {
    /** Task #783 — when the request named an account ("…for U Mobile to
     *  Sarah"), prefer that account's contacts on ambiguous names. */
    preferAccountId?: string;
    preferAccountName?: string;
  } = {},
): Promise<RecipientResolution> {
  const out: ResolvedRecipient[] = [];
  const names: string[] = [];
  for (const raw of entries) {
    const s = String(raw).trim();
    if (!s) continue;
    if (EMAIL_RE.test(s)) {
      out.push({ email: s.toLowerCase(), name: null, source: "email" });
    } else {
      names.push(s);
    }
  }
  if (names.length === 0) {
    return { kind: "resolved", recipients: dedupe(out) };
  }

  // People database, loaded once for all names.
  const roster = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email, title: atelierUsers.title })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, persona.orgId), isNull(atelierUsers.deletedAt)));
  const contacts = await db
    .select({
      id: atelierContacts.id,
      fullName: atelierContacts.fullName,
      email: atelierContacts.email,
      title: atelierContacts.title,
      accountId: atelierContacts.accountId,
      accountName: atelierAccounts.name,
    })
    .from(atelierContacts)
    .innerJoin(atelierAccounts, eq(atelierAccounts.id, atelierContacts.accountId))
    .where(and(eq(atelierContacts.orgId, persona.orgId), isNull(atelierContacts.deletedAt)));

  // ACL context for contact visibility (contacts belong to accounts).
  const [meRow] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, persona.id), eq(atelierUsers.orgId, persona.orgId)))
    .limit(1);
  const access = meRow ? await accessibleEngagementIds(meRow) : null;

  for (const name of names) {
    const needle = foldRosterName(name);
    if (needle.length < 2) {
      return {
        kind: "result",
        result: {
          ok: false,
          errorCode: "invalid_recipients",
          errorMessage: `"${name}" is too short to look up — give me a name or an email address.`,
        },
      };
    }
    const rosterHits: Candidate[] = roster
      .filter((u) => u.email && foldRosterName(u.name).includes(needle))
      .map((u) => ({
        email: u.email.toLowerCase(),
        name: u.name,
        source: "roster" as const,
        secondary: [u.email, u.title || "Colleague"].join(" · "),
      }));
    // ACL-filter contact hits BEFORE capping so restricted personas never
    // see out-of-perimeter people in the options list.
    const contactHits: Candidate[] = [];
    for (const c of contacts) {
      if (!c.email || !foldRosterName(c.fullName).includes(needle)) continue;
      if (!meRow || !access) continue;
      if (!(await canSeeAccount(access, meRow, c.accountId))) continue;
      contactHits.push({
        email: c.email.toLowerCase(),
        name: c.fullName,
        source: "contact",
        secondary: [c.email, [c.title, c.accountName ? `@ ${c.accountName}` : null].filter(Boolean).join(" ") || "Contact"].join(" · "),
        accountId: c.accountId,
      });
    }
    // Merge, dedupe by email (roster wins over contact for the same email).
    const byEmail = new Map<string, Candidate>();
    for (const c of [...rosterHits, ...contactHits]) {
      if (!byEmail.has(c.email)) byEmail.set(c.email, c);
    }
    let matches = [...byEmail.values()];
    // Task #783 — account context: when the request scoped the email to
    // an account and several people match, prefer that account's own
    // contacts (a single in-account match resolves without a question).
    if (matches.length > 1 && opts.preferAccountId) {
      const inAccount = matches.filter((m) => m.accountId === opts.preferAccountId);
      if (inAccount.length >= 1) matches = inAccount;
    }
    if (matches.length === 0) {
      // Task #783 — friendly miss: offer the closest real people
      // (roster + ACL-visible contacts) instead of a dead-end.
      const pool: Array<{ id: string; label: string; secondary?: string; accountId?: string }> = [
        ...roster
          .filter((u) => u.email)
          .map((u) => ({ id: u.email.toLowerCase(), label: u.name, secondary: u.email })),
        ...contacts
          .filter((c) => c.email)
          .map((c) => ({
            id: c.email!.toLowerCase(),
            label: c.fullName,
            secondary: [c.email, c.accountName ? `@ ${c.accountName}` : null].filter(Boolean).join(" · "),
            accountId: c.accountId,
          })),
      ];
      const ranked = rankNearestNames(name, pool, 6);
      const nearest: typeof ranked = [];
      for (const cand of ranked) {
        const acct = (cand as { accountId?: string }).accountId;
        if (acct) {
          // Contact suggestion — ACL-check before offering it.
          if (!meRow || !access) continue;
          if (!(await canSeeAccount(access, meRow, acct))) continue;
        }
        nearest.push({ id: cand.id, label: cand.label, secondary: cand.secondary });
        if (nearest.length >= 3) break;
      }
      if (nearest.length > 0) {
        return {
          kind: "result",
          result: {
            ok: true,
            data: {
              prompt: `I couldn't find "${name}" — did you mean one of these people?`,
              options: nearest,
              navigateTo: null,
            },
            disambiguation: { kind: "email_recipient", options: nearest },
          },
        };
      }
      return {
        kind: "result",
        result: {
          ok: false,
          errorCode: "recipient_not_found",
          errorMessage: `I couldn't find anyone named "${name}" on the roster or in the CRM contacts. Give me their email address, or add them as a contact first and I'll take it from there.`,
        },
      };
    }
    if (matches.length > 1) {
      const options = matches.slice(0, 6).map((m) => ({
        id: m.email,
        label: m.name,
        secondary: m.secondary,
      }));
      return {
        kind: "result",
        result: {
          ok: true,
          data: {
            prompt: `I found ${matches.length} people matching "${name}" — which one should receive the email?`,
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "email_recipient", options },
        },
      };
    }
    const m = matches[0]!;
    out.push({ email: m.email, name: m.name, source: m.source });
  }
  return { kind: "resolved", recipients: dedupe(out) };
}

function dedupe(list: ResolvedRecipient[]): ResolvedRecipient[] {
  const seen = new Map<string, ResolvedRecipient>();
  for (const r of list) {
    const prev = seen.get(r.email);
    if (!prev || (prev.name === null && r.name !== null)) seen.set(r.email, r);
  }
  return [...seen.values()];
}
