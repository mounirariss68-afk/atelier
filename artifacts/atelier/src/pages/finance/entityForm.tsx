/**
 * Legal-entity form — sectioned redesign of the create/edit dialog (Task #681).
 *
 * UI-only redesign: the draft model, the API body produced on save, and all
 * existing data-testid hooks are unchanged from the original single-scroll
 * form in FinanceEntities.tsx. Sections render as an accordion with Identity
 * open by default; dates use native date pickers, country is a searchable
 * ISO-2 select, currency is a datalist of common codes with free entry, and
 * validation runs inline per field plus an aggregated summary on save.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { type LegalEntityRow } from "@/lib/v5-hooks";
import { Sparkles, Plus, Trash2, Check, ChevronsUpDown } from "lucide-react";

const API_BASE = "/api/atelier";

export async function jsonReq<T>(method: string, path: string, body?: unknown): Promise<T> {
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
// ISO-3166 country labels — no hardcoded registry countries; the list filter
// on the page is derived from whatever countries exist in the data and
// labelled here. The form's country select offers this list plus a free
// ISO-2 code fallback for anything not listed.
// ---------------------------------------------------------------------------

export const ISO_COUNTRY: Record<string, string> = {
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

export function countryLabel(code: string): string {
  return ISO_COUNTRY[code?.toUpperCase()] ?? code?.toUpperCase() ?? "—";
}

const COMMON_CURRENCIES = [
  "AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR",
  "TRY", "CHF", "JPY", "CNY", "INR", "SGD", "HKD", "AUD", "CAD",
];

// ---------------------------------------------------------------------------
// Form state — flat strings, converted to the API body on submit
// ---------------------------------------------------------------------------

export interface RegDraft {
  id?: string;
  type: string;
  label: string;
  number: string;
  issuer: string;
  issuedOn: string;
  expiresOn: string;
}
export interface ActDraft { code: string; nameEn: string; nameAr: string }
export interface OwnerDraft {
  name: string;
  nameAr: string;
  roles: string;
  sharePct: string;
  nationality: string;
  passportNo: string;
  personNo: string;
}

export interface EntityDraft {
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
  fiscal: {
    vatPeriod: string; nextVatFilingDate: string; vatExpectedAmount: string;
    nextCtFilingDate: string; ctExpectedAmount: string;
    ctTaxYearBasis: string; ctFirstPeriodStart: string; ctFirstPeriodEnd: string;
  };
  cashPolicy: {
    openingBalance: string; openingBalanceAsOf: string;
    minCashPolicy: string; covenantFloor: string; notes: string;
  };
  /** Task #1092 — pre-formation ownership structure (drives the
   * recommended settlement treatment for the cost pool). */
  formation: {
    ownershipType: string; // "" | cognirise_uae | jv | founder_partner | franchise
    jvSplits: Array<{ partnerName: string; sharePct: string }>;
    notes: string;
  };
  /**
   * Task #1165 — WPS (UAE Wage Protection System) employer config.
   * Flat strings; converted to statutory.wps on save.
   */
  statutory: {
    /** "" | "true" | "false" */
    wpsApplicable: string;
    /** 13-digit MOHRE Employer Unique ID */
    wpsEmployerUniqueId: string;
    /** 9-digit agent-bank routing code */
    wpsAgentBankRoutingCode: string;
  };
  /**
   * Pass-through: the non-WPS statutory fields from the existing entity.
   * Never shown in the UI — carried through untouched so that saving the
   * entity form never wipes freeZoneRegime, optOut, override maps, etc.
   */
  _statutoryBase: {
    freeZoneRegime?: string | null;
    optOut?: string[] | null;
    employerPctOverride?: Record<string, number> | null;
    employeePctOverride?: Record<string, number> | null;
    ceilingOverride?: Record<string, number> | null;
    eosbCapPerYearOverride?: number | null;
    notes?: string | null;
  } | null;
  notes: string;
}

export function emptyDraft(): EntityDraft {
  return {
    legalNameEn: "", legalNameAr: "", shortName: "", legalForm: "", country: "",
    jurisdiction: "", status: "active", incorporationDate: "", durationYears: "",
    baseCurrency: "", registeredAddress: "", governingLaw: "", courts: "",
    registrations: [], activities: [], owners: [],
    premises: { addressLine: "", building: "", unit: "", area: "", city: "", plotNumber: "", makaniNo: "", sizeSqm: "", usage: "" },
    lease: { contractNo: "", ejariTenantNo: "", lessorName: "", lessorLicenseNo: "", ownerName: "", startDate: "", endDate: "", annualRentAed: "", securityDepositAed: "", areaSqm: "", registrationFeesAed: "" },
    fiscal: { vatPeriod: "", nextVatFilingDate: "", vatExpectedAmount: "", nextCtFilingDate: "", ctExpectedAmount: "", ctTaxYearBasis: "", ctFirstPeriodStart: "", ctFirstPeriodEnd: "" },
    cashPolicy: { openingBalance: "", openingBalanceAsOf: "", minCashPolicy: "", covenantFloor: "", notes: "" },
    formation: { ownershipType: "", jvSplits: [], notes: "" },
    statutory: { wpsApplicable: "", wpsEmployerUniqueId: "", wpsAgentBankRoutingCode: "" },
    _statutoryBase: null,
    notes: "",
  };
}

export function draftFromEntity(e: LegalEntityRow): EntityDraft {
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
    fiscal: {
      vatPeriod: e.fiscal?.vatPeriod ?? "",
      nextVatFilingDate: e.fiscal?.nextVatFilingDate ?? "",
      vatExpectedAmount: e.fiscal?.vatExpectedAmount?.toString() ?? "",
      nextCtFilingDate: e.fiscal?.nextCtFilingDate ?? "",
      ctExpectedAmount: e.fiscal?.ctExpectedAmount?.toString() ?? "",
      ctTaxYearBasis: e.fiscal?.ctTaxYearBasis ?? "",
      ctFirstPeriodStart: e.fiscal?.ctFirstPeriodStart ?? "",
      ctFirstPeriodEnd: e.fiscal?.ctFirstPeriodEnd ?? "",
    },
    cashPolicy: {
      openingBalance: e.cashPolicy?.openingBalance?.toString() ?? "",
      openingBalanceAsOf: e.cashPolicy?.openingBalanceAsOf ?? "",
      minCashPolicy: e.cashPolicy?.minCashPolicy?.toString() ?? "",
      covenantFloor: e.cashPolicy?.covenantFloor?.toString() ?? "",
      notes: e.cashPolicy?.notes ?? "",
    },
    formation: {
      ownershipType: e.formation?.ownershipType ?? "",
      jvSplits: (e.formation?.jvSplits ?? []).map((s) => ({
        partnerName: s.partnerName, sharePct: s.sharePct?.toString() ?? "",
      })),
      notes: e.formation?.notes ?? "",
    },
    statutory: {
      wpsApplicable:
        e.statutory?.wps?.applicable === true ? "true"
        : e.statutory?.wps?.applicable === false ? "false"
        : "",
      wpsEmployerUniqueId: e.statutory?.wps?.employerUniqueId ?? "",
      wpsAgentBankRoutingCode: e.statutory?.wps?.agentBankRoutingCode ?? "",
    },
    // Carry the non-WPS fields through untouched so saving the form never
    // clobbers freeZoneRegime, optOut, contribution-rate overrides, etc.
    _statutoryBase: e.statutory
      ? {
          freeZoneRegime: e.statutory.freeZoneRegime ?? null,
          optOut: (e.statutory.optOut && e.statutory.optOut.length > 0) ? e.statutory.optOut : null,
          employerPctOverride: e.statutory.employerPctOverride ?? null,
          employeePctOverride: e.statutory.employeePctOverride ?? null,
          ceilingOverride: e.statutory.ceilingOverride ?? null,
          eosbCapPerYearOverride: e.statutory.eosbCapPerYearOverride ?? null,
          notes: e.statutory.notes ?? null,
        }
      : null,
    notes: e.notes ?? "",
  };
}

const num = (s: string): number | null => {
  const v = Number(s.replace(/,/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};
const nn = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export function draftToBody(d: EntityDraft): Record<string, unknown> {
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
    fiscal: {
      vatPeriod: d.fiscal.vatPeriod === "monthly" || d.fiscal.vatPeriod === "quarterly" ? d.fiscal.vatPeriod : null,
      nextVatFilingDate: nn(d.fiscal.nextVatFilingDate),
      vatExpectedAmount: num(d.fiscal.vatExpectedAmount),
      nextCtFilingDate: nn(d.fiscal.nextCtFilingDate),
      ctExpectedAmount: num(d.fiscal.ctExpectedAmount),
      ctTaxYearBasis: nn(d.fiscal.ctTaxYearBasis),
      ctFirstPeriodStart: nn(d.fiscal.ctFirstPeriodStart),
      ctFirstPeriodEnd: nn(d.fiscal.ctFirstPeriodEnd),
    },
    cashPolicy: {
      openingBalance: num(d.cashPolicy.openingBalance),
      openingBalanceAsOf: nn(d.cashPolicy.openingBalanceAsOf),
      minCashPolicy: num(d.cashPolicy.minCashPolicy),
      covenantFloor: num(d.cashPolicy.covenantFloor),
      notes: nn(d.cashPolicy.notes),
    },
    formation: d.formation.ownershipType || d.formation.jvSplits.length || d.formation.notes.trim()
      ? {
          ownershipType: nn(d.formation.ownershipType),
          jvSplits: d.formation.jvSplits
            .filter((s) => s.partnerName.trim())
            .map((s) => ({ partnerName: s.partnerName.trim(), sharePct: num(s.sharePct) ?? 0 })),
          notes: nn(d.formation.notes),
        }
      : null,
    statutory: (() => {
      const uid = nn(d.statutory.wpsEmployerUniqueId);
      const rc = nn(d.statutory.wpsAgentBankRoutingCode);
      const applicable =
        d.statutory.wpsApplicable === "true" ? true
        : d.statutory.wpsApplicable === "false" ? false
        : null;
      const hasWps = applicable !== null || !!uid || !!rc;
      const wps = hasWps
        ? { applicable, employerUniqueId: uid, agentBankRoutingCode: rc }
        : null;
      // Merge WPS onto the existing base so freeZoneRegime, optOut, override
      // maps and EOSB cap are never silently wiped by an edit via this form.
      const base = d._statutoryBase;
      const hasBase = !!base && Object.values(base).some((v) => v !== null && v !== undefined);
      if (!hasWps && !hasBase) return null;
      return { ...(base ?? {}), wps };
    })(),
    notes: nn(d.notes),
  };
}

// Merge an AI extraction proposal into a draft (review-and-apply: the user
// still edits and saves the form; nothing is written until then).
export function mergeProposalIntoDraft(base: EntityDraft, fields: Record<string, unknown>): EntityDraft {
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
// Inline validation — pure, keyed by dotted field path
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`).getTime();
  return Number.isFinite(t);
}
function isNumericStr(s: string): boolean {
  return Number.isFinite(Number(s.replace(/,/g, "")));
}

export function validateDraft(d: EntityDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  const date = (key: string, v: string, label: string) => {
    if (v.trim() && !isValidDate(v.trim())) errs[key] = `${label} must be a valid date (YYYY-MM-DD).`;
  };
  const numeric = (key: string, v: string, label: string) => {
    if (v.trim() && !isNumericStr(v.trim())) errs[key] = `${label} must be a number.`;
  };
  if (!d.legalNameEn.trim()) errs.legalNameEn = "Legal name (English) is required.";
  if (!/^[A-Za-z]{2}$/.test(d.country.trim())) errs.country = "Choose a country (stored as a 2-letter ISO code, e.g. AE).";
  date("incorporationDate", d.incorporationDate, "Incorporation date");
  numeric("durationYears", d.durationYears, "Duration");
  if (d.baseCurrency.trim() && !/^[A-Za-z]{3}$/.test(d.baseCurrency.trim())) {
    errs.baseCurrency = "Currency must be a 3-letter code (e.g. AED).";
  }
  d.registrations.forEach((r, i) => {
    date(`registrations.${i}.issuedOn`, r.issuedOn, "Issued date");
    date(`registrations.${i}.expiresOn`, r.expiresOn, "Expiry date");
  });
  d.owners.forEach((o, i) => {
    if (o.sharePct.trim()) {
      if (!isNumericStr(o.sharePct.trim())) errs[`owners.${i}.sharePct`] = "Share must be a number.";
      else {
        const v = Number(o.sharePct.replace(/,/g, ""));
        if (v < 0 || v > 100) errs[`owners.${i}.sharePct`] = "Share must be between 0 and 100.";
      }
    }
  });
  numeric("premises.sizeSqm", d.premises.sizeSqm, "Size");
  date("lease.startDate", d.lease.startDate, "Lease start");
  date("lease.endDate", d.lease.endDate, "Lease end");
  numeric("lease.annualRentAed", d.lease.annualRentAed, "Annual rent");
  numeric("lease.securityDepositAed", d.lease.securityDepositAed, "Deposit");
  numeric("lease.areaSqm", d.lease.areaSqm, "Area");
  numeric("lease.registrationFeesAed", d.lease.registrationFeesAed, "Registration fees");
  date("fiscal.nextVatFilingDate", d.fiscal.nextVatFilingDate, "Next VAT filing");
  numeric("fiscal.vatExpectedAmount", d.fiscal.vatExpectedAmount, "Expected VAT amount");
  date("fiscal.nextCtFilingDate", d.fiscal.nextCtFilingDate, "Next CT filing");
  numeric("fiscal.ctExpectedAmount", d.fiscal.ctExpectedAmount, "Expected CT amount");
  date("fiscal.ctFirstPeriodStart", d.fiscal.ctFirstPeriodStart, "First CT period start");
  date("fiscal.ctFirstPeriodEnd", d.fiscal.ctFirstPeriodEnd, "First CT period end");
  numeric("cashPolicy.openingBalance", d.cashPolicy.openingBalance, "Opening balance");
  date("cashPolicy.openingBalanceAsOf", d.cashPolicy.openingBalanceAsOf, "As-of date");
  numeric("cashPolicy.minCashPolicy", d.cashPolicy.minCashPolicy, "Minimum cash");
  numeric("cashPolicy.covenantFloor", d.cashPolicy.covenantFloor, "Covenant floor");
  d.formation.jvSplits.forEach((s, i) => {
    if (s.sharePct.trim()) {
      if (!isNumericStr(s.sharePct.trim())) errs[`formation.jvSplits.${i}.sharePct`] = "Share must be a number.";
      else {
        const v = Number(s.sharePct.replace(/,/g, ""));
        if (v < 0 || v > 100) errs[`formation.jvSplits.${i}.sharePct`] = "Share must be between 0 and 100.";
      }
    }
  });
  if (d.formation.ownershipType === "jv") {
    const splits = d.formation.jvSplits.filter((s) => s.partnerName.trim());
    const sum = splits.reduce((t, s) => t + (Number(s.sharePct.replace(/,/g, "")) || 0), 0);
    if (splits.length === 0) errs["formation.jvSplits"] = "A JV needs at least one partner split.";
    else if (Math.abs(sum - 100) > 0.01) errs["formation.jvSplits"] = `JV splits must sum to 100% (currently ${sum}%).`;
  }
  // Task #1165 — WPS field format validation.
  const uid = d.statutory.wpsEmployerUniqueId.trim();
  if (uid && !/^\d{13}$/.test(uid)) errs["statutory.wps.employerUniqueId"] = "Must be exactly 13 digits (MOHRE Employer Unique ID).";
  const rc = d.statutory.wpsAgentBankRoutingCode.trim();
  if (rc && !/^\d{9}$/.test(rc)) errs["statutory.wps.agentBankRoutingCode"] = "Must be exactly 9 digits (agent-bank routing code).";
  return errs;
}

type SectionId =
  | "identity" | "registrations" | "activities" | "owners"
  | "premises" | "fiscal" | "cash" | "formation" | "statutory" | "notes";

function sectionForKey(key: string): SectionId {
  if (key.startsWith("formation.")) return "formation";
  if (key.startsWith("registrations.")) return "registrations";
  if (key.startsWith("owners.")) return "owners";
  if (key.startsWith("premises.") || key.startsWith("lease.")) return "premises";
  if (key.startsWith("fiscal.")) return "fiscal";
  if (key.startsWith("cashPolicy.")) return "cash";
  if (key.startsWith("statutory.")) return "statutory";
  if (key === "notes") return "notes";
  return "identity";
}

// ---------------------------------------------------------------------------
// Field primitives — visible sentence-case labels, inline errors
// ---------------------------------------------------------------------------

const inputCls =
  "h-9 w-full rounded-md border border-border glass-surface px-2 text-sm text-text outline-none focus-visible:border-gold";
const errInputCls = "border-danger focus-visible:border-danger";

function FieldShell(props: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={props.className}>
      <label className="block text-xs font-medium text-text-mute mb-1">
        {props.label}
        {props.required && <span className="text-gold ml-0.5">*</span>}
      </label>
      {props.children}
      {props.error && <p className="text-[11px] text-danger mt-1">{props.error}</p>}
    </div>
  );
}

interface FieldCtx {
  errFor: (key: string) => string | undefined;
  touch: (key: string) => void;
}

function VText(props: {
  ctx: FieldCtx;
  fieldKey: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  testid?: string;
  type?: string;
  inputMode?: "decimal";
  dir?: "rtl";
}) {
  const error = props.ctx.errFor(props.fieldKey);
  return (
    <FieldShell label={props.label} required={props.required} error={error} className={props.className}>
      <Input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={() => props.ctx.touch(props.fieldKey)}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        dir={props.dir}
        className={`h-9 ${error ? errInputCls : ""}`}
        data-testid={props.testid}
      />
    </FieldShell>
  );
}

function VDate(props: {
  ctx: FieldCtx;
  fieldKey: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  testid?: string;
}) {
  const error = props.ctx.errFor(props.fieldKey);
  return (
    <FieldShell label={props.label} error={error} className={props.className}>
      <Input
        type="date"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={() => props.ctx.touch(props.fieldKey)}
        className={`h-9 ${error ? errInputCls : ""} [color-scheme:dark]`}
        data-testid={props.testid}
      />
    </FieldShell>
  );
}

function CountrySelect(props: {
  ctx: FieldCtx;
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const error = props.ctx.errFor("country");
  const code = props.value.trim().toUpperCase();
  const label = code ? countryLabel(code) : "";
  const freeCode = /^[A-Za-z]{2}$/.test(search.trim()) && !ISO_COUNTRY[search.trim().toUpperCase()]
    ? search.trim().toUpperCase()
    : null;
  return (
    <FieldShell label="Country" required error={error}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) { setSearch(""); props.ctx.touch("country"); }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className={`${inputCls} flex items-center justify-between text-left ${error ? errInputCls : ""} ${code ? "" : "text-text-faint"}`}
            data-testid="input-entity-country"
          >
            <span className="truncate">{code ? `${label} (${code})` : "Select a country…"}</span>
            <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0 ml-1" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-64" align="start">
          <Command>
            <CommandInput placeholder="Search country or type an ISO-2 code…" value={search} onValueChange={setSearch} />
            <CommandList className="max-h-56">
              <CommandEmpty>No match — type a 2-letter ISO code to use it directly.</CommandEmpty>
              <CommandGroup>
                {freeCode && (
                  <CommandItem
                    value={`use-code ${freeCode}`}
                    onSelect={() => { props.onChange(freeCode); setOpen(false); setSearch(""); }}
                  >
                    Use code "{freeCode}"
                  </CommandItem>
                )}
                {Object.entries(ISO_COUNTRY)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([c, name]) => (
                    <CommandItem
                      key={c}
                      value={`${name} ${c}`}
                      onSelect={() => { props.onChange(c); setOpen(false); setSearch(""); }}
                    >
                      <Check className={`w-3.5 h-3.5 mr-1.5 ${c === code ? "opacity-100" : "opacity-0"}`} />
                      {name} <span className="ml-1 text-text-faint font-mono text-xs">{c}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Repeating-row card helpers
// ---------------------------------------------------------------------------

function RowCard(props: {
  title: string;
  onRemove: () => void;
  removeConfirm: string | null;
  removeTestid?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-soft bg-bg-elevate/40 p-3">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-medium text-text">{props.title}</span>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger h-7 px-2"
          data-testid={props.removeTestid}
          onClick={() => {
            if (props.removeConfirm && !window.confirm(props.removeConfirm)) return;
            props.onRemove();
          }}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
        </Button>
      </div>
      {props.children}
    </div>
  );
}

function AddRowButton(props: { onClick: () => void; testid: string; label: string }) {
  return (
    <Button size="sm" variant="outline" onClick={props.onClick} data-testid={props.testid}>
      <Plus className="w-3.5 h-3.5 mr-1" /> {props.label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Entity form dialog
// ---------------------------------------------------------------------------

export const REG_TYPES = [
  ["trade_license", "Trade license"],
  ["commercial_register", "Commercial register"],
  ["chamber_membership", "Chamber membership"],
  ["establishment_card", "Establishment card"],
  ["initial_approval", "Initial approval"],
  ["moa_contract", "MoA contract"],
  ["tax_registration_ct", "Corporate Tax registration"],
  ["tax_registration_vat", "VAT registration"],
  ["tax", "Tax registration"],
  ["other", "Other"],
] as const;

const SECTION_TITLES: Record<SectionId, string> = {
  identity: "Identity",
  registrations: "Registrations & licenses",
  activities: "Licensed activities",
  owners: "Owners & managers",
  premises: "Premises & lease",
  fiscal: "Fiscal calendar",
  cash: "Cash policy",
  formation: "Pre-formation ownership",
  statutory: "WPS / Statutory payroll",
  notes: "Notes",
};

export function EntityFormDialog(props: {
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
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [openSections, setOpenSections] = React.useState<string[]>(["identity"]);

  React.useEffect(() => {
    if (props.open) {
      setDraft(props.initialDraft ?? (props.editing ? draftFromEntity(props.editing) : emptyDraft()));
      setError(null);
      setTouched({});
      setSubmitted(false);
      setOpenSections(["identity"]);
    }
  }, [props.open, props.editing, props.initialDraft]);

  const up = (patch: Partial<EntityDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const errors = React.useMemo(() => validateDraft(draft), [draft]);
  const ctx: FieldCtx = React.useMemo(
    () => ({
      errFor: (key) => (submitted || touched[key] ? errors[key] : undefined),
      touch: (key) => setTouched((t) => (t[key] ? t : { ...t, [key]: true })),
    }),
    [errors, submitted, touched],
  );

  // Visible (already-triggered) error count per section, for header badges.
  const sectionErrCount = React.useMemo(() => {
    const counts: Partial<Record<SectionId, number>> = {};
    for (const key of Object.keys(errors)) {
      if (!(submitted || touched[key])) continue;
      const s = sectionForKey(key);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [errors, submitted, touched]);

  async function save() {
    setSubmitted(true);
    const errs = validateDraft(draft);
    const keys = Object.keys(errs);
    if (keys.length > 0) {
      const sections = Array.from(new Set(keys.map(sectionForKey)));
      setOpenSections((prev) => Array.from(new Set([...prev, ...sections])));
      setError(
        `Please fix ${keys.length === 1 ? "1 field" : `${keys.length} fields`} before saving — see ${sections.map((s) => SECTION_TITLES[s]).join(", ")}.`,
      );
      return;
    }
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

  const regRows = (rs: RegDraft[]) => up({ registrations: rs });
  const actRows = (as_: ActDraft[]) => up({ activities: as_ });
  const ownerRows = (os: OwnerDraft[]) => up({ owners: os });

  const sectionHeader = (id: SectionId, summary?: string) => (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm font-medium text-text">{SECTION_TITLES[id]}</span>
      {summary && <span className="text-xs text-text-faint truncate">{summary}</span>}
      {(sectionErrCount[id] ?? 0) > 0 && (
        <span className="text-[10px] font-mono text-danger border border-danger/40 rounded-full px-1.5 py-0.5">
          {sectionErrCount[id]} to fix
        </span>
      )}
    </div>
  );

  const regSummary =
    draft.registrations.length > 0
      ? `${draft.registrations.length} registration${draft.registrations.length === 1 ? "" : "s"}`
      : "None yet";
  const actSummary =
    draft.activities.length > 0
      ? `${draft.activities.length} activit${draft.activities.length === 1 ? "y" : "ies"}`
      : "None yet";
  const ownerSummary =
    draft.owners.length > 0
      ? `${draft.owners.length} owner${draft.owners.length === 1 ? "" : "s"} / manager${draft.owners.length === 1 ? "" : "s"}`
      : "None yet";
  const ccy = draft.baseCurrency.trim().toUpperCase() || "base currency";

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0" data-testid="dialog-entity-form">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border-soft">
          <DialogTitle>{props.editing ? "Edit legal entity" : "New legal entity"}</DialogTitle>
          {props.extractionNote && (
            <div className="rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-xs text-text mt-2" data-testid="note-extraction">
              <Sparkles className="w-3.5 h-3.5 inline mr-1.5 text-gold" />
              AI-extracted values pre-filled — review every field before saving. {props.extractionNote}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          <Accordion type="multiple" value={openSections} onValueChange={setOpenSections}>
            {/* Identity */}
            <AccordionItem value="identity">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("identity", draft.legalNameEn.trim() || undefined)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 pt-1">
                  <VText ctx={ctx} fieldKey="legalNameEn" label="Legal name (English)" required value={draft.legalNameEn} onChange={(v) => up({ legalNameEn: v })} testid="input-entity-name-en" />
                  <VText ctx={ctx} fieldKey="legalNameAr" label="Legal name (Arabic)" dir="rtl" value={draft.legalNameAr} onChange={(v) => up({ legalNameAr: v })} testid="input-entity-name-ar" />
                  <VText ctx={ctx} fieldKey="shortName" label="Short name" value={draft.shortName} onChange={(v) => up({ shortName: v })} />
                  <VText ctx={ctx} fieldKey="legalForm" label="Legal form" value={draft.legalForm} onChange={(v) => up({ legalForm: v })} placeholder="e.g. Limited Liability Company (LLC)" />
                  <CountrySelect ctx={ctx} value={draft.country} onChange={(code) => up({ country: code })} />
                  <VText ctx={ctx} fieldKey="jurisdiction" label="Jurisdiction" value={draft.jurisdiction} onChange={(v) => up({ jurisdiction: v })} placeholder="e.g. Dubai — Department of Economy & Tourism" />
                  <FieldShell label="Status">
                    <select className={inputCls} value={draft.status} onChange={(e) => up({ status: e.target.value })} data-testid="select-entity-status">
                      <option value="active">Active</option>
                      <option value="in_formation">In formation</option>
                      <option value="dormant">Dormant</option>
                      <option value="winding_down">Winding down</option>
                    </select>
                  </FieldShell>
                  <VDate ctx={ctx} fieldKey="incorporationDate" label="Incorporated on" value={draft.incorporationDate} onChange={(v) => up({ incorporationDate: v })} />
                  <VText ctx={ctx} fieldKey="durationYears" label="Duration (years)" inputMode="decimal" value={draft.durationYears} onChange={(v) => up({ durationYears: v })} />
                  <FieldShell label="Base currency" error={ctx.errFor("baseCurrency")}>
                    <Input
                      list="entity-currency-codes"
                      value={draft.baseCurrency}
                      onChange={(e) => up({ baseCurrency: e.target.value.toUpperCase() })}
                      onBlur={() => ctx.touch("baseCurrency")}
                      placeholder="Choose or type a 3-letter code"
                      className={`h-9 uppercase placeholder:normal-case ${ctx.errFor("baseCurrency") ? errInputCls : ""}`}
                    />
                    <datalist id="entity-currency-codes">
                      {COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </FieldShell>
                  <VText ctx={ctx} fieldKey="registeredAddress" label="Registered address" value={draft.registeredAddress} onChange={(v) => up({ registeredAddress: v })} className="sm:col-span-2" />
                  <VText ctx={ctx} fieldKey="governingLaw" label="Governing law" value={draft.governingLaw} onChange={(v) => up({ governingLaw: v })} />
                  <VText ctx={ctx} fieldKey="courts" label="Courts" value={draft.courts} onChange={(v) => up({ courts: v })} />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Registrations */}
            <AccordionItem value="registrations">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("registrations", regSummary)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="space-y-3 pt-1">
                  {draft.registrations.map((r, i) => {
                    const set = (patch: Partial<RegDraft>) => {
                      const rs = [...draft.registrations];
                      rs[i] = { ...r, ...patch };
                      regRows(rs);
                    };
                    const hasData = !!(r.label.trim() || r.number.trim() || r.issuer.trim() || r.issuedOn || r.expiresOn);
                    return (
                      <RowCard
                        key={i}
                        title={r.label.trim() || REG_TYPES.find(([v]) => v === r.type)?.[1] || `Registration ${i + 1}`}
                        removeConfirm={hasData ? "Remove this registration? Its details will be dropped when you save." : null}
                        onRemove={() => regRows(draft.registrations.filter((_, j) => j !== i))}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                          <FieldShell label="Type">
                            <select className={inputCls} value={r.type} onChange={(e) => set({ type: e.target.value })}>
                              {REG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </FieldShell>
                          <VText ctx={ctx} fieldKey={`registrations.${i}.label`} label="Label" value={r.label} onChange={(v) => set({ label: v })} />
                          <VText ctx={ctx} fieldKey={`registrations.${i}.number`} label="Number" value={r.number} onChange={(v) => set({ number: v })} />
                          <VText ctx={ctx} fieldKey={`registrations.${i}.issuer`} label="Issuer" value={r.issuer} onChange={(v) => set({ issuer: v })} />
                          <VDate ctx={ctx} fieldKey={`registrations.${i}.issuedOn`} label="Issued on" value={r.issuedOn} onChange={(v) => set({ issuedOn: v })} />
                          <VDate ctx={ctx} fieldKey={`registrations.${i}.expiresOn`} label="Expires on" value={r.expiresOn} onChange={(v) => set({ expiresOn: v })} />
                        </div>
                      </RowCard>
                    );
                  })}
                  {draft.registrations.length === 0 && (
                    <p className="text-xs text-text-faint">No registrations or licenses recorded yet.</p>
                  )}
                  <AddRowButton
                    label="Add registration"
                    testid="button-add-registration"
                    onClick={() => regRows([...draft.registrations, { type: "other", label: "", number: "", issuer: "", issuedOn: "", expiresOn: "" }])}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Activities */}
            <AccordionItem value="activities">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("activities", actSummary)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="space-y-3 pt-1">
                  {draft.activities.map((a, i) => {
                    const set = (patch: Partial<ActDraft>) => {
                      const as_ = [...draft.activities];
                      as_[i] = { ...a, ...patch };
                      actRows(as_);
                    };
                    const hasData = !!(a.code.trim() || a.nameEn.trim() || a.nameAr.trim());
                    return (
                      <RowCard
                        key={i}
                        title={a.nameEn.trim() || `Activity ${i + 1}`}
                        removeConfirm={hasData ? "Remove this activity? Its details will be dropped when you save." : null}
                        onRemove={() => actRows(draft.activities.filter((_, j) => j !== i))}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                          <VText ctx={ctx} fieldKey={`activities.${i}.code`} label="Activity code" value={a.code} onChange={(v) => set({ code: v })} />
                          <VText ctx={ctx} fieldKey={`activities.${i}.nameEn`} label="Name (English)" value={a.nameEn} onChange={(v) => set({ nameEn: v })} />
                          <VText ctx={ctx} fieldKey={`activities.${i}.nameAr`} label="Name (Arabic)" dir="rtl" value={a.nameAr} onChange={(v) => set({ nameAr: v })} />
                        </div>
                      </RowCard>
                    );
                  })}
                  {draft.activities.length === 0 && (
                    <p className="text-xs text-text-faint">No licensed activities recorded yet.</p>
                  )}
                  <AddRowButton
                    label="Add activity"
                    testid="button-add-activity"
                    onClick={() => actRows([...draft.activities, { code: "", nameEn: "", nameAr: "" }])}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Owners */}
            <AccordionItem value="owners">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("owners", ownerSummary)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="space-y-3 pt-1">
                  {draft.owners.map((o, i) => {
                    const set = (patch: Partial<OwnerDraft>) => {
                      const os = [...draft.owners];
                      os[i] = { ...o, ...patch };
                      ownerRows(os);
                    };
                    const hasData = !!(o.name.trim() || o.roles.trim() || o.sharePct.trim() || o.passportNo.trim());
                    return (
                      <RowCard
                        key={i}
                        title={o.name.trim() || `Owner / manager ${i + 1}`}
                        removeConfirm={hasData ? "Remove this owner / manager? Their details will be dropped when you save." : null}
                        onRemove={() => ownerRows(draft.owners.filter((_, j) => j !== i))}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                          <VText ctx={ctx} fieldKey={`owners.${i}.name`} label="Name" value={o.name} onChange={(v) => set({ name: v })} />
                          <VText ctx={ctx} fieldKey={`owners.${i}.nameAr`} label="Name (Arabic)" dir="rtl" value={o.nameAr} onChange={(v) => set({ nameAr: v })} />
                          <VText ctx={ctx} fieldKey={`owners.${i}.roles`} label="Roles (comma-separated)" placeholder="e.g. Owner, Manager" value={o.roles} onChange={(v) => set({ roles: v })} />
                          <VText ctx={ctx} fieldKey={`owners.${i}.sharePct`} label="Share (%)" inputMode="decimal" value={o.sharePct} onChange={(v) => set({ sharePct: v })} />
                          <VText ctx={ctx} fieldKey={`owners.${i}.nationality`} label="Nationality" value={o.nationality} onChange={(v) => set({ nationality: v })} />
                          <VText ctx={ctx} fieldKey={`owners.${i}.passportNo`} label="Passport number" value={o.passportNo} onChange={(v) => set({ passportNo: v })} />
                          <VText ctx={ctx} fieldKey={`owners.${i}.personNo`} label="Person number" value={o.personNo} onChange={(v) => set({ personNo: v })} />
                        </div>
                      </RowCard>
                    );
                  })}
                  {draft.owners.length === 0 && (
                    <p className="text-xs text-text-faint">No owners or managers recorded yet.</p>
                  )}
                  <AddRowButton
                    label="Add owner / manager"
                    testid="button-add-owner"
                    onClick={() => ownerRows([...draft.owners, { name: "", nameAr: "", roles: "", sharePct: "", nationality: "", passportNo: "", personNo: "" }])}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Premises & lease */}
            <AccordionItem value="premises">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("premises", draft.premises.addressLine.trim() || draft.lease.contractNo.trim() || undefined)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="space-y-4 pt-1">
                  <div>
                    <p className="text-xs font-medium text-text mb-2">Premises</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <VText ctx={ctx} fieldKey="premises.addressLine" label="Address line" value={draft.premises.addressLine} onChange={(v) => up({ premises: { ...draft.premises, addressLine: v } })} className="sm:col-span-3" />
                      <VText ctx={ctx} fieldKey="premises.building" label="Building" value={draft.premises.building} onChange={(v) => up({ premises: { ...draft.premises, building: v } })} />
                      <VText ctx={ctx} fieldKey="premises.unit" label="Unit" value={draft.premises.unit} onChange={(v) => up({ premises: { ...draft.premises, unit: v } })} />
                      <VText ctx={ctx} fieldKey="premises.area" label="Area / district" value={draft.premises.area} onChange={(v) => up({ premises: { ...draft.premises, area: v } })} />
                      <VText ctx={ctx} fieldKey="premises.city" label="City" value={draft.premises.city} onChange={(v) => up({ premises: { ...draft.premises, city: v } })} />
                      <VText ctx={ctx} fieldKey="premises.plotNumber" label="Plot number" value={draft.premises.plotNumber} onChange={(v) => up({ premises: { ...draft.premises, plotNumber: v } })} />
                      <VText ctx={ctx} fieldKey="premises.makaniNo" label="Makani number" value={draft.premises.makaniNo} onChange={(v) => up({ premises: { ...draft.premises, makaniNo: v } })} />
                      <VText ctx={ctx} fieldKey="premises.sizeSqm" label="Size (sqm)" inputMode="decimal" value={draft.premises.sizeSqm} onChange={(v) => up({ premises: { ...draft.premises, sizeSqm: v } })} />
                      <VText ctx={ctx} fieldKey="premises.usage" label="Usage" value={draft.premises.usage} onChange={(v) => up({ premises: { ...draft.premises, usage: v } })} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text mb-2">Lease (Ejari)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <VText ctx={ctx} fieldKey="lease.contractNo" label="Contract number" value={draft.lease.contractNo} onChange={(v) => up({ lease: { ...draft.lease, contractNo: v } })} />
                      <VText ctx={ctx} fieldKey="lease.ejariTenantNo" label="Ejari tenant number" value={draft.lease.ejariTenantNo} onChange={(v) => up({ lease: { ...draft.lease, ejariTenantNo: v } })} />
                      <VText ctx={ctx} fieldKey="lease.lessorName" label="Lessor" value={draft.lease.lessorName} onChange={(v) => up({ lease: { ...draft.lease, lessorName: v } })} />
                      <VText ctx={ctx} fieldKey="lease.lessorLicenseNo" label="Lessor license number" value={draft.lease.lessorLicenseNo} onChange={(v) => up({ lease: { ...draft.lease, lessorLicenseNo: v } })} />
                      <VText ctx={ctx} fieldKey="lease.ownerName" label="Owner" value={draft.lease.ownerName} onChange={(v) => up({ lease: { ...draft.lease, ownerName: v } })} />
                      <VDate ctx={ctx} fieldKey="lease.startDate" label="Lease start" value={draft.lease.startDate} onChange={(v) => up({ lease: { ...draft.lease, startDate: v } })} />
                      <VDate ctx={ctx} fieldKey="lease.endDate" label="Lease end" value={draft.lease.endDate} onChange={(v) => up({ lease: { ...draft.lease, endDate: v } })} />
                      <VText ctx={ctx} fieldKey="lease.annualRentAed" label="Annual rent (AED)" inputMode="decimal" value={draft.lease.annualRentAed} onChange={(v) => up({ lease: { ...draft.lease, annualRentAed: v } })} />
                      <VText ctx={ctx} fieldKey="lease.securityDepositAed" label="Security deposit (AED)" inputMode="decimal" value={draft.lease.securityDepositAed} onChange={(v) => up({ lease: { ...draft.lease, securityDepositAed: v } })} />
                      <VText ctx={ctx} fieldKey="lease.areaSqm" label="Area (sqm)" inputMode="decimal" value={draft.lease.areaSqm} onChange={(v) => up({ lease: { ...draft.lease, areaSqm: v } })} />
                      <VText ctx={ctx} fieldKey="lease.registrationFeesAed" label="Registration fees (AED)" inputMode="decimal" value={draft.lease.registrationFeesAed} onChange={(v) => up({ lease: { ...draft.lease, registrationFeesAed: v } })} />
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Fiscal calendar */}
            <AccordionItem value="fiscal">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("fiscal", "VAT & corporate tax filings")}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <p className="text-xs text-text-faint mb-3 pt-1">
                  Drives the tax outflow lines in the 13-week cash forecast. Amounts in the entity's base currency.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <FieldShell label="VAT period">
                    <select className={inputCls} value={draft.fiscal.vatPeriod} onChange={(e) => up({ fiscal: { ...draft.fiscal, vatPeriod: e.target.value } })} data-testid="select-fiscal-vat-period">
                      <option value="">Not set</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                    </select>
                  </FieldShell>
                  <VDate ctx={ctx} fieldKey="fiscal.nextVatFilingDate" label="Next VAT filing" value={draft.fiscal.nextVatFilingDate} onChange={(v) => up({ fiscal: { ...draft.fiscal, nextVatFilingDate: v } })} testid="input-fiscal-vat-date" />
                  <VText ctx={ctx} fieldKey="fiscal.vatExpectedAmount" label="Expected VAT amount" inputMode="decimal" value={draft.fiscal.vatExpectedAmount} onChange={(v) => up({ fiscal: { ...draft.fiscal, vatExpectedAmount: v } })} testid="input-fiscal-vat-amount" />
                  <VDate ctx={ctx} fieldKey="fiscal.nextCtFilingDate" label="Next corporate-tax filing" value={draft.fiscal.nextCtFilingDate} onChange={(v) => up({ fiscal: { ...draft.fiscal, nextCtFilingDate: v } })} testid="input-fiscal-ct-date" />
                  <VText ctx={ctx} fieldKey="fiscal.ctExpectedAmount" label="Expected corporate-tax amount" inputMode="decimal" value={draft.fiscal.ctExpectedAmount} onChange={(v) => up({ fiscal: { ...draft.fiscal, ctExpectedAmount: v } })} testid="input-fiscal-ct-amount" />
                  <VText ctx={ctx} fieldKey="fiscal.ctTaxYearBasis" label="Corporate-tax year basis" placeholder="e.g. January – December" value={draft.fiscal.ctTaxYearBasis} onChange={(v) => up({ fiscal: { ...draft.fiscal, ctTaxYearBasis: v } })} testid="input-fiscal-ct-taxyear" />
                  <VDate ctx={ctx} fieldKey="fiscal.ctFirstPeriodStart" label="First CT period start" value={draft.fiscal.ctFirstPeriodStart} onChange={(v) => up({ fiscal: { ...draft.fiscal, ctFirstPeriodStart: v } })} testid="input-fiscal-ct-period-start" />
                  <VDate ctx={ctx} fieldKey="fiscal.ctFirstPeriodEnd" label="First CT period end" value={draft.fiscal.ctFirstPeriodEnd} onChange={(v) => up({ fiscal: { ...draft.fiscal, ctFirstPeriodEnd: v } })} testid="input-fiscal-ct-period-end" />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Cash policy */}
            <AccordionItem value="cash">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("cash", `Amounts in ${ccy}`)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <p className="text-xs text-text-faint mb-3 pt-1">
                  Drives the 13-week cash forecast: the opening balance seeds the entity's cash line; weeks closing below the minimum-cash or covenant floor raise breach warnings.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  <VText ctx={ctx} fieldKey="cashPolicy.openingBalance" label="Opening cash balance" inputMode="decimal" value={draft.cashPolicy.openingBalance} onChange={(v) => up({ cashPolicy: { ...draft.cashPolicy, openingBalance: v } })} testid="input-cash-opening-balance" />
                  <VDate ctx={ctx} fieldKey="cashPolicy.openingBalanceAsOf" label="Balance as of" value={draft.cashPolicy.openingBalanceAsOf} onChange={(v) => up({ cashPolicy: { ...draft.cashPolicy, openingBalanceAsOf: v } })} testid="input-cash-opening-asof" />
                  <VText ctx={ctx} fieldKey="cashPolicy.minCashPolicy" label="Minimum-cash policy" inputMode="decimal" value={draft.cashPolicy.minCashPolicy} onChange={(v) => up({ cashPolicy: { ...draft.cashPolicy, minCashPolicy: v } })} testid="input-cash-min-policy" />
                  <VText ctx={ctx} fieldKey="cashPolicy.covenantFloor" label="Covenant floor (optional)" inputMode="decimal" value={draft.cashPolicy.covenantFloor} onChange={(v) => up({ cashPolicy: { ...draft.cashPolicy, covenantFloor: v } })} testid="input-cash-covenant-floor" />
                  <VText ctx={ctx} fieldKey="cashPolicy.notes" label="Policy notes" value={draft.cashPolicy.notes} onChange={(v) => up({ cashPolicy: { ...draft.cashPolicy, notes: v } })} className="sm:col-span-2" testid="input-cash-policy-notes" />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Task #1092 — Pre-formation ownership (drives the recommended
                settlement treatment for the pre-incorporation cost pool). */}
            <AccordionItem value="formation">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader(
                  "formation",
                  draft.formation.ownershipType
                    ? {
                        cognirise_uae: "100% Cognirise UAE",
                        jv: "Joint venture",
                        founder_partner: "Founder + partner owned",
                        franchise: "Franchise",
                      }[draft.formation.ownershipType]
                    : draft.status === "in_formation"
                      ? "Recommended for in-formation entities"
                      : undefined,
                )}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <p className="text-xs text-text-faint mb-3 pt-1">
                  For entities being set up: the intended ownership structure drives the recommended
                  settlement of pre-incorporation costs (intercompany recharge, JV split, founder
                  receivable) once the entity is incorporated.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  <FieldShell label="Intended ownership">
                    <select
                      className={inputCls}
                      value={draft.formation.ownershipType}
                      onChange={(e) => up({ formation: { ...draft.formation, ownershipType: e.target.value } })}
                      data-testid="select-formation-ownership"
                    >
                      <option value="">Not specified</option>
                      <option value="cognirise_uae">100% Cognirise UAE</option>
                      <option value="jv">Joint venture with partners</option>
                      <option value="founder_partner">Founder + partner owned</option>
                      <option value="franchise">Franchise</option>
                    </select>
                  </FieldShell>
                  <VText ctx={ctx} fieldKey="formation.notes" label="Ownership notes" value={draft.formation.notes} onChange={(v) => up({ formation: { ...draft.formation, notes: v } })} testid="input-formation-notes" />
                </div>
                {draft.formation.ownershipType === "jv" && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-text-mute">JV cost-sharing splits (must sum to 100%)</p>
                    {ctx.errFor("formation.jvSplits") && (
                      <p className="text-[11px] text-danger">{ctx.errFor("formation.jvSplits")}</p>
                    )}
                    {draft.formation.jvSplits.map((s, i) => (
                      <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2 items-start">
                        <Input
                          className="h-9"
                          placeholder="Partner name"
                          value={s.partnerName}
                          onChange={(e) => {
                            const jvSplits = draft.formation.jvSplits.slice();
                            jvSplits[i] = { ...jvSplits[i], partnerName: e.target.value };
                            up({ formation: { ...draft.formation, jvSplits } });
                          }}
                          data-testid={`input-jv-partner-${i}`}
                        />
                        <VText
                          ctx={ctx}
                          fieldKey={`formation.jvSplits.${i}.sharePct`}
                          label=""
                          inputMode="decimal"
                          placeholder="Share %"
                          value={s.sharePct}
                          onChange={(v) => {
                            const jvSplits = draft.formation.jvSplits.slice();
                            jvSplits[i] = { ...jvSplits[i], sharePct: v };
                            up({ formation: { ...draft.formation, jvSplits } });
                          }}
                          testid={`input-jv-share-${i}`}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-0.5"
                          onClick={() =>
                            up({ formation: { ...draft.formation, jvSplits: draft.formation.jvSplits.filter((_, j) => j !== i) } })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        up({ formation: { ...draft.formation, jvSplits: [...draft.formation.jvSplits, { partnerName: "", sharePct: "" }] } })
                      }
                      data-testid="button-add-jv-split"
                    >
                      Add partner split
                    </Button>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Task #1165 — WPS / Statutory payroll */}
            <AccordionItem value="statutory">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader(
                  "statutory",
                  draft.statutory.wpsApplicable === "true"
                    ? draft.statutory.wpsEmployerUniqueId.trim()
                      ? `Employer ID ${draft.statutory.wpsEmployerUniqueId.trim()}`
                      : "WPS applicable — ID not set"
                    : draft.statutory.wpsApplicable === "false"
                      ? "WPS exempt"
                      : undefined,
                )}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <p className="text-xs text-text-faint mb-3 pt-1">
                  UAE Wage Protection System config for the SIF export. AE entities on the mainland WPS
                  regime must set their 13-digit MOHRE Employer Unique ID and 9-digit agent-bank routing
                  code before generating a SIF file. DIFC / ADGM entities that file outside MOHRE WPS
                  should be marked exempt.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <FieldShell label="WPS applicability">
                    <select
                      className={inputCls}
                      value={draft.statutory.wpsApplicable}
                      onChange={(e) => up({ statutory: { ...draft.statutory, wpsApplicable: e.target.value } })}
                      data-testid="select-wps-applicable"
                    >
                      <option value="">Not set</option>
                      <option value="true">Applicable (mainland WPS)</option>
                      <option value="false">Exempt (DIFC / ADGM or non-AE)</option>
                    </select>
                  </FieldShell>
                  <VText
                    ctx={ctx}
                    fieldKey="statutory.wps.employerUniqueId"
                    label="MOHRE Employer Unique ID"
                    placeholder="13 digits"
                    value={draft.statutory.wpsEmployerUniqueId}
                    onChange={(v) => up({ statutory: { ...draft.statutory, wpsEmployerUniqueId: v.replace(/\D/g, "") } })}
                    testid="input-wps-employer-id"
                  />
                  <VText
                    ctx={ctx}
                    fieldKey="statutory.wps.agentBankRoutingCode"
                    label="Agent-bank routing code"
                    placeholder="9 digits"
                    value={draft.statutory.wpsAgentBankRoutingCode}
                    onChange={(v) => up({ statutory: { ...draft.statutory, wpsAgentBankRoutingCode: v.replace(/\D/g, "") } })}
                    testid="input-wps-routing-code"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Notes */}
            <AccordionItem value="notes" className="border-b-0">
              <AccordionTrigger className="hover:no-underline py-3">
                {sectionHeader("notes", draft.notes.trim() ? "Has notes" : undefined)}
              </AccordionTrigger>
              <AccordionContent className="pb-5">
                <div className="pt-1">
                  <VText ctx={ctx} fieldKey="notes" label="Notes" value={draft.notes} onChange={(v) => up({ notes: v })} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="px-6 py-4 border-t border-border-soft bg-bg-elevate/30">
          {error && (
            <p className="text-sm text-danger mb-2" data-testid="text-entity-form-error">{error}</p>
          )}
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
