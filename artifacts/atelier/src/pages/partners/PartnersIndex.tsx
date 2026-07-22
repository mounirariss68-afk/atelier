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
 *   Qualify    — capability scores per firm (editable) + NDA status from real e-sign agreements
 *   Co-sell    — joint pipeline linked to real CRM opportunities (CRUD)
 *   Co-deliver — real partner-firm-resource assignments + RCTI self-billing invoices
 *   Govern     — e-sign agreements with partner firms + certifications + conflicts (CRUD)
 *   Renew      — firm status lifecycle + tier-change history on the registry record
 */
import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { RecordCard, RecordCardAction } from "@/components/ui/record-card";
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
} from "lucide-react";
import {
  useAtelierGetMe,
  useAtelierListPartnerFirms,
  useAtelierCreatePartnerFirm,
  useAtelierUpdatePartnerFirm,
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
  { id: "qualify", label: "Qualify", href: "/partners/qualify", icon: CheckCircle2, blurb: "Capability scores and NDA status from real e-sign agreements." },
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
const CAP_DIMENSIONS = ["delivery", "sales", "geo_gcc", "geo_eu", "regulated", "agents"] as const;

function useCanEdit(): boolean {
  const { data: me } = useAtelierGetMe();
  return !!me?.role && EDITOR_ROLES.has(me.role);
}

function errMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as { body?: { error?: string; message?: string }; message?: string };
    return anyE.body?.error ?? anyE.body?.message ?? anyE.message ?? "Request failed";
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
};

const emptyFirmDraft: FirmDraft = {
  name: "", kind: "", speciality: "", country: "", tier: "", status: "active",
  relationshipStrength: "", anchorCognirise: "", anchorPartner: "",
  contactName: "", contactEmail: "", notes: "",
};

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
  const { data: firmsData } = useAtelierListPartnerFirms();
  const firms = firmsData?.items ?? [];

  const invalidateFirms = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });
  };

  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const create = useAtelierCreatePartnerFirm();
  const update = useAtelierUpdatePartnerFirm();
  const archive = useAtelierArchivePartnerFirm();
  const [evalOpenId, setEvalOpenId] = React.useState<string | null>(null);

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
            {canEdit && !adding && (
              <PillButton variant="ghost" onClick={() => { setAdding(true); setErr(null); }} data-testid="button-add-firm">
                <Plus className="w-3.5 h-3.5 mr-1 inline" /> Add firm
              </PillButton>
            )}
          </div>
        </header>

        {adding && (
          <FirmForm
            initial={emptyFirmDraft}
            busy={create.isPending}
            error={err}
            submitLabel="Create firm"
            onCancel={() => { setAdding(false); setErr(null); }}
            onSubmit={(d) =>
              create.mutate({ data: firmInputFrom(d) }, {
                onSuccess: () => { setAdding(false); setErr(null); invalidateFirms(); },
                onError: (e) => setErr(errMessage(e)),
              })
            }
          />
        )}

        {firms.length === 0 && !adding && (
          <p className="text-sm text-text-mute">
            No partner firms yet. {canEdit ? "Add the first firm or promote a target from below." : ""}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
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
            ) : (
              <RecordCard
                key={f.id}
                data-testid={`card-firm-${f.id}`}
                onClick={canEdit ? () => { setEditingId(f.id); setErr(null); } : undefined}
                title={f.name}
                subtitle={[f.kind, f.country, f.speciality].filter(Boolean).join(" · ") || "—"}
                trailing={
                  <>
                    {f.partnershipStage === "candidate" && <MonoChip tone="amber">candidate</MonoChip>}
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
              </RecordCard>
            ),
          )}
        </div>
        {!adding && !editingId && <FormError msg={err} />}
      </section>

      <TargetsSection firms={firms} />
    </div>
  );
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
// QUALIFY — capability scores (editable) + NDA from real agreements
// =============================================================
function QualifyView() {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { data: firmsData } = useAtelierListPartnerFirms();
  const { data: agreementsData } = useAtelierListPartnerAgreements();
  const firms = (firmsData?.items ?? []).filter((f) => f.status !== "terminated");
  const agreements = agreementsData?.items ?? [];

  const update = useAtelierUpdatePartnerFirm();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [scores, setScores] = React.useState<Record<string, string>>({});
  const [err, setErr] = React.useState<string | null>(null);

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

  const startEdit = (f: AtelierPartnerFirm) => {
    setEditingId(f.id);
    setErr(null);
    const s: Record<string, string> = {};
    for (const d of CAP_DIMENSIONS) {
      const v = (f.capabilities ?? {})[d];
      s[d] = v != null ? String(v) : "";
    }
    setScores(s);
  };

  const saveEdit = (f: AtelierPartnerFirm) => {
    const capabilities: Record<string, number> = { ...(f.capabilities ?? {}) };
    for (const d of CAP_DIMENSIONS) {
      const raw = scores[d];
      if (raw === "" || raw == null) delete capabilities[d];
      else capabilities[d] = Number(raw);
    }
    update.mutate({ id: f.id, data: { capabilities } }, {
      onSuccess: () => {
        setEditingId(null);
        void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });
      },
      onError: (e) => setErr(errMessage(e)),
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-mute">
        Capability scores (1–5 per dimension) are stored on the partner-firm
        record. NDA status is read from real e-sign agreements with the firm —
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
                {CAP_DIMENSIONS.map((d) => (
                  <th key={d} className="px-3 py-3 font-mono">{d.replace("_", " ")}</th>
                ))}
                <th className="px-3 py-3">NDA</th>
                {canEdit && <th className="px-3 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => {
                const editing = editingId === f.id;
                const nda = ndaByFirm.get(f.id);
                return (
                  <tr key={f.id} className="border-b border-border-soft last:border-0" data-testid={`row-qualify-${f.id}`}>
                    <td className="px-4 py-3 font-medium text-text">
                      <span className="inline-flex items-center gap-2">
                        {f.name}
                        <AllianceVerdictChip firm={f} />
                      </span>
                    </td>
                    {CAP_DIMENSIONS.map((d) => {
                      if (editing) {
                        return (
                          <td key={d} className="px-2 py-2">
                            <input
                              type="number" min={0} max={5}
                              className="w-14 bg-bg-deep border border-border rounded-sm px-1.5 py-1 text-sm text-text"
                              value={scores[d] ?? ""}
                              onChange={(e) => setScores({ ...scores, [d]: e.target.value })}
                            />
                          </td>
                        );
                      }
                      const v = (f.capabilities ?? {})[d];
                      return (
                        <td key={d} className="px-3 py-3">
                          {v == null ? (
                            <span className="text-text-faint">—</span>
                          ) : (
                            <MonoChip tone={v >= 4 ? "gold" : v >= 3 ? "green" : v >= 2 ? "amber" : "red"}>{v}</MonoChip>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3">
                      {nda ? (
                        <MonoChip tone={nda === "signed" ? "green" : "amber"}>{nda.replace(/_/g, " ")}</MonoChip>
                      ) : (
                        <MonoChip>none</MonoChip>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {editing ? (
                          <span className="inline-flex gap-2">
                            <button className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80" onClick={() => saveEdit(f)} disabled={update.isPending}>
                              {update.isPending ? "saving…" : "save"}
                            </button>
                            <button className="text-xs font-mono uppercase tracking-widest text-text-faint" onClick={() => setEditingId(null)}>cancel</button>
                          </span>
                        ) : (
                          <button className="text-xs font-mono uppercase tracking-widest text-gold/80 hover:text-gold" onClick={() => startEdit(f)} data-testid={`button-score-${f.id}`}>
                            score
                          </button>
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
        <h3 className="section-label">Partner-firm resources</h3>
        {!isLoading && resources.length === 0 && (
          <p className="text-sm text-text-mute">No partner-firm resources on the roster.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {resources.map((r) => (
            <Card key={r.id} className="p-4" data-testid={`card-resource-${r.id}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text">{r.fullName}</div>
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
              <Card key={c.id} className="p-3" data-testid={`card-cert-${c.id}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-text">{c.credential}</div>
                    <div className="text-xs text-text-faint">
                      {c.holder ?? c.partnerFirmName ?? "firm-level"} · {c.platform}
                      {c.partnerFirmName ? ` · ${c.partnerFirmName}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.expiresAt && <span className="text-xs text-text-faint">expires {c.expiresAt.slice(0, 10)}</span>}
                    <MonoChip tone={c.status === "active" ? "green" : c.status === "lapsing" ? "amber" : "red"}>{c.status}</MonoChip>
                    {canEdit && (
                      <span className="inline-flex gap-2 text-xs">
                        <button className="font-mono uppercase tracking-widest text-gold/80 hover:text-gold" onClick={() => { setEditingCertId(c.id); setErr(null); }}>edit</button>
                        <button
                          className="font-mono uppercase tracking-widest text-text-faint hover:text-red-400"
                          onClick={() => {
                            setErr(null);
                            archiveCert.mutate({ id: c.id }, {
                              onSuccess: () => invalidateCerts(),
                              onError: (e) => setErr(errMessage(e)),
                            });
                          }}
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
              className={`p-4 border-l-4 ${c.status === "resolved" ? "border-l-border" : "border-l-amber-400"}`}
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
                    <div className="flex gap-2 pt-1">
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
                        className="font-mono uppercase tracking-widest text-gold/80 hover:text-gold"
                        onClick={() => { setEditingConflictId(c.id); setErr(null); }}
                      >
                        edit
                      </button>
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
