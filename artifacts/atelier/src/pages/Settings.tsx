import { useAtelierGetMe, useAtelierGetAdminSettings } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, Plug, Gauge, Bell } from "lucide-react";

const MODEL_DEFAULTS = [
  { task: "Diagnostic memo", model: "claude-sonnet-4-6", note: "Long-form synthesis" },
  { task: "Pricing analysis", model: "claude-sonnet-4-6", note: "Numerical reasoning" },
  { task: "Pursuit scout", model: "claude-haiku-4-1", note: "Cheap recall" },
  { task: "Proposal compose", model: "claude-opus-4-3", note: "Pyramid structure" },
];

const MCP_PLACEHOLDERS = [
  { name: "Notion", status: "available", scope: "Read · pages, databases" },
  { name: "GitHub", status: "available", scope: "Read · repos, issues" },
  { name: "Slack", status: "coming-soon", scope: "Read · channels" },
  { name: "Drive", status: "coming-soon", scope: "Read · files" },
];

export default function Settings() {
  const { data: me, isLoading } = useAtelierGetMe();
  const { data: admin } = useAtelierGetAdminSettings();

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (!me) return null;

  const usedToday = 18420;
  const budget = admin?.perUserDailyTokenBudget ?? 250000;
  const pct = Math.min(100, Math.round((usedToday / budget) * 100));

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead headline="Settings" lede="Personal preferences and connected tools." />
      </PageHero>

      <div className="container-atelier py-10 max-w-3xl space-y-6">
        <Card className="p-6 space-y-4">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <Gauge className="w-4 h-4" /> Token Budget
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text">{usedToday.toLocaleString()} used today</span>
              <span className="text-text-mute font-mono">
                budget {budget.toLocaleString()} · {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-bg-elevate overflow-hidden">
              <div
                className="h-full bg-gold transition-all"
                style={{ width: `${pct}%` }}
                data-testid="bar-token-usage"
              />
            </div>
            <p className="text-xs text-text-faint font-mono">
              Budget is set by your firm Partner in Admin · Settings.
            </p>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <Cpu className="w-4 h-4" /> Model Defaults
          </h3>
          <div className="border border-border-soft rounded-md divide-y divide-border-soft">
            {MODEL_DEFAULTS.map((d) => (
              <div
                key={d.task}
                className="flex justify-between items-center px-4 py-3"
                data-testid={`row-model-${d.task.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <div>
                  <div className="text-text">{d.task}</div>
                  <div className="text-xs text-text-mute">{d.note}</div>
                </div>
                <MonoChip>{d.model}</MonoChip>
              </div>
            ))}
          </div>
          {admin?.disableOpus && (
            <p className="text-xs text-danger font-mono">
              Partner disabled Opus firm-wide · proposal-compose will fall back to Sonnet.
            </p>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <Plug className="w-4 h-4" /> MCP Connections
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MCP_PLACEHOLDERS.map((m) => (
              <div
                key={m.name}
                className="border border-border-soft rounded-md p-3 bg-bg-deep"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-text">{m.name}</span>
                  <MonoChip tone={m.status === "available" ? "green" : "default"}>
                    {m.status}
                  </MonoChip>
                </div>
                <p className="text-xs text-text-mute">{m.scope}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-faint font-mono">
            MCP wiring lands when at least one Partner enrolls a tenant. Reach out to your engagement lead.
          </p>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <Bell className="w-4 h-4" /> Identity
          </h3>
          <div className="text-sm text-text">
            Signed in as <span className="font-semibold">{me.name}</span>{" "}
            <span className="text-text-mute">({me.roleLabel})</span>
          </div>
          <div className="text-xs font-mono text-text-faint">persona id: {me.id}</div>
        </Card>
      </div>
    </div>
  );
}
