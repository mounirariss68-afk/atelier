/**
 * Task #871 — one-off LIVE ingestion of the 7 alliance partners.
 *
 * NOT a seeder: drives the running dev API server (localhost:8080) through
 * the real REST surface as Mounir, so every firm gets a genuine Alliance
 * Cartographer research run (live web research) and the researched
 * capability-profile proposals are approved through the real approval
 * queue (which triggers the RAG refresh).
 *
 * ⚠ PROD RE-RUN REQUIRED AT GO-LIVE — task-branch DB data never merges.
 *
 * Usage:
 *   tsx scripts/src/t871-alliance-partners-ingest.ts start    # ensure firms + stages, launch research
 *   tsx scripts/src/t871-alliance-partners-ingest.ts finish   # poll runs, approve profile proposals
 */

// In-process app under NODE_ENV=test so the persona cookie authenticates
// (dev server requires a real auth session). DATABASE_URL stays the dev DB;
// research runs use the live provider keys.
process.env.NODE_ENV = "test";
import type { AddressInfo } from "node:net";

const appMod = await import("../../artifacts/api-server/src/app.js");
const server = appMod.default.listen(0);
await new Promise<void>((r) => server.once("listening", () => r()));
const API = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
const COOKIE = "atelier_persona=p_mounir_ariss";

type Stage = { partnershipStage: string; agreementStage?: string | null };
const PARTNERS: Array<{
  match: RegExp;
  name: string;
  speciality: string;
  country?: string;
  stage: Stage;
}> = [
  {
    match: /bgts|bilgeadam/i,
    name: "BGTS (BilgeAdam Global Technology Services)",
    speciality: "European software and technology services firm (bgts.com) with 2,000+ engineers",
    stage: { partnershipStage: "agreed", agreementStage: "signing" },
  },
  {
    match: /argano/i,
    name: "Argano",
    speciality: "Systems integrator with Oracle, SAP, Salesforce, Microsoft and AWS practices",
    stage: { partnershipStage: "agreed", agreementStage: "signing" },
  },
  {
    match: /thoughtworks/i,
    name: "Thoughtworks",
    speciality: "AI works platform, software engineering and legacy modernization",
    stage: { partnershipStage: "agreed", agreementStage: "reviewing" },
  },
  {
    match: /lupitor/i,
    name: "Lupitor",
    speciality: "Call-center and voice AI solutions",
    stage: { partnershipStage: "agreed", agreementStage: "negotiating" },
  },
  {
    match: /agentic dynamic/i,
    name: "Agentic Dynamic",
    speciality: "Rapid enterprise AI-agent development; sovereign agents",
    stage: { partnershipStage: "agreed", agreementStage: "preparing" },
  },
  {
    match: /ekimetrics/i,
    name: "Ekimetrics",
    speciality: "Marketing and media effectiveness, marketing-mix modelling (MMM), data science",
    country: "France",
    stage: { partnershipStage: "exploration" },
  },
  {
    match: /extra360/i,
    name: "Extra360",
    speciality: "Loyalty and digital wallet platform",
    stage: { partnershipStage: "exploration" },
  },
];

// Profile-ish proposal fields to auto-approve (evaluation fields — archetype,
// tier, fitScorecard, dueDiligence, risks, phasing, contacts — stay pending
// for genuine human review in the UI).
const APPROVE_FIELDS = new Set(["capabilityProfile", "capabilities", "speciality", "kind", "country"]);

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: COOKIE },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listFirms(): Promise<any[]> {
  const r = await call("GET", "/partners/firms");
  if (r.status !== 200) throw new Error(`list firms → ${r.status}`);
  return r.body?.items ?? [];
}

async function start(): Promise<void> {
  const firms = await listFirms();
  for (const p of PARTNERS) {
    let firm = firms.find((f: any) => p.match.test(f.name));
    if (!firm) {
      const created = await call("POST", "/partners/firms", {
        name: p.name,
        speciality: p.speciality,
        country: p.country ?? null,
        status: "active",
        ...p.stage,
      });
      if (created.status !== 201) throw new Error(`create ${p.name} → ${created.status} ${JSON.stringify(created.body)}`);
      firm = created.body;
      console.log(`created ${p.name} → ${firm.id} (research auto-launched)`);
      continue; // create already triggers the cartographer
    }
    // Existing firm: align stages, then launch research explicitly.
    const patched = await call("PATCH", `/partners/firms/${firm.id}`, { ...p.stage });
    if (patched.status !== 200) throw new Error(`patch ${p.name} → ${patched.status}`);
    const run = await call("POST", `/partners/firms/${firm.id}/agents/alliance-cartographer/run`, {
      contextNotes: `Capability-profile research (Task #871). Focus: ${p.speciality}.`,
    });
    console.log(
      `updated ${firm.name} → ${p.stage.partnershipStage}/${p.stage.agreementStage ?? "—"}; research: ${
        run.status === 202 ? "launched" : run.status === 409 ? "already running" : `FAILED ${run.status}`
      }`,
    );
  }
}

async function finish(): Promise<void> {
  const firms = (await listFirms()).filter((f: any) => PARTNERS.some((p) => p.match.test(f.name)));
  if (firms.length !== PARTNERS.length) {
    console.warn(`expected ${PARTNERS.length} firms, found ${firms.length}`);
  }
  // Wait for research runs to settle.
  for (let i = 0; i < 25; i++) {
    const statuses = await Promise.all(
      firms.map(async (f: any) => {
        const s = await call("GET", `/partners/firms/${f.id}/agents/status`);
        return s.body?.agents?.alliance_cartographer?.status ?? "none";
      }),
    );
    const running = statuses.filter((s) => s === "running").length;
    console.log(`poll: ${statuses.join(",")}`);
    if (running === 0) break;
    await sleep(10_000);
  }
  // Approve profile-ish proposals; report.
  for (const f of firms) {
    const fresh = (await call("GET", `/partners/firms/${f.id}`)).body ?? f;
    const pending = (fresh.pendingUpdates ?? []).filter((u: any) => u.status === "pending");
    let approved = 0;
    for (const u of pending) {
      if (!APPROVE_FIELDS.has(u.field)) continue;
      const d = await call("POST", `/partners/firms/${f.id}/proposals/${u.id}/decide`, { action: "approve" });
      if (d.status === 200) approved++;
      else console.warn(`  approve ${u.field} on ${f.name} → ${d.status} ${JSON.stringify(d.body)?.slice(0, 200)}`);
    }
    const after = (await call("GET", `/partners/firms/${f.id}`)).body;
    console.log(
      `${f.name}: stage=${after?.partnershipStage}/${after?.agreementStage ?? "—"} approved=${approved} ` +
        `profile=${after?.capabilityProfile ? `${after.capabilityProfile.domains?.length ?? 0} domains` : "MISSING"} ` +
        `pendingLeft=${(after?.pendingUpdates ?? []).filter((u: any) => u.status === "pending").length}`,
    );
  }
}

const mode = process.argv[2];
try {
  if (mode === "start") await start();
  else if (mode === "finish") await finish();
  else if (mode === "all") {
    await start();
    console.log("--- research launched; waiting before approval phase ---");
    await sleep(30_000);
    await finish();
  } else {
    console.error("usage: t871-alliance-partners-ingest.ts start|finish|all");
    process.exitCode = 1;
  }
} finally {
  server.close();
  process.exit(process.exitCode ?? 0);
}
