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
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, BackLink } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe } from "@workspace/api-client-react";
import {
  useLegalEntities,
  useLegalEntityDetail,
  type LegalEntityRow,
  type LegalEntityLinkedDoc,
} from "@/lib/v5-hooks";
import {
  jsonReq,
  countryLabel,
  STATUS_LABEL,
  expiryTone,
  expiryText,
  fmtAed,
  InfoRow,
  EntityFormDialog,
} from "./FinanceEntities";
import { Pencil, Archive, FileText, ExternalLink, Vault } from "lucide-react";

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

function DocCard(props: {
  doc: LegalEntityLinkedDoc;
  canWrite: boolean;
  onKindChange: (kind: string | null) => void;
  /** ISO expiry date for compliance docs (colored chip); null = no chip. */
  expiresOn?: string | null;
  muted?: boolean;
}) {
  const d = props.doc;
  return (
    <div
      className={`rounded-md border border-border-soft p-3 flex flex-col gap-2${props.muted ? " opacity-70" : ""}`}
      data-testid={`entity-doc-${d.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-text-mute shrink-0" />
            <a
              href={`/api/atelier/documents/${d.id}/download`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-text hover:text-gold truncate"
              data-testid={`link-open-doc-${d.id}`}
              title="Open the file"
            >
              {d.title}
            </a>
            <ExternalLink className="w-3 h-3 text-text-faint shrink-0" />
          </div>
          {d.fileName && (
            <div className="text-[11px] text-text-faint font-mono mt-0.5 truncate">{d.fileName}</div>
          )}
          {props.expiresOn && (
            <div className="mt-1">
              <MonoChip tone={expiryTone(props.expiresOn)}>{expiryText(props.expiresOn)}</MonoChip>
            </div>
          )}
        </div>
        <a
          href={`/documents?open=${d.id}`}
          className="shrink-0 text-text-faint hover:text-gold"
          title="View in document vault"
          data-testid={`link-vault-doc-${d.id}`}
        >
          <Vault className="w-3.5 h-3.5" />
        </a>
      </div>
      {props.canWrite ? (
        <select
          className="h-7 w-full rounded border border-border bg-bg-elevate px-1.5 text-[11px] font-mono text-text-mute outline-none focus-visible:border-gold"
          value={d.docKind ?? ""}
          onChange={(e) => props.onKindChange(e.target.value || null)}
          data-testid={`select-doc-kind-${d.id}`}
        >
          <option value="">Unclassified</option>
          {KIND_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      ) : (
        d.docKind && <MonoChip>{KIND_LABEL[d.docKind] ?? d.docKind}</MonoChip>
      )}
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
  const { entity: e, documents, isLoading, isError } = useLegalEntityDetail(id);
  // Used only to refresh the grid cache after edits from this page.
  useLegalEntities(true);

  const archived = e?.status === "archived";
  const canWrite = (me?.role === "founding_partner" || me?.role === "partner") && !archived;
  const [formOpen, setFormOpen] = React.useState(false);

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
                <Button size="sm" variant="outline" onClick={() => setFormOpen(true)} data-testid="button-edit-entity-detail">
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
        {/* Documents — tiered shelf: compliance first, then constitutional,
            then a collapsed formation-history accordion. */}
        <section data-testid="entity-documents-shelf">
          <SectionHead headline="Documents" />
          {documents.length === 0 ? (
            <p className="text-sm text-text-mute mt-2">
              No linked documents yet — link corporate/legal documents to this entity from the Document Library.
            </p>
          ) : (
            <div className="space-y-6 mt-3">
              {(tiers.compliance.length > 0 || tiers.unclassified.length > 0) && (
                <div data-testid="doc-tier-compliance">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-medium text-text">{TIER_META.compliance.title}</h2>
                    <span className="text-[11px] text-text-faint">{TIER_META.compliance.blurb}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {tiers.compliance.map((d) => (
                      <DocCard
                        key={d.id}
                        doc={d}
                        expiresOn={docExpiry(d)}
                        canWrite={!!canWrite}
                        onKindChange={(k) => void setDocKind(d.id, k)}
                      />
                    ))}
                  </div>
                  {tiers.unclassified.length > 0 && (
                    <div className="mt-3" data-testid="doc-tier-unclassified">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-xs font-medium text-warn uppercase tracking-widest">
                          {TIER_META.unclassified.title}
                        </h3>
                        <span className="text-[11px] text-text-faint">{TIER_META.unclassified.blurb}</span>
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                        {tiers.unclassified.map((d) => (
                          <DocCard key={d.id} doc={d} canWrite={!!canWrite} onKindChange={(k) => void setDocKind(d.id, k)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tiers.constitutional.length > 0 && (
                <div data-testid="doc-tier-constitutional">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-medium text-text">{TIER_META.constitutional.title}</h2>
                    <span className="text-[11px] text-text-faint">{TIER_META.constitutional.blurb}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {tiers.constitutional.map((d) => (
                      <DocCard key={d.id} doc={d} canWrite={!!canWrite} onKindChange={(k) => void setDocKind(d.id, k)} />
                    ))}
                  </div>
                </div>
              )}

              {tiers.history.length > 0 && (
                <details data-testid="doc-tier-history" className="group">
                  <summary className="flex items-center gap-2 cursor-pointer list-none select-none">
                    <span className="text-sm font-medium text-text-mute group-open:text-text">
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
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {tiers.history.map((d) => (
                      <DocCard key={d.id} doc={d} muted canWrite={!!canWrite} onKindChange={(k) => void setDocKind(d.id, k)} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>

        {/* Registrations */}
        {e.registrations.length > 0 && (
          <section>
            <SectionHead headline="Registrations & licenses" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
              {e.registrations.map((r) => (
                <div key={r.id} className="rounded-md border border-border-soft p-2.5" data-testid={`reg-${r.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text truncate">{r.label}</span>
                    {r.expiresOn && <MonoChip tone={expiryTone(r.expiresOn)}>{expiryText(r.expiresOn)}</MonoChip>}
                  </div>
                  <div className="text-xs text-text-mute font-mono mt-0.5">{r.number}</div>
                  <div className="text-[11px] text-text-faint mt-0.5">
                    {r.issuer ?? ""}{r.issuedOn ? ` · issued ${r.issuedOn}` : ""}{r.expiresOn ? ` · expires ${r.expiresOn}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Owners */}
          {e.owners.length > 0 && (
            <section>
              <SectionHead headline="Ownership & management" />
              <div className="mt-2 space-y-2">
                {e.owners.map((o) => (
                  <div key={o.name} className="rounded-md border border-border-soft p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text">{o.name}</span>
                      {typeof o.sharePct === "number" && <MonoChip>{o.sharePct}%</MonoChip>}
                    </div>
                    <div className="text-[11px] text-text-faint mt-0.5">
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
              <SectionHead headline="Premises & lease" />
              <div className="mt-2">
                {e.premises && (
                  <>
                    <InfoRow label="Address" value={e.premises.addressLine} />
                    <InfoRow label="Unit" value={e.premises.unit} />
                    <InfoRow label="Building" value={e.premises.building} />
                    <InfoRow label="Area" value={e.premises.area} />
                    <InfoRow label="Plot" value={e.premises.plotNumber} />
                    <InfoRow label="Makani" value={e.premises.makaniNo} />
                    <InfoRow label="Size" value={e.premises.sizeSqm ? `${e.premises.sizeSqm} sqm` : null} />
                  </>
                )}
                {e.lease && (
                  <>
                    <InfoRow label="Ejari contract" value={e.lease.contractNo} />
                    <InfoRow label="Lessor" value={e.lease.lessorName} />
                    <InfoRow
                      label="Lease term"
                      value={e.lease.startDate || e.lease.endDate ? (
                        <span>
                          {e.lease.startDate ?? "…"} → {e.lease.endDate ?? "…"}{" "}
                          {e.lease.endDate && <MonoChip tone={expiryTone(e.lease.endDate)}>{expiryText(e.lease.endDate)}</MonoChip>}
                        </span>
                      ) : null}
                    />
                    <InfoRow label="Annual rent" value={fmtAed(e.lease.annualRentAed)} />
                    <InfoRow label="Deposit" value={fmtAed(e.lease.securityDepositAed)} />
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Activities */}
        {e.activities.length > 0 && (
          <section>
            <SectionHead headline="Licensed activities" />
            <ul className="mt-2 space-y-1">
              {e.activities.map((a) => (
                <li key={`${a.code}-${a.nameEn}`} className="text-sm flex items-baseline gap-2">
                  <span className="font-mono text-xs text-gold whitespace-nowrap">{a.code}</span>
                  <span className="text-text">{a.nameEn}</span>
                  {a.nameAr && <span className="text-text-faint text-xs" dir="rtl">{a.nameAr}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {e.notes && <p className="text-xs text-text-faint italic">{e.notes}</p>}
      </div>

      <EntityFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={e}
        initialDraft={null}
        extractionNote={null}
        onSaved={refresh}
      />
    </div>
  );
}
