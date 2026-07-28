import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PillButton } from "./ui/primitives";
import { fieldControlCls } from "./ui/fieldControls";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierUpdateAccount,
  useAtelierListPersonas,
  getAtelierListPersonasQueryKey,
  getAtelierGetAccountWorkspaceQueryKey,
  getAtelierListAccountsQueryKey,
  type AtelierAccountWorkspaceAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// Task #698 — the Ownership card's edit surface. Covers exactly the
// partner-owned relationship fields (owner, tier, status, HQ city, currency,
// language); firmographics stay in EditAccountProfileDialog and research-owned
// fields (sector/country) remain read-only. Server mirrors the gate (partner
// tier + canSeeAccount) and validates the owner against real partner users.

const TIERS = ["A", "B", "C", "D"] as const;
// "archived" is intentionally absent — archiving is its own lifecycle action.
const STATUSES = ["active", "dormant"] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "EGP", "TRY"];
const LANGS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
];

const selectCls = `${fieldControlCls} bg-bg-deep border border-border rounded text-sm text-text w-full`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-text-mute text-xs font-mono uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

interface Props {
  account: AtelierAccountWorkspaceAccount;
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditOwnershipDialog({ account, accountId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useAtelierUpdateAccount();
  const { data: personas } = useAtelierListPersonas({
    query: { enabled: open, queryKey: getAtelierListPersonasQueryKey() },
  });
  const partners = React.useMemo(
    () => (personas ?? []).filter((p) => p.role === "partner" || p.role === "founding_partner"),
    [personas],
  );

  const [partnerOwnerId, setPartnerOwnerId] = React.useState("");
  const [tier, setTier] = React.useState<string>("C");
  const [status, setStatus] = React.useState<string>("active");
  const [hqCity, setHqCity] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [language, setLanguage] = React.useState("en");

  // Hydrate from the account on each open so a stale async re-render never
  // clobbers in-progress edits.
  React.useEffect(() => {
    if (!open) return;
    setPartnerOwnerId(account.partnerOwnerId ?? "");
    setTier((TIERS as readonly string[]).includes(account.tier) ? account.tier : "C");
    setStatus(
      (STATUSES as readonly string[]).includes(account.status) ? account.status : "active",
    );
    setHqCity(account.hqCity ?? "");
    setCurrency(
      account.primaryCurrency && /^[A-Z]{3}$/.test(account.primaryCurrency)
        ? account.primaryCurrency
        : "USD",
    );
    setLanguage(account.primaryLanguage === "ar" ? "ar" : "en");
  }, [open, account]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        accountId,
        data: {
          partnerOwnerId: partnerOwnerId || null,
          tier: tier as (typeof TIERS)[number],
          // The dialog only offers active/dormant; an archived account never
          // shows the edit affordance, so status is always sendable.
          status: status as (typeof STATUSES)[number],
          hqCity: hqCity.trim().slice(0, 120) || null,
          primaryCurrency: currency,
          primaryLanguage: language as "en" | "ar",
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      toast({ title: "Ownership updated", description: "Changes recorded in the audit trail." });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Could not save ownership",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[520px] bg-bg-elevate border-gold/40 text-text"
        data-testid="dialog-edit-ownership"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Edit ownership</DialogTitle>
          <DialogDescription className="text-text-mute">
            Relationship ownership for{" "}
            <span className="font-mono text-text">{account.brandName ?? account.name}</span>.
            Edits are audit-logged. Sector and country stay research-owned.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4 py-2">
          <Field label="Partner owner">
            <select
              value={partnerOwnerId}
              onChange={(e) => setPartnerOwnerId(e.target.value)}
              className={selectCls}
              data-testid="select-ownership-partner-owner"
            >
              <option value="">— Unassigned —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tier">
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className={selectCls}
                data-testid="select-ownership-tier"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    Tier {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={selectCls}
                data-testid="select-ownership-status"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="HQ city">
              <Input
                value={hqCity}
                onChange={(e) => setHqCity(e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="e.g. Dubai"
                maxLength={120}
                data-testid="input-ownership-hq-city"
              />
            </Field>
            <Field label="Currency">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={`${selectCls} font-mono`}
                data-testid="select-ownership-currency"
              >
                {Array.from(new Set([...CURRENCIES, currency])).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Language">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={selectCls}
              data-testid="select-ownership-language"
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-3 pt-3 border-t border-border-soft">
            <PillButton variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              type="submit"
              disabled={update.isPending}
              data-testid="button-submit-edit-ownership"
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
