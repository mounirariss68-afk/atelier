import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateContactRelationship,
  useAtelierDeleteContactRelationship,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierContact,
  type AtelierContactRelationship,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const REL_TYPES = ["reports_to", "partners_with", "blocks"] as const;
type RelType = (typeof REL_TYPES)[number];

const REL_LABEL: Record<RelType, string> = {
  reports_to: "reports to",
  partners_with: "partners with",
  blocks: "blocks",
};

const labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint";
const selectCls =
  "bg-bg-deep border border-border rounded px-2 py-1.5 text-sm text-text";

function strengthTone(s: number): string {
  if (s >= 70) return "#3BA776";
  if (s >= 40) return "#C9A24B";
  return "#a83232";
}

function StrengthMeter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1">
      <div className="h-2 w-full rounded-full bg-bg-deep border border-border-soft overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${v}%`, background: strengthTone(v) }}
        />
      </div>
      <div className="text-[10px] font-mono text-text-mute">{v}/100</div>
    </div>
  );
}

// Compact sparkline of the relationship-strength trend.
function TrendSparkline({
  points,
}: {
  points: Array<{ at: string; strength: number }>;
}) {
  if (!points || points.length < 2) {
    return <div className="text-xs font-mono text-text-mute">Not enough history yet.</div>;
  }
  const W = 280;
  const H = 48;
  const xs = points.map((_, i) => (points.length === 1 ? 0 : (i / (points.length - 1)) * W));
  const ys = points.map((p) => H - (Math.max(0, Math.min(100, p.strength)) / 100) * H);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const last = points[points.length - 1].strength;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <path d={d} fill="none" stroke={strengthTone(last)} strokeWidth={2} />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={2} fill={strengthTone(points[i].strength)} />
      ))}
    </svg>
  );
}

interface Props {
  contact: AtelierContact;
  accountId: string;
  contacts: AtelierContact[];
  relationships: AtelierContactRelationship[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

export function ContactInsightsDialog({
  contact,
  accountId,
  contacts,
  relationships,
  open,
  onOpenChange,
  onEdit,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createRel = useAtelierCreateContactRelationship();
  const deleteRel = useAtelierDeleteContactRelationship();

  const [newTargetId, setNewTargetId] = React.useState("");
  const [newType, setNewType] = React.useState<RelType>("reports_to");
  const [reparentId, setReparentId] = React.useState("");

  const nameOf = React.useCallback(
    (id: string) => contacts.find((c) => c.id === id)?.fullName ?? id,
    [contacts],
  );

  // Relationships touching this contact, in both directions.
  const outgoing = relationships.filter((r) => r.fromContactId === contact.id);
  const incoming = relationships.filter((r) => r.toContactId === contact.id);
  const currentManagerRel = outgoing.find((r) => r.type === "reports_to");
  const otherContacts = contacts.filter((c) => c.id !== contact.id);

  React.useEffect(() => {
    if (!open) return;
    setNewTargetId("");
    setNewType("reports_to");
    setReparentId(currentManagerRel?.toContactId ?? "");
  }, [open, contact.id, currentManagerRel?.toContactId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
  }

  async function addRelationship() {
    if (!newTargetId) {
      toast({ title: "Pick a contact", variant: "destructive" });
      return;
    }
    try {
      await createRel.mutateAsync({
        accountId,
        data: { fromContactId: contact.id, toContactId: newTargetId, type: newType },
      });
      invalidate();
      toast({ title: "Link added", description: "Relationship recorded in the audit trail." });
      setNewTargetId("");
    } catch (err: unknown) {
      toast({
        title: "Could not add link",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  async function removeRelationship(relationshipId: string) {
    try {
      await deleteRel.mutateAsync({ relationshipId });
      invalidate();
      toast({ title: "Link removed" });
    } catch (err: unknown) {
      toast({
        title: "Could not remove link",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  // Reparent = swap the reports_to edge. Create the NEW edge first; only once it
  // is persisted do we remove the old one. If the create fails (cycle, perms,
  // network) the original reporting line is left untouched — never deleted first,
  // which would otherwise lose the hierarchy on a failed reparent.
  async function applyReparent() {
    const target = reparentId;
    if (target === (currentManagerRel?.toContactId ?? "")) return;
    try {
      if (target) {
        await createRel.mutateAsync({
          accountId,
          data: { fromContactId: contact.id, toContactId: target, type: "reports_to" },
        });
      }
      if (currentManagerRel) {
        await deleteRel.mutateAsync({ relationshipId: currentManagerRel.id });
      }
      invalidate();
      toast({
        title: target ? "Manager updated" : "Manager cleared",
        description: "Reporting line recorded in the audit trail.",
      });
    } catch (err: unknown) {
      toast({
        title: "Could not update manager",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  const strength = contact.relationshipStrength ?? 0;
  const trend = contact.relationshipTrend ?? [];
  const busy = createRel.isPending || deleteRel.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[680px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto"
        data-testid="dialog-contact-insights"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{contact.fullName}</DialogTitle>
          <DialogDescription className="text-text-mute font-mono text-xs">
            {contact.title ?? "—"}
            {contact.seniority && ` · ${contact.seniority}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className={labelCls}>Relationship strength</span>
              <StrengthMeter value={strength} />
            </div>
            <div className="space-y-1">
              <span className={labelCls}>Disposition</span>
              <div className="text-sm text-text capitalize">{contact.disposition}</div>
              <span className={labelCls}>Influence</span>
              <div className="text-sm text-text">{contact.influenceScore}/5</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs font-mono">
            <div>
              <span className={labelCls}>Owner</span>
              <div className="mt-1 text-text">{contact.contactOwnerName ?? "—"}</div>
            </div>
            <div>
              <span className={labelCls}>Last contact</span>
              <div className="mt-1 text-text">
                {contact.lastContactAt
                  ? new Date(contact.lastContactAt).toLocaleDateString()
                  : "—"}
              </div>
            </div>
            <div>
              <span className={labelCls}>Next touch</span>
              <div className="mt-1 text-text">
                {contact.nextTouchAt
                  ? new Date(contact.nextTouchAt).toLocaleDateString()
                  : "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {contact.buyerPersona && (
              <span className="px-2 py-0.5 rounded border border-border text-text-mute font-mono">
                {contact.buyerPersona}
              </span>
            )}
            {contact.email && (
              <span className="px-2 py-0.5 rounded border border-border text-text-mute font-mono">
                {contact.email}
              </span>
            )}
            <span
              className="px-2 py-0.5 rounded border border-border text-text-mute font-mono"
              title={contact.sourceUrl ?? "No citation URL"}
            >
              {contact.confidence}
            </span>
          </div>

          <div className="space-y-1">
            <span className={labelCls}>Strength trend</span>
            <TrendSparkline points={trend} />
          </div>

          {contact.notes && (
            <p className="text-sm text-text-mute leading-snug border-t border-border-soft pt-3">
              {contact.notes}
            </p>
          )}

          {/* Reporting line (reparent) */}
          <div className="border-t border-border-soft pt-4 space-y-2">
            <Label htmlFor="ci-reparent" className={labelCls}>Reports to</Label>
            <div className="flex gap-2">
              <select
                id="ci-reparent"
                value={reparentId}
                onChange={(e) => setReparentId(e.target.value)}
                className={`${selectCls} flex-1`}
                data-testid="select-contact-manager"
              >
                <option value="">No manager (top level)</option>
                {otherContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
              <PillButton
                type="button"
                variant="ghost"
                onClick={() => void applyReparent()}
                disabled={busy || reparentId === (currentManagerRel?.toContactId ?? "")}
                data-testid="button-apply-reparent"
              >
                Update
              </PillButton>
            </div>
          </div>

          {/* Relationship links */}
          <div className="border-t border-border-soft pt-4 space-y-3">
            <span className={labelCls}>Relationship links</span>
            {outgoing.length === 0 && incoming.length === 0 ? (
              <div className="text-xs font-mono text-text-mute">No links yet.</div>
            ) : (
              <div className="space-y-1.5">
                {outgoing.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-xs font-mono bg-bg-deep border border-border-soft rounded px-2 py-1.5"
                    data-testid={`rel-row-${r.id}`}
                  >
                    <span className="text-text">
                      {REL_LABEL[r.type as RelType]} <span className="text-gold">{nameOf(r.toContactId)}</span>
                    </span>
                    <button
                      onClick={() => void removeRelationship(r.id)}
                      disabled={busy}
                      className="text-danger hover:underline"
                      data-testid={`button-remove-rel-${r.id}`}
                    >
                      remove
                    </button>
                  </div>
                ))}
                {incoming.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-xs font-mono bg-bg-deep border border-border-soft rounded px-2 py-1.5"
                    data-testid={`rel-row-${r.id}`}
                  >
                    <span className="text-text-mute">
                      <span className="text-gold">{nameOf(r.fromContactId)}</span> {REL_LABEL[r.type as RelType]} this person
                    </span>
                    <button
                      onClick={() => void removeRelationship(r.id)}
                      disabled={busy}
                      className="text-danger hover:underline"
                      data-testid={`button-remove-rel-${r.id}`}
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 pt-1">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as RelType)}
                className={selectCls}
                data-testid="select-new-rel-type"
              >
                {REL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REL_LABEL[t]}
                  </option>
                ))}
              </select>
              <select
                value={newTargetId}
                onChange={(e) => setNewTargetId(e.target.value)}
                className={`${selectCls} flex-1 min-w-[140px]`}
                data-testid="select-new-rel-target"
              >
                <option value="">Select contact…</option>
                {otherContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
              <PillButton
                type="button"
                variant="primary"
                onClick={() => void addRelationship()}
                disabled={busy || !newTargetId}
                data-testid="button-add-rel"
              >
                + Link
              </PillButton>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border-soft">
            <PillButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </PillButton>
            <PillButton
              type="button"
              variant="primary"
              onClick={onEdit}
              data-testid="button-edit-from-insights"
            >
              Edit contact
            </PillButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
