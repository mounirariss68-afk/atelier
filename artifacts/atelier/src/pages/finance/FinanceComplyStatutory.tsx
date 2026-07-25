/**
 * FinanceComplyStatutory — Statutory filings register (Task #419).
 */
import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Undo2 } from "lucide-react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, BackLink, PillButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { useStatutoryFilings, useFinanceEntities, useEntityExpiries, API_BASE, type StatutoryFilingRow } from "@/lib/v5-hooks";

function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function statusTone(s: StatutoryFilingRow["status"], dueOn: string): "green" | "amber" | "red" | "default" {
  if (s === "filed") return "green";
  if (s === "overdue") return "red";
  const d = daysUntil(dueOn);
  if (d < 0) return "red";
  if (d <= 30) return "amber";
  return "default";
}

function fmtRel(d: number): string {
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "today";
  if (d < 60) return `in ${d}d`;
  if (d < 365) return `in ${Math.round(d / 30)}mo`;
  return `in ${Math.round(d / 365)}y`;
}

export default function FinanceComplyStatutory() {
  const filings = useStatutoryFilings();
  const entities = useFinanceEntities();
  const { expiries } = useEntityExpiries(90);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | string>("all");

  async function setFiled(f: StatutoryFilingRow, reopen: boolean) {
    setBusy(f.id);
    try {
      const res = await fetch(`${API_BASE}/finance/comply/statutory/${f.id}/mark-filed`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reopen ? { reopen: true } : {}),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      toast({ title: reopen ? "Filing reopened" : "Filing marked as filed" });
      await qc.invalidateQueries({ queryKey: ["atelier-v5", "finance-statutory"] });
      await qc.invalidateQueries({ queryKey: ["statutory-filings"] });
    } catch (e) {
      toast({ title: "Statutory filings", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }
  const visibleExpiries = filter === "all" ? expiries : expiries.filter((x) => x.entityId === filter);

  const visible = filter === "all" ? filings : filings.filter((f) => f.entityId === filter);
  const sorted = [...visible].sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const overdue = filings.filter((f) => f.status !== "filed" && daysUntil(f.dueOn) < 0).length;
  const dueSoon = filings.filter((f) => f.status !== "filed" && daysUntil(f.dueOn) >= 0 && daysUntil(f.dueOn) <= 60).length;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <div className="container-atelier">
          <BackLink href="/finance/comply">Finance · Comply</BackLink>
        </div>
        <Eyebrow>Manage · Finance · Comply · Statutory</Eyebrow>
        <h1 className="headline mt-3">Statutory filings register</h1>
        <p className="lede mt-3 max-w-3xl">
          Per-entity statutory filings — annual accounts, beneficial-ownership
          updates, country-by-country, MISA / DIFC / ADGM returns, payroll
          year-end. Owner, due date, status and evidence link for each. Feeds
          the compliance calendar on the Finance home alongside the existing
          tax filings.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs font-mono">
          <MonoChip>{filings.length} filings</MonoChip>
          <MonoChip tone={overdue > 0 ? "red" : "green"}>{overdue} overdue</MonoChip>
          <MonoChip tone={dueSoon > 0 ? "amber" : "default"}>{dueSoon} due in 60d</MonoChip>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="statutory-entity-filters">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
              filter === "all" ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
            }`}
            data-testid="statutory-filter-all"
          >All</button>
          {entities.map((e) => (
            <button
              key={e.id}
              onClick={() => setFilter(e.id)}
              className={`px-3 py-1 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                filter === e.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
              }`}
              data-testid={`statutory-filter-${e.id}`}
            >{e.shortName}</button>
          ))}
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-3">
        {visibleExpiries.length > 0 && (
          <div className="space-y-3" data-testid="registry-expiries">
            <SectionHead
              headline={`${visibleExpiries.length} registry expir${visibleExpiries.length === 1 ? "y" : "ies"} · next 90 days`}
            />
            {visibleExpiries.map((x) => (
              <Card key={x.id} className="p-4" data-testid={`registry-expiry-${x.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Eyebrow>{x.entityShortName}{x.issuer ? ` · ${x.issuer}` : ""}</Eyebrow>
                    {/* Task #287 — deep link to the entity detail page */}
                    <Link
                      href={`/finance/entities/${x.entityId}`}
                      className="block text-base font-medium text-text mt-0.5 hover:text-gold transition-colors"
                      data-testid={`link-expiry-entity-${x.id}`}
                    >
                      {x.label}
                    </Link>
                    {x.number && <p className="text-sm text-text-mute mt-1 font-mono">{x.number}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <MonoChip tone={x.severity === "overdue" ? "red" : x.severity === "critical" ? "amber" : "default"}>
                      {x.severity === "overdue" ? "expired" : x.kind === "lease" ? "lease ends" : "expires"}
                    </MonoChip>
                    <div className="font-mono text-xs text-text mt-1.5">{x.expiresOn}</div>
                    <div className="font-mono text-[10px] text-text-faint">{fmtRel(x.daysOut)}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
        <SectionHead headline={`${sorted.length} filing${sorted.length === 1 ? "" : "s"}`} />
        {sorted.map((f) => {
          const ent = entities.find((e) => e.id === f.entityId);
          const d = daysUntil(f.dueOn);
          return (
            <Card key={f.id} className="p-4 space-y-2" data-testid={`statutory-${f.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Eyebrow>{ent?.shortName ?? f.entityId} · {f.authority}</Eyebrow>
                  <div className="text-base font-medium text-text mt-0.5">{f.kind}</div>
                  <p className="text-sm text-text-mute mt-1">{f.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <MonoChip tone={statusTone(f.status, f.dueOn)}>{f.status.replace("_", " ")}</MonoChip>
                  <div className="font-mono text-xs text-text mt-1.5">{f.dueOn}</div>
                  <div className="font-mono text-[10px] text-text-faint">{f.status === "filed" ? "filed" : fmtRel(d)}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2 border-t border-border-soft">
                <div className="flex flex-wrap gap-3">
                  <div><span className="text-text-faint">Owner:</span> <span className="text-text">{f.owner}</span></div>
                  {f.evidenceUrl && (
                    <div><span className="text-text-faint">Evidence:</span> <a href={f.evidenceUrl} className="font-mono text-gold hover:underline">{f.evidenceUrl}</a></div>
                  )}
                  {f.status === "filed" && (f.filedOn || f.filedByName) && (
                    <div><span className="text-text-faint">Filed:</span> <span className="text-text">{f.filedOn ?? ""}{f.filedByName ? ` by ${f.filedByName}` : ""}</span></div>
                  )}
                </div>
                {f.status === "filed" ? (
                  <button
                    className="font-mono uppercase tracking-widest text-text-faint hover:text-text inline-flex items-center gap-1"
                    disabled={busy !== null}
                    onClick={() => setFiled(f, true)}
                    data-testid={`statutory-reopen-${f.id}`}
                  ><Undo2 className="w-3 h-3" /> Reopen</button>
                ) : (
                  <PillButton
                    disabled={busy !== null}
                    onClick={() => setFiled(f, false)}
                    data-testid={`statutory-mark-filed-${f.id}`}
                  ><CheckCircle2 className="w-4 h-4" /> Mark filed</PillButton>
                )}
              </div>
              {f.notes && <div className="text-xs text-text-mute italic">{f.notes}</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
