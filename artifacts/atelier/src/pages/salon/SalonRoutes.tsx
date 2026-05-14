import * as React from "react";
import { Switch, Route, useRoute, useLocation, Link } from "wouter";
import {
  SalonI18nProvider,
  SalonShell,
  SalonWatermark,
  useSalonI18n,
  type SalonMe,
  type SalonWorkspace,
} from "@/components/salon/SalonShell";

// =============================================================
// Tiny fetch helpers — Salon UI is raw fetch (no codegen). #242 deviation.
// =============================================================
const API_BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}api/salon`;
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
function useApi<T>(path: string | null, dep: unknown[] = []): { data: T | null; error: Error | null; reload: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setError(null);
    api<T>(path).then(
      (d) => { if (!cancelled) setData(d); },
      (e) => { if (!cancelled) setError(e as Error); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...dep]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}

// =============================================================
// Sign-in / portfolio / wrappers
// =============================================================

function SalonSignIn() {
  const { data } = useApi<{ personas: Array<{ id: string; name: string; email?: string; initials?: string }> }>("/personas");
  const [, navigate] = useLocation();
  async function pick(id: string) {
    await api("/persona", { method: "POST", body: JSON.stringify({ personaId: id }) });
    navigate("/salon");
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="max-w-md w-full border border-border rounded p-6">
        <h1 className="text-lg font-semibold mb-2">The Salon — sign in</h1>
        <p className="text-sm text-text-mute mb-4">Pick a seeded client persona to enter your workspace.</p>
        <div className="space-y-2">
          {(data?.personas ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              className="w-full text-left border border-border rounded px-3 py-2 hover:border-text-mute"
            >
              <div className="text-sm font-medium">{p.name}</div>
              {p.email ? (
                <div className="text-xs text-text-mute">{p.email}</div>
              ) : p.initials ? (
                <div className="text-xs text-text-mute">{p.initials}</div>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SalonPortfolio() {
  const { data: me } = useApi<{ persona: SalonMe | null }>("/me");
  const [, navigate] = useLocation();
  React.useEffect(() => {
    if (me && !me.persona) navigate("/salon/sign-in");
  }, [me, navigate]);
  const { data } = useApi<{ engagements: Array<{ slug: string; displayName: string; accentColor: string; eyebrowText: string | null; plmStage: string; role: string }> }>("/engagements");
  return (
    <div className="min-h-screen bg-bg p-6">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="text-xs uppercase tracking-widest text-text-mute">The Salon</div>
          <h1 className="text-xl font-semibold">Welcome{me?.persona ? `, ${me.persona.name}` : ""}</h1>
        </header>
        <div className="space-y-3">
          {(data?.engagements ?? []).map((e) => (
            <Link
              key={e.slug}
              href={`/salon/${e.slug}`}
              className="block border border-border rounded p-4 hover:border-text-mute"
              style={{ borderLeftWidth: 4, borderLeftColor: e.accentColor }}
            >
              <div className="text-sm font-semibold">{e.displayName}</div>
              {e.eyebrowText && <div className="text-xs uppercase tracking-wider text-text-mute mt-1">{e.eyebrowText}</div>}
              <div className="mt-2 flex gap-3 text-xs text-text-mute">
                <span>Stage: <strong className="text-text">{e.plmStage}</strong></span>
                <span>Your role: <strong className="text-text">{e.role}</strong></span>
              </div>
            </Link>
          ))}
          {data && data.engagements.length === 0 && (
            <div className="text-sm text-text-mute">No engagements available to your persona.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================
// EngagementContext + per-tab pages
// =============================================================

interface EngagementCtx {
  workspace: SalonWorkspace;
  engagement: {
    id: string;
    name: string;
    plmStage: string;
    startDate: string;
    plannedEndDate: string;
    charter: { objectives: string[]; scope: string[]; outOfScope: string[]; successMetrics: { name: string; baseline: string; target: string }[]; governance: string; valueHypothesis: string } | null;
    workstreams: { name: string; lead: string; status: string }[];
    valueCase: unknown;
    raidStatus: string;
    deliverablesDueThisWeek: number;
  };
  account: { id: string; name: string; country: string; sector: string } | null;
  access: { role: "admin" | "approver" | "viewer"; canApprove: boolean; downloadsAllowed: boolean };
}

function SalonEngagementShell(props: { slug: string; me: SalonMe; children: (ctx: EngagementCtx) => React.ReactNode }) {
  const { data, error } = useApi<EngagementCtx>(`/engagements/${props.slug}`);
  if (error) {
    return <div className="p-6 text-sm text-text-mute">Cannot open Salon — {error.message}</div>;
  }
  if (!data) return <div className="p-6 text-sm text-text-mute">Loading…</div>;
  return (
    <SalonI18nProvider defaultLang={(data.workspace.defaultLocale as "en" | "ar") ?? "en"}>
      <SalonShell me={props.me} workspace={data.workspace}>
        {props.children(data)}
      </SalonShell>
    </SalonI18nProvider>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold mb-3">{children}</h2>;
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-border rounded p-4 ${className}`}>{children}</div>;
}

function OverviewTab({ ctx }: { ctx: EngagementCtx }) {
  const { t } = useSalonI18n();
  return (
    <div className="space-y-4">
      <SectionTitle>{t("overview")}</SectionTitle>
      <Card>
        <div className="text-xs uppercase tracking-widest text-text-mute">Stage</div>
        <div className="text-lg font-semibold">{ctx.engagement.plmStage}</div>
        <div className="mt-2 text-xs text-text-mute">{ctx.engagement.startDate} → {ctx.engagement.plannedEndDate}</div>
      </Card>
      {ctx.engagement.charter && (
        <Card>
          <div className="text-xs uppercase tracking-widest text-text-mute mb-1">Value hypothesis</div>
          <div className="text-sm">{ctx.engagement.charter.valueHypothesis}</div>
          <div className="mt-3 text-xs uppercase tracking-widest text-text-mute mb-1">Objectives</div>
          <ul className="text-sm list-disc pl-5">
            {ctx.engagement.charter.objectives.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <div className="text-xs text-text-mute">RAID</div>
          <div className="text-lg font-semibold capitalize">{ctx.engagement.raidStatus}</div>
        </Card>
        <Card>
          <div className="text-xs text-text-mute">Due this week</div>
          <div className="text-lg font-semibold">{ctx.engagement.deliverablesDueThisWeek}</div>
        </Card>
        <Card>
          <div className="text-xs text-text-mute">Account</div>
          <div className="text-lg font-semibold">{ctx.account?.name ?? "—"}</div>
        </Card>
      </div>
    </div>
  );
}

function ValueTab({ ctx }: { ctx: EngagementCtx }) {
  const c = ctx.engagement.charter;
  return (
    <div className="space-y-4">
      <SectionTitle>Value</SectionTitle>
      {c ? (
        <Card>
          <div className="text-sm">{c.valueHypothesis}</div>
          <table className="mt-4 w-full text-xs">
            <thead>
              <tr className="text-text-mute"><th className="text-left">Metric</th><th className="text-left">Baseline</th><th className="text-left">Target</th></tr>
            </thead>
            <tbody>
              {c.successMetrics.map((m, i) => (
                <tr key={i} className="border-t border-border"><td className="py-2">{m.name}</td><td>{m.baseline}</td><td>{m.target}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : <Card>No value case yet.</Card>}
    </div>
  );
}

function WorkplanTab({ ctx }: { ctx: EngagementCtx }) {
  return (
    <div className="space-y-4">
      <SectionTitle>Work plan</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ctx.engagement.workstreams.map((w, i) => (
          <Card key={i}>
            <div className="font-medium">{w.name}</div>
            <div className="text-xs text-text-mute mt-1">Lead: {w.lead}</div>
            <div className="mt-2 inline-block text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-border">{w.status}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DeliverablesTab({ slug }: { slug: string }) {
  const { data } = useApi<{ deliverables: Array<{ id: string; name: string; type: string; status: string; clientVisibility: string; updatedAt: string }> }>(`/engagements/${slug}/deliverables`);
  return (
    <div className="space-y-4">
      <SectionTitle>Deliverables</SectionTitle>
      <div className="space-y-2">
        {(data?.deliverables ?? []).map((d) => (
          <Link key={d.id} href={`/salon/${slug}/deliverables/${d.id}`}
            className="block border border-border rounded p-3 hover:border-text-mute">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{d.name}</div>
                <div className="text-xs text-text-mute mt-1">{d.type} · {d.status}</div>
              </div>
              <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-border">{d.clientVisibility}</span>
            </div>
          </Link>
        ))}
        {data && data.deliverables.length === 0 && <Card>No deliverables published yet.</Card>}
      </div>
    </div>
  );
}

function DeliverableDetail({ slug, deliverableId, ctx, me }: { slug: string; deliverableId: string; ctx: EngagementCtx; me: SalonMe }) {
  const { t } = useSalonI18n();
  const { data, error, reload } = useApi<{
    deliverable: { id: string; name: string; type: string; status: string; clientVisibility: string; body: string };
    publish: { id: string; sentinelStatus: string; publishedAt: string; publishedByName: string; downloadsAllowed: boolean; watermarkRequired: boolean } | null;
    access: { role: string; canApprove: boolean; downloadsAllowed: boolean };
  }>(`/deliverables/${deliverableId}`);
  const [kind, setKind] = React.useState<"approve" | "request_change" | "comment">("approve");
  const [headline, setHeadline] = React.useState("");
  const [rationale, setRationale] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  if (error) return <Card>Cannot open deliverable — {error.message}</Card>;
  if (!data) return <Card>Loading…</Card>;

  async function attemptDownload() {
    setFeedback(null);
    // Effective permission = access grant AND publish-level allow.
    if (data!.access.downloadsAllowed && data!.publish?.downloadsAllowed) {
      setFeedback("Download started (mock).");
      return;
    }
    await api(`/deliverables/${deliverableId}/download-attempt`, { method: "POST", body: "{}" });
    setFeedback(t("download_blocked"));
  }
  async function submitDecision() {
    if (!headline.trim()) {
      setFeedback("Headline is required.");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/deliverables/${deliverableId}/decision`, {
        method: "POST",
        body: JSON.stringify({ kind, headline, rationale }),
      });
      setHeadline("");
      setRationale("");
      setFeedback("Decision recorded.");
      reload();
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  const canDecide = (kind === "approve" ? data.access.canApprove : true);
  // Per-publish watermark override: if the publish requires a watermark but
  // the workspace flag is off, render a local overlay so per-deliverable
  // policy is honored even when the global default is disabled.
  const needsLocalWatermark = !!(data.publish?.watermarkRequired && !ctx.workspace.watermarkEnabled);

  return (
    <div className="space-y-4">
      {needsLocalWatermark && (
        <SalonWatermark name={me.name} email={me.email} engagementSlug={slug} />
      )}
      <Link href={`/salon/${slug}/deliverables`} className="text-xs text-text-mute hover:text-text">← All deliverables</Link>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{data.deliverable.name}</h2>
            <div className="text-xs text-text-mute mt-1">{data.deliverable.type} · {data.deliverable.status}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={attemptDownload}
              className="px-3 py-1.5 text-xs border border-border rounded hover:border-text-mute"
            >
              {t("download")}
            </button>
          </div>
        </div>
        {data.publish && (
          <div className="mt-2 text-[11px] uppercase tracking-wider text-text-mute">
            Published {new Date(data.publish.publishedAt).toLocaleString()} by {data.publish.publishedByName}
            {" · "}Sentinel: <strong className={data.publish.sentinelStatus === "pass" ? "text-emerald-600" : data.publish.sentinelStatus === "warn" ? "text-amber-600" : "text-red-600"}>{data.publish.sentinelStatus}</strong>
          </div>
        )}
      </Card>

      {!data.access.downloadsAllowed && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <div className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400">Downloads disabled</div>
          <div className="text-sm mt-1">{t("download_blocked")}</div>
        </Card>
      )}

      <Card>
        <div className="text-xs uppercase tracking-widest text-text-mute mb-2">Document</div>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">
          {data.deliverable.body || <em>No content yet.</em>}
        </div>
      </Card>

      <Card>
        <div className="text-xs uppercase tracking-widest text-text-mute mb-2">Record decision</div>
        <div className="flex gap-2 mb-2">
          {(["approve", "request_change", "comment"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-xs border rounded ${kind === k ? "border-[var(--salon-accent)] text-text" : "border-border text-text-mute"}`}
            >
              {t(k)}
            </button>
          ))}
        </div>
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Headline"
          className="block w-full border border-border rounded px-2 py-1.5 text-sm bg-transparent mb-2"
        />
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder={t("rationale_required")}
          rows={3}
          className="block w-full border border-border rounded px-2 py-1.5 text-sm bg-transparent mb-2"
        />
        {!canDecide && <div className="text-xs text-amber-600 mb-2">Your role cannot approve. Use Comment or Request change.</div>}
        <button
          disabled={submitting || !canDecide}
          onClick={submitDecision}
          className="px-4 py-1.5 text-xs rounded text-white"
          style={{ background: "var(--salon-accent)", opacity: !canDecide || submitting ? 0.5 : 1 }}
        >
          {t("send")}
        </button>
        {feedback && <div className="text-xs text-text-mute mt-2">{feedback}</div>}
      </Card>
    </div>
  );
}

function DecisionsTab({ slug }: { slug: string }) {
  const { data } = useApi<{ decisions: Array<{ id: string; kind: string; headline: string; rationale: string | null; decidedByName: string; decidedAt: string }> }>(`/engagements/${slug}/decisions`);
  return (
    <div className="space-y-4">
      <SectionTitle>Decisions</SectionTitle>
      <div className="space-y-2">
        {(data?.decisions ?? []).map((d) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{d.headline}</div>
              <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-border">{d.kind.replace("_", " ")}</span>
            </div>
            {d.rationale && <div className="text-xs text-text-mute mt-1">{d.rationale}</div>}
            <div className="text-[11px] text-text-mute mt-2">{d.decidedByName} · {new Date(d.decidedAt).toLocaleString()}</div>
          </Card>
        ))}
        {data && data.decisions.length === 0 && <Card>No decisions recorded yet.</Card>}
      </div>
    </div>
  );
}

function MeetingsTab({ slug }: { slug: string }) {
  const { data } = useApi<{ meetings: Array<{ id: string; title: string; startsAt: string | null; status: string; durationMinutes: number | null }> }>(`/engagements/${slug}/meetings`);
  return (
    <div className="space-y-4">
      <SectionTitle>Meetings</SectionTitle>
      <div className="space-y-2">
        {(data?.meetings ?? []).map((m) => (
          <Card key={m.id}>
            <div className="text-sm font-medium">{m.title}</div>
            <div className="text-xs text-text-mute mt-1">{m.startsAt ? new Date(m.startsAt).toLocaleString() : "—"} · {m.status}</div>
          </Card>
        ))}
        {data && data.meetings.length === 0 && <Card>No meetings scheduled.</Card>}
      </div>
    </div>
  );
}

function TeamTab({ slug }: { slug: string }) {
  const { data } = useApi<{
    aico: Array<{ id: string; name: string; title: string; roleLabel: string; initials: string }>;
    client: Array<{ id: string; name: string; title: string; initials: string; role: string; canApprove: boolean }>;
  }>(`/engagements/${slug}/team`);
  return (
    <div className="space-y-4">
      <SectionTitle>Team</SectionTitle>
      <Card>
        <div className="text-xs uppercase tracking-widest text-text-mute mb-2">AICo team</div>
        <div className="space-y-2">
          {(data?.aico ?? []).map((u) => (
            <div key={u.id} className="text-sm">{u.name} <span className="text-text-mute">— {u.roleLabel}, {u.title}</span></div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="text-xs uppercase tracking-widest text-text-mute mb-2">Your team</div>
        <div className="space-y-2">
          {(data?.client ?? []).map((u) => (
            <div key={u.id} className="text-sm">{u.name} <span className="text-text-mute">— {u.title} · {u.role}{u.canApprove ? " (approver)" : ""}</span></div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RequestsTab({ slug }: { slug: string }) {
  const { data, reload } = useApi<{ requests: Array<{ id: string; kind: string; title: string; status: string; raisedByName: string; raisedAt: string }> }>(`/engagements/${slug}/requests`);
  const [kind, setKind] = React.useState("clarification");
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  async function submit() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api(`/engagements/${slug}/requests`, { method: "POST", body: JSON.stringify({ kind, title, detail }) });
      setTitle(""); setDetail("");
      reload();
    } finally { setSubmitting(false); }
  }
  return (
    <div className="space-y-4">
      <SectionTitle>Requests</SectionTitle>
      <Card>
        <div className="text-xs uppercase tracking-widest text-text-mute mb-2">Raise a request</div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="border border-border rounded px-2 py-1 text-sm bg-transparent mb-2">
          <option value="copy_request">Copy request</option>
          <option value="meeting">Meeting</option>
          <option value="clarification">Clarification</option>
          <option value="other">Other</option>
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="block w-full border border-border rounded px-2 py-1.5 text-sm bg-transparent mb-2" />
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detail" rows={3} className="block w-full border border-border rounded px-2 py-1.5 text-sm bg-transparent mb-2" />
        <button disabled={submitting} onClick={submit} className="px-3 py-1.5 text-xs rounded text-white" style={{ background: "var(--salon-accent)" }}>Send</button>
      </Card>
      <div className="space-y-2">
        {(data?.requests ?? []).map((r) => (
          <Card key={r.id}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{r.title}</div>
              <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-border">{r.status}</span>
            </div>
            <div className="text-xs text-text-mute mt-1">{r.kind} · {r.raisedByName} · {new Date(r.raisedAt).toLocaleString()}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SettingsTab({ ctx }: { ctx: EngagementCtx }) {
  const { lang, setLang } = useSalonI18n();
  return (
    <div className="space-y-4">
      <SectionTitle>Settings</SectionTitle>
      <Card>
        <div className="text-sm">Language: <strong>{lang === "en" ? "English" : "العربية"}</strong></div>
        <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="mt-2 px-3 py-1.5 text-xs border border-border rounded">Toggle</button>
      </Card>
      <Card>
        <div className="text-sm">Workspace: <strong>{ctx.workspace.displayName}</strong></div>
        <div className="text-xs text-text-mute mt-1">Default locale: {ctx.workspace.defaultLocale} · Watermark: {ctx.workspace.watermarkEnabled ? "on" : "off"}</div>
      </Card>
    </div>
  );
}

// =============================================================
// Top-level Salon route tree
// =============================================================

function MeWrapper({ children }: { children: (me: SalonMe) => React.ReactNode }) {
  const { data, error } = useApi<{ persona: SalonMe | null }>("/me");
  const [, navigate] = useLocation();
  React.useEffect(() => {
    if (data && !data.persona) navigate("/salon/sign-in");
  }, [data, navigate]);
  if (error) return <div className="p-6 text-sm">Cannot reach Salon API: {error.message}</div>;
  if (!data?.persona) return <div className="p-6 text-sm text-text-mute">Loading…</div>;
  return <>{children(data.persona)}</>;
}

function EngagementRoute(props: { slug: string; me: SalonMe }) {
  const { slug, me } = props;
  return (
    <SalonEngagementShell slug={slug} me={me}>
      {(ctx) => (
        <Switch>
          <Route path={`/salon/${slug}`}><OverviewTab ctx={ctx} /></Route>
          <Route path={`/salon/${slug}/value`}><ValueTab ctx={ctx} /></Route>
          <Route path={`/salon/${slug}/workplan`}><WorkplanTab ctx={ctx} /></Route>
          <Route path={`/salon/${slug}/deliverables`}><DeliverablesTab slug={slug} /></Route>
          <Route path={`/salon/${slug}/deliverables/:id`}>
            {(params) => <DeliverableDetail slug={slug} deliverableId={params.id!} ctx={ctx} me={me} />}
          </Route>
          <Route path={`/salon/${slug}/decisions`}><DecisionsTab slug={slug} /></Route>
          <Route path={`/salon/${slug}/meetings`}><MeetingsTab slug={slug} /></Route>
          <Route path={`/salon/${slug}/team`}><TeamTab slug={slug} /></Route>
          <Route path={`/salon/${slug}/requests`}><RequestsTab slug={slug} /></Route>
          <Route path={`/salon/${slug}/settings`}><SettingsTab ctx={ctx} /></Route>
          <Route><div className="p-6 text-sm text-text-mute">Unknown Salon page.</div></Route>
        </Switch>
      )}
    </SalonEngagementShell>
  );
}

// =============================================================
// Task #297 — Per-recipient proposal view. Token IS the auth — no
// salon persona required. We render the API's HTML inside a sandboxed
// iframe and let the watermark in the HTML do the heavy lifting; we
// add a thin Salon-style chrome so the recipient knows where they are.
// =============================================================
function SalonProposalView({ proposalId, token }: { proposalId: string; token: string }) {
  const src = `/api/salon/proposal/${proposalId}/${token}/html`;
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // HEAD-style fetch on the JSON endpoint to detect 404/410 cleanly.
    fetch(`/api/salon/proposal/${proposalId}/${token}`, { credentials: "include" })
      .then((r) => {
        if (r.status === 404) setError("This share link is not valid.");
        else if (r.status === 410) setError("This share link has expired or been revoked.");
        else if (!r.ok) setError(`Could not load (${r.status}).`);
      })
      .catch(() => setError("Could not reach the server."));
  }, [proposalId, token]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="max-w-md w-full border border-border rounded p-6 text-center">
          <div className="text-base font-medium text-text">Unavailable</div>
          <div className="text-sm text-text-mute mt-2">{error}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen w-full bg-white" data-testid="salon-proposal-view">
      <iframe
        src={src}
        title="Proposal"
        sandbox="allow-same-origin"
        className="block w-full"
        style={{ height: "100vh", border: 0 }}
        data-testid="salon-proposal-iframe"
      />
    </div>
  );
}

export function SalonRoot() {
  const [matchProposal, proposalParams] = useRoute<{ proposalId: string; token: string }>("/salon/proposal/:proposalId/:token");
  const [matchEng] = useRoute<{ slug: string }>("/salon/:slug/:rest*");
  const [matchEngTop] = useRoute<{ slug: string }>("/salon/:slug");
  const [matchSignin] = useRoute("/salon/sign-in");
  if (matchSignin) return <SalonSignIn />;
  if (matchProposal && proposalParams) {
    return <SalonProposalView proposalId={proposalParams.proposalId} token={proposalParams.token} />;
  }

  return (
    <MeWrapper>
      {(me) => {
        if (matchEng || matchEngTop) {
          // wouter type doesn't know — re-extract slug
          const m = window.location.pathname.match(/^.*\/salon\/([^/]+)/);
          const slug = m?.[1] ?? "";
          if (slug && slug !== "sign-in") return <EngagementRoute slug={slug} me={me} />;
        }
        return <SalonPortfolio />;
      }}
    </MeWrapper>
  );
}
