/**
 * ChangeOrdersSection — drop-in panel for CharterTab.
 * Task #360 (L2C Wave 1, Step 3 — frontend).
 *
 * Lists change orders for an engagement and lets eligible personas
 * walk the state machine: draft → partner_approved → client_proposed
 * → client_accepted/rejected → posted (or withdrawn anywhere).
 *
 * RBAC mirrors the server:
 *   - propose / patch:    canReadChangeOrder personas
 *   - partner-approve:    leadership
 *   - dispatch:           leadership (requires signer name + email)
 *   - record-acceptance:  leadership_or_finance (requires evidenceUrl)
 *   - record-rejection:   leadership_or_finance (requires reason)
 *   - withdraw:           owner_or_leadership
 *   - post:               finance only
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Send,
  Check,
  X as XIcon,
  Archive,
  Banknote,
  Receipt,
} from "lucide-react";

const API = "/api/atelier";

interface ChangeOrder {
  id: string;
  engagementId: string;
  kind: "scope" | "rate" | "term" | "team";
  summary: string;
  rationaleText: string;
  status:
    | "draft"
    | "partner_approved"
    | "client_proposed"
    | "client_accepted"
    | "client_rejected"
    | "withdrawn"
    | "posted";
  valueDeltaUsd: number | null;
  proposedByUserId: string;
  partnerApproverUserId: string | null;
  clientSignerName: string | null;
  clientSignerEmail: string | null;
  clientProposedAt: string | null;
  clientResolvedAt: string | null;
  postedAt: string | null;
  evidenceUrl: string | null;
  createdAt: string;
}

const TONE: Record<
  ChangeOrder["status"],
  "default" | "gold" | "green" | "amber" | "red"
> = {
  draft: "default",
  partner_approved: "gold",
  client_proposed: "amber",
  client_accepted: "green",
  client_rejected: "red",
  withdrawn: "default",
  posted: "green",
};

const RESTRICTED = new Set([
  "contractor",
  "partner_firm_resource",
  "recruiter",
  "board_observer",
]);

export function ChangeOrdersSection({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();

  const list = useQuery({
    queryKey: ["change-orders", engId],
    queryFn: async () => {
      const r = await fetch(`${API}/change-orders?engagementId=${engId}`, {
        credentials: "include",
      });
      if (r.status === 403) return { changeOrders: [] as ChangeOrder[] };
      if (!r.ok) throw new Error(`co_list_${r.status}`);
      return (await r.json()) as { changeOrders: ChangeOrder[] };
    },
    enabled: !!engId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["change-orders", engId] });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
  }

  const role = me?.role ?? "";
  const isLeadership = role === "founding_partner" || role === "partner";
  const isFinance = role === "finance";
  const canRead = !!role && !RESTRICTED.has(role);
  const canWrite = canRead;

  const [showForm, setShowForm] = React.useState(false);

  if (!canRead) return null;
  if (list.isLoading)
    return (
      <Card className="p-5 text-text-mute text-sm font-mono">
        Loading change orders…
      </Card>
    );

  const items = list.data?.changeOrders ?? [];

  return (
    <Card className="p-5 space-y-4" data-testid="change-orders-section">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
            Change orders
          </div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5">
            {items.length} on this engagement
          </div>
        </div>
        {canWrite && (
          <PillButton
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            data-testid="btn-propose-change-order"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {showForm ? "Cancel" : "Propose change order"}
          </PillButton>
        )}
      </div>

      {showForm && (
        <ProposeForm
          engId={engId}
          onDone={() => {
            setShowForm(false);
            invalidate();
            toast({ title: "Change order", description: "Drafted." });
          }}
        />
      )}

      {items.length === 0 ? (
        <div className="text-sm text-text-mute italic">
          No change orders for this engagement.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((co) => (
            <ChangeOrderRow
              key={co.id}
              co={co}
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

/* ────────────────────────── propose form ────────────────────────── */

function ProposeForm({
  engId,
  onDone,
}: {
  engId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = React.useState<ChangeOrder["kind"]>("scope");
  const [summary, setSummary] = React.useState("");
  const [rationale, setRationale] = React.useState("");
  const [delta, setDelta] = React.useState("0");

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/change-orders`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: engId,
          kind,
          summary: summary.trim(),
          rationaleText: rationale.trim(),
          valueDeltaUsd: Number(delta) || 0,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `propose_${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => onDone(),
    onError: (e: Error) =>
      toast({ title: "Propose failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border border-border-soft bg-bg-deep p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-mono uppercase text-text-mute">
            Kind
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ChangeOrder["kind"])}
            className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text"
            data-testid="select-co-kind"
          >
            <option value="scope">scope</option>
            <option value="rate">rate</option>
            <option value="term">term</option>
            <option value="team">team</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono uppercase text-text-mute">
            Value Δ (USD)
          </label>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text font-mono"
            data-testid="input-co-delta"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase text-text-mute">
          Summary
        </label>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One-line scope/rate/term/team change…"
          className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text"
          data-testid="input-co-summary"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase text-text-mute">
          Rationale
        </label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-sm text-text"
          data-testid="input-co-rationale"
        />
      </div>
      <div className="flex justify-end">
        <PillButton
          variant="primary"
          onClick={() => create.mutate()}
          disabled={!summary.trim() || create.isPending}
          data-testid="btn-co-create"
        >
          {create.isPending ? "Drafting…" : "Draft"}
        </PillButton>
      </div>
    </div>
  );
}

/* ─────────────────────────── one row ─────────────────────────── */

function ChangeOrderRow({
  co,
  isLeadership,
  isFinance,
  meId,
  onChange,
}: {
  co: ChangeOrder;
  isLeadership: boolean;
  isFinance: boolean;
  meId: string;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [openAction, setOpenAction] = React.useState<
    null | "dispatch" | "accept" | "reject"
  >(null);

  const isOwner = co.proposedByUserId === meId;

  async function call(
    path: string,
    body?: Record<string, unknown>,
    label?: string,
  ) {
    setBusy(path);
    try {
      const r = await fetch(`${API}/change-orders/${co.id}/${path}`, {
        method: "POST",
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `${path}_${r.status}`);
      }
      onChange();
      setOpenAction(null);
      toast({ title: "Change order", description: label ?? path });
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
      data-testid={`change-order-row-${co.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text leading-snug">
            {co.summary}
          </div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5 uppercase tracking-wider">
            {co.kind} · {co.id}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <MonoChip tone={TONE[co.status]}>{co.status}</MonoChip>
          {co.valueDeltaUsd != null && (
            <span
              className={
                co.valueDeltaUsd > 0
                  ? "text-[11px] font-mono text-success"
                  : co.valueDeltaUsd < 0
                    ? "text-[11px] font-mono text-danger"
                    : "text-[11px] font-mono text-text-mute"
              }
            >
              {co.valueDeltaUsd > 0 ? "+" : ""}$
              {Math.round(co.valueDeltaUsd).toLocaleString()}
            </span>
          )}
        </div>
      </div>
      {co.rationaleText && (
        <p className="text-[12px] text-text-mute leading-snug line-clamp-2 italic">
          {co.rationaleText}
        </p>
      )}
      {co.clientSignerEmail && (
        <div className="text-[11px] font-mono text-text-faint">
          dispatched → {co.clientSignerName} ({co.clientSignerEmail})
        </div>
      )}
      {co.evidenceUrl && (
        <a
          href={co.evidenceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-mono text-gold hover:underline"
        >
          evidence
        </a>
      )}

      {/* action buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        {co.status === "draft" && isLeadership && (
          <PillButton
            variant="primary"
            onClick={() => call("partner-approve", undefined, "Partner-approved")}
            disabled={busy !== null}
            data-testid={`btn-co-partner-approve-${co.id}`}
          >
            <Check className="w-3.5 h-3.5 mr-1.5" /> Partner approve
          </PillButton>
        )}
        {co.status === "partner_approved" && isLeadership && (
          <PillButton
            variant="primary"
            onClick={() => setOpenAction("dispatch")}
            data-testid={`btn-co-dispatch-${co.id}`}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" /> Dispatch to client
          </PillButton>
        )}
        {co.status === "client_proposed" && (isLeadership || isFinance) && (
          <>
            <PillButton
              variant="primary"
              onClick={() => setOpenAction("accept")}
              data-testid={`btn-co-record-acceptance-${co.id}`}
            >
              <Check className="w-3.5 h-3.5 mr-1.5" /> Record acceptance
            </PillButton>
            <PillButton
              variant="ghost"
              onClick={() => setOpenAction("reject")}
              data-testid={`btn-co-record-rejection-${co.id}`}
              className="text-danger hover:border-danger"
            >
              <XIcon className="w-3.5 h-3.5 mr-1.5" /> Record rejection
            </PillButton>
          </>
        )}
        {co.status === "client_accepted" && isFinance && (
          <PillButton
            variant="primary"
            onClick={() => call("post", undefined, "Posted to ledger")}
            disabled={busy !== null}
            data-testid={`btn-co-post-${co.id}`}
          >
            <Banknote className="w-3.5 h-3.5 mr-1.5" /> Post (Finance)
          </PillButton>
        )}
        {(co.status === "draft" ||
          co.status === "partner_approved" ||
          co.status === "client_proposed") &&
          (isOwner || isLeadership) && (
            <PillButton
              variant="ghost"
              onClick={() => call("withdraw", undefined, "Withdrawn")}
              disabled={busy !== null}
              data-testid={`btn-co-withdraw-${co.id}`}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" /> Withdraw
            </PillButton>
          )}
        {co.status === "posted" && (
          <span className="text-[11px] font-mono text-text-faint inline-flex items-center gap-1">
            <Receipt className="w-3 h-3" />
            posted {co.postedAt && new Date(co.postedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {openAction === "dispatch" && (
        <DispatchForm
          busy={busy !== null}
          onCancel={() => setOpenAction(null)}
          onSubmit={(name, email) =>
            call(
              "dispatch",
              { clientSignerName: name, clientSignerEmail: email },
              `Dispatched to ${email}`,
            )
          }
        />
      )}
      {openAction === "accept" && (
        <SingleFieldForm
          label="Evidence URL (DocuSign envelope, signed PDF, etc.)"
          placeholder="https://…"
          submitLabel="Record acceptance"
          busy={busy !== null}
          onCancel={() => setOpenAction(null)}
          onSubmit={(v) =>
            call("record-acceptance", { evidenceUrl: v }, "Acceptance recorded")
          }
        />
      )}
      {openAction === "reject" && (
        <SingleFieldForm
          label="Reason"
          placeholder="Why did the client reject?"
          submitLabel="Record rejection"
          busy={busy !== null}
          textarea
          onCancel={() => setOpenAction(null)}
          onSubmit={(v) =>
            call("record-rejection", { reason: v }, "Rejection recorded")
          }
        />
      )}
    </li>
  );
}

function DispatchForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, email: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  return (
    <div className="rounded-md border border-border-soft bg-bg-elevate p-3 space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Client signer name"
        className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text"
        data-testid="input-co-signer-name"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="signer@client.com"
        className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text font-mono"
        data-testid="input-co-signer-email"
      />
      <div className="flex justify-end gap-2">
        <PillButton variant="ghost" onClick={onCancel}>
          Cancel
        </PillButton>
        <PillButton
          variant="primary"
          onClick={() => onSubmit(name.trim(), email.trim())}
          disabled={busy || !name.trim() || !email.trim()}
          data-testid="btn-co-dispatch-submit"
        >
          {busy ? "Dispatching…" : "Dispatch"}
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
          data-testid="input-co-field"
        />
      ) : (
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text font-mono"
          data-testid="input-co-field"
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
          data-testid="btn-co-field-submit"
        >
          {busy ? "Saving…" : submitLabel}
        </PillButton>
      </div>
    </div>
  );
}
