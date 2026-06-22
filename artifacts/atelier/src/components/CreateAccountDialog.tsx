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
import { ReferenceCombobox } from "@/components/ReferenceCombobox";
import { fieldControlCls } from "./ui/fieldControls";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateAccount,
  useAtelierListPersonas,
  useAtelierGetMe,
  useAtelierListAccounts,
  getAtelierListAccountsQueryKey,
  type AtelierAccountSummary,
  type AtelierAccountDuplicateError,
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
  return {
    name: clampText(p?.name ?? "", NAME_MAX),
    brandName: clampText(p?.brandName ?? "", NAME_MAX),
    sector: clampText(p?.sector ?? "", LOCATION_MAX),
    country: clampText(p?.country || "United Arab Emirates", LOCATION_MAX),
    hqCity: clampText(p?.hqCity ?? "", LOCATION_MAX),
    size: "",
    tier,
    status: "active",
    primaryCurrency: "USD",
    primaryLanguage: "en",
    partnerOwnerId: opts.partnerOwnerId ?? "",
    parentAccountId: "",
    strategicPriorities: priorities,
    prioritiesDraft: "",
    cogniriseHypothesis: clampText(p?.cogniriseHypothesis ?? "", HYPOTHESIS_MAX),
    notes: "",
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
  // Task #587 — the reviewed research blob (sans decision-makers, which are
  // edited separately in `stakeholders`). Null on the plain CRM-form flow, in
  // which case create falls back to the background Cartographer run.
  const [research, setResearch] = React.useState<NonNullable<AccountPrefill["research"]> | null>(
    null,
  );
  const [stakeholders, setStakeholders] = React.useState<Stakeholder[]>([]);

  // Hydrate only on the closed→open transition so prefilled values and any
  // edits the partner makes are never clobbered by an async re-render.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(makeInitial({ partnerOwnerId: defaultPartnerId, prefill: initialData }));
      setDuplicate(null);
      const r = initialData?.research ?? null;
      setResearch(r);
      setStakeholders(
        (r?.decisionMakers ?? [])
          .filter((d) => (d?.fullName ?? "").trim().length > 0)
          .map((d) => ({ ...d, fullName: d.fullName.trim() })),
      );
    }
    wasOpen.current = open;
  }, [open, defaultPartnerId, initialData]);

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
                onChange={(e) => update("primaryCurrency", e.target.value)}
                className={`${selectCls} font-mono`}
                data-testid="select-account-currency"
              >
                {CURRENCIES.map((c) => (
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
