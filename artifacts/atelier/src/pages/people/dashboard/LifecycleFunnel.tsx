import { Funnel, type FunnelStep } from "./charts";
import { STAGES } from "../peopleLifecycle";
import { useStageStats } from "../peopleSeed";

export function LifecycleFunnel() {
  const stats = useStageStats();
  const steps: FunnelStep[] = STAGES.map((s) => {
    const stat = stats[s.id];
    return {
      id: s.id,
      label: s.label,
      value: stat?.count ?? 0,
      caption: stat?.countLabel ?? s.blurb,
      next: stat?.nextAction,
      href: stat?.nextActionHref ?? s.href,
    };
  });

  return (
    <section className="space-y-3" data-testid="dashboard-lifecycle-funnel">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
          Talent pipeline · lifecycle funnel
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          Attract → Offboard
        </span>
      </div>
      <Funnel steps={steps} />
    </section>
  );
}
