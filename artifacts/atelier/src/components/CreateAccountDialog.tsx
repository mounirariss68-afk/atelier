import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { ReferenceCombobox, useReferenceBootstrap } from "@/components/ReferenceCombobox";
import {
  resolveCountry,
  localizedIndustryName,
  type IndustryRow,
  type SubIndustryRow,
} from "@/lib/reference-data";
import { fieldControlCls } from "./ui/fieldControls";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateAccount,
  useAtelierCheckAccountDuplicates,
  useAtelierListPersonas,
  useAtelierGetMe,
  useAtelierListAccounts,
  getAtelierListAccountsQueryKey,
  type AtelierAccountSummary,
  type AtelierAccountDuplicateError,
  type AtelierAccountDuplicateCandidate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

/**
 * Task #587 — a single reviewed decision-maker carried over from the chat
 * research card. `fullName` / `title` are partner-editable in the dialog; the
 * remaining fields ride along untouched so the server can persist them and
 * resolve the reporting (`reportsToName`) edges verbatim.
 */
export interface Stakeholder {
  fullName: string;
  title?: string | null;
  seniority?: "c_suite" | "vp" | "director" | "manager" | "ic" | null;
  buyerPersona?: string | null;
  sourceUrl?: string | null;
  confidence?: "verified" | "inferred";
  reportsToName?: string | null;
  rationale?: string | null;
}

/**
 * Task #560 — prefill payload from the chat `account_proposal` card. Mirrors
 * the Cartographer draft so "Review & Create" can hydrate the form verbatim.
 *
 * Task #587 — extended to carry the full reviewed research (decision-makers,
 * signals, brief, industry codes, refreshed summary, priority refs) so create
 * persists exactly what the partner saw instead of re-running the Cartographer.
 */
export interface AccountPrefill {
  name?: string | null;
  brandName?: string | null;
  sector?: string | null;
  country?: string | null;
  hqCity?: string | null;
  tier?: string | null;
  // Task #601 — firmographic enrichment so the dialog opens pre-filled rather
  // than blank/defaulted.
  size?: string | null;
  employeeCount?: number | null;
  primaryCurrency?: string | null;
  annualRevenue?: {
    amount?: number | null;
    currency?: string | null;
    asOf?: string | null;
    sourceUrl?: string | null;
    note?: string | null;
  } | null;
  holdingStructure?: {
    isHoldingCompany: boolean;
    isMultiBrand: boolean;
    brands: string[];
    note?: string | null;
  } | null;
  countryPresence?: Array<{
    country: string;
    role?: "hq" | "subsidiary" | "branch" | "office" | null;
    note?: string | null;
  }>;
  // Task #601 — branch-vs-HQ answer resolved conversationally in chat and
  // carried onto the proposal draft; hydrates the dialog's entity-role select.
  entityRole?: "hq" | "subsidiary" | "branch" | "office" | null;
  industryCode?: string | null;
  subIndustryCode?: string | null;
  strategicPriorities?: Array<{ text?: string; sourceUrls?: string[] } | string>;
  cogniriseHypothesis?: string | null;
  // Task #587 — reviewed research blob (present only on the chat flow).
  research?: {
    refreshedSummary?: string | null;
    industryCode?: string | null;
    subIndustryCode?: string | null;
    strategicPriorityRefs?: Array<{ text: string; sourceUrls: string[] }>;
    sourceSignals?: unknown[];
    researchBrief?: unknown;
    decisionMakers?: Stakeholder[];
  } | null;
}

interface Props {
  /** Trigger-driven usage (e.g. the CRM "New account" button). */
  trigger?: React.ReactNode;
  /** Controlled usage (e.g. the chat proposal card). When `open` is
   * provided the dialog is fully controlled and renders no trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialData?: AccountPrefill | null;
}

const TIERS = ["A", "B", "C", "D"] as const;
const STATUSES = ["active", "dormant", "archived"] as const;
const SIZES = ["enterprise", "large", "mid", "small"] as const;
const LANGS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "EGP", "TRY"];

/** Validate/normalise a 3-letter ISO-4217 code; returns null when unusable. */
function normaliseCurrencyCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : null;
}

// Server-enforced caps (see `atelierCreateAccountBody*` in the generated zod
// schema). The Cartographer's "Review & Create" prefill is AI-generated and
// routinely overflows these — strategic priorities run 250-320 chars and the
// hypothesis 700+ — which the form never re-validated, so "Create account"
// POSTed an over-length body and the server rejected it with 400 invalid-body.
// We clamp on hydration (and cap manual entry) so the payload is always valid.
const PRIORITY_MAX = 200;
const HYPOTHESIS_MAX = 600;
const NAME_MAX = 200; // also brandName
const LOCATION_MAX = 120; // sector, country, hqCity

/** Trim `value` to at most `max` chars, backing off to the last word boundary
 *  and appending an ellipsis when truncation occurs. Guarantees length ≤ max. */
function clampText(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const lastSpace = head.lastIndexOf(" ");
  const body = lastSpace > Math.floor(max * 0.6) ? head.slice(0, lastSpace) : head;
  return `${body.trimEnd()}…`;
}

const selectCls = `${fieldControlCls} bg-bg-deep border border-border rounded text-sm text-text`;
// Task #290 — the legacy hard-coded country list and free-text "Other…" /
// "__custom__" sector branches were removed when this dialog was migrated
// to <ReferenceCombobox/>. The reference-data API is now the single source
// of truth for both lookups.

const ENTITY_ROLES = ["", "hq", "subsidiary", "branch", "office"] as const;

type FormState = {
  name: string;
  brandName: string;
  sector: string;
  country: string;
  hqCity: string;
  size: "" | (typeof SIZES)[number];
  tier: (typeof TIERS)[number];
  status: (typeof STATUSES)[number];
  primaryCurrency: string;
  primaryLanguage: "en" | "ar";
  partnerOwnerId: string;
  parentAccountId: string;
  strategicPriorities: string[];
  prioritiesDraft: string;
  cogniriseHypothesis: string;
  notes: string;
  // Task #601 — firmographic enrichment.
  industryCode: string;
  subIndustryCode: string;
  employeeCount: string; // numeric text; "" = unknown
  revenueAmount: string; // numeric text; "" = unknown
  revenueCurrency: string;
  revenueAsOf: string;
  revenueSourceUrl: string;
  revenueNote: string;
  isHoldingCompany: boolean;
  isMultiBrand: boolean;
  holdingBrands: string; // comma-separated
  holdingNote: string;
  entityRole: (typeof ENTITY_ROLES)[number];
};

function makeInitial(opts: {
  partnerOwnerId?: string;
  prefill?: AccountPrefill | null;
}): FormState {
  const p = opts.prefill ?? null;
  const tierRaw = (p?.tier ?? "").toUpperCase();
  const tier = (TIERS as readonly string[]).includes(tierRaw)
    ? (tierRaw as (typeof TIERS)[number])
    : "C";
  const priorities = (p?.strategicPriorities ?? [])
    .map((x) => (typeof x === "string" ? x : x?.text ?? ""))
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => clampText(t, PRIORITY_MAX))
    .slice(0, 5);
  const country = clampText(p?.country || "United Arab Emirates", LOCATION_MAX);
  // Task #601 — brand defaults to the legal name; size hydrates from research;
  // currency prefers the researched HQ-country currency over a hard-coded USD.
  const sizeRaw = (p?.size ?? "").toLowerCase();
  const size = (SIZES as readonly string[]).includes(sizeRaw)
    ? (sizeRaw as (typeof SIZES)[number])
    : "";
  // Cartographer currency wins; otherwise placeholder "USD" until the
  // country→currency effect resolves the HQ-country default.
  const currency = normaliseCurrencyCode(p?.primaryCurrency) ?? "USD";
  const rev = p?.annualRevenue ?? null;
  const holding = p?.holdingStructure ?? null;
  // Task #601 — hydrate the entity role from the branch-vs-HQ answer resolved
  // in chat; only accept a known role, else leave blank for manual selection.
  const entityRoleCandidate = (p?.entityRole ?? "").toLowerCase();
  const entityRoleRaw = (ENTITY_ROLES as readonly string[]).includes(
    entityRoleCandidate,
  )
    ? (entityRoleCandidate as (typeof ENTITY_ROLES)[number])
    : "";
  return {
    name: clampText(p?.name ?? "", NAME_MAX),
    brandName: clampText(p?.brandName || p?.name || "", NAME_MAX),
    sector: clampText(p?.sector ?? "", LOCATION_MAX),
    country,
    hqCity: clampText(p?.hqCity ?? "", LOCATION_MAX),
    size,
    tier,
    status: "active",
    primaryCurrency: currency,
    primaryLanguage: "en",
    partnerOwnerId: opts.partnerOwnerId ?? "",
    parentAccountId: "",
    strategicPriorities: priorities,
    prioritiesDraft: "",
    cogniriseHypothesis: clampText(p?.cogniriseHypothesis ?? "", HYPOTHESIS_MAX),
    notes: "",
    industryCode: clampText(p?.industryCode ?? "", LOCATION_MAX),
    subIndustryCode: clampText(p?.subIndustryCode ?? "", LOCATION_MAX),
    employeeCount:
      typeof p?.employeeCount === "number" && p.employeeCount > 0
        ? String(Math.round(p.employeeCount))
        : "",
    revenueAmount:
      typeof rev?.amount === "number" && rev.amount > 0
        ? String(rev.amount)
        : "",
    revenueCurrency:
      normaliseCurrencyCode(rev?.currency) ?? currency,
    revenueAsOf: clampText(rev?.asOf ?? "", LOCATION_MAX),
    revenueSourceUrl: clampText(rev?.sourceUrl ?? "", 500),
    revenueNote: clampText(rev?.note ?? "", PRIORITY_MAX),
    isHoldingCompany: holding?.isHoldingCompany === true,
    isMultiBrand: holding?.isMultiBrand === true,
    holdingBrands: clampText((holding?.brands ?? []).join(", "), 600),
    holdingNote: clampText(holding?.note ?? "", PRIORITY_MAX),
    entityRole: entityRoleRaw,
  };
}

export function CreateAccountDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  initialData,
}: Props) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (isControlled) onOpenChange?.(v);
      else setInternalOpen(v);
    },
    [isControlled, onOpenChange],
  );
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useAtelierCreateAccount();
  const checkDup = useAtelierCheckAccountDuplicates();
  const { data: me } = useAtelierGetMe();
  const { data: personas } = useAtelierListPersonas();
  const { data: accounts } = useAtelierListAccounts();

  const partners = React.useMemo(
    // Task #292 — partner-tier owners include founding_partner.
    () => (personas ?? []).filter((p) => p.role === "partner" || p.role === "founding_partner"),
    [personas],
  );
  const defaultPartnerId =
    (me?.role === "partner" || me?.role === "founding_partner") ? me.id : partners[0]?.id ?? "";

  const [form, setForm] = React.useState<FormState>(() =>
    makeInitial({ partnerOwnerId: defaultPartnerId }),
  );
  const [duplicate, setDuplicate] = React.useState<AtelierAccountDuplicateError | null>(null);
  // Task #632 — fuzzy duplicate warnings (non-blocking; the partner can still
  // proceed). Debounced against the legal name / brand / country fields.
  const [dupCandidates, setDupCandidates] = React.useState<
    AtelierAccountDuplicateCandidate[]
  >([]);
  // Task #587 — the reviewed research blob (sans decision-makers, which are
  // edited separately in `stakeholders`). Null on the plain CRM-form flow, in
  // which case create falls back to the background Cartographer run.
  const [research, setResearch] = React.useState<NonNullable<AccountPrefill["research"]> | null>(
    null,
  );
  const [stakeholders, setStakeholders] = React.useState<Stakeholder[]>([]);
  // Task #601 — multinational footprint, partner-editable in the dialog.
  const [countryPresence, setCountryPresence] = React.useState<
    Array<{ country: string; role: string; note: string }>
  >([]);
  const { data: referenceData } = useReferenceBootstrap();
  // True once the partner manually edits the currency, so the country→currency
  // effect stops auto-resolving. Reset on each open.
  const currencyTouched = React.useRef(false);
  // Whether the prefill supplied an explicit (researched) currency — when it
  // did, the country effect must not override it.
  const hadPrefillCurrency = React.useRef(false);

  // Hydrate only on the closed→open transition so prefilled values and any
  // edits the partner makes are never clobbered by an async re-render.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(makeInitial({ partnerOwnerId: defaultPartnerId, prefill: initialData }));
      setDuplicate(null);
      currencyTouched.current = false;
      hadPrefillCurrency.current =
        normaliseCurrencyCode(initialData?.primaryCurrency) != null;
      const r = initialData?.research ?? null;
      setResearch(r);
      setStakeholders(
        (r?.decisionMakers ?? [])
          .filter((d) => (d?.fullName ?? "").trim().length > 0)
          .map((d) => ({ ...d, fullName: d.fullName.trim() })),
      );
      setCountryPresence(
        (initialData?.countryPresence ?? [])
          .map((c) => ({
            country: (c?.country ?? "").trim(),
            role: c?.role ?? "",
            note: c?.note ?? "",
          }))
          .filter((c) => c.country.length > 0),
      );
    }
    if (open && !wasOpen.current) setDupCandidates([]);
    wasOpen.current = open;
  }, [open, defaultPartnerId, initialData]);

  // Task #632 — debounced fuzzy duplicate check. Fires on the legal name /
  // brand / country fields once a meaningful name is entered. Non-blocking:
  // it only populates the advisory warning banner; the partner may proceed.
  const dupName = form.name.trim();
  const dupBrand = form.brandName.trim();
  const dupCountry = form.country.trim();
  React.useEffect(() => {
    if (!open) return;
    if (dupName.length < 3) {
      setDupCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkDup.mutateAsync({
          data: {
            name: dupName,
            brandName: dupBrand || null,
            country: dupCountry || null,
          },
        });
        if (!cancelled) setDupCandidates(res.candidates ?? []);
      } catch {
        if (!cancelled) setDupCandidates([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dupName, dupBrand, dupCountry]);

  // Task #601 — resolve the HQ-country default currency (e.g. UAE→AED, Türkiye
  // →TRY) instead of a hard-coded USD. Skips when the partner edited the
  // currency or the Cartographer already supplied one.
  React.useEffect(() => {
    if (!open) return;
    if (currencyTouched.current || hadPrefillCurrency.current) return;
    const rows = referenceData?.countries;
    if (!rows || rows.length === 0) return;
    const match = resolveCountry(form.country, rows);
    const cur = normaliseCurrencyCode(match?.primaryCurrency);
    if (cur && cur !== form.primaryCurrency) {
      setForm((f) => ({ ...f, primaryCurrency: cur }));
    }
  }, [open, referenceData, form.country, form.primaryCurrency]);

  // Task #601 — the sector combobox runs in display mode, so a Cartographer
  // free-text sector never matches a canonical row and the field shows
  // "Select industry…". Resolve the researched industryCode to its canonical
  // display name once the reference data loads so the researched industry shows
  // as selected.
  const industryResolved = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      industryResolved.current = false;
      return;
    }
    if (industryResolved.current) return;
    const code = form.industryCode.trim();
    if (!code) return;
    const rows = referenceData?.industries;
    if (!rows || rows.length === 0) return;
    const row = rows.find((r: IndustryRow) => r.code === code);
    if (row) {
      const display = localizedIndustryName(row, "en");
      industryResolved.current = true;
      setForm((f) =>
        f.sector === display ? f : { ...f, sector: display },
      );
    }
  }, [open, referenceData, form.industryCode]);

  // Backfill the partner owner once personas resolve, if still unset (covers
  // the trigger path opened before `me`/personas loaded).
  React.useEffect(() => {
    if (open && defaultPartnerId) {
      setForm((f) => (f.partnerOwnerId ? f : { ...f, partnerOwnerId: defaultPartnerId }));
    }
  }, [open, defaultPartnerId]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Both fields are now driven by <ReferenceCombobox/> (free text disabled).
  const sectorValue = form.sector.trim();
  const countryValue = form.country.trim();

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof FormState | "primaryCurrency", string>> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!sectorValue) e.sector = "Required";
    if (!countryValue) e.country = "Required";
    if (!/^[A-Z]{3}$/.test(form.primaryCurrency.toUpperCase()))
      e.primaryCurrency = "3-letter ISO code";
    if (!["en", "ar"].includes(form.primaryLanguage)) e.primaryLanguage = "Invalid";
    if (!TIERS.includes(form.tier)) e.tier = "Invalid";
    return e;
  }, [form, sectorValue, countryValue]);

  const isValid = Object.keys(errors).length === 0;

  function addPriority() {
    const v = form.prioritiesDraft.trim();
    if (!v) return;
    if (form.strategicPriorities.length >= 5) return;
    setForm((f) => ({
      ...f,
      strategicPriorities: [...f.strategicPriorities, v],
      prioritiesDraft: "",
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setDuplicate(null);
    // Task #587 — when the dialog was opened from a chat research card, forward
    // the reviewed research (with the partner's edited stakeholder list) so the
    // server persists it verbatim and skips a second Cartographer run.
    const cleanStakeholders = stakeholders
      .map((s) => ({ ...s, fullName: s.fullName.trim(), title: s.title?.trim() || null }))
      .filter((s) => s.fullName.length > 0);
    const researchPayload = research
      ? {
          refreshedSummary: research.refreshedSummary ?? null,
          industryCode: research.industryCode ?? null,
          subIndustryCode: research.subIndustryCode ?? null,
          strategicPriorityRefs: research.strategicPriorityRefs ?? [],
          sourceSignals: research.sourceSignals ?? [],
          researchBrief: research.researchBrief ?? null,
          decisionMakers: cleanStakeholders,
        }
      : null;
    // Task #601 — firmographic enrichment. Coerce empty/invalid inputs to null
    // (never fabricate) and clamp so the body stays within server caps.
    const employeeCount = (() => {
      const n = Number.parseInt(form.employeeCount.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const revenueAmount = (() => {
      const n = Number.parseFloat(form.revenueAmount.trim());
      return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const annualRevenue =
      revenueAmount != null ||
      form.revenueAsOf.trim() ||
      form.revenueSourceUrl.trim() ||
      form.revenueNote.trim()
        ? {
            amount: revenueAmount,
            currency: normaliseCurrencyCode(form.revenueCurrency),
            asOf: clampText(form.revenueAsOf, LOCATION_MAX) || null,
            sourceUrl: form.revenueSourceUrl.trim().slice(0, 500) || null,
            note: clampText(form.revenueNote, PRIORITY_MAX) || null,
          }
        : null;
    const brands = form.holdingBrands
      .split(",")
      .map((b) => b.trim())
      .filter((b) => b.length > 0)
      .slice(0, 24);
    const holdingStructure =
      form.isHoldingCompany ||
      form.isMultiBrand ||
      brands.length > 0 ||
      form.holdingNote.trim()
        ? {
            isHoldingCompany: form.isHoldingCompany,
            isMultiBrand: form.isMultiBrand || brands.length > 1,
            brands,
            note: clampText(form.holdingNote, PRIORITY_MAX) || null,
          }
        : null;
    const cleanCountryPresence = countryPresence
      .map((c) => ({
        country: clampText(c.country, LOCATION_MAX),
        role: (c.role || null) as
          | "hq" | "subsidiary" | "branch" | "office" | null,
        note: clampText(c.note, PRIORITY_MAX) || null,
      }))
      .filter((c) => c.country.length > 0)
      .slice(0, 40);
    try {
      const res = await create.mutateAsync({
        data: {
          name: form.name.trim(),
          brandName: form.brandName.trim() || null,
          sector: sectorValue,
          country: countryValue,
          hqCity: form.hqCity.trim() || null,
          size: form.size || null,
          tier: form.tier,
          status: form.status,
          primaryCurrency: form.primaryCurrency.toUpperCase(),
          primaryLanguage: form.primaryLanguage,
          partnerOwnerId: form.partnerOwnerId || null,
          parentAccountId: form.parentAccountId || null,
          strategicPriorities: form.strategicPriorities,
          cogniriseHypothesis: form.cogniriseHypothesis.trim() || null,
          notes: form.notes.trim() || null,
          // Task #601 — firmographic enrichment fields.
          employeeCount,
          annualRevenue,
          holdingStructure,
          countryPresence: cleanCountryPresence,
          entityRole: form.entityRole || null,
          // researchPayload is built from loosely-typed chat prefill (its
          // sourceSignals widen to unknown[]); cast to the generated research
          // shape. The firmographic fields above are now fully typed.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(researchPayload ? { research: researchPayload as any } : {}),
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      toast({
        title: "Account created",
        description: researchPayload
          ? `Saved with ${cleanStakeholders.length} reviewed stakeholder${cleanStakeholders.length === 1 ? "" : "s"}.`
          : "Cartographer is researching this account…",
      });
      setOpen(false);
      setLocation(`/accounts/${res.id}`);
    } catch (err: unknown) {
      const anyErr = err as { status?: number; data?: AtelierAccountDuplicateError };
      if (anyErr?.status === 409 && anyErr.data?.error === "duplicate-name") {
        setDuplicate(anyErr.data);
      } else {
        toast({
          title: "Could not create account",
          description: (err as Error)?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className="sm:max-w-[720px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto"
        data-testid="dialog-new-account"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">New account</DialogTitle>
          <DialogDescription className="text-text-mute">
            Capture the firm shape; Account Cartographer auto-runs on create to seed firmographics, signals, and proposed contacts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5 py-3">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Legal name" required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="e.g. Tasama Holdings PJSC"
                autoFocus
                data-testid="input-account-name"
              />
            </Field>
            <Field label="Brand / display name">
              <Input
                value={form.brandName}
                onChange={(e) => update("brandName", e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="e.g. Tasama"
                data-testid="input-account-brand-name"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/*
              Task #290 — Reference-data PoC wire-in. The accounts.sector column
              is still a free-text field (the FK migration ships in Task #291),
              so the combobox runs in valueMode="display": we store the EN
              display name into the existing column. The combobox itself
              prevents free-text entries, giving us a controlled vocabulary
              before the schema migration.
            */}
            <Field label="Industry / sector" required error={errors.sector}>
              <ReferenceCombobox
                kind="industry"
                valueMode="display"
                value={form.sector}
                onChange={(v) => update("sector", v)}
                placeholder="Select industry…"
                size="lg"
                testIdPrefix="select-account-sector"
              />
            </Field>
            <Field label="Country" required error={errors.country}>
              <ReferenceCombobox
                kind="country"
                valueMode="display"
                value={form.country}
                onChange={(v) => update("country", v)}
                placeholder="Select country…"
                size="lg"
                testIdPrefix="select-account-country"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="HQ city">
              <Input
                value={form.hqCity}
                onChange={(e) => update("hqCity", e.target.value)}
                className="bg-bg-deep border-border text-text"
                data-testid="input-account-hq-city"
              />
            </Field>
            <Field label="Account size">
              <select
                value={form.size}
                onChange={(e) => update("size", e.target.value as FormState["size"])}
                className={selectCls}
                data-testid="select-account-size"
              >
                <option value="">—</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Tier" required>
              <select
                value={form.tier}
                onChange={(e) => update("tier", e.target.value as FormState["tier"])}
                className={selectCls}
                data-testid="select-account-tier"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>{`Tier ${t}`}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Status" required>
              <select
                value={form.status}
                onChange={(e) => update("status", e.target.value as FormState["status"])}
                className={selectCls}
                data-testid="select-account-status"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Primary currency" required error={errors.primaryCurrency}>
              <select
                value={form.primaryCurrency}
                onChange={(e) => {
                  currencyTouched.current = true;
                  update("primaryCurrency", e.target.value);
                }}
                className={`${selectCls} font-mono`}
                data-testid="select-account-currency"
              >
                {Array.from(
                  new Set([
                    ...CURRENCIES,
                    ...(form.primaryCurrency ? [form.primaryCurrency] : []),
                  ]),
                ).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Primary language" required>
              <select
                value={form.primaryLanguage}
                onChange={(e) => update("primaryLanguage", e.target.value as "en" | "ar")}
                className={selectCls}
                data-testid="select-account-language"
              >
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Partner owner">
              <select
                value={form.partnerOwnerId}
                onChange={(e) => update("partnerOwnerId", e.target.value)}
                className={selectCls}
                data-testid="select-account-partner-owner"
              >
                <option value="">— Unassigned —</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Parent account">
              <select
                value={form.parentAccountId}
                onChange={(e) => update("parentAccountId", e.target.value)}
                className={selectCls}
                data-testid="select-account-parent"
              >
                <option value="">— None —</option>
                {(accounts ?? []).map((a: AtelierAccountSummary) => (
                  <option key={a.id} value={a.id}>{a.brandName ?? a.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Task #601 — firmographic enrichment, partner-reviewable. */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Employees">
              <Input
                type="number"
                min={0}
                value={form.employeeCount}
                onChange={(e) => update("employeeCount", e.target.value)}
                className="bg-bg-deep border-border text-text font-mono"
                placeholder="e.g. 4500"
                data-testid="input-account-employees"
              />
            </Field>
            <Field label="Annual revenue">
              <Input
                type="number"
                min={0}
                value={form.revenueAmount}
                onChange={(e) => update("revenueAmount", e.target.value)}
                className="bg-bg-deep border-border text-text font-mono"
                placeholder="amount"
                data-testid="input-account-revenue-amount"
              />
            </Field>
            <Field label="Revenue currency">
              <select
                value={form.revenueCurrency}
                onChange={(e) => update("revenueCurrency", e.target.value)}
                className={`${selectCls} font-mono`}
                data-testid="select-account-revenue-currency"
              >
                {Array.from(
                  new Set([
                    ...CURRENCIES,
                    ...(form.revenueCurrency ? [form.revenueCurrency] : []),
                  ]),
                ).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Revenue as-of">
              <Input
                value={form.revenueAsOf}
                onChange={(e) => update("revenueAsOf", e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="e.g. FY2024"
                maxLength={LOCATION_MAX}
                data-testid="input-account-revenue-asof"
              />
            </Field>
            <Field label="Revenue source URL">
              <Input
                value={form.revenueSourceUrl}
                onChange={(e) => update("revenueSourceUrl", e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="https://…"
                maxLength={500}
                data-testid="input-account-revenue-source"
              />
            </Field>
          </div>

          <Field label="Revenue / financials note">
            <Input
              value={form.revenueNote}
              onChange={(e) => update("revenueNote", e.target.value)}
              className="bg-bg-deep border-border text-text"
              placeholder="Key financials context (no fabricated figures)"
              maxLength={PRIORITY_MAX}
              data-testid="input-account-revenue-note"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Entity role">
              <select
                value={form.entityRole}
                onChange={(e) =>
                  update("entityRole", e.target.value as FormState["entityRole"])
                }
                className={selectCls}
                data-testid="select-account-entity-role"
              >
                <option value="">—</option>
                <option value="hq">Headquarters</option>
                <option value="subsidiary">Subsidiary</option>
                <option value="branch">Branch</option>
                <option value="office">Office</option>
              </select>
            </Field>
            <Field label="Group structure">
              <div className="flex flex-col gap-1.5 pt-1">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={form.isHoldingCompany}
                    onChange={(e) => update("isHoldingCompany", e.target.checked)}
                    data-testid="checkbox-account-holding"
                  />
                  Holding company
                </label>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={form.isMultiBrand}
                    onChange={(e) => update("isMultiBrand", e.target.checked)}
                    data-testid="checkbox-account-multibrand"
                  />
                  Multi-brand
                </label>
              </div>
            </Field>
          </div>

          <Field label="Operating brands (comma-separated)">
            <Input
              value={form.holdingBrands}
              onChange={(e) => update("holdingBrands", e.target.value)}
              className="bg-bg-deep border-border text-text"
              placeholder="e.g. Brand A, Brand B, Brand C"
              maxLength={600}
              data-testid="input-account-brands"
            />
          </Field>

          <Field
            label={`Country presence${countryPresence.length ? ` (${countryPresence.length})` : ""}`}
          >
            <p className="text-xs text-text-mute -mt-0.5 mb-1">
              Markets where the firm operates, tagged by role. Helps with the
              HQ-vs-branch question.
            </p>
            <div className="grid gap-2" data-testid="country-presence-editor">
              {countryPresence.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  data-testid={`country-presence-row-${i}`}
                >
                  <Input
                    value={c.country}
                    onChange={(e) =>
                      setCountryPresence((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, country: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Country"
                    className="bg-bg-deep border-border text-text flex-1"
                    data-testid={`input-country-presence-country-${i}`}
                  />
                  <select
                    value={c.role}
                    onChange={(e) =>
                      setCountryPresence((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, role: e.target.value } : x,
                        ),
                      )
                    }
                    className={selectCls}
                    data-testid={`select-country-presence-role-${i}`}
                  >
                    <option value="">— role —</option>
                    <option value="hq">HQ</option>
                    <option value="subsidiary">Subsidiary</option>
                    <option value="branch">Branch</option>
                    <option value="office">Office</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setCountryPresence((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-text-mute hover:text-danger px-1"
                    aria-label={`Remove ${c.country || "country"}`}
                    data-testid={`button-remove-country-presence-${i}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <PillButton
                type="button"
                variant="ghost"
                onClick={() =>
                  setCountryPresence((prev) => [
                    ...prev,
                    { country: "", role: "", note: "" },
                  ])
                }
                data-testid="button-add-country-presence"
              >
                + Add country
              </PillButton>
            </div>
          </Field>

          <Field label="Strategic priorities (up to 5)">
            <div className="flex gap-2">
              <Input
                value={form.prioritiesDraft}
                onChange={(e) => update("prioritiesDraft", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPriority();
                  }
                }}
                disabled={form.strategicPriorities.length >= 5}
                maxLength={PRIORITY_MAX}
                placeholder="Add a priority and press Enter"
                className="bg-bg-deep border-border text-text"
                data-testid="input-account-priority-draft"
              />
              <PillButton
                type="button"
                variant="ghost"
                onClick={addPriority}
                disabled={!form.prioritiesDraft.trim() || form.strategicPriorities.length >= 5}
              >
                Add
              </PillButton>
            </div>
            {form.strategicPriorities.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {form.strategicPriorities.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 bg-bg-deep border border-border rounded-full px-3 py-1 text-xs text-text"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          strategicPriorities: f.strategicPriorities.filter((_, j) => j !== i),
                        }))
                      }
                      className="text-text-mute hover:text-danger"
                      aria-label={`Remove priority ${p}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Field>

          <Field label="Cognirise hypothesis">
            <Textarea
              value={form.cogniriseHypothesis}
              onChange={(e) => update("cogniriseHypothesis", e.target.value)}
              maxLength={HYPOTHESIS_MAX}
              className="bg-bg-deep border-border text-text min-h-[80px] text-sm"
              placeholder="Why is Cognirise well-positioned to help this firm?"
              data-testid="input-account-hypothesis"
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="bg-bg-deep border-border text-text min-h-[60px] text-sm"
              placeholder="Anything the partner already knows…"
              data-testid="input-account-notes"
            />
          </Field>

          {research && (
            <Field
              label={`Proposed stakeholders${stakeholders.length ? ` (${stakeholders.length})` : ""}`}
            >
              <p className="text-xs text-text-mute -mt-0.5 mb-1">
                Reviewed from the research card. Edit names/titles or remove any
                before creating; reporting lines are preserved.
              </p>
              {stakeholders.length === 0 ? (
                <p className="text-xs text-text-faint font-mono py-1">
                  No stakeholders — Cognirise contacts can be added later.
                </p>
              ) : (
                <div className="grid gap-2" data-testid="stakeholder-editor">
                  {stakeholders.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2"
                      data-testid={`stakeholder-row-${i}`}
                    >
                      <Input
                        value={s.fullName}
                        onChange={(e) =>
                          setStakeholders((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, fullName: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="Full name"
                        className="bg-bg-deep border-border text-text flex-1"
                        data-testid={`input-stakeholder-name-${i}`}
                      />
                      <Input
                        value={s.title ?? ""}
                        onChange={(e) =>
                          setStakeholders((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="Title"
                        className="bg-bg-deep border-border text-text flex-1"
                        data-testid={`input-stakeholder-title-${i}`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setStakeholders((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="text-text-mute hover:text-danger px-1"
                        aria-label={`Remove ${s.fullName || "stakeholder"}`}
                        data-testid={`button-remove-stakeholder-${i}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Field>
          )}

          {!duplicate && dupCandidates.length > 0 && (
            <div
              className="border border-warn/40 bg-warn/10 rounded p-3 text-sm grid gap-2"
              data-testid="warning-duplicate-accounts"
            >
              <div className="font-medium text-warn">
                {dupCandidates.length === 1
                  ? "A similar account may already exist"
                  : `${dupCandidates.length} similar accounts may already exist`}
              </div>
              <ul className="grid gap-1.5">
                {dupCandidates.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3"
                    data-testid={`warning-duplicate-account-${c.id}`}
                  >
                    <span className="min-w-0">
                      <span className="truncate">{c.brandName ?? c.name}</span>
                      {c.country ? (
                        <span className="text-text-faint"> · {c.country}</span>
                      ) : null}
                      <span className="ml-2 text-[10px] uppercase tracking-widest font-mono text-text-faint">
                        {c.confidence} match
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setLocation(`/accounts/${c.id}`);
                      }}
                      className="text-gold hover:underline whitespace-nowrap"
                    >
                      Open →
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-faint">
                You can still create this account if it is genuinely different.
              </p>
            </div>
          )}

          {duplicate && (
            <div
              className="border border-danger/40 bg-danger/10 rounded p-3 text-sm flex items-start justify-between gap-3"
              data-testid="error-duplicate-account"
            >
              <span>An account with this legal name already exists.</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setLocation(`/accounts/${duplicate.existingAccountId}`);
                }}
                className="text-gold hover:underline whitespace-nowrap"
              >
                Open existing →
              </button>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-border-soft">
            <PillButton variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              type="submit"
              disabled={!isValid || create.isPending}
              data-testid="button-submit-new-account"
            >
              {create.isPending ? "Creating…" : "Create account"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs uppercase tracking-widest font-mono text-text-faint">
        {label}
        {required && <span className="text-gold ml-1">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-danger font-mono">{error}</p>}
    </div>
  );
}
