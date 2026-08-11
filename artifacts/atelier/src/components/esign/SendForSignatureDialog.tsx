/**
 * Task #112 — shared "Send for signature" dialog.
 *
 * Extracted from the Agreements page so account and opportunity detail
 * pages can launch a signature request in context. When `lockedAccount`
 * is provided the account selector is fixed to that account and the
 * signer picker pre-populates from the account's contacts (one-click
 * chips for every contact with an email on file).
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListDocuments,
  useAtelierListAccounts,
  getAtelierListAccountsQueryKey,
  useAtelierListAccountContacts,
  getAtelierListAccountContactsQueryKey,
  getAtelierListSignatureRequestsQueryKey,
  getAtelierListDocumentsQueryKey,
  useAtelierCreateSignatureRequest,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PenLine, Plus, Trash2, UserPlus, LayoutTemplate } from "lucide-react";
import { type ExtraField, type Placement } from "@/components/esign/placement";

// Lazy: the placement editor pulls in pdf.js (large, and its worker
// asset import is Vite-only), so it must never load with the dialog
// itself — only when the sender opens the preview.
const SignaturePlacementEditor = React.lazy(() =>
  import("@/components/esign/SignaturePlacementEditor").then((m) => ({
    default: m.SignaturePlacementEditor,
  })),
);

const selectCls =
  "h-9 rounded-md border border-border glass-surface px-2 text-sm text-text outline-none focus-visible:border-gold";

export interface SignerDraft {
  name: string;
  email: string;
}

const EMAIL_RE = /.+@.+\..+/;
const MAX_SIGNERS = 10;

/** Contact fields the signer prefill consumes (subset of AtelierContact). */
export interface SignerContact {
  id: string;
  fullName: string;
  email?: string | null;
  title?: string | null;
}

/** Contacts eligible for signer prefill: must have a plausible email. */
export function contactsWithValidEmail<T extends SignerContact>(
  contacts: readonly T[] | undefined,
): T[] {
  return (contacts ?? []).filter(
    (c) => typeof c.email === "string" && EMAIL_RE.test(c.email),
  );
}

/**
 * Seed signer rows from an account's contacts: only contacts with an
 * email, deduped case-insensitively (server rejects duplicate signer
 * emails), capped at MAX_SIGNERS. Returns [] when nothing qualifies.
 */
export function seedSignersFromContacts(
  contacts: readonly SignerContact[] | undefined,
): SignerDraft[] {
  const seen = new Set<string>();
  const seeded: SignerDraft[] = [];
  for (const c of contacts ?? []) {
    if (typeof c.email !== "string" || !EMAIL_RE.test(c.email)) continue;
    const key = c.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeded.push({ name: c.fullName, email: c.email });
    if (seeded.length >= MAX_SIGNERS) break;
  }
  return seeded;
}

/**
 * Add a contact to the signer rows: no-op on duplicate email
 * (case-insensitive), fills the first fully-empty row before appending,
 * and never exceeds MAX_SIGNERS.
 */
export function addContactToSigners(
  prev: readonly SignerDraft[],
  name: string,
  email: string,
): SignerDraft[] {
  if (prev.some((s) => s.email.trim().toLowerCase() === email.toLowerCase()))
    return [...prev];
  const emptyIdx = prev.findIndex((s) => !s.name.trim() && !s.email.trim());
  if (emptyIdx >= 0)
    return prev.map((s, i) => (i === emptyIdx ? { name, email } : s));
  if (prev.length >= MAX_SIGNERS) return [...prev];
  return [...prev, { name, email }];
}

export interface CreateSignaturePayload {
  title: string;
  message?: string;
  documentId: string;
  signers: Array<{ name: string; email: string }>;
  accountId?: string;
  opportunityId?: string;
  expiresInDays?: number;
  placements?: Placement[];
  extraFields?: ExtraField[];
  pageCount?: number;
}

/**
 * Build the POST /esign/requests body. When the dialog is locked to an
 * account, that accountId ALWAYS wins over any free-selection value.
 */
export function buildCreateSignaturePayload(args: {
  title: string;
  message: string;
  documentId: string;
  signers: readonly SignerDraft[];
  lockedAccountId?: string;
  selectedAccountId: string;
  opportunityId?: string;
  expiresInDays: string;
  /**
   * Sender-adjusted signature boxes (one per signer). Only sent when
   * present AND matching the signer count — otherwise the server's
   * default last-page layout applies.
   */
  placements?: Placement[] | null;
  /**
   * Optional date/initials boxes tied to signers by 0-based index. Only
   * entries pointing at an existing signer are sent.
   */
  extraFields?: ExtraField[] | null;
  /**
   * Page count reported by the placement editor's pdf.js preview. Sent
   * alongside placements so the server can clamp pages even when it
   * cannot parse the PDF itself.
   */
  pageCount?: number | null;
}): CreateSignaturePayload {
  const placements =
    args.placements && args.placements.length === args.signers.length
      ? args.placements
      : undefined;

  const extraFields = (args.extraFields ?? []).filter(
    (f) => f.signerIndex >= 0 && f.signerIndex < args.signers.length,
  );
  return {
    title: args.title.trim(),
    message: args.message.trim() || undefined,
    documentId: args.documentId,
    signers: args.signers.map((s) => ({
      name: s.name.trim(),
      email: s.email.trim(),
    })),
    accountId: args.lockedAccountId ?? (args.selectedAccountId || undefined),
    opportunityId: args.opportunityId || undefined,
    expiresInDays: args.expiresInDays ? Number(args.expiresInDays) : undefined,
    placements,
    pageCount:
      placements && args.pageCount && args.pageCount >= 1
        ? args.pageCount
        : undefined,
    extraFields: extraFields.length > 0 ? extraFields : undefined,
  };
}

/**
 * One-click chips for adding an account contact as a signer. Pure
 * component so the locked-account prefill surface can be tested without
 * the Dialog portal / react-query providers.
 */
export function ContactSignerChips({
  contacts,
  signerEmails,
  onAdd,
}: {
  contacts: readonly SignerContact[];
  signerEmails: ReadonlySet<string>;
  onAdd: (name: string, email: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5" data-testid="chips-esign-contacts">
      {contacts.map((c) => {
        const added = signerEmails.has((c.email ?? "").toLowerCase());
        return (
          <button
            key={c.id}
            type="button"
            disabled={added}
            onClick={() => onAdd(c.fullName, c.email ?? "")}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              added
                ? "border-border/50 text-text-faint cursor-default"
                : "border-border text-text-mute hover:border-gold hover:text-text"
            }`}
            title={c.email ?? undefined}
            data-testid={`chip-esign-contact-${c.id}`}
          >
            <UserPlus className="w-3 h-3" />
            {c.fullName}
            {c.title ? <span className="text-text-faint">· {c.title}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SendForSignatureDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Fix the request to this account and prefill signers from its contacts. */
  lockedAccount?: { id: string; name: string };
  /** Link the request to the opportunity it was sent from (deal context). */
  opportunityId?: string;
  /** Initial title suggestion (e.g. "Consulting agreement — <opp name>"). */
  defaultTitle?: string;
}

export function SendForSignatureDialog({
  open,
  onOpenChange,
  lockedAccount,
  opportunityId,
  defaultTitle,
}: SendForSignatureDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: docsData } = useAtelierListDocuments(undefined, {
    query: { enabled: open, queryKey: getAtelierListDocumentsQueryKey() },
  });
  const { data: accounts } = useAtelierListAccounts(undefined, {
    query: {
      enabled: open && !lockedAccount,
      queryKey: getAtelierListAccountsQueryKey(),
    },
  });
  const { data: contactGraph } = useAtelierListAccountContacts(
    lockedAccount?.id ?? "",
    {
      query: {
        enabled: open && !!lockedAccount,
        queryKey: getAtelierListAccountContactsQueryKey(lockedAccount?.id ?? ""),
      },
    },
  );

  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [documentId, setDocumentId] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [expiresInDays, setExpiresInDays] = React.useState("");
  const [signers, setSigners] = React.useState<SignerDraft[]>([{ name: "", email: "" }]);
  const [showPlacement, setShowPlacement] = React.useState(false);
  const [placements, setPlacements] = React.useState<Placement[] | null>(null);
  const [extraFields, setExtraFields] = React.useState<ExtraField[]>([]);
  const [docPageCount, setDocPageCount] = React.useState<number | null>(null);

  // A different document invalidates any custom box positions.
  React.useEffect(() => {
    setPlacements(null);
    setExtraFields([]);
    setDocPageCount(null);
  }, [documentId]);

  // Re-seed the title suggestion each time the dialog opens fresh.
  React.useEffect(() => {
    if (open && defaultTitle && title === "") setTitle(defaultTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // In account context, pre-populate the signer rows from the account's
  // contacts (those with an email on file) the first time data arrives
  // while the form is still untouched. Users can remove/reorder freely.
  React.useEffect(() => {
    if (!open || !lockedAccount || !contactGraph) return;
    setSigners((prev) => {
      const untouched = prev.length === 1 && !prev[0].name.trim() && !prev[0].email.trim();
      if (!untouched) return prev;
      const seeded = seedSignersFromContacts(contactGraph.contacts);
      return seeded.length > 0 ? seeded : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactGraph]);

  const reset = () => {
    setTitle("");
    setMessage("");
    setDocumentId("");
    setAccountId("");
    setExpiresInDays("");
    setSigners([{ name: "", email: "" }]);
    setShowPlacement(false);
    setPlacements(null);
    setExtraFields([]);
  };

  const pdfDocs = React.useMemo(
    () =>
      (docsData?.documents ?? []).filter(
        (d) => d.currentVersion?.mime === "application/pdf" && d.status === "active",
      ),
    [docsData],
  );

  const contactsWithEmail = React.useMemo(
    () => contactsWithValidEmail(contactGraph?.contacts),
    [contactGraph],
  );

  const signerEmails = new Set(
    signers.map((s) => s.email.trim().toLowerCase()).filter(Boolean),
  );

  const addContactAsSigner = (name: string, email: string) => {
    setSigners((prev) => addContactToSigners(prev, name, email));
  };

  const create = useAtelierCreateSignatureRequest({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListSignatureRequestsQueryKey() });
        toast({ title: "Signature request sent" });
        onOpenChange(false);
        reset();
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string; error?: string } } };
        toast({
          title: "Could not send request",
          description:
            e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
          variant: "destructive",
        });
      },
    },
  });

  const valid =
    title.trim().length > 0 &&
    documentId &&
    signers.length > 0 &&
    signers.every((s) => s.name.trim() && /.+@.+\..+/.test(s.email.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send for signature</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-mute">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Consulting agreement — Acme"
              maxLength={200}
              data-testid="input-esign-title"
            />
          </div>
          <div>
            <label className="text-xs text-text-mute">Document (PDF from the library)</label>
            <select
              className={`${selectCls} w-full`}
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              data-testid="select-esign-document"
            >
              <option value="">Select a PDF…</option>
              {pdfDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            {pdfDocs.length === 0 ? (
              <p className="mt-1 text-xs text-text-faint">
                No PDF documents in the library yet — upload one under Documents first.
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-xs text-text-mute">Signers (in signing order)</label>
            {lockedAccount && contactsWithEmail.length > 0 ? (
              <ContactSignerChips
                contacts={contactsWithEmail}
                signerEmails={signerEmails}
                onAdd={addContactAsSigner}
              />
            ) : null}
            {lockedAccount && contactGraph && contactsWithEmail.length === 0 ? (
              <p className="mb-2 text-xs text-text-faint" data-testid="text-esign-no-contacts">
                No contacts with an email on file for {lockedAccount.name} — add signers
                manually below.
              </p>
            ) : null}
            <div className="space-y-2">
              {signers.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 text-xs text-text-faint font-mono">{i + 1}.</span>
                  <Input
                    value={s.name}
                    onChange={(e) =>
                      setSigners((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                      )
                    }
                    placeholder="Name"
                    className="flex-1"
                    data-testid={`input-signer-name-${i}`}
                  />
                  <Input
                    value={s.email}
                    onChange={(e) =>
                      setSigners((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, email: e.target.value } : p)),
                      )
                    }
                    placeholder="email@example.com"
                    className="flex-1"
                    data-testid={`input-signer-email-${i}`}
                  />
                  {signers.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSigners((prev) => prev.filter((_, j) => j !== i))}
                      data-testid={`button-remove-signer-${i}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {signers.length < 10 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSigners((prev) => [...prev, { name: "", email: "" }])}
                  data-testid="button-add-signer"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add signer
                </Button>
              ) : null}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-text-mute">Signature placement</label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!documentId}
                onClick={() => setShowPlacement((v) => !v)}
                data-testid="button-esign-placement-toggle"
              >
                <LayoutTemplate className="w-3.5 h-3.5 mr-1" />
                {showPlacement ? "Hide preview" : "Preview & adjust"}
              </Button>
            </div>
            {!showPlacement ? (
              <p className="mt-1 text-xs text-text-faint" data-testid="text-esign-placement-default">
                {placements
                  ? "Custom positions set — boxes will land where you placed them."
                  : "One signature box per signer will be placed automatically on the last page."}
              </p>
            ) : documentId ? (
              <div className="mt-2">
                <React.Suspense
                  fallback={
                    <div className="rounded-md border border-border/60 bg-bg-elevate/40 px-3 py-6 text-center text-xs text-text-faint">
                      Loading placement editor…
                    </div>
                  }
                >
                  <SignaturePlacementEditor
                    documentId={documentId}
                    signerNames={signers.map((s) => s.name)}
                    placements={placements}
                    onChange={setPlacements}
                    extraFields={extraFields}
                    onExtraFieldsChange={setExtraFields}
                    onPageCount={setDocPageCount}
                  />
                </React.Suspense>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-mute">
                Account {lockedAccount ? "" : "(optional)"}
              </label>
              {lockedAccount ? (
                <div
                  className="h-9 flex items-center rounded-md border border-border/60 bg-bg-elevate/50 px-2 text-sm text-text-mute truncate"
                  data-testid="text-esign-locked-account"
                >
                  {lockedAccount.name}
                </div>
              ) : (
                <select
                  className={`${selectCls} w-full`}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  data-testid="select-esign-account"
                >
                  <option value="">None</option>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              {!lockedAccount ? (
                <p className="mt-0.5 text-[10px] text-text-faint">
                  Optional — links the request to a counterparty so it shows up on
                  that account and in the Contracts overview.
                </p>
              ) : null}
            </div>
            <div>
              <label className="text-xs text-text-mute">Expires in (days, optional)</label>
              <Input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="e.g. 30"
                data-testid="input-esign-expires"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-mute">Message to signers (optional)</label>
            <textarea
              className="w-full min-h-[70px] rounded-md border border-border bg-bg-elevate px-2 py-1.5 text-sm text-text outline-none focus-visible:border-gold"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              data-testid="input-esign-message"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-esign-cancel">
              Cancel
            </Button>
            <Button
              disabled={!valid || create.isPending}
              onClick={() =>
                create.mutate({
                  data: buildCreateSignaturePayload({
                    title,
                    message,
                    documentId,
                    signers,
                    lockedAccountId: lockedAccount?.id,
                    selectedAccountId: accountId,
                    opportunityId,
                    expiresInDays,
                    placements,
                    extraFields,
                    pageCount: docPageCount,
                  }),
                })
              }
              data-testid="button-esign-send"
            >
              <PenLine className="w-4 h-4 mr-1" />
              {create.isPending ? "Sending…" : "Send for signature"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
