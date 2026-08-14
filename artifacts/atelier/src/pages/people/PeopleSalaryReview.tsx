/**
 * PeopleSalaryReview — Task #1137: HR/Finance review of contract salary
 * proposals.
 *
 * Hosted as a sub-tab of People › Reward (the comp-viewer set:
 * founding_partner | hr | finance — same gate as the rest of Reward and the
 * payroll editor). Renders the pending review queue, plus tabs for
 * processing/failed (with a re-run action via the contract's salary-extract)
 * and history (approved/rejected).
 *
 * Each pending proposal shows a side-by-side Extracted-vs-Current table for
 * the four comp fields + effective date, the verbatim source snippet per
 * field, a source badge (template field values vs AI text), and Approve
 * (with inline editable overrides prefilled from the extracted figures) and
 * Reject (optional note) actions. Everything goes through the codegen'd
 * react-query hooks.
 */
import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListSalaryProposals,
  getAtelierListSalaryProposalsQueryKey,
  useAtelierApproveSalaryProposal,
  useAtelierRejectSalaryProposal,
  useAtelierExtractContractSalary,
  type AtelierSalaryProposal,
  type AtelierSalaryProposalApprove,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const COMP_FIELDS = [
  { key: "baseCompensation", label: "Annual base compensation" },
  { key: "basicWageMonthly", label: "Basic wage (monthly)" },
  { key: "housingAllowanceMonthly", label: "Housing allowance (monthly)" },
] as const;

const FILTERS = [
  { id: "pending", label: "Pending review" },
  { id: "processing", label: "Processing / failed" },
  { id: "history", label: "History" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function fmtAmount(n: number | null | undefined): string {
  return n != null ? n.toLocaleString() : "—";
}

function sourceBadge(source: AtelierSalaryProposal["source"]) {
  if (source === "field_values")
    return <MonoChip tone="green">template fields</MonoChip>;
  if (source === "llm_text") return <MonoChip tone="amber">AI text</MonoChip>;
  return null;
}

export function SalaryReviewView() {
  const [filter, setFilter] = React.useState<FilterId>("pending");

  return (
    <div className="space-y-4" data-testid="people-salary-review">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              "rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors " +
              (filter === f.id
                ? "bg-gold text-black"
                : "border border-border-soft text-text-mute hover:text-text")
            }
            data-testid={`salary-filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {filter === "pending" && <PendingQueue />}
      {filter === "processing" && <ProcessingQueue />}
      {filter === "history" && <HistoryList />}
    </div>
  );
}

function PendingQueue() {
  const { data, isLoading } = useAtelierListSalaryProposals({ status: "pending" });
  const rows = data?.proposals ?? [];

  if (isLoading) {
    return <Card className="p-6 text-sm text-text-faint">Loading proposals…</Card>;
  }
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="salary-pending-empty">
        No salary proposals awaiting review. Digitize a signed employment
        contract from its contract page to create one.
      </Card>
    );
  }
  return (
    <div className="space-y-3" data-testid="salary-pending-queue">
      {rows.map((p) => (
        <PendingCard key={p.id} proposal={p} />
      ))}
    </div>
  );
}

function PendingCard({ proposal }: { proposal: AtelierSalaryProposal }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const extracted = proposal.extracted ?? null;
  const current = proposal.current ?? null;
  const snippets = proposal.snippets ?? {};

  // Inline editable overrides, prefilled from the extracted figures. We keep
  // the original prefill so that on approve we only send fields the reviewer
  // actually edited — absent fields let the server fall back to the extracted
  // value (partial-patch semantics), and we NEVER send an implicit null that
  // would clear an existing payroll value.
  const prefill = React.useMemo(
    () => ({
      baseCompensation:
        extracted?.baseCompensation != null ? String(extracted.baseCompensation) : "",
      baseCurrency: extracted?.baseCurrency ?? "",
      basicWageMonthly:
        extracted?.basicWageMonthly != null ? String(extracted.basicWageMonthly) : "",
      housingAllowanceMonthly:
        extracted?.housingAllowanceMonthly != null
          ? String(extracted.housingAllowanceMonthly)
          : "",
    }),
    [extracted],
  );
  const [overrides, setOverrides] = React.useState(prefill);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListSalaryProposalsQueryKey() });

  const approve = useAtelierApproveSalaryProposal({
    mutation: {
      onSuccess: () => {
        toast({ title: "Salary applied", description: `Comp updated for ${proposal.personName ?? "the employee"}.` });
        invalidate();
      },
      onError: (err: unknown) => {
        const e = err as { data?: { message?: string; error?: string } };
        setError(e.data?.message ?? e.data?.error ?? "Could not apply this proposal.");
      },
    },
  });
  const reject = useAtelierRejectSalaryProposal({
    mutation: {
      onSuccess: () => {
        toast({ title: "Proposal rejected" });
        invalidate();
      },
      onError: (err: unknown) => {
        const e = err as { data?: { message?: string; error?: string } };
        setError(e.data?.message ?? e.data?.error ?? "Could not reject this proposal.");
      },
    },
  });

  const busy = approve.isPending || reject.isPending;

  const onApprove = () => {
    setError(null);
    // Partial-patch: only send a field when the reviewer actually changed it
    // from the extracted prefill. Untouched fields are left OUT so the server
    // falls back to the extracted value. A field the reviewer deliberately
    // BLANKED (had a prefill, now empty) is a deliberate clear → explicit null.
    const body: AtelierSalaryProposalApprove = {};

    // Numeric comp fields.
    const numFields: Array<
      ["baseCompensation" | "basicWageMonthly" | "housingAllowanceMonthly", string]
    > = [
      ["baseCompensation", "Annual base compensation"],
      ["basicWageMonthly", "Basic wage"],
      ["housingAllowanceMonthly", "Housing allowance"],
    ];
    for (const [key, label] of numFields) {
      const cur = overrides[key].trim();
      if (cur === prefill[key].trim()) continue; // untouched → omit
      if (!cur) {
        body[key] = null; // deliberately cleared
        continue;
      }
      const n = Number(cur.replace(/,/g, ""));
      if (!Number.isFinite(n)) return setError(`${label} must be a number.`);
      body[key] = n;
    }

    // Base currency.
    if (overrides.baseCurrency.trim() !== prefill.baseCurrency.trim()) {
      const cur = overrides.baseCurrency.trim().toUpperCase();
      if (!cur) {
        body.baseCurrency = null; // deliberately cleared
      } else {
        if (!/^[A-Z]{3}$/.test(cur))
          return setError("Base currency must be a 3-letter code (e.g. AED).");
        body.baseCurrency = cur;
      }
    }

    if (note.trim()) body.decisionNote = note.trim();
    approve.mutate({ id: proposal.id, data: body });
  };

  const setOv = (patch: Partial<typeof overrides>) =>
    setOverrides((o) => ({ ...o, ...patch }));

  return (
    <Card className="p-4 space-y-3" data-testid={`salary-proposal-${proposal.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-text">{proposal.personName ?? "Unknown person"}</span>
            {proposal.personStatus && <MonoChip>{proposal.personStatus}</MonoChip>}
            {sourceBadge(proposal.source)}
          </div>
          <p className="mt-1 text-xs text-text-mute">
            From{" "}
            <Link href={`/contracts/${proposal.contractId}`} className="text-gold hover:underline">
              {proposal.contractTitle ?? "contract"}
            </Link>
            {proposal.contractType ? ` · ${proposal.contractType.replace(/_/g, " ")}` : ""}
            {extracted?.effectiveDate ? ` · effective ${extracted.effectiveDate}` : ""}
          </p>
        </div>
      </div>

      {/* Side-by-side Extracted vs Current + effective date */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid={`salary-compare-${proposal.id}`}>
          <thead>
            <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-text-faint">
              <th className="py-1 pr-3 font-normal">Field</th>
              <th className="py-1 pr-3 font-normal">Current</th>
              <th className="py-1 pr-3 font-normal">Extracted</th>
              <th className="py-1 font-normal">Source snippet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {COMP_FIELDS.map((f) => {
              const snip = snippets[f.key];
              const cur = current?.[f.key];
              const ext = extracted?.[f.key];
              const changed = ext != null && ext !== cur;
              return (
                <tr key={f.key}>
                  <td className="py-1.5 pr-3 text-text-mute align-top">{f.label}</td>
                  <td className="py-1.5 pr-3 text-text align-top font-mono">{fmtAmount(cur)}</td>
                  <td className={"py-1.5 pr-3 align-top font-mono " + (changed ? "text-gold" : "text-text")}>
                    {fmtAmount(ext)}
                  </td>
                  <td className="py-1.5 align-top text-text-mute">
                    {snip ? (
                      <span title={snip.attribution}>“{snip.snippet}”</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className="py-1.5 pr-3 text-text-mute align-top">Base currency</td>
              <td className="py-1.5 pr-3 text-text align-top font-mono">{current?.baseCurrency ?? "—"}</td>
              <td className="py-1.5 pr-3 text-text align-top font-mono">{extracted?.baseCurrency ?? "—"}</td>
              <td className="py-1.5" />
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-text-mute align-top">Effective date</td>
              <td className="py-1.5 pr-3 text-text-faint align-top">—</td>
              <td className="py-1.5 pr-3 text-text align-top font-mono">{extracted?.effectiveDate ?? "—"}</td>
              <td className="py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Inline editable overrides, prefilled from extracted */}
      <div className="rounded border border-border-soft p-3 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-mute">
          Apply these values (editable — prefilled from the extracted figures)
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Annual base compensation</span>
            <Input value={overrides.baseCompensation} inputMode="decimal"
              onChange={(e) => setOv({ baseCompensation: e.target.value })}
              data-testid={`salary-ov-basecomp-${proposal.id}`} />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Base currency</span>
            <Input value={overrides.baseCurrency} maxLength={3} placeholder="AED"
              onChange={(e) => setOv({ baseCurrency: e.target.value.toUpperCase() })}
              data-testid={`salary-ov-currency-${proposal.id}`} />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Basic wage (monthly)</span>
            <Input value={overrides.basicWageMonthly} inputMode="decimal"
              onChange={(e) => setOv({ basicWageMonthly: e.target.value })}
              data-testid={`salary-ov-basicwage-${proposal.id}`} />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Housing allowance (monthly)</span>
            <Input value={overrides.housingAllowanceMonthly} inputMode="decimal"
              onChange={(e) => setOv({ housingAllowanceMonthly: e.target.value })}
              data-testid={`salary-ov-housing-${proposal.id}`} />
          </label>
        </div>
        <Input value={note} placeholder="Decision note (optional)"
          onChange={(e) => setNote(e.target.value)}
          data-testid={`salary-note-${proposal.id}`} />
        {error && <p className="text-xs text-red-400" data-testid={`salary-error-${proposal.id}`}>{error}</p>}
        <div className="flex items-center gap-2">
          <button
            className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            onClick={onApprove}
            disabled={busy}
            data-testid={`salary-approve-${proposal.id}`}
          >
            {approve.isPending ? "Applying…" : "Approve & apply"}
          </button>
          <button
            className="text-xs text-text-mute hover:text-text disabled:opacity-50"
            onClick={() => {
              setError(null);
              reject.mutate({ id: proposal.id, data: note.trim() ? { note: note.trim() } : {} });
            }}
            disabled={busy}
            data-testid={`salary-reject-${proposal.id}`}
          >
            Reject
          </button>
        </div>
      </div>
    </Card>
  );
}

function ProcessingQueue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const processing = useAtelierListSalaryProposals({ status: "processing" });
  const failed = useAtelierListSalaryProposals({ status: "failed" });
  const rows = [
    ...(processing.data?.proposals ?? []),
    ...(failed.data?.proposals ?? []),
  ];

  const rerun = useAtelierExtractContractSalary({
    mutation: {
      onSuccess: () => {
        toast({ title: "Re-run started", description: "Extraction is running again — refresh in a moment." });
        void qc.invalidateQueries({ queryKey: getAtelierListSalaryProposalsQueryKey() });
      },
      onError: (err: unknown) => {
        const e = err as { status?: number; data?: { message?: string; error?: string } };
        toast({
          title: "Could not re-run",
          description:
            e.status === 409
              ? e.data?.message ?? "A live proposal already exists or the contract is no longer eligible."
              : e.data?.message ?? e.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  if (processing.isLoading || failed.isLoading) {
    return <Card className="p-6 text-sm text-text-faint">Loading…</Card>;
  }
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="salary-processing-empty">
        Nothing processing or failed right now.
      </Card>
    );
  }
  return (
    <div className="space-y-2" data-testid="salary-processing-queue">
      {rows.map((p) => (
        <Card key={p.id} className="p-4" data-testid={`salary-proc-${p.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-text">{p.personName ?? "Unknown person"}</span>
                <MonoChip tone={p.status === "failed" ? "red" : "amber"}>{p.status}</MonoChip>
              </div>
              <p className="mt-1 text-xs text-text-mute">
                From{" "}
                <Link href={`/contracts/${p.contractId}`} className="text-gold hover:underline">
                  {p.contractTitle ?? "contract"}
                </Link>
              </p>
              {p.status === "failed" && p.error && (
                <p className="mt-1 text-xs text-red-400" data-testid={`salary-proc-error-${p.id}`}>{p.error}</p>
              )}
            </div>
            {p.status === "failed" && (
              <button
                className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                onClick={() => rerun.mutate({ id: p.contractId })}
                disabled={rerun.isPending}
                data-testid={`salary-rerun-${p.id}`}
              >
                {rerun.isPending ? "Re-running…" : "Re-run extraction"}
              </button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function HistoryList() {
  const approved = useAtelierListSalaryProposals({ status: "approved" });
  const rejected = useAtelierListSalaryProposals({ status: "rejected" });
  const rows = [
    ...(approved.data?.proposals ?? []),
    ...(rejected.data?.proposals ?? []),
  ].sort((a, b) => (a.decidedAt && b.decidedAt ? b.decidedAt.localeCompare(a.decidedAt) : 0));

  if (approved.isLoading || rejected.isLoading) {
    return <Card className="p-6 text-sm text-text-faint">Loading…</Card>;
  }
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="salary-history-empty">
        No approved or rejected proposals yet.
      </Card>
    );
  }
  return (
    <div className="space-y-2" data-testid="salary-history">
      {rows.map((p) => (
        <Card key={p.id} className="p-4" data-testid={`salary-hist-${p.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-text">{p.personName ?? "Unknown person"}</span>
                <MonoChip tone={p.status === "approved" ? "green" : "default"}>{p.status}</MonoChip>
              </div>
              <p className="mt-1 text-xs text-text-mute">
                From{" "}
                <Link href={`/contracts/${p.contractId}`} className="text-gold hover:underline">
                  {p.contractTitle ?? "contract"}
                </Link>
                {p.decidedByLabel ? ` · by ${p.decidedByLabel}` : ""}
                {p.decidedAt ? ` · ${new Date(p.decidedAt).toLocaleDateString()}` : ""}
              </p>
              {p.status === "approved" && p.appliedChanges && p.appliedChanges.length > 0 && (
                <p className="mt-1 text-xs text-text-mute">
                  Applied: {p.appliedChanges.map((c) => c.field).filter(Boolean).join(", ")}
                </p>
              )}
              {p.decisionNote ? (
                <p className="mt-0.5 text-xs text-text-mute">Note: {p.decisionNote}</p>
              ) : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
