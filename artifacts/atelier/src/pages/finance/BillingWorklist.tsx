/**
 * BillingWorklist — Task #429 automated billing engine UI.
 *
 * Finance approves what the Billing Orchestrator drafted:
 *   - Drafted triggers (agent output) → partner approves → invoice ISSUES
 *   - Ready triggers waiting for the next run; hold / release / skip
 *   - Upcoming preview (next 90 days, computed, nothing persisted)
 *   - Recent orchestrator runs
 *
 * Task #1099 — standard Finance page shell (like LedgerPage), and the
 * "Run orchestrator now" button launches a durable background job and
 * polls GET /billing/run/status instead of holding the request open.
 *
 * Raw fetch (finance-page convention, see EngagementPnl.tsx) — these
 * bespoke billing routes are not in the OpenAPI spec.
 */
import * as React from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton, BackLink } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Zap, PauseCircle, PlayCircle, XCircle, CheckCircle2, FileText, Mail } from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

interface TriggerRow {
  id: string;
  ruleId: string;
  engagementId: string;
  engagementName: string;
  triggerType: string;
  idempotencyKey: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
  holdReason: string | null;
  skippedReason: string | null;
  invoiceId: string | null;
  invoice: { id: string; status: string; total: number; currency: string; invoiceNumber: string | null } | null;
  details?: { label?: string; passThrough?: boolean } | null;
}
interface UpcomingRow {
  ruleId: string;
  engagementId: string;
  engagementName: string;
  triggerType: string;
  dueDate: string;
  amount: number;
  currency: string;
  label: string;
}
interface RunRow {
  id: string;
  status: string;
  createdAt: string;
  targetLabel: string | null;
  output: { rationaleSummary?: string; invoicesDrafted?: number; triggersCreated?: number } | null;
}
interface Worklist {
  triggers: TriggerRow[];
  upcoming: UpcomingRow[];
  recentRuns: RunRow[];
}
interface RunStatus {
  lastRun: {
    jobId: string;
    mode: "auto" | "manual" | "event";
    status: "running" | "done" | "failed";
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    triggersCreated: number | null;
    invoicesDrafted: number | null;
    rationaleSummary: string | null;
  } | null;
}

async function jfetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new Error(b?.message || b?.error || `HTTP ${res.status}`);
  }
  return body;
}

const TYPE_LABEL: Record<string, string> = {
  milestone: "Milestone",
  period_end: "T&M period",
  installment: "Installment",
  retainer: "Retainer",
};

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const MODE_LABEL: Record<string, string> = { auto: "scheduled", manual: "manual", event: "milestone-event" };

export default function BillingWorklist() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const meQ = useAtelierGetMe();
  const role = meQ.data?.role ?? "";
  const isPartner = role === "founding_partner" || role === "partner";
  const isFinanceLeadership = isPartner || role === "finance";
  const [busy, setBusy] = React.useState<string | null>(null);
  // Set when THIS page started a run — we toast + refresh when it settles.
  const [watchingJobId, setWatchingJobId] = React.useState<string | null>(null);

  const wl = useQuery<Worklist>({
    queryKey: ["billing-worklist"],
    queryFn: () => jfetch("/billing/worklist") as Promise<Worklist>,
  });

  const statusQ = useQuery<RunStatus>({
    queryKey: ["billing-run-status"],
    queryFn: () => jfetch("/billing/run/status") as Promise<RunStatus>,
    refetchInterval: (q) => {
      const lr = q.state.data?.lastRun;
      return lr?.status === "running" ? 2500 : false;
    },
  });
  const lastRun = statusQ.data?.lastRun ?? null;
  const runInFlight = lastRun?.status === "running";

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["billing-worklist"] });
    void qc.invalidateQueries({ queryKey: ["billing-run-status"] });
  }, [qc]);

  // Watched run settled → surface the outcome and reload the worklist.
  React.useEffect(() => {
    if (!watchingJobId || !lastRun || lastRun.jobId !== watchingJobId) return;
    if (lastRun.status === "running") return;
    setWatchingJobId(null);
    if (lastRun.status === "done") {
      toast({ title: "Billing run finished", description: lastRun.rationaleSummary ?? undefined });
    } else {
      toast({ title: "Billing run failed", description: lastRun.error ?? "Please try again.", variant: "destructive" });
    }
    void qc.invalidateQueries({ queryKey: ["billing-worklist"] });
  }, [watchingJobId, lastRun, toast, qc]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      refresh();
    } catch (e) {
      toast({ title: "Billing action failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runNow = () =>
    act("run", async () => {
      const out = (await jfetch("/billing/run", { method: "POST", body: "{}" })) as { jobId: string };
      setWatchingJobId(out.jobId);
      toast({ title: "Billing run started", description: "The orchestrator is running in the background." });
    });

  const sendInvoice = (invoiceId: string, invoiceNumber: string | null) =>
    act(`send-${invoiceId}`, async () => {
      const out = (await jfetch(`/wallet/invoices/${invoiceId}/send`, { method: "POST", body: "{}" })) as {
        delivered: boolean;
        via: string;
        to: string;
      };
      if (out.delivered) {
        toast({ title: "Invoice emailed", description: `Sent ${invoiceNumber ?? "invoice"} to ${out.to}.` });
      } else {
        toast({
          title: "Invoice NOT delivered",
          description: `Email delivery is not configured (${out.via}) — download the PDF and send it manually.`,
          variant: "destructive",
        });
      }
    });

  const t = wl.data?.triggers ?? [];
  const drafted = t.filter((x) => x.status === "drafted");
  const ready = t.filter((x) => x.status === "ready");
  const held = t.filter((x) => x.status === "held");
  const done = t.filter((x) => x.status === "issued" || x.status === "skipped").slice(0, 20);

  return (
    <div className="min-h-screen text-text" data-testid="page-billing-worklist">
      <PageHero>
        <BackLink href="/finance/billing">Back to Bill &amp; Collect</BackLink>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Bill &amp; Collect"
            headline="Billing worklist"
            lede="The Billing Orchestrator scans engagement billing rules daily and drafts invoices for every due trigger — milestones, T&amp;M periods, installments and retainers. Nothing issues without partner approval here."
          />
          <div className="flex items-center gap-2 text-xs font-mono flex-wrap justify-end">
            <PillButton onClick={runNow} disabled={busy !== null || runInFlight} data-testid="button-run-orchestrator">
              <Zap className="mr-1 inline h-3.5 w-3.5" />
              {runInFlight ? "Running…" : busy === "run" ? "Starting…" : "Run orchestrator now"}
            </PillButton>
            <span className="text-text-mute w-full text-right" data-testid="text-orchestrator-last-run">
              {lastRun === null
                ? "Runs automatically every day — no run recorded yet."
                : lastRun.status === "running"
                  ? `${MODE_LABEL[lastRun.mode] ?? lastRun.mode} run in progress…`
                  : lastRun.status === "failed"
                    ? `Last ${MODE_LABEL[lastRun.mode] ?? lastRun.mode} run failed ${lastRun.finishedAt ? timeAgo(lastRun.finishedAt) : ""}`.trim()
                    : `Last ${MODE_LABEL[lastRun.mode] ?? lastRun.mode} run ${lastRun.finishedAt ? timeAgo(lastRun.finishedAt) : ""}${lastRun.invoicesDrafted != null ? ` · ${lastRun.invoicesDrafted} drafted` : ""}`}
            </span>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 pb-24 max-w-7xl mx-auto space-y-8">
        {wl.isLoading && <Card className="p-6 text-sm text-text-mute">Loading worklist…</Card>}
        {wl.isError && (
          <Card className="p-3 border-red-500/40 text-red-400 text-sm font-mono" data-testid="text-worklist-error">
            Failed to load worklist: {String((wl.error as Error)?.message)}
          </Card>
        )}

        {/* ---- Drafted: partner approval checkpoint ---- */}
        <section className="space-y-3">
          <SectionHead
            headline={`Awaiting approval (${drafted.length})`}
            lede="Draft invoices created by the orchestrator. Approving issues the invoice with a minted number."
          />
          {drafted.length === 0 && <Card className="p-4"><p className="text-sm text-text-mute">No drafts waiting.</p></Card>}
          {drafted.map((x) => (
            <Card key={x.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <MonoChip>{TYPE_LABEL[x.triggerType] ?? x.triggerType}</MonoChip>
                    <span className="font-medium">{x.engagementName}</span>
                    {x.details?.passThrough === true && <MonoChip tone="gold">pass-through · at cost</MonoChip>}
                  </div>
                  <p className="mt-1 text-sm text-text-mute">
                    Due {x.dueDate} · {x.invoice ? money(x.invoice.total, x.invoice.currency) : money(x.amount, x.currency)}
                    {x.invoice?.invoiceNumber ? ` · ${x.invoice.invoiceNumber}` : " · draft"}
                  </p>
                  <p className="mt-0.5 text-xs font-mono text-text-faint">{x.idempotencyKey}</p>
                </div>
                <div className="flex items-center gap-2">
                  {x.invoiceId && (
                    <Link href={`/wallet/invoices/${x.invoiceId}`} className="text-sm underline text-text-mute hover:text-text">
                      Review draft
                    </Link>
                  )}
                  {isPartner ? (
                    <PillButton
                      disabled={busy !== null}
                      onClick={() =>
                        act(x.id, async () => {
                          const out = (await jfetch(`/billing/triggers/${x.id}/approve`, { method: "POST", body: "{}" })) as {
                            invoice: { invoice?: { invoiceNumber?: string } };
                          };
                          toast({ title: "Invoice issued", description: `Issued ${out.invoice?.invoice?.invoiceNumber ?? ""}` });
                        })
                      }
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      {busy === x.id ? "Issuing…" : "Approve & issue"}
                    </PillButton>
                  ) : (
                    <span className="text-xs text-text-faint">Partner approval required</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </section>

        {/* ---- Ready + held ---- */}
        <section className="space-y-3">
          <SectionHead
            headline={`Ready & held (${ready.length + held.length})`}
            lede="Materialised triggers. Ready ones are drafted on the next run; held ones wait until released."
          />
          {ready.length + held.length === 0 && <Card className="p-4"><p className="text-sm text-text-mute">Nothing pending.</p></Card>}
          {[...ready, ...held].map((x) => (
            <Card key={x.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <MonoChip>{TYPE_LABEL[x.triggerType] ?? x.triggerType}</MonoChip>
                    <span className="font-medium">{x.engagementName}</span>
                    {x.details?.passThrough === true && <MonoChip tone="gold">pass-through · at cost</MonoChip>}
                    {x.status === "held" && <MonoChip tone="amber">held</MonoChip>}
                  </div>
                  <p className="mt-1 text-sm text-text-mute">
                    Due {x.dueDate} · est. {money(x.amount, x.currency)}
                    {x.holdReason ? ` · ${x.holdReason}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs font-mono text-text-faint">{x.idempotencyKey}</p>
                </div>
                <div className="flex items-center gap-2">
                  {x.status === "ready" && (
                    <PillButton
                      disabled={busy !== null}
                      onClick={() =>
                        act(x.id, () =>
                          jfetch(`/billing/triggers/${x.id}/hold`, { method: "POST", body: JSON.stringify({ reason: "Held from worklist" }) }),
                        )
                      }
                    >
                      <PauseCircle className="mr-1 inline h-3.5 w-3.5" /> Hold
                    </PillButton>
                  )}
                  {x.status === "held" && (
                    <PillButton
                      disabled={busy !== null}
                      onClick={() => act(x.id, () => jfetch(`/billing/triggers/${x.id}/release`, { method: "POST", body: "{}" }))}
                    >
                      <PlayCircle className="mr-1 inline h-3.5 w-3.5" /> Release
                    </PillButton>
                  )}
                  <PillButton
                    disabled={busy !== null}
                    onClick={() => {
                      const reason = window.prompt("Skip this trigger permanently — reason?");
                      if (!reason) return;
                      void act(x.id, () =>
                        jfetch(`/billing/triggers/${x.id}/skip`, { method: "POST", body: JSON.stringify({ reason }) }),
                      );
                    }}
                  >
                    <XCircle className="mr-1 inline h-3.5 w-3.5" /> Skip
                  </PillButton>
                </div>
              </div>
            </Card>
          ))}
        </section>

        {/* ---- Upcoming preview ---- */}
        <section className="space-y-3">
          <SectionHead
            headline={`Upcoming (next 90 days · ${wl.data?.upcoming.length ?? 0})`}
            lede="Computed preview — these become triggers when their period completes or milestone becomes invoiceable."
          />
          <Card className={(wl.data?.upcoming ?? []).length === 0 ? "p-4" : "p-0 overflow-x-auto"}>
            {(wl.data?.upcoming ?? []).length === 0 ? (
              <p className="text-sm text-text-mute">Nothing scheduled in the next 90 days.</p>
            ) : (
              <table className="w-full text-sm" data-testid="table-upcoming">
                <thead>
                  <tr className="text-left text-[11px] font-mono uppercase text-text-faint border-b border-border">
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2">Engagement</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Detail</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(wl.data?.upcoming ?? []).map((u, i) => (
                    <tr key={`${u.ruleId}-${u.dueDate}-${i}`} className="border-b border-border/40">
                      <td className="px-3 py-1.5 font-mono">{u.dueDate}</td>
                      <td className="px-3 py-1.5">{u.engagementName}</td>
                      <td className="px-3 py-1.5">{TYPE_LABEL[u.triggerType] ?? u.triggerType}</td>
                      <td className="px-3 py-1.5 text-text-mute">{u.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{u.amount > 0 ? money(u.amount, u.currency) : "T&M"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>

        {/* ---- History + runs ---- */}
        <section className="space-y-3">
          <SectionHead headline="Recently issued / skipped" />
          <Card className="p-4">
            {done.length === 0 ? (
              <p className="text-sm text-text-mute">No history yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {done.map((x) => (
                  <li key={x.id} className="flex items-center justify-between border-t border-border/40 py-1.5 first:border-t-0">
                    <span>
                      <MonoChip>{x.status}</MonoChip>{" "}
                      {x.engagementName} · {TYPE_LABEL[x.triggerType] ?? x.triggerType} · due {x.dueDate}
                      {x.skippedReason ? ` · ${x.skippedReason}` : ""}
                    </span>
                    {x.invoice?.invoiceNumber && x.invoiceId && (
                      <span className="flex items-center gap-3">
                        <Link href={`/wallet/invoices/${x.invoiceId}`} className="underline text-text-mute hover:text-text">
                          {x.invoice.invoiceNumber}
                        </Link>
                        <a
                          href={`${API_BASE}/wallet/invoices/${x.invoiceId}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 underline text-text-mute hover:text-text"
                          title="Open the client-ready invoice PDF"
                        >
                          <FileText className="h-3.5 w-3.5" /> PDF
                        </a>
                        {isFinanceLeadership && x.invoice.status !== "void" && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void sendInvoice(x.invoiceId as string, x.invoice?.invoiceNumber ?? null)}
                            className="inline-flex items-center gap-1 underline text-text-mute hover:text-text disabled:opacity-40"
                            title="Email the invoice PDF to the client billing contact"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {busy === `send-${x.invoiceId}` ? "Sending…" : "Email client"}
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHead headline="Recent orchestrator runs" />
          <Card className="p-4" data-testid="card-recent-runs">
            {(wl.data?.recentRuns ?? []).length === 0 ? (
              <p className="text-sm text-text-mute">No runs yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(wl.data?.recentRuns ?? []).map((r) => (
                  <li key={r.id} className="border-t border-border/40 py-1.5 first:border-t-0">
                    <MonoChip tone={r.status === "succeeded" || r.status === "complete" ? undefined : "amber"}>{r.status}</MonoChip>{" "}
                    {new Date(r.createdAt).toLocaleString()} · {r.targetLabel ?? ""}
                    {r.output?.rationaleSummary ? <span className="text-text-mute"> — {r.output.rationaleSummary}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
