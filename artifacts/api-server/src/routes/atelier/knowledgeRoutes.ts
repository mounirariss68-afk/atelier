import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAssets,
  atelierAgentRuns,
  atelierAgents,
  atelierAdminSettings,
  atelierEmployees,
  atelierComplianceRecords,
  atelierFxRates,
  atelierExpenses,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  AtelierListPromptsResponse,
  AtelierConciergeSearchBody,
  AtelierConciergeSearchResponse,
  AtelierGetAdminSettingsResponse,
  AtelierUpdateAdminSettingsBody,
  AtelierListAgentRunsResponse,
} from "@workspace/api-zod";

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

// =============================================================
// Prompt library — filesystem-backed view of prompts/<agent>/v*.md
// =============================================================
function findPromptDir(): string {
  if (process.env.ATELIER_PROMPT_DIR) return process.env.ATELIER_PROMPT_DIR;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const candidate = resolve(dir, "prompts");
      readFileSync(resolve(candidate, "pursuit_scout/v1.md"));
      return candidate;
    } catch {
      // walk up
    }
    dir = resolve(dir, "..");
  }
  return resolve(process.cwd(), "artifacts/api-server/prompts");
}

const PROMPT_DIR = findPromptDir();

interface PromptFrontMatter {
  agent_id?: string;
  version?: number;
  author?: string;
  model?: string;
  eval_set_id?: string;
  status?: string;
  created?: string;
  fires_when?: string;
  produces?: string;
  owner?: string;
}

function parseFrontMatter(body: string): { fm: PromptFrontMatter; rest: string } {
  if (!body.startsWith("---")) return { fm: {}, rest: body };
  const end = body.indexOf("\n---", 4);
  if (end === -1) return { fm: {}, rest: body };
  const yaml = body.slice(4, end);
  const rest = body.slice(end + 4).replace(/^\n/, "");
  const fm: PromptFrontMatter = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.+)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    const v = vRaw.trim().replace(/^["']|["']$/g, "");
    if (k === "version") fm.version = Number(v);
    else (fm as Record<string, string>)[k] = v;
  }
  return { fm, rest };
}

interface PromptEntry {
  agentId: string;
  version: number;
  status: string;
  author: string | null;
  model: string | null;
  evalSetId: string | null;
  firesWhen: string | null;
  produces: string | null;
  owner: string | null;
  bodyPreview: string;
  bytes: number;
  updatedAt: string;
}

function listPromptEntries(): PromptEntry[] {
  let agents: string[] = [];
  try {
    agents = readdirSync(PROMPT_DIR).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
  const out: PromptEntry[] = [];
  for (const agentId of agents) {
    const agentDir = resolve(PROMPT_DIR, agentId);
    let files: string[] = [];
    try {
      files = readdirSync(agentDir).filter((n) => /^v\d+\.md$/.test(n));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = resolve(agentDir, file);
      const stat = statSync(path);
      const body = readFileSync(path, "utf8");
      const { fm, rest } = parseFrontMatter(body);
      const versionFromName = Number(file.match(/^v(\d+)\.md$/)?.[1] ?? 1);
      out.push({
        agentId,
        version: fm.version ?? versionFromName,
        status: fm.status ?? "active",
        author: fm.author ?? null,
        model: fm.model ?? null,
        evalSetId: fm.eval_set_id ?? null,
        firesWhen: fm.fires_when ?? null,
        produces: fm.produces ?? null,
        owner: fm.owner ?? null,
        bodyPreview: rest.trim().slice(0, 600),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }
  return out.sort((a, b) =>
    a.agentId === b.agentId ? b.version - a.version : a.agentId.localeCompare(b.agentId),
  );
}

// =============================================================
// Atelier Curator — deterministic 40-word abstract generator.
// Used by artifact upload when no abstract is provided. Stub LLM
// behavior consistent with other mock-LLM agents in this codebase.
// =============================================================
const STOP_WORDS = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","by",
  "from","as","is","are","was","were","be","been","being","this","that","it",
  "its","we","our","you","your","they","their","i","me","my",
]);

export function curatorAbstract(
  title: string,
  body: string | null | undefined,
): { abstract: string; tags: string[] } {
  const text = `${title}. ${body ?? ""}`.replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let abstract = "";
  for (const s of sentences) {
    if ((abstract + " " + s).split(" ").length > 40) break;
    abstract = abstract ? abstract + " " + s : s;
  }
  if (!abstract) abstract = title;
  // Cap at 40 words.
  const words = abstract.split(/\s+/);
  if (words.length > 40) abstract = words.slice(0, 40).join(" ") + "…";
  // Tag extraction: top frequency tokens, length>=4, non-stopword, lowercase.
  const counts: Record<string, number> = {};
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (STOP_WORDS.has(w)) continue;
    counts[w] = (counts[w] ?? 0) + 1;
  }
  const tags = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
  // Always emit exactly 5 tags. Pad with deterministic fallbacks derived
  // from title slug + generic provenance markers when source text is sparse.
  const fallbacks = [
    ...title
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{2,}/g)
      ?.filter((w) => !STOP_WORDS.has(w) && !tags.includes(w)) ?? [],
    "atelier",
    "artifact",
    "knowledge",
    "engagement",
    "draft",
  ];
  for (const f of fallbacks) {
    if (tags.length >= 5) break;
    if (!tags.includes(f)) tags.push(f);
  }
  return { abstract, tags: tags.slice(0, 5) };
}

// =============================================================
// Knowledge Concierge — keyword-rank atelier_assets.
// pgvector-based semantic search is deferred to a follow-up.
// =============================================================
function scoreAsset(
  q: string,
  asset: { title: string; abstract: string; tags: unknown },
): { score: number; snippet: string } {
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return { score: 0, snippet: "" };
  const hay = `${asset.title}\n${asset.abstract}\n${(asset.tags as string[] ?? []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (asset.title.toLowerCase().includes(t)) score += 5;
    if ((asset.tags as string[] ?? []).some((tag) => tag.toLowerCase().includes(t))) score += 3;
    if (asset.abstract.toLowerCase().includes(t)) score += 2;
    // light fuzzy: prefix-match in any token of title.
    for (const w of asset.title.toLowerCase().split(/\W+/)) {
      if (w.startsWith(t)) score += 1;
    }
  }
  // Snippet: take first sentence containing any token, else first 140 chars.
  let snippet = asset.abstract.slice(0, 140);
  for (const sent of asset.abstract.split(/(?<=[.!?])\s+/)) {
    if (tokens.some((t) => sent.toLowerCase().includes(t))) {
      snippet = sent.slice(0, 200);
      break;
    }
  }
  return { score, snippet };
}

// =============================================================
// Admin settings — in-memory map per orgId. Persistence is
// deferred (follow-up) — server restart resets to defaults,
// which is acceptable for MVP demo but logged in the audit feed
// when a Partner edits.
// =============================================================
interface AdminSettings {
  disableOpus: boolean;
  disabledAgentIds: string[];
  piiPatterns: string[];
  residencyRegion: string;
  perUserDailyTokenBudget: number;
  // Task #243 — Compliance posture. mfaRequired is the only persisted
  // toggle today; the others reflect platform-level guarantees displayed
  // for partner assurance.
  mfaRequired: boolean;
  encryptionAtRest: string;
  encryptionInTransit: string;
  immutableAuditEnabled: boolean;
  immutableAuditRetentionYears: number;
  ipAllowlistEnabled: boolean;
}

const DEFAULT_ADMIN: AdminSettings = {
  disableOpus: false,
  disabledAgentIds: [],
  piiPatterns: [
    "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    "\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]+\\b",
    "\\b(?:\\+?\\d{1,3}[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}\\b",
  ],
  residencyRegion: "GCC (KSA + UAE)",
  perUserDailyTokenBudget: 250000,
  mfaRequired: true,
  encryptionAtRest: "AES-256",
  encryptionInTransit: "TLS 1.3",
  immutableAuditEnabled: true,
  immutableAuditRetentionYears: 7,
  ipAllowlistEnabled: false,
};

/**
 * Task #243 — DB-backed admin settings. One row per orgId in
 * `atelier_admin_settings`; the full settings shape lives in the JSONB
 * `value` column so toggles survive server restarts. Reads merge over
 * DEFAULT_ADMIN so newly-introduced fields fall back gracefully.
 */
async function getAdmin(orgId: string): Promise<AdminSettings> {
  const [row] = await db
    .select()
    .from(atelierAdminSettings)
    .where(eq(atelierAdminSettings.orgId, orgId));
  const stored = (row?.value ?? {}) as Partial<AdminSettings>;
  return {
    ...DEFAULT_ADMIN,
    piiPatterns: [...DEFAULT_ADMIN.piiPatterns],
    ...stored,
  };
}

async function saveAdmin(orgId: string, next: AdminSettings): Promise<void> {
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(atelierAdminSettings)
    .values({ orgId, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: atelierAdminSettings.orgId,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Task #243 — non-codegen compliance accessors. `/admin/compliance` (raw
 * JSON, not OpenAPI-zod) lets the Admin Compliance Posture card persist
 * the MFA + IP-allowlist toggles without triggering a Zod regen across
 * the monorepo. PATCH accepts `{ mfaRequired?: boolean,
 * ipAllowlistEnabled?: boolean }`; all other indicators are read-only.
 */
export async function getCompliancePosture(orgId: string) {
  const s = await getAdmin(orgId);

  // Task #261 — v3 indicator chips. Each one is a deterministic computation
  // off live tables so the Admin posture card always reflects current
  // state, not a settings-table snapshot. Fail-soft: any per-chip query
  // failure surfaces as `unknown` rather than 5xx'ing the whole panel.
  let wpsStatus: "ok" | "warn" | "unknown" = "unknown";
  let wpsMessage = "";
  let saudizationPct: number | null = null;
  let saudizationStatus: "ok" | "warn" | "unknown" = "unknown";
  let fxFreshnessHours: number | null = null;
  let fxStatus: "ok" | "warn" | "unknown" = "unknown";
  let receiptEncryptionStatus: "ok" | "warn" | "unknown" = "unknown";
  let receiptUnencryptedCount: number | null = null;

  try {
    const wpsRows = await db
      .select({ status: atelierComplianceRecords.status })
      .from(atelierComplianceRecords)
      .where(and(eq(atelierComplianceRecords.kind, "wps"), eq(atelierComplianceRecords.orgId, orgId)));
    if (wpsRows.length === 0) {
      wpsStatus = "warn";
      wpsMessage = "No WPS registration record on file.";
    } else {
      const expired = wpsRows.filter((r) => r.status === "expired" || r.status === "missing");
      wpsStatus = expired.length === 0 ? "ok" : "warn";
      wpsMessage = expired.length === 0
        ? `${wpsRows.length} WPS records active`
        : `${expired.length} of ${wpsRows.length} WPS records expired or missing`;
    }
  } catch {
    /* noop — leave unknown */
  }

  try {
    const sRows = await db
      .select({ metadata: atelierComplianceRecords.metadata })
      .from(atelierComplianceRecords)
      .where(
        and(eq(atelierComplianceRecords.kind, "saudization"), eq(atelierComplianceRecords.orgId, orgId)),
      );
    if (sRows.length > 0) {
      let req = 0;
      let act = 0;
      for (const r of sRows) {
        const p = r.metadata as { saudizationQuotaRequired?: number; saudizationQuotaActual?: number } | null;
        req += Number(p?.saudizationQuotaRequired ?? 0);
        act += Number(p?.saudizationQuotaActual ?? 0);
      }
      if (req > 0) {
        saudizationPct = Math.round((act / req) * 100);
        saudizationStatus = saudizationPct >= 100 ? "ok" : "warn";
      }
    }
  } catch {
    /* noop */
  }

  try {
    const [{ maxDate } = { maxDate: null as string | null }] = await db
      .select({ maxDate: sql<string>`MAX(${atelierFxRates.date})` })
      .from(atelierFxRates)
      .where(eq(atelierFxRates.orgId, orgId));
    if (maxDate) {
      const ageMs = Date.now() - new Date(maxDate + "T00:00:00Z").getTime();
      fxFreshnessHours = Math.max(0, Math.round(ageMs / (3600 * 1000)));
      fxStatus = fxFreshnessHours <= 24 ? "ok" : "warn";
    }
  } catch {
    /* noop */
  }

  try {
    const expRows = await db
      .select({
        receiptFileRef: atelierExpenses.receiptFileRef,
        receiptEncryptedAtRest: atelierExpenses.receiptEncryptedAtRest,
        deletedAt: atelierExpenses.deletedAt,
      })
      .from(atelierExpenses)
      .where(eq(atelierExpenses.orgId, orgId));
    const offenders = expRows.filter(
      (r) => !r.deletedAt && r.receiptFileRef && r.receiptEncryptedAtRest === false,
    );
    receiptUnencryptedCount = offenders.length;
    receiptEncryptionStatus = offenders.length === 0 ? "ok" : "warn";
  } catch {
    /* noop */
  }

  return {
    mfaRequired: s.mfaRequired,
    encryptionAtRest: s.encryptionAtRest,
    encryptionInTransit: s.encryptionInTransit,
    immutableAuditEnabled: s.immutableAuditEnabled,
    immutableAuditRetentionYears: s.immutableAuditRetentionYears,
    ipAllowlistEnabled: s.ipAllowlistEnabled,
    residencyRegion: s.residencyRegion,
    // Task #261 — v3 indicator chips.
    wps: { status: wpsStatus, message: wpsMessage },
    saudization: { status: saudizationStatus, pct: saudizationPct },
    fxFreshness: { status: fxStatus, hours: fxFreshnessHours },
    receiptEncryption: { status: receiptEncryptionStatus, unencryptedCount: receiptUnencryptedCount },
    // DIFC/ADGM/KSA registration confirmations sourced from
    // atelier_compliance_records by `kind` (difc, adgm, ksa_cr). Each
    // entry's status is `ok` when at least one active row exists for the
    // jurisdiction, `warn` when rows exist but all are expired/expiring,
    // and `unknown` when none are on file.
    jurisdictions: await computeJurisdictionChips(orgId),
  };
}

async function computeJurisdictionChips(
  orgId: string,
): Promise<Array<{ key: "difc" | "adgm" | "ksa"; label: string; status: "ok" | "warn" | "unknown"; detail: string }>> {
  const KINDS: Array<{ key: "difc" | "adgm" | "ksa"; label: string; kind: string }> = [
    { key: "difc", label: "DIFC", kind: "difc" },
    { key: "adgm", label: "ADGM", kind: "adgm" },
    { key: "ksa", label: "KSA CR", kind: "ksa_cr" },
  ];
  const out: Array<{ key: "difc" | "adgm" | "ksa"; label: string; status: "ok" | "warn" | "unknown"; detail: string }> = [];
  for (const j of KINDS) {
    try {
      const rows = await db
        .select({ status: atelierComplianceRecords.status })
        .from(atelierComplianceRecords)
        .where(and(eq(atelierComplianceRecords.kind, j.kind), eq(atelierComplianceRecords.orgId, orgId)));
      if (rows.length === 0) {
        out.push({ key: j.key, label: j.label, status: "unknown", detail: "no registration on file" });
        continue;
      }
      const active = rows.filter((r) => r.status === "active").length;
      const status: "ok" | "warn" = active > 0 ? "ok" : "warn";
      out.push({
        key: j.key,
        label: j.label,
        status,
        detail: status === "ok" ? `${active} active registration(s)` : `${rows.length} record(s), none active`,
      });
    } catch {
      out.push({ key: j.key, label: j.label, status: "unknown", detail: "lookup failed" });
    }
  }
  return out;
}

export async function patchCompliancePosture(
  orgId: string,
  patch: { mfaRequired?: unknown; ipAllowlistEnabled?: unknown },
) {
  const s = await getAdmin(orgId);
  if (typeof patch.mfaRequired === "boolean") s.mfaRequired = patch.mfaRequired;
  if (typeof patch.ipAllowlistEnabled === "boolean") s.ipAllowlistEnabled = patch.ipAllowlistEnabled;
  await saveAdmin(orgId, s);
  return getCompliancePosture(orgId);
}

// =============================================================
// Routes
// =============================================================
const router: IRouter = Router();

// --- Prompt library --------------------------------------------------
router.get("/prompts", async (_req, res) => {
  const entries = listPromptEntries();
  res.json(AtelierListPromptsResponse.parse(entries));
});

// --- Knowledge Concierge --------------------------------------------
router.post("/concierge/search", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierConciergeSearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const { query, limit } = parsed.data;
  const rows = await db
    .select()
    .from(atelierAssets)
    .where(isNull(atelierAssets.deletedAt));
  const scored = rows
    .map((a) => {
      const { score, snippet } = scoreAsset(query, {
        title: a.title,
        abstract: a.abstract,
        tags: a.tags,
      });
      return { a, score, snippet };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? 10);
  res.json(
    AtelierConciergeSearchResponse.parse({
      query,
      results: scored.map((x) => ({
        score: x.score,
        snippet: x.snippet,
        asset: {
          id: x.a.id,
          kind: x.a.kind as
            | "pov"
            | "prompt"
            | "framework"
            | "case_study"
            | "template"
            | "code"
            | "learning",
          title: x.a.title,
          abstract: x.a.abstract,
          provenance: x.a.provenance,
          tags: (x.a.tags as string[]) ?? [],
          createdAt: x.a.createdAt.toISOString(),
          bodyOrFileUrl: x.a.bodyOrFileUrl,
        },
      })),
    }),
  );
});

// --- Admin settings (Partner-gated) ---------------------------------
router.get("/admin/settings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  res.json(AtelierGetAdminSettingsResponse.parse(await getAdmin(me.orgId)));
});

router.post("/admin/settings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const parsed = AtelierUpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const cur = await getAdmin(me.orgId);
  if (parsed.data.disableOpus !== undefined) cur.disableOpus = parsed.data.disableOpus;
  if (parsed.data.disabledAgentIds) cur.disabledAgentIds = parsed.data.disabledAgentIds;
  if (parsed.data.piiPatterns) cur.piiPatterns = parsed.data.piiPatterns;
  if (parsed.data.perUserDailyTokenBudget !== undefined)
    cur.perUserDailyTokenBudget = parsed.data.perUserDailyTokenBudget;
  await saveAdmin(me.orgId, cur);
  res.json(AtelierGetAdminSettingsResponse.parse(cur));
});

// Task #243 — Compliance posture (raw JSON, no OpenAPI/Zod regen).
// Partner-gated. The Admin Compliance Posture card reads/writes via these
// endpoints to persist the MFA + IP-allowlist toggles. Other indicators
// are platform-level and read-only.
router.get("/admin/compliance", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  res.json(await getCompliancePosture(me.orgId));
});

router.patch("/admin/compliance", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const body = (req.body ?? {}) as { mfaRequired?: unknown; ipAllowlistEnabled?: unknown };
  res.json(await patchCompliancePosture(me.orgId, body));
});

// Task #243 — Founder TODOs (read-only static list, raw JSON).
// Surfaces PRD §10 founder-only follow-ups so partners can see what is
// outstanding pre-GA. Partner-gated to match the rest of /admin.
router.get("/admin/founder-todos", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  // PRD §10 — founder decision defaults. These are the firm-wide
  // defaults the founding partner must lock in pre-GA; the operator
  // console resolves them, but they surface here so partners see the
  // pending defaults at a glance.
  // Task #261 — PRD §10 v3 founder TODOs. These supersede the v2 list and
  // are the firm-wide defaults the founding partner must lock in pre-GA.
  res.json({
    items: [
      "Confirm Operations Partner role (Mounir vs new hire) and lock the resourcing/finance ownership.",
      "Tighten per-role utilization targets (Partner 50% · EL 65% · SC/Sr.SC 70% · AI Eng 75%) and ratify the firm default.",
      "Lock default markup on client-billable expenses (proposed 10% · founder to ratify).",
      "Approve partner-economics model (firm-share %, ramp, founder buy-in, vesting cliffs).",
      "Approve contractor Atelier-reuse pathway (which contractors join the Atelier and on what terms).",
      "Decide single-vs-two card-platform strategy (Pleo + Brex both, or consolidate on one).",
      "Lock VAT-reclaim philosophy (claim everywhere eligible · or restrict by jurisdiction).",
      "Select e-signature provider (DocuSign vs Adobe Sign vs in-house) and contract.",
    ],
  });
});

// --- Recent runs by agent -------------------------------------------
router.get("/agents/:agentId/runs", async (req, res) => {
  const me = await ensurePersona(req, res);
  if (!me) return;
  const limit = 20;
  const runs = await db
    .select({
      id: atelierAgentRuns.id,
      agentId: atelierAgentRuns.agentId,
      status: atelierAgentRuns.status,
      statusMessage: atelierAgentRuns.statusMessage,
      confidence: atelierAgentRuns.confidence,
      targetType: atelierAgentRuns.targetType,
      targetId: atelierAgentRuns.targetId,
      targetLabel: atelierAgentRuns.targetLabel,
      progressPct: atelierAgentRuns.progressPct,
      sourcesCount: atelierAgentRuns.sourcesCount,
      costUsd: atelierAgentRuns.costUsd,
      durationMs: atelierAgentRuns.durationMs,
      createdAt: atelierAgentRuns.createdAt,
      agentName: atelierAgents.name,
    })
    .from(atelierAgentRuns)
    .leftJoin(atelierAgents, eq(atelierAgentRuns.agentId, atelierAgents.id))
    .where(
      and(
        eq(atelierAgentRuns.agentId, req.params.agentId),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(limit);
  res.json(
    AtelierListAgentRunsResponse.parse(
      runs.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentName: r.agentName ?? r.agentId,
        status: (r.status as "running" | "blocked" | "complete" | "error") ?? "running",
        confidence: (r.confidence as "green" | "amber" | "red" | null) ?? null,
        message: r.statusMessage ?? "",
        targetType: r.targetType,
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        startedAt: r.createdAt.toISOString(),
        progressPct: r.progressPct,
        sourcesCount: r.sourcesCount,
        costUsd: r.costUsd,
        durationMs: r.durationMs,
      })),
    ),
  );
});

export default router;
