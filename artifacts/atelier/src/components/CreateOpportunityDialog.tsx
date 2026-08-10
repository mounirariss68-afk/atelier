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
  useAtelierCheckOpportunityDuplicates,
  getAtelierCheckOpportunityDuplicatesQueryKey,
  useAtelierRunPursuitScout,
  getAtelierGetBriefQueryKey,
  ApiError,
  type AtelierOpportunityDuplicateError,
} from "@workspace/api-client-react";
import { ToastAction } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Telescope, ChevronsUpDown, Check, Plus, AlertTriangle } from "lucide-react";
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
  // Task #726 — when opened from an account detail page, the target account
  // is preselected and locked (the picker + "new account" mode are hidden).
  presetAccount?: { id: string; name: string };
  // Optional post-create hook. When provided, it replaces the default
  // navigate-to-the-new-opportunity behavior (used by the account page to
  // stay put and refresh its own opportunity list).
  onCreated?: (opportunityId: string) => void;
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
  closeDate: string;
  forecastCategory: "omitted" | "pipeline" | "best_case" | "commit" | "closed";
  // Scout
  runScout: boolean;
  scoutFocus: string;
};

const FORECAST_CATEGORY_OPTIONS: {
  value: FormState["forecastCategory"];
  label: string;
}[] = [
  { value: "pipeline", label: "Pipeline" },
  { value: "best_case", label: "Best case" },
  { value: "commit", label: "Commit" },
  { value: "omitted", label: "Omitted" },
];

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

export function CreateOpportunityDialog({ trigger, presetAccount, onCreated }: Props) {
  const [open, setOpen] = React.useState(false);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useAtelierCreateOpportunity();
  const runScoutMutation = useAtelierRunPursuitScout();
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
      accountId: presetAccount?.id ?? "",
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
      closeDate: "",
      forecastCategory: "pipeline",
      runScout: true,
      scoutFocus: "",
    }),
    [me?.id, presetAccount?.id],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [accountPickerOpen, setAccountPickerOpen] = React.useState(false);
  // Task #30 — populated when the server rejects the create with a 409
  // duplicate-opportunity conflict. Cleared whenever the name or target
  // account changes; "Create anyway" re-submits with allowDuplicate:true.
  const [duplicateConflict, setDuplicateConflict] =
    React.useState<AtelierOpportunityDuplicateError | null>(null);

  // Task #37 — live as-you-type duplicate hint. Debounce the name so we only
  // query once the user pauses; the lookup needs an existing account selected
  // (a brand-new account can't have prior deals). Purely advisory — the
  // server-side 409 on submit stays the hard gate.
  const [debouncedName, setDebouncedName] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedName(form.name.trim()), 350);
    return () => clearTimeout(t);
  }, [form.name]);
  const hintEnabled =
    open &&
    form.accountMode === "existing" &&
    !!form.accountId &&
    debouncedName.length >= 3;
  const dupHintParams = { accountId: form.accountId, name: debouncedName };
  const { data: dupHint } = useAtelierCheckOpportunityDuplicates(dupHintParams, {
    query: {
      enabled: hintEnabled,
      queryKey: getAtelierCheckOpportunityDuplicatesQueryKey(dupHintParams),
      staleTime: 30_000,
    },
  });
  const dupHintMatches = hintEnabled ? (dupHint?.candidates ?? []) : [];

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
      setDuplicateConflict(null);
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
    // Any change to the name or target account invalidates a shown
    // duplicate conflict — the next submit re-checks server-side.
    if (
      key === "name" ||
      key === "accountId" ||
      key === "accountMode" ||
      key === "newAccountName"
    ) {
      setDuplicateConflict(null);
    }
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
    await doCreate(false);
  }

  // Task #867 — rerun affordance offered from the failed/empty Scout toast.
  async function rerunScout(oppId: string) {
    toast({
      title: "Rerunning Pursuit Scout…",
      description: "This takes a minute — the brief lands on the Brief tab.",
    });
    try {
      await runScoutMutation.mutateAsync({ oppId, data: {} });
      qc.invalidateQueries({ queryKey: getAtelierGetBriefQueryKey(oppId) });
      toast({
        title: "Pursuit Scout finished",
        description: "The brief is ready on the opportunity's Brief tab.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Pursuit Scout failed again",
        description: `${msg} — you can rerun it from the Brief tab.`,
        variant: "destructive",
      });
    }
  }

  async function doCreate(allowDuplicate: boolean) {
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
          closeDate: form.closeDate || undefined,
          forecastCategory: form.forecastCategory,
          runScout: form.runScout,
          scoutFocus: form.scoutFocus.trim() || undefined,
          allowDuplicate: allowDuplicate || undefined,
        },
      });
      setDuplicateConflict(null);
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      // Task #867 — the create response carries the definitive Scout outcome
      // (the run is synchronous server-side). Surface failed/empty runs with a
      // retry affordance instead of an unconditional "Scout is drafting" toast.
      const scoutStatus = res.scout?.status ?? "skipped";
      const oppId = res.opportunity.id;
      if (scoutStatus === "completed") {
        toast({
          title: `Opportunity created · ${partnerName} owns it`,
          description:
            "Pursuit Scout finished — the brief is on the Brief tab and feeds the 5C Qualifier.",
        });
      } else if (scoutStatus === "empty" || scoutStatus === "failed") {
        toast({
          title:
            scoutStatus === "failed"
              ? "Opportunity created · Scout failed"
              : "Opportunity created · Scout found nothing",
          description:
            scoutStatus === "failed"
              ? `The opportunity is saved, but Pursuit Scout hit an error${res.scout?.error ? `: ${res.scout.error}` : ""}. You can rerun it now or later from the Brief tab.`
              : "The opportunity is saved, but Pursuit Scout returned an empty brief. You can rerun it now or later from the Brief tab.",
          variant: "destructive",
          action: (
            <ToastAction altText="Rerun Pursuit Scout" onClick={() => rerunScout(oppId)}>
              Rerun Scout
            </ToastAction>
          ),
        });
      } else {
        toast({
          title: `Opportunity created · ${partnerName} owns it`,
          description:
            "Pipeline updated. Run Pursuit Scout from the Brief tab when ready.",
        });
      }
      setOpen(false);
      if (onCreated) {
        onCreated(res.opportunity.id);
      } else {
        setLocation(`/pipeline/${res.opportunity.id}`);
      }
    } catch (err) {
      // Task #30 — a 409 duplicate-opportunity conflict is not a failure
      // toast; it renders an inline warning panel with an explicit
      // "Create anyway" override.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.data as AtelierOpportunityDuplicateError | null)?.error ===
          "duplicate-opportunity"
      ) {
        setDuplicateConflict(err.data as AtelierOpportunityDuplicateError);
        return;
      }
      // Task #867 — a 400 with field-level messages maps back onto the form
      // instead of a generic error toast, so the user sees which field to fix.
      if (err instanceof ApiError && err.status === 400) {
        const data = err.data as {
          fields?: Record<string, string>;
          message?: string;
          error?: string;
        } | null;
        if (data?.fields && Object.keys(data.fields).length > 0) {
          setErrors((e) => ({ ...e, ...data.fields }));
          toast({
            title: "Check the highlighted fields",
            description:
              data.message ?? `Invalid input for: ${Object.keys(data.fields).join(", ")}.`,
            variant: "destructive",
          });
          return;
        }
      }
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
              {/* Task #37 — live as-you-type duplicate hint (advisory only). */}
              {dupHintMatches.length > 0 && !duplicateConflict && (
                <div
                  className="rounded border border-gold/30 bg-gold/5 px-3 py-2"
                  data-testid="hint-similar-opportunities"
                >
                  <p className="text-[11px] font-mono uppercase tracking-widest text-gold flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Similar open deals on this account
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {dupHintMatches.map((m) => (
                      <li
                        key={m.id}
                        className="text-xs text-text-mute flex items-baseline gap-2"
                        data-testid={`hint-similar-opp-${m.id}`}
                      >
                        <span className="text-text">{m.name}</span>
                        {m.salesStage ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint">
                            {m.salesStage}
                          </span>
                        ) : null}
                        {m.exact ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-danger">
                            exact match
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-text-faint">
                    You can still create it — this is just a heads-up.
                  </p>
                </div>
              )}
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
          {presetAccount ? (
            <Section
              title="Account"
              hint="Created from this account's page — the account is fixed."
            >
              <div
                className={`${selectCls} flex items-center justify-between opacity-80 cursor-default`}
                data-testid="preset-account-locked"
              >
                <span className="text-text">{presetAccount.name}</span>
                <Check className="w-4 h-4 text-gold shrink-0 ml-2" />
              </div>
            </Section>
          ) : (
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
          )}

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
              <div className="grid gap-1.5">
                <Label htmlFor="o-close-date" className={labelCls}>
                  Expected close date
                </Label>
                <Input
                  id="o-close-date"
                  type="date"
                  value={form.closeDate}
                  onChange={(e) => set("closeDate", e.target.value)}
                  className={inputCls}
                  data-testid="input-opp-close-date"
                />
                <p className="text-[11px] text-text-faint">
                  Drives the quarter forecast roll-up.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-forecast-cat" className={labelCls}>
                  Forecast category
                </Label>
                <select
                  id="o-forecast-cat"
                  value={form.forecastCategory}
                  onChange={(e) =>
                    set(
                      "forecastCategory",
                      e.target.value as FormState["forecastCategory"],
                    )
                  }
                  className={selectCls}
                  data-testid="select-forecast-category"
                >
                  {FORECAST_CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
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

          {/* ───────────── Duplicate warning (Task #30) ───────────── */}
          {duplicateConflict && (
            <section
              className="rounded border border-danger/50 bg-danger/[0.06] p-4 space-y-3"
              data-testid="panel-duplicate-opportunity"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-danger">
                    Possible duplicate
                  </h3>
                  <p className="text-sm text-text-mute leading-relaxed">
                    An open opportunity named{" "}
                    <button
                      type="button"
                      className="text-gold underline underline-offset-2 hover:text-gold/80"
                      onClick={() => {
                        setOpen(false);
                        setLocation(`/pipeline/${duplicateConflict.existing.id}`);
                      }}
                      data-testid="link-duplicate-existing-opp"
                    >
                      {duplicateConflict.existing.name}
                    </button>{" "}
                    already exists on this account
                    {duplicateConflict.existing.salesStage ? (
                      <>
                        {" "}
                        (stage:{" "}
                        <span className="font-mono text-text">
                          {duplicateConflict.existing.salesStage}
                        </span>
                        )
                      </>
                    ) : null}
                    . You can open it instead, or create a second one anyway.
                  </p>
                  {duplicateConflict.similar &&
                    duplicateConflict.similar.filter((s) => !s.exact).length > 0 && (
                      <p className="text-xs text-text-faint">
                        Similar deals on this account:{" "}
                        {duplicateConflict.similar
                          .filter((s) => !s.exact)
                          .map((s) => s.name)
                          .join(", ")}
                      </p>
                    )}
                </div>
              </div>
            </section>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-border-soft">
            <PillButton
              variant="ghost"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </PillButton>
            {duplicateConflict ? (
              <PillButton
                variant="primary"
                type="button"
                disabled={create.isPending}
                onClick={() => void doCreate(true)}
                data-testid="btn-create-opp-anyway"
              >
                {create.isPending ? "Creating…" : "Create anyway"}
              </PillButton>
            ) : (
              <PillButton
                variant="primary"
                type="submit"
                disabled={create.isPending}
                data-testid="btn-create-opp-submit"
              >
                {create.isPending ? "Creating…" : "Create opportunity"}
              </PillButton>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
