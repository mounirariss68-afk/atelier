/**
 * DeliverableAcceptancesSection — drop-in panel for DeliverablesTab.
 * Task #360 (L2C Wave 1, Step 4 — frontend).
 *
 * Lists acceptances tied to milestones in this engagement and lets
 * eligible personas walk the state machine:
 *   pending → submitted_to_client → client_signed | client_rejected
 *           → withdrawn (anywhere up to client_signed)
 *
 * RBAC mirrors the server:
 *   - draft / submit:        any_writer
 *   - record-signed:         leadership_or_finance (requires evidenceUrl)
 *   - record-rejected:       leadership_or_finance (requires reason)
 *   - withdraw:              owner_or_leadership
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { Card, MonoChip, PillButton, CopyLinkButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Plus, Send, Check, X as XIcon, Archive } from "lucide-react";

const API = "/api/atelier";

interface Acceptance {
  id: string;
  engagementId: string;
  milestoneId: string;
  title: string;
  attestationText: string;
  status:
    | "pending"
    | "submitted_to_client"
    | "client_signed"
    | "client_rejected"
    | "withdrawn";
  clientSignerName: string | null;
  clientSignerEmail: string | null;
  clientSignerTitle: string | null;
  signedAt: string | null;
  evidenceUrl: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  submittedByUserId: string;
  createdAt: string;
}

const TONE: Record<
  Acceptance["status"],
  "default" | "gold" | "green" | "amber" | "red"
> = {
  pending: "default",
  submitted_to_client: "amber",
  client_signed: "green",
  client_rejected: "red",
  withdrawn: "default",
};

const RESTRICTED = new Set([
  "contractor",
  "partner_firm_resource",
  "recruiter",
  "board_observer",
]);

export function DeliverableAcceptancesSection({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();

  const list = useQuery({
    queryKey: ["deliverable-acceptances", engId],
    queryFn: async () => {
      const r = await fetch(
        `${API}/deliverable-acceptances?engagementId=${engId}`,
        { credentials: "include" },
      );
      if (r.status === 403) return { acceptances: [] as Acceptance[] };
      if (!r.ok) throw new Error(`acc_list_${r.status}`);
      return (await r.json()) as { acceptances: Acceptance[] };
    },
    enabled: !!engId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["deliverable-acceptances", engId] });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
  }

  const role = me?.role ?? "";
  const isLeadership = role === "founding_partner" || role === "partner";
  const isFinance = role === "finance";
  const canRead = !!role && !RESTRICTED.has(role);

  const [showForm, setShowForm] = React.useState(false);

  if (!canRead) return null;
  if (list.isLoading)
    return (
      <Card className="p-5 text-text-mute text-sm font-mono">
        Loading acceptances…
      </Card>
    );

  const items = list.data?.acceptances ?? [];

  return (
    <Card
      id="deliverable-acceptances"
      className="p-5 space-y-4 scroll-mt-24"
      data-testid="deliverable-acceptances-section"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
            Deliverable acceptances
          </div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5">
            {items.length} acceptance{items.length === 1 ? "" : "s"} ·
            milestone-gated
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Task #388 — deep-link to the Acceptances panel inside the
              Deliverables tab (anchor `#deliverable-acceptances`). */}
          <CopyLinkButton
            path={`/clients/engagements/${engId}/deliverables`}
            hash="deliverable-acceptances"
            label="Copy section link"
            toastTitle="Section link copied"
            toastDescription="Shareable link to the Deliverable Acceptances section is on your clipboard."
            data-testid="btn-copy-link-deliverable-acceptances"
          />
          <PillButton
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            data-testid="btn-draft-acceptance"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {showForm ? "Cancel" : "Draft acceptance"}
          </PillButton>
        </div>
      </div>

      {showForm && (
        <DraftForm
          engId={engId}
          onDone={() => {
            setShowForm(false);
            invalidate();
            toast({ title: "Acceptance", description: "Drafted (pending)." });
          }}
        />
      )}

      {items.length === 0 ? (
        <div className="text-sm text-text-mute italic">
          No acceptances drafted on this engagement yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <AcceptanceRow
              key={a.id}
              acc={a}
              isLeadership={isLeadership}
              isFinance={isFinance}
              meId={me?.id ?? ""}
              onChange={invalidate}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ────────────────────────── draft form ────────────────────────── */

function DraftForm({
  engId,
  onDone,
}: {
  engId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [milestoneId, setMilestoneId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [attestation, setAttestation] = React.useState("");

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/deliverable-acceptances`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: engId,
          milestoneId: milestoneId.trim() || null,
          title: title.trim(),
          attestationText: attestation.trim(),
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `draft_${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => onDone(),
    onError: (e: Error) =>
      toast({ title: "Draft failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border border-border-soft bg-bg-deep p-4 space-y-3">
      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase text-text-mute">
          Milestone ID (optional)
        </label>
        <input
          value={milestoneId}
          onChange={(e) => setMilestoneId(e.target.value)}
          placeholder="e.g. ms_phase1 — leave blank for engagement-level"
          className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text font-mono"
          data-testid="input-acceptance-milestone"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase text-text-mute">
          Title
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Phase 1 acceptance — Diagnostic Memo"
          className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text"
          data-testid="input-acceptance-title"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase text-text-mute">
          Attestation text
        </label>
        <textarea
          value={attestation}
          onChange={(e) => setAttestation(e.target.value)}
          rows={3}
          placeholder="Client attests that the deliverable has been received and meets the agreed acceptance criteria…"
          className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text"
          data-testid="input-acceptance-attestation"
        />
      </div>
      <div className="flex justify-end">
        <PillButton
          variant="primary"
          onClick={() => create.mutate()}
          disabled={
            !title.trim() || !attestation.trim() || create.isPending
          }
          data-testid="btn-acceptance-create"
        >
          {create.isPending ? "Drafting…" : "Draft"}
        </PillButton>
      </div>
    </div>
  );
}

/* ─────────────────────────── one row ─────────────────────────── */

function AcceptanceRow({
  acc,
  isLeadership,
  isFinance,
  meId,
  onChange,
}: {
  acc: Acceptance;
  isLeadership: boolean;
  isFinance: boolean;
  meId: string;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [openAction, setOpenAction] = React.useState<
    null | "submit" | "signed" | "reject"
  >(null);

  const isOwner = acc.submittedByUserId === meId;

  async function call(
    path: string,
    body?: Record<string, unknown>,
    label?: string,
  ) {
    setBusy(path);
    try {
      const r = await fetch(
        `${API}/deliverable-acceptances/${acc.id}/${path}`,
        {
          method: "POST",
          credentials: "include",
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `${path}_${r.status}`);
      }
      onChange();
      setOpenAction(null);
      toast({ title: "Acceptance", description: label ?? path });
    } catch (e) {
      toast({
        title: `${path} failed`,
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li
      className="rounded-md border border-border-soft bg-bg-deep p-3 space-y-2"
      data-testid={`acceptance-row-${acc.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text leading-snug">
            {acc.title}
          </div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5 truncate">
            {acc.id} · milestone {acc.milestoneId}
          </div>
        </div>
        <MonoChip tone={TONE[acc.status]}>{acc.status}</MonoChip>
      </div>
      {acc.attestationText && (
        <p className="text-[12px] text-text leading-snug italic line-clamp-3">
          “{acc.attestationText}”
        </p>
      )}
      {acc.clientSignerEmail && (
        <div className="text-[11px] font-mono text-text-faint">
          submitted → {acc.clientSignerName} ({acc.clientSignerEmail})
          {acc.clientSignerTitle ? ` · ${acc.clientSignerTitle}` : ""}
        </div>
      )}
      {acc.milestoneId && (
        <div className="text-[11px] font-mono text-text-faint">
          milestone: {acc.milestoneId}
        </div>
      )}
      {acc.signedAt && (
        <div className="text-[11px] font-mono text-success">
          signed {new Date(acc.signedAt).toLocaleString()}
        </div>
      )}
      {acc.rejectionReason && (
        <div className="text-[11px] font-mono text-danger">
          rejected: {acc.rejectionReason}
        </div>
      )}
      {acc.evidenceUrl && (
        <a
          href={acc.evidenceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-mono text-gold hover:underline"
        >
          evidence
        </a>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {acc.status === "pending" && (
          <PillButton
            variant="primary"
            onClick={() => setOpenAction("submit")}
            data-testid={`btn-acc-submit-${acc.id}`}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" /> Submit to client
          </PillButton>
        )}
        {acc.status === "submitted_to_client" && (isLeadership || isFinance) && (
          <>
            <PillButton
              variant="primary"
              onClick={() => setOpenAction("signed")}
              data-testid={`btn-acc-record-signed-${acc.id}`}
            >
              <Check className="w-3.5 h-3.5 mr-1.5" /> Record signed
            </PillButton>
            <PillButton
              variant="ghost"
              onClick={() => setOpenAction("reject")}
              data-testid={`btn-acc-record-rejected-${acc.id}`}
              className="text-danger hover:border-danger"
            >
              <XIcon className="w-3.5 h-3.5 mr-1.5" /> Record rejection
            </PillButton>
          </>
        )}
        {(acc.status === "pending" ||
          acc.status === "submitted_to_client") &&
          (isOwner || isLeadership) && (
            <PillButton
              variant="ghost"
              onClick={() => call("withdraw", undefined, "Withdrawn")}
              disabled={busy !== null}
              data-testid={`btn-acc-withdraw-${acc.id}`}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" /> Withdraw
            </PillButton>
          )}
      </div>

      {openAction === "submit" && (
        <SubmitForm
          busy={busy !== null}
          onCancel={() => setOpenAction(null)}
          onSubmit={(name, email, title) =>
            call(
              "submit",
              {
                clientSignerName: name,
                clientSignerEmail: email,
                clientSignerTitle: title,
              },
              `Submitted to ${email}`,
            )
          }
        />
      )}
      {openAction === "signed" && (
        <SingleFieldForm
          label="Evidence URL (signed PDF, DocuSign envelope, etc.)"
          placeholder="https://…"
          submitLabel="Record signed"
          busy={busy !== null}
          onCancel={() => setOpenAction(null)}
          onSubmit={(v) =>
            call(
              "record-signed",
              { evidenceUrl: v },
              "Signed evidence recorded — milestone gate satisfied.",
            )
          }
        />
      )}
      {openAction === "reject" && (
        <SingleFieldForm
          label="Rejection reason"
          placeholder="Why did the client reject?"
          submitLabel="Record rejection"
          busy={busy !== null}
          textarea
          onCancel={() => setOpenAction(null)}
          onSubmit={(v) =>
            call("record-rejected", { reason: v }, "Rejection recorded")
          }
        />
      )}
    </li>
  );
}

function SubmitForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, email: string, title: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  return (
    <div className="rounded-md border border-border-soft bg-bg-elevate p-3 space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Client signer name"
        className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text"
        data-testid="input-acc-signer-name"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="signer@client.com"
        className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text font-mono"
        data-testid="input-acc-signer-email"
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Signer title (optional)"
        className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text"
        data-testid="input-acc-signer-title"
      />
      <div className="flex justify-end gap-2">
        <PillButton variant="ghost" onClick={onCancel}>
          Cancel
        </PillButton>
        <PillButton
          variant="primary"
          onClick={() => onSubmit(name.trim(), email.trim(), title.trim())}
          disabled={busy || !name.trim() || !email.trim()}
          data-testid="btn-acc-submit"
        >
          {busy ? "Submitting…" : "Submit"}
        </PillButton>
      </div>
    </div>
  );
}

function SingleFieldForm({
  label,
  placeholder,
  submitLabel,
  busy,
  textarea,
  onCancel,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  textarea?: boolean;
  onCancel: () => void;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = React.useState("");
  return (
    <div className="rounded-md border border-border-soft bg-bg-elevate p-3 space-y-2">
      <div className="text-[10px] font-mono uppercase text-text-mute">{label}</div>
      {textarea ? (
        <textarea
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text"
          data-testid="input-acc-field"
        />
      ) : (
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text font-mono"
          data-testid="input-acc-field"
        />
      )}
      <div className="flex justify-end gap-2">
        <PillButton variant="ghost" onClick={onCancel}>
          Cancel
        </PillButton>
        <PillButton
          variant="primary"
          onClick={() => onSubmit(v.trim())}
          disabled={busy || !v.trim()}
          data-testid="btn-acc-field-submit"
        >
          {busy ? "Saving…" : submitLabel}
        </PillButton>
      </div>
    </div>
  );
}
