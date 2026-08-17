/**
 * ToolingSpend — vendor tooling cost allocation (Task #1251).
 *
 * Finance-leadership surface at /finance/tooling that mines AI/dev vendor
 * invoices (Replit / Anthropic / Perplexity) and allocates their spend to
 * the four cost buckets — Internal/IP, Business development, Client
 * delivery, Overhead — so the firm can see how much tooling money each
 * engagement / opportunity actually consumed.
 *
 * Sections:
 *   (a) KPI tiles from /overview.totals
 *   (b) "Map project names" queue from /unmapped — bucket picker per row,
 *       POST /map
 *   (c) "Vendor split rules" editor from /vendor-rules for flat-invoice
 *       vendors (percentage rows summing to 100), PUT on save
 *   (d) "Invoices" list from /overview.pendingInvoices with split-status
 *       chips; clicking opens a detail panel from /invoices/:id with an
 *       extraction items table, a splits table, Approve + Re-extract.
 *
 * Deep links: ?focus=unmapped scrolls/highlights the mapping queue;
 * ?focus=<invoiceId> auto-opens that invoice's split panel. The Finance
 * approvals inbox links here.
 *
 * All reads/writes are raw fetch (credentials:"include") against the
 * FROZEN /api/atelier/finance/tooling/* wire contract — the server side
 * is built in parallel; this page never touches server code or the DB.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Boxes, RefreshCw } from "lucide-react";
import {
  useDeepLinkFocus,
  deepLinkFocusClass,
  scrollFocusIntoView,
} from "@/lib/useDeepLinkFocus";
import {
  fmtUsd,
  bucketNeedsRef,
  splitsSumTo100,
  splitPctError,
  parseFocusTarget,
  type BucketType,
} from "./toolingSpend.helpers";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

// ── Wire types (mirror the frozen contract) ────────────────────────────
interface OverviewTotals {
  internalUsd: number;
  bdUsd: number;
  deliveryUsd: number;
  overheadUsd: number;
  clientUsd: number;
  ipDevUsd: number;
  unallocatedUsd: number;
}
type SplitStatus = "proposed" | "unmapped" | "unreconciled" | "failed" | "none";
interface PendingInvoice {
  invoiceId: string;
  reference: string;
  vendorKey: string;
  supplierName: string;
  totalUsd: number;
  splitStatus: SplitStatus;
  invoiceDate: string;
}
interface OverviewResp {
  ok: boolean;
  data: {
    totals: OverviewTotals;
    byVendor: Array<{
      vendorKey: string;
      vendorLabel: string;
      totalUsd: number;
      bucketTotals: { internalUsd: number; bdUsd: number; deliveryUsd: number; overheadUsd: number; clientUsd: number; ipDevUsd: number };
    }>;
    byProject: Array<{
      vendorKey: string;
      projectKey: string;
      projectLabel: string;
      bucketType: string;
      bucketRef: string | null;
      bucketLabel: string;
      totalUsd: number;
    }>;
    pendingInvoices: PendingInvoice[];
    unmappedCount: number;
  };
}
interface UnmappedRow {
  vendorKey: string;
  projectKey: string;
  projectLabel: string;
  invoiceCount: number;
  totalUsd: number;
  exampleInvoiceId: string;
}
interface UnmappedResp {
  ok: boolean;
  data: { rows: UnmappedRow[] };
}
interface TargetsResp {
  ok: boolean;
  data: {
    engagements: Array<{ id: string; name: string }>;
    opportunities: Array<{ id: string; name: string; accountName: string }>;
    accounts: Array<{ id: string; name: string }>;
  };
}
interface MappingListRow {
  id: string;
  vendorKey: string;
  vendorLabel: string;
  projectKey: string;
  projectLabel: string;
  bucketType: string;
  bucketRef: string | null;
  bucketLabel: string;
  createdByName: string | null;
  updatedAt: string | null;
}
interface MappingsResp {
  ok: boolean;
  data: { rows: MappingListRow[] };
}
interface VendorRuleSplit {
  bucketType: BucketType;
  bucketRef: string | null;
  bucketLabel?: string;
  pct: number;
}
interface VendorRule {
  vendorKey: string;
  splits: VendorRuleSplit[];
}
interface VendorRulesResp {
  ok: boolean;
  data: { rules: VendorRule[] };
}
interface InvoiceDetailResp {
  ok: boolean;
  data: {
    invoiceId: string;
    reference: string;
    supplierName: string;
    vendorKey: string;
    extraction:
      | null
      | {
          status: "ok" | "unreconciled" | "failed";
          extractedAt: string;
          currency: string;
          subtotal: number;
          vatAmount: number;
          creditsTotal: number;
          items: Array<{ projectKey: string; projectLabel: string; category: string; amount: number }>;
          note: string;
        };
    splits: Array<{
      id: string;
      projectKey: string;
      projectLabel: string;
      bucketType: string;
      bucketRef: string | null;
      bucketLabel: string;
      grossUsd: number;
      creditUsd: number;
      vatUsd: number;
      netUsd: number;
      status: "proposed" | "approved";
    }>;
  };
}

// ── bucket option metadata ─────────────────────────────────────────────
const BUCKET_OPTIONS: Array<{ type: BucketType; label: string }> = [
  { type: "engagement", label: "Client delivery" },
  { type: "opportunity", label: "Business development" },
  { type: "account", label: "Client (account)" },
  { type: "internal", label: "Internal" },
  { type: "ip_development", label: "IP development" },
  { type: "overhead", label: "Overhead" },
];
const BUCKET_LABEL: Record<string, string> = {
  engagement: "Client delivery",
  opportunity: "Business development",
  account: "Client (account)",
  internal: "Internal",
  ip_development: "IP development",
  overhead: "Overhead",
};

const SPLIT_STATUS_TONE: Record<SplitStatus, "default" | "amber" | "green" | "red"> = {
  proposed: "amber",
  unmapped: "amber",
  unreconciled: "red",
  failed: "red",
  none: "default",
};
const SPLIT_STATUS_LABEL: Record<SplitStatus, string> = {
  proposed: "proposed",
  unmapped: "unmapped",
  unreconciled: "unreconciled",
  failed: "failed",
  none: "—",
};

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return (await r.json()) as T;
}

// ═══════════════════════════════════════════════════════════════════════
export default function ToolingSpend(): React.JSX.Element {
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();
  const role = me?.role ?? "";
  const canWrite = role === "founding_partner" || role === "partner" || role === "finance";

  const { focusId } = useDeepLinkFocus("focus");
  const focus = React.useMemo(() => parseFocusTarget(focusId), [focusId]);

  const overviewQ = useQuery<OverviewResp>({
    queryKey: ["finance", "tooling", "overview"],
    queryFn: () => getJson<OverviewResp>("/finance/tooling/overview"),
  });
  const targetsQ = useQuery<TargetsResp>({
    queryKey: ["finance", "tooling", "targets"],
    queryFn: () => getJson<TargetsResp>("/finance/tooling/targets"),
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["finance", "tooling"] });
  }, [qc]);

  const mappingRef = React.useRef<HTMLDivElement | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = React.useState<string | null>(null);

  // Deep-link resolution once data has loaded.
  React.useEffect(() => {
    if (focus.kind === "unmapped") {
      scrollFocusIntoView(mappingRef.current);
    } else if (focus.kind === "invoice") {
      setOpenInvoiceId(focus.invoiceId);
    }
  }, [focus]);

  if (overviewQ.isLoading) {
    return (
      <div className="px-6 py-10 max-w-[1280px] mx-auto">
        <div className="font-mono text-sm text-text-mute">Loading tooling spend…</div>
      </div>
    );
  }
  if (overviewQ.isError || !overviewQ.data?.ok) {
    return (
      <div className="px-6 py-10 max-w-[1280px] mx-auto">
        <div className="font-mono text-sm text-danger" data-testid="tooling-error">
          Failed to load tooling spend.
        </div>
      </div>
    );
  }

  const ov = overviewQ.data.data;
  const t = ov.totals;
  const totalMined =
    t.internalUsd + t.bdUsd + t.deliveryUsd + t.overheadUsd + (t.clientUsd ?? 0) + (t.ipDevUsd ?? 0) + t.unallocatedUsd;
  const targets = targetsQ.data?.ok
    ? { ...targetsQ.data.data, accounts: targetsQ.data.data.accounts ?? [] }
    : { engagements: [], opportunities: [], accounts: [] };

  const nothingMined = totalMined === 0 && ov.pendingInvoices.length === 0 && ov.unmappedCount === 0;

  return (
    <div>
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Tooling spend"
          headline={
            <span className="inline-flex items-center gap-2">
              <Boxes className="w-5 h-5 text-gold" />
              Tooling spend
            </span>
          }
          lede="AI & developer vendor cost allocation — mine Replit / Anthropic / Perplexity / OpenAI invoices and split their spend across Client delivery, Business development, Client accounts, Internal, IP development and Overhead."
        />
      </PageHero>
      <div className="px-6 py-10 max-w-[1280px] mx-auto">
        {nothingMined ? (
          <Card className="p-8 text-center" data-testid="tooling-empty">
            <p className="text-sm text-text-mute">No vendor invoices mined yet.</p>
          </Card>
        ) : (
          <>
            {/* (a) KPI tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="tooling-kpis">
              <KpiTile label="Internal" value={fmtUsd(t.internalUsd)} testId="kpi-internal" />
              <KpiTile label="Business development" value={fmtUsd(t.bdUsd)} testId="kpi-bd" />
              <KpiTile label="Client delivery" value={fmtUsd(t.deliveryUsd)} testId="kpi-delivery" />
              <KpiTile label="Client (account)" value={fmtUsd(t.clientUsd ?? 0)} testId="kpi-client" />
              <KpiTile label="IP development" value={fmtUsd(t.ipDevUsd ?? 0)} testId="kpi-ipdev" />
              <KpiTile label="Overhead" value={fmtUsd(t.overheadUsd)} testId="kpi-overhead" />
              <KpiTile
                label="Unallocated"
                value={fmtUsd(t.unallocatedUsd)}
                tone={t.unallocatedUsd > 0 ? "amber" : "default"}
                testId="kpi-unallocated"
              />
            </div>

            {/* (b) Map project names queue */}
            <div ref={mappingRef} className={focus.kind === "unmapped" ? `mt-8 ${deepLinkFocusClass}` : "mt-8"}>
              <MappingQueue
                targets={targets}
                canWrite={canWrite}
                onMapped={invalidate}
                highlight={focus.kind === "unmapped"}
              />
            </div>

            {/* (b2) Saved project mappings */}
            <div className="mt-8">
              <MappingsPanel targets={targets} canWrite={canWrite} onChanged={invalidate} />
            </div>

            {/* (c) Vendor split rules editor */}
            <div className="mt-8">
              <VendorRulesEditor targets={targets} canWrite={canWrite} onSaved={invalidate} />
            </div>

            {/* (d) Invoices list */}
            <Card className="mt-8 p-6" data-testid="tooling-invoices">
              <SectionHead eyebrow="Invoices" headline="Vendor invoices" lede="Click an invoice to review its extraction and cost splits." />
              <div className="mt-4 grid gap-2">
                {ov.pendingInvoices.length === 0 ? (
                  <div className="text-sm text-text-mute" data-testid="tooling-invoices-empty">
                    No vendor invoices to review.
                  </div>
                ) : (
                  ov.pendingInvoices.map((inv) => (
                    <button
                      key={inv.invoiceId}
                      type="button"
                      onClick={() =>
                        setOpenInvoiceId((cur) => (cur === inv.invoiceId ? null : inv.invoiceId))
                      }
                      className={`flex items-center justify-between gap-3 rounded border p-3 text-left transition-colors hover:border-gold/40 ${
                        openInvoiceId === inv.invoiceId ? "border-gold/60" : "border-border-soft"
                      }`}
                      data-testid={`tooling-invoice-row-${inv.invoiceId}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {inv.supplierName} · {inv.reference}
                        </div>
                        <div className="text-[11px] font-mono text-text-faint">
                          {inv.invoiceDate?.slice(0, 10)} · {fmtUsd(inv.totalUsd)}
                        </div>
                      </div>
                      <MonoChip tone={SPLIT_STATUS_TONE[inv.splitStatus]} data-testid={`tooling-invoice-chip-${inv.invoiceId}`}>
                        {SPLIT_STATUS_LABEL[inv.splitStatus]}
                      </MonoChip>
                    </button>
                  ))
                )}
              </div>
              {openInvoiceId && (
                <InvoicePanel
                  invoiceId={openInvoiceId}
                  canWrite={canWrite}
                  onClose={() => setOpenInvoiceId(null)}
                  onChanged={invalidate}
                />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ── KPI tile (same style as EngagementPnl) ─────────────────────────────
function KpiTile({
  label,
  value,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "amber" | "red";
  testId?: string;
}): React.JSX.Element {
  const toneClass =
    tone === "red"
      ? "text-danger"
      : tone === "amber"
      ? "text-amber"
      : tone === "green"
      ? "text-green-400"
      : "text-text";
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}

// ── Bucket / target picker (shared by mapping queue + rules editor) ─────
function BucketPicker({
  idPrefix,
  bucketType,
  bucketRef,
  targets,
  onType,
  onRef,
}: {
  idPrefix: string;
  bucketType: BucketType;
  bucketRef: string | null;
  targets: TargetsResp["data"];
  onType: (b: BucketType) => void;
  onRef: (ref: string | null) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {BUCKET_OPTIONS.map((b) => (
          <label
            key={b.type}
            className={`cursor-pointer rounded border px-2 py-1 text-[11px] font-mono ${
              bucketType === b.type ? "border-gold text-gold" : "border-border-soft text-text-mute hover:text-text"
            }`}
          >
            <input
              type="radio"
              className="sr-only"
              name={`${idPrefix}-bucket`}
              checked={bucketType === b.type}
              onChange={() => onType(b.type)}
              data-testid={`${idPrefix}-bucket-${b.type}`}
            />
            {b.label}
          </label>
        ))}
      </div>
      {bucketType === "engagement" && (
        <select
          className="bg-bg-deep border border-border-soft rounded px-2 py-1 text-xs"
          value={bucketRef ?? ""}
          onChange={(e) => onRef(e.target.value || null)}
          data-testid={`${idPrefix}-engagement-select`}
        >
          <option value="">Pick engagement…</option>
          {targets.engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}
      {bucketType === "opportunity" && (
        <select
          className="bg-bg-deep border border-border-soft rounded px-2 py-1 text-xs"
          value={bucketRef ?? ""}
          onChange={(e) => onRef(e.target.value || null)}
          data-testid={`${idPrefix}-opportunity-select`}
        >
          <option value="">Pick opportunity…</option>
          {targets.opportunities.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.accountName}
            </option>
          ))}
        </select>
      )}
      {bucketType === "account" && (
        <select
          className="bg-bg-deep border border-border-soft rounded px-2 py-1 text-xs"
          value={bucketRef ?? ""}
          onChange={(e) => onRef(e.target.value || null)}
          data-testid={`${idPrefix}-account-select`}
        >
          <option value="">Pick client account…</option>
          {(targets.accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── (b) Mapping queue ──────────────────────────────────────────────────
function MappingQueue({
  targets,
  canWrite,
  onMapped,
  highlight,
}: {
  targets: TargetsResp["data"];
  canWrite: boolean;
  onMapped: () => void;
  highlight: boolean;
}): React.JSX.Element {
  const q = useQuery<UnmappedResp>({
    queryKey: ["finance", "tooling", "unmapped"],
    queryFn: () => getJson<UnmappedResp>("/finance/tooling/unmapped"),
  });
  const rows = q.data?.ok ? q.data.data.rows : [];
  return (
    <Card className="p-6" data-testid="tooling-mapping-queue">
      <SectionHead
        eyebrow="Map project names"
        headline="Unmapped vendor projects"
        lede="Each mined project name needs a home bucket. Client delivery → engagement, Business development → opportunity, or Internal/IP / Overhead."
      />
      <div className="mt-4 grid gap-3">
        {q.isLoading && <div className="text-sm text-text-mute">Loading unmapped queue…</div>}
        {q.isError && <div className="text-sm text-danger">Failed to load the mapping queue.</div>}
        {q.data && rows.length === 0 && (
          <div className="text-sm text-text-mute" data-testid="tooling-mapping-empty">
            Nothing to map — every vendor project is allocated.
          </div>
        )}
        {rows.map((row) => (
          <MappingRow
            key={`${row.vendorKey}:${row.projectKey}`}
            row={row}
            targets={targets}
            canWrite={canWrite}
            onMapped={onMapped}
            highlight={highlight}
          />
        ))}
      </div>
    </Card>
  );
}

function MappingRow({
  row,
  targets,
  canWrite,
  onMapped,
  highlight,
}: {
  row: UnmappedRow;
  targets: TargetsResp["data"];
  canWrite: boolean;
  onMapped: () => void;
  highlight: boolean;
}): React.JSX.Element {
  const { toast } = useToast();
  const [bucketType, setBucketType] = React.useState<BucketType>("engagement");
  const [bucketRef, setBucketRef] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const needsRef = bucketNeedsRef(bucketType);
  const canSubmit = canWrite && (!needsRef || !!bucketRef) && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/finance/tooling/map`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorKey: row.vendorKey,
          projectKey: row.projectKey,
          bucketType,
          bucketRef: needsRef ? bucketRef : null,
        }),
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Project mapped", description: `${row.projectLabel} → ${BUCKET_LABEL[bucketType]}` });
      onMapped();
    } catch (e) {
      toast({ title: "Mapping failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded border border-border-soft p-3 ${highlight ? deepLinkFocusClass : ""}`}
      data-testid={`tooling-mapping-row-${row.vendorKey}-${row.projectKey}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{row.projectLabel}</span>
          <span className="ml-2 font-mono text-[11px] text-text-faint uppercase">{row.vendorKey}</span>
        </div>
        <div className="font-mono text-xs text-text-mute">
          {fmtUsd(row.totalUsd)} · {row.invoiceCount} invoice(s)
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BucketPicker
          idPrefix={`map-${row.vendorKey}-${row.projectKey}`}
          bucketType={bucketType}
          bucketRef={bucketRef}
          targets={targets}
          onType={(b) => {
            setBucketType(b);
            setBucketRef(null);
          }}
          onRef={setBucketRef}
        />
        <PillButton
          onClick={submit}
          disabled={!canSubmit}
          data-testid={`tooling-map-submit-${row.vendorKey}-${row.projectKey}`}
        >
          {busy ? "Mapping…" : "Map"}
        </PillButton>
      </div>
    </div>
  );
}

// ── (b2) Saved project mappings panel (Task #1268) ─────────────────────
function MappingsPanel({
  targets,
  canWrite,
  onChanged,
}: {
  targets: TargetsResp["data"];
  canWrite: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const q = useQuery<MappingsResp>({
    queryKey: ["finance", "tooling", "mappings"],
    queryFn: () => getJson<MappingsResp>("/finance/tooling/mappings"),
  });
  const rows = q.data?.ok ? q.data.data.rows : [];
  return (
    <Card className="p-6" data-testid="tooling-mappings-panel">
      <SectionHead
        eyebrow="Project mappings"
        headline="Saved project homes"
        lede="Every project→bucket association the firm has saved. Edit re-points future invoices; remove sends the project back to the unmapped queue. Already-approved spend never moves."
      />
      <div className="mt-4 grid gap-2">
        {q.isLoading && <div className="text-sm text-text-mute">Loading mappings…</div>}
        {q.isError && <div className="text-sm text-danger">Failed to load mappings.</div>}
        {q.data && rows.length === 0 && (
          <div className="text-sm text-text-mute" data-testid="tooling-mappings-empty">
            No saved project mappings yet.
          </div>
        )}
        {rows.map((row) => (
          <SavedMappingRow key={row.id} row={row} targets={targets} canWrite={canWrite} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

function SavedMappingRow({
  row,
  targets,
  canWrite,
  onChanged,
}: {
  row: MappingListRow;
  targets: TargetsResp["data"];
  canWrite: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [bucketType, setBucketType] = React.useState<BucketType>(row.bucketType as BucketType);
  const [bucketRef, setBucketRef] = React.useState<string | null>(row.bucketRef);
  const [busy, setBusy] = React.useState<null | "save" | "delete">(null);
  const needsRef = bucketNeedsRef(bucketType);
  const canSave = canWrite && (!needsRef || !!bucketRef) && busy === null;

  const save = async () => {
    setBusy("save");
    try {
      const r = await fetch(`${API_BASE}/finance/tooling/map`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorKey: row.vendorKey,
          projectKey: row.projectKey,
          bucketType,
          bucketRef: needsRef ? bucketRef : null,
        }),
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Mapping updated", description: `${row.projectLabel} → ${BUCKET_LABEL[bucketType]}` });
      setEditing(false);
      onChanged();
    } catch (e) {
      toast({ title: "Update failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      const r = await fetch(`${API_BASE}/finance/tooling/mappings/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Mapping removed", description: `${row.projectLabel} is back in the unmapped queue.` });
      onChanged();
    } catch (e) {
      toast({ title: "Remove failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded border border-border-soft p-3" data-testid={`tooling-mapping-saved-${row.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{row.projectLabel}</span>
          <span className="ml-2 font-mono text-[11px] text-text-faint uppercase">{row.vendorLabel}</span>
          <span className="ml-2 font-mono text-[11px] text-gold">
            → {BUCKET_LABEL[row.bucketType] ?? row.bucketType}
            {row.bucketRef ? ` · ${row.bucketLabel}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {row.createdByName && (
            <span className="text-[11px] text-text-faint">
              by {row.createdByName}
              {row.updatedAt ? ` · ${row.updatedAt.slice(0, 10)}` : ""}
            </span>
          )}
          {canWrite && (
            <>
              <button
                type="button"
                className="text-[11px] text-text-mute hover:text-text"
                onClick={() => setEditing((v) => !v)}
                data-testid={`tooling-mapping-edit-${row.id}`}
              >
                {editing ? "cancel" : "edit"}
              </button>
              <button
                type="button"
                className="text-[11px] text-danger hover:underline"
                onClick={remove}
                disabled={busy !== null}
                data-testid={`tooling-mapping-delete-${row.id}`}
              >
                {busy === "delete" ? "removing…" : "remove"}
              </button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BucketPicker
            idPrefix={`saved-${row.id}`}
            bucketType={bucketType}
            bucketRef={bucketRef}
            targets={targets}
            onType={(b) => {
              setBucketType(b);
              setBucketRef(null);
            }}
            onRef={setBucketRef}
          />
          <PillButton onClick={save} disabled={!canSave} data-testid={`tooling-mapping-save-${row.id}`}>
            {busy === "save" ? "Saving…" : "Save"}
          </PillButton>
        </div>
      )}
    </div>
  );
}

// ── (c) Vendor split rules editor ──────────────────────────────────────
function VendorRulesEditor({
  targets,
  canWrite,
  onSaved,
}: {
  targets: TargetsResp["data"];
  canWrite: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  const q = useQuery<VendorRulesResp>({
    queryKey: ["finance", "tooling", "vendor-rules"],
    queryFn: () => getJson<VendorRulesResp>("/finance/tooling/vendor-rules"),
  });
  const rules = q.data?.ok ? q.data.data.rules : [];
  return (
    <Card className="p-6" data-testid="tooling-vendor-rules">
      <SectionHead
        eyebrow="Vendor split rules"
        headline="Flat-invoice allocation"
        lede="For vendors billed as one flat charge, define how each invoice's total is split across buckets. Percentages must sum to 100."
      />
      <div className="mt-4 grid gap-4">
        {q.isLoading && <div className="text-sm text-text-mute">Loading vendor rules…</div>}
        {q.isError && <div className="text-sm text-danger">Failed to load vendor rules.</div>}
        {q.data && rules.length === 0 && (
          <div className="text-sm text-text-mute" data-testid="tooling-vendor-rules-empty">
            No flat-invoice vendor rules configured.
          </div>
        )}
        {rules.map((rule) => (
          <VendorRuleCard
            key={rule.vendorKey}
            rule={rule}
            targets={targets}
            canWrite={canWrite}
            onSaved={onSaved}
          />
        ))}
      </div>
    </Card>
  );
}

interface EditableSplit {
  bucketType: BucketType;
  bucketRef: string | null;
  pct: number;
}

function VendorRuleCard({
  rule,
  targets,
  canWrite,
  onSaved,
}: {
  rule: VendorRule;
  targets: TargetsResp["data"];
  canWrite: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const [splits, setSplits] = React.useState<EditableSplit[]>(
    rule.splits.map((s) => ({ bucketType: s.bucketType, bucketRef: s.bucketRef, pct: s.pct })),
  );
  const [busy, setBusy] = React.useState(false);

  const pcts = splits.map((s) => s.pct);
  const sums100 = splitsSumTo100(pcts);
  const err = splitPctError(pcts);
  const refsOk = splits.every((s) => !bucketNeedsRef(s.bucketType) || !!s.bucketRef);
  const canSave = canWrite && sums100 && refsOk && splits.length > 0 && !busy;

  const setSplit = (i: number, patch: Partial<EditableSplit>) =>
    setSplits((cur) => cur.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addRow = () =>
    setSplits((cur) => [...cur, { bucketType: "internal", bucketRef: null, pct: 0 }]);
  const removeRow = (i: number) => setSplits((cur) => cur.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/finance/tooling/vendor-rules`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorKey: rule.vendorKey,
          splits: splits.map((s) => ({
            bucketType: s.bucketType,
            bucketRef: bucketNeedsRef(s.bucketType) ? s.bucketRef : null,
            pct: s.pct,
          })),
        }),
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Vendor rule saved", description: rule.vendorKey });
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border border-border-soft p-4" data-testid={`tooling-vendor-rule-${rule.vendorKey}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-gold">{rule.vendorKey}</span>
        <MonoChip tone={sums100 ? "green" : "red"} data-testid={`tooling-rule-sum-${rule.vendorKey}`}>
          {(100 + err).toFixed(2)}% {sums100 ? "" : err > 0 ? "over" : "under"}
        </MonoChip>
      </div>
      <div className="mt-3 grid gap-2">
        {splits.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <BucketPicker
              idPrefix={`rule-${rule.vendorKey}-${i}`}
              bucketType={s.bucketType}
              bucketRef={s.bucketRef}
              targets={targets}
              onType={(b) => setSplit(i, { bucketType: b, bucketRef: null })}
              onRef={(ref) => setSplit(i, { bucketRef: ref })}
            />
            <input
              type="number"
              value={Number.isFinite(s.pct) ? s.pct : ""}
              onChange={(e) => setSplit(i, { pct: Number(e.target.value) })}
              className="w-20 rounded border border-border bg-bg p-1.5 text-xs font-mono text-text"
              data-testid={`tooling-rule-pct-${rule.vendorKey}-${i}`}
            />
            <span className="text-[11px] text-text-faint">%</span>
            {canWrite && splits.length > 1 && (
              <button
                type="button"
                className="text-[11px] text-danger hover:underline"
                onClick={() => removeRow(i)}
                data-testid={`tooling-rule-remove-${rule.vendorKey}-${i}`}
              >
                remove
              </button>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="mt-3 flex items-center gap-2">
          <PillButton variant="ghost" onClick={addRow} data-testid={`tooling-rule-add-${rule.vendorKey}`}>
            Add split
          </PillButton>
          <PillButton onClick={save} disabled={!canSave} data-testid={`tooling-rule-save-${rule.vendorKey}`}>
            {busy ? "Saving…" : "Save rule"}
          </PillButton>
          {!sums100 && (
            <span className="text-[11px] text-danger">Splits must sum to 100%.</span>
          )}
          {sums100 && !refsOk && (
            <span className="text-[11px] text-danger">Pick a target for each delivery / BD split.</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── (d) Invoice detail panel ───────────────────────────────────────────
function InvoicePanel({
  invoiceId,
  canWrite,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState<null | "approve" | "extract">(null);

  const q = useQuery<InvoiceDetailResp>({
    queryKey: ["finance", "tooling", "invoice", invoiceId],
    queryFn: () => getJson<InvoiceDetailResp>(`/finance/tooling/invoices/${encodeURIComponent(invoiceId)}`),
  });

  const refetchPanel = () =>
    qc.invalidateQueries({ queryKey: ["finance", "tooling", "invoice", invoiceId] });

  const approve = async () => {
    setBusy("approve");
    try {
      const r = await fetch(
        `${API_BASE}/finance/tooling/invoices/${encodeURIComponent(invoiceId)}/approve`,
        { method: "POST", credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!r.ok) {
        // The server explains 409s (e.g. "2 projects need a home before
        // approval: …") — surface its message instead of a bare status code.
        const errBody = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message || `http_${r.status}`);
      }
      const body = (await r.json()) as { ok: boolean; data: { approvedCount: number } };
      toast({ title: "Splits approved", description: `${body.data?.approvedCount ?? 0} split(s)` });
      refetchPanel();
      onChanged();
    } catch (e) {
      toast({ title: "Approve failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const reExtract = async () => {
    setBusy("extract");
    try {
      const r = await fetch(
        `${API_BASE}/finance/tooling/invoices/${encodeURIComponent(invoiceId)}/extract`,
        { method: "POST", credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Re-extraction queued" });
      refetchPanel();
      onChanged();
    } catch (e) {
      toast({ title: "Re-extract failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const d = q.data?.ok ? q.data.data : null;
  const extraction = d?.extraction ?? null;
  const splits = d?.splits ?? [];
  const allProposed = splits.length > 0 && splits.every((s) => s.status === "proposed");
  const canApprove = canWrite && allProposed && busy === null;
  const canReExtract =
    canWrite &&
    busy === null &&
    (extraction?.status === "failed" || extraction?.status === "unreconciled");

  return (
    <div
      className="mt-4 rounded border border-gold/40 bg-bg-elevate/40 p-4"
      data-testid={`tooling-invoice-panel-${invoiceId}`}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">
          Invoice · {invoiceId}
        </div>
        <button
          type="button"
          className="text-[11px] text-text-mute hover:text-text"
          onClick={onClose}
          data-testid={`tooling-invoice-close-${invoiceId}`}
        >
          close
        </button>
      </div>

      {q.isLoading && <div className="mt-3 text-sm text-text-mute">Loading invoice…</div>}
      {q.isError && (
        <div className="mt-3 text-sm text-danger" data-testid={`tooling-invoice-error-${invoiceId}`}>
          Failed to load invoice.
        </div>
      )}

      {d && (
        <>
          <div className="mt-2 text-sm font-medium">
            {d.supplierName} · {d.reference}
          </div>

          {/* Extraction */}
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Extraction</span>
              {extraction ? (
                <MonoChip
                  tone={extraction.status === "ok" ? "green" : extraction.status === "unreconciled" ? "amber" : "red"}
                  data-testid={`tooling-extraction-status-${invoiceId}`}
                >
                  {extraction.status}
                </MonoChip>
              ) : (
                <MonoChip data-testid={`tooling-extraction-status-${invoiceId}`}>none</MonoChip>
              )}
            </div>
            {extraction && (
              <>
                {extraction.note && <div className="mt-1 text-xs text-text-mute italic">{extraction.note}</div>}
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs" data-testid={`tooling-extraction-items-${invoiceId}`}>
                    <thead>
                      <tr className="text-left font-mono text-[10px] uppercase text-text-faint">
                        <th className="py-1 pr-3">Project</th>
                        <th className="py-1 pr-3">Category</th>
                        <th className="py-1 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraction.items.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-2 text-text-mute">No line items extracted.</td>
                        </tr>
                      ) : (
                        extraction.items.map((it, i) => (
                          <tr key={i} className="border-t border-border-soft/50">
                            <td className="py-1 pr-3">{it.projectLabel}</td>
                            <td className="py-1 pr-3 text-text-mute">{it.category}</td>
                            <td className="py-1 text-right font-mono">
                              {extraction.currency} {it.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-1 text-[11px] font-mono text-text-faint">
                  subtotal {extraction.currency} {extraction.subtotal.toLocaleString()} · VAT{" "}
                  {extraction.vatAmount.toLocaleString()} · credits {extraction.creditsTotal.toLocaleString()}
                </div>
              </>
            )}
          </div>

          {/* Splits */}
          <div className="mt-4">
            <span className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Cost splits</span>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs" data-testid={`tooling-splits-${invoiceId}`}>
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase text-text-faint">
                    <th className="py-1 pr-3">Bucket</th>
                    <th className="py-1 pr-3 text-right">Gross</th>
                    <th className="py-1 pr-3 text-right">Credit</th>
                    <th className="py-1 pr-3 text-right">VAT</th>
                    <th className="py-1 pr-3 text-right">Net</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-2 text-text-mute" data-testid={`tooling-splits-empty-${invoiceId}`}>
                        No splits proposed yet.
                      </td>
                    </tr>
                  ) : (
                    splits.map((s) => (
                      <tr key={s.id} className="border-t border-border-soft/50">
                        <td className="py-1 pr-3">
                          <span>{s.bucketLabel || BUCKET_LABEL[s.bucketType] || s.bucketType}</span>
                          <span className="ml-1 text-text-faint">· {s.projectLabel}</span>
                        </td>
                        <td className="py-1 pr-3 text-right font-mono">{fmtUsd(s.grossUsd)}</td>
                        <td className="py-1 pr-3 text-right font-mono">{fmtUsd(s.creditUsd)}</td>
                        <td className="py-1 pr-3 text-right font-mono">{fmtUsd(s.vatUsd)}</td>
                        <td className="py-1 pr-3 text-right font-mono">{fmtUsd(s.netUsd)}</td>
                        <td className="py-1">
                          <MonoChip tone={s.status === "approved" ? "green" : "amber"}>{s.status}</MonoChip>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          {canWrite && (
            <div className="mt-4 flex items-center gap-2">
              <PillButton
                onClick={approve}
                disabled={!canApprove}
                data-testid={`tooling-approve-${invoiceId}`}
              >
                {busy === "approve" ? "Approving…" : "Approve splits"}
              </PillButton>
              {canReExtract && (
                <PillButton
                  variant="ghost"
                  onClick={reExtract}
                  disabled={busy !== null}
                  data-testid={`tooling-reextract-${invoiceId}`}
                >
                  <span className="inline-flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" />
                    {busy === "extract" ? "Re-extracting…" : "Re-extract"}
                  </span>
                </PillButton>
              )}
              {!allProposed && splits.length > 0 && (
                <span className="text-[11px] text-text-mute">
                  Approve is enabled only when every split is still proposed.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
