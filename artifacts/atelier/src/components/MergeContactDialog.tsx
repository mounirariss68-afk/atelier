import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PillButton, MonoChip } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierMergeContacts,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierContact,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  accountId: string;
  contacts: AtelierContact[];
  /** The contact the user started the merge from — defaults to survivor. */
  survivorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint";

export function MergeContactDialog({
  accountId,
  contacts,
  survivorId: initialSurvivorId,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const merge = useAtelierMergeContacts();

  const [survivorId, setSurvivorId] = React.useState(initialSurvivorId);
  const [duplicateId, setDuplicateId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSurvivorId(initialSurvivorId);
      setDuplicateId(null);
    }
  }, [open, initialSurvivorId]);

  const survivor = contacts.find((c) => c.id === survivorId) ?? null;
  const duplicate = contacts.find((c) => c.id === duplicateId) ?? null;
  const otherContacts = contacts.filter((c) => c.id !== survivorId);

  async function submit() {
    if (!duplicateId || !duplicate || !survivor) return;
    if (
      !window.confirm(
        `Merge "${duplicate.fullName}" into "${survivor.fullName}"? Relationships, activities and history move to "${survivor.fullName}" and the duplicate is removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      const res = await merge.mutateAsync({
        contactId: survivorId,
        data: { duplicateContactId: duplicateId },
      });
      await qc.invalidateQueries({
        queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId),
      });
      const moved = Object.values(res.counts ?? {}).reduce(
        (s, n) => s + (n as number),
        0,
      );
      toast({
        title:
          res.status === "already_merged"
            ? "Already merged"
            : "Contacts merged",
        description:
          res.status === "already_merged"
            ? "That contact was already merged."
            : `${moved} record${moved === 1 ? "" : "s"} re-pointed to ${survivor.fullName}.`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Merge failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge duplicate contacts</DialogTitle>
          <DialogDescription>
            Keep one contact as the survivor and fold the duplicate into it.
            Relationships, activities and history move to the survivor; the
            duplicate is removed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <div className={labelCls}>Keep (survivor)</div>
            <select
              value={survivorId}
              onChange={(e) => {
                setSurvivorId(e.target.value);
                if (e.target.value === duplicateId) setDuplicateId(null);
              }}
              className="w-full bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
              data-testid="select-merge-contact-survivor"
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                  {c.title ? ` — ${c.title}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className={labelCls}>Merge in (duplicate)</div>
            {otherContacts.length === 0 ? (
              <div className="text-xs font-mono text-text-mute px-1">
                No other contacts on this account to merge.
              </div>
            ) : (
              <div className="space-y-2">
                {otherContacts.map((c) => {
                  const active = duplicateId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setDuplicateId(active ? null : c.id)}
                      className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                        active
                          ? "border-gold/70 bg-gold/10"
                          : "border-border-soft hover:border-border"
                      }`}
                      data-testid={`merge-contact-candidate-${c.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm text-text">{c.fullName}</div>
                          <div className="text-xs font-mono text-text-mute mt-0.5">
                            {c.title ?? "—"}
                            {c.email ? ` · ${c.email}` : ""}
                          </div>
                        </div>
                        <MonoChip>{c.disposition}</MonoChip>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border-soft">
          <div className="text-xs font-mono text-text-mute">
            {duplicate && survivor
              ? `Merge "${duplicate.fullName}" → "${survivor.fullName}"`
              : "Select a duplicate to merge"}
          </div>
          <div className="flex items-center gap-2">
            <PillButton variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              onClick={submit}
              disabled={!duplicateId || merge.isPending}
              data-testid="button-confirm-merge-contact"
            >
              {merge.isPending ? "Merging…" : "Merge"}
            </PillButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
