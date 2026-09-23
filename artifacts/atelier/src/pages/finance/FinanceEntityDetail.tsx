/**
 * FinanceEntityDetail — Task #287: dedicated legal-entity detail page.
 *
 * Full registry record for one entity (registrations, activities,
 * ownership, premises & lease) plus the tiered document shelf:
 * constitutional documents / active compliance / formation history,
 * with a visible Unclassified group. Documents open the file directly
 * via the vault download endpoint; a secondary link goes to the vault
 * record. Partners can override a document's classification inline.
 */

import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionLabel, Card, Eyebrow, MonoChip, BackLink } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe } from "@workspace/api-client-react";
import {
  useLegalEntities,
  useLegalEntityDetail,
  useOwnershipEntity,
  type LegalEntityRow,
  type LegalEntityLinkedDoc,
  type EntityBankAccount,
} from "@/lib/v5-hooks";
import { EntityOwnershipCard } from "./OwnershipPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  jsonReq,
  countryLabel,
  STATUS_LABEL,
  expiryTone,
  expiryText,
  fmtAed,
  InfoRow,
  EntityFormDialog,
  ExtractDialog,
  type EntityDraft,
} from "./FinanceEntities";
import { Pencil, Archive, FileText, Vault, Sparkles, Download, MoreVertical, Copy, Check, Landmark, Plus, UploadCloud, Loader2, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------------------
// Copy-to-clipboard affordances — every identifying number on this page
// gets a small copy icon (founder request, 2026-08-14).
// ---------------------------------------------------------------------------

/** Clipboard write with feature detection and a legacy fallback; never throws. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyValueButton(props: { value: string; label: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className={`p-1 rounded text-text-faint hover:text-text hover:bg-bg-deep focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold transition-colors shrink-0 ${props.className ?? ""}`}
      title={`Copy ${props.label}`}
      aria-label={`Copy ${props.label}`}
      data-testid={`button-copy-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      onClick={() => {
        void writeClipboard(props.value).then((ok) => {
          if (ok) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
            toast({ title: "Copied", description: props.value });
          } else {
            toast({ title: "Copy failed", description: "Your browser blocked clipboard access — copy manually.", variant: "destructive" });
          }
        });
      }}
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/** InfoRow variant whose value carries a copy button. */
function CopyInfoRow(props: { label: string; value: string | null | undefined; copyValue?: string }) {
  if (!props.value) return null;
  return (
    <InfoRow
      label={props.label}
      value={
        <span className="inline-flex items-center gap-1 justify-end">
          <span className="break-words min-w-0">{props.value}</span>
          <CopyValueButton value={props.copyValue ?? props.value} label={props.label} />
        </span>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Document classification — three legal-function tiers + unclassified
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  trade_license: "Trade license",
  commercial_register: "Commercial register",
  chamber_membership: "Chamber membership",
  establishment_card: "Establishment card",
  initial_approval: "Initial approval",
  follow_up_receipt: "Follow-up receipt",
  memorandum_of_association: "Memorandum of Association",
  ejari_tenancy: "Ejari tenancy",
  tax_registration: "Tax registration",
  tax_registration_ct: "Corporate Tax certificate",
  tax_registration_vat: "VAT certificate",
  other: "Other",
};

const KIND_OPTIONS = Object.entries(KIND_LABEL);

type Tier = "constitutional" | "compliance" | "history" | "unclassified";

/**
 * Classify a document into its display tier. `hasTradeLicense` demotes
 * the initial approval to formation history once the real trade license
 * exists in the entity's registrations (the approval is superseded).
 */
function docTier(doc: LegalEntityLinkedDoc, hasTradeLicense: boolean): Tier {
  switch (doc.docKind) {
    case "memorandum_of_association":
      return "constitutional";
    case "trade_license":
    case "commercial_register":
    case "chamber_membership":
    case "establishment_card":
    case "ejari_tenancy":
    case "tax_registration":
    case "tax_registration_ct":
    case "tax_registration_vat":
      return "compliance";
    case "initial_approval":
      return hasTradeLicense ? "history" : "compliance";
    case "follow_up_receipt":
      return "history";
    default:
      return "unclassified";
  }
}

const TIER_META: Record<Tier, { title: string; blurb: string }> = {
  constitutional: {
    title: "Constitutional documents",
    blurb: "The entity's founding instruments — who owns it and how it is governed.",
  },
  compliance: {
    title: "Active compliance",
    blurb: "Licenses and registrations that must stay current for the entity to operate.",
  },
  history: {
    title: "Formation history",
    blurb: "Superseded steps from the incorporation process, kept for the record.",
  },
  unclassified: {
    title: "Unclassified",
    blurb: "Linked documents without a legal classification yet — assign one below.",
  },
};

export function DocCard(props: {
  doc: LegalEntityLinkedDoc;
  canWrite: boolean;
  onKindChange: (kind: string | null) => void;
  /** ISO expiry date for compliance docs (colored chip); null = no chip. */
  expiresOn?: string | null;
  /** License/registration number shown on the card with a copy icon. */
  regNumber?: string | null;
  muted?: boolean;
}) {
  const d = props.doc;
  return (
    <div
      className={`group card-flat p-3.5 flex flex-col gap-3 justify-between transition-colors hover:border-border ${props.muted ? " opacity-60 bg-transparent" : ""}`}
      data-testid={`entity-doc-${d.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            <FileText className="w-4 h-4 text-text-mute shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <a
                href={`/api/atelier/documents/${d.id}/download?disposition=inline`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-text hover:text-gold truncate block"
                data-testid={`link-open-doc-${d.id}`}
                title={d.title}
              >
                {d.docKind ? (KIND_LABEL[d.docKind] ?? d.docKind) : d.title}
              </a>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
          <a
            href={`/api/atelier/documents/${d.id}/download`}
            className="p-1.5 rounded hover:bg-bg-deep text-text-mute hover:text-text transition-colors"
            title="Download file"
            data-testid={`button-download-doc-${d.id}`}
          >
            <Download className="w-3.5 h-3.5" />
          </a>
          <a
            href={`/documents?open=${d.id}`}
            className="p-1.5 rounded hover:bg-bg-deep text-text-mute hover:text-text transition-colors"
            title="View in document vault"
            data-testid={`link-vault-doc-${d.id}`}
          >
            <Vault className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {props.regNumber && (
        <div className="flex items-center gap-1 -mt-1">
          <span className="text-xs font-mono text-text-mute" data-testid={`text-doc-number-${d.id}`}>
            № {props.regNumber}
          </span>
          <CopyValueButton value={props.regNumber} label={`${d.docKind ?? "document"} number`} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <div className="flex items-center gap-2 min-w-0">
          {props.expiresOn && (
            <MonoChip tone={expiryTone(props.expiresOn)}>{expiryText(props.expiresOn)}</MonoChip>
          )}
          {d.fileName && (
            <div className="text-[11px] text-text-faint font-mono truncate" data-testid={`text-doc-filename-${d.id}`}>
              {d.fileName}
            </div>
          )}
        </div>

        {props.canWrite ? (
          <div className="relative">
            <select
              className="appearance-none h-6 pl-2 pr-6 rounded bg-transparent hover:bg-bg border border-transparent hover:border-border text-[10px] font-mono text-text-mute outline-none focus-visible:border-gold transition-colors cursor-pointer"
              value={d.docKind ?? ""}
              onChange={(e) => props.onKindChange(e.target.value || null)}
              data-testid={`select-doc-kind-${d.id}`}
              title="Classify document"
            >
              <option value="">Unclassified</option>
              {KIND_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <MoreVertical className="w-3 h-3 text-text-faint absolute right-1.5 top-1.5 pointer-events-none" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FinanceEntityDetail() {
  const [, params] = useRoute("/finance/entities/:id");
  const id = params?.id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const { entity: e, documents, bankAccounts, isLoading, isError } = useLegalEntityDetail(id);
  const ownership = useOwnershipEntity(id);
  // Used only to refresh the grid cache after edits from this page.
  useLegalEntities(true);

  const archived = e?.status === "archived";
  const canWrite = (me?.role === "founding_partner" || me?.role === "partner") && !archived;
  // Bank accounts follow the finance-leadership rule (finance can manage
  // accounts even though registry edits stay partner-only).
  const canManageBank =
    (me?.role === "founding_partner" || me?.role === "partner" || me?.role === "finance") && !archived;
  const [formOpen, setFormOpen] = React.useState(false);
  const [extractOpen, setExtractOpen] = React.useState(false);
  const [applied, setApplied] = React.useState<{
    draft: EntityDraft;
    editing: LegalEntityRow | null;
    note: string;
  } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["atelier-v5", "legal-entities"] });
    qc.invalidateQueries({ queryKey: ["atelier-v5", "legal-entity"] });
  };

  async function archive() {
    if (!e) return;
    if (!window.confirm(`Archive "${e.legalNameEn}"? It will stop appearing as a signing entity.`)) return;
    try {
      await jsonReq("POST", `/finance/entities/${e.id}/archive`);
      toast({ title: "Entity archived" });
      refresh();
    } catch (err) {
      toast({ title: "Archive failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function setDocKind(docId: string, kind: string | null) {
    try {
      await jsonReq("PATCH", `/documents/${docId}`, { docKind: kind });
      toast({ title: kind ? "Document reclassified" : "Classification cleared" });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "legal-entity"] });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  if (!e) {
    const notFound = isError || (!isLoading && !e);
    return (
      <div>
        <PageHero>
          <BackLink href="/finance/entities">Finance · Entities</BackLink>
          <h1 className="text-xl text-text mt-2">Legal entity</h1>
        </PageHero>
        <div className="container-atelier py-10">
          {notFound ? (
            <Card className="p-6" data-testid="entity-detail-not-found">
              <p className="text-sm text-text">Entity not found.</p>
              <p className="text-xs text-text-mute mt-1">
                This entity doesn't exist or you don't have access to it.
              </p>
              <Link
                href="/finance/entities"
                className="inline-block mt-3 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
              >
                ← Back to the entity registry
              </Link>
            </Card>
          ) : (
            <Card className="p-6 text-sm text-text-mute" data-testid="entity-detail-loading">
              Loading entity…
            </Card>
          )}
        </div>
      </div>
    );
  }

  const hasTradeLicense = e.registrations.some((r) => r.type === "trade_license");

  // Registration ↔ document join: explicit certificate references win;
  // legacy records continue to use the stable kind-based fallback.
  // registration of its type (moa_contract is the registration-side name
  // for the MoA document). The join consumes registrations one-to-one in
  // stable order, so repeated types (e.g. two initial approvals) never
  // share a number; every registration left unmatched — any type — renders
  // in the residual "Other registration numbers" list below the documents,
  // so nothing is dropped. This replaces the old standalone
  // "Registrations & licenses" section, which duplicated the cards.
  const REG_TYPE_FOR_KIND: Record<string, string> = { memorandum_of_association: "moa_contract" };
  const regNumberByDocId = new Map<string, string>();
  const consumedRegIds = new Set<string>();
  for (const d of [...documents].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!d.docKind) continue;
    const explicitlyLinked = e.registrations.find((r) => r.certificateDocumentId === d.id);
    if (explicitlyLinked?.number) {
      consumedRegIds.add(explicitlyLinked.id);
      regNumberByDocId.set(d.id, explicitlyLinked.number);
      continue;
    }
    const type = REG_TYPE_FOR_KIND[d.docKind] ?? d.docKind;
    const reg = e.registrations.find((r) => r.type === type && r.number && !consumedRegIds.has(r.id));
    if (reg?.number) {
      consumedRegIds.add(reg.id);
      regNumberByDocId.set(d.id, reg.number);
    }
  }
  const looseRegs = e.registrations.filter((r) => !consumedRegIds.has(r.id));
  const regNumFor = (d: LegalEntityLinkedDoc) => regNumberByDocId.get(d.id) ?? null;
  const tiers: Record<Tier, LegalEntityLinkedDoc[]> = {
    constitutional: [], compliance: [], history: [], unclassified: [],
  };
  for (const d of documents) tiers[docTier(d, hasTradeLicense)].push(d);

  // Compliance docs sort by nearest expiry (docs without a matching dated
  // registration go last). Expiry comes from the registration of the same
  // type; Ejari tenancy uses the lease end date.
  const docExpiry = (d: LegalEntityLinkedDoc): string | null => {
    if (d.docKind === "ejari_tenancy") return e.lease?.endDate ?? null;
    const reg = e.registrations.find((r) => r.type === d.docKind && r.expiresOn);
    return reg?.expiresOn ?? null;
  };
  tiers.compliance.sort((a, b) => {
    const ea = docExpiry(a);
    const eb = docExpiry(b);
    if (ea && eb) return ea.localeCompare(eb);
    if (ea) return -1;
    if (eb) return 1;
    return a.title.localeCompare(b.title);
  });

  return (
    <div>
      <PageHero>
        <BackLink href="/finance/entities">Finance · Entities</BackLink>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div className="min-w-0">
            <Eyebrow>{countryLabel(e.country)} · {e.legalForm || "—"}</Eyebrow>
            <h1 className="text-xl text-text mt-1" data-testid="text-entity-detail-name">{e.legalNameEn}</h1>
            {e.legalNameAr && <p className="text-sm text-text-mute" dir="rtl">{e.legalNameAr}</p>}
            <p className="text-xs text-text-faint mt-1">
              {e.jurisdiction}{e.incorporationDate ? ` · incorporated ${e.incorporationDate}` : ""}
              {e.durationYears ? ` · ${e.durationYears}-year term` : ""}
              {e.baseCurrency ? ` · ${e.baseCurrency}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <MonoChip tone={e.status === "active" ? "green" : archived ? "red" : "amber"}>
              {STATUS_LABEL[e.status]}
            </MonoChip>
            {canWrite && (
              <>
                <Button size="sm" variant="outline" onClick={() => setExtractOpen(true)} data-testid="button-extract-entity-detail">
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Extract from document
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setApplied(null); setFormOpen(true); }} data-testid="button-edit-entity-detail">
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => void archive()} data-testid="button-archive-entity-detail">
                  <Archive className="w-3.5 h-3.5 mr-1" /> Archive
                </Button>
              </>
            )}
          </div>
        </div>
        {archived && (
          <p className="mt-3 text-xs text-danger font-mono uppercase tracking-widest" data-testid="banner-entity-archived">
            Archived — read only
          </p>
        )}
      </PageHero>

      <div className="container-atelier py-10 space-y-8">
        {ownership.data && <EntityOwnershipCard entity={ownership.data} asOf={ownership.data ? new Date().toISOString().slice(0, 10) : ""} />}
        {/* Task #1182 — unsettled pre-formation pool nudge */}
        {e.status === "active" && e.formation && !e.formation.settlement && (
          <Link href="/finance/pre-formation">
            <div
              className="flex items-start gap-3 border border-warn/40 bg-warn/5 rounded-lg p-4 cursor-pointer hover:border-warn/70 transition-colors"
              data-testid="banner-preformation-unsettled"
            >
              <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">
                  Unsettled pre-formation pool
                </div>
                <div className="text-xs text-text-mute mt-0.5">
                  This entity is now active but its pre-formation cost pool has not been settled yet.
                  Visit the pre-formation page to choose a settlement treatment.
                </div>
              </div>
              <div className="ml-auto shrink-0 text-xs font-mono uppercase tracking-widest text-warn">
                Settle →
              </div>
            </div>
          </Link>
        )}

        {/* Documents — tiered shelf: compliance first, then constitutional,
            then a collapsed formation-history accordion. */}
        <section data-testid="entity-documents-shelf">
          <SectionLabel>Documents</SectionLabel>
          {documents.length === 0 ? (
            <p className="text-sm text-text-mute mt-2">
              No linked documents yet — link corporate/legal documents to this entity from the Document Library.
            </p>
          ) : (
            <div className="space-y-6 mt-3">
              {(tiers.compliance.length > 0 || tiers.unclassified.length > 0) && (
                <div data-testid="doc-tier-compliance">
                  <div className="flex items-baseline gap-2 mb-3">
                    <h2 className="text-[13px] font-mono uppercase tracking-widest text-text-mute">{TIER_META.compliance.title}</h2>
                    <span className="text-[11px] text-text-faint">{TIER_META.compliance.blurb}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tiers.compliance.map((d) => (
                      <DocCard
                        key={d.id}
                        doc={d}
                        expiresOn={docExpiry(d)}
                        regNumber={regNumFor(d)}
                        canWrite={!!canWrite}
                        onKindChange={(k) => void setDocKind(d.id, k)}
                      />
                    ))}
                  </div>
                  {tiers.unclassified.length > 0 && (
                    <div className="mt-6" data-testid="doc-tier-unclassified">
                      <div className="flex items-baseline gap-2 mb-3">
                        <h3 className="text-[13px] font-mono uppercase tracking-widest text-warn">
                          {TIER_META.unclassified.title}
                        </h3>
                        <span className="text-[11px] text-text-faint">{TIER_META.unclassified.blurb}</span>
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {tiers.unclassified.map((d) => (
                          <DocCard key={d.id} doc={d} canWrite={!!canWrite} onKindChange={(k) => void setDocKind(d.id, k)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tiers.constitutional.length > 0 && (
                <div className="mt-6" data-testid="doc-tier-constitutional">
                  <div className="flex items-baseline gap-2 mb-3">
                    <h2 className="text-[13px] font-mono uppercase tracking-widest text-text-mute">{TIER_META.constitutional.title}</h2>
                    <span className="text-[11px] text-text-faint">{TIER_META.constitutional.blurb}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tiers.constitutional.map((d) => (
                      <DocCard key={d.id} doc={d} regNumber={regNumFor(d)} canWrite={!!canWrite} onKindChange={(k) => void setDocKind(d.id, k)} />
                    ))}
                  </div>
                </div>
              )}

              {tiers.history.length > 0 && (
                <details data-testid="doc-tier-history" className="group mt-6">
                  <summary className="flex items-center gap-2 cursor-pointer list-none select-none mb-3">
                    <span className="text-[13px] font-mono uppercase tracking-widest text-text-mute group-open:text-text transition-colors">
                      {TIER_META.history.title}
                    </span>
                    <MonoChip>{tiers.history.length}</MonoChip>
                    <span className="text-[11px] text-text-faint">{TIER_META.history.blurb}</span>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-gold ml-auto group-open:hidden">
                      Show
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-gold ml-auto hidden group-open:inline">
                      Hide
                    </span>
                  </summary>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tiers.history.map((d) => (
                      <DocCard key={d.id} doc={d} muted regNumber={regNumFor(d)} canWrite={!!canWrite} onKindChange={(k) => void setDocKind(d.id, k)} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>

        {/* The old "Registrations & licenses" section duplicated the document
            cards; matched registration numbers now live ON the cards (with
            copy buttons). Every registration WITHOUT its own document —
            regardless of type or whether any documents are linked — renders
            here, so no number is ever dropped. */}
        {looseRegs.length > 0 && (
          <section data-testid="entity-loose-registrations">
            <SectionLabel>Other registration numbers</SectionLabel>
            <div className="mt-3 card-flat py-1">
              <ul className="divide-y divide-border-soft">
                {looseRegs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2" data-testid={`reg-${r.id}`}>
                    <span className="text-sm text-text">{r.label}</span>
                    {r.number && (
                      <>
                        <span className="text-xs font-mono text-text-mute">№ {r.number}</span>
                        <CopyValueButton value={r.number} label={`${r.label} number`} />
                      </>
                    )}
                    {r.expiresOn && <MonoChip tone={expiryTone(r.expiresOn)}>{expiryText(r.expiresOn)}</MonoChip>}
                    <span className="text-[11px] text-text-faint ml-auto">
                      {r.issuer ?? ""}{r.issuedOn ? ` · issued ${r.issuedOn}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-text-faint px-4 py-1.5">
                Registrations without their own uploaded document — link the certificate from the Document Library to turn these into cards.
              </p>
            </div>
          </section>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          {/* Owners */}
          {e.owners.length > 0 && (
            <section>
              <SectionLabel>Ownership & management</SectionLabel>
              <div className="mt-4 space-y-3">
                {e.owners.map((o) => (
                  <div key={o.name} className="card-flat p-3.5 flex flex-col justify-center">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-text">{o.name}</span>
                      {typeof o.sharePct === "number" && <MonoChip>{o.sharePct}%</MonoChip>}
                    </div>
                    <div className="text-[11px] text-text-faint mt-1.5">
                      {(o.roles ?? []).join(", ")}
                      {o.nationality ? ` · ${o.nationality}` : ""}
                      {o.passportNo ? ` · passport ${o.passportNo}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Premises & lease */}
          {(e.premises || e.lease) && (
            <section>
              <SectionLabel>Premises & lease</SectionLabel>
              <div className="mt-4 card-flat p-4 space-y-2">
                {e.premises && (
                  <>
                    <CopyInfoRow label="Address" value={e.premises.addressLine} />
                    <CopyInfoRow label="Unit" value={e.premises.unit} />
                    <CopyInfoRow label="Building" value={e.premises.building} />
                    <CopyInfoRow label="Area" value={e.premises.area} />
                    <CopyInfoRow label="Plot" value={e.premises.plotNumber} />
                    <CopyInfoRow label="Makani" value={e.premises.makaniNo} />
                    <InfoRow label="Size" value={e.premises.sizeSqm ? `${e.premises.sizeSqm} sqm` : null} />
                  </>
                )}
                {e.lease && (
                  <>
                    <CopyInfoRow label="Ejari contract" value={e.lease.contractNo} />
                    <CopyInfoRow label="Lessor" value={e.lease.lessorName} />
                    <InfoRow
                      label="Lease term"
                      value={e.lease.startDate || e.lease.endDate ? (
                        <span className="flex items-center gap-2">
                          {e.lease.startDate ?? "…"} → {e.lease.endDate ?? "…"}
                          {e.lease.endDate && <MonoChip tone={expiryTone(e.lease.endDate)}>{expiryText(e.lease.endDate)}</MonoChip>}
                        </span>
                      ) : null}
                    />
                    <InfoRow label="Annual rent" value={fmtAed(e.lease.annualRentAed)} />
                    <InfoRow label="Deposit" value={fmtAed(e.lease.securityDepositAed)} />
                  </>
                )}
                {e.premises && (() => {
                  // Compose from every structured component; addressLine is
                  // included only when it adds something the components
                  // don't already cover (it usually restates unit/building/
                  // area, which would duplicate).
                  const parts = [
                    e.premises.unit && `Office ${e.premises.unit}`,
                    e.premises.building,
                    e.premises.area,
                  ].filter(Boolean) as string[];
                  const line = e.premises.addressLine?.trim();
                  const componentsCovered =
                    line && parts.every((p) => line.toLowerCase().includes(String(p).replace(/^Office /, "").toLowerCase()));
                  const fullAddress = [
                    componentsCovered ? line : [line, ...parts].filter(Boolean).join(", "),
                    e.premises.city,
                    countryLabel(e.country),
                  ]
                    .filter(Boolean)
                    .join(", ");
                  if (!fullAddress) return null;
                  return (
                    <div className="pt-2 border-t border-border-soft">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="button-copy-full-address"
                        onClick={() => {
                          void navigator.clipboard.writeText(fullAddress).then(() =>
                            toast({ title: "Full address copied", description: fullAddress }),
                          );
                        }}
                      >
                        <Copy className="w-3.5 h-3.5 mr-1" /> Copy full address
                      </Button>
                    </div>
                  );
                })()}
              </div>
            </section>
          )}
        </div>

        {/* Activities — defensively de-duplicated by English name (extracts
            occasionally store the same activity once with and once without
            its code; keep one row, preferring the coded variant). Each row
            and the whole list are copyable. */}
        {e.activities.length > 0 && (() => {
          const byName = new Map<string, (typeof e.activities)[number]>();
          for (const a of e.activities) {
            const key = (a.nameEn ?? "").trim().toLowerCase();
            const prev = byName.get(key);
            if (!prev || (!prev.code && a.code)) byName.set(key, { ...prev, ...a, code: a.code || prev?.code || "" });
          }
          const acts = [...byName.values()];
          const actText = (a: (typeof acts)[number]) => [a.code, a.nameEn].filter(Boolean).join(" — ");
          return (
            <section>
              <div className="flex items-center gap-3">
                <SectionLabel>Licensed activities</SectionLabel>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="button-copy-all-activities"
                  onClick={() => {
                    void writeClipboard(acts.map(actText).join("\n")).then((ok) =>
                      toast(
                        ok
                          ? { title: "Activities copied", description: `${acts.length} licensed activities` }
                          : { title: "Copy failed", description: "Your browser blocked clipboard access — copy manually.", variant: "destructive" },
                      ),
                    );
                  }}
                >
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy all
                </Button>
              </div>
              <div className="card-flat mt-4 py-2">
                <ul className="divide-y divide-border-soft">
                  {acts.map((a) => (
                    <li key={`${a.code}-${a.nameEn}`} className="text-sm px-4 py-2 flex items-baseline gap-3" data-testid={`activity-${a.code || a.nameEn}`}>
                      <span className="font-mono text-xs text-gold whitespace-nowrap w-16">{a.code}</span>
                      <span className="text-text flex-1">{a.nameEn}</span>
                      {a.nameAr && <span className="text-text-faint text-xs" dir="rtl">{a.nameAr}</span>}
                      <CopyValueButton value={actText(a)} label={`activity ${a.nameEn}`} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })()}

        {/* Task #1065 — bank accounts linked to this legal entity. */}
        <BankAccountsSection
          entity={e}
          accounts={bankAccounts}
          canWrite={!!canManageBank}
          onChanged={refresh}
        />

        {/* Task #1165 — WPS config read-only display. */}
        {e.statutory?.wps && (
          <section data-testid="entity-wps-config">
            <SectionLabel>WPS / Statutory payroll</SectionLabel>
            <div className="mt-4 card-flat p-4 space-y-2">
              {e.statutory.wps.applicable === true && (
                <InfoRow label="WPS applicability" value="Applicable (mainland WPS)" />
              )}
              {e.statutory.wps.applicable === false && (
                <InfoRow label="WPS applicability" value="Exempt (DIFC / ADGM or non-AE)" />
              )}
              {e.statutory.wps.employerUniqueId && (
                <CopyInfoRow label="MOHRE Employer Unique ID" value={e.statutory.wps.employerUniqueId} />
              )}
              {e.statutory.wps.agentBankRoutingCode && (
                <CopyInfoRow label="Agent-bank routing code" value={e.statutory.wps.agentBankRoutingCode} />
              )}
              {!e.statutory.wps.employerUniqueId && !e.statutory.wps.agentBankRoutingCode && e.statutory.wps.applicable !== false && (
                <p className="text-xs text-warn" data-testid="text-wps-missing-ids">
                  WPS employer ID and agent-bank routing code are not set — SIF export will be blocked until they are filled in.
                </p>
              )}
            </div>
          </section>
        )}

        {e.notes && <p className="text-xs text-text-faint italic">{e.notes}</p>}
      </div>

      <EntityFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setApplied(null); }}
        editing={applied ? applied.editing : e}
        initialDraft={applied?.draft ?? null}
        extractionNote={applied?.note ?? null}
        onSaved={refresh}
      />
      <ExtractDialog
        open={extractOpen}
        onClose={() => setExtractOpen(false)}
        entities={[e]}
        onApply={(draft, editing, note) => {
          setApplied({ draft, editing, note: note || "Cross-check against the source PDF." });
          setFormOpen(true);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task #1065 — Bank accounts: list + add/edit dialog with bank-letter
// dropzone. The letter is uploaded to the vault (linked to this entity),
// parsed by AI, and only PREFILLS the form — nothing saves without review.
// ---------------------------------------------------------------------------

const API_BASE = "/api/atelier";

const PURPOSE_LABEL: Record<string, string> = {
  operating: "Operating",
  payroll: "Payroll",
  tax: "Tax",
  savings: "Savings",
  client_money: "Client money",
  other: "Other",
};

interface BankDraft {
  bankName: string;
  accountLabel: string;
  accountHolderName: string;
  iban: string;
  accountNumber: string;
  swift: string;
  currency: string;
  purpose: string;
}

const EMPTY_BANK_DRAFT: BankDraft = {
  bankName: "",
  accountLabel: "",
  accountHolderName: "",
  iban: "",
  accountNumber: "",
  swift: "",
  currency: "AED",
  purpose: "operating",
};

function BankAccountsSection(props: {
  entity: LegalEntityRow;
  accounts: EntityBankAccount[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EntityBankAccount | null>(null);
  const accounts = props.accounts;

  async function setActive(a: EntityBankAccount, isActive: boolean) {
    try {
      await jsonReq("PATCH", `/wallet/bank/accounts/${a.id}`, { isActive });
      toast({ title: isActive ? "Account reactivated" : "Account deactivated" });
      props.onChanged();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  if (accounts.length === 0 && !props.canWrite) return null;

  return (
    <section data-testid="entity-bank-accounts">
      <div className="flex items-center gap-3">
        <SectionLabel>Bank accounts</SectionLabel>
        {props.canWrite && (
          <Button
            size="sm"
            variant="outline"
            data-testid="button-add-bank-account"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add bank account
          </Button>
        )}
      </div>
      {accounts.length === 0 ? (
        <p className="text-xs text-text-faint mt-3">
          No bank accounts recorded for this entity yet. Add one manually or drop in a bank letter to read the details automatically.
        </p>
      ) : (
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {accounts.map((a) => (
            <div key={a.id} className={`card-flat p-4 space-y-2 ${a.isActive ? "" : "opacity-60"}`} data-testid={`bank-account-${a.id}`}>
              <div className="flex items-start gap-2">
                <Landmark className="w-4 h-4 text-gold mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text">{a.bankName}</div>
                  <div className="text-[11px] text-text-faint">{a.accountLabel}</div>
                </div>
                {a.purpose && <MonoChip>{PURPOSE_LABEL[a.purpose] ?? a.purpose}</MonoChip>}
                {!a.isActive && <MonoChip tone="amber">Inactive</MonoChip>}
              </div>
              <div className="space-y-1.5">
                {a.accountHolderName && <CopyInfoRow label="Account holder" value={a.accountHolderName} />}
                <CopyInfoRow label="IBAN" value={a.iban} />
                <CopyInfoRow label="Account" value={a.accountNumberLast4 ? `•••• ${a.accountNumberLast4}` : null} copyValue={a.accountNumberLast4 ?? undefined} />
                <CopyInfoRow label="SWIFT / BIC" value={a.swift} />
                <InfoRow label="Currency" value={a.currency} />
              </div>
              {props.canWrite && (
                <div className="flex gap-2 pt-1 border-t border-border-soft">
                  <Button size="sm" variant="ghost" data-testid={`button-edit-bank-${a.id}`} onClick={() => { setEditing(a); setDialogOpen(true); }}>
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" data-testid={`button-toggle-bank-${a.id}`} onClick={() => void setActive(a, !a.isActive)}>
                    {a.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <BankAccountDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        entity={props.entity}
        editing={editing}
        onSaved={props.onChanged}
      />
    </section>
  );
}

function BankAccountDialog(props: {
  open: boolean;
  onClose: () => void;
  entity: LegalEntityRow;
  editing: EntityBankAccount | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<BankDraft>(EMPTY_BANK_DRAFT);
  const [busy, setBusy] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);
  const [parseNote, setParseNote] = React.useState<string | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!props.open) return;
    setParseNote(null);
    setParseError(null);
    if (props.editing) {
      setDraft({
        bankName: props.editing.bankName,
        accountLabel: props.editing.accountLabel,
        accountHolderName: props.editing.accountHolderName ?? "",
        iban: props.editing.iban ?? "",
        accountNumber: "",
        swift: props.editing.swift ?? "",
        currency: props.editing.currency,
        purpose: props.editing.purpose ?? "operating",
      });
    } else {
      setDraft(EMPTY_BANK_DRAFT);
    }
  }, [props.open, props.editing]);

  const set = (k: keyof BankDraft) => (ev: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: ev.target.value }));

  async function parseLetter(file: File) {
    setParsing(true);
    setParseError(null);
    setParseNote(null);
    try {
      // 1. Upload the letter to the vault, linked to this entity.
      const fd = new FormData();
      fd.set("title", `Bank letter — ${file.name.replace(/\.[^.]+$/, "")}`);
      fd.set("category", "corporate_legal");
      fd.set("entityId", props.entity.id);
      fd.set("file", file);
      const up = await fetch(`${API_BASE}/documents`, { method: "POST", credentials: "include", body: fd });
      const upBody = (await up.json().catch(() => ({}))) as { document?: { id?: string }; id?: string; error?: string; message?: string };
      if (!up.ok) throw new Error(upBody.message ?? upBody.error ?? `upload failed (${up.status})`);
      const documentId = upBody.document?.id ?? upBody.id;
      if (!documentId) throw new Error("upload did not return a document id");
      // 2. Ask the AI to read it. This only prefills the form below.
      const resp = await jsonReq<{ proposal?: { confidenceNote?: string; fields?: Record<string, unknown> } }>(
        "POST",
        `/finance/entities/${props.entity.id}/bank-letter-extract`,
        { documentId },
      );
      const f = resp.proposal?.fields ?? {};
      const s = (v: unknown) => (typeof v === "string" ? v : "");
      setDraft((d) => ({
        ...d,
        bankName: s(f.bankName) || d.bankName,
        accountHolderName: s(f.accountHolderName) || d.accountHolderName,
        iban: s(f.iban) || d.iban,
        accountNumber: s(f.accountNumber) || d.accountNumber,
        swift: s(f.swift) || d.swift,
        currency: s(f.currency) || d.currency,
        accountLabel: d.accountLabel || (s(f.bankName) ? `${s(f.bankName)} account` : d.accountLabel),
      }));
      setParseNote(
        resp.proposal?.confidenceNote?.trim() ||
          "Details read from the letter — please double-check them against the document before saving.",
      );
      toast({ title: "Bank letter read", description: "Check the prefilled details, then save." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The letter could not be read.";
      setParseError(
        /unreadable|no usable text/i.test(msg)
          ? "We couldn't read text from this file (it may be a photo/scan). The letter was saved to the vault — please type the details in below."
          : `The letter could not be read automatically (${msg}). Please type the details in below.`,
      );
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!draft.bankName.trim()) { toast({ title: "Bank name is required", variant: "destructive" }); return; }
    const isEdit = !!props.editing;
    const acctDigits = draft.accountNumber.replace(/\D/g, "");
    if (!isEdit && !acctDigits && !draft.iban.trim()) {
      toast({ title: "Enter an IBAN or an account number", variant: "destructive" });
      return;
    }
    const ibanNorm = draft.iban.replace(/\s+/g, "").toUpperCase();
    if (ibanNorm && !/^[A-Z0-9]{8,34}$/.test(ibanNorm)) {
      toast({ title: "That IBAN doesn't look right", description: "Use only letters and digits, 8–34 characters (e.g. AE07 0331 2345 6789 0123 456).", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        bankName: draft.bankName.trim(),
        accountLabel: draft.accountLabel.trim() || `${draft.bankName.trim()} account`,
        iban: ibanNorm || null,
        swift: draft.swift.trim() || null,
        accountHolderName: draft.accountHolderName.trim() || null,
        currency: draft.currency.trim().toUpperCase() || "AED",
        purpose: draft.purpose,
      };
      if (acctDigits) payload.accountNumberLast4 = acctDigits.slice(-4);
      if (props.editing) {
        await jsonReq("PATCH", `/wallet/bank/accounts/${props.editing.id}`, payload);
        toast({ title: "Bank account updated" });
      } else {
        payload.legalEntityId = props.entity.id;
        payload.accountNumberLast4 = acctDigits ? acctDigits.slice(-4) : ibanNorm.slice(-4);
        await jsonReq("POST", `/wallet/bank/accounts`, payload);
        toast({ title: "Bank account added" });
      }
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.editing ? "Edit bank account" : "Add bank account"}</DialogTitle>
          <DialogDescription>
            {props.editing
              ? `Update the ${props.editing.bankName} account details.`
              : `Link a bank account to ${props.entity.shortName ?? props.entity.legalNameEn}.`}
          </DialogDescription>
        </DialogHeader>

        {!props.editing && (
          <div
            data-testid="bank-letter-dropzone"
            className={`rounded border border-dashed px-4 py-5 text-center text-xs cursor-pointer transition-colors ${dragOver ? "border-gold bg-bg-deep" : "border-border-soft text-text-faint hover:border-gold/60"}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(ev) => { ev.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(ev) => {
              ev.preventDefault();
              setDragOver(false);
              const file = ev.dataTransfer.files?.[0];
              if (file && !parsing) void parseLetter(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              data-testid="input-bank-letter-file"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                ev.target.value = "";
                if (file && !parsing) void parseLetter(file);
              }}
            />
            {parsing ? (
              <span className="inline-flex items-center gap-2 text-text"><Loader2 className="w-4 h-4 animate-spin" /> Reading the bank letter…</span>
            ) : (
              <span className="inline-flex items-center gap-2"><UploadCloud className="w-4 h-4" /> Drop a bank letter here (or click) to fill in the details automatically</span>
            )}
          </div>
        )}
        {parseNote && <p className="text-[11px] text-gold" data-testid="text-parse-note">{parseNote}</p>}
        {parseError && <p className="text-[11px] text-destructive" data-testid="text-parse-error">{parseError}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Bank name</Label>
            <Input value={draft.bankName} onChange={set("bankName")} placeholder="Emirates NBD" data-testid="input-bank-name" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Account holder</Label>
            <Input value={draft.accountHolderName} onChange={set("accountHolderName")} placeholder={props.entity.legalNameEn ?? ""} data-testid="input-bank-holder" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">IBAN</Label>
            <Input value={draft.iban} onChange={set("iban")} placeholder="AE07 0331 2345 6789 0123 456" data-testid="input-bank-iban" />
          </div>
          <div>
            <Label className="text-xs">Account number{props.editing ? " (leave blank to keep)" : ""}</Label>
            <Input value={draft.accountNumber} onChange={set("accountNumber")} placeholder="1015…" data-testid="input-bank-account-number" />
          </div>
          <div>
            <Label className="text-xs">SWIFT / BIC</Label>
            <Input value={draft.swift} onChange={set("swift")} placeholder="EBILAEAD" data-testid="input-bank-swift" />
          </div>
          <div>
            <Label className="text-xs">Currency</Label>
            <Input value={draft.currency} onChange={set("currency")} maxLength={3} data-testid="input-bank-currency" />
          </div>
          <div>
            <Label className="text-xs">Purpose</Label>
            <select
              className="w-full h-9 rounded border border-border-soft bg-transparent px-2 text-sm"
              value={draft.purpose}
              onChange={(ev) => setDraft((d) => ({ ...d, purpose: ev.target.value }))}
              data-testid="select-bank-purpose"
            >
              {Object.entries(PURPOSE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Label</Label>
            <Input value={draft.accountLabel} onChange={set("accountLabel")} placeholder="Operating account" data-testid="input-bank-label" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={props.onClose} data-testid="button-bank-cancel">Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || parsing} data-testid="button-bank-save">
            {busy ? "Saving…" : props.editing ? "Save changes" : "Add account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
