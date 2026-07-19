import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RosterNav } from "./RosterNav";

interface Step {
  id: string;
  code: string;
  title: string;
  ownerRole: string | null;
  deadline: string | null;
  status: string;
  isReassignmentGate: boolean;
  completedAt: string | null;
  blockedReason: string | null;
}
interface Offboarding {
  id: string;
  personId: string;
  personType: string;
  personName: string;
  status: string;
  lastWorkingDate: string | null;
  initiatedAt: string;
  completedAt: string | null;
  blockedReason: string | null;
  auditPackUrl: string | null;
  auditPackSignedAt: string | null;
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

export default function RosterOffboarding(): React.ReactElement {
  const [rows, setRows] = React.useState<Offboarding[] | null>(null);
  const [draft, setDraft] = React.useState({ personId: "", lastWorkingDate: "", reason: "" });
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    fetch("/api/atelier/roster/offboarding", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows(d.offboardings ?? []))
      .catch(() => setRows([]));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const initiate = async () => {
    setError(null);
    const r = await fetch("/api/atelier/roster/offboarding", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error ?? "failed");
      return;
    }
    setDraft({ personId: "", lastWorkingDate: "", reason: "" });
    reload();
  };

  const advance = async (offId: string, stepId: string, status: string, reason?: string) => {
    const r = await fetch(`/api/atelier/roster/offboarding/${offId}/steps/${stepId}/advance`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, blockedReason: reason }),
    });
    const d = await r.json();
    if (!r.ok && d.error) alert(`${d.error}${d.pendingGrants ? ` (${d.pendingGrants} grants pending)` : ""}`);
    reload();
  };

  const finalize = async (offId: string) => {
    const r = await fetch(`/api/atelier/roster/offboarding/${offId}/finalize`, {
      method: "POST",
      credentials: "include",
    });
    const d = await r.json();
    if (!r.ok) alert(d.error ?? "finalize failed");
    reload();
  };

  return (
    <div>
      <PageHero>
        <SectionHead
          eyebrow="The Roster"
          headline="Offboarding"
          lede="11-step Offboarding Sentinel sequence. The reassignment gate blocks completion until the person has no active engagement grants."
        />
      </PageHero>
      <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <RosterNav />

      <Card className="p-4 mb-6 space-y-3" data-testid="offboarding-form">
        <h3 className="font-mono text-xs uppercase text-text-mute">Initiate offboarding</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Person id</span>
            <Input
              value={draft.personId}
              onChange={(e) => setDraft({ ...draft, personId: e.target.value })}
              placeholder="emp_… / ctr_… / pfr_…"
              data-testid="offb-personid"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Last working date</span>
            <Input
              type="date"
              value={draft.lastWorkingDate}
              onChange={(e) => setDraft({ ...draft, lastWorkingDate: e.target.value })}
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Reason</span>
            <Input
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
        </div>
        {error && <div className="text-red-500 text-xs font-mono">{error}</div>}
        <Button onClick={initiate} disabled={!draft.personId} data-testid="offb-initiate">
          Initiate offboarding
        </Button>
      </Card>

      <div className="space-y-4">
        {rows === null && <div className="text-text-mute py-8">Loading…</div>}
        {rows?.length === 0 && <div className="text-text-mute py-8 italic">No offboardings in flight.</div>}
        {rows?.map((o) => (
          <Card key={o.id} className="p-4 space-y-3" data-testid={`offb-${o.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Link href={`/roster/people/${o.personId}`} className="font-medium hover:text-gold">
                  {o.personName}
                </Link>
                <div className="text-text-mute text-xs">
                  {o.personType} · initiated {o.initiatedAt.slice(0, 10)}
                  {o.lastWorkingDate && ` · last day ${o.lastWorkingDate}`}
                </div>
                <div className="flex gap-1 mt-1">
                  <MonoChip tone={STATUS_TONE[o.status] ?? "default"}>{o.status}</MonoChip>
                  <MonoChip>
                    {o.progress.done}/{o.progress.total} steps
                  </MonoChip>
                  {o.auditPackUrl && (
                    <a
                      href={o.auditPackUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-gold underline text-xs font-mono"
                      data-testid={`audit-pack-${o.id}`}
                    >
                      Audit pack PDF →
                    </a>
                  )}
                </div>
                {o.blockedReason && (
                  <div className="text-red-500 text-xs mt-1 font-mono">{o.blockedReason}</div>
                )}
              </div>
              {o.status !== "complete" && (
                <Button
                  variant="outline"
                  onClick={() => finalize(o.id)}
                  data-testid={`finalize-${o.id}`}
                >
                  Finalize (Partner sign)
                </Button>
              )}
            </div>
            <div className="border-t border-line pt-3 space-y-1">
              {o.steps.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-1"
                  data-testid={`offb-step-${s.code}`}
                >
                  <div className="flex-1">
                    <div className="text-sm">
                      {s.title}
                      {s.isReassignmentGate && (
                        <span className="ml-2 text-[10px] font-mono text-amber-500 uppercase">
                          reassignment gate
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
    </div>
  );
}
