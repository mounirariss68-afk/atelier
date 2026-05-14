import * as React from "react";
import {
  useAtelierGetProposal,
  useAtelierComposeProposal,
  useAtelierApproveProposalSection,
  useAtelierEditProposalSection,
  useAtelierRejectProposalSection,
  useAtelierConfirmSectionAssignments,
  useAtelierPartnerFinalRead,
  useAtelierApproveProposalPricing,
  useAtelierOverrideProposalPricing,
  useAtelierSendProposal,
  useAtelierGetMe,
  getAtelierGetProposalQueryKey,
  type AtelierProposalDetail,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, DollarSign, ShieldCheck } from "lucide-react";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "default"> = {
  green: "green",
  amber: "amber",
  red: "red",
  approved: "green",
  draft: "default",
};

export function ProposalTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useAtelierGetProposal(oppId, {
    query: { enabled: !!oppId, retry: false, queryKey: getAtelierGetProposalQueryKey(oppId) },
  });
  const compose = useAtelierComposeProposal({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const approve = useAtelierApproveProposalSection({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const editSection = useAtelierEditProposalSection({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const rejectSection = useAtelierRejectProposalSection({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const confirmAssignments = useAtelierConfirmSectionAssignments({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }) },
  });
  const finalRead = useAtelierPartnerFinalRead({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }) },
  });
  const [openSectionId, setOpenSectionId] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [showSheet, setShowSheet] = React.useState(false);
  const [sheetTitle, setSheetTitle] = React.useState("");
  const [sheetDeadline, setSheetDeadline] = React.useState("");
  const [sheetMargin, setSheetMargin] = React.useState("45");
  const [sheetWeeks, setSheetWeeks] = React.useState("12");
  // Task #297 — 15-section spine. Cover + Company Profile + Annexes + Appendices added.
  const [sheetSections, setSheetSections] = React.useState<string[]>([
    "cover","exec_summary","context","hypothesis","approach","workplan","team","pricing",
    "case_studies","company_profile","value_case","terms","compliance","annexes","appendices",
  ]);
  const [sheetTeam, setSheetTeam] = React.useState("partner:15,lead:80,consultant:60,consultant:80");
  const [sheetRfpName, setSheetRfpName] = React.useState<string | null>(null);
  const ALL_SECTIONS = [
    "cover","exec_summary","context","hypothesis","approach","workplan","team","pricing",
    "case_studies","company_profile","value_case","terms","compliance","annexes","appendices",
  ] as const;
  // Task #297 — top-level workspace tab (workspace | preview | recipients).
  const [view, setView] = React.useState<"workspace" | "preview" | "recipients">("workspace");
  const approvePricing = useAtelierApproveProposalPricing({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const overridePricing = useAtelierOverrideProposalPricing({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const { data: me } = useAtelierGetMe();
  const send = useAtelierSendProposal({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const [sendError, setSendError] = React.useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  const detail = data as AtelierProposalDetail | undefined;

  function parseTeam(s: string): { role: string; alloc: number }[] {
    return s.split(",").map((p) => {
      const [role, alloc] = p.split(":").map((x) => x.trim());
      const n = Number(alloc);
      return { role: role || "lead", alloc: Number.isFinite(n) ? n : 50 };
    }).filter((r) => r.role);
  }
  function buildComposeBody() {
    const body: Record<string, unknown> = {
      sectionsRequired: sheetSections,
      pricingIntent: { targetMarginPct: Number(sheetMargin) || 45, durationWeeks: Number(sheetWeeks) || 12 },
      teamProposed: parseTeam(sheetTeam),
    };
    if (sheetTitle.trim()) body.title = sheetTitle.trim();
    if (sheetDeadline) body.deadlineAt = new Date(sheetDeadline).toISOString();
    if (sheetRfpName) body.rfpFileName = sheetRfpName;
    return body;
  }
  function PromptSheet({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: () => void }) {
    return (
      <Card className="p-4 space-y-3" data-testid="proposal-prompt-sheet">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">PromptSheet</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input data-testid="input-prompt-title" placeholder="Proposal title (optional)"
            value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)}
            className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text" />
          <input data-testid="input-prompt-deadline" type="date"
            value={sheetDeadline} onChange={(e) => setSheetDeadline(e.target.value)}
            className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text" />
          <input data-testid="input-prompt-margin" type="number" min={0} max={100}
            placeholder="Target margin %" value={sheetMargin}
            onChange={(e) => setSheetMargin(e.target.value)}
            className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text" />
          <input data-testid="input-prompt-weeks" type="number" min={1} max={104}
            placeholder="Duration weeks" value={sheetWeeks}
            onChange={(e) => setSheetWeeks(e.target.value)}
            className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text" />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-mono uppercase text-text-mute">Sections</div>
          <div className="flex flex-wrap gap-2">
            {ALL_SECTIONS.map((sid) => {
              const active = sheetSections.includes(sid);
              return (
                <button key={sid} type="button" data-testid={`chip-section-${sid}`}
                  onClick={() => setSheetSections((s) => active ? s.filter((x) => x !== sid) : [...s, sid])}
                  className={`px-2 py-1 rounded text-[11px] font-mono border ${active ? "bg-gold/15 text-gold border-gold/40" : "bg-bg-deep text-text-mute border-border-soft"}`}>
                  {sid}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-mono uppercase text-text-mute">Team allocation (role:percent, comma-separated)</div>
          <input data-testid="input-prompt-team" value={sheetTeam}
            onChange={(e) => setSheetTeam(e.target.value)}
            className="w-full rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text font-mono" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[11px] text-text-mute">RFP file (optional, name only):</label>
          <input type="file" data-testid="input-prompt-rfp"
            onChange={(e) => setSheetRfpName(e.target.files?.[0]?.name ?? null)}
            className="text-xs text-text-mute" />
          {sheetRfpName && <span className="text-[11px] font-mono text-text">{sheetRfpName}</span>}
        </div>
        <div className="flex justify-end">
          <PillButton variant="primary" data-testid="button-prompt-submit"
            onClick={onSubmit} disabled={compose.isPending || sheetSections.length === 0}>
            {compose.isPending ? "Composing…" : submitLabel}
          </PillButton>
        </div>
      </Card>
    );
  }

  if (isError || !detail) {
    return (
      <div className="space-y-4">
        <Card className="p-8 text-center border-dashed bg-bg-deep" data-testid="empty-proposal">
          <FileText className="w-6 h-6 text-gold/60 mx-auto mb-2" />
          <p className="text-text-mute text-sm mb-4">No proposal composed yet — fill the PromptSheet below.</p>
        </Card>
        <PromptSheet submitLabel="Compose proposal"
          onSubmit={() => compose.mutate({ oppId, data: buildComposeBody() })} />
      </div>
    );
  }

  const { proposal, sections } = detail;
  const pricing = proposal.pricingModel as
    | { totalRevenueUsd: number; totalCostUsd: number; marginPct: number; verdict: string }
    | undefined;
  const pricingIntentRaw = (proposal.pricingIntent ?? {}) as {
    pricingApprovedAt?: string;
    pricingOverrideAt?: string;
    pricingOverrideByName?: string;
    pricingOverrideRationale?: string;
  };
  const pricingApprovedAt = pricingIntentRaw.pricingApprovedAt;
  const pricingOverrideAt = pricingIntentRaw.pricingOverrideAt;
  const sheetExtras = pricingIntentRaw as unknown as {
    sectionAssignmentsConfirmedAt?: string;
    sectionAssignmentsConfirmedByName?: string;
    partnerFinalReadAt?: string;
    partnerFinalReadByName?: string;
    deadlineAt?: string;
    rfpFileName?: string;
  };
  const assignmentsConfirmedAt = sheetExtras.sectionAssignmentsConfirmedAt;
  const partnerFinalReadAt = sheetExtras.partnerFinalReadAt;
  const isPartner = (me?.role === "partner" || me?.role === "founding_partner");
  const pricingNeedsOverride = pricing?.verdict === "partner_override_required";
  const pricingCheckpointMet = pricingNeedsOverride ? !!pricingOverrideAt : !!pricingApprovedAt;
  const matrix = (proposal.complianceMatrix ?? []) as { rfpReqId: string; requirement: string; status: string; evidence: string }[];

  return (
    <div className="space-y-5" data-testid="tab-proposal-content">
      {/* Task #297 — Workspace / Live preview / Recipients top-tab. */}
      <div className="flex items-center gap-1 text-xs font-mono uppercase tracking-wide" data-testid="proposal-view-tabs">
        {(["workspace", "preview", "recipients"] as const).map((v) => (
          <button
            key={v}
            data-testid={`proposal-view-${v}`}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded border ${view === v ? "border-text bg-bg-elevate text-text" : "border-border-soft text-text-mute hover:border-text-mute"}`}
          >{v === "workspace" ? "Workspace" : v === "preview" ? "Live preview" : "Recipients"}</button>
        ))}
      </div>
      {view === "preview" ? (
        <ProposalLivePreview proposalId={proposal.id} />
      ) : view === "recipients" ? (
        <ProposalRecipients proposalId={proposal.id} />
      ) : null}
      {view !== "workspace" ? null : showSheet && (
        <PromptSheet submitLabel="Recompose with these inputs"
          onSubmit={() => compose.mutate({ oppId, data: buildComposeBody() })} />
      )}
      {view !== "workspace" ? null : (
      <>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Proposal</div>
            <div className="font-medium text-text">{proposal.title}</div>
          </div>
          <div className="flex items-center gap-2">
            <PillButton
              variant="ghost"
              data-testid="button-toggle-prompt-sheet"
              onClick={() => setShowSheet((v) => !v)}
            >
              {showSheet ? "Hide PromptSheet" : "Edit PromptSheet"}
            </PillButton>
            <PillButton
              variant="ghost"
              data-testid="button-recompose-proposal"
              onClick={() => compose.mutate({ oppId, data: buildComposeBody() })}
              disabled={compose.isPending}
            >
              {compose.isPending ? "Recomposing…" : "Recompose"}
            </PillButton>
            <PillButton
              variant={assignmentsConfirmedAt ? "ghost" : "primary"}
              data-testid="button-confirm-assignments"
              onClick={() => confirmAssignments.mutate({ proposalId: proposal.id })}
              disabled={confirmAssignments.isPending || !!assignmentsConfirmedAt}
              title={assignmentsConfirmedAt
                ? `Locked by ${sheetExtras.sectionAssignmentsConfirmedByName ?? "lead"}`
                : "Lead/partner confirms section ownership before send"}
            >
              {assignmentsConfirmedAt ? "Assignments locked"
                : confirmAssignments.isPending ? "Locking…" : "Confirm assignments"}
            </PillButton>
            <PillButton
              variant={partnerFinalReadAt ? "ghost" : "primary"}
              data-testid="button-partner-final-read"
              onClick={() => finalRead.mutate({ proposalId: proposal.id })}
              disabled={!isPartner || finalRead.isPending || !!partnerFinalReadAt}
              title={!isPartner ? "Partner-only checkpoint"
                : partnerFinalReadAt ? `Read recorded by ${sheetExtras.partnerFinalReadByName ?? "partner"}`
                : "Partner records final read of assembled proposal"}
            >
              {partnerFinalReadAt ? "Final read recorded"
                : finalRead.isPending ? "Recording…" : "Final partner read"}
            </PillButton>
            {pricingNeedsOverride ? (
              <PillButton
                variant={pricingOverrideAt ? "ghost" : "primary"}
                data-testid="button-override-pricing"
                onClick={() => {
                  if (pricingOverrideAt) return;
                  const rationale = window.prompt(
                    "Margin is below target. Enter partner-override rationale (≥10 chars):",
                  );
                  if (!rationale || rationale.trim().length < 10) return;
                  overridePricing.mutate({ proposalId: proposal.id, data: { rationale: rationale.trim() } });
                }}
                disabled={!isPartner || overridePricing.isPending || !!pricingOverrideAt}
                title={
                  !isPartner ? "Partner-only override"
                  : pricingOverrideAt ? `Overridden by ${pricingIntentRaw.pricingOverrideByName ?? "partner"} — ${pricingIntentRaw.pricingOverrideRationale ?? ""}`
                  : "Margin below target — record partner override"
                }
              >
                {pricingOverrideAt ? "Pricing overridden" :
                  overridePricing.isPending ? "Recording…" : "Override pricing"}
              </PillButton>
            ) : (
              <PillButton
                variant={pricingApprovedAt ? "ghost" : "primary"}
                data-testid="button-approve-pricing"
                onClick={() => approvePricing.mutate({ proposalId: proposal.id })}
                disabled={!isPartner || approvePricing.isPending || !!pricingApprovedAt}
                title={
                  !isPartner ? "Partner-only checkpoint"
                  : pricingApprovedAt ? `Approved ${new Date(pricingApprovedAt).toLocaleString()}`
                  : "Approve pricing before sending"
                }
              >
                {pricingApprovedAt ? "Pricing approved" :
                  approvePricing.isPending ? "Approving…" : "Approve pricing"}
              </PillButton>
            )}
            <PillButton
              variant="primary"
              data-testid="button-send-proposal"
              onClick={() => {
                setSendError(null);
                send.mutate(
                  { proposalId: proposal.id },
                  {
                    onError: async (err: unknown) => {
                      const e = err as { response?: { json?: () => Promise<{ error?: string }> } };
                      try {
                        const body = await e.response?.json?.();
                        setSendError(body?.error ?? "send-failed");
                      } catch {
                        setSendError("send-failed");
                      }
                    },
                  },
                );
              }}
              disabled={send.isPending || proposal.status === "sent"}
            >
              {proposal.status === "sent" ? "Sent" : send.isPending ? "Sending…" : "Send to client"}
            </PillButton>
          </div>
        </div>
        {sendError && (
          <div className="text-xs text-danger font-mono" data-testid="send-error">
            Cannot send: {sendError}
          </div>
        )}
        {(proposal.winThemes ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {(proposal.winThemes ?? []).map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-gold/10 text-gold border border-gold/30">
                {t}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Sections</div>
        <div className="space-y-2">
          {sections.map((s) => {
            const isOpen = openSectionId === s.id;
            const draft = drafts[s.id] ?? (s.content ?? "");
            const lastReject = ((s.citations as unknown as { kind?: string; reason?: string; by?: string }[] | null) ?? [])
              .filter((c) => c?.kind === "rejection").slice(-1)[0];
            return (
              <div
                key={s.id}
                className="py-2 border-b border-border-soft last:border-b-0"
                data-testid={`proposal-section-${s.sectionId}`}
              >
                <div className="flex items-center gap-3">
                  <MonoChip tone={s.status === "rejected" ? "red" : (STATUS_TONE[s.status] ?? "default")}>
                    {s.status}
                  </MonoChip>
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    data-testid={`button-open-section-${s.sectionId}`}
                    onClick={() => setOpenSectionId(isOpen ? null : s.id)}
                  >
                    <div className="text-sm text-text">{s.name}</div>
                    <div className="text-[11px] text-text-mute font-mono">
                      owner: {s.ownerAgent}{isOpen ? " · close" : " · open drafting workspace"}
                    </div>
                  </button>
                  {s.status !== "approved" && (
                    <PillButton
                      variant="ghost"
                      data-testid={`button-approve-section-${s.sectionId}`}
                      onClick={() => approve.mutate({ sectionId: s.id })}
                      disabled={approve.isPending}
                    >
                      Approve
                    </PillButton>
                  )}
                </div>
                {lastReject?.reason && !isOpen && (
                  <div className="ml-[3.25rem] mt-1 text-[11px] text-danger font-mono">
                    rejected: {lastReject.reason}{lastReject.by ? ` — ${lastReject.by}` : ""}
                  </div>
                )}
                {isOpen && (
                  <div className="ml-[3.25rem] mt-2 space-y-2" data-testid={`workspace-section-${s.sectionId}`}>
                    <textarea
                      className="w-full min-h-[140px] text-sm bg-bg-deep border border-border-soft rounded p-2 text-text font-mono"
                      value={draft}
                      data-testid={`textarea-section-${s.sectionId}`}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <PillButton
                        variant="primary"
                        data-testid={`button-save-section-${s.sectionId}`}
                        onClick={() =>
                          editSection.mutate(
                            { sectionId: s.id, data: { content: draft } },
                            { onSuccess: () => setDrafts((d) => { const n = { ...d }; delete n[s.id]; return n; }) },
                          )
                        }
                        disabled={editSection.isPending || draft.trim().length < 1 || draft === (s.content ?? "")}
                        title="Saving an edit resets the section to draft"
                      >
                        {editSection.isPending ? "Saving…" : "Save edit"}
                      </PillButton>
                      <PillButton
                        variant="ghost"
                        data-testid={`button-reject-section-${s.sectionId}`}
                        onClick={() => {
                          const reason = window.prompt("Reject reason (≥5 chars):");
                          if (!reason || reason.trim().length < 5) return;
                          rejectSection.mutate({ sectionId: s.id, data: { reason: reason.trim() } });
                        }}
                        disabled={rejectSection.isPending}
                      >
                        {rejectSection.isPending ? "Rejecting…" : "Reject"}
                      </PillButton>
                      {lastReject?.reason && (
                        <span className="text-[11px] text-danger font-mono self-center">
                          last reject: {lastReject.reason}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {pricing && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-text-mute">
            <DollarSign className="w-3 h-3" /> Pricing
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span>Revenue: <span className="text-text font-medium">${Math.round(pricing.totalRevenueUsd).toLocaleString()}</span></span>
            <span>Cost: <span className="text-text font-medium">${Math.round(pricing.totalCostUsd).toLocaleString()}</span></span>
            <span>Margin: <span className="text-text font-medium">{pricing.marginPct}%</span></span>
            <MonoChip
              tone={
                pricing.verdict === "green"
                  ? "green"
                  : pricing.verdict === "amber"
                    ? "amber"
                    : "red"
              }
            >
              {pricing.verdict}
            </MonoChip>
          </div>
        </Card>
      )}

      {matrix.length > 0 && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-text-mute">
            <ShieldCheck className="w-3 h-3" /> Compliance matrix
          </div>
          <div className="space-y-1">
            {matrix.map((r) => (
              <div key={r.rfpReqId} className="flex items-center gap-3 text-xs">
                <MonoChip tone={r.status === "green" ? "green" : "red"}>{r.status}</MonoChip>
                <span className="font-mono text-text-mute">{r.rfpReqId}</span>
                <span className="text-text">{r.requirement}</span>
                <span className="text-text-faint ml-auto truncate max-w-md">{r.evidence}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      </>
      )}
    </div>
  );
}

// =============================================================
// Task #297 — Live preview iframe + recipient share-link manager.
// Use raw fetch (no codegen) for the new endpoints.
// =============================================================
const ATELIER_API = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}api/atelier`;

function ProposalLivePreview({ proposalId }: { proposalId: string }) {
  // Bust the iframe cache when the proposal id (or a manual refresh) changes.
  const [tick, setTick] = React.useState(0);
  const src = `${ATELIER_API}/proposals/${proposalId}/preview-html?t=${tick}`;
  return (
    <Card className="p-3 space-y-2" data-testid="proposal-live-preview">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Live preview</div>
        <PillButton variant="ghost" data-testid="refresh-preview" onClick={() => setTick((x) => x + 1)}>Refresh</PillButton>
      </div>
      <div className="rounded border border-border-soft overflow-hidden bg-white" style={{ height: "75vh" }}>
        <iframe
          key={tick}
          src={src}
          title="Proposal live preview"
          className="w-full h-full"
          data-testid="proposal-preview-iframe"
        />
      </div>
    </Card>
  );
}

interface RecipientWire {
  id: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientOrg: string | null;
  shareUrl: string;
  expiresAt: string | null;
  revokedAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
}

function ProposalRecipients({ proposalId }: { proposalId: string }) {
  const [rows, setRows] = React.useState<RecipientWire[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [org, setOrg] = React.useState("");
  const [expiry, setExpiry] = React.useState("30");
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch(`${ATELIER_API}/proposals/${proposalId}/recipients`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { recipients: RecipientWire[] };
      setRows(j.recipients);
    } catch (e) { setErr((e as Error).message); }
  }, [proposalId]);

  React.useEffect(() => { reload(); }, [reload]);

  async function add() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${ATELIER_API}/proposals/${proposalId}/recipients`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: name.trim(),
          recipientEmail: email.trim() || undefined,
          recipientOrg: org.trim() || undefined,
          expiresInDays: Number(expiry) || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setName(""); setEmail(""); setOrg("");
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${ATELIER_API}/proposal-recipients/${id}/revoke`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-3" data-testid="proposal-recipients">
      <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Recipients</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text"
          placeholder="Recipient name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-recipient-name" />
        <input className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text"
          placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-recipient-email" />
        <input className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text"
          placeholder="Org (optional)" value={org} onChange={(e) => setOrg(e.target.value)} data-testid="input-recipient-org" />
        <div className="flex items-center gap-2">
          <input className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text w-20"
            placeholder="days" value={expiry} onChange={(e) => setExpiry(e.target.value)} data-testid="input-recipient-expiry" />
          <PillButton onClick={add} disabled={busy || !name.trim()} data-testid="add-recipient">
            {busy ? "Adding…" : "Add"}
          </PillButton>
        </div>
      </div>
      {err ? <div className="text-sm text-red-400">{err}</div> : null}
      {!rows ? <div className="text-sm text-text-mute">Loading…</div> : rows.length === 0 ? (
        <div className="text-sm text-text-mute">No share links yet — add a recipient to mint one.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-text-mute">
            <tr>
              <th className="text-left py-1">Recipient</th>
              <th className="text-left py-1">Share URL</th>
              <th className="text-left py-1">Opens</th>
              <th className="text-left py-1">Last opened</th>
              <th className="text-left py-1">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border-soft" data-testid={`recipient-row-${r.id}`}>
                <td className="py-1">
                  <div className="text-text">{r.recipientName}</div>
                  <div className="text-xs text-text-mute">{[r.recipientOrg, r.recipientEmail].filter(Boolean).join(" · ") || "—"}</div>
                </td>
                <td className="py-1">
                  <a className="text-xs underline text-text" href={`${r.shareUrl}/html`} target="_blank" rel="noreferrer" data-testid={`open-recipient-${r.id}`}>{r.shareUrl}</a>
                </td>
                <td className="py-1">{r.openCount}</td>
                <td className="py-1 text-text-mute">{r.lastOpenedAt ? new Date(r.lastOpenedAt).toLocaleString() : "—"}</td>
                <td className="py-1"><MonoChip>{r.revokedAt ? "revoked" : r.expiresAt && new Date(r.expiresAt).getTime() < Date.now() ? "expired" : "active"}</MonoChip></td>
                <td className="py-1">
                  {!r.revokedAt ? (
                    <button onClick={() => revoke(r.id)} disabled={busy} className="text-xs underline text-text-mute" data-testid={`revoke-recipient-${r.id}`}>Revoke</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
