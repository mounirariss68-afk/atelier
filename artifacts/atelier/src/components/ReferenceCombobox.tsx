import * as React from "react";
import { Check, ChevronsUpDown, Globe, Building2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  localizedCountryName,
  localizedIndustryName,
  scoreCountryMatch,
  scoreIndustryMatch,
  scoreSubIndustryMatch,
  sortCountries,
  sortIndustries,
  sortSubIndustries,
  type CountryRow,
  type IndustryRow,
  type ReferenceBootstrap,
  type ReferenceLocale,
  type SubIndustryRow,
} from "@/lib/reference-data";

// =============================================================
// Bootstrap fetch — single GET cached in module scope (patch §3.3).
// =============================================================
let bootstrapPromise: Promise<ReferenceBootstrap> | null = null;
const subscribers = new Set<(b: ReferenceBootstrap) => void>();
let cachedBootstrap: ReferenceBootstrap | null = null;

async function fetchBootstrap(): Promise<ReferenceBootstrap> {
  const res = await fetch("/api/atelier/reference/bootstrap", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`reference bootstrap failed: ${res.status}`);
  const data = (await res.json()) as ReferenceBootstrap;
  cachedBootstrap = data;
  for (const cb of subscribers) cb(data);
  return data;
}

export function invalidateReferenceBootstrap() {
  bootstrapPromise = null;
  cachedBootstrap = null;
}

export function useReferenceBootstrap(enabled: boolean = true): {
  data: ReferenceBootstrap | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = React.useState<ReferenceBootstrap | null>(cachedBootstrap);
  const [loading, setLoading] = React.useState(!cachedBootstrap);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    // Task #444 — allow callers (e.g. the app-wide CreateAccountDialog) to
    // defer the fetch until they're actually visible, so personas without
    // access to /reference/bootstrap don't fire guaranteed-403 requests.
    if (!enabled) return;
    let mounted = true;
    if (cachedBootstrap) {
      setData(cachedBootstrap);
      setLoading(false);
      return;
    }
    if (!bootstrapPromise) bootstrapPromise = fetchBootstrap();
    bootstrapPromise
      .then((b) => {
        if (!mounted) return;
        setData(b);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err);
        setLoading(false);
        bootstrapPromise = null;
      });
    const sub = (b: ReferenceBootstrap) => mounted && setData(b);
    subscribers.add(sub);
    return () => {
      mounted = false;
      subscribers.delete(sub);
    };
  }, [enabled]);

  const refetch = React.useCallback(async () => {
    invalidateReferenceBootstrap();
    bootstrapPromise = fetchBootstrap();
    const fresh = await bootstrapPromise;
    setData(fresh);
  }, []);

  return { data, loading, error, refetch };
}

// =============================================================
// Component
// =============================================================
export type ReferenceComboboxKind = "country" | "industry" | "sub_industry";

export interface ReferenceComboboxProps {
  kind: ReferenceComboboxKind;
  /**
   * Selected value:
   *   - kind="country"      → ISO-alpha-2 code OR display name (controlled by `valueMode`)
   *   - kind="industry"     → industry code (e.g. "HPS") OR display name
   *   - kind="sub_industry" → sub-industry code (e.g. "HPS_FED") OR display name
   */
  value: string;
  onChange: (next: string) => void;
  /** "code" stores the canonical PK; "display" stores the EN display name (used for pre-FK-migration text columns). */
  valueMode?: "code" | "display";
  /** For sub_industry — restrict to a specific parent (industry code). */
  parentIndustry?: string;
  allowDeprecated?: boolean;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  required?: boolean;
  locale?: ReferenceLocale;
  className?: string;
  testIdPrefix?: string;
  /**
   * When true (default), the combobox refuses any value that does not match a
   * canonical reference row — no synthetic "Add X" rows, no free-text fallback.
   * Set to false only if a caller deliberately needs to accept ad-hoc text
   * (currently no such caller exists; the lookup is closed by design).
   */
  disableFreeText?: boolean;
}

const SIZE_CLS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-8 px-2 text-xs",
  md: "h-9 px-3 text-sm",
  lg: "h-10 px-3 text-sm",
};

export function ReferenceCombobox({
  kind,
  value,
  onChange,
  valueMode = "code",
  parentIndustry,
  allowDeprecated = false,
  placeholder,
  size = "md",
  disabled,
  required,
  locale = "en",
  className,
  testIdPrefix,
  disableFreeText = true,
}: ReferenceComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const { data, loading, error } = useReferenceBootstrap();

  const { items, label } = React.useMemo(() => {
    if (!data) return { items: [] as Array<{ key: string; display: string; node: React.ReactNode; row: CountryRow | IndustryRow | SubIndustryRow }>, label: "" };
    if (kind === "country") {
      const all = allowDeprecated ? data.countries : data.countries.filter((c) => c.status === "active");
      const sorted = sortCountries(all);
      const items = sorted.map((c) => {
        const display = localizedCountryName(c, locale);
        return {
          key: c.isoAlpha2,
          display,
          row: c,
          node: (
            <div className="flex items-center gap-2 w-full" dir={locale === "ar" ? "rtl" : "ltr"}>
              {c.flagEmoji && <span aria-hidden>{c.flagEmoji}</span>}
              <span className="truncate">{display}</span>
              <span className="ml-auto font-mono text-[10px] uppercase text-text-faint">{c.isoAlpha2}</span>
              {c.isGcc && <span className="font-mono text-[9px] text-gold">GCC</span>}
            </div>
          ),
        };
      });
      const selectedRow =
        valueMode === "code"
          ? data.countries.find((c) => c.isoAlpha2 === value)
          : data.countries.find((c) => localizedCountryName(c, locale) === value || c.displayNameEn === value);
      return {
        items,
        label: selectedRow
          ? `${selectedRow.flagEmoji ?? ""} ${localizedCountryName(selectedRow, locale)}`.trim()
          : "",
      };
    }
    if (kind === "industry") {
      const all = allowDeprecated ? data.industries : data.industries.filter((i) => i.status === "active");
      const sorted = sortIndustries(all);
      const items = sorted.map((i) => {
        const display = localizedIndustryName(i, locale);
        return {
          key: i.code,
          display,
          row: i,
          node: (
            <div className="flex items-start gap-2 w-full">
              <span className="font-mono text-[10px] uppercase text-gold border border-gold/40 rounded px-1 py-[1px] mt-[2px]">{i.code}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{display}</div>
                {i.shortDescription && (
                  <div className="text-[10px] text-text-faint truncate">{i.shortDescription}</div>
                )}
              </div>
            </div>
          ),
        };
      });
      const selectedRow =
        valueMode === "code"
          ? data.industries.find((i) => i.code === value)
          : data.industries.find((i) => localizedIndustryName(i, locale) === value || i.displayNameEn === value);
      return { items, label: selectedRow ? localizedIndustryName(selectedRow, locale) : "" };
    }
    // sub_industry
    let all = allowDeprecated ? data.subIndustries : data.subIndustries.filter((s) => s.status === "active");
    if (parentIndustry) all = all.filter((s) => s.industryCode === parentIndustry);
    const sorted = sortSubIndustries(all);
    const items = sorted.map((s) => {
      const display = localizedIndustryName(s, locale);
      return {
        key: s.code,
        display,
        row: s,
        node: (
          <div className="flex items-center gap-2 w-full">
            <span className="font-mono text-[10px] uppercase text-text-faint border border-border rounded px-1 py-[1px]">{s.industryCode}</span>
            <span className="truncate">{display}</span>
          </div>
        ),
      };
    });
    const selectedRow =
      valueMode === "code"
        ? data.subIndustries.find((s) => s.code === value)
        : data.subIndustries.find((s) => localizedIndustryName(s, locale) === value || s.displayNameEn === value);
    return { items, label: selectedRow ? localizedIndustryName(selectedRow, locale) : "" };
  }, [data, kind, allowDeprecated, parentIndustry, value, valueMode, locale]);

  // cmdk filter — scoring helpers gate visibility. When disableFreeText
  // is true (default) we never render synthetic "Add X" rows; an empty
  // result set just shows CommandEmpty.
  const filter = React.useCallback(
    (itemKey: string, search: string): number => {
      if (!data) return 0;
      const q = search ?? "";
      if (kind === "country") {
        const row = data.countries.find((c) => c.isoAlpha2 === itemKey);
        const score = row ? scoreCountryMatch(row, q) : 0;
        return disableFreeText ? score : Math.max(score, q ? 0.001 : 0);
      }
      if (kind === "industry") {
        const row = data.industries.find((i) => i.code === itemKey);
        const score = row ? scoreIndustryMatch(row, q) : 0;
        return disableFreeText ? score : Math.max(score, q ? 0.001 : 0);
      }
      const row = data.subIndustries.find((s) => s.code === itemKey);
      const score = row ? scoreSubIndustryMatch(row, q) : 0;
      return disableFreeText ? score : Math.max(score, q ? 0.001 : 0);
    },
    [data, kind, disableFreeText],
  );

  const Icon = kind === "country" ? Globe : Building2;

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-required={required}
          disabled={disabled || loading || !!error}
          data-testid={testIdPrefix ? `${testIdPrefix}-trigger` : undefined}
          className={cn(
            "flex items-center gap-2 bg-bg-deep border border-border rounded text-text",
            SIZE_CLS[size],
            "w-full justify-between hover:border-gold/40 focus:outline-none focus:ring-1 focus:ring-gold/40",
            disabled && "opacity-60 cursor-not-allowed",
            !label && "text-text-faint",
            className,
          )}
        >
          <span className="inline-flex items-center gap-2 truncate">
            <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {loading
                ? "Loading…"
                : error
                ? "Lookup unavailable"
                : label || placeholder || "Select…"}
            </span>
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 bg-bg-elevate border-gold/30"
        align="start"
      >
        <Command filter={filter}>
          <CommandInput placeholder={placeholder ?? "Search…"} />
          <CommandList>
            <CommandEmpty>
              <div className="px-3 py-4 text-xs text-text-mute">
                No matches. Free-text entries are disabled.
              </div>
            </CommandEmpty>
            <CommandGroup>
              {items.map((it) => {
                const isSelected =
                  valueMode === "code"
                    ? it.key === value
                    : it.display === value ||
                      (kind === "country" &&
                        (it.row as CountryRow).displayNameEn === value) ||
                      ((kind === "industry" || kind === "sub_industry") &&
                        (it.row as IndustryRow | SubIndustryRow).displayNameEn === value);
                return (
                  <CommandItem
                    key={it.key}
                    value={it.key}
                    onSelect={() => {
                      const next =
                        valueMode === "code"
                          ? it.key
                          : kind === "country"
                          ? (it.row as CountryRow).displayNameEn
                          : (it.row as IndustryRow | SubIndustryRow).displayNameEn;
                      onChange(next);
                      setOpen(false);
                    }}
                    data-testid={
                      testIdPrefix ? `${testIdPrefix}-item-${it.key}` : undefined
                    }
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-1 h-3 w-3 shrink-0",
                        isSelected ? "opacity-100 text-gold" : "opacity-0",
                      )}
                    />
                    {it.node}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
