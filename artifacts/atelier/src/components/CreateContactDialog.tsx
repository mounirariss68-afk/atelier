import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateContact,
  useAtelierCheckContactDuplicates,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierContactDisposition,
  type AtelierContactDuplicateCandidate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  StructuredNameFields,
  EMPTY_NAME,
  composeDisplayName,
  type StructuredNameValue,
} from "./StructuredNameFields";

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
  accountId: string;
  trigger: React.ReactNode;
}

const labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint";
const fieldCls = "bg-bg-deep border-border-soft";
const selectCls =
  "bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text";

export function CreateContactDialog({ accountId, trigger }: Props) {
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useAtelierCreateContact();
  const checkDup = useAtelierCheckContactDuplicates();

  const [name, setName] = React.useState<StructuredNameValue>({ ...EMPTY_NAME });
  const [title, setTitle] = React.useState("");
  const [seniority, setSeniority] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [linkedinUrl, setLinkedinUrl] = React.useState("");
  const [buyerPersona, setBuyerPersona] = React.useState("");
  const [influenceScore, setInfluenceScore] = React.useState("3");
  const [disposition, setDisposition] = React.useState<AtelierContactDisposition>("unknown");
  const [notes, setNotes] = React.useState("");
  // Task #632 — fuzzy duplicate warnings (non-blocking) for an existing contact
  // with a similar name on the same account.
  const [dupCandidates, setDupCandidates] = React.useState<
    AtelierContactDuplicateCandidate[]
  >([]);

  React.useEffect(() => {
    if (!open) return;
    setDupCandidates([]);
    setName({ ...EMPTY_NAME });
    setTitle("");
    setSeniority("");
    setEmail("");
    setPhone("");
    setLinkedinUrl("");
    setBuyerPersona("");
    setInfluenceScore("3");
    setDisposition("unknown");
    setNotes("");
  }, [open]);

  // Task #632 — debounced fuzzy duplicate check, scoped to this account. Fires
  // once a meaningful name is entered. Non-blocking advisory only.
  const dupName = composeDisplayName(name);
  React.useEffect(() => {
    if (!open) return;
    if (dupName.length < 3) {
      setDupCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkDup.mutateAsync({
          accountId,
          data: { fullName: dupName },
        });
        if (!cancelled) setDupCandidates(res.candidates ?? []);
      } catch {
        if (!cancelled) setDupCandidates([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId, dupName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.firstName.trim() || !name.lastName.trim()) {
      toast({ title: "First and last name required", variant: "destructive" });
      return;
    }
    const inf = Number(influenceScore);
    try {
      await create.mutateAsync({
        accountId,
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
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
      toast({ title: "Contact added", description: `${composeDisplayName(name)} added to this account.` });
      setOpen(false);
    } catch (err: unknown) {
      toast({
        title: "Could not add contact",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[640px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto"
        data-testid="dialog-new-contact"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Add contact</DialogTitle>
          <DialogDescription className="text-text-mute">
            Map a decision-maker on this account. Edits are audit-logged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5 py-3">
          <StructuredNameFields
            value={name}
            onChange={setName}
            idPrefix="contact"
            autoFocus
            labelCls={labelCls}
            fieldCls={fieldCls}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="c-title" className={labelCls}>Title</Label>
              <Input
                id="c-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={fieldCls}
                placeholder="e.g. VP of Engineering"
                data-testid="input-contact-title"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-seniority" className={labelCls}>Seniority</Label>
              <select
                id="c-seniority"
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
                className={selectCls}
                data-testid="select-contact-seniority"
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
              <Label htmlFor="c-email" className={labelCls}>Email</Label>
              <Input
                id="c-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldCls}
                data-testid="input-contact-email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-phone" className={labelCls}>Phone</Label>
              <Input
                id="c-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={fieldCls}
                data-testid="input-contact-phone"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-linkedin" className={labelCls}>LinkedIn URL</Label>
            <Input
              id="c-linkedin"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              className={fieldCls}
              placeholder="https://linkedin.com/in/…"
              data-testid="input-contact-linkedin"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="c-influence" className={labelCls}>Influence (1–5)</Label>
              <Input
                id="c-influence"
                type="number"
                min={1}
                max={5}
                value={influenceScore}
                onChange={(e) => setInfluenceScore(e.target.value)}
                className={fieldCls}
                data-testid="input-contact-influence"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-disposition" className={labelCls}>Disposition</Label>
              <select
                id="c-disposition"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as AtelierContactDisposition)}
                className={selectCls}
                data-testid="select-contact-disposition"
              >
                {DISPOSITIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-persona" className={labelCls}>Buyer persona</Label>
            <Input
              id="c-persona"
              value={buyerPersona}
              onChange={(e) => setBuyerPersona(e.target.value)}
              className={fieldCls}
              data-testid="input-contact-persona"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-notes" className={labelCls}>Notes</Label>
            <Textarea
              id="c-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${fieldCls} min-h-[64px]`}
              data-testid="input-contact-notes"
            />
          </div>
          {dupCandidates.length > 0 && (
            <div
              className="border border-warn/40 bg-warn/10 rounded p-3 text-sm grid gap-2"
              data-testid="warning-duplicate-contacts"
            >
              <div className="font-medium text-warn">
                {dupCandidates.length === 1
                  ? "A contact with a similar name already exists on this account"
                  : `${dupCandidates.length} contacts with similar names already exist on this account`}
              </div>
              <ul className="grid gap-1">
                {dupCandidates.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2"
                    data-testid={`warning-duplicate-contact-${c.id}`}
                  >
                    <span className="truncate">{c.fullName}</span>
                    {c.title ? (
                      <span className="text-text-faint truncate">· {c.title}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] uppercase tracking-widest font-mono text-text-faint">
                      {c.confidence} match
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-faint">
                You can still add this contact if they are a different person.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-border-soft">
            <PillButton type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </PillButton>
            <PillButton
              type="submit"
              variant="primary"
              disabled={create.isPending}
              data-testid="button-submit-new-contact"
            >
              {create.isPending ? "Adding…" : "Add contact"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
