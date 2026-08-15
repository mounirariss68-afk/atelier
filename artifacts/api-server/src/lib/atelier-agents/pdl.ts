// People Data Labs (PDL) executive lookup for the Executive Mapper.
//
// The public-web LLM sweep cannot see people whose LinkedIn profiles are
// confidential or unindexed. PDL is a licensed people-data provider whose
// Person Search API fills that gap. This module is a thin, deterministic
// client: resolve the company to a PDL id (Company Enrich), then pull its
// senior people (Person Search).
//
// Behaviour contract:
// - PDL_API_KEY unset -> isPdlConfigured() is false; callers skip the step
//   and note it in openQuestions (never a silent no-op).
// - API/network failure -> throws PdlLookupError; callers degrade the run
//   (web results still ship) but must surface the failure, never hide it.
// - Costs: one company credit per resolve, one person credit per returned
//   record. MAX_PEOPLE caps spend per run.

const PDL_BASE = "https://api.peopledatalabs.com/v5";
const MAX_PEOPLE = 25;
// Board pass has its own small cap so directors never crowd out executives
// (and to bound credit spend — each returned record costs a person credit).
const MAX_BOARD_PEOPLE = 10;

export class PdlLookupError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PdlLookupError";
  }
}

export function isPdlConfigured(): boolean {
  return Boolean(process.env.PDL_API_KEY && process.env.PDL_API_KEY.trim());
}

export interface PdlExecutive {
  fullName: string;
  title: string | null;
  linkedinUrl: string | null;
  jobCompanyName: string | null;
  seniorityLevels: string[];
  /** True when this record came from the dedicated board-title pass. */
  isBoard: boolean;
}

interface PdlPersonRecord {
  full_name?: string | null;
  job_title?: string | null;
  job_title_levels?: string[] | null;
  job_company_name?: string | null;
  linkedin_url?: string | null;
}

function apiKey(): string {
  const key = process.env.PDL_API_KEY?.trim();
  if (!key) {
    throw new PdlLookupError("PDL_API_KEY is not configured");
  }
  return key;
}

async function pdlFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${PDL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-Api-Key": apiKey() } });
  } catch (err) {
    throw new PdlLookupError(
      `PDL request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 404) return null; // PDL uses 404 for "no match" on enrich
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PdlLookupError(
      `PDL ${path} returned ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    );
  }
  return res.json();
}

/**
 * Name variants to try against Company Enrich, most-specific first. PDL's
 * matcher is literal-minded: "Tasama Business Services Company" misses while
 * the brand name "tasama" hits, so legal-suffix-stripped and brand-word
 * variants are essential.
 */
export function companyNameCandidates(name: string, brandName?: string | null): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(name);
  push(brandName);
  const suffixes =
    /\s+(business services company|holding company|company|corporation|incorporated|limited|group|holding|co\.?|llc|ltd\.?|inc\.?|plc|sa|gmbh)\.?$/i;
  let stripped = name.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = stripped.replace(suffixes, "").trim();
    if (next === stripped) break;
    stripped = next;
    push(stripped);
  }
  const firstWord = name.trim().split(/\s+/)[0];
  if (firstWord && firstWord.length >= 4) push(firstWord);
  return out;
}

/** Resolve a company name (+country hint) to a PDL company id, or null. */
export async function resolvePdlCompanyId(args: {
  name: string;
  brandName?: string | null;
  country?: string | null;
}): Promise<{ id: string; displayName: string } | null> {
  // Each /company/enrich call costs one company credit whether or not it
  // matches, so bound the candidate loop rather than trying every variant.
  const MAX_COMPANY_RESOLVE_ATTEMPTS = 4;
  for (const candidate of companyNameCandidates(args.name, args.brandName).slice(
    0,
    MAX_COMPANY_RESOLVE_ATTEMPTS,
  )) {
    const params: Record<string, string> = { name: candidate };
    if (args.country && args.country.trim()) params.country = args.country.trim();
    const raw = (await pdlFetch("/company/enrich", params)) as {
      id?: string;
      display_name?: string;
      name?: string;
    } | null;
    if (raw?.id) {
      return { id: raw.id, displayName: raw.display_name ?? raw.name ?? candidate };
    }
  }
  return null;
}

/**
 * Senior people currently at the given PDL company. Sorted so the most
 * senior levels come first; capped at MAX_PEOPLE to bound credit spend.
 */
export async function searchPdlExecutives(
  companyId: string,
  opts?: { government?: boolean },
): Promise<PdlExecutive[]> {
  // job_title_levels is unreliable — real C-suite records sometimes carry an
  // empty array (e.g. "chief of corporate affairs", "chief of staff"), so
  // match on title keywords as well, never on levels alone.
  //
  // Two passes: PDL pages results in its own arbitrary order, so a single
  // capped query can drop a chief behind 25 directors. Pass 1 fetches the
  // C-suite exhaustively; pass 2 fills the remaining slots with the broader
  // senior sweep.
  const cid = companyId.replace(/'/g, "");
  // Board pass: chairman / vice chairman / board member / non-executive
  // director are NOT captured by the executive passes (they rarely carry
  // 'chief' titles or cxo levels) yet are often the real decision-makers.
  // Small, capped separately so directors can't crowd out the C-suite.
  const boardSql =
    `SELECT * FROM person WHERE job_company_id = '${cid}'` +
    ` AND (job_title LIKE 'chairman%' OR job_title LIKE 'vice chairman%'` +
    ` OR job_title LIKE 'chairperson%' OR job_title LIKE 'chair of%'` +
    ` OR job_title LIKE '%board member%' OR job_title LIKE 'member of the board%'` +
    ` OR job_title LIKE 'non-executive director%' OR job_title LIKE 'non executive director%'` +
    ` OR job_title LIKE 'board director%' OR job_title LIKE 'independent director%')`;
  const csuiteSql =
    `SELECT * FROM person WHERE job_company_id = '${cid}'` +
    ` AND (job_title_levels = 'cxo' OR job_title LIKE 'chief%')`;
  const broadSql =
    `SELECT * FROM person WHERE job_company_id = '${cid}'` +
    ` AND NOT job_title LIKE 'chief%'` +
    ` AND (job_title_levels IN ('owner', 'partner', 'vp', 'director')` +
    ` OR job_title LIKE '%officer%'` +
    ` OR job_title LIKE 'head of%' OR job_title LIKE '%head'` +
    ` OR job_title LIKE 'vice president%' OR job_title LIKE 'vp%'` +
    ` OR job_title LIKE '%president%' OR job_title LIKE '%director%'` +
    ` OR job_title LIKE 'general manager%' OR job_title LIKE 'managing%'` +
    // Task #206 — critical-role function sweep. Function keywords ANDed with
    // seniority markers (keyword+levels, never levels alone) so functional
    // leaders whose titles skip "head of"/"vp" wording still surface, without
    // pulling managers/ICs into the capped slots.
    ` OR ((job_title LIKE '%marketing%' OR job_title LIKE '%product%'` +
    ` OR job_title LIKE '%commercial%' OR job_title LIKE '%transformation%'` +
    ` OR job_title LIKE '%procurement%' OR job_title LIKE '%supply chain%'` +
    ` OR job_title LIKE '%pmo%' OR job_title LIKE '%program management%'` +
    ` OR job_title LIKE '%programme management%'` +
    ` OR job_title LIKE '%value realization%' OR job_title LIKE '%value realisation%'` +
    ` OR job_title LIKE '%artificial intelligence%' OR job_title LIKE '% ai %'` +
    ` OR job_title LIKE 'ai %' OR job_title LIKE '%data%' OR job_title LIKE '%digital%')` +
    ` AND (job_title_levels IN ('owner', 'partner', 'vp', 'director')` +
    ` OR job_title LIKE 'head%' OR job_title LIKE '%head of%'` +
    ` OR job_title LIKE 'vp%' OR job_title LIKE 'evp%' OR job_title LIKE 'svp%'` +
    ` OR job_title LIKE 'vice president%' OR job_title LIKE 'executive vice president%'` +
    ` OR job_title LIKE 'senior vice president%')))`;
  // Government-body pass — ministries and public authorities in the GCC and
  // Türkiye follow government rank hierarchies (Minister → Deputy/Vice/
  // Assistant Minister → Undersecretary → Director General; Governor for
  // authorities/central banks; Türkiye: Bakan Yardımcısı / Genel Müdür /
  // Daire Başkanı), which the corporate passes above never match.
  const govSql =
    `SELECT * FROM person WHERE job_company_id = '${cid}'` +
    ` AND (job_title LIKE '%minister%'` +
    ` OR job_title LIKE '%undersecretary%' OR job_title LIKE '%under secretary%'` +
    ` OR job_title LIKE '%director general%' OR job_title LIKE '%general director%'` +
    ` OR job_title LIKE '%secretary general%'` +
    ` OR job_title LIKE '%governor%'` +
    ` OR job_title LIKE '%bakan%' OR job_title LIKE '%genel müdür%'` +
    ` OR job_title LIKE '%genel mudur%' OR job_title LIKE '%daire başkanı%'` +
    ` OR job_title LIKE '%müsteşar%'` +
    // Task #1189 — functional department leads below Assistant Undersecretary
    // (IT / Cybersecurity / AI / Digital / Customer care). Function keywords
    // ANDed with director/head seniority markers (same pattern as the
    // corporate functional sweep) so ministry department heads surface
    // without juniors eating the capped slots.
    ` OR ((job_title LIKE '%information technology%' OR job_title LIKE '% it %'` +
    ` OR job_title LIKE 'it %' OR job_title LIKE '% it' OR job_title LIKE '%ict%'` +
    ` OR job_title LIKE '%cyber%' OR job_title LIKE '%information security%'` +
    ` OR job_title LIKE '%artificial intelligence%' OR job_title LIKE '% ai %'` +
    ` OR job_title LIKE 'ai %' OR job_title LIKE '%digital%'` +
    ` OR job_title LIKE '%transformation%'` +
    ` OR job_title LIKE '%customer happiness%' OR job_title LIKE '%customer experience%'` +
    ` OR job_title LIKE '%customer care%' OR job_title LIKE '%customer service%'` +
    ` OR job_title LIKE '%bilgi teknolojileri%' OR job_title LIKE '%bilgi işlem%'` +
    ` OR job_title LIKE '%siber güvenlik%' OR job_title LIKE '%yapay zeka%'` +
    ` OR job_title LIKE '%müşteri%')` +
    ` AND (job_title_levels IN ('director', 'vp', 'cxo')` +
    ` OR job_title LIKE '%director%' OR job_title LIKE 'head%'` +
    ` OR job_title LIKE '%head of%' OR job_title LIKE '%daire başkanı%')))`;
  const boardRaw = (await pdlFetch("/person/search", {
    sql: boardSql,
    size: String(MAX_BOARD_PEOPLE),
  })) as { data?: PdlPersonRecord[] } | null;
  const board = boardRaw?.data ?? [];
  const csuiteRaw = (await pdlFetch("/person/search", {
    sql: csuiteSql,
    size: String(MAX_PEOPLE),
  })) as { data?: PdlPersonRecord[] } | null;
  const csuite = csuiteRaw?.data ?? [];
  // Government pass runs alongside the C-suite pass (never instead of it —
  // some authorities mix "Governor" with corporate CxO titles), capped at
  // MAX_PEOPLE and deduped by name below.
  let gov: PdlPersonRecord[] = [];
  if (opts?.government) {
    const govRaw = (await pdlFetch("/person/search", {
      sql: govSql,
      size: String(MAX_PEOPLE),
    })) as { data?: PdlPersonRecord[] } | null;
    gov = govRaw?.data ?? [];
  }
  const remaining = Math.max(0, MAX_PEOPLE - csuite.length - gov.length);
  let broad: PdlPersonRecord[] = [];
  if (remaining > 0) {
    const broadRaw = (await pdlFetch("/person/search", {
      sql: broadSql,
      size: String(remaining),
    })) as { data?: PdlPersonRecord[] } | null;
    broad = broadRaw?.data ?? [];
  }
  const boardKeys = new Set(
    board.map((p) => (p.full_name ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const raw = {
    data: [
      ...board,
      // A chairman can also appear in the exec passes (e.g. "chairman & CEO");
      // drop the exec duplicate so the board flag wins.
      ...dedupeByName(
        [...gov, ...csuite, ...broad].filter(
          (p) => !boardKeys.has((p.full_name ?? "").trim().toLowerCase()),
        ),
      ),
    ],
  };
  function dedupeByName(records: PdlPersonRecord[]): PdlPersonRecord[] {
    const seen = new Set<string>();
    const out: PdlPersonRecord[] = [];
    for (const p of records) {
      const key = (p.full_name ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }
  const rank = (levels: string[], title: string | null | undefined): number => {
    const t = (title ?? "").toLowerCase();
    if (levels.includes("cxo") || levels.includes("owner") || t.startsWith("chief")) return 0;
    if (
      levels.includes("partner") ||
      levels.includes("vp") ||
      t.includes("president") ||
      t.startsWith("managing")
    )
      return 1;
    return 2;
  };
  const people = (raw?.data ?? [])
    .filter((p) => typeof p.full_name === "string" && p.full_name.trim().length > 1)
    .map((p) => ({
      fullName: toTitleCase(p.full_name!.trim()),
      title: p.job_title ? toTitleCase(p.job_title.trim()) : null,
      linkedinUrl: p.linkedin_url ? normaliseUrl(p.linkedin_url) : null,
      jobCompanyName: p.job_company_name ?? null,
      seniorityLevels: Array.isArray(p.job_title_levels) ? p.job_title_levels : [],
      isBoard: boardKeys.has((p.full_name ?? "").trim().toLowerCase()),
    }));
  people.sort((a, b) => {
    // Board first (chairman apex), then execs by rank.
    if (a.isBoard !== b.isBoard) return a.isBoard ? -1 : 1;
    return rank(a.seniorityLevels, a.title) - rank(b.seniorityLevels, b.title);
  });
  return people;
}

/** One-call convenience: resolve the company then pull its executives. */
export async function fetchPdlExecutivesForCompany(args: {
  name: string;
  brandName?: string | null;
  country?: string | null;
  /** Government body: adds the ministry-rank title pass to the sweep. */
  government?: boolean;
}): Promise<{ company: { id: string; displayName: string }; people: PdlExecutive[] } | null> {
  const company = await resolvePdlCompanyId(args);
  if (!company) return null;
  const people = await searchPdlExecutives(company.id, { government: args.government });
  return { company, people };
}

function normaliseUrl(u: string): string {
  const trimmed = u.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function toTitleCase(s: string): string {
  // PDL returns lowercased names/titles; title-case them without mangling
  // all-caps acronyms that PDL occasionally preserves.
  return s
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() && w.length <= 4 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
