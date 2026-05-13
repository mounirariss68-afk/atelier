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

interface Props {
  trigger: React.ReactNode;
}

const TIERS = ["A", "B", "C", "D"] as const;
const STATUSES = ["active", "dormant", "archived"] as const;
const SIZES = ["enterprise", "large", "mid", "small"] as const;
const LANGS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "EGP", "TRY"];
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
  aicoHypothesis: string;
  notes: string;
};

function makeInitial(opts: { partnerOwnerId?: string }): FormState {
  return {
    name: "",
    brandName: "",
    sector: "",
    country: "United Arab Emirates",
    hqCity: "",
    size: "",
    tier: "C",
    status: "active",
    primaryCurrency: "USD",
    primaryLanguage: "en",
    partnerOwnerId: opts.partnerOwnerId ?? "",
    parentAccountId: "",
    strategicPriorities: [],
    prioritiesDraft: "",
    aicoHypothesis: "",
    notes: "",
  };
}

export function CreateAccountDialog({ trigger }: Props) {
  const [open, setOpen] = React.useState(false);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useAtelierCreateAccount();
  const { data: me } = useAtelierGetMe();
  const { data: personas } = useAtelierListPersonas();
  const { data: accounts } = useAtelierListAccounts();

  const partners = React.useMemo(
    () => (personas ?? []).filter((p) => p.role === "partner"),
    [personas],
  );
  const defaultPartnerId =
    me?.role === "partner" ? me.id : partners[0]?.id ?? "";

  const [form, setForm] = React.useState<FormState>(() =>
    makeInitial({ partnerOwnerId: defaultPartnerId }),
  );
  const [duplicate, setDuplicate] = React.useState<AtelierAccountDuplicateError | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm(makeInitial({ partnerOwnerId: defaultPartnerId }));
      setDuplicate(null);
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
          aicoHypothesis: form.aicoHypothesis.trim() || null,
          notes: form.notes.trim() || null,
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      toast({
        title: "Account created",
        description: "Cartographer is researching this account…",
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text font-mono"
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
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
                className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
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

          <Field label="AICo hypothesis">
            <Textarea
              value={form.aicoHypothesis}
              onChange={(e) => update("aicoHypothesis", e.target.value)}
              maxLength={500}
              className="bg-bg-deep border-border text-text min-h-[80px] text-sm"
              placeholder="Why is AICo well-positioned to help this firm?"
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
