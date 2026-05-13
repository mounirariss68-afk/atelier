import * as React from "react";
import { useParams } from "wouter";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface RollupRow {
  partnerFirmId: string;
  hours: number;
  costAmount: number;
  costCurrency: string;
}

interface HoursRow {
  id: string;
  partnerFirmId: string;
  resourceName: string;
  weekIso: string;
  hours: number;
  costAmount: number;
  costCurrency: string;
  uploadedAt: string;
}

interface EconResp {
  engagementId: string;
  engagementName: string;
  partnerFirmRollup: RollupRow[];
  rows: HoursRow[];
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export default function EngagementEconomics() {
  const params = useParams<{ engagementId: string }>();
  const engagementId = params.engagementId;
  const [data, setData] = React.useState<EconResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadMsg, setUploadMsg] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/ledger/engagement-economics/${engagementId}`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`/api/atelier/ledger/partner-firm-hours/${engagementId}`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setUploadMsg(`Uploaded ${j.rows ?? 0} rows (batch ${j.batchRef ?? "?"}).`);
      await load();
    } catch (err) {
      setUploadMsg(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <PageHero>
        <div className="flex items-start justify-between gap-4">
          <SectionHead
            eyebrow={<MonoChip tone="gold">Ledger · Engagement economics</MonoChip>}
            headline={data?.engagementName ?? engagementId}
            lede="Partner-firm hours roll-up + commercial cost view. Upload a CSV (resource_name, partner_firm_id, week_iso, hours, cost_amount, cost_currency) to record this week's hours."
          />
          <div className="flex flex-col items-end gap-2">
            <PillButton onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload CSV"}
            </PillButton>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onUpload}
            />
            {uploadMsg && <span className="text-xs text-text-mute">{uploadMsg}</span>}
          </div>
        </div>
      </PageHero>

      {error && <Card className="border-red-500/40 p-3 text-sm text-red-300">{error}</Card>}
      {loading && <Card className="p-4 text-text-mute">Loading…</Card>}

      {data && (
        <>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Roll-up by partner firm</h3>
            {data.partnerFirmRollup.length === 0 ? (
              <p className="text-sm text-text-mute">No partner-firm hours recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Firm</th>
                    <th className="py-1 text-right">Hours</th>
                    <th className="py-1 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.partnerFirmRollup.map((r) => (
                    <tr key={r.partnerFirmId} className="border-t border-white/5">
                      <td className="py-2"><MonoChip>{r.partnerFirmId || "—"}</MonoChip></td>
                      <td className="py-2 text-right">{r.hours}</td>
                      <td className="py-2 text-right">{fmtMoney(r.costAmount, r.costCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-mute">Detail rows</h3>
            {data.rows.length === 0 ? (
              <p className="text-sm text-text-mute">No rows.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-text-mute">
                  <tr>
                    <th className="py-1">Week</th>
                    <th className="py-1">Firm</th>
                    <th className="py-1">Resource</th>
                    <th className="py-1 text-right">Hours</th>
                    <th className="py-1 text-right">Cost</th>
                    <th className="py-1">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-white/5">
                      <td className="py-2"><MonoChip>{r.weekIso}</MonoChip></td>
                      <td className="py-2"><MonoChip>{r.partnerFirmId || "—"}</MonoChip></td>
                      <td className="py-2">{r.resourceName}</td>
                      <td className="py-2 text-right">{r.hours}</td>
                      <td className="py-2 text-right">{fmtMoney(r.costAmount, r.costCurrency)}</td>
                      <td className="py-2 text-text-mute text-xs">{new Date(r.uploadedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
