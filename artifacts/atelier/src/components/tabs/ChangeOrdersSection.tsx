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
import { Card, MonoChip, PillButton, CopyLinkButton } from "@/components/ui/primitives";
import { fieldControlCls } from "@/components/ui/fieldControls";
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
  // Task #455 — first-class scope/effort deltas. Server returns null
  // when the persona isn't allowed to see them (mirrors valueDeltaUsd).
  labourHoursDelta: number | null;
  labourCostDeltaUsd: number | null;
  expensesDeltaUsd: number | null;
  subsDeltaUsd: number | null;
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
    <Card
      id="change-orders"
      className="p-5 space-y-4 scroll-mt-24"
      data-testid="change-orders-section"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
            Change orders
          </div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5">
            {items.length} on this engagement
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Task #388 — deep-link to the Change Orders panel inside the
              Charter tab (anchor `#change-orders`). */}
          <CopyLinkButton
            path={`/clients/engagements/${engId}/charter`}
            hash="change-orders"
            label="Copy section link"
            toastTitle="Section link copied"
            toastDescription="Shareable link to the Change Orders section is on your clipboard."
            data-testid="btn-copy-link-change-orders"
          />
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
      </div>

      {showForm && (
        <ProposeForm
          engId={engId}
          showFinanceFields={isLeadership || isFinance}
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
  showFinanceFields,
  onDone,
}: {
  engId: string;
  showFinanceFields: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = React.useState<ChangeOrder["kind"]>("scope");
  const [summary, setSummary] = React.useState("");
  const [rationale, setRationale] = React.useState("");
  const [delta, setDelta] = React.useState("0");
  // Task #455 — first-class scope/effort deltas, finance/leadership only.
  const [hoursDelta, setHoursDelta] = React.useState("0");
  const [labourCostDelta, setLabourCostDelta] = React.useState("0");
  const [expensesDelta, setExpensesDelta] = React.useState("0");
  const [subsDelta, setSubsDelta] = React.useState("0");

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
          ...(showFinanceFields
            ? {
                labourHoursDelta: Number(hoursDelta) || 0,
                labourCostDeltaUsd: Number(labourCostDelta) || 0,
                expensesDeltaUsd: Number(expensesDelta) || 0,
                subsDeltaUsd: Number(subsDelta) || 0,
              }
            : {}),
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
            className={`${fieldControlCls} bg-bg-elevate border border-border rounded-md text-sm text-text`}
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
            className={`${fieldControlCls} bg-bg-elevate border border-border rounded-md text-sm text-text font-mono`}
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
          className={`${fieldControlCls} bg-bg-elevate border border-border rounded-md text-sm text-text`}
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
      {showFinanceFields && (
        <div
          className="rounded-md border border-border-soft glass-surface p-3 space-y-3"
          data-testid="co-effort-deltas"
        >
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-mute">
            Scope &amp; effort deltas
            <span className="ml-2 text-text-faint normal-case">
              (finance / leadership) — used to re-baseline the engagement
              budget on post
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase text-text-mute">
                Δ Labour hours
              </label>
              <input
                type="number"
                value={hoursDelta}
                onChange={(e) => setHoursDelta(e.target.value)}
                className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text font-mono`}
                data-testid="input-co-labour-hours-delta"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase text-text-mute">
                Δ Labour cost USD
              </label>
              <input
                type="number"
                value={labourCostDelta}
                onChange={(e) => setLabourCostDelta(e.target.value)}
                className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text font-mono`}
                data-testid="input-co-labour-cost-delta"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase text-text-mute">
                Δ Expenses USD
              </label>
              <input
                type="number"
                value={expensesDelta}
                onChange={(e) => setExpensesDelta(e.target.value)}
                className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text font-mono`}
                data-testid="input-co-expenses-delta"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase text-text-mute">
                Δ Subs USD
              </label>
              <input
                type="number"
                value={subsDelta}
                onChange={(e) => setSubsDelta(e.target.value)}
                className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text font-mono`}
                data-testid="input-co-subs-delta"
              />
            </div>
          </div>
        </div>
      )}
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
      <EffortDeltasInline co={co} />
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

/**
 * Task #455 — small inline strip showing the first-class scope/effort
 * deltas for a change order. Hidden when the persona can't see them
 * (server returns null) or when nothing has been entered.
 */
function EffortDeltasInline({ co }: { co: ChangeOrder }) {
  const hours = co.labourHoursDelta;
  const labour = co.labourCostDeltaUsd;
  const exp = co.expensesDeltaUsd;
  const subs = co.subsDeltaUsd;
  if (hours == null && labour == null && exp == null && subs == null) {
    return null;
  }
  const visible: Array<{ key: string; label: string; value: string; tone: string }> = [];
  const toneFor = (n: number) =>
    n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-text-faint";
  const fmtUsd = (n: number) =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
  const fmtHrs = (n: number) =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString()}h`;
  if (hours != null && hours !== 0)
    visible.push({ key: "hours", label: "labour", value: fmtHrs(hours), tone: toneFor(hours) });
  if (labour != null && labour !== 0)
    visible.push({ key: "labour", label: "labour $", value: fmtUsd(labour), tone: toneFor(labour) });
  if (exp != null && exp !== 0)
    visible.push({ key: "exp", label: "expenses", value: fmtUsd(exp), tone: toneFor(exp) });
  if (subs != null && subs !== 0)
    visible.push({ key: "subs", label: "subs", value: fmtUsd(subs), tone: toneFor(subs) });
  if (visible.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono"
      data-testid={`co-effort-deltas-${co.id}`}
    >
      {visible.map((v) => (
        <span key={v.key} className="inline-flex items-center gap-1">
          <span className="text-text-faint uppercase tracking-wider">Δ {v.label}</span>
          <span className={v.tone}>{v.value}</span>
        </span>
      ))}
    </div>
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
    <div className="rounded-md border border-border-soft glass-surface p-3 space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Client signer name"
        className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text`}
        data-testid="input-co-signer-name"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="signer@client.com"
        className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text font-mono`}
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
    <div className="rounded-md border border-border-soft glass-surface p-3 space-y-2">
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
          className={`${fieldControlCls} bg-bg-deep border border-border rounded-md text-sm text-text font-mono`}
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
