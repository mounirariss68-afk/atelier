/**
 * Task #1411 — bounded, ACL-first CRM relationship semantics.
 *
 * This is deliberately a small adapter over the CRM source tables. It is not
 * a graph database: one hop only, fixed limits, and every disclosed node is
 * re-authorized through entity_detail before it is returned.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  findByToolName,
} from "./capability-catalog.js";
import { hybridResolveEntity, type ResolverKind } from "./entity-resolver.js";
import { normalizeCrmAlias } from "./crm-alias-normalization.js";
import type { ToolContext, ToolResult } from "./index.js";

const LIMIT = 8;
const CANDIDATE_SCAN_LIMIT = 50;
const ROOT_KINDS = new Set(["account", "contact", "person", "opportunity", "engagement", "contract", "meeting"]);
type Row = {
  id: string;
  kind: string;
  label: string;
  updated_at: Date | string | null;
  relation: string;
  source_id?: string | null;
  source_kind?: string | null;
  source_ref?: string | null;
  score?: number;
  secondary?: string;
  valid_from?: Date | string | null;
  valid_to?: Date | string | null;
  evidence_url?: string | null;
};
export type CrmRelationshipRow = Row;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function safeSourceRef(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  if (/(?:secret|token|password|bearer|api[_-]?key)/i.test(value)) return null;
  return value;
}
export function crmFreshness(value: string | null): "fresh" | "stale" | "unknown" {
  if (!value) return "unknown";
  return Date.now() - Date.parse(value) <= 30 * 86_400_000 ? "fresh" : "stale";
}

/** Merge alias and canonical resolver hits without allowing an alias to hide a
 * different canonical target. This is intentionally pure so collision
 * behaviour stays executable-testable without mocking ACL or the database. */
export function mergeCrmCandidates(
  aliases: Array<{ id: string; label: string }>,
  canonical: Array<{ id: string; label: string }>,
): Array<{ id: string; label: string }> {
  return [...new Map([...aliases, ...canonical].map((candidate) => [candidate.id, candidate])).values()];
}

/** ACL first, cap second. Hidden rows are not counted toward the public cap. */
export async function authorizeAndCapCrmRows(
  rows: readonly CrmRelationshipRow[],
  visible: (row: CrmRelationshipRow) => Promise<boolean> | boolean,
  limit = LIMIT,
): Promise<CrmRelationshipRow[]> {
  const out: CrmRelationshipRow[] = [];
  for (const row of rows) {
    if (!(await visible(row))) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function crmRelationshipEnvelope(
  root: Record<string, unknown>,
  relationships: readonly Record<string, unknown>[],
) {
  return {
    shape: "crm_relationships",
    root,
    relationships,
    bounded: { maxHops: 1, limit: LIMIT },
  };
}
function kindForResolver(kind: string): ResolverKind {
  return kind as ResolverKind;
}
function normalizeKind(kind: string): string {
  return kind;
}
function sourceTableForKind(kind: string): string {
  const tables: Record<string, string> = {
    account: "atelier_accounts",
    opportunity: "atelier_opportunities",
    engagement: "atelier_engagements",
    contact: "atelier_contacts",
    person: "atelier_persons",
    meeting: "atelier_meetings",
    contract: "atelier_contract_records",
  };
  return tables[kind] ?? `atelier_${kind}`;
}

async function sqlRows(statement: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(statement);
  return (result.rows as unknown as Row[]) ?? [];
}

async function aliasRows(orgId: string, kind: string, query: string): Promise<Row[]> {
  const targetKind = kind === "account" ? "account" : "person";
  const normalized = normalizeCrmAlias(query);
  if (!normalized) return [];
  return sqlRows(sql`
    SELECT a.target_id AS id, ${targetKind}::text AS kind, a.alias AS label,
           a.created_at AS updated_at, 'alias'::text AS relation,
           a.id AS source_id, a.source_kind, a.source_ref
      FROM atelier_crm_aliases a
     WHERE a.org_id = ${orgId} AND a.target_kind = ${targetKind}
       AND a.status = 'active' AND a.normalized_alias = ${normalized}
     LIMIT ${CANDIDATE_SCAN_LIMIT}
  `);
}

async function visibleDetail(id: string, kind: string, ctx: ToolContext): Promise<boolean> {
  const cap = findByToolName("entity_detail");
  if (!cap) return false;
  const result = await cap.run({ id, kind: normalizeKind(kind) }, ctx) as ToolResult;
  return result.ok === true;
}

async function resolveRoot(input: { id?: string; query?: string; kind: string }, ctx: ToolContext): Promise<
  { id: string; kind: string; provenance?: Record<string, unknown> } | { disambiguation: unknown } | null
> {
  const kind = normalizeKind(input.kind);
  if (input.id) {
    return await visibleDetail(input.id, kind, ctx) ? { id: input.id, kind } : null;
  }
  const query = input.query?.trim() ?? "";
  if (!query) return null;
  const aliases = (kind === "account" || kind === "person")
    ? (await aliasRows(ctx.persona.orgId, kind, query)).filter((r) => r.id) : [];
  const canonical = kind === "person"
    ? await sqlRows(sql`SELECT id, 'person' kind, display_name label, updated_at, 'canonical' relation
        FROM atelier_persons WHERE org_id=${ctx.persona.orgId} AND deleted_at IS NULL
          AND (display_name ILIKE ${`%${query}%`} OR preferred_name ILIKE ${`%${query}%`})
        LIMIT ${CANDIDATE_SCAN_LIMIT}`)
    : kind === "contract"
      ? await sqlRows(sql`SELECT id, 'contract' kind, title label, updated_at, 'canonical' relation
          FROM atelier_contract_records WHERE org_id=${ctx.persona.orgId}
            AND (title ILIKE ${`%${query}%`} OR counterparty_label ILIKE ${`%${query}%`})
          LIMIT ${CANDIDATE_SCAN_LIMIT}`)
      : [];
  const candidates = kind === "person"
    ? []
    : await hybridResolveEntity(kindForResolver(kind), query, ctx.persona.orgId, {}, ctx.persona);
  const aliasOrCanonicalVisible: Row[] = [];
  for (const row of [...aliases, ...canonical]) {
    if (await visibleDetail(row.id, kind, ctx)) aliasOrCanonicalVisible.push(row);
  }
  const visibleCandidates: Row[] = [];
  for (const candidate of candidates) {
    if (await visibleDetail(candidate.id, kind, ctx)) {
      visibleCandidates.push({
        id: candidate.id,
        kind,
        label: candidate.label,
        updated_at: null,
        relation: "canonical",
        source_id: candidate.id,
        source_kind: `atelier_${kind === "contract" ? "contract_records" : `${kind}s`}`,
        score: candidate.score,
        secondary: candidate.secondary,
      });
    }
  }
  // An alias never silently outranks another record's canonical name.
  if (aliasOrCanonicalVisible.length > 0) {
    const combined = [
      ...aliasOrCanonicalVisible,
      ...visibleCandidates,
    ];
    const distinct = mergeCrmCandidates(
      combined.map((r) => ({ id: r.id, label: r.label })),
      [],
    );
    if (distinct.length > 1) {
      return { disambiguation: { prompt: `Which ${kind} did you mean?`, options: distinct.slice(0, LIMIT).map((r) => ({ id: r.id, label: r.label })) } };
    }
    const selected = [...aliasOrCanonicalVisible, ...visibleCandidates]
      .find((row) => row.id === distinct[0]!.id);
    return {
      id: distinct[0]!.id,
      kind,
      provenance: selected ? {
        sourceId: selected.source_id ?? selected.id,
        sourceKind: selected.source_kind ?? "canonical",
        createdAt: iso(selected.updated_at),
        ...(safeSourceRef(selected.source_ref)
          ? { sourceRef: safeSourceRef(selected.source_ref) }
          : {}),
      } : undefined,
    };
  }
  if (visibleCandidates.length === 0) return null;
  const visible = visibleCandidates;
  if (visible.length > 1 && (visible[0]!.score ?? 0) - (visible[1]!.score ?? 0) < 0.25) {
    return { disambiguation: { prompt: `Which ${kind} did you mean?`, options: visible.slice(0, LIMIT).map((c) => ({ id: c.id, label: c.label, secondary: c.secondary })) } };
  }
  const id = visible[0]!.id;
  return { id, kind, provenance: {
    sourceId: visible[0]!.source_id ?? id,
    sourceKind: visible[0]!.source_kind ?? "canonical",
  } };
}

async function relatedRows(root: { id: string; kind: string }, orgId: string): Promise<Row[]> {
  const { id, kind } = root;
  if (kind === "account") {
    const [opps, engs, contacts, contracts] = await Promise.all([
      sqlRows(sql`SELECT id AS id,'opportunity' AS kind,name AS label,updated_at AS updated_at,'account.opportunity' AS relation FROM atelier_opportunities WHERE org_id=${orgId} AND account_id=${id} AND deleted_at IS NULL`),
      sqlRows(sql`SELECT id AS id,'engagement' AS kind,name AS label,updated_at AS updated_at,'account.engagement' AS relation FROM atelier_engagements WHERE org_id=${orgId} AND account_id=${id} AND deleted_at IS NULL`),
      sqlRows(sql`SELECT id AS id,'contact' AS kind,full_name AS label,updated_at AS updated_at,
          'account.contact' AS relation,source_url AS evidence_url
        FROM atelier_contacts WHERE org_id=${orgId} AND account_id=${id} AND deleted_at IS NULL`),
      sqlRows(sql`SELECT id,'contract' kind,title label,updated_at,'account.contract' relation,
          id source_id,'contract_record' source_kind,effective_date valid_from,expiry_date valid_to
        FROM atelier_contract_records WHERE org_id=${orgId} AND account_id=${id}`),
    ]);
    return [...opps, ...engs, ...contacts, ...contracts];
  }
  if (kind === "opportunity") {
    const account = await sqlRows(sql`
    SELECT id AS id, 'account' AS kind, name AS label, updated_at AS updated_at, 'opportunity.account' AS relation FROM atelier_accounts
     WHERE org_id=${orgId} AND id=(SELECT account_id FROM atelier_opportunities WHERE id=${id} AND org_id=${orgId} AND deleted_at IS NULL) AND deleted_at IS NULL
  `);
    return [...account, ...await sqlRows(sql`SELECT id,'engagement' kind,name label,updated_at,'opportunity.engagement' relation FROM atelier_engagements WHERE org_id=${orgId} AND opportunity_id=${id} AND deleted_at IS NULL`), ...await sqlRows(sql`SELECT id,'meeting' kind,title label,updated_at,'opportunity.meeting' relation FROM atelier_meetings WHERE org_id=${orgId} AND parent_type='opportunity' AND parent_id=${id} AND deleted_at IS NULL`)];
  }
  if (kind === "engagement") {
    const account = await sqlRows(sql`
    SELECT id AS id, 'account' AS kind, name AS label, updated_at AS updated_at, 'engagement.account' AS relation FROM atelier_accounts
     WHERE org_id=${orgId} AND id=(SELECT account_id FROM atelier_engagements WHERE id=${id} AND org_id=${orgId} AND deleted_at IS NULL) AND deleted_at IS NULL
  `);
    return [...account, ...await sqlRows(sql`SELECT id,'opportunity' kind,name label,updated_at,'engagement.opportunity' relation FROM atelier_opportunities WHERE org_id=${orgId} AND id=(SELECT opportunity_id FROM atelier_engagements WHERE id=${id} AND org_id=${orgId}) AND deleted_at IS NULL`), ...await sqlRows(sql`SELECT id,'meeting' kind,title label,updated_at,'engagement.meeting' relation FROM atelier_meetings WHERE org_id=${orgId} AND parent_type='engagement' AND parent_id=${id} AND deleted_at IS NULL`)];
  }
  if (kind === "meeting") return sqlRows(sql`
     SELECT parent_id AS id, parent_type AS kind, COALESCE(parent_type,'parent') AS label, updated_at AS updated_at, 'meeting.parent' AS relation
      FROM atelier_meetings WHERE org_id=${orgId} AND id=${id} AND deleted_at IS NULL LIMIT 1
  `);
  if (kind === "person") {
    return sqlRows(sql`SELECT id AS id,'contact' AS kind,full_name AS label,updated_at AS updated_at,
        'person.contact' AS relation,source_url AS evidence_url
      FROM atelier_contacts WHERE org_id=${orgId} AND person_id=${id} AND deleted_at IS NULL`);
  }
  if (kind === "contact") {
    const [account, rels] = await Promise.all([
      sqlRows(sql`SELECT a.id,'account' kind,a.name label,a.updated_at,'contact.account' relation FROM atelier_contacts c JOIN atelier_accounts a ON a.id=c.account_id AND a.org_id=c.org_id AND a.deleted_at IS NULL WHERE c.org_id=${orgId} AND c.id=${id} AND c.deleted_at IS NULL`),
      sqlRows(sql`SELECT c.id,'contact' kind,c.full_name label,r.created_at updated_at,
          ('contact.relationship.' || r.type) relation,r.id source_id,
          'contact_relationship' source_kind,r.created_at valid_from,
          NULL::timestamptz valid_to,c.source_url evidence_url
        FROM atelier_contact_relationships r JOIN atelier_contacts c
          ON c.id=CASE WHEN r.from_contact_id=${id} THEN r.to_contact_id ELSE r.from_contact_id END
          AND c.org_id=r.org_id AND c.deleted_at IS NULL
        WHERE r.org_id=${orgId} AND r.deleted_at IS NULL
          AND (r.from_contact_id=${id} OR r.to_contact_id=${id})`),
    ]);
    return [...account, ...rels];
  }
  if (kind === "contract") return sqlRows(sql`
     SELECT account_id AS id, 'account' AS kind, COALESCE(account_id,'Account') AS label, updated_at AS updated_at, 'contract.account' AS relation FROM atelier_contract_records
     WHERE org_id=${orgId} AND id=${id} AND account_id IS NOT NULL LIMIT 1
  `);
  return [];
}

async function rootMeta(root: { id: string; kind: string }, orgId: string): Promise<{ label: string; updated: string | null; source: string }>{
  const table = root.kind === "account" ? "atelier_accounts" : root.kind === "person" ? "atelier_persons" :
    root.kind === "contact" ? "atelier_contacts" : root.kind === "opportunity" ? "atelier_opportunities" :
    root.kind === "engagement" ? "atelier_engagements" : root.kind === "meeting" ? "atelier_meetings" : "atelier_contract_records";
  const rows = await sqlRows(sql.raw(`SELECT ${table === "atelier_contacts" ? "full_name" : table === "atelier_meetings" || table === "atelier_contract_records" ? "title" : table === "atelier_persons" ? "display_name" : "name"} AS label, updated_at FROM ${table} WHERE org_id='${orgId.replace(/'/g, "''")}' AND id='${root.id.replace(/'/g, "''")}' LIMIT 1`));
  const row = rows[0];
  const updated = iso(row?.updated_at);
  return { label: row?.label ?? root.id, updated, source: table };
}

defineCapability({
  id: "crm.relationships",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "crm_relationships",
  description: "Answer bounded CRM relationship questions with authorized account, person, opportunity, engagement, contract and meeting links. Returns only live visible canonical records with provenance and freshness.",
  slashAliases: { en: ["/relationships", "/related"] },
  representativePrompts: { en: ["Who is connected to this account?", "Show the opportunity, engagement and meetings related to Acme."] },
  inputSchema: {
    type: "object", properties: {
      kind: { type: "string", enum: ["account", "person", "contact", "opportunity", "engagement", "contract", "meeting"] },
      id: { type: "string" }, query: { type: "string" },
    }, required: ["kind"], additionalProperties: false,
  },
  isWrite: false, irreversible: false, twoPhaseConfirm: false, outboundChannel: null,
  surfaceOn: ["global", "account_workspace", "opportunity_workspace", "engagement_dashboard"],
  resultCard: "ranked_list",
  async run(input, ctx) {
    const kind = typeof input.kind === "string" ? input.kind : "";
    if (!ROOT_KINDS.has(kind)) return { ok: false, errorCode: "invalid_kind", errorMessage: "Unsupported CRM relationship root." };
    const root = await resolveRoot({ kind, id: typeof input.id === "string" ? input.id : undefined, query: typeof input.query === "string" ? input.query : undefined }, ctx);
    if (!root) return { ok: false, errorCode: "not_found", errorMessage: "No visible live CRM record matched that reference." };
    if ("disambiguation" in root) return { ok: true, data: root.disambiguation, disambiguation: root.disambiguation as never };
    const rows = await relatedRows(root, ctx.persona.orgId);
    const meta = await rootMeta(root, ctx.persona.orgId);
    const authorizedRows = await authorizeAndCapCrmRows(rows, async (row) => {
      const relatedKind = row.kind === "contact" ? "contact" : row.kind;
      if (!["account", "opportunity", "engagement", "contract", "meeting", "person", "contact"].includes(relatedKind)) return false;
      return visibleDetail(row.id, relatedKind, ctx);
    });
    const relationships: Record<string, unknown>[] = [];
    for (const row of authorizedRows) {
      const relatedKind = row.kind === "contact" ? "contact" : row.kind;
      const updated = iso(row.updated_at);
      relationships.push(
        {
          kind: relatedKind,
          id: row.id,
          label: row.label,
          relation: row.relation,
          source: sourceTableForKind(relatedKind),
          sourceUpdatedAt: updated,
          freshness: crmFreshness(updated),
          validity: { from: iso(row.valid_from), to: iso(row.valid_to) },
          provenance: {
            sourceKind: row.source_kind ?? sourceTableForKind(relatedKind),
            sourceId: row.source_id ?? row.id,
            ...(row.evidence_url
              ? { evidence: [{ kind: "source_url", url: row.evidence_url }] }
              : {}),
          },
        },
      );
    }
    return {
      ok: true,
      data: crmRelationshipEnvelope(
        { ...root, label: meta.label, sourceUpdatedAt: meta.updated, source: meta.source, freshness: crmFreshness(meta.updated) },
        relationships,
      ),
    };
  },
});