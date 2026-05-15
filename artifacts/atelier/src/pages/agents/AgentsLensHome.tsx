/**
 * Agents lens — lifecycle ribbon home (Task #370).
 *
 * Lands at `/agents`. Shows the seven Design → Retire stages with a
 * count of items currently in each, sourced from the Agents-lens seed
 * (`v5-hooks` `listHook` shape) plus the agent catalogue for the
 * Monitor count. Each ribbon tile links to its stage page.
 */
import { Link } from "wouter";
import {
  Pencil,
  Wrench,
  ClipboardCheck,
  Rocket,
  Activity,
  RefreshCw,
  Archive,
} from "lucide-react";
import { useAtelierListAgents } from "@workspace/api-client-react";
import {
  Card,
  MonoChip,
  HeroStat,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import {
  useAgentSpecs,
  useAgentVersions,
  useEvalSuites,
  useDeployments,
  useAgentIncidents,
  useRetirements,
} from "@/lib/agents-lens-seed";

export const AGENTS_LIFECYCLE_STAGES = [
  {
    id: "design",
    label: "Design",
    href: "/agents/design",
    icon: Pencil,
    blurb: "Specs, intents, prompts, tools, guardrails — and the fork-from-library entry into Atelier.",
  },
  {
    id: "build",
    label: "Build",
    href: "/agents/build",
    icon: Wrench,
    blurb: "Versioning, change logs, prompt and policy edits, tool wiring.",
  },
  {
    id: "evaluate",
    label: "Evaluate",
    href: "/agents/evaluate",
    icon: ClipboardCheck,
    blurb: "Eval suites — regression, red-team, A/B — and golden-dataset scorecards.",
  },
  {
    id: "deploy",
    label: "Deploy",
    href: "/agents/deploy",
    icon: Rocket,
    blurb: "Environments (dev → staging → prod), rollout strategy, persona binding.",
  },
  {
    id: "monitor",
    label: "Monitor",
    href: "/agents/monitor",
    icon: Activity,
    blurb: "Catalogue, run telemetry, cost / latency / success dashboards.",
  },
  {
    id: "improve",
    label: "Improve",
    href: "/agents/improve",
    icon: RefreshCw,
    blurb: "Incidents, post-mortems, failure clusters → eval expansion loop.",
  },
  {
    id: "retire",
    label: "Retire",
    href: "/agents/retire",
    icon: Archive,
    blurb: "Deprecation schedule, replacement mapping, archive.",
  },
] as const;

export default function AgentsLensHome() {
  const specs = useAgentSpecs();
  const versions = useAgentVersions();
  const evals = useEvalSuites();
  const deployments = useDeployments();
  const { data: catalogue } = useAtelierListAgents();
  const incidents = useAgentIncidents();
  const retirements = useRetirements();

  // Per-stage counts are number of unique agents currently in that
  // stage, not item counts. Design uses spec count directly (each spec
  // is an agent-in-design, before it has an agent id).
  const uniq = <T,>(xs: T[], pick: (x: T) => string) =>
    new Set(xs.map(pick)).size;
  const counts: Record<string, number> = {
    design: specs.length,
    build: uniq(versions, (v) => v.agentId),
    evaluate: uniq(evals, (e) => e.agentId),
    deploy: uniq(deployments, (d) => d.agentId),
    monitor: catalogue?.length ?? 0,
    improve: uniq(
      incidents.filter((i) => i.status !== "resolved"),
      (i) => i.agentId,
    ),
    retire: uniq(
      retirements.filter((r) => r.status !== "archived"),
      (r) => r.agentId,
    ),
  };

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Agents — lifecycle workspace"
        lede="Agents are first-class entities the firm operates and improves over time. The lens runs them through the canonical Design → Retire loop adapted from MLOps and LLMOps practice."
      />

      <div className="container-atelier py-10 space-y-10">
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          data-testid="agents-lifecycle-ribbon"
        >
          {AGENTS_LIFECYCLE_STAGES.map((stage, idx) => {
            const Icon = stage.icon;
            const count = counts[stage.id] ?? 0;
            return (
              <Link key={stage.id} href={stage.href}>
                <Card
                  hover
                  className="p-5 h-full flex flex-col justify-between group"
                  data-testid={`agents-stage-tile-${stage.id}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                          0{idx + 1}
                        </span>
                        <Icon className="w-4 h-4 text-gold" />
                      </div>
                      <MonoChip
                        tone={count === 0 ? "default" : "gold"}
                        data-testid={`agents-stage-count-${stage.id}`}
                      >
                        {count} {count === 1 ? "agent" : "agents"}
                      </MonoChip>
                    </div>
                    <h3 className="text-lg font-semibold text-text group-hover:text-gold transition-colors">
                      {stage.label}
                    </h3>
                    <p className="text-sm text-text-mute leading-relaxed">{stage.blurb}</p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

        <Card className="p-6 space-y-3 border-l-4 border-l-gold">
          <h3 className="font-mono text-sm tracking-widest uppercase text-gold">
            About this lens
          </h3>
          <p className="text-sm text-text-mute leading-relaxed">
            The Atelier (firm IP / agent library) stays under the <span className="text-text">Firm</span>{" "}
            menu — it's a reference catalogue, not lifecycle ops. Use the{" "}
            <Link href="/atelier/ip" className="text-gold hover:underline">
              Library
            </Link>{" "}
            to fork an existing prompt into a new spec under{" "}
            <Link href="/agents/design" className="text-gold hover:underline">
              Design
            </Link>
            .
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <HeroStat
              size="md"
              value={catalogue?.length ?? 0}
              caption={<span>Agents in catalogue</span>}
            />
            <HeroStat
              size="md"
              value={deployments.filter((d) => d.environment === "prod").length}
              caption={<span>Live in production</span>}
            />
            <HeroStat
              size="md"
              value={incidents.filter((i) => i.status !== "resolved").length}
              caption={<span>Open incidents</span>}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
