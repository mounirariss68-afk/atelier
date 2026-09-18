import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useAtelierListPartnerFirms, getAtelierListPartnerFirmsQueryKey } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PillButton } from "@/components/ui/primitives";
import { canEditPartnerAssociations } from "@/lib/lens";

type Firm = { id: string; name: string };

/** Selects canonical co-sell associations only, never economics or portal grants. */
export function OpportunityPartnerPicker({
  value, onChange, retained = [], dialogOpen, role, disabled = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  retained?: Firm[];
  dialogOpen: boolean;
  role?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const allowed = canEditPartnerAssociations(role);
  const firms = useAtelierListPartnerFirms({
    query: {
      queryKey: getAtelierListPartnerFirmsQueryKey(),
      enabled: dialogOpen && allowed,
      staleTime: 30_000,
    },
  });
  if (!allowed) return null;
  const choices = [...(firms.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map([...retained, ...choices].map((f) => [f.id, f.name]));
  return (
    <div className="space-y-2" data-testid="field-opportunity-partners">
      <label htmlFor="opportunity-partners" className="text-[11px] uppercase tracking-widest font-mono text-text-faint">
        External partner firms <span className="normal-case tracking-normal">(optional)</span>
      </label>
      <Popover open={open && dialogOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id="opportunity-partners"
            type="button"
            role="combobox"
            aria-expanded={open && dialogOpen}
            disabled={disabled || firms.isLoading || firms.isError}
            className="w-full flex items-center justify-between rounded border border-border bg-bg-deep px-3 py-2 text-sm text-text disabled:opacity-50"
            data-testid="select-opportunity-partners"
          >
            {firms.isLoading ? "Loading partner firms…" : value.length ? `${value.length} partner firm${value.length === 1 ? "" : "s"} selected` : "Search partner firms…"}
            <ChevronsUpDown className="h-4 w-4 text-text-faint" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0 w-[--radix-popover-trigger-width] bg-bg-elevate border-border">
          <Command>
            <CommandInput placeholder="Search partner firms…" data-testid="input-opportunity-partner-search" />
            <CommandList>
              <CommandEmpty>No registered partner firms match.</CommandEmpty>
              <CommandGroup>
                {choices.map((firm) => (
                  <CommandItem
                    key={firm.id}
                    disabled={disabled}
                    value={`${firm.name} ${firm.id}`}
                    onSelect={() => onChange(value.includes(firm.id) ? value.filter((id) => id !== firm.id) : [...value, firm.id])}
                    data-testid={`option-opportunity-partner-${firm.id}`}
                  >
                    <Check className={`mr-2 h-4 w-4 ${value.includes(firm.id) ? "text-gold" : "opacity-0"}`} />
                    {firm.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {firms.isError && (
        <div role="alert" className="text-xs text-danger" data-testid="error-partner-picker">
          Could not load partner firms. Existing selections are preserved.
          <PillButton type="button" variant="ghost" onClick={() => void firms.refetch()} data-testid="button-retry-partner-picker">Retry</PillButton>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border-soft px-2 py-1 text-xs text-text-mute" data-testid={`tag-selected-partner-${id}`}>
            {names.get(id) ?? "Unavailable partner"}
            {firms.isSuccess && !choices.some((f) => f.id === id) && <span className="text-text-faint"> · unavailable</span>}
            <button type="button" disabled={disabled} onClick={() => onChange(value.filter((selected) => selected !== id))}
              aria-label={`Remove ${names.get(id) ?? "unavailable partner"}`} data-testid={`button-remove-partner-${id}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-text-faint">Separate from the internal owner. Tagging does not grant portal access or set revenue-sharing terms.</p>
    </div>
  );
}

export function OpportunityPartnerTags({ firms }: { firms?: Firm[] }) {
  if (!firms?.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5" data-testid="tags-opportunity-partners">
      {firms.map((firm) => (
        <span key={firm.id} className="inline-flex rounded-full border border-border-soft px-2 py-0.5 text-[11px] text-text-mute" data-testid={`tag-partner-${firm.id}`}>
          {firm.name}
        </span>
      ))}
    </span>
  );
}