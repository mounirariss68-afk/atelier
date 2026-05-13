import * as React from "react";
import { useAtelierGetMe } from "@workspace/api-client-react";
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  PillButton,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  invalidateReferenceBootstrap,
  useReferenceBootstrap,
} from "@/components/ReferenceCombobox";
import {
  sortCountries,
  sortIndustries,
  sortSubIndustries,
  type CountryRow,
  type IndustryRow,
  type SubIndustryRow,
} from "@/lib/reference-data";

// TODO(Task #292 — Persona Replacement / A3): replace this temporary role
// gate with the canonical `can_admin_reference_data` capability check once
// the 9-persona model ships.
const ADMIN_ROLES = new Set(["partner", "operations"]);
const REGIONS = ["MENA", "Africa", "Asia", "Europe", "Americas", "Oceania", "Antarctica"];
const OFFERING_ANCHORS = [
  "agentic_ai",
  "legacy_modernization",
  "data_foundations",
  "ai_product",
];

type Tab = "countries" | "industries" | "sub_industries";

export default function ReferenceData() {
  const { data: me, isLoading: meLoading } = useAtelierGetMe();
  const canAdmin = !!me && ADMIN_ROLES.has(me.role);
  const [tab, setTab] = React.useState<Tab>("countries");

  if (meLoading) {
    return (
      <div className="container-atelier py-10">
        <Skeleton className="h-64 bg-bg-elevate" />
      </div>
    );
  }
  if (!canAdmin) {
    return (
      <div className="container-atelier py-12">
        <Card className="p-8 text-center">
          <div className="text-base font-semibold text-text">Reference data is partner-only</div>
          <div className="text-sm text-text-mute mt-2">
            Contact a Founding Partner to update countries or industries.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          headline="Reference data"
          lede="Canonical countries and industries used everywhere in the portal. Edits are versioned and audit-logged; deprecate instead of delete to preserve historical references."
        />
        <div className="flex items-center gap-2 mt-4">
          {(["countries", "industries", "sub_industries"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              data-testid={`tab-${t}`}
              className={`text-[11px] font-mono uppercase tracking-widest px-3 py-1 rounded border ${
                tab === t
                  ? "border-gold/60 text-gold bg-bg-elevate"
                  : "border-border text-text-mute hover:text-text"
              }`}
            >
              {t === "sub_industries" ? "Sub-industries" : t}
            </button>
          ))}
        </div>
      </PageHero>

      <div className="container-atelier py-10">
        {tab === "countries" && <CountriesPanel />}
        {tab === "industries" && <IndustriesPanel />}
        {tab === "sub_industries" && <SubIndustriesPanel />}
      </div>
    </div>
  );
}

async function patchJson(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function postJson(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// =============================================================
// Countries — filter, edit (name/region/flags), deprecate/restore
// =============================================================
function CountriesPanel() {
  const { data, loading, refetch } = useReferenceBootstrap();
  const { toast } = useToast();
  const [q, setQ] = React.useState("");
  const [region, setRegion] = React.useState<string>("");
  const [showDeprecated, setShowDeprecated] = React.useState(false);
  const [editingIso, setEditingIso] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    if (!data) return [] as CountryRow[];
    let list: CountryRow[] = data.countries;
    if (!showDeprecated) list = list.filter((c) => c.status === "active");
    if (region) list = list.filter((c) => c.region === region);
    if (q) {
      const n = q.toLowerCase();
      list = list.filter(
        (c) =>
          c.isoAlpha2.toLowerCase().includes(n) ||
          c.displayNameEn.toLowerCase().includes(n) ||
          (c.aliases ?? []).some((a) => a.toLowerCase().includes(n)),
      );
    }
    return sortCountries(list);
  }, [data, q, region, showDeprecated]);

  async function applyPatch(iso: string, body: Record<string, unknown>) {
    const res = await patchJson(`/api/atelier/reference/countries/${iso}`, body);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Update failed",
        description: err.error ?? res.statusText,
        variant: "destructive",
      });
      return false;
    }
    invalidateReferenceBootstrap();
    await refetch();
    toast({ title: "Country updated", description: iso });
    return true;
  }

  if (loading) return <Skeleton className="h-64 bg-bg-elevate" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, ISO, alias…"
          className="w-72 bg-bg-elevate border-border text-text"
        />
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
        >
          <option value="">All regions</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
        <span className="ml-auto text-text-mute">
          {filtered.length} of {data?.countries.length ?? 0}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_120px_60px_60px_180px] gap-2 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-text-faint border-b border-border">
          <span>ISO</span>
          <span>Name (EN / AR)</span>
          <span>Region</span>
          <span>GCC</span>
          <span>Target</span>
          <span>Actions</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.map((c) => (
            <React.Fragment key={c.isoAlpha2}>
              <div
                className="grid grid-cols-[80px_1fr_120px_60px_60px_180px] gap-2 px-3 py-2 text-xs border-b border-border-soft items-center hover:bg-bg-elevate/40"
                data-testid={`country-row-${c.isoAlpha2}`}
              >
                <span className="font-mono text-text">
                  {c.flagEmoji} {c.isoAlpha2}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-text">{c.displayNameEn}</div>
                  {c.displayNameAr && (
                    <div dir="rtl" className="text-text-faint text-[11px] truncate">
                      {c.displayNameAr}
                    </div>
                  )}
                </div>
                <span className="text-text-mute">{c.region}</span>
                <span>{c.isGcc ? <MonoChip tone="gold">GCC</MonoChip> : null}</span>
                <span>{c.isAicoTargetMarket ? <MonoChip tone="green">T1</MonoChip> : null}</span>
                <span className="flex items-center gap-3">
                  <MonoChip tone={c.status === "active" ? "green" : "amber"}>{c.status}</MonoChip>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingIso((prev) => (prev === c.isoAlpha2 ? null : c.isoAlpha2))
                    }
                    className="text-text-mute hover:text-gold underline text-[10px]"
                    data-testid={`edit-country-${c.isoAlpha2}`}
                  >
                    {editingIso === c.isoAlpha2 ? "Close" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      applyPatch(c.isoAlpha2, {
                        status: c.status === "active" ? "deprecated" : "active",
                      })
                    }
                    className="text-text-mute hover:text-gold underline text-[10px]"
                    data-testid={`toggle-deprecate-${c.isoAlpha2}`}
                  >
                    {c.status === "active" ? "Deprecate" : "Restore"}
                  </button>
                </span>
              </div>
              {editingIso === c.isoAlpha2 && (
                <CountryEditRow
                  country={c}
                  onCancel={() => setEditingIso(null)}
                  onSave={async (body) => {
                    const ok = await applyPatch(c.isoAlpha2, body);
                    if (ok) setEditingIso(null);
                  }}
                />
              )}
            </React.Fragment>
          ))}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-text-mute text-sm">
              No countries match these filters.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function CountryEditRow({
  country,
  onSave,
  onCancel,
}: {
  country: CountryRow;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState({
    displayNameEn: country.displayNameEn,
    displayNameAr: country.displayNameAr ?? "",
    region: country.region,
    flagEmoji: country.flagEmoji ?? "",
    isGcc: country.isGcc,
    isAicoTargetMarket: country.isAicoTargetMarket,
    aliases: (country.aliases ?? []).join(", "),
  });
  return (
    <div className="px-3 py-3 bg-bg-elevate/40 border-b border-border-soft grid grid-cols-2 gap-2 text-xs">
      <Input
        value={form.displayNameEn}
        onChange={(e) => setForm({ ...form, displayNameEn: e.target.value })}
        placeholder="Display name (EN)"
      />
      <Input
        value={form.displayNameAr}
        onChange={(e) => setForm({ ...form, displayNameAr: e.target.value })}
        placeholder="Display name (AR)"
        dir="rtl"
      />
      <select
        value={form.region}
        onChange={(e) => setForm({ ...form, region: e.target.value as CountryRow["region"] })}
        className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
      >
        {REGIONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <Input
        value={form.flagEmoji}
        onChange={(e) => setForm({ ...form, flagEmoji: e.target.value })}
        placeholder="Flag emoji"
      />
      <Input
        value={form.aliases}
        onChange={(e) => setForm({ ...form, aliases: e.target.value })}
        placeholder="Aliases (comma-separated)"
        className="col-span-2"
      />
      <label className="inline-flex items-center gap-2 cursor-pointer text-text-mute">
        <input
          type="checkbox"
          checked={form.isGcc}
          onChange={(e) => setForm({ ...form, isGcc: e.target.checked })}
        />
        GCC member
      </label>
      <label className="inline-flex items-center gap-2 cursor-pointer text-text-mute">
        <input
          type="checkbox"
          checked={form.isAicoTargetMarket}
          onChange={(e) => setForm({ ...form, isAicoTargetMarket: e.target.checked })}
        />
        AICo target market
      </label>
      <div className="col-span-2 flex items-center gap-2">
        <PillButton
          variant="primary"
          onClick={() =>
            onSave({
              displayNameEn: form.displayNameEn.trim(),
              displayNameAr: form.displayNameAr.trim() || null,
              region: form.region,
              flagEmoji: form.flagEmoji || undefined,
              isGcc: form.isGcc,
              isAicoTargetMarket: form.isAicoTargetMarket,
              aliases: form.aliases
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean),
            })
          }
        >
          Save
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>
          Cancel
        </PillButton>
      </div>
    </div>
  );
}

// =============================================================
// Industries — create, edit, deprecate/restore
// =============================================================
function IndustriesPanel() {
  const { data, loading, refetch } = useReferenceBootstrap();
  const { toast } = useToast();
  const [showDeprecated, setShowDeprecated] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [editingCode, setEditingCode] = React.useState<string | null>(null);
  const blank = { code: "", displayNameEn: "", shortDescription: "", displayOrder: "99" };
  const [form, setForm] = React.useState(blank);

  const list = React.useMemo<IndustryRow[]>(() => {
    if (!data) return [];
    const filtered = showDeprecated
      ? data.industries
      : data.industries.filter((i) => i.status === "active");
    return sortIndustries(filtered);
  }, [data, showDeprecated]);

  async function applyPatch(code: string, body: Record<string, unknown>) {
    const res = await patchJson(`/api/atelier/reference/industries/${code}`, body);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Update failed",
        description: err.error ?? res.statusText,
        variant: "destructive",
      });
      return false;
    }
    invalidateReferenceBootstrap();
    await refetch();
    return true;
  }

  async function create() {
    const res = await postJson(`/api/atelier/reference/industries`, {
      code: form.code.trim().toUpperCase(),
      displayNameEn: form.displayNameEn.trim(),
      shortDescription: form.shortDescription.trim() || null,
      displayOrder: Number(form.displayOrder) || 99,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Create failed",
        description: err.error ?? res.statusText,
        variant: "destructive",
      });
      return;
    }
    invalidateReferenceBootstrap();
    await refetch();
    setAdding(false);
    setForm(blank);
    toast({ title: "Industry added" });
  }

  if (loading) return <Skeleton className="h-64 bg-bg-elevate" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
        <PillButton
          variant={adding ? "ghost" : "primary"}
          onClick={() => setAdding((v) => !v)}
          className="ml-auto"
          data-testid="industry-add-toggle"
        >
          {adding ? "Cancel" : "Add industry"}
        </PillButton>
      </div>

      {adding && (
        <Card className="p-4 grid gap-2 grid-cols-2">
          <Input
            placeholder="Code (UPPERCASE, e.g. AGRI)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <Input
            placeholder="Display order (e.g. 9)"
            value={form.displayOrder}
            onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
          />
          <Input
            placeholder="Display name (EN)"
            value={form.displayNameEn}
            onChange={(e) => setForm({ ...form, displayNameEn: e.target.value })}
            className="col-span-2"
          />
          <Input
            placeholder="Short description"
            value={form.shortDescription}
            onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
            className="col-span-2"
          />
          <PillButton variant="primary" onClick={create} className="col-span-2">
            Create industry
          </PillButton>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_60px_180px] gap-2 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-text-faint border-b border-border">
          <span>Code</span>
          <span>Name / description</span>
          <span>Order</span>
          <span>Actions</span>
        </div>
        {list.map((i) => (
          <React.Fragment key={i.code}>
            <div
              className="grid grid-cols-[80px_1fr_60px_180px] gap-2 px-3 py-3 text-xs border-b border-border-soft items-center"
              data-testid={`industry-row-${i.code}`}
            >
              <span className="font-mono text-gold">{i.code}</span>
              <div className="min-w-0">
                <div className="text-text">{i.displayNameEn}</div>
                {i.shortDescription && (
                  <div className="text-text-faint text-[11px] truncate">{i.shortDescription}</div>
                )}
              </div>
              <span className="text-text-mute">{i.displayOrder}</span>
              <span className="flex items-center gap-3">
                <MonoChip tone={i.status === "active" ? "green" : "amber"}>{i.status}</MonoChip>
                <button
                  type="button"
                  onClick={() => setEditingCode((p) => (p === i.code ? null : i.code))}
                  className="text-text-mute hover:text-gold underline text-[10px]"
                  data-testid={`edit-industry-${i.code}`}
                >
                  {editingCode === i.code ? "Close" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPatch(i.code, {
                      status: i.status === "active" ? "deprecated" : "active",
                    })
                  }
                  className="text-text-mute hover:text-gold underline text-[10px]"
                >
                  {i.status === "active" ? "Deprecate" : "Restore"}
                </button>
              </span>
            </div>
            {editingCode === i.code && (
              <IndustryEditRow
                industry={i}
                onCancel={() => setEditingCode(null)}
                onSave={async (body) => {
                  const ok = await applyPatch(i.code, body);
                  if (ok) setEditingCode(null);
                }}
              />
            )}
          </React.Fragment>
        ))}
      </Card>
    </div>
  );
}

function IndustryEditRow({
  industry,
  onSave,
  onCancel,
}: {
  industry: IndustryRow;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState({
    displayNameEn: industry.displayNameEn,
    shortDescription: industry.shortDescription ?? "",
    displayOrder: String(industry.displayOrder ?? 99),
  });
  return (
    <div className="px-3 py-3 bg-bg-elevate/40 border-b border-border-soft grid grid-cols-2 gap-2 text-xs">
      <Input
        value={form.displayNameEn}
        onChange={(e) => setForm({ ...form, displayNameEn: e.target.value })}
        placeholder="Display name (EN)"
      />
      <Input
        value={form.displayOrder}
        onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
        placeholder="Display order"
      />
      <Input
        value={form.shortDescription}
        onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
        placeholder="Short description"
        className="col-span-2"
      />
      <div className="col-span-2 flex items-center gap-2">
        <PillButton
          variant="primary"
          onClick={() =>
            onSave({
              displayNameEn: form.displayNameEn.trim(),
              shortDescription: form.shortDescription.trim() || null,
              displayOrder: Number(form.displayOrder) || 99,
            })
          }
        >
          Save
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>
          Cancel
        </PillButton>
      </div>
    </div>
  );
}

// =============================================================
// Sub-industries — create, edit, deprecate/restore
// =============================================================
function SubIndustriesPanel() {
  const { data, loading, refetch } = useReferenceBootstrap();
  const { toast } = useToast();
  const [parent, setParent] = React.useState<string>("");
  const [showDeprecated, setShowDeprecated] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [editingCode, setEditingCode] = React.useState<string | null>(null);
  const blank = {
    code: "",
    industryCode: "",
    displayNameEn: "",
    shortDescription: "",
    defaultOfferingAnchor: "agentic_ai",
    displayOrder: "99",
  };
  const [form, setForm] = React.useState(blank);

  const list = React.useMemo<SubIndustryRow[]>(() => {
    if (!data) return [];
    let filtered = showDeprecated
      ? data.subIndustries
      : data.subIndustries.filter((s) => s.status === "active");
    if (parent) filtered = filtered.filter((s) => s.industryCode === parent);
    return sortSubIndustries(filtered);
  }, [data, parent, showDeprecated]);

  async function applyPatch(code: string, body: Record<string, unknown>) {
    const res = await patchJson(`/api/atelier/reference/sub_industries/${code}`, body);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Update failed",
        description: err.error ?? res.statusText,
        variant: "destructive",
      });
      return false;
    }
    invalidateReferenceBootstrap();
    await refetch();
    return true;
  }

  async function create() {
    const res = await postJson(`/api/atelier/reference/sub_industries`, {
      ...form,
      code: form.code.trim().toUpperCase(),
      industryCode: form.industryCode.trim().toUpperCase(),
      displayOrder: Number(form.displayOrder) || 99,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Create failed",
        description: err.error ?? res.statusText,
        variant: "destructive",
      });
      return;
    }
    invalidateReferenceBootstrap();
    await refetch();
    setAdding(false);
    setForm(blank);
    toast({ title: "Sub-industry added" });
  }

  if (loading) return <Skeleton className="h-64 bg-bg-elevate" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
        <select
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
        >
          <option value="">All primary industries</option>
          {(data?.industries ?? []).map((i) => (
            <option key={i.code} value={i.code}>{i.code} · {i.displayNameEn}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
        <PillButton
          variant={adding ? "ghost" : "primary"}
          onClick={() => setAdding((v) => !v)}
          className="ml-auto"
        >
          {adding ? "Cancel" : "Add sub-industry"}
        </PillButton>
      </div>

      {adding && (
        <Card className="p-4 grid gap-2 grid-cols-2">
          <Input
            placeholder="Code (e.g. FS_DIGITAL_BANKING)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <select
            value={form.industryCode}
            onChange={(e) => setForm({ ...form, industryCode: e.target.value })}
            className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
          >
            <option value="">Parent industry…</option>
            {(data?.industries ?? []).map((i) => (
              <option key={i.code} value={i.code}>{i.code} · {i.displayNameEn}</option>
            ))}
          </select>
          <Input
            placeholder="Display name (EN)"
            value={form.displayNameEn}
            onChange={(e) => setForm({ ...form, displayNameEn: e.target.value })}
          />
          <select
            value={form.defaultOfferingAnchor}
            onChange={(e) => setForm({ ...form, defaultOfferingAnchor: e.target.value })}
            className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
          >
            {OFFERING_ANCHORS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <Input
            placeholder="Short description (required)"
            value={form.shortDescription}
            onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
            className="col-span-2"
          />
          <PillButton variant="primary" onClick={create} className="col-span-2">
            Create sub-industry
          </PillButton>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[180px_70px_1fr_50px_180px] gap-2 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-text-faint border-b border-border">
          <span>Code</span>
          <span>Parent</span>
          <span>Name / description</span>
          <span>Order</span>
          <span>Actions</span>
        </div>
        {list.map((s) => (
          <React.Fragment key={s.code}>
            <div
              className="grid grid-cols-[180px_70px_1fr_50px_180px] gap-2 px-3 py-2 text-xs border-b border-border-soft items-center"
              data-testid={`sub-industry-row-${s.code}`}
            >
              <span className="font-mono text-text-mute truncate">{s.code}</span>
              <span className="font-mono text-gold text-[10px]">{s.industryCode}</span>
              <div className="min-w-0">
                <div className="text-text">{s.displayNameEn}</div>
                {s.shortDescription && (
                  <div className="text-text-faint text-[11px] truncate">{s.shortDescription}</div>
                )}
              </div>
              <span className="text-text-mute">{s.displayOrder}</span>
              <span className="flex items-center gap-3">
                <MonoChip tone={s.status === "active" ? "green" : "amber"}>{s.status}</MonoChip>
                <button
                  type="button"
                  onClick={() => setEditingCode((p) => (p === s.code ? null : s.code))}
                  className="text-text-mute hover:text-gold underline text-[10px]"
                  data-testid={`edit-sub-industry-${s.code}`}
                >
                  {editingCode === s.code ? "Close" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPatch(s.code, {
                      status: s.status === "active" ? "deprecated" : "active",
                    })
                  }
                  className="text-text-mute hover:text-gold underline text-[10px]"
                >
                  {s.status === "active" ? "Deprecate" : "Restore"}
                </button>
              </span>
            </div>
            {editingCode === s.code && (
              <SubIndustryEditRow
                row={s}
                onCancel={() => setEditingCode(null)}
                onSave={async (body) => {
                  const ok = await applyPatch(s.code, body);
                  if (ok) setEditingCode(null);
                }}
              />
            )}
          </React.Fragment>
        ))}
      </Card>
    </div>
  );
}

function SubIndustryEditRow({
  row,
  onSave,
  onCancel,
}: {
  row: SubIndustryRow;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState({
    displayNameEn: row.displayNameEn,
    shortDescription: row.shortDescription ?? "",
    defaultOfferingAnchor: row.defaultOfferingAnchor ?? "agentic_ai",
    displayOrder: String(row.displayOrder ?? 99),
  });
  return (
    <div className="px-3 py-3 bg-bg-elevate/40 border-b border-border-soft grid grid-cols-2 gap-2 text-xs">
      <Input
        value={form.displayNameEn}
        onChange={(e) => setForm({ ...form, displayNameEn: e.target.value })}
        placeholder="Display name (EN)"
      />
      <Input
        value={form.displayOrder}
        onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
        placeholder="Display order"
      />
      <select
        value={form.defaultOfferingAnchor}
        onChange={(e) => setForm({ ...form, defaultOfferingAnchor: e.target.value })}
        className="bg-bg-deep border border-border rounded px-2 py-2 text-sm text-text"
      >
        {OFFERING_ANCHORS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <div />
      <Input
        value={form.shortDescription}
        onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
        placeholder="Short description"
        className="col-span-2"
      />
      <div className="col-span-2 flex items-center gap-2">
        <PillButton
          variant="primary"
          onClick={() =>
            onSave({
              displayNameEn: form.displayNameEn.trim(),
              shortDescription: form.shortDescription.trim() || null,
              defaultOfferingAnchor: form.defaultOfferingAnchor,
              displayOrder: Number(form.displayOrder) || 99,
            })
          }
        >
          Save
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>
          Cancel
        </PillButton>
      </div>
    </div>
  );
}
