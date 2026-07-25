/**
 * FinanceEntities — legal-entity registry (Task #249; replaces the
 * Task #372 seed scaffold).
 *
 * Firm-owned legal entities digitized from official documents (DET
 * trade licenses, MoA, Ejari, establishment cards). Full management:
 * create / edit / archive, dynamic country filter derived from the
 * data, registration expiry chips, licensed activities, ownership,
 * premises & lease, linked corporate/legal vault documents, and an
 * AI review-and-apply extraction flow from uploaded PDFs.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { RecordCard, RecordCardAction } from "@/components/ui/record-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe, useAtelierListDocuments } from "@workspace/api-client-react";
import {
  useLegalEntities,
  useLegalEntityDetail,
  type LegalEntityRow,
} from "@/lib/v5-hooks";
import { Plus, Archive, Sparkles, Loader2, ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "wouter";

import {
  jsonReq,
  countryLabel,
  emptyDraft,
  draftFromEntity,
  mergeProposalIntoDraft,
  EntityFormDialog,
  type EntityDraft,
} from "./entityForm";

export { jsonReq, countryLabel, EntityFormDialog, type EntityDraft } from "./entityForm";

export const STATUS_LABEL: Record<LegalEntityRow["status"], string> = {
  active: "Active",
  in_formation: "In formation",
  dormant: "Dormant",
  winding_down: "Winding down",
  archived: "Archived",
};

function daysUntil(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.round((t - Date.now()) / 86_400_000);
}

export function expiryTone(iso: string | null | undefined): "green" | "amber" | "red" | "default" {
  const d = daysUntil(iso);
  if (!Number.isFinite(d)) return "default";
  if (d < 0) return "red";
  if (d <= 60) return "amber";
  return "green";
}

export function expiryText(iso: string | null | undefined): string {
  const d = daysUntil(iso);
  if (!Number.isFinite(d)) return "no expiry";
  if (d < 0) return `expired ${Math.abs(d)}d ago`;
  if (d === 0) return "expires today";
  return `${d}d left`;
}

const fieldCls =
  "h-9 w-full rounded-md border border-border bg-bg-elevate px-2 text-sm text-text outline-none focus-visible:border-gold";
const labelCls = "text-[10px] font-mono uppercase tracking-widest text-text-mute";

function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={props.className}>
      <label className={labelCls}>{props.label}</label>
      {props.children}
    </div>
  );
}


// ---------------------------------------------------------------------------
// AI extraction dialog — pick a corporate/legal document, run extraction,
// review the proposal, then apply into the entity form.
// ---------------------------------------------------------------------------

export function ExtractDialog(props: {
  open: boolean;
  onClose: () => void;
  entities: LegalEntityRow[];
  onApply: (draft: EntityDraft, editing: LegalEntityRow | null, note: string) => void;
}) {
  const { data: docsResp } = useAtelierListDocuments(
    { category: "corporate_legal" },
    { query: { enabled: props.open, queryKey: ["atelier-docs-corp-legal"] } },
  );
  const docs = (docsResp as { documents?: Array<{ id: string; title: string }> } | undefined)?.documents ?? [];
  const [docId, setDocId] = React.useState("");
  const [targetId, setTargetId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposal, setProposal] = React.useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    if (props.open) { setDocId(""); setTargetId(""); setError(null); setProposal(null); }
  }, [props.open]);

  async function run() {
    setBusy(true); setError(null); setProposal(null);
    try {
      const resp = await jsonReq<{ proposal: Record<string, unknown> }>(
        "POST", "/finance/entities/extract", { documentId: docId },
      );
      setProposal(resp.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!proposal) return;
    const fields = (proposal.fields ?? {}) as Record<string, unknown>;
    const editing = props.entities.find((e) => e.id === targetId) ?? null;
    const base = editing ? draftFromEntity(editing) : emptyDraft();
    const note = typeof proposal.confidenceNote === "string" ? proposal.confidenceNote : "";
    props.onApply(mergeProposalIntoDraft(base, fields), editing, note);
    props.onClose();
  }

  const fields = (proposal?.fields ?? null) as Record<string, unknown> | null;

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-extract">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold" /> Extract entity data from a document
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Corporate / legal document">
            <select className={fieldCls} value={docId} onChange={(e) => setDocId(e.target.value)} data-testid="select-extract-doc">
              <option value="">Select a document…</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
            {docs.length === 0 && (
              <p className="text-[11px] text-text-faint mt-1">
                No documents in the Corporate / Legal category yet — upload them in the Document Library first.
              </p>
            )}
          </Field>
          <Field label="Apply to">
            <select className={fieldCls} value={targetId} onChange={(e) => setTargetId(e.target.value)} data-testid="select-extract-target">
              <option value="">New entity</option>
              {props.entities.filter((e) => e.status !== "archived").map((e) => (
                <option key={e.id} value={e.id}>{e.shortName || e.legalNameEn}</option>
              ))}
            </select>
          </Field>
          <Button onClick={run} disabled={!docId || busy} data-testid="button-run-extract">
            {busy ? (<><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Extracting…</>) : "Run AI extraction"}
          </Button>
          {error && (
            <p className="text-sm text-danger" data-testid="text-extract-error">
              Extraction failed: {error}
            </p>
          )}
          {proposal && fields && (
            <div className="space-y-2" data-testid="panel-extract-proposal">
              <div className="text-xs text-text-mute">
                Detected: <MonoChip>{String(proposal.documentKind ?? "other")}</MonoChip>
                {typeof proposal.confidenceNote === "string" && proposal.confidenceNote && (
                  <span className="ml-2 italic">{proposal.confidenceNote}</span>
                )}
              </div>
              <div className="rounded-md border border-border-soft p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                {JSON.stringify(fields, null, 2)}
              </div>
              <div className="flex justify-end">
                <Button onClick={apply} data-testid="button-apply-extract">
                  Review in {targetId ? "entity form" : "new-entity form"} →
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Entity card
// ---------------------------------------------------------------------------

function InfoRow(props: { label: string; value: React.ReactNode }) {
  if (props.value === null || props.value === undefined || props.value === "") return null;
  return (
    <div className="flex justify-between gap-4 text-sm py-0.5">
      <span className="text-text-mute whitespace-nowrap">{props.label}</span>
      <span className="text-text text-right break-words min-w-0">{props.value}</span>
    </div>
  );
}

export function fmtAed(n: number | null | undefined): string | null {
  return typeof n === "number" ? `AED ${n.toLocaleString()}` : null;
}

export { InfoRow };

function LegalEntityCard(props: {
  entity: LegalEntityRow;
  canWrite: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const e = props.entity;
  const [, navigate] = useLocation();
  const { documents } = useLegalEntityDetail(e.id);
  const expiring = e.registrations.filter((r) => r.expiresOn);
  const worst = expiring.reduce<{ iso: string | null; d: number }>(
    (acc, r) => {
      const d = daysUntil(r.expiresOn);
      return d < acc.d ? { iso: r.expiresOn ?? null, d } : acc;
    },
    { iso: null, d: Number.POSITIVE_INFINITY },
  );
  const leaseEnd = e.lease?.endDate ?? null;
  const tradeLicense = e.registrations.find((r) => r.type === "trade_license") ?? null;
  const canAct = props.canWrite && e.status !== "archived";
  return (
    <RecordCard
      onClick={canAct ? props.onEdit : () => navigate(`/finance/entities/${e.id}`)}
      data-testid={`entity-card-${e.id}`}
      title={
        <span data-testid={`text-entity-name-${e.id}`}>{e.legalNameEn}</span>
      }
      subtitle={
        <span className="block">
          <span className="block font-mono uppercase tracking-widest text-[10px]">
            {e.shortName ? `${e.shortName} · ` : ""}{countryLabel(e.country)} · {e.legalForm || "—"}
          </span>
          {e.legalNameAr && <span className="block" dir="rtl">{e.legalNameAr}</span>}
          <span className="block text-[11px] text-text-faint mt-0.5">
            {e.jurisdiction}{e.incorporationDate ? ` · incorporated ${e.incorporationDate}` : ""}
            {e.baseCurrency ? ` · ${e.baseCurrency}` : ""}
          </span>
        </span>
      }
      trailing={
        <MonoChip tone={e.status === "active" ? "green" : e.status === "archived" ? "red" : "amber"}>
          {STATUS_LABEL[e.status]}
        </MonoChip>
      }
      actions={
        canAct ? (
          <>
            <RecordCardAction
              onClick={() => navigate(`/finance/entities/${e.id}`)}
              data-testid={`button-details-${e.id}`}
            >
              <ArrowUpRight className="w-3 h-3" /> details
            </RecordCardAction>
            <RecordCardAction danger onClick={props.onArchive} data-testid={`button-archive-${e.id}`}>
              <Archive className="w-3 h-3" /> archive
            </RecordCardAction>
          </>
        ) : undefined
      }
      chips={
        <>
          {tradeLicense && (
            <MonoChip tone={tradeLicense.expiresOn ? expiryTone(tradeLicense.expiresOn) : undefined}>
              TL {tradeLicense.number}
              {tradeLicense.expiresOn ? ` · ${expiryText(tradeLicense.expiresOn)}` : ""}
            </MonoChip>
          )}
          <MonoChip>{e.registrations.length} registration{e.registrations.length === 1 ? "" : "s"}</MonoChip>
          {!tradeLicense && worst.iso && <MonoChip tone={expiryTone(worst.iso)}>license {expiryText(worst.iso)}</MonoChip>}
          {leaseEnd && <MonoChip tone={expiryTone(leaseEnd)}>lease {expiryText(leaseEnd)}</MonoChip>}
          <MonoChip>{documents.length} document{documents.length === 1 ? "" : "s"}</MonoChip>
          {e.owners.length > 0 && <MonoChip>{e.owners.length} owner{e.owners.length === 1 ? "" : "s"}</MonoChip>}
          {e.activities.length > 0 && (
            <MonoChip>{e.activities.length} activit{e.activities.length === 1 ? "y" : "ies"}</MonoChip>
          )}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FinanceEntities() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const canWrite = me?.role === "founding_partner" || me?.role === "partner";
  const [showArchived, setShowArchived] = React.useState(false);
  const { entities, isLoading } = useLegalEntities(showArchived);
  const [countryFilter, setCountryFilter] = React.useState<string>("all");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LegalEntityRow | null>(null);
  const [initialDraft, setInitialDraft] = React.useState<EntityDraft | null>(null);
  const [extractionNote, setExtractionNote] = React.useState<string | null>(null);
  const [extractOpen, setExtractOpen] = React.useState(false);

  // Dynamic country filter: whatever countries exist in the registry.
  const countries = React.useMemo(
    () => Array.from(new Set(entities.map((e) => e.country))).sort(),
    [entities],
  );
  const visible = countryFilter === "all" ? entities : entities.filter((e) => e.country === countryFilter);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["atelier-v5", "legal-entities"] });
    qc.invalidateQueries({ queryKey: ["atelier-v5", "legal-entity"] });
  };

  async function archive(e: LegalEntityRow) {
    if (!window.confirm(`Archive "${e.legalNameEn}"? It will stop appearing as a signing entity.`)) return;
    try {
      await jsonReq("POST", `/finance/entities/${e.id}/archive`);
      toast({ title: "Entity archived" });
      refresh();
    } catch (err) {
      toast({ title: "Archive failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div>
      <PageHero>
        <Eyebrow>Finance · Entities</Eyebrow>
        <h1 className="text-xl text-text mt-1">Legal-entity registry</h1>
        <p className="text-sm text-text-mute mt-2 max-w-2xl">
          The firm's own legal entities, digitized from official registrations — licenses,
          activities, ownership, premises and linked corporate documents.
        </p>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`px-3 h-8 rounded-full text-xs font-mono border ${countryFilter === "all" ? "border-gold text-gold" : "border-border text-text-mute hover:text-text"}`}
          onClick={() => setCountryFilter("all")}
          data-testid="filter-country-all"
        >
          All ({entities.length})
        </button>
        {countries.map((c) => (
          <button
            key={c}
            className={`px-3 h-8 rounded-full text-xs font-mono border ${countryFilter === c ? "border-gold text-gold" : "border-border text-text-mute hover:text-text"}`}
            onClick={() => setCountryFilter(c)}
            data-testid={`filter-country-${c}`}
          >
            {countryLabel(c)} ({entities.filter((e) => e.country === c).length})
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-text-mute cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="checkbox-show-archived" />
          Show archived
        </label>
        <div className="flex-1" />
        {canWrite && (
          <>
            <Button size="sm" variant="outline" onClick={() => setExtractOpen(true)} data-testid="button-open-extract">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Extract from document
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setInitialDraft(null); setExtractionNote(null); setFormOpen(true); }} data-testid="button-new-entity">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New entity
            </Button>
          </>
        )}
      </div>

      {isLoading && <Card className="p-6 text-sm text-text-mute">Loading entities…</Card>}
      {!isLoading && visible.length === 0 && (
        <Card className="p-8 text-center" data-testid="empty-entities">
          <Eyebrow>No legal entities yet</Eyebrow>
          <p className="text-sm text-text-mute mt-2 max-w-md mx-auto">
            Add the firm's legal entities manually, or upload official documents (trade license,
            MoA, Ejari) to the Document Library under Corporate / Legal and use AI extraction.
          </p>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {visible.map((e) => (
          <LegalEntityCard
            key={e.id}
            entity={e}
            canWrite={!!canWrite}
            onEdit={() => { setEditing(e); setInitialDraft(null); setExtractionNote(null); setFormOpen(true); }}
            onArchive={() => void archive(e)}
          />
        ))}
      </div>

      <EntityFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        initialDraft={initialDraft}
        extractionNote={extractionNote}
        onSaved={refresh}
      />
      <ExtractDialog
        open={extractOpen}
        onClose={() => setExtractOpen(false)}
        entities={entities}
        onApply={(draft, target, note) => {
          setEditing(target);
          setInitialDraft(draft);
          setExtractionNote(note || "Cross-check against the source PDF.");
          setFormOpen(true);
        }}
      />
      </div>
    </div>
  );
}
