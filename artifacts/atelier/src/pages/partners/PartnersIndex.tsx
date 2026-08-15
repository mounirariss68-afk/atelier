/**
 * Partners lens — unified partner registry + real CRUD (Task #513).
 *
 * Lifecycle: Identify → Qualify → Co-sell → Co-deliver → Govern → Renew.
 * All data comes from the unified partner-firm registry and its child
 * records via codegen'd hooks (openapi.yaml → orval). The former hardcoded
 * sections (MDF, joint marketing, QBRs, scorecards, sub-contract SOWs,
 * frameworks, renewals, tier-change feeds, off-boardings) were removed —
 * see docs/PARTNERS_BACKLOG.md.
 *
 *   Identify   — partner-firm directory (CRUD) + target partners (CRUD + promote)
 *   Qualify    — framework fit scorecard per firm (Cartographer-driven, adjustable) + NDA status from real e-sign agreements
 *   Co-sell    — joint pipeline linked to real CRM opportunities (CRUD)
 *   Co-deliver — real partner-firm-resource assignments + RCTI self-billing invoices
 *   Govern     — e-sign agreements with partner firms + certifications + conflicts (CRUD)
 *   Renew      — firm status lifecycle + tier-change history on the registry record
 */
import * as React from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { RecordCard, RecordCardAction } from "@/components/ui/record-card";
import { ViewToggle, useViewMode, RecordRow } from "@/components/ui/view-toggle";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { AllianceEvaluationPanel, AllianceVerdictChip } from "./AllianceEvaluation";
import {
  Handshake,
  GitMerge,
  Award,
  AlertTriangle,
  Search,
  Wrench,
  Shield,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  Plus,
  Archive,
  ArrowUpRight,
  Sparkles,
  Check,
  X,
} from "lucide-react";
import {
  useAtelierGetMe,
  useAtelierListPartnerFirms,
  useAtelierCreatePartnerFirm,
  useAtelierUpdatePartnerFirm,
  useAtelierAdjustPartnerFitScorecard,
  useAtelierArchivePartnerFirm,
  useAtelierListPartnerTargets,
  useAtelierCreatePartnerTarget,
  useAtelierUpdatePartnerTarget,
  useAtelierArchivePartnerTarget,
  useAtelierPromotePartnerTarget,
  useAtelierListJointPipeline,
  useAtelierCreateJointPipelineEntry,
  useAtelierUpdateJointPipelineEntry,
  useAtelierArchiveJointPipelineEntry,
  useAtelierListPartnerCertifications,
  useAtelierCreatePartnerCertification,
  useAtelierUpdatePartnerCertification,
  useAtelierArchivePartnerCertification,
  useAtelierListPartnerConflicts,
  useAtelierCreatePartnerConflict,
  useAtelierUpdatePartnerConflict,
  useAtelierArchivePartnerConflict,
  useAtelierListPartnerAgreements,
  useAtelierGetPartnerCoDeliver,
  useAtelierListOpportunities,
  useAtelierListPartnerFirmQuotedDeals,
  getAtelierListPartnerFirmsQueryKey,
  getAtelierListPartnerTargetsQueryKey,
  getAtelierListJointPipelineQueryKey,
  getAtelierListPartnerCertificationsQueryKey,
  getAtelierListPartnerConflictsQueryKey,
} from "@workspace/api-client-react";
import type {
  AtelierPartnerFirm,
  AtelierPartnerFirmInput,
  AtelierPartnerTarget,
  AtelierPartnerTargetInput,
  AtelierJointPipelineEntry,
  AtelierJointPipelineInput,
  AtelierPartnerCertification,
  AtelierPartnerCertificationInput,
  AtelierPartnerConflict,
  AtelierPartnerConflictInput,
} from "@workspace/api-client-react";

const STAGES = [
  { id: "identify", label: "Identify", href: "/partners/identify", icon: Search, blurb: "Partner-firm directory and target-partner funnel." },
  { id: "qualify", label: "Qualify", href: "/partners/qualify", icon: CheckCircle2, blurb: "Framework fit scorecard and NDA status from real e-sign agreements." },
  { id: "co-sell", label: "Co-sell", href: "/partners/co-sell", icon: GitMerge, blurb: "Joint pipeline linked to real CRM opportunities." },
  { id: "co-deliver", label: "Co-deliver", href: "/partners/co-deliver", icon: Wrench, blurb: "Partner-firm resources on engagements and RCTI self-billing." },
  { id: "govern", label: "Govern", href: "/partners/govern", icon: Shield, blurb: "Agreements, certifications, and conflict checks." },
  { id: "renew", label: "Renew", href: "/partners/renew", icon: RefreshCw, blurb: "Firm status lifecycle and tier-change history." },
] as const;

type StageId = (typeof STAGES)[number]["id"];
const KNOWN_SECTIONS = new Set<string>(["overview", ...STAGES.map((s) => s.id)]);

const EDITOR_ROLES = new Set(["founding_partner", "partner", "senior_manager", "finance"]);
const TIERS = ["strategic", "preferred", "transactional"] as const;
const FIRM_STATUSES = ["active", "renewal_due", "paused", "offboarded", "terminated"] as const;
const TARGET_STATUSES = ["researching", "outreach", "intro_call", "evaluating", "promoted", "dropped"] as const;
// Task #530 — the alliance framework's nine weighted fit dimensions (must
// mirror ALLIANCE_FIT_DIMENSIONS on the server; scores are 1–5, weights sum
// to 1.0; the weighted total + verdict are always computed server-side).
const FIT_DIMENSIONS = [
  { id: "service_alignment", label: "Service alignment", weight: 0.2 },
  { id: "industry_coverage", label: "Industry coverage", weight: 0.15 },
  { id: "delivery_economics", label: "Delivery economics", weight: 0.15 },
  { id: "references", label: "References", weight: 0.1 },
  { id: "footprint", label: "Regional footprint", weight: 0.1 },
  { id: "ai_differentiation", label: "AI differentiation", weight: 0.1 },
  { id: "relationship_fit", label: "Relationship fit", weight: 0.1 },
  { id: "portfolio_complementarity", label: "Portfolio complementarity", weight: 0.05 },
  { id: "region_relevance", label: "Region relevance", weight: 0.05 },
] as const;

const QUALIFY_API = `${import.meta.env.BASE_URL}api/atelier`;

function useCanEdit(): boolean {
  const { data: me } = useAtelierGetMe();
  return !!me?.role && EDITOR_ROLES.has(me.role);
}

function errMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as {
      body?: { error?: string; message?: string };
      data?: { error?: string; message?: string };
      message?: string;
    };
    return (
      anyE.data?.message ??
      anyE.data?.error ??
      anyE.body?.message ??
      anyE.body?.error ??
      anyE.message ??
      "Request failed"
    );
  }
  return "Request failed";
}

// ---- small form primitives (match atelier input styling) -------------------
const inputCls =
  "w-full bg-bg-deep border border-border rounded-sm px-2.5 py-1.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls} />;
}

function FormError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="text-xs text-red-400">{msg}</p>;
}

export default function PartnersIndex() {
  const [, params] = useRoute<{ section?: string }>("/partners/:section");
  const raw = params?.section ?? "overview";
  // Unknown section deep-links fall through to the lifecycle ribbon home.
  const section = (KNOWN_SECTIONS.has(raw) ? raw : "overview") as StageId | "overview";

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        backHref="/"
        backLabel="Home"
        headline="Alliance lifecycle — from ecosystem map to framework renewal"
        lede="One registry of partner firms drives the whole lens: identify targets, qualify capability and NDAs, co-sell into a CRM-linked joint pipeline, co-deliver with partner resources and self-billing, govern agreements and conflicts, and manage renewal on the firm record itself."
      />
      <div className="container-atelier py-6">
        <div className="mt-2">
          {section === "overview" && <LifecycleRibbon />}
          {section === "identify" && <IdentifyView />}
          {section === "qualify" && <QualifyView />}
          {section === "co-sell" && <CoSellView />}
          {section === "co-deliver" && <CoDeliverView />}
          {section === "govern" && <GovernView />}
          {section === "renew" && <RenewView />}
        </div>
      </div>
    </div>
  );
}

// =============================================================
// OVERVIEW — lifecycle ribbon with live counts
// =============================================================
function LifecycleRibbon() {
  const { data: firmsData } = useAtelierListPartnerFirms();
  const { data: targetsData } = useAtelierListPartnerTargets();
  const { data: pipelineData } = useAtelierListJointPipeline();
  const { data: certsData } = useAtelierListPartnerCertifications();
  const { data: conflictsData } = useAtelierListPartnerConflicts();
  const { data: agreementsData } = useAtelierListPartnerAgreements();
  const { data: coDeliver } = useAtelierGetPartnerCoDeliver();

  const firms = firmsData?.items ?? [];
  const targets = (targetsData?.items ?? []).filter((t) => t.status !== "promoted" && t.status !== "dropped");
  const pipeline = pipelineData?.items ?? [];
  const certs = certsData?.items ?? [];
  const conflicts = (conflictsData?.items ?? []).filter((c) => c.status === "open");
  const agreements = agreementsData?.items ?? [];
  const resources = coDeliver?.resources ?? [];
  const invoices = coDeliver?.invoices ?? [];

  const qualified = firms.filter((f) => Object.keys(f.capabilities ?? {}).length > 0);
  const renewalDue = firms.filter((f) => f.status === "renewal_due");
  const windingDown = firms.filter((f) => f.status === "offboarded" || f.status === "terminated");
  const lapsing = certs.filter((c) => c.status === "lapsing");

  const counts: Record<StageId, { primary: string; secondary: string }> = {
    identify: {
      primary: `${firms.length} firm${firms.length === 1 ? "" : "s"}`,
      secondary: `${targets.length} targets in flight`,
    },
    qualify: {
      primary: `${qualified.length} scored`,
      secondary: `${agreements.length} agreements on file`,
    },
    "co-sell": {
      primary: `${pipeline.length} joint opps`,
      secondary: `${pipeline.filter((p) => p.partnerSourced).length} partner-sourced`,
    },
    "co-deliver": {
      primary: `${resources.length} partner resources`,
      secondary: `${invoices.length} RCTI invoices`,
    },
    govern: {
      primary: `${agreements.length} agreements`,
      secondary: `${conflicts.length} open conflicts · ${lapsing.length} certs lapsing`,
    },
    renew: {
      primary: `${renewalDue.length} renewal due`,
      secondary: `${windingDown.length} winding down`,
    },
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s, idx) => {
          const Icon = s.icon;
          const c = counts[s.id];
          return (
            <Link key={s.id} href={s.href} className="group" data-testid={`partners-stage-${s.id}`}>
              <Card hover className="p-4 h-full flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                    Stage {idx + 1}
                  </div>
                  <Icon className="w-4 h-4 text-gold/80 group-hover:text-gold transition-colors" />
                </div>
                <div className="font-medium text-text">{s.label}</div>
                <div className="text-2xl font-mono text-text">{c.primary}</div>
                <div className="text-xs text-text-faint">{c.secondary}</div>
                <div className="text-xs text-text-mute mt-2 leading-snug">{s.blurb}</div>
                <div className="mt-auto inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-gold/80 group-hover:text-gold">
                  open <ChevronRight className="w-3 h-3" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-text-faint">
        Joint-pipeline entries link to real opportunities in the Clients lens;
        co-delivery reads the partner-resource roster and RCTI self-billing;
        agreements come from the e-sign contract system. Nothing here is
        illustrative data.
      </p>
    </div>
  );
}

// =============================================================
// IDENTIFY — firm directory (CRUD) + target partners (CRUD + promote)
// =============================================================
type FirmDraft = {
  name: string;
  kind: string;
  speciality: string;
  country: string;
  tier: string;
  status: string;
  relationshipStrength: string;
  anchorCognirise: string;
  anchorPartner: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  partnershipStage: string;
  agreementStage: string;
};

const PARTNERSHIP_STAGES = ["consideration", "exploration", "agreed"] as const;
const emptyFirmDraft: FirmDraft = {
  name: "", kind: "", speciality: "", country: "", tier: "", status: "active",
  relationshipStrength: "", anchorCognirise: "", anchorPartner: "",
  contactName: "", contactEmail: "", notes: "",
  partnershipStage: "consideration", agreementStage: "",
};

function FirmStageChips({ firm: f }: { firm: AtelierPartnerFirm }) {
  const ps = f.partnershipStage ?? "consideration";
  return (
    <>
      <MonoChip tone={ps === "agreed" ? "green" : "amber"} data-testid={`chip-partnership-stage-${f.id}`}>
        {ps}
      </MonoChip>
      {ps === "agreed" && f.agreementStage && (
        <MonoChip
          tone={f.agreementStage === "signed" || f.agreementStage === "signing" ? "gold" : "default"}
          data-testid={`chip-agreement-stage-${f.id}`}
        >
          {f.agreementStage}
        </MonoChip>
      )}
    </>
  );
}
function firmDraftFrom(f: AtelierPartnerFirm): FirmDraft {
  return {
    name: f.name ?? "",
    kind: f.kind ?? "",
    speciality: f.speciality ?? "",
    country: f.country ?? "",
    tier: f.tier ?? "",
    status: f.status ?? "active",
    relationshipStrength: f.relationshipStrength != null ? String(f.relationshipStrength) : "",
    anchorCognirise: f.anchorCognirise ?? "",
    anchorPartner: f.anchorPartner ?? "",
    contactName: f.contactName ?? "",
    contactEmail: f.contactEmail ?? "",
    notes: f.notes ?? "",
    partnershipStage: f.partnershipStage ?? "consideration",
    agreementStage: f.agreementStage ?? "",
  };
}

function firmInputFrom(d: FirmDraft): AtelierPartnerFirmInput {
  return {
    name: d.name.trim(),
    kind: d.kind.trim() || null,
    speciality: d.speciality.trim() || null,
    country: d.country.trim() || null,
    tier: (d.tier || null) as AtelierPartnerFirmInput["tier"],
    status: d.status as AtelierPartnerFirmInput["status"],
    relationshipStrength: d.relationshipStrength ? Number(d.relationshipStrength) : null,
    anchorCognirise: d.anchorCognirise.trim() || null,
    anchorPartner: d.anchorPartner.trim() || null,
    contactName: d.contactName.trim() || null,
    contactEmail: d.contactEmail.trim() || null,
    notes: d.notes.trim() || null,
    partnershipStage: d.partnershipStage as AtelierPartnerFirmInput["partnershipStage"],
    agreementStage: (d.partnershipStage === "agreed"
      ? d.agreementStage || "preparing"
      : null) as AtelierPartnerFirmInput["agreementStage"],
  };
}

function FirmForm({
  initial, onSubmit, onCancel, busy, error, submitLabel,
}: {
  initial: FirmDraft;
  onSubmit: (d: FirmDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [d, setD] = React.useState(initial);
  const set = (k: keyof FirmDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.value });
  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name"><TextInput value={d.name} onChange={set("name")} placeholder="Firm name" data-testid="input-firm-name" /></Field>
        <Field label="Kind"><TextInput value={d.kind} onChange={set("kind")} placeholder="e.g. hyperscaler, boutique SI" /></Field>
        <Field label="Speciality"><TextInput value={d.speciality} onChange={set("speciality")} /></Field>
        <Field label="Country"><TextInput value={d.country} onChange={set("country")} /></Field>
        <Field label="Tier">
          <Select value={d.tier} onChange={set("tier")}>
            <option value="">—</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={set("status")}>
            {FIRM_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Partnership stage">
          <Select value={d.partnershipStage} onChange={set("partnershipStage")} data-testid="select-partnership-stage">
            {PARTNERSHIP_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        {d.partnershipStage === "agreed" && (
          <Field label="Agreement stage">
            <Select value={d.agreementStage || "preparing"} onChange={set("agreementStage")} data-testid="select-agreement-stage">
              {AGREEMENT_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Strength 1–5"><TextInput type="number" min={1} max={5} value={d.relationshipStrength} onChange={set("relationshipStrength")} /></Field>
        <Field label="Anchor · Cognirise"><TextInput value={d.anchorCognirise} onChange={set("anchorCognirise")} /></Field>
        <Field label="Anchor · Partner"><TextInput value={d.anchorPartner} onChange={set("anchorPartner")} /></Field>
        <Field label="Contact name"><TextInput value={d.contactName} onChange={set("contactName")} /></Field>
        <Field label="Contact email"><TextInput type="email" value={d.contactEmail} onChange={set("contactEmail")} /></Field>
        <Field label="Notes"><TextInput value={d.notes} onChange={set("notes")} /></Field>
      </div>
      <FormError msg={error} />
      <div className="flex gap-2">
        <PillButton disabled={busy || !d.name.trim()} onClick={() => onSubmit(d)} data-testid="button-firm-save">
          {busy ? "Saving…" : submitLabel}
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
      </div>
    </Card>
  );
}

function IdentifyView() {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: firmsData, error: firmsError, refetch: refetchFirms } = useAtelierListPartnerFirms();
  const firms = firmsData?.items ?? [];

  const invalidateFirms = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });
  };

  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  // Task #870 — duplicate-name guard + created-firm feedback.
  const [dupPending, setDupPending] = React.useState<{ draft: FirmDraft; existingName: string } | null>(null);
  const [createdFirm, setCreatedFirm] = React.useState<{ id: string; name: string } | null>(null);

  const create = useAtelierCreatePartnerFirm();
  const update = useAtelierUpdatePartnerFirm();

  // Task #870 — create with duplicate-name handling: a structured 409 from
  // the server surfaces a confirm-anyway card instead of a bare error.
  const submitCreate = (d: FirmDraft, confirmDuplicate: boolean) => {
    setErr(null);
    create.mutate(
      { data: { ...firmInputFrom(d), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) } },
      {
        onSuccess: (row) => {
          setAdding(false);
          setErr(null);
          setDupPending(null);
          setCreatedFirm(row?.id && row?.name ? { id: row.id, name: row.name } : null);
          invalidateFirms();
        },
        onError: (e) => {
          const apiErr = e as { status?: number; data?: { error?: string; existingName?: string } | null };
          if (apiErr.status === 409 && apiErr.data?.error === "duplicate-partner-firm-name") {
            setDupPending({ draft: d, existingName: apiErr.data.existingName ?? d.name.trim() });
          } else {
            setDupPending(null);
            setErr(errMessage(e));
          }
        },
      },
    );
  };

  const archive = useAtelierArchivePartnerFirm();
  const [evalOpenId, setEvalOpenId] = React.useState<string | null>(null);
  const [quotesOpenId, setQuotesOpenId] = React.useState<string | null>(null);
  // Task #873 — partner-portal login management (leadership only).
  const [loginsOpenId, setLoginsOpenId] = React.useState<string | null>(null);
  const { data: meForPortal } = useAtelierGetMe();
  const canManagePortal =
    meForPortal?.role === "founding_partner" || meForPortal?.role === "partner";
  // Task #874 — bank-detail review is finance OR leadership (mirrors the API).
  const canReviewBankChanges = canManagePortal || meForPortal?.role === "finance";
  // Task #1172 — firm document/contact review mirrors the API's partner-lens
  // editor gate (leadership + senior_manager + finance), wider than bank review.
  const canReviewFirmSubmissions =
    canReviewBankChanges || meForPortal?.role === "senior_manager";
  // Task #723 — list/card toggle, persisted per page.
  const [viewMode, setViewMode] = useViewMode("partners-directory");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Partner directory</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-faint inline-flex items-center gap-2">
              <Handshake className="w-3.5 h-3.5" />
              {firms.length} firm{firms.length === 1 ? "" : "s"}
            </span>
            <ViewToggle mode={viewMode} onChange={setViewMode} data-testid="view-toggle-partners" />
            {canEdit && !adding && (
              <PillButton variant="ghost" onClick={() => { setAdding(true); setErr(null); }} data-testid="button-add-firm">
                <Plus className="w-3.5 h-3.5 mr-1 inline" /> Add firm
              </PillButton>
            )}
          </div>
        </header>

        {firmsError != null && (
          <Card className="p-3 border-red-400/40 flex items-center justify-between gap-3" data-testid="firms-load-error">
            <p className="text-xs text-red-400">
              Couldn't load the partner directory: {errMessage(firmsError)}
            </p>
            <PillButton variant="ghost" onClick={() => void refetchFirms()} data-testid="button-retry-firms">
              Retry
            </PillButton>
          </Card>
        )}

        {createdFirm && (
          <Card className="p-3 border-gold/40 flex items-center justify-between gap-3" data-testid="firm-created-banner">
            <p className="text-xs text-text">
              Created partner firm <span className="text-gold font-medium">{createdFirm.name}</span>.
            </p>
            <div className="flex gap-2">
              <PillButton
                variant="ghost"
                onClick={() => {
                  document
                    .querySelector(`[data-testid="card-firm-${createdFirm.id}"], [data-testid="row-firm-${createdFirm.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                data-testid="button-view-created-firm"
              >
                View firm
              </PillButton>
              <PillButton variant="ghost" onClick={() => setCreatedFirm(null)}>
                Dismiss
              </PillButton>
            </div>
          </Card>
        )}

        {adding && (
          <>
            <FirmForm
              initial={emptyFirmDraft}
              busy={create.isPending}
              error={err}
              submitLabel="Create firm"
              onCancel={() => { setAdding(false); setErr(null); setDupPending(null); }}
              onSubmit={(d) => submitCreate(d, false)}
            />
            {dupPending && (
              <Card className="p-3 border-amber-400/50 space-y-2" data-testid="firm-duplicate-warning">
                <p className="text-xs text-amber-400">
                  A partner firm named "{dupPending.existingName}" already exists. Create another
                  firm with the same name anyway?
                </p>
                <div className="flex gap-2">
                  <PillButton
                    disabled={create.isPending}
                    onClick={() => submitCreate(dupPending.draft, true)}
                    data-testid="button-firm-create-anyway"
                  >
                    {create.isPending ? "Saving…" : "Create anyway"}
                  </PillButton>
                  <PillButton variant="ghost" onClick={() => setDupPending(null)}>
                    Go back
                  </PillButton>
                </div>
              </Card>
            )}
          </>
        )}

        {firms.length === 0 && !adding && (
          <p className="text-sm text-text-mute">
            No partner firms yet. {canEdit ? "Add the first firm or promote a target from below." : ""}
          </p>
        )}

        <div className={viewMode === "list" ? "space-y-2" : "grid gap-3 md:grid-cols-2"}>
          {firms.map((f) =>
            editingId === f.id ? (
              <div key={f.id} className="md:col-span-2">
                <FirmForm
                  initial={firmDraftFrom(f)}
                  busy={update.isPending}
                  error={err}
                  submitLabel="Save changes"
                  onCancel={() => { setEditingId(null); setErr(null); }}
                  onSubmit={(d) =>
                    update.mutate({ id: f.id, data: firmInputFrom(d) }, {
                      onSuccess: () => { setEditingId(null); setErr(null); invalidateFirms(); },
                      onError: (e) => setErr(errMessage(e)),
                    })
                  }
                />
              </div>
            ) : viewMode === "list" ? (
              <RecordRow
                key={f.id}
                data-testid={`row-firm-${f.id}`}
                onClick={canEdit ? () => { setEditingId(f.id); setErr(null); } : undefined}
                title={f.name}
                subtitle={[f.kind, f.country, f.speciality].filter(Boolean).join(" · ") || "—"}
                chips={
                  <>
                    {f.relationshipStrength != null && (
                      <MonoChip tone={f.relationshipStrength >= 4 ? "gold" : f.relationshipStrength >= 3 ? "green" : "amber"}>
                        strength {f.relationshipStrength}/5
                      </MonoChip>
                    )}
                    <MonoChip>{f.activeResourceCount} active resource{f.activeResourceCount === 1 ? "" : "s"}</MonoChip>
                  </>
                }
                trailing={
                  <>
                    <FirmStageChips firm={f} />
                    <AllianceVerdictChip firm={f} />
                    {f.tier && <MonoChip tone={f.tier === "strategic" ? "gold" : "default"}>{f.tier}</MonoChip>}
                    <MonoChip tone={f.status === "active" ? "green" : f.status === "renewal_due" ? "amber" : "default"}>
                      {f.status.replace("_", " ")}
                    </MonoChip>
                  </>
                }
              />
            ) : (
              <RecordCard
                key={f.id}
                data-testid={`card-firm-${f.id}`}
                onClick={canEdit ? () => { setEditingId(f.id); setErr(null); } : undefined}
                title={f.name}
                subtitle={[f.kind, f.country, f.speciality].filter(Boolean).join(" · ") || "—"}
                trailing={
                  <>
                    <FirmStageChips firm={f} />
                    <AllianceVerdictChip firm={f} />
                    {f.tier && <MonoChip tone={f.tier === "strategic" ? "gold" : "default"}>{f.tier}</MonoChip>}
                    <MonoChip tone={f.status === "active" ? "green" : f.status === "renewal_due" ? "amber" : "default"}>
                      {f.status.replace("_", " ")}
                    </MonoChip>
                  </>
                }
                actions={
                  <>
                    <RecordCardAction
                      onClick={() => setEvalOpenId(evalOpenId === f.id ? null : f.id)}
                      data-testid={`button-evaluation-${f.id}`}
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform ${evalOpenId === f.id ? "rotate-90" : ""}`} />
                      eval
                    </RecordCardAction>
                    <RecordCardAction
                      onClick={() => setQuotesOpenId(quotesOpenId === f.id ? null : f.id)}
                      data-testid={`button-quoted-deals-${f.id}`}
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform ${quotesOpenId === f.id ? "rotate-90" : ""}`} />
                      quotes
                    </RecordCardAction>
                    {canManagePortal && (
                      <RecordCardAction
                        onClick={() => setLoginsOpenId(loginsOpenId === f.id ? null : f.id)}
                        data-testid={`button-portal-logins-${f.id}`}
                      >
                        <ChevronRight className={`w-3 h-3 transition-transform ${loginsOpenId === f.id ? "rotate-90" : ""}`} />
                        portal
                      </RecordCardAction>
                    )}
                    {canEdit && (
                      <RecordCardAction
                        danger
                        onClick={() => {
                          setErr(null);
                          archive.mutate({ id: f.id }, {
                            onSuccess: () => invalidateFirms(),
                            onError: (e) => setErr(errMessage(e)),
                          });
                        }}
                        data-testid={`button-archive-firm-${f.id}`}
                      >
                        <Archive className="w-3 h-3" />
                      </RecordCardAction>
                    )}
                  </>
                }
                chips={
                  <>
                    {f.relationshipStrength != null && (
                      <MonoChip tone={f.relationshipStrength >= 4 ? "gold" : f.relationshipStrength >= 3 ? "green" : "amber"}>
                        strength {f.relationshipStrength}/5
                      </MonoChip>
                    )}
                    {f.lastTouchAt && <MonoChip>last touch {f.lastTouchAt.slice(0, 10)}</MonoChip>}
                    <MonoChip>{f.activeResourceCount} active resource{f.activeResourceCount === 1 ? "" : "s"}</MonoChip>
                  </>
                }
              >
                {(f.anchorCognirise || f.anchorPartner) && (
                  <div className="text-sm text-text-mute">
                    Anchor · Cognirise: <span className="text-text">{f.anchorCognirise ?? "—"}</span>
                    {" ↔ "}
                    Partner: <span className="text-text">{f.anchorPartner ?? "—"}</span>
                  </div>
                )}
                {(f.contactName || f.contactEmail) && (
                  <div className="text-xs text-text-faint">
                    Contact: {f.contactName ?? "—"}{f.contactEmail ? ` · ${f.contactEmail}` : ""}
                  </div>
                )}
                {f.notes && (
                  <div className="text-xs text-text-faint border-l-2 border-l-border pl-2">{f.notes}</div>
                )}
                {evalOpenId === f.id && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <AllianceEvaluationPanel firm={f} canEdit={canEdit} />
                  </div>
                )}
                {quotesOpenId === f.id && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <QuotedDealsPanel firmId={f.id} />
                  </div>
                )}
                {loginsOpenId === f.id && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <PortalLoginsPanel
                      firmId={f.id}
                      firmName={f.name}
                      signed={f.partnershipStage === "agreed" && f.agreementStage === "signed"}
                    />
                  </div>
                )}
              </RecordCard>
            ),
          )}
        </div>
        {!adding && !editingId && <FormError msg={err} />}
      </section>

      {canReviewBankChanges && <FirmBankChangesSection />}
      {canReviewFirmSubmissions && <FirmDocumentsReviewSection />}
      {canReviewFirmSubmissions && <FirmContactSuggestionsSection />}

      <TargetsSection firms={firms} />
    </div>
  );
}

// ---- Partner portal logins (Task #873) --------------------------------------
// Leadership-only management of a firm's external Atelier logins
// (role = alliance_partner, locked to /partner-portal + chat). Raw fetch:
// these bespoke routes are not in the OpenAPI spec.
function PortalLoginsPanel({
  firmId,
  firmName,
  signed,
}: {
  firmId: string;
  firmName: string;
  signed: boolean;
}) {
  type LoginRow = {
    id: string;
    name: string;
    email: string;
    active: boolean;
    createdAt: string;
  };
  const [, setLocation] = useLocation();
  const [rows, setRows] = React.useState<LoginRow[] | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [activationUrl, setActivationUrl] = React.useState<string | null>(null);
  // Task #1173 — firm-wide offboard (deactivates ALL logins) is destructive,
  // so it's a two-step confirm rather than a single click.
  const [confirmOffboard, setConfirmOffboard] = React.useState(false);

  const load = React.useCallback(() => {
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/logins`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { logins: LoginRow[] }) => setRows(j.logins))
      .catch(() => setMsg("Couldn't load portal logins."));
  }, [firmId]);
  React.useEffect(() => load(), [load]);

  const provision = () => {
    setBusy(true);
    setMsg(null);
    setActivationUrl(null);
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/logins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : "Provisioning failed.");
        setName("");
        setEmail("");
        if (typeof j.activationUrl === "string") setActivationUrl(j.activationUrl);
        setMsg("Partner user invited. A registration link was emailed; you can also share it directly.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  const resend = (userId: string) => {
    setBusy(true);
    setMsg(null);
    setActivationUrl(null);
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/logins/${userId}/resend-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : "Resend failed.");
        if (typeof j.registrationUrl === "string") setActivationUrl(j.registrationUrl);
        setMsg("A fresh registration link was sent; earlier links no longer work.");
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  // Task #885 — regenerate a single-use 72h activation link for an existing
  // login (forgotten password / expired original link). Revokes sessions.
  const resetLink = (userId: string) => {
    setBusy(true);
    setMsg(null);
    setActivationUrl(null);
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/logins/${userId}/reset-link`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : "Couldn't issue a new link.");
        if (typeof j.activationUrl === "string") setActivationUrl(j.activationUrl);
        setMsg("New activation link issued (valid 72h); their sessions were revoked. Share it with the partner.");
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  const deactivate = (userId: string) => {
    setBusy(true);
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/logins/${userId}/deactivate`, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => {
        if (!r.ok) throw new Error("Deactivation failed.");
        setMsg("Login deactivated; their sessions were revoked.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  // Task #1173 — firm-wide offboard: deactivates every active login for the
  // firm in one call and revokes all their sessions.
  const offboard = () => {
    setBusy(true);
    setMsg(null);
    setActivationUrl(null);
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/offboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : "Offboarding failed.");
        setConfirmOffboard(false);
        setMsg("Portal access offboarded; all logins were deactivated and their sessions revoked.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  const hasActiveLogin = (rows ?? []).some((r) => r.active);

  return (
    <div className="mt-3 border-t border-border-soft pt-3 space-y-2" data-testid={`panel-portal-logins-${firmId}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
        Partner portal logins
      </div>
      <p className="text-xs text-text-mute">
        External logins see ONLY the opportunities granted to this firm plus a
        redacted client overview — nothing else. A firm can have several active
        logins at once; add more whenever you need to.
      </p>
      {rows == null ? (
        <p className="text-xs text-text-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-mute">No portal logins yet.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((u) => (
            <div key={u.id} className="flex items-center gap-2 text-xs" data-testid={`row-portal-login-${u.id}`}>
              <span className="text-text font-medium">{u.name}</span>
              <span className="text-text-faint">{u.email}</span>
              <MonoChip tone={u.active ? "green" : "default"}>{u.active ? "active" : "deactivated"}</MonoChip>
              {u.active && (
                <>
                  <button
                    type="button"
                    className="text-gold hover:underline"
                    disabled={busy}
                    onClick={() => resend(u.id)}
                    data-testid={`button-resend-registration-${u.id}`}
                  >
                    resend link
                  </button>
                  <button
                    type="button"
                    className="text-gold hover:underline"
                    disabled={busy}
                    onClick={() => resetLink(u.id)}
                    data-testid={`button-reset-link-${u.id}`}
                  >
                    reset link
                  </button>
                  <button
                    type="button"
                    className="text-danger hover:underline"
                    disabled={busy}
                    onClick={() => deactivate(u.id)}
                    data-testid={`button-deactivate-login-${u.id}`}
                  >
                    deactivate
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {signed ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="bg-bg-deep border border-border rounded px-2 py-1 text-xs"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid={`input-portal-login-name-${firmId}`}
          />
          <input
            className="bg-bg-deep border border-border rounded px-2 py-1 text-xs"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid={`input-portal-login-email-${firmId}`}
          />
          <button
            type="button"
            className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80 disabled:opacity-50"
            disabled={busy || !name.trim() || !email.includes("@")}
            onClick={provision}
            data-testid={`button-provision-login-${firmId}`}
          >
            invite partner user
          </button>
        </div>
      ) : (
        <p className="text-xs text-text-faint" data-testid={`text-invite-unsigned-${firmId}`}>
          Partner users can be invited once the partnership agreement is signed.
        </p>
      )}
      {activationUrl && (
        <p className="text-xs text-text-mute break-all">Registration link: {activationUrl}</p>
      )}

      {/* Task #1173 — leadership tools: preview the firm's portal read-only,
          and offboard (deactivate every active login at once). */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-2">
        <button
          type="button"
          className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80"
          onClick={() => setLocation(`/partners/preview/${firmId}`)}
          data-testid={`button-preview-portal-${firmId}`}
        >
          preview portal as this firm
        </button>
        {!confirmOffboard ? (
          <button
            type="button"
            className="text-xs font-mono uppercase tracking-widest text-danger hover:underline disabled:opacity-50"
            disabled={busy || !hasActiveLogin}
            onClick={() => {
              setMsg(null);
              setConfirmOffboard(true);
            }}
            data-testid={`button-offboard-portal-${firmId}`}
          >
            offboard portal access
          </button>
        ) : (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-danger">
              Deactivate all portal logins for {firmName}?
            </span>
            <button
              type="button"
              className="font-mono uppercase tracking-widest text-danger hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={offboard}
              data-testid={`button-offboard-portal-confirm-${firmId}`}
            >
              confirm
            </button>
            <button
              type="button"
              className="text-text-faint hover:underline"
              disabled={busy}
              onClick={() => setConfirmOffboard(false)}
              data-testid={`button-offboard-portal-cancel-${firmId}`}
            >
              cancel
            </button>
          </span>
        )}
      </div>

      {msg && <p className="text-xs text-text-faint">{msg}</p>}
    </div>
  );
}

// ---- Quoted deals (Task #665) ----------------------------------------------
// Deals whose pricing carries an alliance-partner-quote cost line linked to
// this firm — shows quoted vs costed spend and links into the CRM deal.
function QuotedDealsPanel({ firmId }: { firmId: string }) {
  const { data, isLoading } = useAtelierListPartnerFirmQuotedDeals(firmId);
  const items = data?.items ?? [];
  return (
    <div className="mt-3 border-t border-border-soft pt-3 space-y-2" data-testid={`panel-quoted-deals-${firmId}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
        Deals carrying this partner's quotes
      </div>
      {isLoading ? (
        <p className="text-xs text-text-faint">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-text-mute">
          No deal pricing references this firm yet. Link the firm on an
          alliance-partner-quote cost line in a deal's Commercials tab.
        </p>
      ) : (
        <div className="space-y-1">
          {items.map((d, i) => (
            <div
              key={`${d.opportunityId}-${i}`}
              className="flex flex-wrap items-center gap-2 text-xs"
              data-testid={`row-quoted-deal-${d.opportunityId}-${i}`}
            >
              <Link
                href={`/opportunities/${d.opportunityId}`}
                className="text-gold hover:text-gold/80 font-medium"
              >
                {d.opportunityName ?? d.opportunityId}
              </Link>
              {d.accountName && <span className="text-text-faint">· {d.accountName}</span>}
              {d.salesStage && <MonoChip>{d.salesStage}</MonoChip>}
              {d.lineLabel && <span className="text-text-faint">{d.lineLabel}</span>}
              <span className="text-text-mute font-mono ml-auto">
                cost ${fmtNum(d.costedAmountUsd)}
                {d.quotedAmountUsd != null && <> · quoted ${fmtNum(d.quotedAmountUsd)}</>}
                {d.deltaUsd != null && d.deltaUsd !== 0 && (
                  <span className={d.deltaUsd > 0 ? "text-warn" : "text-success"}>
                    {" "}({d.deltaUsd > 0 ? "+" : "−"}${fmtNum(Math.abs(d.deltaUsd))} vs quote)
                  </span>
                )}
              </span>
              {d.passThrough && <MonoChip tone="amber">pass-through</MonoChip>}
              {d.recurrence !== "one_time" && <MonoChip>{d.recurrence.replace("_", "-")}</MonoChip>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ---- Target partners --------------------------------------------------------
type TargetDraft = {
  name: string;
  ecosystem: string;
  country: string;
  thesis: string;
  tierHypothesis: string;
  priority: string;
  status: string;
  nextStep: string;
};

const emptyTargetDraft: TargetDraft = {
  name: "", ecosystem: "", country: "", thesis: "", tierHypothesis: "",
  priority: "med", status: "researching", nextStep: "",
};

function targetDraftFrom(t: AtelierPartnerTarget): TargetDraft {
  return {
    name: t.name ?? "",
    ecosystem: t.ecosystem ?? "",
    country: t.country ?? "",
    thesis: t.thesis ?? "",
    tierHypothesis: t.tierHypothesis ?? "",
    priority: t.priority ?? "med",
    status: t.status ?? "researching",
    nextStep: t.nextStep ?? "",
  };
}

function targetInputFrom(d: TargetDraft): AtelierPartnerTargetInput {
  return {
    name: d.name.trim(),
    ecosystem: d.ecosystem.trim() || null,
    country: d.country.trim() || null,
    thesis: d.thesis.trim() || null,
    tierHypothesis: (d.tierHypothesis || null) as AtelierPartnerTargetInput["tierHypothesis"],
    priority: d.priority as AtelierPartnerTargetInput["priority"],
    status: d.status as AtelierPartnerTargetInput["status"],
    nextStep: d.nextStep.trim() || null,
  };
}

function TargetForm({
  initial, onSubmit, onCancel, busy, error, submitLabel,
}: {
  initial: TargetDraft;
  onSubmit: (d: TargetDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [d, setD] = React.useState(initial);
  const set = (k: keyof TargetDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.value });
  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name"><TextInput value={d.name} onChange={set("name")} data-testid="input-target-name" /></Field>
        <Field label="Ecosystem"><TextInput value={d.ecosystem} onChange={set("ecosystem")} placeholder="e.g. AWS, Microsoft" /></Field>
        <Field label="Country"><TextInput value={d.country} onChange={set("country")} /></Field>
        <Field label="Thesis"><TextInput value={d.thesis} onChange={set("thesis")} placeholder="Why this partner" /></Field>
        <Field label="Tier hypothesis">
          <Select value={d.tierHypothesis} onChange={set("tierHypothesis")}>
            <option value="">—</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={d.priority} onChange={set("priority")}>
            {["high", "med", "low"].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={set("status")}>
            {TARGET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Next step"><TextInput value={d.nextStep} onChange={set("nextStep")} /></Field>
      </div>
      <FormError msg={error} />
      <div className="flex gap-2">
        <PillButton disabled={busy || !d.name.trim()} onClick={() => onSubmit(d)} data-testid="button-target-save">
          {busy ? "Saving…" : submitLabel}
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
      </div>
    </Card>
  );
}

function TargetsSection({ firms }: { firms: AtelierPartnerFirm[] }) {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: targetsData } = useAtelierListPartnerTargets();
  const targets = targetsData?.items ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerTargetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });
  };

  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const create = useAtelierCreatePartnerTarget();
  const update = useAtelierUpdatePartnerTarget();
  const archive = useAtelierArchivePartnerTarget();
  const promote = useAtelierPromotePartnerTarget();

  const firmById = new Map(firms.map((f) => [f.id, f]));

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="section-label">Target partners — thesis + outreach funnel</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-faint">{targets.length} target{targets.length === 1 ? "" : "s"}</span>
          {canEdit && !adding && (
            <PillButton variant="ghost" onClick={() => { setAdding(true); setErr(null); }} data-testid="button-add-target">
              <Plus className="w-3.5 h-3.5 mr-1 inline" /> Add target
            </PillButton>
          )}
        </div>
      </header>

      {adding && (
        <TargetForm
          initial={emptyTargetDraft}
          busy={create.isPending}
          error={err}
          submitLabel="Create target"
          onCancel={() => { setAdding(false); setErr(null); }}
          onSubmit={(d) =>
            create.mutate({ data: targetInputFrom(d) }, {
              onSuccess: () => { setAdding(false); setErr(null); invalidate(); },
              onError: (e) => setErr(errMessage(e)),
            })
          }
        />
      )}

      {targets.length === 0 && !adding && (
        <p className="text-sm text-text-mute">No target partners tracked.</p>
      )}

      <div className="space-y-2">
        {targets.map((t) =>
          editingId === t.id ? (
            <TargetForm
              key={t.id}
              initial={targetDraftFrom(t)}
              busy={update.isPending}
              error={err}
              submitLabel="Save changes"
              onCancel={() => { setEditingId(null); setErr(null); }}
              onSubmit={(d) =>
                update.mutate({ id: t.id, data: targetInputFrom(d) }, {
                  onSuccess: () => { setEditingId(null); setErr(null); invalidate(); },
                  onError: (e) => setErr(errMessage(e)),
                })
              }
            />
          ) : (
            <RecordCard
              key={t.id}
              data-testid={`card-target-${t.id}`}
              onClick={canEdit ? () => { setEditingId(t.id); setErr(null); } : undefined}
              title={t.name}
              subtitle={[t.ecosystem, t.country].filter(Boolean).join(" · ") || "—"}
              trailing={
                <>
                  <MonoChip tone={t.priority === "high" ? "gold" : "default"}>{t.priority}</MonoChip>
                  <MonoChip tone={t.status === "promoted" ? "green" : t.status === "dropped" ? "red" : "default"}>
                    {t.status.replace("_", " ")}
                  </MonoChip>
                </>
              }
              actions={
                canEdit ? (
                  <>
                    {t.status !== "promoted" && (
                      <RecordCardAction
                        onClick={() => {
                          setErr(null);
                          promote.mutate({ id: t.id }, {
                            onSuccess: () => invalidate(),
                            onError: (e) => setErr(errMessage(e)),
                          });
                        }}
                        data-testid={`button-promote-target-${t.id}`}
                      >
                        <ArrowUpRight className="w-3 h-3" /> promote
                      </RecordCardAction>
                    )}
                    <RecordCardAction
                      danger
                      onClick={() => {
                        setErr(null);
                        archive.mutate({ id: t.id }, {
                          onSuccess: () => invalidate(),
                          onError: (e) => setErr(errMessage(e)),
                        });
                      }}
                      data-testid={`button-archive-target-${t.id}`}
                    >
                      <Archive className="w-3 h-3" />
                    </RecordCardAction>
                  </>
                ) : undefined
              }
              chips={
                t.tierHypothesis ? (
                  <MonoChip>tier hypothesis · {t.tierHypothesis}</MonoChip>
                ) : undefined
              }
            >
              {t.thesis && <div className="text-sm text-text-mute">{t.thesis}</div>}
              {t.nextStep && (
                <div className="text-xs text-text-faint border-l-2 border-l-border pl-2">
                  Next: {t.nextStep}
                </div>
              )}
              {t.promotedFirmId && firmById.has(t.promotedFirmId) && (
                <div className="text-xs text-gold">
                  Promoted → {firmById.get(t.promotedFirmId)!.name}
                </div>
              )}
            </RecordCard>
          ),
        )}
      </div>
      {!adding && !editingId && <FormError msg={err} />}
    </section>
  );
}

// =============================================================
// QUALIFY — framework fit scorecard (Cartographer-driven) + NDA status
// =============================================================
//
// Task #530: the legacy freeform "capabilities" grid was retired. Initial
// scores come from the Alliance Cartographer (9-dimension weighted fit
// scorecard); editors can adjust any dimension inline — the server
// recomputes the weighted total + verdict with the shared framework
// weights and stamps the adjuster, so manual scores stay distinguishable
// from agent-produced ones (shown with a gold dot).

function verdictChipTone(v?: string): "gold" | "green" | "amber" | "red" | "default" {
  if (v === "proceed") return "green";
  if (v === "limited") return "amber";
  if (v === "decline") return "red";
  return "default";
}

// Task #541 — per-dimension "recent changes" popover for manually adjusted
// fit scores. History is read from the audit-trail projection endpoint
// (raw fetch — bespoke route, not in openapi, mirroring the agent-status
// calls above); revert re-uses the codegen'd adjust mutation with the
// recorded prior value, so the revert is itself audited.
type FitAdjustHistoryItem = {
  id: string;
  dimensionId: string;
  label: string;
  actorLabel: string;
  at: string;
  from: number;
  to: number;
};

function FitAdjustDot({
  firm,
  dimId,
  canEdit,
  onReverted,
}: {
  firm: AtelierPartnerFirm;
  dimId: string;
  canEdit: boolean;
  onReverted: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<FitAdjustHistoryItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const revert = useAtelierAdjustPartnerFitScorecard();
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const load = async () => {
    setError(null);
    try {
      const r = await fetch(
        `${QUALIFY_API}/partners/firms/${firm.id}/fit-scorecard/history`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { items?: FitAdjustHistoryItem[] };
      setItems((j.items ?? []).filter((it) => it.dimensionId === dimId));
    } catch {
      setError("Could not load the change history.");
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items == null) void load();
  };

  const doRevert = (entry: FitAdjustHistoryItem) => {
    setError(null);
    revert.mutate(
      { id: firm.id, data: { scores: { [dimId]: entry.from } } },
      {
        onSuccess: () => {
          setOpen(false);
          setItems(null);
          onReverted();
        },
        onError: (e) => setError(errMessage(e)),
      },
    );
  };

  const current = (firm.fitScorecard?.dimensions ?? []).find((d) => d.id === dimId)?.score;

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        className="w-2.5 h-2.5 -m-0.5 p-0.5 inline-flex items-center justify-center"
        title="Manually adjusted — click for details"
        onClick={toggle}
        data-testid={`dot-manual-${dimId}-${firm.id}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gold inline-block" />
      </button>
      {open && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-4 z-30 w-64 rounded-sm border border-border bg-bg-deep shadow-xl p-3 text-left"
          data-testid={`popover-fit-history-${dimId}-${firm.id}`}
        >
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
            Recent changes
          </div>
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          {items == null && !error && (
            <p className="text-xs text-text-faint">Loading…</p>
          )}
          {items != null && items.length === 0 && (
            <p className="text-xs text-text-faint">
              No recorded changes for this dimension.
            </p>
          )}
          {items != null && items.length > 0 && (
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {items.slice(0, 5).map((it, idx) => (
                <li key={it.id} className="text-xs text-text" data-testid={`row-fit-history-${it.id}`}>
                  <span className="font-medium">{it.actorLabel || "Unknown"}</span>{" "}
                  <span className="text-text-faint">{it.at.slice(0, 10)}</span>
                  <span className="block font-mono text-text-mute">
                    {it.from} → {it.to}
                  </span>
                  {canEdit && idx === 0 && it.from !== current && (
                    <button
                      type="button"
                      className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-gold/80 hover:text-gold disabled:opacity-50"
                      disabled={revert.isPending}
                      onClick={() => doRevert(it)}
                      data-testid={`button-fit-revert-${dimId}-${firm.id}`}
                    >
                      {revert.isPending ? "reverting…" : `revert to ${it.from}`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}

function QualifyView() {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: firmsData } = useAtelierListPartnerFirms();
  const { data: agreementsData } = useAtelierListPartnerAgreements();
  const firms = (firmsData?.items ?? []).filter((f) => f.status !== "terminated");
  const agreements = agreementsData?.items ?? [];

  const adjust = useAtelierAdjustPartnerFitScorecard();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [scores, setScores] = React.useState<Record<string, string>>({});
  const [err, setErr] = React.useState<string | null>(null);
  const [deciding, setDeciding] = React.useState<string | null>(null);
  // Alliance Cartographer runs launched (or observed running) from this tab.
  const [running, setRunning] = React.useState<Record<string, string | null>>({});

  const invalidateFirms = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });
  }, [qc]);

  // Poll the shared agent-status route for firms with a live run.
  React.useEffect(() => {
    const ids = Object.keys(running);
    if (ids.length === 0) return;
    const tick = async () => {
      for (const id of ids) {
        try {
          const r = await fetch(`${QUALIFY_API}/partners/firms/${id}/agents/status`, {
            credentials: "include",
          });
          if (!r.ok) continue;
          const j = (await r.json()) as {
            agents?: Record<string, { status?: string; phase?: string | null }>;
          };
          const carto = j.agents?.alliance_cartographer;
          if (carto?.status === "running") {
            setRunning((m) => ({ ...m, [id]: carto.phase ?? null }));
          } else {
            setRunning((m) => {
              const { [id]: _gone, ...rest } = m;
              return rest;
            });
            if (carto?.status === "failed") {
              setErr(`Evaluation failed: ${carto.phase ?? "unknown error"}`);
            }
            invalidateFirms();
          }
        } catch {
          /* transient poll failure — keep polling */
        }
      }
    };
    const iv = setInterval(() => void tick(), 5000);
    return () => clearInterval(iv);
  }, [Object.keys(running).join(","), invalidateFirms]);

  const launchCartographer = async (f: AtelierPartnerFirm) => {
    setErr(null);
    setRunning((m) => ({ ...m, [f.id]: "Starting research…" }));
    try {
      const r = await fetch(
        `${QUALIFY_API}/partners/firms/${f.id}/agents/alliance-cartographer/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: "{}",
        },
      );
      if (r.status === 409) {
        setErr("An evaluation is already running for this partner.");
      } else if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { message?: string } | null;
        setErr(j?.message ?? "Could not start the evaluation.");
        setRunning((m) => {
          const { [f.id]: _gone, ...rest } = m;
          return rest;
        });
      }
    } catch {
      setErr("Could not start the evaluation.");
      setRunning((m) => {
        const { [f.id]: _gone, ...rest } = m;
        return rest;
      });
    }
  };

  const decideProposal = async (
    f: AtelierPartnerFirm,
    proposalId: string,
    action: "approve" | "reject",
  ) => {
    setErr(null);
    setDeciding(proposalId);
    try {
      const r = await fetch(
        `${QUALIFY_API}/partners/firms/${f.id}/proposals/${proposalId}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { message?: string } | null;
        setErr(j?.message ?? `Could not ${action} the proposal.`);
      }
      invalidateFirms();
    } catch {
      setErr(`Could not ${action} the proposal.`);
    } finally {
      setDeciding(null);
    }
  };

  const ndaByFirm = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agreements) {
      if (a.instrumentType?.toLowerCase().includes("nda") && a.partnerFirmId) {
        const prev = m.get(a.partnerFirmId);
        // fully executed wins over any in-flight status
        if (!prev || a.fullyExecutedAt) m.set(a.partnerFirmId, a.fullyExecutedAt ? "signed" : a.status);
      }
    }
    return m;
  }, [agreements]);

  const dimScore = (f: AtelierPartnerFirm, dimId: string) =>
    (f.fitScorecard?.dimensions ?? []).find((d) => d.id === dimId);

  const startEdit = (f: AtelierPartnerFirm) => {
    setEditingId(f.id);
    setErr(null);
    const s: Record<string, string> = {};
    for (const d of FIT_DIMENSIONS) {
      const v = dimScore(f, d.id)?.score;
      s[d.id] = v != null ? String(v) : "";
    }
    setScores(s);
  };

  const saveEdit = (f: AtelierPartnerFirm) => {
    const changed: Record<string, number> = {};
    for (const d of FIT_DIMENSIONS) {
      const raw = scores[d.id];
      if (raw === "" || raw == null) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        setErr(`${d.label}: scores must be whole numbers from 1 to 5.`);
        return;
      }
      if (n !== dimScore(f, d.id)?.score) changed[d.id] = n;
    }
    if (Object.keys(changed).length === 0) {
      setEditingId(null);
      return;
    }
    adjust.mutate(
      { id: f.id, data: { scores: changed } },
      {
        onSuccess: () => {
          setEditingId(null);
          invalidateFirms();
        },
        onError: (e) => setErr(errMessage(e)),
      },
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-mute">
        Fit scores come from the Alliance Cartographer's nine-dimension weighted
        framework (scores 1–5; the weighted total and verdict are recomputed
        server-side). Editors can adjust any dimension — manual adjustments are
        marked with a gold dot. NDA status is read from real e-sign agreements —
        send an NDA from the <Link href="/contracts" className="text-gold hover:underline">Contracts</Link> system
        with the firm as counterparty; it appears here automatically.
      </p>
      {firms.length === 0 && <p className="text-sm text-text-mute">No partner firms in the registry.</p>}
      {firms.length > 0 && (
        <Card className="p-0 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-text-faint">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Partner</th>
                {FIT_DIMENSIONS.map((d) => (
                  <th key={d.id} className="px-2 py-3 font-mono whitespace-nowrap" title={d.label}>
                    {d.label}
                    <span className="block text-[9px] text-text-faint normal-case tracking-normal">
                      w{Math.round(d.weight * 100)}%
                    </span>
                  </th>
                ))}
                <th className="px-3 py-3">Total</th>
                <th className="px-3 py-3">Verdict</th>
                <th className="px-3 py-3">NDA</th>
                {canEdit && <th className="px-3 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => {
                const editing = editingId === f.id;
                const nda = ndaByFirm.get(f.id);
                const sc = f.fitScorecard;
                const hasScorecard = !!sc?.dimensions?.length;
                const runPhase = running[f.id];
                const isRunning = f.id in running;
                const pendingScorecard = (f.pendingUpdates ?? []).find(
                  (u) => u.status === "pending" && u.field === "fitScorecard",
                );
                return (
                  <tr
                    key={f.id}
                    className={`border-b border-border-soft last:border-0 ${canEdit && hasScorecard && !editing ? "cursor-pointer hover:bg-bg-elevate-2 transition-colors" : ""}`}
                    onClick={canEdit && hasScorecard && !editing ? () => startEdit(f) : undefined}
                    data-testid={`row-qualify-${f.id}`}
                  >
                    <td className="px-4 py-3 font-medium text-text">
                      <span className="inline-flex items-center gap-2">
                        {f.name}
                        <AllianceVerdictChip firm={f} />
                      </span>
                      {isRunning && (
                        <span className="block text-[10px] text-gold/90 animate-pulse" data-testid={`text-qualify-run-${f.id}`}>
                          Cartographer — {runPhase ?? "working…"}
                        </span>
                      )}
                      {!isRunning && pendingScorecard && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-gold/90" onClick={(e) => e.stopPropagation()} data-testid={`row-qualify-proposal-${f.id}`}>
                          scorecard proposal awaiting review
                          {canEdit && (
                            <>
                              <button
                                className="inline-flex items-center gap-0.5 font-mono uppercase tracking-widest text-green-400/90 hover:text-green-300 disabled:opacity-50"
                                disabled={deciding === pendingScorecard.id}
                                onClick={() => void decideProposal(f, pendingScorecard.id!, "approve")}
                                data-testid={`button-qualify-approve-${f.id}`}
                              >
                                <Check className="w-3 h-3" /> approve
                              </button>
                              <button
                                className="inline-flex items-center gap-0.5 font-mono uppercase tracking-widest text-text-faint hover:text-red-400 disabled:opacity-50"
                                disabled={deciding === pendingScorecard.id}
                                onClick={() => void decideProposal(f, pendingScorecard.id!, "reject")}
                                data-testid={`button-qualify-reject-${f.id}`}
                              >
                                <X className="w-3 h-3" /> reject
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </td>
                    {!hasScorecard ? (
                      <td colSpan={FIT_DIMENSIONS.length + 2} className="px-3 py-3 text-text-faint">
                        {isRunning
                          ? "Evaluation in progress…"
                          : pendingScorecard
                            ? "Scores proposed — approve the scorecard proposal to apply them."
                            : "No framework scorecard yet."}
                      </td>
                    ) : (
                      <>
                        {FIT_DIMENSIONS.map((d) => {
                          if (editing) {
                            return (
                              <td key={d.id} className="px-1.5 py-2">
                                <input
                                  type="number" min={1} max={5}
                                  className="w-12 bg-bg-deep border border-border rounded-sm px-1.5 py-1 text-sm text-text"
                                  value={scores[d.id] ?? ""}
                                  onChange={(e) => setScores({ ...scores, [d.id]: e.target.value })}
                                  data-testid={`input-fit-${d.id}-${f.id}`}
                                />
                              </td>
                            );
                          }
                          const dim = dimScore(f, d.id);
                          const v = dim?.score;
                          return (
                            <td key={d.id} className="px-2 py-3" title={dim?.rationale ?? undefined}>
                              {v == null ? (
                                <span className="text-text-faint">—</span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <MonoChip tone={v >= 4 ? "gold" : v >= 3 ? "green" : v >= 2 ? "amber" : "red"}>{v}</MonoChip>
                                  {dim?.adjustedAt && (
                                    <FitAdjustDot
                                      firm={f}
                                      dimId={d.id}
                                      canEdit={canEdit}
                                      onReverted={invalidateFirms}
                                    />
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 font-mono text-text whitespace-nowrap" data-testid={`text-fit-total-${f.id}`}>
                          {sc!.weightedTotal != null ? `${sc!.weightedTotal.toFixed(2)}/5` : "—"}
                        </td>
                        <td className="px-3 py-3">
                          {sc!.verdict ? (
                            <MonoChip tone={verdictChipTone(sc!.verdict)}>{sc!.verdict}</MonoChip>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-3">
                      {nda ? (
                        <MonoChip tone={nda === "signed" ? "green" : "amber"}>{nda.replace(/_/g, " ")}</MonoChip>
                      ) : (
                        <MonoChip>none</MonoChip>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {editing ? (
                          <span className="inline-flex gap-2">
                            <button className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80" onClick={() => saveEdit(f)} disabled={adjust.isPending} data-testid={`button-save-fit-${f.id}`}>
                              {adjust.isPending ? "saving…" : "save"}
                            </button>
                            <button className="text-xs font-mono uppercase tracking-widest text-text-faint" onClick={() => setEditingId(null)}>cancel</button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-3">
                            <button
                              className="text-xs font-mono uppercase tracking-widest text-gold/80 hover:text-gold disabled:opacity-50 inline-flex items-center gap-1"
                              disabled={isRunning}
                              onClick={() => void launchCartographer(f)}
                              data-testid={`button-evaluate-${f.id}`}
                            >
                              <Sparkles className="w-3 h-3" />
                              {hasScorecard ? "re-run" : "evaluate"}
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <FormError msg={err} />
    </div>
  );
}

// =============================================================
// CO-SELL — joint pipeline linked to real CRM opportunities (CRUD)
// =============================================================
type PipelineDraft = {
  opportunityId: string;
  partnerFirmId: string;
  leadParty: string;
  cognirisePct: string;
  partnerPct: string;
  splitRationale: string;
  allianceLetterStatus: string;
  partnerSourced: boolean;
};

const emptyPipelineDraft: PipelineDraft = {
  opportunityId: "", partnerFirmId: "", leadParty: "cognirise",
  cognirisePct: "50", partnerPct: "50", splitRationale: "",
  allianceLetterStatus: "none", partnerSourced: false,
};

function PipelineForm({
  initial, firms, onSubmit, onCancel, busy, error, submitLabel, lockRefs,
}: {
  initial: PipelineDraft;
  firms: AtelierPartnerFirm[];
  onSubmit: (d: PipelineDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  lockRefs?: boolean;
}) {
  const [d, setD] = React.useState(initial);
  const { data: opps } = useAtelierListOpportunities();
  const oppList = opps ?? [];
  const set = (k: keyof PipelineDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.value });
  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="grid gap-3 md:grid-cols-3">
        {!lockRefs && (
          <>
            <Field label="Opportunity">
              <Select value={d.opportunityId} onChange={set("opportunityId")} data-testid="select-jp-opportunity">
                <option value="">Select opportunity…</option>
                {oppList.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} — {o.accountName}</option>
                ))}
              </Select>
            </Field>
            <Field label="Partner firm">
              <Select value={d.partnerFirmId} onChange={set("partnerFirmId")} data-testid="select-jp-firm">
                <option value="">Select firm…</option>
                {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
          </>
        )}
        <Field label="Lead party">
          <Select value={d.leadParty} onChange={set("leadParty")}>
            {["cognirise", "partner", "joint"].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Cognirise %"><TextInput type="number" min={0} max={100} value={d.cognirisePct} onChange={set("cognirisePct")} /></Field>
        <Field label="Partner %"><TextInput type="number" min={0} max={100} value={d.partnerPct} onChange={set("partnerPct")} /></Field>
        <Field label="Alliance letter">
          <Select value={d.allianceLetterStatus} onChange={set("allianceLetterStatus")}>
            {["none", "drafting", "signed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Split rationale"><TextInput value={d.splitRationale} onChange={set("splitRationale")} /></Field>
        <label className="flex items-end gap-2 pb-1.5 text-sm text-text-mute">
          <input
            type="checkbox"
            checked={d.partnerSourced}
            onChange={(e) => setD({ ...d, partnerSourced: e.target.checked })}
          />
          Partner-sourced
        </label>
      </div>
      <FormError msg={error} />
      <div className="flex gap-2">
        <PillButton
          disabled={busy || (!lockRefs && (!d.opportunityId || !d.partnerFirmId))}
          onClick={() => onSubmit(d)}
          data-testid="button-jp-save"
        >
          {busy ? "Saving…" : submitLabel}
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
      </div>
    </Card>
  );
}

function CoSellView() {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: pipelineData } = useAtelierListJointPipeline();
  const { data: firmsData } = useAtelierListPartnerFirms();
  const pipeline = pipelineData?.items ?? [];
  const firms = firmsData?.items ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListJointPipelineQueryKey() });
  };

  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const create = useAtelierCreateJointPipelineEntry();
  const update = useAtelierUpdateJointPipelineEntry();
  const archive = useAtelierArchiveJointPipelineEntry();

  const toInput = (d: PipelineDraft): AtelierJointPipelineInput => ({
    opportunityId: d.opportunityId,
    partnerFirmId: d.partnerFirmId,
    leadParty: d.leadParty as AtelierJointPipelineInput["leadParty"],
    cognirisePct: Number(d.cognirisePct || 0),
    partnerPct: Number(d.partnerPct || 0),
    splitRationale: d.splitRationale.trim() || undefined,
    allianceLetterStatus: d.allianceLetterStatus as AtelierJointPipelineInput["allianceLetterStatus"],
    partnerSourced: d.partnerSourced,
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Joint pipeline · linked to Clients · Opportunities</h3>
          <div className="flex items-center gap-3">
            <Link href="/opportunities" className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80">
              open clients lens →
            </Link>
            {canEdit && !adding && (
              <PillButton variant="ghost" onClick={() => { setAdding(true); setErr(null); }} data-testid="button-add-jp">
                <Plus className="w-3.5 h-3.5 mr-1 inline" /> Add joint opp
              </PillButton>
            )}
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          <Card className="p-4">
            <div className="text-xs text-text-faint">Active joint opps</div>
            <div className="text-2xl font-mono text-text mt-1">{pipeline.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-text-faint">Partner-sourced</div>
            <div className="text-2xl font-mono text-gold mt-1">{pipeline.filter((p) => p.partnerSourced).length}</div>
          </Card>
        </div>

        {adding && (
          <PipelineForm
            initial={emptyPipelineDraft}
            firms={firms}
            busy={create.isPending}
            error={err}
            submitLabel="Create entry"
            onCancel={() => { setAdding(false); setErr(null); }}
            onSubmit={(d) =>
              create.mutate({ data: toInput(d) }, {
                onSuccess: () => { setAdding(false); setErr(null); invalidate(); },
                onError: (e) => setErr(errMessage(e)),
              })
            }
          />
        )}

        {pipeline.length === 0 && !adding && (
          <p className="text-sm text-text-mute">
            No joint-pipeline entries. {canEdit ? "Link a CRM opportunity to a partner firm to start co-selling." : ""}
          </p>
        )}

        <div className="space-y-2">
          {pipeline.map((o) =>
            editingId === o.id ? (
              <PipelineForm
                key={o.id}
                lockRefs
                initial={{
                  opportunityId: o.opportunityId,
                  partnerFirmId: o.partnerFirmId,
                  leadParty: o.leadParty ?? "cognirise",
                  cognirisePct: String(o.cognirisePct ?? 50),
                  partnerPct: String(o.partnerPct ?? 50),
                  splitRationale: o.splitRationale ?? "",
                  allianceLetterStatus: o.allianceLetterStatus ?? "none",
                  partnerSourced: !!o.partnerSourced,
                }}
                firms={firms}
                busy={update.isPending}
                error={err}
                submitLabel="Save changes"
                onCancel={() => { setEditingId(null); setErr(null); }}
                onSubmit={(d) =>
                  update.mutate({
                    id: o.id,
                    data: {
                      leadParty: d.leadParty as AtelierJointPipelineInput["leadParty"],
                      cognirisePct: Number(d.cognirisePct || 0),
                      partnerPct: Number(d.partnerPct || 0),
                      splitRationale: d.splitRationale.trim() || undefined,
                      allianceLetterStatus: d.allianceLetterStatus as AtelierJointPipelineInput["allianceLetterStatus"],
                      partnerSourced: d.partnerSourced,
                    },
                  }, {
                    onSuccess: () => { setEditingId(null); setErr(null); invalidate(); },
                    onError: (e) => setErr(errMessage(e)),
                  })
                }
              />
            ) : (
              <RecordCard
                key={o.id}
                data-testid={`card-jp-${o.id}`}
                onClick={canEdit ? () => { setEditingId(o.id); setErr(null); } : undefined}
                title={o.opportunityName ?? o.opportunityId}
                subtitle={
                  <>
                    {o.clientName ?? "—"} · with {o.partnerFirmName ?? o.partnerFirmId}
                    {o.salesStage ? ` · ${o.salesStage.replace(/_/g, " ")}` : ""} · lead: {o.leadParty}
                  </>
                }
                trailing={
                  <>
                    <MonoChip tone="gold">Cognirise {o.cognirisePct}% · partner {o.partnerPct}%</MonoChip>
                    {o.partnerSourced && <MonoChip tone="green">partner-sourced</MonoChip>}
                  </>
                }
                actions={
                  canEdit ? (
                    <RecordCardAction
                      danger
                      onClick={() => {
                        setErr(null);
                        archive.mutate({ id: o.id }, {
                          onSuccess: () => invalidate(),
                          onError: (e) => setErr(errMessage(e)),
                        });
                      }}
                      data-testid={`button-archive-jp-${o.id}`}
                    >
                      <Archive className="w-3 h-3" />
                    </RecordCardAction>
                  ) : undefined
                }
                chips={<MonoChip>alliance letter · {o.allianceLetterStatus}</MonoChip>}
              >
                {o.splitRationale && <div className="text-sm text-text-mute">{o.splitRationale}</div>}
              </RecordCard>
            ),
          )}
        </div>
        {!adding && !editingId && <FormError msg={err} />}
      </section>
    </div>
  );
}

// =============================================================
// CO-DELIVER — real partner-firm resources + RCTI invoices
// =============================================================
function CoDeliverView() {
  const { data: coDeliver, isLoading } = useAtelierGetPartnerCoDeliver();
  const resources = coDeliver?.resources ?? [];
  const invoices = coDeliver?.invoices ?? [];

  return (
    <div className="space-y-8">
      <p className="text-sm text-text-mute">
        Co-delivery reads directly from the resourcing roster (partner-firm
        resources) and the self-billing (RCTI) system. Assign partner-firm
        resources in <Link href="/people" className="text-gold hover:underline">People · Resourcing</Link>;
        their self-billed invoices appear here per firm.
      </p>

      <section className="space-y-3">
        {/* Task #1171 — this is the home for partner-firm people; the
            internal People directory no longer lists them. Cards link to
            the person page (partner-contact layout). */}
        <h3 className="section-label">Partner contacts</h3>
        {!isLoading && resources.length === 0 && (
          <p className="text-sm text-text-mute">No partner-firm contacts on record.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {resources.map((r) => (
            <Card key={r.id} className="p-4" data-testid={`card-resource-${r.id}`}>
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/roster/people/${r.id}`}
                    className="font-medium text-text hover:text-gold"
                    data-testid={`link-resource-${r.id}`}
                  >
                    {r.fullName}
                  </Link>
                  <div className="text-xs text-text-faint">
                    {[r.role, r.seniority, r.country].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <MonoChip tone={r.status === "active" ? "green" : "default"}>{r.status.replace(/_/g, " ")}</MonoChip>
                  <span className="text-text-faint">{r.partnerFirmName ?? ""}</span>
                  {r.startDate && <span className="text-text-faint">since {r.startDate.slice(0, 10)}</span>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="section-label">Self-billing (RCTI) invoices</h3>
        {!isLoading && invoices.length === 0 && (
          <p className="text-sm text-text-mute">No self-billed invoices for partner firms.</p>
        )}
        {invoices.length > 0 && (
          <Card className="p-0 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-text-faint">
                <tr className="border-b border-border">
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-3 py-3">Firm</th>
                  <th className="px-3 py-3 font-mono">Week</th>
                  <th className="px-3 py-3 font-mono">Amount</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border-soft last:border-0">
                    <td className="px-4 py-3 font-mono text-text">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</td>
                    <td className="px-3 py-3 text-text">{inv.partnerFirmName ?? inv.supplierName ?? "—"}</td>
                    <td className="px-3 py-3 font-mono text-text-faint">{inv.weekIso ?? "—"}</td>
                    <td className="px-3 py-3 font-mono text-text">
                      {inv.totalAmount != null ? `${inv.currency ?? ""} ${inv.totalAmount}` : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <MonoChip tone={inv.status === "paid" ? "green" : inv.status === "disputed" ? "red" : "amber"}>
                        {inv.status.replace(/_/g, " ")}
                      </MonoChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

// =============================================================
// GOVERN — e-sign agreements + certifications (CRUD) + conflicts (CRUD)
// =============================================================
type CertDraft = {
  partnerFirmId: string;
  credential: string;
  platform: string;
  holder: string;
  status: string;
  expiresAt: string;
};

const emptyCertDraft: CertDraft = {
  partnerFirmId: "", credential: "", platform: "", holder: "", status: "active", expiresAt: "",
};

function CertForm({
  initial, firms, onSubmit, onCancel, busy, error, submitLabel,
}: {
  initial: CertDraft;
  firms: AtelierPartnerFirm[];
  onSubmit: (d: CertDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [d, setD] = React.useState(initial);
  const set = (k: keyof CertDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.value });
  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Partner firm">
          <Select value={d.partnerFirmId} onChange={set("partnerFirmId")} data-testid="select-cert-firm">
            <option value="">Select firm…</option>
            {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        </Field>
        <Field label="Credential"><TextInput value={d.credential} onChange={set("credential")} /></Field>
        <Field label="Platform"><TextInput value={d.platform} onChange={set("platform")} placeholder="e.g. AWS, Microsoft" /></Field>
        <Field label="Holder"><TextInput value={d.holder} onChange={set("holder")} placeholder="Person or firm-level" /></Field>
        <Field label="Status">
          <Select value={d.status} onChange={set("status")}>
            {["active", "lapsing", "lapsed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Expires"><TextInput type="date" value={d.expiresAt} onChange={set("expiresAt")} /></Field>
      </div>
      <FormError msg={error} />
      <div className="flex gap-2">
        <PillButton disabled={busy || !d.partnerFirmId || !d.credential.trim() || !d.platform.trim()} onClick={() => onSubmit(d)} data-testid="button-cert-save">
          {busy ? "Saving…" : submitLabel}
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
      </div>
    </Card>
  );
}

type ConflictDraft = {
  partnerFirmId: string;
  headline: string;
  severity: string;
  detail: string;
  recommendation: string;
};

const emptyConflictDraft: ConflictDraft = {
  partnerFirmId: "", headline: "", severity: "med", detail: "", recommendation: "",
};

function ConflictForm({
  initial, firms, onSubmit, onCancel, busy, error, submitLabel,
}: {
  initial: ConflictDraft;
  firms: AtelierPartnerFirm[];
  onSubmit: (d: ConflictDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [d, setD] = React.useState(initial);
  const set = (k: keyof ConflictDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.value });
  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Partner firm">
          <Select value={d.partnerFirmId} onChange={set("partnerFirmId")} data-testid="select-conflict-firm">
            <option value="">Select firm…</option>
            {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        </Field>
        <Field label="Headline"><TextInput value={d.headline} onChange={set("headline")} /></Field>
        <Field label="Severity">
          <Select value={d.severity} onChange={set("severity")}>
            {["high", "med", "low"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Detail"><TextInput value={d.detail} onChange={set("detail")} /></Field>
        <Field label="Recommendation"><TextInput value={d.recommendation} onChange={set("recommendation")} /></Field>
      </div>
      <FormError msg={error} />
      <div className="flex gap-2">
        <PillButton disabled={busy || !d.partnerFirmId || !d.headline.trim()} onClick={() => onSubmit(d)} data-testid="button-conflict-save">
          {busy ? "Saving…" : submitLabel}
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
      </div>
    </Card>
  );
}

// ===========================================================================
// Task #875 — Portal sharing: contract shares + partner doc-inbox review.
// Raw-fetch backed (bespoke /partners routes, not in the OpenAPI spec).
// ===========================================================================

type DocInboxRow = {
  id: string;
  partnerFirmId: string;
  partnerFirmName: string;
  fileName: string;
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  reviewNote: string | null;
  contractId: string | null;
  uploadedByLabel: string;
  createdAt: string;
};
type ShareRow = {
  id: string;
  contractId: string;
  contract: { id: string; title: string; contractType: string; status: string } | null;
  note: string | null;
  sharedByLabel: string;
  createdAt: string;
  revokedAt: string | null;
};

function PortalSharingSection({ firms, canEdit }: { firms: Array<{ id: string; name: string }>; canEdit: boolean }) {
  const [inbox, setInbox] = React.useState<DocInboxRow[]>([]);
  const [firmId, setFirmId] = React.useState("");
  const [shares, setShares] = React.useState<ShareRow[]>([]);
  const [contractId, setContractId] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void fetch(`${QUALIFY_API}/partners/doc-inbox`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (alive) setInbox(d.items ?? []); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [tick]);

  React.useEffect(() => {
    if (!firmId) { setShares([]); return; }
    let alive = true;
    void fetch(`${QUALIFY_API}/partners/firms/${firmId}/contract-shares`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (alive) setShares(d.items ?? []); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [firmId, tick]);

  const post = async (path: string, body: unknown) => {
    setErr(null);
    const r = await fetch(`${QUALIFY_API}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.message ?? d?.error ?? `request-failed:${r.status}`);
    setTick((t) => t + 1);
  };
  const act = (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    void fn().catch((e) => setErr((e as Error).message)).finally(() => setBusy(null));
  };

  const pending = inbox.filter((i) => i.status === "pending");

  return (
    <section className="space-y-3" data-testid="portal-sharing-section">
      <header className="flex items-center justify-between">
        <h3 className="section-label">Partner portal · shared contracts & document inbox</h3>
      </header>
      {err && <p className="text-xs text-danger">⚠ {err}</p>}

      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium text-text">Document inbox {pending.length > 0 && <span className="text-gold">· {pending.length} pending</span>}</div>
        {inbox.length === 0 && (
          <p className="text-sm text-text-mute" data-testid="doc-inbox-empty">
            Nothing uploaded by partner firms yet. Documents partners send from their portal land here for review.
          </p>
        )}
        <div className="space-y-2">
          {inbox.map((d) => (
            <div key={d.id} className="rounded-md border border-border p-3 text-sm" data-testid={`doc-inbox-${d.id}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-medium text-text">{d.fileName}</span>
                  <span className="text-text-mute"> · {d.partnerFirmName} · {d.uploadedByLabel}</span>
                  {d.note && <div className="text-xs text-text-mute mt-0.5">{d.note}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <MonoChip tone={d.status === "pending" ? "amber" : d.status === "accepted" ? "green" : "red"}>{d.status}</MonoChip>
                  <a href={`${QUALIFY_API}/partners/doc-inbox/${d.id}/download`} className="text-xs text-gold hover:text-gold/80">download</a>
                  {canEdit && d.status === "pending" && (
                    <>
                      <PillButton
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => {
                          const title = window.prompt("Contract title for the accepted document?", d.fileName.replace(/\.(pdf|docx)$/i, ""));
                          if (title === null) return;
                          act(`a:${d.id}`, () => post(`/partners/doc-inbox/${d.id}/review`, { decision: "accept", title }));
                        }}
                        data-testid={`btn-inbox-accept-${d.id}`}
                      >
                        Accept
                      </PillButton>
                      <PillButton
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => {
                          const note = window.prompt("Rejection note (shown to the partner)?");
                          if (note === null || !note.trim()) return;
                          act(`r:${d.id}`, () => post(`/partners/doc-inbox/${d.id}/review`, { decision: "reject", note: note.trim() }));
                        }}
                        data-testid={`btn-inbox-reject-${d.id}`}
                      >
                        Reject
                      </PillButton>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium text-text">Contracts shared to a firm's portal</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={firmId}
            onChange={(e) => setFirmId(e.target.value)}
            className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
            data-testid="select-share-firm"
          >
            <option value="">Select a partner firm…</option>
            {firms.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          {canEdit && firmId && (
            <>
              <input
                type="text"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                placeholder="Contract record id (ctr_…)"
                className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm font-mono"
                data-testid="input-share-contract-id"
              />
              <PillButton
                variant="ghost"
                disabled={!!busy || !contractId.trim()}
                onClick={() => act("share", async () => {
                  await post(`/partners/firms/${firmId}/contract-shares`, { contractId: contractId.trim() });
                  setContractId("");
                })}
                data-testid="btn-share-contract"
              >
                Share
              </PillButton>
            </>
          )}
        </div>
        {firmId && shares.length === 0 && (
          <p className="text-sm text-text-mute" data-testid="shares-empty">No contracts shared with this firm yet.</p>
        )}
        <div className="space-y-2">
          {shares.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm" data-testid={`share-${s.id}`}>
              <div>
                <span className="font-medium text-text">{s.contract?.title ?? s.contractId}</span>
                <span className="text-text-mute"> · shared by {s.sharedByLabel} · {s.createdAt.slice(0, 10)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.revokedAt ? (
                  <MonoChip tone="red">revoked</MonoChip>
                ) : (
                  <>
                    <MonoChip tone="green">active</MonoChip>
                    {canEdit && (
                      <PillButton
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => act(`rv:${s.id}`, () => post(`/partners/firms/${firmId}/contract-shares/${s.id}/revoke`, {}))}
                        data-testid={`btn-revoke-${s.id}`}
                      >
                        Revoke
                      </PillButton>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function GovernView() {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: agreementsData } = useAtelierListPartnerAgreements();
  const { data: certsData } = useAtelierListPartnerCertifications();
  const { data: conflictsData } = useAtelierListPartnerConflicts();
  const { data: firmsData } = useAtelierListPartnerFirms();
  const agreements = agreementsData?.items ?? [];
  const certs = certsData?.items ?? [];
  const conflicts = conflictsData?.items ?? [];
  const firms = firmsData?.items ?? [];

  const [addingCert, setAddingCert] = React.useState(false);
  const [editingCertId, setEditingCertId] = React.useState<string | null>(null);
  const [addingConflict, setAddingConflict] = React.useState(false);
  const [editingConflictId, setEditingConflictId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const createCert = useAtelierCreatePartnerCertification();
  const updateCert = useAtelierUpdatePartnerCertification();
  const archiveCert = useAtelierArchivePartnerCertification();
  const createConflict = useAtelierCreatePartnerConflict();
  const updateConflict = useAtelierUpdatePartnerConflict();
  const archiveConflict = useAtelierArchivePartnerConflict();

  const invalidateCerts = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerCertificationsQueryKey() });
  const invalidateConflicts = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerConflictsQueryKey() });

  const certToInput = (d: CertDraft): AtelierPartnerCertificationInput => ({
    partnerFirmId: d.partnerFirmId,
    credential: d.credential.trim(),
    platform: d.platform.trim(),
    holder: d.holder.trim() || null,
    status: d.status as AtelierPartnerCertificationInput["status"],
    expiresAt: d.expiresAt || null,
  });

  const conflictToInput = (d: ConflictDraft): AtelierPartnerConflictInput => ({
    partnerFirmId: d.partnerFirmId,
    headline: d.headline.trim(),
    severity: d.severity as AtelierPartnerConflictInput["severity"],
    detail: d.detail.trim() || undefined,
    recommendation: d.recommendation.trim() || undefined,
  });

  const lapsing = certs.filter((c) => c.status === "lapsing");
  const lapsed = certs.filter((c) => c.status === "lapsed");
  const openConflicts = conflicts.filter((c) => c.status === "open");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Agreements · from the e-sign contract system</h3>
          <Link href="/contracts" className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80">
            open contracts →
          </Link>
        </header>
        {agreements.length === 0 && (
          <p className="text-sm text-text-mute">
            No agreements with partner firms yet. Frameworks and NDAs are sent
            and tracked via the Contracts system with the firm as counterparty.
          </p>
        )}
        <div className="space-y-2">
          {agreements.map((a) => (
            <Card key={a.id} className="p-4" data-testid={`card-agreement-${a.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{a.title}</div>
                  <div className="text-xs text-text-faint mt-1">
                    {a.instrumentType.replace(/_/g, " ")} · {a.counterpartyName ?? a.counterpartyId}
                    {a.governingLaw ? ` · ${a.governingLaw}` : ""}
                  </div>
                  {(a.termStart || a.termEnd) && (
                    <div className="text-sm text-text-mute mt-2">
                      {a.termStart?.slice(0, 10) ?? "—"} → {a.termEnd?.slice(0, 10) ?? "open-ended"}
                    </div>
                  )}
                </div>
                <MonoChip tone={a.fullyExecutedAt ? "green" : "amber"}>
                  {a.status.replace(/_/g, " ")}
                </MonoChip>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <PortalSharingSection firms={firms.map((f) => ({ id: f.id, name: f.name }))} canEdit={canEdit} />

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Certifications</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-faint inline-flex items-center gap-2">
              <Award className="w-3.5 h-3.5" />
              {certs.filter((c) => c.status === "active").length} active · {lapsing.length} lapsing · {lapsed.length} lapsed
            </span>
            {canEdit && !addingCert && (
              <PillButton variant="ghost" onClick={() => { setAddingCert(true); setErr(null); }} data-testid="button-add-cert">
                <Plus className="w-3.5 h-3.5 mr-1 inline" /> Add
              </PillButton>
            )}
          </div>
        </header>

        {addingCert && (
          <CertForm
            initial={emptyCertDraft}
            firms={firms}
            busy={createCert.isPending}
            error={err}
            submitLabel="Create certification"
            onCancel={() => { setAddingCert(false); setErr(null); }}
            onSubmit={(d) =>
              createCert.mutate({ data: certToInput(d) }, {
                onSuccess: () => { setAddingCert(false); setErr(null); invalidateCerts(); },
                onError: (e) => setErr(errMessage(e)),
              })
            }
          />
        )}

        {certs.length === 0 && !addingCert && (
          <p className="text-sm text-text-mute">No certifications tracked.</p>
        )}

        <div className="space-y-1.5">
          {certs.map((c) =>
            editingCertId === c.id ? (
              <CertForm
                key={c.id}
                initial={{
                  partnerFirmId: c.partnerFirmId,
                  credential: c.credential,
                  platform: c.platform,
                  holder: c.holder ?? "",
                  status: c.status,
                  expiresAt: c.expiresAt?.slice(0, 10) ?? "",
                }}
                firms={firms}
                busy={updateCert.isPending}
                error={err}
                submitLabel="Save changes"
                onCancel={() => { setEditingCertId(null); setErr(null); }}
                onSubmit={(d) =>
                  updateCert.mutate({ id: c.id, data: certToInput(d) }, {
                    onSuccess: () => { setEditingCertId(null); setErr(null); invalidateCerts(); },
                    onError: (e) => setErr(errMessage(e)),
                  })
                }
              />
            ) : (
              <Card
                key={c.id}
                className={`p-3 ${canEdit ? "cursor-pointer hover:bg-bg-elevate-2 transition-colors" : ""}`}
                onClick={canEdit ? () => { setEditingCertId(c.id); setErr(null); } : undefined}
                data-testid={`card-cert-${c.id}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-text">{c.credential}</div>
                    <div className="text-xs text-text-faint">
                      {c.holder ?? c.partnerFirmName ?? "firm-level"} · {c.platform}
                      {c.partnerFirmName ? ` · ${c.partnerFirmName}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {c.expiresAt && <span className="text-xs text-text-faint">expires {c.expiresAt.slice(0, 10)}</span>}
                    <MonoChip tone={c.status === "active" ? "green" : c.status === "lapsing" ? "amber" : "red"}>{c.status}</MonoChip>
                    {canEdit && (
                      <span className="inline-flex gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="font-mono uppercase tracking-widest text-text-faint hover:text-red-400"
                          onClick={() => {
                            setErr(null);
                            archiveCert.mutate({ id: c.id }, {
                              onSuccess: () => invalidateCerts(),
                              onError: (e) => setErr(errMessage(e)),
                            });
                          }}
                          data-testid={`button-archive-cert-${c.id}`}
                        >
                          archive
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ),
          )}
        </div>
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Conflict & exclusivity checks</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-faint inline-flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              {openConflicts.length} open
            </span>
            {canEdit && !addingConflict && (
              <PillButton variant="ghost" onClick={() => { setAddingConflict(true); setErr(null); }} data-testid="button-add-conflict">
                <Plus className="w-3.5 h-3.5 mr-1 inline" /> Add
              </PillButton>
            )}
          </div>
        </header>

        {addingConflict && (
          <ConflictForm
            initial={emptyConflictDraft}
            firms={firms}
            busy={createConflict.isPending}
            error={err}
            submitLabel="Log conflict"
            onCancel={() => { setAddingConflict(false); setErr(null); }}
            onSubmit={(d) =>
              createConflict.mutate({ data: conflictToInput(d) }, {
                onSuccess: () => { setAddingConflict(false); setErr(null); invalidateConflicts(); },
                onError: (e) => setErr(errMessage(e)),
              })
            }
          />
        )}

        {conflicts.length === 0 && !addingConflict && (
          <p className="text-sm text-text-mute">No conflicts logged.</p>
        )}

        {conflicts.map((c) =>
          editingConflictId === c.id ? (
            <ConflictForm
              key={c.id}
              initial={{
                partnerFirmId: c.partnerFirmId,
                headline: c.headline,
                severity: c.severity ?? "med",
                detail: c.detail ?? "",
                recommendation: c.recommendation ?? "",
              }}
              firms={firms}
              busy={updateConflict.isPending}
              error={err}
              submitLabel="Save changes"
              onCancel={() => { setEditingConflictId(null); setErr(null); }}
              onSubmit={(d) =>
                updateConflict.mutate({ id: c.id, data: conflictToInput(d) }, {
                  onSuccess: () => { setEditingConflictId(null); setErr(null); invalidateConflicts(); },
                  onError: (e) => setErr(errMessage(e)),
                })
              }
            />
          ) : (
            <Card
              key={c.id}
              className={`p-4 border-l-4 ${c.status === "resolved" ? "border-l-border" : "border-l-amber-400"} ${canEdit ? "cursor-pointer hover:bg-bg-elevate-2 transition-colors" : ""}`}
              onClick={canEdit ? () => { setEditingConflictId(c.id); setErr(null); } : undefined}
              data-testid={`card-conflict-${c.id}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{c.headline}</div>
                  <div className="text-xs text-text-faint mt-1">
                    {c.partnerFirmName ?? c.partnerFirmId}
                    {c.detectedAt ? ` · ${c.detectedAt.slice(0, 10)}` : ""}
                  </div>
                  {c.detail && <div className="text-sm text-text-mute mt-2">{c.detail}</div>}
                  {c.recommendation && <div className="text-xs text-gold mt-2">Recommended: {c.recommendation}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <MonoChip tone={c.severity === "high" ? "red" : c.severity === "med" ? "amber" : "default"}>
                    {c.severity}
                  </MonoChip>
                  <MonoChip tone={c.status === "resolved" ? "green" : "amber"}>{c.status}</MonoChip>
                  {canEdit && (
                    <div className="flex flex-wrap justify-end gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      {c.status === "open" && (
                        <button
                          className="font-mono uppercase tracking-widest text-gold/80 hover:text-gold"
                          onClick={() => {
                            setErr(null);
                            updateConflict.mutate({ id: c.id, data: { status: "resolved" } }, {
                              onSuccess: () => invalidateConflicts(),
                              onError: (e) => setErr(errMessage(e)),
                            });
                          }}
                          data-testid={`button-resolve-conflict-${c.id}`}
                        >
                          resolve
                        </button>
                      )}
                      <button
                        className="font-mono uppercase tracking-widest text-text-faint hover:text-red-400"
                        onClick={() => {
                          setErr(null);
                          archiveConflict.mutate({ id: c.id }, {
                            onSuccess: () => invalidateConflicts(),
                            onError: (e) => setErr(errMessage(e)),
                          });
                        }}
                      >
                        archive
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ),
        )}
        {!addingCert && !addingConflict && !editingCertId && !editingConflictId && <FormError msg={err} />}
      </section>
    </div>
  );
}

// =============================================================
// RENEW — firm status lifecycle + tier-change history
// =============================================================
function RenewView() {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: firmsData } = useAtelierListPartnerFirms();
  const firms = firmsData?.items ?? [];
  const update = useAtelierUpdatePartnerFirm();
  const [err, setErr] = React.useState<string | null>(null);

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });

  const renewalDue = firms.filter((f) => f.status === "renewal_due");
  const windingDown = firms.filter((f) => f.status === "offboarded" || f.status === "terminated");

  const setStatus = (f: AtelierPartnerFirm, status: string) => {
    setErr(null);
    update.mutate(
      { id: f.id, data: { status: status as AtelierPartnerFirmInput["status"] } },
      { onSuccess: () => invalidate(), onError: (e) => setErr(errMessage(e)) },
    );
  };

  return (
    <div className="space-y-8">
      <p className="text-sm text-text-mute">
        Renewal is managed on the firm record itself: move a firm to
        <span className="font-mono text-text"> renewal due</span> when its framework
        approaches expiry, back to <span className="font-mono text-text">active</span> on
        re-signature, or through <span className="font-mono text-text">offboarded</span> to
        wind the relationship down. Tier changes are recorded automatically when a
        firm's tier is edited.
      </p>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Firm lifecycle</h3>
          <span className="text-xs text-text-faint">
            {renewalDue.length} renewal due · {windingDown.length} winding down
          </span>
        </header>
        {firms.length === 0 && <p className="text-sm text-text-mute">No partner firms in the registry.</p>}
        <div className="space-y-2">
          {firms.map((f) => (
            <Card key={f.id} className="p-4" data-testid={`card-renew-${f.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{f.name}</div>
                  <div className="text-xs text-text-faint mt-1">
                    {[f.kind, f.tier ? `tier · ${f.tier}` : null].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {(f.tierHistory?.length ?? 0) > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Tier history</div>
                      {f.tierHistory!.map((h, i) => (
                        <div key={i} className="text-xs text-text-mute">
                          <span className="text-text-faint">{h.at?.slice(0, 10) ?? "—"}</span>
                          {" · "}
                          {h.fromTier ?? "—"} → <span className="text-gold">{h.toTier ?? "—"}</span>
                          {h.reason ? ` · ${h.reason}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 text-xs">
                  <MonoChip
                    tone={f.status === "active" ? "green" : f.status === "renewal_due" ? "amber" : f.status === "terminated" ? "red" : "default"}
                  >
                    {f.status.replace("_", " ")}
                  </MonoChip>
                  {canEdit && (
                    <Select
                      value={f.status}
                      onChange={(e) => setStatus(f, e.target.value)}
                      disabled={update.isPending}
                      data-testid={`select-status-${f.id}`}
                    >
                      {FIRM_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </Select>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
        <FormError msg={err} />
      </section>
    </div>
  );
}

const AGREEMENT_STAGES = ["preparing", "negotiating", "reviewing", "signing", "signed"] as const;

function FirmBankChangesSection() {
  type BankReq = {
    id: string;
    partnerFirmId: string;
    firmName: string;
    previousIbanMasked: string | null;
    newIbanMasked: string;
    newSwift: string | null;
    newBankName: string | null;
    newCurrency: string | null;
    reason: string | null;
    status: string;
    decidedByName: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    createdAt: string;
  };
  const [rows, setRows] = React.useState<BankReq[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [forbidden, setForbidden] = React.useState(false);

  const load = React.useCallback(() => {
    void fetch(`${QUALIFY_API}/partners/bank-changes`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403) {
          setForbidden(true);
          return { items: [] };
        }
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { items: BankReq[] };
      })
      .then((j) => setRows(j.items))
      .catch(() => setMsg("Couldn't load bank-detail submissions."));
  }, []);
  React.useEffect(() => load(), [load]);

  const decide = (id: string, verb: "approve" | "reject") => {
    setBusyId(id);
    setMsg(null);
    void fetch(`${QUALIFY_API}/partners/bank-changes/${id}/${verb}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : `${verb} failed.`);
        setMsg(verb === "approve" ? "Approved — the details are now payable." : "Rejected.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusyId(null));
  };

  if (forbidden) return null;
  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const decided = (rows ?? []).filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <section className="space-y-3" data-testid="section-firm-bank-changes">
      <div className="text-xs font-mono uppercase tracking-widest text-text-faint">
        Partner bank-detail submissions
      </div>
      <p className="text-xs text-text-mute">
        Bank details submitted by partners during registration. Nothing becomes payable until a
        reviewer approves it here (maker-checker, audited).
      </p>
      {rows == null ? (
        <p className="text-xs text-text-faint">Loading…</p>
      ) : pending.length === 0 && decided.length === 0 ? (
        <p className="text-xs text-text-faint">No submissions yet.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((r) => (
            <Card key={r.id} className="p-3 space-y-1" data-testid={`card-bank-change-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text font-medium">{r.firmName}</span>
                <MonoChip tone="amber">pending</MonoChip>
                <span className="text-text-faint">{r.createdAt.slice(0, 10)}</span>
              </div>
              <div className="text-xs text-text-mute">
                IBAN {r.previousIbanMasked ?? "—"} → {r.newIbanMasked}
                {r.newSwift ? ` · SWIFT ${r.newSwift}` : ""}
                {r.newBankName ? ` · ${r.newBankName}` : ""}
                {r.newCurrency ? ` · ${r.newCurrency}` : ""}
              </div>
              {r.reason && <div className="text-xs text-text-faint">{r.reason}</div>}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80 disabled:opacity-50"
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "approve")}
                  data-testid={`button-approve-bank-change-${r.id}`}
                >
                  approve &amp; apply
                </button>
                <button
                  type="button"
                  className="text-xs font-mono uppercase tracking-widest text-danger hover:underline disabled:opacity-50"
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "reject")}
                  data-testid={`button-reject-bank-change-${r.id}`}
                >
                  reject
                </button>
              </div>
            </Card>
          ))}
          {decided.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs px-1" data-testid={`row-bank-change-${r.id}`}>
              <span className="text-text">{r.firmName}</span>
              <MonoChip tone={r.status === "approved" ? "green" : "default"}>{r.status}</MonoChip>
              <span className="text-text-faint">
                {r.newIbanMasked}
                {r.decidedByName ? ` · ${r.decidedByName}` : ""}
                {r.decidedAt ? ` · ${r.decidedAt.slice(0, 10)}` : ""}
              </span>
              {r.decisionNote && <span className="text-text-faint">{r.decisionNote}</span>}
            </div>
          ))}
        </div>
      )}
      {msg && <p className="text-xs text-text-faint">{msg}</p>}
    </section>
  );
}

// ---- Firm document review (Task #1172) --------------------------------------
// Leadership/finance review of partner-firm documents uploaded during
// registration or via the partner portal. Accept/reject with a note; accepted
// docs with expiries surface in the roster compliance partner section.
type FirmDocItem = {
  id: string;
  partnerFirmId: string;
  firmName: string;
  kind: string;
  title: string | null;
  fileName: string;
  sizeBytes: number;
  issuedDate: string | null;
  expiryDate: string | null;
  reviewStatus: "pending" | "accepted" | "rejected";
  reviewNote?: string | null;
  uploadedVia: string;
  createdAt: string;
};

const FIRM_DOC_KIND_LABELS: Record<string, string> = {
  trade_license: "Trade license",
  certificate: "Certificate",
  insurance: "Insurance",
  vat_trn: "VAT / TRN registration",
  signatory_id: "Signatory ID",
  other: "Other",
};
function firmDocKindLabel(kind: string): string {
  return FIRM_DOC_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function FirmDocumentsReviewSection() {
  const [rows, setRows] = React.useState<FirmDocItem[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [forbidden, setForbidden] = React.useState(false);
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  const load = React.useCallback(() => {
    void fetch(`${QUALIFY_API}/partners/firm-documents?status=all`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403 || r.status === 404) {
          if (r.status === 403) setForbidden(true);
          return { items: [] };
        }
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { items: FirmDocItem[] };
      })
      .then((j) => setRows(j.items))
      .catch(() => setMsg("Couldn't load firm documents."));
  }, []);
  React.useEffect(() => load(), [load]);

  const decide = (id: string, decision: "accept" | "reject") => {
    setBusyId(id);
    setMsg(null);
    void fetch(`${QUALIFY_API}/partners/firm-documents/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ decision: decision === "accept" ? "accepted" : "rejected", note: notes[id]?.trim() || null }),
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : `${decision} failed.`);
        setMsg(decision === "accept" ? "Accepted." : "Rejected.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusyId(null));
  };

  if (forbidden) return null;
  const pending = (rows ?? []).filter((r) => r.reviewStatus === "pending");
  const decided = (rows ?? []).filter((r) => r.reviewStatus !== "pending").slice(0, 8);

  return (
    <section className="space-y-3" data-testid="section-firm-documents">
      <div className="text-xs font-mono uppercase tracking-widest text-text-faint">
        Partner firm documents
      </div>
      <p className="text-xs text-text-mute">
        Trade licenses, certificates, insurance and IDs uploaded by partners. Accepted documents
        with an expiry date surface in Roster → Compliance. Reviews are org-scoped and audited.
      </p>
      {rows == null ? (
        <p className="text-xs text-text-faint">Loading…</p>
      ) : pending.length === 0 && decided.length === 0 ? (
        <p className="text-xs text-text-faint">No documents submitted yet.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((r) => (
            <Card key={r.id} className="p-3 space-y-2" data-testid={`card-firm-doc-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text font-medium">{r.firmName}</span>
                <MonoChip tone="amber">pending</MonoChip>
                <span className="text-text-faint">{r.createdAt.slice(0, 10)}</span>
              </div>
              <div className="text-xs text-text-mute">
                {firmDocKindLabel(r.kind)}
                {r.title ? ` · ${r.title}` : ""} · {r.fileName}
                {r.expiryDate ? ` · expires ${r.expiryDate}` : ""}
                {` · via ${r.uploadedVia}`}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <a
                  href={`${QUALIFY_API}/partners/firm-documents/${r.id}/download`}
                  className="font-mono uppercase tracking-widest text-gold hover:text-gold/80"
                  data-testid={`link-firm-doc-download-${r.id}`}
                >
                  download
                </a>
              </div>
              <input
                type="text"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                placeholder="Review note (optional; shown to partner if rejected)"
                className="w-full glass-surface border border-border-soft rounded px-2 py-1 text-xs"
                data-testid={`input-firm-doc-note-${r.id}`}
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80 disabled:opacity-50"
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "accept")}
                  data-testid={`button-accept-firm-doc-${r.id}`}
                >
                  accept
                </button>
                <button
                  type="button"
                  className="text-xs font-mono uppercase tracking-widest text-danger hover:underline disabled:opacity-50"
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "reject")}
                  data-testid={`button-reject-firm-doc-${r.id}`}
                >
                  reject
                </button>
              </div>
            </Card>
          ))}
          {decided.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs px-1" data-testid={`row-firm-doc-${r.id}`}>
              <span className="text-text">{r.firmName}</span>
              <MonoChip tone={r.reviewStatus === "accepted" ? "green" : "red"}>{r.reviewStatus}</MonoChip>
              <span className="text-text-faint">
                {firmDocKindLabel(r.kind)}
                {r.expiryDate ? ` · expires ${r.expiryDate}` : ""}
              </span>
              {r.reviewNote && <span className="text-text-faint">{r.reviewNote}</span>}
              <a
                href={`${QUALIFY_API}/partners/firm-documents/${r.id}/download`}
                className="font-mono uppercase tracking-widest text-gold hover:text-gold/80"
                data-testid={`link-firm-doc-download-${r.id}`}
              >
                download
              </a>
            </div>
          ))}
        </div>
      )}
      {msg && <p className="text-xs text-text-faint">{msg}</p>}
    </section>
  );
}

// ---- Firm contact-suggestion review (Task #1172) ----------------------------
// Partners can suggest new contact lists via the portal; approving one applies
// it to the firm's contacts (with roster promotion). Org-scoped + audited.
type SuggestedContact = { id?: string; name: string; role?: string | null; email?: string | null };
type ContactSuggestionItem = {
  id: string;
  partnerFirmId: string;
  firmName: string;
  proposedContacts: SuggestedContact[];
  currentContacts?: SuggestedContact[];
  note: string | null;
  status: "pending" | "approved" | "rejected";
  decidedByName?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdAt: string;
};

function FirmContactSuggestionsSection() {
  const [rows, setRows] = React.useState<ContactSuggestionItem[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [forbidden, setForbidden] = React.useState(false);
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  const load = React.useCallback(() => {
    void fetch(`${QUALIFY_API}/partners/contact-suggestions?status=all`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403 || r.status === 404) {
          if (r.status === 403) setForbidden(true);
          return { items: [] };
        }
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { items: ContactSuggestionItem[] };
      })
      .then((j) => setRows(j.items))
      .catch(() => setMsg("Couldn't load contact suggestions."));
  }, []);
  React.useEffect(() => load(), [load]);

  const decide = (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    setMsg(null);
    void fetch(`${QUALIFY_API}/partners/contact-suggestions/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ decision: decision === "approve" ? "approved" : "rejected", note: notes[id]?.trim() || null }),
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof j.message === "string" ? j.message : `${decision} failed.`);
        setMsg(decision === "approve" ? "Approved — contacts updated." : "Rejected.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusyId(null));
  };

  const renderContacts = (list: SuggestedContact[] | undefined) =>
    !list || list.length === 0 ? (
      <span className="text-text-faint italic">none</span>
    ) : (
      <ul className="space-y-0.5">
        {list.map((c, i) => (
          <li key={c.id ?? i}>
            {c.name}
            {c.role ? ` · ${c.role}` : ""}
            {c.email ? ` · ${c.email}` : ""}
          </li>
        ))}
      </ul>
    );

  if (forbidden) return null;
  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const decided = (rows ?? []).filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <section className="space-y-3" data-testid="section-firm-contact-suggestions">
      <div className="text-xs font-mono uppercase tracking-widest text-text-faint">
        Partner contact-change suggestions
      </div>
      <p className="text-xs text-text-mute">
        Contact lists proposed by partners through the portal. Approving replaces the firm's current
        contacts (and promotes them onto the roster). Org-scoped + audited.
      </p>
      {rows == null ? (
        <p className="text-xs text-text-faint">Loading…</p>
      ) : pending.length === 0 && decided.length === 0 ? (
        <p className="text-xs text-text-faint">No suggestions yet.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((r) => (
            <Card key={r.id} className="p-3 space-y-2" data-testid={`card-contact-suggestion-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text font-medium">{r.firmName}</span>
                <MonoChip tone="amber">pending</MonoChip>
                <span className="text-text-faint">{r.createdAt.slice(0, 10)}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 text-xs text-text-mute">
                <div>
                  <div className="font-mono uppercase tracking-widest text-text-faint mb-1">Current</div>
                  {renderContacts(r.currentContacts)}
                </div>
                <div>
                  <div className="font-mono uppercase tracking-widest text-text-faint mb-1">Proposed</div>
                  {renderContacts(r.proposedContacts)}
                </div>
              </div>
              {r.note && <div className="text-xs text-text-faint">Note: {r.note}</div>}
              <input
                type="text"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                placeholder="Decision note (optional)"
                className="w-full glass-surface border border-border-soft rounded px-2 py-1 text-xs"
                data-testid={`input-contact-suggestion-note-${r.id}`}
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80 disabled:opacity-50"
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "approve")}
                  data-testid={`button-approve-contact-suggestion-${r.id}`}
                >
                  approve &amp; apply
                </button>
                <button
                  type="button"
                  className="text-xs font-mono uppercase tracking-widest text-danger hover:underline disabled:opacity-50"
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "reject")}
                  data-testid={`button-reject-contact-suggestion-${r.id}`}
                >
                  reject
                </button>
              </div>
            </Card>
          ))}
          {decided.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs px-1" data-testid={`row-contact-suggestion-${r.id}`}>
              <span className="text-text">{r.firmName}</span>
              <MonoChip tone={r.status === "approved" ? "green" : "default"}>{r.status}</MonoChip>
              <span className="text-text-faint">
                {r.proposedContacts.length} contact{r.proposedContacts.length === 1 ? "" : "s"}
                {r.decidedByName ? ` · ${r.decidedByName}` : ""}
                {r.decidedAt ? ` · ${r.decidedAt.slice(0, 10)}` : ""}
              </span>
              {r.decisionNote && <span className="text-text-faint">{r.decisionNote}</span>}
            </div>
          ))}
        </div>
      )}
      {msg && <p className="text-xs text-text-faint">{msg}</p>}
    </section>
  );
}
