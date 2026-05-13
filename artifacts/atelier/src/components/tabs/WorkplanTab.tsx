import * as React from "react";
import {
  useAtelierListRaid,
  useAtelierCreateRaidItem,
  useAtelierUpdateRaidItem,
  getAtelierListRaidQueryKey,
  getAtelierGetEngagementQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

const KINDS = ["risk", "assumption", "issue", "dependency"] as const;
type Kind = (typeof KINDS)[number];
const SEVERITIES = ["green", "amber", "red"] as const;
type Sev = (typeof SEVERITIES)[number];

export function WorkplanTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: items, isLoading } = useAtelierListRaid(engId);
  const create = useAtelierCreateRaidItem();
  const update = useAtelierUpdateRaidItem();

  const [showForm, setShowForm] = React.useState(false);
  const [kind, setKind] = React.useState<Kind>("risk");
  const [severity, setSeverity] = React.useState<Sev>("amber");
  const [description, setDescription] = React.useState("");
  const [mitigation, setMitigation] = React.useState("");

  function inv() {
    qc.invalidateQueries({ queryKey: getAtelierListRaidQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierGetEngagementQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
  }

  async function onCreate() {
    if (!description.trim()) return;
    await create.mutateAsync({ engId, data: { kind, severity, description, mitigation: mitigation || null } });
    setDescription("");
    setMitigation("");
    setShowForm(false);
    inv();
    toast({ title: "RAID item added" });
  }

  async function onClose(id: string) {
    await update.mutateAsync({ engId, raidId: id, data: { status: "closed" } });
    inv();
    toast({ title: "RAID item closed" });
  }

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;

  const grouped: Record<Kind, typeof items> = {
    risk: [], assumption: [], issue: [], dependency: [],
  } as never;
  for (const it of items ?? []) {
    (grouped[it.kind as Kind] ??= [] as never).push(it);
  }

  const counts = {
    red: (items ?? []).filter((i) => i.severity === "red" && i.status !== "closed").length,
    amber: (items ?? []).filter((i) => i.severity === "amber" && i.status !== "closed").length,
    green: (items ?? []).filter((i) => i.severity === "green" && i.status !== "closed").length,
  };

  return (
    <div className="space-y-6">
      <Card className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-mute font-mono uppercase text-xs">RAID</span>
          <MonoChip tone="red">{counts.red} red</MonoChip>
          <MonoChip tone="amber">{counts.amber} amber</MonoChip>
          <MonoChip tone="green">{counts.green} green</MonoChip>
        </div>
        <PillButton variant="primary" onClick={() => setShowForm((s) => !s)} data-testid="btn-add-raid">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add item
        </PillButton>
      </Card>

      {showForm && (
        <Card className="p-5 space-y-3 bg-bg-deep">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono text-text-mute uppercase">Kind</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="w-full mt-1 bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
                data-testid="select-raid-kind"
              >
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-mono text-text-mute uppercase">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Sev)}
                className="w-full mt-1 bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
                data-testid="select-raid-severity"
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-mono text-text-mute uppercase">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full mt-1 bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
              data-testid="input-raid-description"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-text-mute uppercase">Mitigation (optional)</label>
            <textarea
              value={mitigation}
              onChange={(e) => setMitigation(e.target.value)}
              rows={2}
              className="w-full mt-1 bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
            />
          </div>
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</PillButton>
            <PillButton variant="primary" onClick={onCreate} disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save"}
            </PillButton>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {KINDS.map((k) => (
          <Card key={k} className="p-4 space-y-3">
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">{k}s</div>
            {(grouped[k] ?? []).length === 0 && (
              <div className="text-text-mute text-sm font-mono py-3">None.</div>
            )}
            {(grouped[k] ?? []).map((it) => (
              <div
                key={it.id}
                className="border border-border-soft rounded-md p-3 bg-bg-deep space-y-1.5"
                data-testid={`raid-item-${it.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <MonoChip
                    tone={it.severity === "red" ? "red" : it.severity === "amber" ? "amber" : "green"}
                  >
                    {it.severity}
                  </MonoChip>
                  <span className="text-[10px] font-mono uppercase text-text-mute">{it.status}</span>
                </div>
                <div className="text-sm text-text">{it.description}</div>
                {it.mitigation && (
                  <div className="text-xs text-text-mute italic">Mitigation: {it.mitigation}</div>
                )}
                {it.status !== "closed" && (
                  <div className="pt-1">
                    <button
                      onClick={() => onClose(it.id)}
                      className="text-xs font-mono text-text-mute hover:text-gold"
                    >
                      Close →
                    </button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
