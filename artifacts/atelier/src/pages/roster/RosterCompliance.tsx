import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RosterNav } from "./RosterNav";
import { PersonPicker, PartnerFirmSelect, JurisdictionSelect } from "./rosterPickers";

interface ComplianceRecord {
  id: string;
  kind: string;
  jurisdiction: string | null;
  personType: string | null;
  personId: string | null;
  personName: string | null;
  partnerFirmId: string | null;
  referenceNumberRedacted: string | null;
  referenceNumberLastFour: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  status: string;
  metadata: Record<string, unknown>;
  bucket: "expired" | "expiring_30" | "expiring_60" | "expiring_90" | "ok";
}

interface ApiResp {
  horizonDays: number;
  buckets: Record<string, number>;
  // Task #1171 — partner-firm records roll up separately from workers.
  partnerBuckets?: Record<string, number>;
  records: ComplianceRecord[];
  saudization: Array<{
    id: string;
    partnerFirmId: string | null;
    required: number | null;
    actual: number | null;
    status: string;
  }>;
}

const BUCKET_TONE: Record<ComplianceRecord["bucket"], "default" | "gold" | "green" | "amber" | "red"> = {
  expired: "red",
  expiring_30: "red",
  expiring_60: "amber",
  expiring_90: "gold",
  ok: "green",
};

const KINDS = ["visa", "iqama", "gosi", "wps", "difc", "adgm", "ksa_cr", "saudization", "master_agreement", "cert"];

export default function RosterCompliance(): React.ReactElement {
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState({
    personId: "",
    partnerFirmId: "",
    personType: "" as "" | "employee" | "contractor" | "partner_firm_resource",
    kind: "iqama",
    jurisdiction: "KSA",
    referenceNumber: "",
    issuedDate: "",
    expiryDate: "",
  });

  const reload = React.useCallback(() => {
    fetch("/api/atelier/roster/compliance?horizonDays=90", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ horizonDays: 90, buckets: {}, partnerBuckets: {}, records: [], saudization: [] }));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const submit = async () => {
    setBusy(true);
    try {
      await fetch("/api/atelier/roster/compliance", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          personType: draft.personType || null,
          personId: draft.personId || null,
          partnerFirmId: draft.partnerFirmId || null,
        }),
      });
      setDraft({ ...draft, referenceNumber: "", expiryDate: "" });
      reload();
    } finally {
      setBusy(false);
    }
  };

  const runSteward = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/atelier/roster/steward/run", {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json();
      alert(`Roster Steward: scanned ${d.scanned}, emitted ${d.emitted} Pane A items.`);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="px-8 py-12 text-text-mute">Loading…</div>;

  // Task #1171 — partner-firm people are not our workers: their records
  // (and firm-level partner records) render in a separate section so the
  // worker buckets reflect employees/contractors/our entities only.
  const isPartnerRecord = (r: ComplianceRecord) =>
    r.personType === "partner_firm_resource" || (!r.personId && !!r.partnerFirmId);
  const workerRecords = data.records.filter((r) => !isPartnerRecord(r));
  const partnerRecords = data.records.filter(isPartnerRecord);

  return (
    <div>
      <PageHero>
        <SectionHead
          eyebrow="The Roster"
          headline="Compliance"
          lede="GCC registrations, master agreements, visa & Iqama expirations. Reference numbers are stored redacted (last four only) — raw numbers are never persisted."
        />
      </PageHero>
      <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <RosterNav />

      <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-2">
        Our workers & entities
      </p>
      <div className="grid gap-3 md:grid-cols-5 mb-6">
        {(["expired", "expiring_30", "expiring_60", "expiring_90", "ok"] as const).map((b) => (
          <Card key={b} className="p-4 text-center" data-testid={`bucket-${b}`}>
            <div className="text-2xl font-mono">{data.buckets[b] ?? 0}</div>
            <div className="text-text-mute text-[11px] uppercase font-mono mt-1">{b.replace("_", " ")}</div>
          </Card>
        ))}
      </div>

      <div className="flex justify-end mb-4">
        <Button variant="outline" onClick={runSteward} disabled={busy} data-testid="run-steward">
          Run Roster Steward
        </Button>
      </div>

      <Card className="p-4 mb-6 space-y-3" data-testid="compliance-form">
        <h3 className="font-mono text-xs uppercase text-text-mute">Record compliance entry</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Kind</span>
            <select
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Jurisdiction</span>
            <JurisdictionSelect
              value={draft.jurisdiction}
              onChange={(v) => setDraft({ ...draft, jurisdiction: v })}
              testId="compliance-jurisdiction"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Person type</span>
            <select
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.personType}
              onChange={(e) =>
                setDraft({ ...draft, personType: e.target.value as typeof draft.personType })
              }
            >
              <option value="">(entity-level)</option>
              <option value="employee">employee</option>
              <option value="contractor">contractor</option>
              <option value="partner_firm_resource">partner_firm_resource</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Person</span>
            <PersonPicker
              value={draft.personId}
              onChange={(id) => setDraft({ ...draft, personId: id })}
              testId="compliance-personid"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Partner firm</span>
            <PartnerFirmSelect
              value={draft.partnerFirmId}
              onChange={(id) => setDraft({ ...draft, partnerFirmId: id })}
              testId="compliance-partner-firm"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">
              Reference # (raw — redacted server-side)
            </span>
            <Input
              value={draft.referenceNumber}
              onChange={(e) => setDraft({ ...draft, referenceNumber: e.target.value })}
              data-testid="compliance-ref"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Issued</span>
            <Input
              type="date"
              value={draft.issuedDate}
              onChange={(e) => setDraft({ ...draft, issuedDate: e.target.value })}
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Expiry</span>
            <Input
              type="date"
              value={draft.expiryDate}
              onChange={(e) => setDraft({ ...draft, expiryDate: e.target.value })}
            />
          </label>
        </div>
        <Button onClick={submit} disabled={busy || !draft.kind} data-testid="compliance-submit">
          Record
        </Button>
      </Card>

      <div className="space-y-2">
        {workerRecords.length === 0 && (
          <div className="text-text-mute py-8 italic">No compliance records yet.</div>
        )}
        {workerRecords.map((r) => (
          <ComplianceRow key={r.id} r={r} />
        ))}
      </div>

      {/* Task #1171 — partner-firm people are compliance-tracked, but they
          are not our workers; they get their own section and roll-up. */}
      {partnerRecords.length > 0 && (
        <div className="mt-10" data-testid="partner-compliance-section">
          <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-2">
            Partner-firm people & firms
          </p>
          <div className="grid gap-3 md:grid-cols-5 mb-4">
            {(["expired", "expiring_30", "expiring_60", "expiring_90", "ok"] as const).map((b) => (
              <Card key={b} className="p-4 text-center" data-testid={`partner-bucket-${b}`}>
                <div className="text-2xl font-mono">{data.partnerBuckets?.[b] ?? 0}</div>
                <div className="text-text-mute text-[11px] uppercase font-mono mt-1">{b.replace("_", " ")}</div>
              </Card>
            ))}
          </div>
          <div className="space-y-2">
            {partnerRecords.map((r) => (
              <ComplianceRow key={r.id} r={r} partner />
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function ComplianceRow({ r, partner }: { r: ComplianceRecord; partner?: boolean }) {
  return (
    <Card
      className="p-4 flex items-start justify-between gap-4"
      data-testid={`compliance-row-${r.id}`}
    >
      <div className="space-y-1">
        <div className="font-medium">
          {r.kind.toUpperCase()}
          {r.jurisdiction ? ` · ${r.jurisdiction}` : ""}
        </div>
        <div className="text-text-mute text-xs">
          {r.personId ? (
            <Link href={`/roster/people/${r.personId}`} className="hover:text-gold">
              {r.personName ?? r.personId}
            </Link>
          ) : (
            <span>{r.partnerFirmId ?? "entity-level"}</span>
          )}
          {partner && (
            <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-purple-400 border border-purple-400/40 rounded px-1">
              Partner firm
            </span>
          )}
          {r.referenceNumberRedacted && (
            <span className="ml-2 font-mono">ref {r.referenceNumberRedacted}</span>
          )}
        </div>
        <div className="flex gap-1 mt-1">
          <MonoChip tone={BUCKET_TONE[r.bucket]}>{r.bucket}</MonoChip>
          {r.expiryDate && <MonoChip>expires {r.expiryDate}</MonoChip>}
        </div>
      </div>
    </Card>
  );
}
