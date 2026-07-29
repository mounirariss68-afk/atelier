import * as React from "react";
import { Link, useRoute } from "wouter";
import {
  Activity,
  FileText,
  Wrench,
  CheckCircle2,
  XCircle,
  Edit3,
  Play,
  AlertTriangle,
} from "lucide-react";
import {
  useAtelierListAgents,
  useAtelierGetAgentRun,
  useAtelierRecordAgentDecision,
  getAtelierGetAgentRunQueryKey,
  getAtelierListAgentRunsQueryKey,
} from "@workspace/api-client-react";
import type {
  AgentCatalogEntry,
  AtelierAgentSchemaField,
  AtelierAgentRunDetail,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BackLink, SectionHead, PageHero, MonoChip, Card } from "@/components/ui/primitives";
import { AuditTab } from "@/components/AuditTab";
import { useFileIncident, type FileIncidentInput } from "@/lib/agents-lens-seed";

const TABS = [
  { id: "trace", label: "Trace" },
  { id: "io", label: "Input / Output" },
  { id: "tools", label: "Tool Calls" },
  { id: "audit", label: "Audit Trail" },
] as const;

/**
 * Registry-driven Agent Run view.
 *
 * Per artifacts/atelier/AGENT_STANDARD.md §8 (UI contract): the standard
 * Agent Run view is auto-generated from the registry. The IO tab renders:
 *   - the input form, generated from `agent.inputs` (string / number /
 *     boolean / enum) so any new agent gets a usable form for free;
 *   - the live output preview, fetched from `/atelier/agent-runs/:runId`,
 *     rendered as pretty JSON;
 *   - approve / edit / reject controls bound to the run's
 *     `humanCheckpoints` via the existing `/decision` endpoint.
 * Bespoke views are opt-in via `uiComponent` (see standard §8).
 */
export default function AgentRun() {
  // Task #370 — runs re-mount under /agents/monitor/runs/:runId; the
  // legacy `/agents/runs/:runId` path redirects to here, but the route
  // pattern below now matches the lens URL.
  const [, params] = useRoute("/agents/monitor/runs/:runId");
  const runId = params?.runId ?? "";
  const [activeTab, setActiveTab] = React.useState<(typeof TABS)[number]["id"]>("io");

  const { data: agents } = useAtelierListAgents();
  const { data: runDetail } = useAtelierGetAgentRun(runId, {
    query: {
      queryKey: getAtelierGetAgentRunQueryKey(runId),
      enabled: !!runId,
      refetchInterval: 4000,
    },
  });

  const status = runDetail?.status;
  const agent = runDetail?.agentId
    ? agents?.find((a) => a.id === runDetail.agentId)
    : undefined;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/agents/monitor" data-testid="link-back-agents">
          Back to monitor
        </BackLink>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead
            eyebrow={agent ? `${agent.group} · ${agent.stage}` : "Agent run"}
            headline={agent?.name ?? runId}
            lede={
              <div className="flex items-center gap-3 mt-2">
                <MonoChip
                  tone={
                    status === "complete"
                      ? "green"
                      : status === "error"
                        ? "default"
                        : "gold"
                  }
                >
                  {(status ?? "unknown").toUpperCase()}
                </MonoChip>
                <span className="font-mono text-xs text-text-mute">{runId}</span>
                {typeof runDetail?.costUsd === "number" && (
                  <span className="font-mono text-xs text-text-mute">${runDetail.costUsd.toFixed(4)}</span>
                )}
              </div>
            }
          />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-8">
        <FileIncidentPanel
          runId={runId}
          agentId={agent?.id}
          agentName={agent?.name}
          status={status}
        />
        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto scrollbar-thin">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                data-testid={`tab-agentrun-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? "border-gold text-gold"
                    : "border-transparent text-text-mute hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="py-4">
          {activeTab === "audit" ? (
            <AuditTab entityType="agent_run" entityId={runId} />
          ) : activeTab === "io" ? (
            <IoTab agent={agent} runId={runId} runDetail={runDetail} />
          ) : (
            <EmptyTab
              icon={activeTab === "tools" ? <Wrench className="w-6 h-6" /> : <Activity className="w-6 h-6" />}
              title={TABS.find((t) => t.id === activeTab)?.label ?? ""}
              body={
                agent
                  ? `Step-by-step trace and tool-call inspector for ${agent.name} ship in a later workstream — see AGENT_STANDARD.md §4.`
                  : "Trace and tool-call inspector ship in a later workstream. Foundation registers the run shell, audit trail, and PDF export."
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyTab({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep">
      <div className="w-12 h-12 bg-bg-elevate rounded-full flex items-center justify-center mb-4 text-gold">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-text mb-2">{title}</h3>
      <p className="text-text-mute max-w-md">{body}</p>
    </Card>
  );
}

function IoTab({
  agent,
  runId,
  runDetail,
}: {
  agent: AgentCatalogEntry | undefined;
  runId: string;
  runDetail: AtelierAgentRunDetail | undefined;
}) {
  if (!agent) {
    return (
      <EmptyTab
        icon={<FileText className="w-6 h-6" />}
        title="Input / Output"
        body="Run metadata isn't loaded yet — the run shell is registered, but the registry hasn't loaded for this agent."
      />
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InputFormCard agent={agent} runId={runId} />
        <OutputPreviewCard agent={agent} runDetail={runDetail} />
      </div>
      <CheckpointControls runId={runId} runDetail={runDetail} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SchemaCard
          title="Input contract"
          subtitle={
            <>
              From <code className="text-gold">{agent.id}</code> registry entry.
            </>
          }
          fields={agent.inputs}
        />
        <SchemaCard
          title="Output contract"
          subtitle="Validated by `runAgent` on every complete."
          fields={agent.outputs}
        />
      </div>
    </div>
  );
}

/**
 * Generic input form generated from `agent.inputs` (registry-derived
 * schema fields). Submitting POSTs to the conventional per-agent run
 * endpoint `/api/atelier/agents/:agentId/run`. Agents that haven't
 * registered that route yet will get a 404 — the form still validates
 * input shape so partners can preview what they'd send.
 */
function InputFormCard({ agent, runId }: { agent: AgentCatalogEntry; runId: string }) {
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const fields = agent.inputs ?? [];

  const update = (name: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/atelier/agents/${encodeURIComponent(agent.id)}/run`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      if (!res.ok) {
        if (res.status === 404) {
          setError(
            "This agent hasn't registered a generic /run endpoint yet. " +
              "Trigger it from its host page (Pursuit, Engagement, etc.) " +
              "or wire the route per AGENT_STANDARD.md §6.",
          );
        } else {
          setError(`Run failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
        }
        return;
      }
      const json = (await res.json()) as { runId?: string };
      setSuccess(json.runId ? `Started run ${json.runId}` : "Started.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
        Input form
      </h3>
      <p className="text-sm text-text-mute">
        Generated from <code className="text-gold">{agent.id}</code>'s
        registry inputs. {runId && <span className="text-text-faint">Re-running creates a new run row.</span>}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3" data-testid={`form-run-${agent.id}`}>
        {fields.length === 0 && (
          <p className="text-xs text-text-faint italic">
            No structured inputs declared in the registry — agent runs without parameters.
          </p>
        )}
        {fields.map((f) => (
          <FormField key={f.name} field={f} value={values[f.name]} onChange={(v) => update(f.name, v)} />
        ))}
        <button
          type="submit"
          disabled={submitting}
          data-testid="button-run-agent"
          className="inline-flex items-center gap-2 bg-gold text-bg-deep px-4 py-2 rounded text-sm font-medium hover:bg-gold/90 disabled:opacity-50 transition-colors"
        >
          <Play className="w-4 h-4" />
          {submitting ? "Starting…" : "Run agent"}
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}
        {success && <p className="text-xs text-success">{success}</p>}
      </form>
    </Card>
  );
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: AtelierAgentSchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${field.name}`;
  const label = (
    <label htmlFor={id} className="block text-xs font-mono text-text mb-1">
      {field.name}
      {field.required && <span className="text-danger ml-1">*</span>}
      {field.description && (
        <span className="ml-2 text-text-faint normal-case font-sans italic">{field.description}</span>
      )}
    </label>
  );

  if (field.type === "boolean") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-border-soft"
          data-testid={`input-${field.name}`}
        />
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <div>
        {label}
        <input
          id={id}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          required={field.required}
          className="w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm font-mono text-text"
          data-testid={`input-${field.name}`}
        />
      </div>
    );
  }
  if (field.type === "enum" && field.enumValues) {
    return (
      <div>
        {label}
        <select
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          required={field.required}
          className="w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm font-mono text-text"
          data-testid={`input-${field.name}`}
        >
          <option value="">— select —</option>
          {field.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "object" || field.type === "array") {
    return (
      <div>
        {label}
        <textarea
          id={id}
          value={
            value === undefined
              ? ""
              : typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2)
          }
          onChange={(e) => {
            const raw = e.target.value;
            try {
              onChange(raw === "" ? undefined : JSON.parse(raw));
            } catch {
              onChange(raw); // keep raw text while user is editing
            }
          }}
          rows={4}
          placeholder={field.type === "array" ? "[]" : "{}"}
          required={field.required}
          className="w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm font-mono text-text"
          data-testid={`input-${field.name}`}
        />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input
        id={id}
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        required={field.required}
        className="w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text"
        data-testid={`input-${field.name}`}
      />
    </div>
  );
}

/**
 * Live output preview — reads the run row's `output` JSON and displays
 * it. Polls every 4s via the surrounding query so streaming updates
 * are visible without a refresh.
 */
function OutputPreviewCard({
  agent,
  runDetail,
}: {
  agent: AgentCatalogEntry;
  runDetail: AtelierAgentRunDetail | undefined;
}) {
  return (
    <Card className="p-5 space-y-3">
      <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
        Output preview
      </h3>
      <p className="text-sm text-text-mute">
        Live from <code className="text-gold">atelier_agent_runs.output</code>.
        {agent.outputs && agent.outputs.length > 0 && (
          <> Conforms to {agent.outputs.length} registry field{agent.outputs.length === 1 ? "" : "s"}.</>
        )}
      </p>
      {runDetail?.statusMessage && (
        <div className="text-xs font-mono text-text-faint border border-border-soft rounded px-2 py-1 bg-bg-deep">
          {runDetail.statusMessage}
        </div>
      )}
      {runDetail?.output ? (
        <pre
          data-testid="text-run-output"
          className="text-xs font-mono text-text bg-bg-deep border border-border-soft rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap break-all"
        >
          {JSON.stringify(runDetail.output, null, 2)}
        </pre>
      ) : (
        <p className="text-xs text-text-faint italic">
          {runDetail?.status === "running"
            ? "Run in flight — output will appear here when complete."
            : "No output yet."}
        </p>
      )}
    </Card>
  );
}

/**
 * Approve / Edit / Reject controls bound to the run's checkpoints.
 *
 * The runDetail's `humanDecisions` array is the audit trail of past
 * decisions; if the latest decision is `approve` the controls are
 * disabled. Hits `/atelier/agent-runs/:runId/decision` (already wired
 * server-side: see agentRoutes.ts line 1097).
 */
function CheckpointControls({
  runId,
  runDetail,
}: {
  runId: string;
  runDetail: AtelierAgentRunDetail | undefined;
}) {
  const queryClient = useQueryClient();
  const [rationale, setRationale] = React.useState("");
  const decide = useAtelierRecordAgentDecision({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getAtelierGetAgentRunQueryKey(runId) });
        if (runDetail?.agentId) {
          await queryClient.invalidateQueries({
            queryKey: getAtelierListAgentRunsQueryKey(runDetail.agentId),
          });
        }
        setRationale("");
      },
    },
  });

  const decisions = (runDetail?.humanDecisions ?? []) as Array<{
    decision?: string;
    rationale?: string;
    actorLabel?: string;
    decidedAt?: string;
  }>;
  const lastDecision = decisions[decisions.length - 1];
  const isResolved = lastDecision?.decision === "approve" || lastDecision?.decision === "reject";
  const canDecide = runDetail?.status === "complete" || runDetail?.status === "blocked";

  const submit = (decision: "approve" | "edit" | "reject") => {
    decide.mutate({ runId, data: { decision, rationale: rationale.trim() || undefined } });
  };

  return (
    <Card className="p-5 space-y-3" data-testid="card-checkpoints">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
          Human checkpoints
        </h3>
        <span className="text-xs text-text-faint">
          {decisions.length === 0
            ? "No decisions recorded."
            : `${decisions.length} decision${decisions.length === 1 ? "" : "s"} recorded`}
        </span>
      </div>
      <p className="text-sm text-text-mute">
        Per AGENT_STANDARD.md §4 every blocking checkpoint requires a
        human decision before downstream records are committed.
      </p>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Rationale (optional)…"
        rows={2}
        className="w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text"
        data-testid="input-decision-rationale"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canDecide || isResolved || decide.isPending}
          onClick={() => submit("approve")}
          data-testid="button-decision-approve"
          className="inline-flex items-center gap-1.5 bg-success text-bg-deep px-3 py-1.5 rounded text-xs font-medium hover:bg-success/90 disabled:opacity-50 transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
        </button>
        <button
          type="button"
          disabled={!canDecide || isResolved || decide.isPending}
          onClick={() => submit("edit")}
          data-testid="button-decision-edit"
          className="inline-flex items-center gap-1.5 bg-bg-elevate text-text px-3 py-1.5 rounded text-xs font-medium hover:bg-bg-elevate/80 disabled:opacity-50 transition-colors border border-border-soft"
        >
          <Edit3 className="w-3.5 h-3.5" /> Edit
        </button>
        <button
          type="button"
          disabled={!canDecide || isResolved || decide.isPending}
          onClick={() => submit("reject")}
          data-testid="button-decision-reject"
          className="inline-flex items-center gap-1.5 bg-danger text-bg-deep px-3 py-1.5 rounded text-xs font-medium hover:bg-danger/90 disabled:opacity-50 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" /> Reject
        </button>
        {!canDecide && (
          <span className="text-xs text-text-faint italic">
            Available once the run completes.
          </span>
        )}
        {isResolved && lastDecision?.actorLabel && (
          <span className="text-xs text-text-faint">
            Last decision: <strong className="text-text">{lastDecision.decision}</strong> by{" "}
            {lastDecision.actorLabel}
          </span>
        )}
      </div>
      {decisions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-text-mute hover:text-text">
            Decision history
          </summary>
          <ul className="mt-2 space-y-1 font-mono">
            {decisions.map((d, i) => (
              <li key={i} className="text-text-faint">
                <span className="text-text">{d.decision}</span>
                {d.actorLabel && <> · {d.actorLabel}</>}
                {d.decidedAt && <> · {d.decidedAt}</>}
                {d.rationale && <> — {d.rationale}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function SchemaCard({
  title,
  subtitle,
  fields,
}: {
  title: string;
  subtitle: React.ReactNode;
  fields: AtelierAgentSchemaField[] | undefined;
}) {
  return (
    <Card className="p-5 space-y-3">
      <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">{title}</h3>
      <p className="text-sm text-text-mute">{subtitle}</p>
      {!fields || fields.length === 0 ? (
        <p className="text-xs text-text-faint italic">No schema preview exposed by the registry.</p>
      ) : (
        <div className="border border-border-soft rounded divide-y divide-border-soft">
          {fields.map((f) => (
            <div key={f.name} className="px-3 py-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-mono text-text">
                  {f.name}
                  {f.required && <span className="text-danger ml-1">*</span>}
                </div>
                <div className="text-xs text-text-mute">{f.description}</div>
                {f.enumValues && f.enumValues.length > 0 && (
                  <div className="text-xs font-mono text-text-faint mt-1">
                    {f.enumValues.join(" | ")}
                  </div>
                )}
              </div>
              <MonoChip tone="default">{f.type}</MonoChip>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * File-incident panel — lets the operator capture a Monitor-stage
 * failure as an Improve incident with a back-link to this run.
 */
function FileIncidentPanel({
  runId,
  agentId,
  agentName,
  status,
}: {
  runId: string;
  agentId: string | undefined;
  agentName: string | undefined;
  status: string | undefined;
}) {
  const [open, setOpen] = React.useState(false);
  const [filed, setFiled] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{
    title: string;
    severity: FileIncidentInput["severity"];
    cluster: string;
    rootCause: string;
    proposedChange: string;
  }>({
    title: "",
    severity: "sev2",
    cluster: "Monitor-surfaced regression",
    rootCause: "",
    proposedChange: "",
  });
  const fileIncident = useFileIncident();

  const canFile = !!agentId && !!agentName;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canFile || !form.title.trim() || !form.proposedChange.trim()) return;
    const row = fileIncident({
      agentId: agentId!,
      agentName: agentName!,
      title: form.title.trim(),
      severity: form.severity,
      cluster: form.cluster.trim() || "Monitor-surfaced regression",
      rootCause: form.rootCause.trim() || undefined,
      proposedChange: form.proposedChange.trim(),
      runId,
    });
    setFiled(row.id);
    setOpen(false);
    setForm({
      title: "",
      severity: "sev2",
      cluster: "Monitor-surfaced regression",
      rootCause: "",
      proposedChange: "",
    });
  };

  return (
    <Card className="p-4 border-l-4 border-l-amber-500/60" data-testid="card-file-incident">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-text">Surface this run as an incident</div>
            <div className="text-xs text-text-mute">
              Files an Improve-stage row linked back to <code className="text-gold">{runId}</code>
              {status === "error" && (
                <span className="ml-2 text-danger">— run errored, candidate for sev2+.</span>
              )}
            </div>
          </div>
        </div>
        {filed ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-success" data-testid="text-incident-filed">
              Filed {filed}
            </span>
            <Link
              href="/agents/improve"
              className="text-xs font-mono text-gold hover:underline"
              data-testid="link-open-improve"
            >
              Open Improve →
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={!canFile}
            data-testid="button-toggle-file-incident"
            className="inline-flex items-center gap-1.5 bg-amber-500 text-bg-deep px-3 py-1.5 rounded text-xs font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {open ? "Cancel" : "File incident"}
          </button>
        )}
      </div>
      {open && canFile && (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="md:col-span-2 block">
            <span className="text-xs font-mono text-text-mute">Title *</span>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              data-testid="input-incident-title"
              className="mt-1 w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text"
            />
          </label>
          <label className="block">
            <span className="text-xs font-mono text-text-mute">Severity</span>
            <select
              value={form.severity}
              onChange={(e) =>
                setForm((f) => ({ ...f, severity: e.target.value as FileIncidentInput["severity"] }))
              }
              data-testid="select-incident-severity"
              className="mt-1 w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm font-mono text-text"
            >
              <option value="sev1">sev1 — outage</option>
              <option value="sev2">sev2 — degraded</option>
              <option value="sev3">sev3 — minor</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-mono text-text-mute">Failure cluster</span>
            <input
              type="text"
              value={form.cluster}
              onChange={(e) => setForm((f) => ({ ...f, cluster: e.target.value }))}
              data-testid="input-incident-cluster"
              className="mt-1 w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text"
            />
          </label>
          <label className="md:col-span-2 block">
            <span className="text-xs font-mono text-text-mute">Suspected root cause</span>
            <textarea
              rows={2}
              value={form.rootCause}
              onChange={(e) => setForm((f) => ({ ...f, rootCause: e.target.value }))}
              data-testid="input-incident-root-cause"
              className="mt-1 w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text"
            />
          </label>
          <label className="md:col-span-2 block">
            <span className="text-xs font-mono text-text-mute">Proposed change *</span>
            <textarea
              rows={2}
              required
              value={form.proposedChange}
              onChange={(e) => setForm((f) => ({ ...f, proposedChange: e.target.value }))}
              data-testid="input-incident-proposed-change"
              className="mt-1 w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text"
            />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              data-testid="button-submit-incident"
              className="inline-flex items-center gap-1.5 bg-gold text-bg-deep px-4 py-2 rounded text-sm font-medium hover:bg-gold/90 transition-colors"
            >
              File incident
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
