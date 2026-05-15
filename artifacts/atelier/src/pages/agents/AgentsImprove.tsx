/**
 * Agents lens — Improve stage (Task #370 / Task #374 / Task #382).
 *
 * Incidents and post-mortems, grouped by failure cluster, with the
 * proposed fix that feeds back into Build / Evaluate. Each incident now
 * fetches its linked telemetry — the failing run rows that triggered the
 * cluster and the candidate version that resolves it — via
 * GET /api/atelier/agents-lens/incidents/:id (Task #382), closing the
 * Improve loop into Build. Client-filed incidents (Task #374) that
 * carry an inline `runId` still render their originating-run link as a
 * fallback when the detail endpoint hasn't seen that incident yet.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  Eyebrow,
} from "@/components/ui/primitives";
import {
  useAgentIncidents,
  type IncidentRow,
  type AgentVersion,
} from "@/lib/agents-lens-seed";

const SEV_TONE: Record<IncidentRow["severity"], "red" | "amber" | "default"> = {
  sev1: "red",
  sev2: "amber",
  sev3: "default",
};

const STATUS_TONE: Record<IncidentRow["status"], "default" | "gold" | "green"> = {
  open: "default",
  investigating: "gold",
  resolved: "green",
};

const RUN_STATUS_TONE: Record<string, "green" | "gold" | "red" | "default"> = {
  complete: "green",
  running: "gold",
  blocked: "red",
  error: "red",
};

interface EvidenceRun {
  id: string;
  agentId: string;
  status: string;
  statusMessage: string | null;
  confidence: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  progressPct: number | null;
  sourcesCount: number | null;
  costUsd: number | null;
  durationMs: number | null;
  createdAt: string;
}

interface IncidentDetail {
  incident: IncidentRow & {
    evidenceRunIds: string[];
    fixVersionId: string | null;
  };
  evidenceRuns: EvidenceRun[];
  fixVersion: AgentVersion | null;
}

const API_BASE = `${import.meta.env.BASE_URL}api/atelier`;

function useIncidentDetail(id: string) {
  return useQuery<IncidentDetail | null>({
    queryKey: ["atelier-agents-lens", "improve-incident-detail", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/agents-lens/incidents/${id}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      // Client-filed incidents (Task #374) won't have a server row — let
      // the card fall back to the inline `runId` instead of erroring.
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Incident ${id} failed: ${res.status}`);
      }
      return (await res.json()) as IncidentDetail;
    },
    staleTime: 30_000,
    retry: false,
  });
}

export default function AgentsImprove() {
  const incidents = useAgentIncidents();
  const byCluster = incidents.reduce<Record<string, IncidentRow[]>>((acc, i) => {
    (acc[i.cluster] ||= []).push(i);
    return acc;
  }, {});

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Manage · Agents · Improve</Eyebrow>
        <SectionHead
          headline="Improve — incidents and the eval-expansion loop"
          lede="Failures cluster into recurring themes; each cluster owns the prompt or tool change that closes it, and the eval case that locks the fix."
          className="mt-3"
        />
      </PageHero>

      <div className="container-atelier py-10 space-y-8">
        {Object.entries(byCluster).map(([cluster, items]) => (
          <div key={cluster} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
                Cluster — {cluster}
              </h3>
              <MonoChip>{items.length} incident{items.length === 1 ? "" : "s"}</MonoChip>
            </div>
            {items.map((i) => (
              <IncidentCard key={i.id} incident={i} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function IncidentCard({ incident: i }: { incident: IncidentRow }) {
  const { data: detail } = useIncidentDetail(i.id);
  const evidenceRuns = detail?.evidenceRuns ?? [];
  const fixVersion = detail?.fixVersion ?? null;

  return (
    <Card
      className="p-5 space-y-3 border-l-4 border-l-gold/40"
      data-testid={`incident-${i.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-text">{i.title}</h4>
            <MonoChip tone={SEV_TONE[i.severity]}>{i.severity.toUpperCase()}</MonoChip>
            <MonoChip tone={STATUS_TONE[i.status]}>{i.status}</MonoChip>
          </div>
          <div className="text-xs font-mono text-text-faint">
            {i.agentName} · detected {new Date(i.detectedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
      {i.rootCause && (
        <div className="text-xs">
          <span className="font-mono uppercase tracking-widest text-text-faint mr-2">
            Root cause
          </span>
          <span className="text-text-mute">{i.rootCause}</span>
        </div>
      )}
      <div className="text-xs">
        <span className="font-mono uppercase tracking-widest text-text-faint mr-2">
          Proposed change
        </span>
        <span className="text-text">{i.proposedChange}</span>
      </div>

      {evidenceRuns.length > 0 ? (
        <div
          className="space-y-2 pt-3 border-t border-border-soft"
          data-testid={`incident-${i.id}-evidence`}
        >
          <div className="font-mono text-[11px] uppercase tracking-widest text-text-faint">
            Evidence — {evidenceRuns.length} failing run
            {evidenceRuns.length === 1 ? "" : "s"}
          </div>
          <ul className="space-y-1.5">
            {evidenceRuns.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 text-xs"
                data-testid={`incident-${i.id}-run-${r.id}`}
              >
                <MonoChip tone={RUN_STATUS_TONE[r.status] ?? "default"}>
                  {r.status}
                </MonoChip>
                <Link
                  href={`/agents/monitor/runs/${r.id}`}
                  className="font-mono text-gold hover:underline"
                  data-testid={`link-run-${r.id}`}
                >
                  {r.id}
                </Link>
                {r.targetLabel && (
                  <span className="text-text-mute">· {r.targetLabel}</span>
                )}
                {r.statusMessage && (
                  <span className="text-text-faint italic">— {r.statusMessage}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        i.runId && (
          <div className="text-xs">
            <Link
              href={`/agents/monitor/runs/${i.runId}`}
              className="inline-flex items-center gap-1 font-mono text-gold hover:underline"
              data-testid={`link-incident-run-${i.id}`}
            >
              Originating run · {i.runId}
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        )
      )}

      {fixVersion && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-soft"
          data-testid={`incident-${i.id}-fix`}
        >
          <div className="space-y-0.5 text-xs">
            <div className="font-mono uppercase tracking-widest text-text-faint">
              Candidate fix
            </div>
            <div className="text-text">
              <span className="font-mono text-gold">
                {fixVersion.agentName} {fixVersion.version}
              </span>{" "}
              <MonoChip tone={fixVersion.status === "shipped" ? "green" : "gold"}>
                {fixVersion.status}
              </MonoChip>
            </div>
            {fixVersion.changeSummary && (
              <div className="text-text-mute">{fixVersion.changeSummary}</div>
            )}
          </div>
          <Link
            href="/agents/build"
            className="inline-flex items-center gap-1.5 bg-gold text-bg-deep px-3 py-1.5 rounded text-xs font-medium hover:bg-gold/90 transition-colors"
            data-testid={`button-promote-${fixVersion.id}`}
          >
            Promote candidate
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </Card>
  );
}
