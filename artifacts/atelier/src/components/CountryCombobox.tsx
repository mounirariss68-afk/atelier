import * as React from "react";
import { Check, ChevronsUpDown, Globe } from "lucide-react";
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
import { COUNTRIES, countryName, scoreCountry } from "@/lib/countries";

/**
 * Task #509 (T4) — searchable all-countries dropdown for the HR module.
 *
 * Stores the ISO alpha-2 code (via `value` / `onChange`) and always shows the
 * full country name. Backed by the shared `countries.ts` util so any country
 * can be picked for nationality / location / employing-entity country.
 */
export function CountryCombobox({
  value,
  onChange,
  placeholder = "Select country…",
  disabled,
  className,
  testIdPrefix,
  allowClear,
}: {
  value: string | null | undefined;
  onChange: (nextIso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testIdPrefix?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const label = value ? countryName(value) : "";

  const filter = React.useCallback((itemKey: string, search: string): number => {
    const row = COUNTRIES.find((c) => c.code === itemKey);
    return row ? scoreCountry(row, search) : 0;
  }, []);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testIdPrefix ? `${testIdPrefix}-trigger` : undefined}
          className={cn(
            "flex items-center gap-2 bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-xs",
            "w-full justify-between hover:border-gold/40 focus:outline-none focus:ring-1 focus:ring-gold/40",
            disabled && "opacity-60 cursor-not-allowed",
            !label && "text-text-faint",
            className,
          )}
        >
          <span className="inline-flex items-center gap-2 truncate">
            <Globe className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="truncate">{label || placeholder}</span>
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 bg-bg-elevate border-gold/30"
        align="start"
      >
        <Command filter={filter}>
          <CommandInput placeholder="Search countries…" />
          <CommandList>
            <CommandEmpty>
              <div className="px-3 py-4 text-xs text-text-mute">No matches.</div>
            </CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem
                  value=""
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="cursor-pointer text-text-faint"
                >
                  <Check className="mr-1 h-3 w-3 opacity-0" />
                  Clear
                </CommandItem>
              )}
              {COUNTRIES.map((c) => {
                const isSelected = c.code === (value ?? "").toUpperCase();
                return (
                  <CommandItem
                    key={c.code}
                    value={c.code}
                    onSelect={() => {
                      onChange(c.code);
                      setOpen(false);
                    }}
                    data-testid={testIdPrefix ? `${testIdPrefix}-item-${c.code}` : undefined}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-1 h-3 w-3 shrink-0",
                        isSelected ? "opacity-100 text-gold" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto font-mono text-[10px] uppercase text-text-faint">
                      {c.code}
                    </span>
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
