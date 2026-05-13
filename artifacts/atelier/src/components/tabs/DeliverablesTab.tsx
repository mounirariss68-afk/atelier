import * as React from "react";
import {
  useAtelierListDeliverables,
  useAtelierCreateDeliverable,
  getAtelierListDeliverablesQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText } from "lucide-react";

export function DeliverablesTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: items, isLoading } = useAtelierListDeliverables(engId);
  const create = useAtelierCreateDeliverable();
  const [showForm, setShowForm] = React.useState(false);
  const [name, setName] = React.useState("Diagnostic Memo");

  async function onCreate() {
    if (!name.trim()) return;
    const res = await create.mutateAsync({
      engId,
      data: { type: "diagnostic_memo", name },
    });
    qc.invalidateQueries({ queryKey: getAtelierListDeliverablesQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    setShowForm(false);
    toast({ title: "Deliverable created", description: res.name });
  }

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
          {(items ?? []).length} deliverable{(items ?? []).length === 1 ? "" : "s"}
        </div>
        <PillButton variant="primary" onClick={() => setShowForm((s) => !s)} data-testid="btn-add-deliverable">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> New deliverable
        </PillButton>
      </div>

      {showForm && (
        <Card className="p-5 space-y-3 bg-bg-deep">
          <label className="text-xs font-mono text-text-mute uppercase">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
            data-testid="input-deliverable-name"
          />
          <div className="text-xs font-mono text-text-mute">Type: diagnostic_memo</div>
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</PillButton>
            <PillButton variant="primary" onClick={onCreate} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </PillButton>
          </div>
        </Card>
      )}

      {(items ?? []).length === 0 && (
        <Card className="p-12 text-center border-dashed bg-bg-deep">
          <FileText className="w-8 h-8 text-gold mx-auto mb-3" />
          <p className="text-text-mute">No deliverables yet.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(items ?? []).map((d) => (
          <Link
            key={d.id}
            href={`/engagements/${engId}/deliverables/${d.id}`}
            className="block"
            data-testid={`deliverable-card-${d.id}`}
          >
            <Card className="p-5 space-y-3 hover:border-gold/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-text">{d.name}</div>
                  <div className="text-xs font-mono text-text-mute mt-0.5">{d.type}</div>
                </div>
                <MonoChip
                  tone={
                    d.status === "sent" ? "green" :
                    d.status === "approved" ? "gold" :
                    d.status === "in_review" ? "amber" : "default"
                  }
                >
                  {d.status}
                </MonoChip>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-text-mute">
                  {d.criticReadiness ? (
                    <>
                      Critic:{" "}
                      <MonoChip
                        tone={
                          d.criticReadiness === "green" ? "green" :
                          d.criticReadiness === "amber" ? "amber" : "red"
                        }
                      >
                        {d.criticReadiness}
                      </MonoChip>
                    </>
                  ) : (
                    "Critic: —"
                  )}
                </span>
                {d.dueDate && (
                  <span className="text-text-mute">
                    Due {new Date(d.dueDate).toLocaleDateString()}
                  </span>
                )}
              </div>
              {d.lockOverridden && (
                <div className="text-[10px] font-mono uppercase text-amber">HAPA override</div>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
