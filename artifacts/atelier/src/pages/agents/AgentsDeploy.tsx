/**
 * Agents lens — Deploy stage (Task #370).
 *
 * Environments table (dev → staging → prod) with rollout strategy,
 * traffic %, and persona/tenant binding.
 */
import {
  Card,
  MonoChip,
  Eyebrow,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { useDeployments, type DeploymentRow } from "@/lib/agents-lens-seed";

const ENV_TONE: Record<DeploymentRow["environment"], "default" | "gold" | "green"> = {
  dev: "default",
  staging: "gold",
  prod: "green",
};

const ENV_ORDER: DeploymentRow["environment"][] = ["dev", "staging", "prod"];

export default function AgentsDeploy() {
  const deployments = useDeployments();
  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Deploy — environments and rollout"
        lede="Promote candidate versions through dev → staging → prod with shadow, canary and full rollouts. Each deployment binds an agent to a persona scope."
      />

      <div className="container-atelier py-10 space-y-8">
        {ENV_ORDER.map((env) => {
          const rows = deployments.filter((d) => d.environment === env);
          if (rows.length === 0) return null;
          return (
            <div key={env} className="space-y-3">
              <div className="flex items-center gap-3">
                <MonoChip tone={ENV_TONE[env]}>{env.toUpperCase()}</MonoChip>
                <span className="text-sm text-text-mute">{rows.length} deployment{rows.length === 1 ? "" : "s"}</span>
              </div>
              <Card className="p-0 overflow-hidden">
                <table className="w-full text-sm" data-testid={`deploy-table-${env}`}>
                  <thead className="bg-bg-deep text-[10px] font-mono uppercase tracking-widest text-text-faint">
                    <tr>
                      <th className="text-left px-4 py-2.5">Agent</th>
                      <th className="text-left px-4 py-2.5">Version</th>
                      <th className="text-left px-4 py-2.5">Strategy</th>
                      <th className="text-left px-4 py-2.5">Traffic</th>
                      <th className="text-left px-4 py-2.5">Persona binding</th>
                      <th className="text-left px-4 py-2.5">Promoted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-border-soft"
                        data-testid={`deploy-row-${r.id}`}
                      >
                        <td className="px-4 py-3 text-text">{r.agentName}</td>
                        <td className="px-4 py-3 font-mono text-gold">v{r.version}</td>
                        <td className="px-4 py-3"><MonoChip>{r.rolloutStrategy}</MonoChip></td>
                        <td className="px-4 py-3 font-mono text-text-mute">{r.trafficPct}%</td>
                        <td className="px-4 py-3 font-mono text-text-mute">{r.personaBinding}</td>
                        <td className="px-4 py-3 text-xs font-mono text-text-faint">
                          {r.promotedBy} · {new Date(r.promotedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
