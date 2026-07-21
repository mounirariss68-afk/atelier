/**
 * BillingWorklist — Task #429 automated billing engine UI.
 *
 * Finance approves what the Billing Orchestrator drafted:
 *   - Drafted triggers (agent output) → partner approves → invoice ISSUES
 *   - Ready triggers waiting for the next run; hold / release / skip
 *   - Upcoming preview (next 90 days, computed, nothing persisted)
 *   - Recent orchestrator runs
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

export default function BillingWorklist() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const meQ = useAtelierGetMe();
  const role = meQ.data?.role ?? "";
  const isPartner = role === "founding_partner" || role === "partner";
  const isFinanceLeadership = isPartner || role === "finance";
  const [busy, setBusy] = React.useState<string | null>(null);

  const wl = useQuery<Worklist>({
    queryKey: ["billing-worklist"],
    queryFn: () => jfetch("/billing/worklist") as Promise<Worklist>,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["billing-worklist"] });

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast({ title: "Billing action failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runNow = () =>
    act("run", async () => {
      const out = (await jfetch("/billing/run", { method: "POST", body: "{}" })) as {
        output: { rationaleSummary: string };
      };
      toast({ title: "Billing run finished", description: out.output.rationaleSummary });
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
    <div className="mx-auto max-w-6xl px-6 pb-24">
      <PageHero>
        <BackLink href="/finance/billing" className="mb-4">Back to Bill &amp; Collect</BackLink>
        <SectionHead
          eyebrow="Finance · Bill &amp; Collect"
          headline="Billing worklist"
          lede="The Billing Orchestrator scans engagement billing rules daily and drafts invoices for every due trigger — milestones, T&amp;M periods, installments and retainers. Nothing issues without partner approval here."
        />
      </PageHero>
      <div className="mb-8 flex items-center gap-3">
        <PillButton onClick={runNow} disabled={busy !== null}>
          <Zap className="mr-1 inline h-3.5 w-3.5" />
          {busy === "run" ? "Running…" : "Run orchestrator now"}
        </PillButton>
        {wl.isLoading && <span className="text-sm opacity-60">Loading…</span>}
        {wl.isError && <span className="text-sm text-red-500">Failed to load worklist: {String((wl.error as Error)?.message)}</span>}
      </div>

      {/* ---- Drafted: partner approval checkpoint ---- */}
      <SectionHead
        headline={`Awaiting approval (${drafted.length})`}
        lede="Draft invoices created by the orchestrator. Approving issues the invoice with a minted number."
      />
      <div className="mb-10 space-y-3">
        {drafted.length === 0 && <Card><p className="text-sm opacity-60">No drafts waiting.</p></Card>}
        {drafted.map((x) => (
          <Card key={x.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MonoChip>{TYPE_LABEL[x.triggerType] ?? x.triggerType}</MonoChip>
                  <span className="font-medium">{x.engagementName}</span>
                </div>
                <p className="mt-1 text-sm opacity-70">
                  Due {x.dueDate} · {x.invoice ? money(x.invoice.total, x.invoice.currency) : money(x.amount, x.currency)}
                  {x.invoice?.invoiceNumber ? ` · ${x.invoice.invoiceNumber}` : " · draft"}
                </p>
                <p className="mt-0.5 text-xs opacity-50">{x.idempotencyKey}</p>
              </div>
              <div className="flex items-center gap-2">
                {x.invoiceId && (
                  <Link href={`/wallet/invoices/${x.invoiceId}`} className="text-sm underline opacity-70 hover:opacity-100">
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
                  <span className="text-xs opacity-50">Partner approval required</span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ---- Ready + held ---- */}
      <SectionHead
        headline={`Ready & held (${ready.length + held.length})`}
        lede="Materialised triggers. Ready ones are drafted on the next run; held ones wait until released."
      />
      <div className="mb-10 space-y-3">
        {ready.length + held.length === 0 && <Card><p className="text-sm opacity-60">Nothing pending.</p></Card>}
        {[...ready, ...held].map((x) => (
          <Card key={x.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MonoChip>{TYPE_LABEL[x.triggerType] ?? x.triggerType}</MonoChip>
                  <span className="font-medium">{x.engagementName}</span>
                  {x.status === "held" && <MonoChip tone="amber">held</MonoChip>}
                </div>
                <p className="mt-1 text-sm opacity-70">
                  Due {x.dueDate} · est. {money(x.amount, x.currency)}
                  {x.holdReason ? ` · ${x.holdReason}` : ""}
                </p>
                <p className="mt-0.5 text-xs opacity-50">{x.idempotencyKey}</p>
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
      </div>

      {/* ---- Upcoming preview ---- */}
      <SectionHead headline={`Upcoming (next 90 days · ${wl.data?.upcoming.length ?? 0})`} lede="Computed preview — these become triggers when their period completes or milestone becomes invoiceable." />
      <Card className="mb-10">
        {(wl.data?.upcoming ?? []).length === 0 ? (
          <p className="text-sm opacity-60">Nothing scheduled in the next 90 days.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-60">
                <th className="py-1 pr-4">Due</th>
                <th className="py-1 pr-4">Engagement</th>
                <th className="py-1 pr-4">Type</th>
                <th className="py-1 pr-4">Detail</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(wl.data?.upcoming ?? []).map((u, i) => (
                <tr key={`${u.ruleId}-${u.dueDate}-${i}`} className="border-t border-black/5">
                  <td className="py-1.5 pr-4">{u.dueDate}</td>
                  <td className="py-1.5 pr-4">{u.engagementName}</td>
                  <td className="py-1.5 pr-4">{TYPE_LABEL[u.triggerType] ?? u.triggerType}</td>
                  <td className="py-1.5 pr-4 opacity-70">{u.label}</td>
                  <td className="py-1.5 text-right">{u.amount > 0 ? money(u.amount, u.currency) : "T&M"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---- History + runs ---- */}
      <SectionHead headline="Recently issued / skipped" lede="" />
      <Card className="mb-10">
        {done.length === 0 ? (
          <p className="text-sm opacity-60">No history yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {done.map((x) => (
              <li key={x.id} className="flex items-center justify-between border-t border-black/5 py-1.5 first:border-t-0">
                <span>
                  <MonoChip>{x.status}</MonoChip>{" "}
                  {x.engagementName} · {TYPE_LABEL[x.triggerType] ?? x.triggerType} · due {x.dueDate}
                  {x.skippedReason ? ` · ${x.skippedReason}` : ""}
                </span>
                {x.invoice?.invoiceNumber && x.invoiceId && (
                  <span className="flex items-center gap-3">
                    <Link href={`/wallet/invoices/${x.invoiceId}`} className="underline opacity-70 hover:opacity-100">
                      {x.invoice.invoiceNumber}
                    </Link>
                    <a
                      href={`${API_BASE}/wallet/invoices/${x.invoiceId}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline opacity-70 hover:opacity-100"
                      title="Open the client-ready invoice PDF"
                    >
                      <FileText className="h-3.5 w-3.5" /> PDF
                    </a>
                    {isFinanceLeadership && x.invoice.status !== "void" && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void sendInvoice(x.invoiceId as string, x.invoice?.invoiceNumber ?? null)}
                        className="inline-flex items-center gap-1 underline opacity-70 hover:opacity-100 disabled:opacity-40"
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

      <SectionHead headline="Recent orchestrator runs" lede="" />
      <Card>
        {(wl.data?.recentRuns ?? []).length === 0 ? (
          <p className="text-sm opacity-60">No runs yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(wl.data?.recentRuns ?? []).map((r) => (
              <li key={r.id} className="border-t border-black/5 py-1.5 first:border-t-0">
                <MonoChip tone={r.status === "succeeded" ? undefined : "amber"}>{r.status}</MonoChip>{" "}
                {new Date(r.createdAt).toLocaleString()} · {r.targetLabel ?? ""}
                {r.output?.rationaleSummary ? <span className="opacity-70"> — {r.output.rationaleSummary}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
