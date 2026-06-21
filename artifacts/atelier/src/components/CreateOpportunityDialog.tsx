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
import { fieldControlCls } from "./ui/fieldControls";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateOpportunity,
  useAtelierListAccounts,
  useAtelierListUsers,
  useAtelierGetMe,
  getAtelierListOpportunitiesQueryKey,
  getAtelierListAccountsQueryKey,
  getAtelierListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Telescope, ChevronsUpDown, Check, Plus } from "lucide-react";
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
  CommandSeparator,
} from "@/components/ui/command";

interface Props {
  trigger: React.ReactNode;
}

type FormState = {
  // Basics
  name: string;
  description: string;
  // Account
  accountMode: "existing" | "new";
  accountId: string;
  newAccountName: string;
  newAccountCountry: string;
  newAccountSector: string;
  newAccountTier: "" | "A" | "B" | "C" | "D";
  // Owners
  partnerOwnerId: string;
  engagementLeadId: string;
  // Deal context
  sourceLead: "inbound" | "referral" | "outbound" | "existing_client" | "event" | "manual";
  dealSizeUsd: string;
  probabilityPct: string;
  nextMilestone: string;
  nextMilestoneDate: string;
  // Scout
  runScout: boolean;
  scoutFocus: string;
};

const SOURCE_OPTIONS: { value: FormState["sourceLead"]; label: string }[] = [
  { value: "inbound", label: "Inbound" },
  { value: "referral", label: "Referral" },
  { value: "outbound", label: "Outbound" },
  { value: "existing_client", label: "Existing client" },
  { value: "event", label: "Event" },
  { value: "manual", label: "Other / manual" },
];

const inputCls =
  `${fieldControlCls} bg-bg-deep border border-border rounded py-2 text-sm text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/40`;
const selectCls =
  `${fieldControlCls} bg-bg-deep border border-border rounded py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/40`;
const labelCls =
  "text-[11px] uppercase tracking-widest font-mono text-text-faint";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border-soft pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-xs font-mono uppercase tracking-widest text-gold">
          {title}
        </h3>
        {hint && (
          <p className="text-xs text-text-faint mt-1">{hint}</p>
        )}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function FieldError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <p className="text-[11px] text-danger mt-1">{msg}</p>;
}

export function CreateOpportunityDialog({ trigger }: Props) {
  const [open, setOpen] = React.useState(false);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useAtelierCreateOpportunity();
  const { data: accounts } = useAtelierListAccounts(undefined, {
    query: {
      enabled: open,
      queryKey: getAtelierListAccountsQueryKey(),
    },
  });
  const { data: users } = useAtelierListUsers({
    query: {
      enabled: open,
      queryKey: getAtelierListUsersQueryKey(),
    },
  });
  const { data: me } = useAtelierGetMe();

  const initial: FormState = React.useMemo(
    () => ({
      name: "",
      description: "",
      accountMode: "existing",
      accountId: "",
      newAccountName: "",
      newAccountCountry: "Türkiye",
      newAccountSector: "",
      newAccountTier: "",
      partnerOwnerId: me?.id ?? "",
      engagementLeadId: me?.id ?? "",
      sourceLead: "inbound",
      dealSizeUsd: "250000",
      probabilityPct: "25",
      nextMilestone: "",
      nextMilestoneDate: "",
      runScout: true,
      scoutFocus: "",
    }),
    [me?.id],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [accountPickerOpen, setAccountPickerOpen] = React.useState(false);

  // Re-seed owner defaults once persona data loads.
  React.useEffect(() => {
    if (!open) return;
    setForm((f) => ({
      ...f,
      partnerOwnerId: f.partnerOwnerId || me?.id || "",
      engagementLeadId: f.engagementLeadId || me?.id || "",
    }));
  }, [open, me?.id]);

  // Reset on close.
  React.useEffect(() => {
    if (!open) {
      setForm(initial);
      setErrors({});
    }
  }, [open, initial]);

  const sortedAccounts = React.useMemo(() => {
    return [...(accounts ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [accounts]);

  const sortedUsers = React.useMemo(() => {
    return [...(users ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
    if (errors[key as string]) {
      setErrors((e) => {
        const { [key as string]: _drop, ...rest } = e;
        return rest;
      });
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Opportunity name is required.";
    if (!form.description.trim())
      next.description =
        "Describe what we're pursuing — Pursuit Scout reads this first.";
    if (form.accountMode === "existing") {
      if (!form.accountId) next.accountId = "Pick an account.";
    } else {
      if (!form.newAccountName.trim())
        next.newAccountName = "Account name is required.";
      if (!form.newAccountCountry.trim())
        next.newAccountCountry = "Country is required.";
      if (!form.newAccountSector.trim())
        next.newAccountSector = "Sector is required.";
    }
    if (!form.partnerOwnerId) next.partnerOwnerId = "Pick a partner owner.";
    if (!form.engagementLeadId)
      next.engagementLeadId = "Pick an engagement lead.";
    const prob = Number(form.probabilityPct);
    if (form.probabilityPct !== "" && (Number.isNaN(prob) || prob < 0 || prob > 100))
      next.probabilityPct = "Use a percentage between 0 and 100.";
    const deal = Number(form.dealSizeUsd);
    if (form.dealSizeUsd !== "" && (Number.isNaN(deal) || deal < 0))
      next.dealSizeUsd = "Deal size must be a positive number.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const payload =
      form.accountMode === "existing"
        ? {
            accountId: form.accountId,
          }
        : {
            accountName: form.newAccountName.trim(),
            accountCountry: form.newAccountCountry.trim(),
            accountSector: form.newAccountSector.trim(),
            accountTier: form.newAccountTier || undefined,
          };

    const partnerName =
      sortedUsers.find((u) => u.id === form.partnerOwnerId)?.name ?? "owner";

    try {
      const res = await create.mutateAsync({
        data: {
          name: form.name.trim(),
          description: form.description.trim(),
          ...payload,
          partnerOwnerId: form.partnerOwnerId,
          engagementLeadId: form.engagementLeadId,
          sourceLead: form.sourceLead,
          dealSizeUsd: form.dealSizeUsd ? Number(form.dealSizeUsd) : undefined,
          probabilityPct: form.probabilityPct
            ? Number(form.probabilityPct)
            : undefined,
          nextMilestone: form.nextMilestone.trim() || undefined,
          nextMilestoneDate: form.nextMilestoneDate || undefined,
          runScout: form.runScout,
          scoutFocus: form.scoutFocus.trim() || undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      toast({
        title: `Opportunity created · ${partnerName} owns it`,
        description: form.runScout
          ? "Pursuit Scout is drafting the brief — find it on the Brief tab and the 5C Qualifier."
          : "Pipeline updated. Run Pursuit Scout from the Brief tab when ready.",
      });
      setOpen(false);
      setLocation(`/pipeline/${res.opportunity.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create opportunity.";
      toast({
        title: "Could not create opportunity",
        description: msg,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[720px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            New opportunity
          </DialogTitle>
          <DialogDescription className="text-text-mute">
            Capture the account, owners, and deal context up-front so Pursuit
            Scout has something to anchor on. Lands in{" "}
            <span className="font-mono text-gold">identify</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-6 py-2">
          {/* ───────────── Basics ───────────── */}
          <Section title="Basics">
            <div className="grid gap-1.5">
              <Label htmlFor="o-name" className={labelCls}>
                Opportunity name *
              </Label>
              <Input
                id="o-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className={inputCls}
                placeholder="e.g. Tasama — AI pricing diagnostic"
                autoFocus
                data-testid="input-opp-name"
              />
              <FieldError msg={errors.name} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="o-desc" className={labelCls}>
                Description / what we're pursuing *
              </Label>
              <Textarea
                id="o-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className={`${inputCls} min-h-[96px]`}
                placeholder="What's the pursuit, what outcome do they want, why us, what do we know already…"
                data-testid="input-opp-description"
              />
              <p className="text-[11px] text-text-faint">
                This is what Pursuit Scout reads first. Be concrete: the more
                context here, the sharper the brief.
              </p>
              <FieldError msg={errors.description} />
            </div>
          </Section>

          {/* ───────────── Account ───────────── */}
          <Section
            title="Account"
            hint="Pick the client this opportunity belongs to, or create one if it's net-new."
          >
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => set("accountMode", "existing")}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest rounded border transition-colors ${
                  form.accountMode === "existing"
                    ? "bg-gold/10 border-gold/60 text-gold"
                    : "bg-transparent border-border text-text-mute hover:text-text"
                }`}
                data-testid="btn-account-existing"
              >
                Existing account
              </button>
              <button
                type="button"
                onClick={() => set("accountMode", "new")}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest rounded border transition-colors ${
                  form.accountMode === "new"
                    ? "bg-gold/10 border-gold/60 text-gold"
                    : "bg-transparent border-border text-text-mute hover:text-text"
                }`}
                data-testid="btn-account-new"
              >
                Create new account…
              </button>
            </div>

            {form.accountMode === "existing" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="o-account" className={labelCls}>
                  Account *
                </Label>
                {(() => {
                  const selected = sortedAccounts.find(
                    (a) => a.id === form.accountId,
                  );
                  return (
                    <Popover
                      open={accountPickerOpen}
                      onOpenChange={setAccountPickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          id="o-account"
                          role="combobox"
                          aria-expanded={accountPickerOpen}
                          className={`${selectCls} flex items-center justify-between text-left`}
                          data-testid="select-account"
                        >
                          <span
                            className={
                              selected ? "text-text" : "text-text-faint"
                            }
                          >
                            {selected
                              ? `${selected.name} · ${selected.country} · ${selected.sector}`
                              : "Search accounts…"}
                          </span>
                          <ChevronsUpDown className="w-4 h-4 text-text-faint shrink-0 ml-2" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="p-0 w-[--radix-popover-trigger-width] bg-bg-elevate border-border"
                      >
                        <Command
                          filter={(value, search) => {
                            if (value === "__create_new__") return 1;
                            return value
                              .toLowerCase()
                              .includes(search.toLowerCase())
                              ? 1
                              : 0;
                          }}
                        >
                          <CommandInput
                            placeholder="Search by name, country, sector…"
                            data-testid="input-account-search"
                          />
                          <CommandList>
                            <CommandEmpty>No accounts match.</CommandEmpty>
                            <CommandGroup heading="Accounts">
                              {sortedAccounts.map((a) => {
                                const haystack = `${a.name} ${a.country} ${a.sector}`;
                                return (
                                  <CommandItem
                                    key={a.id}
                                    value={haystack}
                                    onSelect={() => {
                                      set("accountId", a.id);
                                      setAccountPickerOpen(false);
                                    }}
                                    data-testid={`option-account-${a.id}`}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        form.accountId === a.id
                                          ? "opacity-100 text-gold"
                                          : "opacity-0"
                                      }`}
                                    />
                                    <span className="flex-1 truncate">
                                      {a.name}
                                    </span>
                                    <span className="text-xs text-text-faint ml-2">
                                      {a.country} · {a.sector}
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup>
                              <CommandItem
                                value="__create_new__"
                                onSelect={() => {
                                  set("accountMode", "new");
                                  setAccountPickerOpen(false);
                                }}
                                data-testid="option-account-create-new"
                                className="text-gold"
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Create new account…
                              </CommandItem>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  );
                })()}
                <FieldError msg={errors.accountId} />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="o-acct-name" className={labelCls}>
                    Account name *
                  </Label>
                  <Input
                    id="o-acct-name"
                    value={form.newAccountName}
                    onChange={(e) => set("newAccountName", e.target.value)}
                    className={inputCls}
                    placeholder="e.g. Aldrees Petroleum"
                    data-testid="input-new-account-name"
                  />
                  <FieldError msg={errors.newAccountName} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="o-acct-country" className={labelCls}>
                    Country *
                  </Label>
                  <Input
                    id="o-acct-country"
                    value={form.newAccountCountry}
                    onChange={(e) => set("newAccountCountry", e.target.value)}
                    className={inputCls}
                    placeholder="KSA"
                  />
                  <FieldError msg={errors.newAccountCountry} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="o-acct-sector" className={labelCls}>
                    Sector *
                  </Label>
                  <Input
                    id="o-acct-sector"
                    value={form.newAccountSector}
                    onChange={(e) => set("newAccountSector", e.target.value)}
                    className={inputCls}
                    placeholder="Retail Energy / Logistics"
                  />
                  <FieldError msg={errors.newAccountSector} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="o-acct-tier" className={labelCls}>
                    Tier
                  </Label>
                  <select
                    id="o-acct-tier"
                    value={form.newAccountTier}
                    onChange={(e) =>
                      set(
                        "newAccountTier",
                        e.target.value as FormState["newAccountTier"],
                      )
                    }
                    className={selectCls}
                  >
                    <option value="">Unset</option>
                    <option value="A">A · Marquee</option>
                    <option value="B">B · Active</option>
                    <option value="C">C · Watch</option>
                    <option value="D">D · Dormant</option>
                  </select>
                </div>
              </div>
            )}
          </Section>

          {/* ───────────── Owners ───────────── */}
          <Section
            title="Owners"
            hint="Both default to you. Change if a different partner or lead actually owns this."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="o-partner" className={labelCls}>
                  Partner owner *
                </Label>
                <select
                  id="o-partner"
                  value={form.partnerOwnerId}
                  onChange={(e) => set("partnerOwnerId", e.target.value)}
                  className={selectCls}
                  data-testid="select-partner-owner"
                >
                  <option value="">Select…</option>
                  {sortedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.roleLabel}
                    </option>
                  ))}
                </select>
                <FieldError msg={errors.partnerOwnerId} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-lead" className={labelCls}>
                  Engagement lead *
                </Label>
                <select
                  id="o-lead"
                  value={form.engagementLeadId}
                  onChange={(e) => set("engagementLeadId", e.target.value)}
                  className={selectCls}
                  data-testid="select-engagement-lead"
                >
                  <option value="">Select…</option>
                  {sortedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.roleLabel}
                    </option>
                  ))}
                </select>
                <FieldError msg={errors.engagementLeadId} />
              </div>
            </div>
          </Section>

          {/* ───────────── Deal context ───────────── */}
          <Section
            title="Deal context"
            hint="Best estimates; everything here feeds the forecast and is editable later."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="o-source" className={labelCls}>
                  Source / lead origin
                </Label>
                <select
                  id="o-source"
                  value={form.sourceLead}
                  onChange={(e) =>
                    set("sourceLead", e.target.value as FormState["sourceLead"])
                  }
                  className={selectCls}
                  data-testid="select-source-lead"
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-deal" className={labelCls}>
                  Estimated deal size (USD)
                </Label>
                <Input
                  id="o-deal"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.dealSizeUsd}
                  onChange={(e) => set("dealSizeUsd", e.target.value)}
                  className={inputCls}
                  placeholder="250000"
                />
                <FieldError msg={errors.dealSizeUsd} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-prob" className={labelCls}>
                  Win probability (%)
                </Label>
                <Input
                  id="o-prob"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={form.probabilityPct}
                  onChange={(e) => set("probabilityPct", e.target.value)}
                  className={inputCls}
                  placeholder="25"
                />
                <p className="text-[11px] text-text-faint">
                  25% is the typical default for the identify stage.
                </p>
                <FieldError msg={errors.probabilityPct} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-mile-date" className={labelCls}>
                  Target milestone date
                </Label>
                <Input
                  id="o-mile-date"
                  type="date"
                  value={form.nextMilestoneDate}
                  onChange={(e) => set("nextMilestoneDate", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="o-mile" className={labelCls}>
                  Next milestone
                </Label>
                <Input
                  id="o-mile"
                  value={form.nextMilestone}
                  onChange={(e) => set("nextMilestone", e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Discovery call with CFO + CIO"
                />
              </div>
            </div>
          </Section>

          {/* ───────────── Pursuit Scout ───────────── */}
          <section className="rounded border border-gold/30 bg-gold/[0.04] p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Telescope className="w-4 h-4 text-gold shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-xs font-mono uppercase tracking-widest text-gold">
                  Pursuit Scout
                </h3>
                <p className="text-sm text-text-mute leading-relaxed">
                  An evidence-grounded research agent. On creation it reads the
                  description above and produces an{" "}
                  <span className="text-text">account snapshot</span>,{" "}
                  <span className="text-text">buyer landscape</span>, a{" "}
                  <span className="text-text">draft 5C</span>,{" "}
                  <span className="text-text">open discovery questions</span>,
                  and <span className="text-text">cited facts</span>.
                </p>
                <p className="text-xs text-text-faint">
                  The brief lands on the{" "}
                  <span className="font-mono text-text">Brief</span> tab of the
                  new opportunity and pre-fills the{" "}
                  <span className="font-mono text-text">5C Qualifier</span>.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-text-mute">
              <input
                type="checkbox"
                checked={form.runScout}
                onChange={(e) => set("runScout", e.target.checked)}
                className="accent-gold"
                data-testid="checkbox-run-scout"
              />
              Auto-run Pursuit Scout on creation
            </label>

            {form.runScout && (
              <div className="grid gap-1.5">
                <Label htmlFor="o-focus" className={labelCls}>
                  Focus areas (optional)
                </Label>
                <Textarea
                  id="o-focus"
                  value={form.scoutFocus}
                  onChange={(e) => set("scoutFocus", e.target.value)}
                  className={`${inputCls} min-h-[60px] text-xs`}
                  placeholder="Anything Scout should pay extra attention to — competitors to watch, named execs, recent press…"
                  data-testid="input-scout-focus"
                />
              </div>
            )}
          </section>

          <div className="flex justify-end gap-3 pt-3 border-t border-border-soft">
            <PillButton
              variant="ghost"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              type="submit"
              disabled={create.isPending}
              data-testid="btn-create-opp-submit"
            >
              {create.isPending ? "Creating…" : "Create opportunity"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
