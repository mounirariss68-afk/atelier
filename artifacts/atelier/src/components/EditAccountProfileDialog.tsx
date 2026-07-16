import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PillButton } from "./ui/primitives";
import { fieldControlCls } from "./ui/fieldControls";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierUpdateAccount,
  getAtelierGetAccountWorkspaceQueryKey,
  getAtelierListAccountsQueryKey,
  type AtelierAccountWorkspaceAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  account: AtelierAccountWorkspaceAccount;
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Scope decision (T005): firmographic identity fields — sector, hqCity,
// country, and tier — are intentionally NOT editable here. They are owned by
// the Cartographer research pipeline and are not part of
// AtelierUpdateAccountInput, so the PATCH endpoint would reject them. This
// dialog only exposes the partner-editable enrichment fields the server
// accepts (notes, parent, strategy, competitors, employeeCount, annualRevenue,
// holdingStructure, countryPresence, entityRole, primaryCurrency). Surfacing
// the read-only firmographics as inputs would imply an edit capability that
// does not exist, so they are shown elsewhere (Account header) as read-only.

const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "EGP", "TRY"];

// Server-enforced caps (mirror CreateAccountDialog so the PATCH body never
// overflows and the server never 400s on an over-length string).
const LOCATION_MAX = 120;
const NOTE_MAX = 200;

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

/** Validate/normalise a 3-letter ISO-4217 code; returns null when unusable. */
function normaliseCurrencyCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : null;
}

const selectCls = `${fieldControlCls} bg-bg-deep border border-border rounded text-sm text-text`;

type EntityRole = "" | "hq" | "subsidiary" | "branch" | "office";

export function EditAccountProfileDialog({ account, accountId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useAtelierUpdateAccount();

  // Task #613 — annual revenue is a money surface gated by the same account-
  // financials authority that governs viewing it. Personas without that
  // authority see the figure as "Restricted" and must not be able to edit (or
  // silently wipe) it, so the revenue inputs are hidden and annualRevenue is
  // omitted from the PATCH for them. The server enforces the same gate (403).
  // Fail closed: only show revenue editing when the server explicitly grants
  // financial authority. The backend always populates this flag (via the
  // account summary), so an absent/false value means no access and we must NOT
  // surface inputs that would 403 on save.
  const canEditFinancials = account.canEditFinancials === true;

  const [employeeCount, setEmployeeCount] = React.useState("");
  const [revenueAmount, setRevenueAmount] = React.useState("");
  const [revenueCurrency, setRevenueCurrency] = React.useState("USD");
  const [revenueAsOf, setRevenueAsOf] = React.useState("");
  const [revenueSourceUrl, setRevenueSourceUrl] = React.useState("");
  const [revenueNote, setRevenueNote] = React.useState("");
  const [isHoldingCompany, setIsHoldingCompany] = React.useState(false);
  const [isMultiBrand, setIsMultiBrand] = React.useState(false);
  const [holdingBrands, setHoldingBrands] = React.useState("");
  const [holdingNote, setHoldingNote] = React.useState("");
  const [entityRole, setEntityRole] = React.useState<EntityRole>("");
  const [countryPresence, setCountryPresence] = React.useState<
    Array<{ country: string; role: string; note: string }>
  >([]);

  // Hydrate from the account record on each open so partner edits are never
  // clobbered by an async re-render while the dialog is open.
  React.useEffect(() => {
    if (!open) return;
    const rev = account.annualRevenue ?? null;
    const holding = account.holdingStructure ?? null;
    setEmployeeCount(
      typeof account.employeeCount === "number" && account.employeeCount > 0
        ? String(Math.round(account.employeeCount))
        : "",
    );
    setRevenueAmount(
      typeof rev?.amount === "number" && rev.amount > 0 ? String(rev.amount) : "",
    );
    setRevenueCurrency(
      normaliseCurrencyCode(rev?.currency) ??
        normaliseCurrencyCode(account.primaryCurrency) ??
        "USD",
    );
    setRevenueAsOf(rev?.asOf ?? "");
    setRevenueSourceUrl(rev?.sourceUrl ?? "");
    setRevenueNote(rev?.note ?? "");
    setIsHoldingCompany(holding?.isHoldingCompany === true);
    setIsMultiBrand(holding?.isMultiBrand === true);
    setHoldingBrands((holding?.brands ?? []).join(", "));
    setHoldingNote(holding?.note ?? "");
    const role = (account.entityRole ?? "") as EntityRole;
    setEntityRole((["hq", "subsidiary", "branch", "office"] as const).includes(
      role as "hq" | "subsidiary" | "branch" | "office",
    )
      ? role
      : "");
    setCountryPresence(
      (account.countryPresence ?? [])
        .map((c) => ({
          country: (c?.country ?? "").trim(),
          role: c?.role ?? "",
          note: c?.note ?? "",
        }))
        .filter((c) => c.country.length > 0),
    );
  }, [open, account]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Coerce empty/invalid inputs to null (never fabricate) and clamp so the
    // PATCH body always stays within the server caps — mirrors the create flow.
    const employees = (() => {
      const n = Number.parseInt(employeeCount.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const revAmount = (() => {
      const n = Number.parseFloat(revenueAmount.trim());
      return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const annualRevenue =
      revAmount != null ||
      revenueAsOf.trim() ||
      revenueSourceUrl.trim() ||
      revenueNote.trim()
        ? {
            amount: revAmount,
            currency: normaliseCurrencyCode(revenueCurrency),
            asOf: clampText(revenueAsOf, LOCATION_MAX) || null,
            sourceUrl: revenueSourceUrl.trim().slice(0, 500) || null,
            note: clampText(revenueNote, NOTE_MAX) || null,
          }
        : null;
    const brands = holdingBrands
      .split(",")
      .map((b) => clampText(b, 200))
      .filter((b) => b.length > 0)
      .slice(0, 24);
    const holdingStructure =
      isHoldingCompany || isMultiBrand || brands.length > 0 || holdingNote.trim()
        ? {
            isHoldingCompany,
            isMultiBrand: isMultiBrand || brands.length > 1,
            brands,
            note: clampText(holdingNote, NOTE_MAX) || null,
          }
        : null;
    const cleanCountryPresence = countryPresence
      .map((c) => ({
        country: clampText(c.country, LOCATION_MAX),
        role: (c.role || null) as "hq" | "subsidiary" | "branch" | "office" | null,
        note: clampText(c.note, NOTE_MAX) || null,
      }))
      .filter((c) => c.country.length > 0)
      .slice(0, 40);

    try {
      await update.mutateAsync({
        accountId,
        data: {
          employeeCount: employees,
          // Only personas with financial authority may write the revenue; for
          // everyone else we omit the key entirely (PATCH semantics) so the
          // existing figure is preserved rather than wiped to null.
          ...(canEditFinancials ? { annualRevenue } : {}),
          holdingStructure,
          countryPresence: cleanCountryPresence,
          entityRole: entityRole || null,
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      toast({
        title: "Company details saved",
        description: "Changes recorded in the audit trail.",
      });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Could not save company details",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[720px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto"
        data-testid="dialog-edit-account-profile"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Edit company details</DialogTitle>
          <DialogDescription className="text-text-mute">
            Correct firmographics for{" "}
            <span className="font-mono text-text">{account.brandName ?? account.name}</span> when
            research goes stale. Leave figures blank if unknown — nothing is fabricated. Edits are
            audit-logged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5 py-3">
          <RevenueProfileFields
            canEditFinancials={canEditFinancials}
            employeeCount={employeeCount}
            setEmployeeCount={setEmployeeCount}
            revenueAmount={revenueAmount}
            setRevenueAmount={setRevenueAmount}
            revenueCurrency={revenueCurrency}
            setRevenueCurrency={setRevenueCurrency}
            revenueAsOf={revenueAsOf}
            setRevenueAsOf={setRevenueAsOf}
            revenueSourceUrl={revenueSourceUrl}
            setRevenueSourceUrl={setRevenueSourceUrl}
            revenueNote={revenueNote}
            setRevenueNote={setRevenueNote}
          />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Entity role">
              <select
                value={entityRole}
                onChange={(e) => setEntityRole(e.target.value as EntityRole)}
                className={selectCls}
                data-testid="select-edit-account-entity-role"
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
                    checked={isHoldingCompany}
                    onChange={(e) => setIsHoldingCompany(e.target.checked)}
                    data-testid="checkbox-edit-account-holding"
                  />
                  Holding company
                </label>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={isMultiBrand}
                    onChange={(e) => setIsMultiBrand(e.target.checked)}
                    data-testid="checkbox-edit-account-multibrand"
                  />
                  Multi-brand
                </label>
              </div>
            </Field>
          </div>

          <Field label="Operating brands (comma-separated)">
            <Input
              value={holdingBrands}
              onChange={(e) => setHoldingBrands(e.target.value)}
              className="bg-bg-deep border-border text-text"
              placeholder="e.g. Brand A, Brand B, Brand C"
              maxLength={600}
              data-testid="input-edit-account-brands"
            />
          </Field>

          <Field label="Group structure note">
            <Input
              value={holdingNote}
              onChange={(e) => setHoldingNote(e.target.value)}
              className="bg-bg-deep border-border text-text"
              placeholder="Context on the holding / multi-brand setup"
              maxLength={NOTE_MAX}
              data-testid="input-edit-account-holding-note"
            />
          </Field>

          <Field
            label={`Country presence${countryPresence.length ? ` (${countryPresence.length})` : ""}`}
          >
            <p className="text-xs text-text-mute -mt-0.5 mb-1">
              Markets where the firm operates, tagged by role. Helps with the HQ-vs-branch question.
            </p>
            <div className="grid gap-2" data-testid="edit-country-presence-editor">
              {countryPresence.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  data-testid={`edit-country-presence-row-${i}`}
                >
                  <Input
                    value={c.country}
                    onChange={(e) =>
                      setCountryPresence((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)),
                      )
                    }
                    placeholder="Country"
                    className="bg-bg-deep border-border text-text flex-1"
                    data-testid={`input-edit-country-presence-country-${i}`}
                  />
                  <select
                    value={c.role}
                    onChange={(e) =>
                      setCountryPresence((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)),
                      )
                    }
                    className={selectCls}
                    data-testid={`select-edit-country-presence-role-${i}`}
                  >
                    <option value="">— role —</option>
                    <option value="hq">HQ</option>
                    <option value="subsidiary">Subsidiary</option>
                    <option value="branch">Branch</option>
                    <option value="office">Office</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setCountryPresence((prev) => prev.filter((_, j) => j !== i))}
                    className="text-text-mute hover:text-danger px-1"
                    aria-label={`Remove ${c.country || "country"}`}
                    data-testid={`button-remove-edit-country-presence-${i}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <PillButton
                type="button"
                variant="ghost"
                onClick={() =>
                  setCountryPresence((prev) => [...prev, { country: "", role: "", note: "" }])
                }
                data-testid="button-add-edit-country-presence"
              >
                + Add country
              </PillButton>
            </div>
          </Field>

          <div className="flex justify-end gap-3 pt-3 border-t border-border-soft">
            <PillButton variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              type="submit"
              disabled={update.isPending}
              data-testid="button-submit-edit-account-profile"
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Task #613 — the revenue-gated portion of the firmographics form, extracted
 * as a pure presentational component so the financial-authority gate is unit
 * testable in isolation (no Dialog portal / react-query providers needed).
 *
 * When `canEditFinancials` is false the revenue inputs are NOT rendered at all
 * and a "restricted" note (data-testid="text-revenue-edit-restricted") takes
 * their place — mirroring the server-side 403 gate so a persona without
 * financial authority can neither see nor silently overwrite the figure.
 */
type SetStr = React.Dispatch<React.SetStateAction<string>>;
export function RevenueProfileFields({
  canEditFinancials,
  employeeCount,
  setEmployeeCount,
  revenueAmount,
  setRevenueAmount,
  revenueCurrency,
  setRevenueCurrency,
  revenueAsOf,
  setRevenueAsOf,
  revenueSourceUrl,
  setRevenueSourceUrl,
  revenueNote,
  setRevenueNote,
}: {
  canEditFinancials: boolean;
  employeeCount: string;
  setEmployeeCount: SetStr;
  revenueAmount: string;
  setRevenueAmount: SetStr;
  revenueCurrency: string;
  setRevenueCurrency: SetStr;
  revenueAsOf: string;
  setRevenueAsOf: SetStr;
  revenueSourceUrl: string;
  setRevenueSourceUrl: SetStr;
  revenueNote: string;
  setRevenueNote: SetStr;
}) {
  return (
    <>
      <div className={canEditFinancials ? "grid grid-cols-3 gap-4" : "grid grid-cols-1 gap-4"}>
        <Field label="Employees">
          <Input
            type="number"
            min={0}
            value={employeeCount}
            onChange={(e) => setEmployeeCount(e.target.value)}
            className="bg-bg-deep border-border text-text font-mono"
            placeholder="e.g. 4500"
            data-testid="input-edit-account-employees"
          />
        </Field>
        {canEditFinancials && (
          <>
            <Field label="Annual revenue">
              <Input
                type="number"
                min={0}
                value={revenueAmount}
                onChange={(e) => setRevenueAmount(e.target.value)}
                className="bg-bg-deep border-border text-text font-mono"
                placeholder="amount"
                data-testid="input-edit-account-revenue-amount"
              />
            </Field>
            <Field label="Revenue currency">
              <select
                value={revenueCurrency}
                onChange={(e) => setRevenueCurrency(e.target.value)}
                className={`${selectCls} font-mono`}
                data-testid="select-edit-account-revenue-currency"
              >
                {Array.from(
                  new Set([...CURRENCIES, ...(revenueCurrency ? [revenueCurrency] : [])]),
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>

      {canEditFinancials ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Revenue as-of">
              <Input
                value={revenueAsOf}
                onChange={(e) => setRevenueAsOf(e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="e.g. FY2024"
                maxLength={LOCATION_MAX}
                data-testid="input-edit-account-revenue-asof"
              />
            </Field>
            <Field label="Revenue source URL">
              <Input
                value={revenueSourceUrl}
                onChange={(e) => setRevenueSourceUrl(e.target.value)}
                className="bg-bg-deep border-border text-text"
                placeholder="https://…"
                maxLength={500}
                data-testid="input-edit-account-revenue-source"
              />
            </Field>
          </div>

          <Field label="Revenue / financials note">
            <Input
              value={revenueNote}
              onChange={(e) => setRevenueNote(e.target.value)}
              className="bg-bg-deep border-border text-text"
              placeholder="Key financials context (no fabricated figures)"
              maxLength={NOTE_MAX}
              data-testid="input-edit-account-revenue-note"
            />
          </Field>
        </>
      ) : (
        <p
          className="text-xs text-text-mute italic -mt-1"
          data-testid="text-revenue-edit-restricted"
        >
          Annual revenue is restricted — you don't have financial authority on
          this account, so the revenue figure can't be edited here.
        </p>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs uppercase tracking-widest font-mono text-text-faint">{label}</Label>
      {children}
    </div>
  );
}
