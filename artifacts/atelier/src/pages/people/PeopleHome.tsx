import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { PeopleShell } from "./PeopleShell";
import { STAGES, CROSS_MODULES } from "./peopleLifecycle";
import { useStageStats } from "./peopleSeed";

export default function PeopleHome() {
  const stats = useStageStats();
  return (
    <PeopleShell>
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">People Studio</MonoChip>}
          headline="The full people lifecycle, in one workspace"
          lede="Attract, hire, onboard, develop, perform, reward, retain and offboard — with cross-cutting access to the people directory, org, access matrix, skill graph, time, compliance and approvals."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-10">
        <section className="space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Lifecycle · counts &amp; next action
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {STAGES.map((s) => {
              const stat = stats[s.id];
              return (
                <Link key={s.id} href={s.href} data-testid={`tile-stage-${s.id}`}>
                  <Card hover className="p-4 cursor-pointer h-full">
                    <div className="flex items-baseline justify-between">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                        {s.id}
                      </div>
                      {stat && (
                        <MonoChip tone={stat.count > 0 ? "gold" : "default"}>
                          {stat.count}
                        </MonoChip>
                      )}
                    </div>
                    <div className="mt-1 text-text font-semibold">{s.label}</div>
                    <div className="mt-1 text-xs text-text-faint">
                      {stat?.countLabel ?? s.blurb}
                    </div>
                    {stat && (
                      <div className="mt-3 pt-3 border-t border-border-soft text-sm text-text-mute">
                        <span className="font-mono text-[10px] uppercase text-text-faint block mb-0.5">
                          next for you
                        </span>
                        {stat.nextAction}
                      </div>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Cross-cutting modules
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {CROSS_MODULES.map((m) => (
              <Link key={m.id} href={m.href} data-testid={`tile-module-${m.id}`}>
                <Card hover className="p-4 cursor-pointer h-full">
                  <div className="text-text font-medium">{m.label}</div>
                  <div className="mt-1 font-mono text-[11px] text-text-faint">{m.href}</div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PeopleShell>
  );
}
