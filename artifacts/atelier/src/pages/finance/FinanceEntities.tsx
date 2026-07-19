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
import { Plus, Pencil, Archive, FileText, Sparkles, Loader2 } from "lucide-react";

const API_BASE = "/api/atelier";

async function jsonReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (data as { message?: string; error?: string }).message ??
      (data as { error?: string }).error ??
      `${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// ISO-3166 country labels — no hardcoded registry countries; the filter is
// derived from whatever countries exist in the data and labelled here.
// ---------------------------------------------------------------------------

const ISO_COUNTRY: Record<string, string> = {
  AE: "🇦🇪 United Arab Emirates", SA: "🇸🇦 Saudi Arabia", GB: "🇬🇧 United Kingdom",
  US: "🇺🇸 United States", QA: "🇶🇦 Qatar", KW: "🇰🇼 Kuwait", BH: "🇧🇭 Bahrain",
  OM: "🇴🇲 Oman", EG: "🇪🇬 Egypt", JO: "🇯🇴 Jordan", LB: "🇱🇧 Lebanon",
  TR: "🇹🇷 Türkiye", DE: "🇩🇪 Germany", FR: "🇫🇷 France", NL: "🇳🇱 Netherlands",
  CH: "🇨🇭 Switzerland", LU: "🇱🇺 Luxembourg", IE: "🇮🇪 Ireland", ES: "🇪🇸 Spain",
  IT: "🇮🇹 Italy", PT: "🇵🇹 Portugal", BE: "🇧🇪 Belgium", AT: "🇦🇹 Austria",
  SE: "🇸🇪 Sweden", DK: "🇩🇰 Denmark", NO: "🇳🇴 Norway", FI: "🇫🇮 Finland",
  PL: "🇵🇱 Poland", CZ: "🇨🇿 Czechia", GR: "🇬🇷 Greece", CY: "🇨🇾 Cyprus",
  MT: "🇲🇹 Malta", IN: "🇮🇳 India", PK: "🇵🇰 Pakistan", SG: "🇸🇬 Singapore",
  HK: "🇭🇰 Hong Kong", JP: "🇯🇵 Japan", KR: "🇰🇷 South Korea", CN: "🇨🇳 China",
  AU: "🇦🇺 Australia", NZ: "🇳🇿 New Zealand", CA: "🇨🇦 Canada", BR: "🇧🇷 Brazil",
  MX: "🇲🇽 Mexico", ZA: "🇿🇦 South Africa", NG: "🇳🇬 Nigeria", KE: "🇰🇪 Kenya",
  MA: "🇲🇦 Morocco", TN: "🇹🇳 Tunisia", DM: "🇩🇲 Dominica", IL: "🇮🇱 Israel",
};

function countryLabel(code: string): string {
  return ISO_COUNTRY[code?.toUpperCase()] ?? code?.toUpperCase() ?? "—";
}

const STATUS_LABEL: Record<LegalEntityRow["status"], string> = {
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

function expiryTone(iso: string | null | undefined): "green" | "amber" | "red" | "default" {
  const d = daysUntil(iso);
  if (!Number.isFinite(d)) return "default";
  if (d < 0) return "red";
  if (d <= 60) return "amber";
  return "green";
}

function expiryText(iso: string | null | undefined): string {
  const d = daysUntil(iso);
  if (!Number.isFinite(d)) return "no expiry";
  if (d < 0) return `expired ${Math.abs(d)}d ago`;
  if (d === 0) return "expires today";
  return `${d}d left`;
}

const fieldCls =
  "h-9 w-full rounded-md border border-border bg-bg-elevate px-2 text-sm text-text outline-none focus-visible:border-gold";
const labelCls = "text-[10px] font-mono uppercase tracking-widest text-text-mute";

// ---------------------------------------------------------------------------
// Form state — flat strings, converted to the API body on submit
// ---------------------------------------------------------------------------

interface RegDraft {
  id?: string;
  type: string;
  label: string;
  number: string;
  issuer: string;
  issuedOn: string;
  expiresOn: string;
}
interface ActDraft { code: string; nameEn: string; nameAr: string }
interface OwnerDraft {
  name: string;
  nameAr: string;
  roles: string;
  sharePct: string;
  nationality: string;
  passportNo: string;
  personNo: string;
}

interface EntityDraft {
  legalNameEn: string;
  legalNameAr: string;
  shortName: string;
  legalForm: string;
  country: string;
  jurisdiction: string;
  status: string;
  incorporationDate: string;
  durationYears: string;
  baseCurrency: string;
  registeredAddress: string;
  governingLaw: string;
  courts: string;
  registrations: RegDraft[];
  activities: ActDraft[];
  owners: OwnerDraft[];
  premises: {
    addressLine: string; building: string; unit: string; area: string; city: string;
    plotNumber: string; makaniNo: string; sizeSqm: string; usage: string;
  };
  lease: {
    contractNo: string; ejariTenantNo: string; lessorName: string; lessorLicenseNo: string;
    ownerName: string; startDate: string; endDate: string; annualRentAed: string;
    securityDepositAed: string; areaSqm: string; registrationFeesAed: string;
  };
  notes: string;
}

function emptyDraft(): EntityDraft {
  return {
    legalNameEn: "", legalNameAr: "", shortName: "", legalForm: "", country: "",
    jurisdiction: "", status: "active", incorporationDate: "", durationYears: "",
    baseCurrency: "", registeredAddress: "", governingLaw: "", courts: "",
    registrations: [], activities: [], owners: [],
    premises: { addressLine: "", building: "", unit: "", area: "", city: "", plotNumber: "", makaniNo: "", sizeSqm: "", usage: "" },
    lease: { contractNo: "", ejariTenantNo: "", lessorName: "", lessorLicenseNo: "", ownerName: "", startDate: "", endDate: "", annualRentAed: "", securityDepositAed: "", areaSqm: "", registrationFeesAed: "" },
    notes: "",
  };
}

function draftFromEntity(e: LegalEntityRow): EntityDraft {
  return {
    legalNameEn: e.legalNameEn, legalNameAr: e.legalNameAr ?? "", shortName: e.shortName,
    legalForm: e.legalForm, country: e.country, jurisdiction: e.jurisdiction,
    status: e.status === "archived" ? "active" : e.status,
    incorporationDate: e.incorporationDate ?? "", durationYears: e.durationYears?.toString() ?? "",
    baseCurrency: e.baseCurrency, registeredAddress: e.registeredAddress,
    governingLaw: e.governingLaw, courts: e.courts,
    registrations: (e.registrations ?? []).map((r) => ({
      id: r.id, type: r.type, label: r.label, number: r.number,
      issuer: r.issuer ?? "", issuedOn: r.issuedOn ?? "", expiresOn: r.expiresOn ?? "",
    })),
    activities: (e.activities ?? []).map((a) => ({ code: a.code, nameEn: a.nameEn, nameAr: a.nameAr ?? "" })),
    owners: (e.owners ?? []).map((o) => ({
      name: o.name, nameAr: o.nameAr ?? "", roles: (o.roles ?? []).join(", "),
      sharePct: o.sharePct?.toString() ?? "", nationality: o.nationality ?? "",
      passportNo: o.passportNo ?? "", personNo: o.personNo ?? "",
    })),
    premises: {
      addressLine: e.premises?.addressLine ?? "", building: e.premises?.building ?? "",
      unit: e.premises?.unit ?? "", area: e.premises?.area ?? "", city: e.premises?.city ?? "",
      plotNumber: e.premises?.plotNumber ?? "", makaniNo: e.premises?.makaniNo ?? "",
      sizeSqm: e.premises?.sizeSqm?.toString() ?? "", usage: e.premises?.usage ?? "",
    },
    lease: {
      contractNo: e.lease?.contractNo ?? "", ejariTenantNo: e.lease?.ejariTenantNo ?? "",
      lessorName: e.lease?.lessorName ?? "", lessorLicenseNo: e.lease?.lessorLicenseNo ?? "",
      ownerName: e.lease?.ownerName ?? "", startDate: e.lease?.startDate ?? "",
      endDate: e.lease?.endDate ?? "", annualRentAed: e.lease?.annualRentAed?.toString() ?? "",
      securityDepositAed: e.lease?.securityDepositAed?.toString() ?? "",
      areaSqm: e.lease?.areaSqm?.toString() ?? "",
      registrationFeesAed: e.lease?.registrationFeesAed?.toString() ?? "",
    },
    notes: e.notes ?? "",
  };
}

const num = (s: string): number | null => {
  const v = Number(s.replace(/,/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};
const nn = (s: string): string | null => (s.trim() === "" ? null : s.trim());

function draftToBody(d: EntityDraft): Record<string, unknown> {
  return {
    legalNameEn: d.legalNameEn.trim(),
    legalNameAr: nn(d.legalNameAr),
    shortName: d.shortName.trim(),
    legalForm: d.legalForm.trim(),
    country: d.country.trim().toUpperCase(),
    jurisdiction: d.jurisdiction.trim(),
    status: d.status,
    incorporationDate: nn(d.incorporationDate),
    durationYears: num(d.durationYears),
    baseCurrency: d.baseCurrency.trim().toUpperCase(),
    registeredAddress: d.registeredAddress.trim(),
    governingLaw: d.governingLaw.trim(),
    courts: d.courts.trim(),
    registrations: d.registrations
      .filter((r) => r.label.trim() || r.number.trim())
      .map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        type: r.type || "other", label: r.label.trim(), number: r.number.trim(),
        issuer: nn(r.issuer), issuedOn: nn(r.issuedOn), expiresOn: nn(r.expiresOn),
        notes: null,
      })),
    activities: d.activities
      .filter((a) => a.nameEn.trim())
      .map((a) => ({ code: a.code.trim(), nameEn: a.nameEn.trim(), nameAr: nn(a.nameAr), status: null })),
    owners: d.owners
      .filter((o) => o.name.trim())
      .map((o) => ({
        name: o.name.trim(), nameAr: nn(o.nameAr),
        roles: o.roles.split(",").map((x) => x.trim()).filter(Boolean),
        sharePct: num(o.sharePct), nationality: nn(o.nationality),
        passportNo: nn(o.passportNo), personNo: nn(o.personNo), userId: null,
      })),
    premises: {
      addressLine: nn(d.premises.addressLine), building: nn(d.premises.building),
      unit: nn(d.premises.unit), area: nn(d.premises.area), city: nn(d.premises.city),
      plotNumber: nn(d.premises.plotNumber), makaniNo: nn(d.premises.makaniNo),
      sizeSqm: num(d.premises.sizeSqm), usage: nn(d.premises.usage),
    },
    lease: {
      contractNo: nn(d.lease.contractNo), ejariTenantNo: nn(d.lease.ejariTenantNo),
      lessorName: nn(d.lease.lessorName), lessorLicenseNo: nn(d.lease.lessorLicenseNo),
      ownerName: nn(d.lease.ownerName), startDate: nn(d.lease.startDate),
      endDate: nn(d.lease.endDate), annualRentAed: num(d.lease.annualRentAed),
      securityDepositAed: num(d.lease.securityDepositAed), areaSqm: num(d.lease.areaSqm),
      registrationFeesAed: num(d.lease.registrationFeesAed), notes: null,
    },
    notes: nn(d.notes),
  };
}

// Merge an AI extraction proposal into a draft (review-and-apply: the user
// still edits and saves the form; nothing is written until then).
function mergeProposalIntoDraft(base: EntityDraft, fields: Record<string, unknown>): EntityDraft {
  const d: EntityDraft = JSON.parse(JSON.stringify(base));
  const s = (k: string): string | null => {
    const v = fields[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  d.legalNameEn = s("legalNameEn") ?? d.legalNameEn;
  d.legalNameAr = s("legalNameAr") ?? d.legalNameAr;
  d.legalForm = s("legalForm") ?? d.legalForm;
  d.country = s("country") ?? d.country;
  d.jurisdiction = s("jurisdiction") ?? d.jurisdiction;
  d.incorporationDate = s("incorporationDate") ?? d.incorporationDate;
  if (typeof fields.durationYears === "number") d.durationYears = String(fields.durationYears);
  d.registeredAddress = s("registeredAddress") ?? d.registeredAddress;
  const regs = fields.registrations;
  if (Array.isArray(regs)) {
    for (const r of regs as Array<Record<string, unknown>>) {
      const numStr = typeof r.number === "string" ? r.number : "";
      if (!numStr) continue;
      const existing = d.registrations.find((x) => x.number === numStr);
      const patch: RegDraft = {
        ...(existing ?? { type: "other", label: "", number: "", issuer: "", issuedOn: "", expiresOn: "" }),
        type: typeof r.type === "string" && r.type ? r.type : (existing?.type ?? "other"),
        label: typeof r.label === "string" && r.label ? r.label : (existing?.label ?? ""),
        number: numStr,
        issuer: typeof r.issuer === "string" ? r.issuer : (existing?.issuer ?? ""),
        issuedOn: typeof r.issuedOn === "string" ? r.issuedOn : (existing?.issuedOn ?? ""),
        expiresOn: typeof r.expiresOn === "string" ? r.expiresOn : (existing?.expiresOn ?? ""),
      };
      if (existing) Object.assign(existing, patch);
      else d.registrations.push(patch);
    }
  }
  const acts = fields.activities;
  if (Array.isArray(acts) && acts.length > 0 && d.activities.length === 0) {
    d.activities = (acts as Array<Record<string, unknown>>)
      .filter((a) => typeof a.nameEn === "string" && a.nameEn)
      .map((a) => ({
        code: typeof a.code === "string" ? a.code : "",
        nameEn: a.nameEn as string,
        nameAr: typeof a.nameAr === "string" ? a.nameAr : "",
      }));
  }
  const owners = fields.owners;
  if (Array.isArray(owners) && owners.length > 0 && d.owners.length === 0) {
    d.owners = (owners as Array<Record<string, unknown>>)
      .filter((o) => typeof o.name === "string" && o.name)
      .map((o) => ({
        name: o.name as string,
        nameAr: typeof o.nameAr === "string" ? o.nameAr : "",
        roles: Array.isArray(o.roles) ? (o.roles as string[]).join(", ") : "",
        sharePct: typeof o.sharePct === "number" ? String(o.sharePct) : "",
        nationality: typeof o.nationality === "string" ? o.nationality : "",
        passportNo: typeof o.passportNo === "string" ? o.passportNo : "",
        personNo: typeof o.personNo === "string" ? o.personNo : "",
      }));
  }
  const prem = fields.premises as Record<string, unknown> | null | undefined;
  if (prem && typeof prem === "object") {
    for (const k of Object.keys(d.premises) as Array<keyof EntityDraft["premises"]>) {
      const v = prem[k];
      if (typeof v === "string" && v) d.premises[k] = v;
      if (typeof v === "number") d.premises[k] = String(v);
    }
  }
  const lease = fields.lease as Record<string, unknown> | null | undefined;
  if (lease && typeof lease === "object") {
    for (const k of Object.keys(d.lease) as Array<keyof EntityDraft["lease"]>) {
      const v = lease[k];
      if (typeof v === "string" && v) d.lease[k] = v;
      if (typeof v === "number") d.lease[k] = String(v);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Entity form dialog
// ---------------------------------------------------------------------------

const REG_TYPES = [
  ["trade_license", "Trade license"],
  ["commercial_register", "Commercial register"],
  ["chamber_membership", "Chamber membership"],
  ["establishment_card", "Establishment card"],
  ["initial_approval", "Initial approval"],
  ["moa_contract", "MoA contract"],
  ["tax", "Tax registration"],
  ["other", "Other"],
] as const;

function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={props.className}>
      <label className={labelCls}>{props.label}</label>
      {props.children}
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  testid?: string;
}) {
  return (
    <Field label={props.label} className={props.className}>
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="h-9"
        data-testid={props.testid}
      />
    </Field>
  );
}

function EntityFormDialog(props: {
  open: boolean;
  onClose: () => void;
  editing: LegalEntityRow | null;
  initialDraft: EntityDraft | null;
  extractionNote?: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<EntityDraft>(emptyDraft());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (props.open) {
      setDraft(props.initialDraft ?? (props.editing ? draftFromEntity(props.editing) : emptyDraft()));
      setError(null);
    }
  }, [props.open, props.editing, props.initialDraft]);

  const up = (patch: Partial<EntityDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    if (!draft.legalNameEn.trim()) { setError("Legal name (EN) is required."); return; }
    if (!/^[A-Za-z]{2}$/.test(draft.country.trim())) { setError("Country must be a 2-letter ISO code (e.g. AE)."); return; }
    setBusy(true);
    setError(null);
    try {
      const body = draftToBody(draft);
      if (props.editing) {
        await jsonReq("PATCH", `/finance/entities/${props.editing.id}`, body);
        toast({ title: "Entity updated" });
      } else {
        await jsonReq("POST", "/finance/entities", body);
        toast({ title: "Entity created" });
      }
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto" data-testid="dialog-entity-form">
        <DialogHeader>
          <DialogTitle>{props.editing ? "Edit legal entity" : "New legal entity"}</DialogTitle>
        </DialogHeader>
        {props.extractionNote && (
          <div className="rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-xs text-text" data-testid="note-extraction">
            <Sparkles className="w-3.5 h-3.5 inline mr-1.5 text-gold" />
            AI-extracted values pre-filled — review every field before saving. {props.extractionNote}
          </div>
        )}
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField label="Legal name (EN) *" value={draft.legalNameEn} onChange={(v) => up({ legalNameEn: v })} testid="input-entity-name-en" />
            <TextField label="Legal name (AR)" value={draft.legalNameAr} onChange={(v) => up({ legalNameAr: v })} testid="input-entity-name-ar" />
            <TextField label="Short name" value={draft.shortName} onChange={(v) => up({ shortName: v })} />
            <TextField label="Legal form" value={draft.legalForm} onChange={(v) => up({ legalForm: v })} placeholder="Limited Liability Company (LLC)" />
            <TextField label="Country (ISO-2) *" value={draft.country} onChange={(v) => up({ country: v })} placeholder="AE" testid="input-entity-country" />
            <TextField label="Jurisdiction" value={draft.jurisdiction} onChange={(v) => up({ jurisdiction: v })} placeholder="Dubai — Department of Economy & Tourism" />
            <Field label="Status">
              <select className={fieldCls} value={draft.status} onChange={(e) => up({ status: e.target.value })} data-testid="select-entity-status">
                <option value="active">Active</option>
                <option value="in_formation">In formation</option>
                <option value="dormant">Dormant</option>
                <option value="winding_down">Winding down</option>
              </select>
            </Field>
            <TextField label="Incorporated on (YYYY-MM-DD)" value={draft.incorporationDate} onChange={(v) => up({ incorporationDate: v })} />
            <TextField label="Duration (years)" value={draft.durationYears} onChange={(v) => up({ durationYears: v })} />
            <TextField label="Base currency" value={draft.baseCurrency} onChange={(v) => up({ baseCurrency: v })} placeholder="AED" />
            <TextField label="Registered address" value={draft.registeredAddress} onChange={(v) => up({ registeredAddress: v })} className="sm:col-span-2" />
            <TextField label="Governing law" value={draft.governingLaw} onChange={(v) => up({ governingLaw: v })} />
            <TextField label="Courts" value={draft.courts} onChange={(v) => up({ courts: v })} />
          </div>

          {/* Registrations */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={labelCls}>Registrations & licenses</span>
              <Button size="sm" variant="ghost" onClick={() => up({ registrations: [...draft.registrations, { type: "other", label: "", number: "", issuer: "", issuedOn: "", expiresOn: "" }] })} data-testid="button-add-registration">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {draft.registrations.map((r, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 rounded-md border border-border-soft p-2">
                  <select className={fieldCls} value={r.type} onChange={(e) => { const rs = [...draft.registrations]; rs[i] = { ...r, type: e.target.value }; up({ registrations: rs }); }}>
                    {REG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <Input className="h-9" placeholder="Label" value={r.label} onChange={(e) => { const rs = [...draft.registrations]; rs[i] = { ...r, label: e.target.value }; up({ registrations: rs }); }} />
                  <Input className="h-9" placeholder="Number" value={r.number} onChange={(e) => { const rs = [...draft.registrations]; rs[i] = { ...r, number: e.target.value }; up({ registrations: rs }); }} />
                  <Input className="h-9" placeholder="Issuer" value={r.issuer} onChange={(e) => { const rs = [...draft.registrations]; rs[i] = { ...r, issuer: e.target.value }; up({ registrations: rs }); }} />
                  <Input className="h-9" placeholder="Issued (YYYY-MM-DD)" value={r.issuedOn} onChange={(e) => { const rs = [...draft.registrations]; rs[i] = { ...r, issuedOn: e.target.value }; up({ registrations: rs }); }} />
                  <div className="flex gap-1">
                    <Input className="h-9" placeholder="Expires" value={r.expiresOn} onChange={(e) => { const rs = [...draft.registrations]; rs[i] = { ...r, expiresOn: e.target.value }; up({ registrations: rs }); }} />
                    <Button size="sm" variant="ghost" className="text-danger px-2" onClick={() => up({ registrations: draft.registrations.filter((_, j) => j !== i) })}>×</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activities */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={labelCls}>Licensed activities</span>
              <Button size="sm" variant="ghost" onClick={() => up({ activities: [...draft.activities, { code: "", nameEn: "", nameAr: "" }] })} data-testid="button-add-activity">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {draft.activities.map((a, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md border border-border-soft p-2">
                  <Input className="h-9" placeholder="Code" value={a.code} onChange={(e) => { const as_ = [...draft.activities]; as_[i] = { ...a, code: e.target.value }; up({ activities: as_ }); }} />
                  <Input className="h-9" placeholder="Name (EN)" value={a.nameEn} onChange={(e) => { const as_ = [...draft.activities]; as_[i] = { ...a, nameEn: e.target.value }; up({ activities: as_ }); }} />
                  <Input className="h-9" placeholder="Name (AR)" value={a.nameAr} onChange={(e) => { const as_ = [...draft.activities]; as_[i] = { ...a, nameAr: e.target.value }; up({ activities: as_ }); }} />
                  <Button size="sm" variant="ghost" className="text-danger justify-self-start" onClick={() => up({ activities: draft.activities.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              ))}
            </div>
          </div>

          {/* Owners */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={labelCls}>Owners & managers</span>
              <Button size="sm" variant="ghost" onClick={() => up({ owners: [...draft.owners, { name: "", nameAr: "", roles: "", sharePct: "", nationality: "", passportNo: "", personNo: "" }] })} data-testid="button-add-owner">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {draft.owners.map((o, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md border border-border-soft p-2">
                  <Input className="h-9" placeholder="Name" value={o.name} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, name: e.target.value }; up({ owners: os }); }} />
                  <Input className="h-9" placeholder="Roles (comma-sep)" value={o.roles} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, roles: e.target.value }; up({ owners: os }); }} />
                  <Input className="h-9" placeholder="Share %" value={o.sharePct} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, sharePct: e.target.value }; up({ owners: os }); }} />
                  <Input className="h-9" placeholder="Nationality" value={o.nationality} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, nationality: e.target.value }; up({ owners: os }); }} />
                  <Input className="h-9" placeholder="Passport no." value={o.passportNo} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, passportNo: e.target.value }; up({ owners: os }); }} />
                  <Input className="h-9" placeholder="Person no." value={o.personNo} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, personNo: e.target.value }; up({ owners: os }); }} />
                  <Input className="h-9" placeholder="Name (AR)" value={o.nameAr} onChange={(e) => { const os = [...draft.owners]; os[i] = { ...o, nameAr: e.target.value }; up({ owners: os }); }} />
                  <Button size="sm" variant="ghost" className="text-danger justify-self-start" onClick={() => up({ owners: draft.owners.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              ))}
            </div>
          </div>

          {/* Premises */}
          <div>
            <span className={labelCls}>Premises</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
              <Input className="h-9 col-span-2 sm:col-span-3" placeholder="Address line" value={draft.premises.addressLine} onChange={(e) => up({ premises: { ...draft.premises, addressLine: e.target.value } })} />
              <Input className="h-9" placeholder="Building" value={draft.premises.building} onChange={(e) => up({ premises: { ...draft.premises, building: e.target.value } })} />
              <Input className="h-9" placeholder="Unit" value={draft.premises.unit} onChange={(e) => up({ premises: { ...draft.premises, unit: e.target.value } })} />
              <Input className="h-9" placeholder="Area / district" value={draft.premises.area} onChange={(e) => up({ premises: { ...draft.premises, area: e.target.value } })} />
              <Input className="h-9" placeholder="City" value={draft.premises.city} onChange={(e) => up({ premises: { ...draft.premises, city: e.target.value } })} />
              <Input className="h-9" placeholder="Plot no." value={draft.premises.plotNumber} onChange={(e) => up({ premises: { ...draft.premises, plotNumber: e.target.value } })} />
              <Input className="h-9" placeholder="Makani no." value={draft.premises.makaniNo} onChange={(e) => up({ premises: { ...draft.premises, makaniNo: e.target.value } })} />
              <Input className="h-9" placeholder="Size (sqm)" value={draft.premises.sizeSqm} onChange={(e) => up({ premises: { ...draft.premises, sizeSqm: e.target.value } })} />
              <Input className="h-9" placeholder="Usage" value={draft.premises.usage} onChange={(e) => up({ premises: { ...draft.premises, usage: e.target.value } })} />
            </div>
          </div>

          {/* Lease */}
          <div>
            <span className={labelCls}>Lease (Ejari)</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
              <Input className="h-9" placeholder="Contract no." value={draft.lease.contractNo} onChange={(e) => up({ lease: { ...draft.lease, contractNo: e.target.value } })} />
              <Input className="h-9" placeholder="Ejari tenant no." value={draft.lease.ejariTenantNo} onChange={(e) => up({ lease: { ...draft.lease, ejariTenantNo: e.target.value } })} />
              <Input className="h-9" placeholder="Lessor" value={draft.lease.lessorName} onChange={(e) => up({ lease: { ...draft.lease, lessorName: e.target.value } })} />
              <Input className="h-9" placeholder="Lessor license no." value={draft.lease.lessorLicenseNo} onChange={(e) => up({ lease: { ...draft.lease, lessorLicenseNo: e.target.value } })} />
              <Input className="h-9" placeholder="Owner" value={draft.lease.ownerName} onChange={(e) => up({ lease: { ...draft.lease, ownerName: e.target.value } })} />
              <Input className="h-9" placeholder="Start (YYYY-MM-DD)" value={draft.lease.startDate} onChange={(e) => up({ lease: { ...draft.lease, startDate: e.target.value } })} />
              <Input className="h-9" placeholder="End (YYYY-MM-DD)" value={draft.lease.endDate} onChange={(e) => up({ lease: { ...draft.lease, endDate: e.target.value } })} />
              <Input className="h-9" placeholder="Annual rent (AED)" value={draft.lease.annualRentAed} onChange={(e) => up({ lease: { ...draft.lease, annualRentAed: e.target.value } })} />
              <Input className="h-9" placeholder="Deposit (AED)" value={draft.lease.securityDepositAed} onChange={(e) => up({ lease: { ...draft.lease, securityDepositAed: e.target.value } })} />
              <Input className="h-9" placeholder="Area (sqm)" value={draft.lease.areaSqm} onChange={(e) => up({ lease: { ...draft.lease, areaSqm: e.target.value } })} />
              <Input className="h-9" placeholder="Reg. fees (AED)" value={draft.lease.registrationFeesAed} onChange={(e) => up({ lease: { ...draft.lease, registrationFeesAed: e.target.value } })} />
            </div>
          </div>

          <TextField label="Notes" value={draft.notes} onChange={(v) => up({ notes: v })} />

          {error && <p className="text-sm text-danger" data-testid="text-entity-form-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy} data-testid="button-save-entity">
              {busy ? "Saving…" : props.editing ? "Save changes" : "Create entity"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AI extraction dialog — pick a corporate/legal document, run extraction,
// review the proposal, then apply into the entity form.
// ---------------------------------------------------------------------------

function ExtractDialog(props: {
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

function fmtAed(n: number | null | undefined): string | null {
  return typeof n === "number" ? `AED ${n.toLocaleString()}` : null;
}

function EntityCard(props: {
  entity: LegalEntityRow;
  canWrite: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const e = props.entity;
  const { documents } = useLegalEntityDetail(e.id);
  return (
    <Card className="p-5 space-y-4" data-testid={`entity-card-${e.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{countryLabel(e.country)} · {e.legalForm || "—"}</Eyebrow>
          <h3 className="text-lg text-text mt-0.5" data-testid={`text-entity-name-${e.id}`}>{e.legalNameEn}</h3>
          {e.legalNameAr && <p className="text-sm text-text-mute" dir="rtl">{e.legalNameAr}</p>}
          <p className="text-xs text-text-faint mt-0.5">
            {e.jurisdiction}{e.incorporationDate ? ` · incorporated ${e.incorporationDate}` : ""}
            {e.durationYears ? ` · ${e.durationYears}-year term` : ""}
            {e.baseCurrency ? ` · ${e.baseCurrency}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonoChip tone={e.status === "active" ? "green" : e.status === "archived" ? "red" : "amber"}>
            {STATUS_LABEL[e.status]}
          </MonoChip>
          {props.canWrite && e.status !== "archived" && (
            <>
              <Button size="sm" variant="outline" onClick={props.onEdit} data-testid={`button-edit-${e.id}`}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={props.onArchive} data-testid={`button-archive-${e.id}`}>
                <Archive className="w-3.5 h-3.5 mr-1" /> Archive
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Registrations */}
      {e.registrations.length > 0 && (
        <div>
          <SectionHead headline="Registrations & licenses" />
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            {e.registrations.map((r) => (
              <div key={r.id} className="rounded-md border border-border-soft p-2.5" data-testid={`reg-${r.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-text truncate">{r.label}</span>
                  {r.expiresOn && (
                    <MonoChip tone={expiryTone(r.expiresOn)}>{expiryText(r.expiresOn)}</MonoChip>
                  )}
                </div>
                <div className="text-xs text-text-mute font-mono mt-0.5">{r.number}</div>
                <div className="text-[11px] text-text-faint mt-0.5">
                  {r.issuer ?? ""}{r.issuedOn ? ` · issued ${r.issuedOn}` : ""}{r.expiresOn ? ` · expires ${r.expiresOn}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activities */}
      {e.activities.length > 0 && (
        <div>
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
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Owners */}
        {e.owners.length > 0 && (
          <div>
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
          </div>
        )}

        {/* Premises & lease */}
        {(e.premises || e.lease) && (
          <div>
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
          </div>
        )}
      </div>

      {/* Linked documents */}
      {documents.length > 0 && (
        <div>
          <SectionHead headline="Linked documents" />
          <ul className="mt-2 space-y-1">
            {documents.map((d) => (
              <li key={d.id} className="text-sm flex items-center gap-2" data-testid={`linked-doc-${d.id}`}>
                <FileText className="w-3.5 h-3.5 text-text-mute shrink-0" />
                <a className="text-text hover:text-gold truncate" href={`/documents?open=${d.id}`}>{d.title}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.notes && <p className="text-xs text-text-faint italic">{e.notes}</p>}
    </Card>
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
    <div className="space-y-6">
      <PageHero>
        <Eyebrow>Finance · Entities</Eyebrow>
        <h1 className="text-2xl text-text mt-1">Legal-entity registry</h1>
        <p className="text-sm text-text-mute mt-2 max-w-2xl">
          The firm's own legal entities, digitized from official registrations — licenses,
          activities, ownership, premises and linked corporate documents.
        </p>
      </PageHero>

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

      <div className="space-y-4">
        {visible.map((e) => (
          <EntityCard
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
  );
}
