import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierUpdateContact,
  useAtelierDeleteContact,
  useAtelierListUsers,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierContact,
  type AtelierContactDisposition,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  StructuredNameFields,
  splitLegacyFullName,
  type StructuredNameValue,
} from "./StructuredNameFields";

// input[type=date] needs yyyy-mm-dd; API stores ISO datetimes.
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function fromDateInput(v: string): string | null {
  if (!v.trim()) return null;
  const d = new Date(v + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const SENIORITIES = ["board_chair", "board_member", "c_suite", "vp", "director", "manager", "ic"] as const;
const DISPOSITIONS: AtelierContactDisposition[] = [
  "unknown",
  "champion",
  "supporter",
  "neutral",
  "skeptic",
  "blocker",
];

interface Props {
  contact: AtelierContact;
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint";
const fieldCls = "bg-bg-deep border-border-soft";
const selectCls =
  "bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text";

export function EditContactDialog({ contact, accountId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useAtelierUpdateContact();
  const remove = useAtelierDeleteContact();
  const { data: users } = useAtelierListUsers();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Task #538 — prefill structured fields; fall back to splitting the
  // legacy fullName for contacts whose person record has no parts yet.
  const initialName = React.useCallback((): StructuredNameValue => {
    if (contact.firstName && contact.lastName) {
      return {
        honorific: contact.honorific ?? "",
        firstName: contact.firstName,
        middleName: contact.middleName ?? "",
        lastName: contact.lastName,
        preferredName: contact.preferredName ?? "",
      };
    }
    return { ...splitLegacyFullName(contact.fullName), preferredName: contact.preferredName ?? "" };
  }, [contact]);
  const [name, setName] = React.useState<StructuredNameValue>(initialName);
  const [title, setTitle] = React.useState(contact.title ?? "");
  const [seniority, setSeniority] = React.useState(contact.seniority ?? "");
  const [email, setEmail] = React.useState(contact.email ?? "");
  const [phone, setPhone] = React.useState(contact.phone ?? "");
  const [linkedinUrl, setLinkedinUrl] = React.useState(contact.linkedinUrl ?? "");
  const [buyerPersona, setBuyerPersona] = React.useState(contact.buyerPersona ?? "");
  const [influenceScore, setInfluenceScore] = React.useState(String(contact.influenceScore));
  const [disposition, setDisposition] = React.useState<AtelierContactDisposition>(
    contact.disposition,
  );
  const [notes, setNotes] = React.useState(contact.notes ?? "");
  const [relationshipStrength, setRelationshipStrength] = React.useState(
    String(contact.relationshipStrength ?? 0),
  );
  const [contactOwnerId, setContactOwnerId] = React.useState(contact.contactOwnerId ?? "");
  const [lastContactAt, setLastContactAt] = React.useState(toDateInput(contact.lastContactAt));
  const [nextTouchAt, setNextTouchAt] = React.useState(toDateInput(contact.nextTouchAt));

  React.useEffect(() => {
    if (!open) return;
    setName(initialName());
    setTitle(contact.title ?? "");
    setSeniority(contact.seniority ?? "");
    setEmail(contact.email ?? "");
    setPhone(contact.phone ?? "");
    setLinkedinUrl(contact.linkedinUrl ?? "");
    setBuyerPersona(contact.buyerPersona ?? "");
    setInfluenceScore(String(contact.influenceScore));
    setDisposition(contact.disposition);
    setNotes(contact.notes ?? "");
    setRelationshipStrength(String(contact.relationshipStrength ?? 0));
    setContactOwnerId(contact.contactOwnerId ?? "");
    setLastContactAt(toDateInput(contact.lastContactAt));
    setNextTouchAt(toDateInput(contact.nextTouchAt));
  }, [open, contact, initialName]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.firstName.trim() || !name.lastName.trim()) {
      toast({ title: "First and last name required", variant: "destructive" });
      return;
    }
    const inf = Number(influenceScore);
    const strengthNum = Number(relationshipStrength);
    const clampedStrength = Number.isFinite(strengthNum)
      ? Math.max(0, Math.min(100, Math.round(strengthNum)))
      : 0;
    try {
      await update.mutateAsync({
        contactId: contact.id,
        data: {
          honorific: name.honorific.trim() || null,
          firstName: name.firstName.trim(),
          middleName: name.middleName.trim() || null,
          lastName: name.lastName.trim(),
          preferredName: name.preferredName.trim() || null,
          title: title.trim() || null,
          seniority: (seniority || null) as
            | "board_chair"
            | "board_member"
            | "c_suite"
            | "vp"
            | "director"
            | "manager"
            | "ic"
            | null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          linkedinUrl: linkedinUrl.trim() || null,
          buyerPersona: buyerPersona.trim() || null,
          influenceScore: Number.isFinite(inf) ? inf : 3,
          disposition,
          notes: notes.trim() || null,
          relationshipStrength: clampedStrength,
          contactOwnerId: contactOwnerId || null,
          lastContactAt: fromDateInput(lastContactAt),
          nextTouchAt: fromDateInput(nextTouchAt),
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
      toast({ title: "Contact updated", description: "Changes recorded in the audit trail." });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Could not update contact",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  async function doDelete() {
    try {
      await remove.mutateAsync({ contactId: contact.id });
      qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
      toast({ title: "Contact removed", description: `${contact.fullName} removed from this account.` });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Could not remove contact",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[640px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto"
          data-testid="dialog-edit-contact"
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Edit contact</DialogTitle>
            <DialogDescription className="text-text-mute">
              Update details on <span className="font-mono text-text">{contact.fullName}</span>.
              Edits are audit-logged.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-5 py-3">
            <StructuredNameFields
              value={name}
              onChange={setName}
              idPrefix="edit-contact"
              labelCls={labelCls}
              fieldCls={fieldCls}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ec-title" className={labelCls}>Title</Label>
                <Input
                  id="ec-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={fieldCls}
                  data-testid="input-edit-contact-title"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ec-seniority" className={labelCls}>Seniority</Label>
                <select
                  id="ec-seniority"
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  className={selectCls}
                  data-testid="select-edit-contact-seniority"
                >
                  <option value="">—</option>
                  {SENIORITIES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ec-email" className={labelCls}>Email</Label>
                <Input
                  id="ec-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldCls}
                  data-testid="input-edit-contact-email"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ec-phone" className={labelCls}>Phone</Label>
                <Input
                  id="ec-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={fieldCls}
                  data-testid="input-edit-contact-phone"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-linkedin" className={labelCls}>LinkedIn URL</Label>
              <Input
                id="ec-linkedin"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                className={fieldCls}
                data-testid="input-edit-contact-linkedin"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ec-influence" className={labelCls}>Influence (1–5)</Label>
                <Input
                  id="ec-influence"
                  type="number"
                  min={1}
                  max={5}
                  value={influenceScore}
                  onChange={(e) => setInfluenceScore(e.target.value)}
                  className={fieldCls}
                  data-testid="input-edit-contact-influence"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ec-disposition" className={labelCls}>Disposition</Label>
                <select
                  id="ec-disposition"
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value as AtelierContactDisposition)}
                  className={selectCls}
                  data-testid="select-edit-contact-disposition"
                >
                  {DISPOSITIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-strength" className={labelCls}>
                Relationship strength · {Math.max(0, Math.min(100, Number(relationshipStrength) || 0))}
              </Label>
              <input
                id="ec-strength"
                type="range"
                min={0}
                max={100}
                step={5}
                value={relationshipStrength}
                onChange={(e) => setRelationshipStrength(e.target.value)}
                className="w-full accent-gold"
                data-testid="input-edit-contact-strength"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-owner" className={labelCls}>Relationship owner</Label>
              <select
                id="ec-owner"
                value={contactOwnerId}
                onChange={(e) => setContactOwnerId(e.target.value)}
                className={selectCls}
                data-testid="select-edit-contact-owner"
              >
                <option value="">Unassigned</option>
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ec-last-contact" className={labelCls}>Last contact</Label>
                <Input
                  id="ec-last-contact"
                  type="date"
                  value={lastContactAt}
                  onChange={(e) => setLastContactAt(e.target.value)}
                  className={fieldCls}
                  data-testid="input-edit-contact-last-contact"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ec-next-touch" className={labelCls}>Next touch</Label>
                <Input
                  id="ec-next-touch"
                  type="date"
                  value={nextTouchAt}
                  onChange={(e) => setNextTouchAt(e.target.value)}
                  className={fieldCls}
                  data-testid="input-edit-contact-next-touch"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-persona" className={labelCls}>Buyer persona</Label>
              <Input
                id="ec-persona"
                value={buyerPersona}
                onChange={(e) => setBuyerPersona(e.target.value)}
                className={fieldCls}
                data-testid="input-edit-contact-persona"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-notes" className={labelCls}>Notes</Label>
              <Textarea
                id="ec-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${fieldCls} min-h-[64px]`}
                data-testid="input-edit-contact-notes"
              />
            </div>
            <div className="flex justify-between gap-2 pt-1 border-t border-border-soft">
              <PillButton
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="text-danger hover:text-danger"
                data-testid="button-remove-contact"
              >
                Remove
              </PillButton>
              <div className="flex gap-2">
                <PillButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </PillButton>
                <PillButton
                  type="submit"
                  variant="primary"
                  disabled={update.isPending}
                  data-testid="button-submit-edit-contact"
                >
                  {update.isPending ? "Saving…" : "Save changes"}
                </PillButton>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="bg-bg-elevate border-border text-text">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {contact.fullName}?</AlertDialogTitle>
            <AlertDialogDescription className="text-text-mute">
              This removes the contact from the account's decision-maker map. The action
              is audit-logged and can be restored by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
              disabled={remove.isPending}
              className="bg-danger text-white hover:bg-danger/90"
              data-testid="button-confirm-remove-contact"
            >
              {remove.isPending ? "Removing…" : "Remove contact"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
