/**
 * Agents lens — Improve stage (Task #370).
 *
 * Incidents and post-mortems, grouped by failure cluster, with the
 * proposed fix that feeds back into Build / Evaluate.
 */
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  Eyebrow,
} from "@/components/ui/primitives";
import { useAgentIncidents, type IncidentRow } from "@/lib/agents-lens-seed";

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
              <Card
                key={i.id}
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
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
