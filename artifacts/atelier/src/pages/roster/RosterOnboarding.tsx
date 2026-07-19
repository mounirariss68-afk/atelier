import * as React from "react";
import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

interface Step {
  id: string;
  code: string;
  title: string;
  ownerRole: string | null;
  deadline: string | null;
  status: string;
  isComplianceGate: boolean;
  completedAt: string | null;
  blockedReason: string | null;
}
interface Onboarding {
  id: string;
  personId: string;
  personType: string;
  personName: string;
  status: string;
  targetStartDate: string | null;
  startedAt: string;
  completedAt: string | null;
  blockedReason: string | null;
  progress: { done: number; total: number };
  steps: Step[];
}

const STATUS_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  in_flight: "gold",
  complete: "green",
  blocked: "red",
  cancelled: "default",
  pending: "default",
  in_progress: "gold",
  done: "green",
  skipped: "default",
};

export default function RosterOnboarding(): React.ReactElement {
  const [rows, setRows] = React.useState<Onboarding[] | null>(null);
  const reload = React.useCallback(() => {
    fetch("/api/atelier/roster/onboarding", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows(d.onboardings ?? []))
      .catch(() => setRows([]));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const advance = async (onbId: string, stepId: string, status: string, reason?: string) => {
    await fetch(`/api/atelier/roster/onboarding/${onbId}/steps/${stepId}/advance`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, blockedReason: reason }),
    });
    reload();
  };

  return (
    <div>
      <p className="text-text-mute text-sm mb-4">
        Active onboarding sequences. The Onboarding Concierge holds the sequence open while any
        compliance gate is blocked.
      </p>

      <div className="space-y-4">
        {rows === null && <div className="text-text-mute py-8">Loading…</div>}
        {rows?.length === 0 && <div className="text-text-mute py-8 italic">No onboardings in flight.</div>}
        {rows?.map((o) => (
          <Card key={o.id} className="p-4 space-y-3" data-testid={`onb-${o.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Link
                  href={`/roster/people/${o.personId}`}
                  className="font-medium hover:text-gold"
                >
                  {o.personName}
                </Link>
                <div className="text-text-mute text-xs">
                  {o.personType} · started {o.startedAt.slice(0, 10)}
                  {o.targetStartDate && ` · target ${o.targetStartDate}`}
                </div>
                <div className="flex gap-1 mt-1">
                  <MonoChip tone={STATUS_TONE[o.status] ?? "default"}>{o.status}</MonoChip>
                  <MonoChip>
                    {o.progress.done}/{o.progress.total} steps
                  </MonoChip>
                </div>
                {o.blockedReason && (
                  <div className="text-red-500 text-xs mt-1 font-mono">{o.blockedReason}</div>
                )}
              </div>
            </div>
            <div className="border-t border-line pt-3 space-y-1">
              {o.steps.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-1"
                  data-testid={`onb-step-${s.code}`}
                >
                  <div className="flex-1">
                    <div className="text-sm">
                      {s.title}
                      {s.isComplianceGate && (
                        <span className="ml-2 text-[10px] font-mono text-amber-500 uppercase">
                          compliance gate
                        </span>
                      )}
                    </div>
                    <div className="text-text-mute text-[11px] font-mono">
                      {s.ownerRole} · due {s.deadline ?? "—"}
                    </div>
                  </div>
                  <MonoChip tone={STATUS_TONE[s.status] ?? "default"}>{s.status}</MonoChip>
                  {s.status !== "done" && s.status !== "skipped" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => advance(o.id, s.id, "done")}>
                        Mark done
                      </Button>
                      {s.status !== "blocked" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const r = window.prompt("Block reason?") ?? undefined;
                            if (r) advance(o.id, s.id, "blocked", r);
                          }}
                        >
                          Block
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
