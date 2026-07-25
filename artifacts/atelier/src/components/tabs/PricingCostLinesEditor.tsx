import * as React from "react";
import type { AtelierPricingCostLine } from "@workspace/api-client-react";
import { Card } from "@/components/ui/primitives";
import { fieldControlCls } from "@/components/ui/fieldControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

export type CostLineDraft = AtelierPricingCostLine;

const COST_TYPE_LABELS: Record<string, string> = {
  llm_ai: "LLM / AI usage",
  hardware_infra: "Hardware / infra",
  alliance_partner_quote: "Alliance partner quote",
  travel: "Travel",
  other: "Other",
};
const COST_TYPES = Object.keys(COST_TYPE_LABELS);
const RECURRENCES = ["one_time", "weekly", "monthly"] as const;

export function PricingCostLinesEditor({
  lines,
  onChange,
}: {
  lines: CostLineDraft[];
  onChange: (next: CostLineDraft[]) => void;
}) {
  const edit = (i: number, patch: Partial<CostLineDraft>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(lines.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...lines,
      { type: "other", amountUsd: 0, recurrence: "one_time", passThrough: false, label: "" },
    ]);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
          Non-labor cost lines
        </h3>
        <Button variant="outline" size="sm" onClick={add} data-testid="button-add-cost-line">
          <Plus className="w-3 h-3 mr-1" /> Cost line
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="text-xs text-text-mute">
          LLM usage, hardware, alliance partner quotes, travel. Absorbed lines fold into cost and
          margin; pass-through lines are re-invoiced at cost and stay out of margin.
        </p>
      ) : (
        <div className="border border-border-soft rounded-md divide-y divide-border-soft">
          {lines.map((line, i) => (
            <div key={i} className="px-4 py-2 space-y-2" data-testid={`row-cost-line-${i}`}>
              <div className="grid grid-cols-12 gap-2 items-center">
                <select
                  value={line.type}
                  onChange={(e) => edit(i, { type: e.target.value as CostLineDraft["type"] })}
                  className={`${fieldControlCls} col-span-3 bg-bg-elevate border border-border rounded-md text-text text-sm`}
                  data-testid={`select-cost-type-${i}`}
                >
                  {COST_TYPES.map((t) => (
                    <option key={t} value={t}>{COST_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <Input
                  placeholder="Label (e.g. Claude API)"
                  value={line.label ?? ""}
                  onChange={(e) => edit(i, { label: e.target.value })}
                  className="col-span-3 bg-bg-elevate border-border text-text"
                  data-testid={`input-cost-label-${i}`}
                />
                <Input
                  type="number"
                  min={0}
                  value={line.amountUsd}
                  onChange={(e) => edit(i, { amountUsd: parseFloat(e.target.value) || 0 })}
                  className="col-span-2 bg-bg-elevate border-border text-text"
                  data-testid={`input-cost-amount-${i}`}
                />
                <select
                  value={line.recurrence ?? "one_time"}
                  onChange={(e) =>
                    edit(i, { recurrence: e.target.value as CostLineDraft["recurrence"] })
                  }
                  className={`${fieldControlCls} col-span-2 bg-bg-elevate border border-border rounded-md text-text text-sm`}
                  data-testid={`select-cost-recurrence-${i}`}
                >
                  {RECURRENCES.map((r) => (
                    <option key={r} value={r}>{r.replace("_", "-")}</option>
                  ))}
                </select>
                <label className="col-span-1 flex items-center gap-1 text-[10px] font-mono uppercase text-text-mute">
                  <input
                    type="checkbox"
                    checked={!!line.passThrough}
                    onChange={(e) => edit(i, { passThrough: e.target.checked })}
                    data-testid={`checkbox-passthrough-${i}`}
                  />
                  Pass
                </label>
                <button
                  onClick={() => remove(i)}
                  className="col-span-1 text-text-faint hover:text-danger transition-colors justify-self-end"
                  data-testid={`button-remove-cost-${i}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {line.type === "alliance_partner_quote" && (
                <div className="text-[10px] text-text-faint font-mono pl-1">
                  Partner quote — verify the quoted amount before billing handoff.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {lines.length > 0 && (
        <div className="text-[11px] text-text-faint font-mono">
          Absorbed {fmtUsd(sumBy(lines, (l) => (l.passThrough ? 0 : l.amountUsd)))} · Pass-through{" "}
          {fmtUsd(sumBy(lines, (l) => (l.passThrough ? l.amountUsd : 0)))} per occurrence
        </div>
      )}
    </Card>
  );
}

function sumBy<T>(arr: T[], f: (t: T) => number): number {
  return arr.reduce((s, x) => s + f(x), 0);
}
const fmtUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

// ---------------------------------------------------------------
// Structure settings: band weights + outcome variant parameters.
// Stored inside structureParams alongside the existing knobs.
// ---------------------------------------------------------------

export type StructureParamsDraft = Record<string, unknown> & {
  bandWeights?: { best?: number; expected?: number; worst?: number };
  outcomeVariant?: string;
  gainShare?: Record<string, unknown>;
  volume?: Record<string, unknown>;
  sla?: Record<string, unknown>;
  successFee?: Record<string, unknown>;
};

const VARIANT_LABELS: Record<string, string> = {
  generic: "Generic fee-at-risk",
  gain_share: "Value / gain-share",
  volume_unit: "Volume / per-unit",
  sla_based: "SLA credit / penalty",
  success_fee: "Success fee",
};

export function PricingStructureSettings({
  params,
  onChange,
  pricingModel,
}: {
  params: StructureParamsDraft;
  onChange: (next: StructureParamsDraft) => void;
  pricingModel: string;
}) {
  const weights = params.bandWeights ?? {};
  const setWeight = (k: "best" | "expected" | "worst", v: number) =>
    onChange({ ...params, bandWeights: { ...weights, [k]: v } });
  const isOutcome = pricingModel === "outcome_based" || pricingModel === "hybrid";
  const variant = (params.outcomeVariant as string) ?? "generic";

  const setVariantParams = (key: "gainShare" | "volume" | "sla" | "successFee", patch: Record<string, unknown>) =>
    onChange({ ...params, [key]: { ...(params[key] as Record<string, unknown> | undefined), ...patch } });

  const num = (v: unknown): number | "" => (typeof v === "number" && Number.isFinite(v) ? v : "");

  const gs = (params.gainShare ?? {}) as Record<string, unknown>;
  const vol = (params.volume ?? {}) as Record<string, unknown>;
  const sla = (params.sla ?? {}) as Record<string, unknown>;
  const sf = (params.successFee ?? {}) as Record<string, unknown>;
  const slaBands = Array.isArray(sla.bands) ? (sla.bands as Array<{ creditPct?: number }>) : [];
  const worstCredit = slaBands.length > 1 ? slaBands[slaBands.length - 1]?.creditPct ?? 0 : 0;

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
        Structure settings
      </h3>
      <div className="space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
          Scenario band weights (normalized on save · default 0.2 / 0.6 / 0.2)
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(["best", "expected", "worst"] as const).map((k) => (
            <label key={k} className="text-xs text-text-mute font-mono uppercase tracking-widest">
              {k}
              <Input
                type="number"
                min={0}
                step={0.05}
                value={num(weights[k]) === "" ? (k === "expected" ? 0.6 : 0.2) : (weights[k] as number)}
                onChange={(e) => setWeight(k, parseFloat(e.target.value) || 0)}
                className="bg-bg-elevate border-border text-text mt-1"
                data-testid={`input-weight-${k}`}
              />
            </label>
          ))}
        </div>
      </div>

      {isOutcome && (
        <div className="space-y-3 pt-3 border-t border-border-soft">
          <label className="text-xs text-text-mute font-mono uppercase tracking-widest block">
            Outcome mechanic
            <select
              value={variant}
              onChange={(e) => onChange({ ...params, outcomeVariant: e.target.value })}
              className={`${fieldControlCls} mt-1 bg-bg-elevate border border-border rounded-md text-text text-sm`}
              data-testid="select-outcome-variant"
            >
              {Object.entries(VARIANT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>

          {variant === "gain_share" && (
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Share of gain (0–1)" value={num(gs.sharePct)} testId="input-gs-share"
                onChange={(v) => setVariantParams("gainShare", { sharePct: v })} step={0.05} />
              <NumField label="Base fee $" value={num(gs.baseFeeUsd)} testId="input-gs-base"
                onChange={(v) => setVariantParams("gainShare", { baseFeeUsd: v })} />
              <NumField label="Cap $" value={num(gs.capUsd)} testId="input-gs-cap"
                onChange={(v) => setVariantParams("gainShare", { capUsd: v })} />
              <NumField label="Improvement best $" value={num(gs.improvementBestUsd)} testId="input-gs-best"
                onChange={(v) => setVariantParams("gainShare", { improvementBestUsd: v })} />
              <NumField label="Improvement expected $" value={num(gs.improvementExpectedUsd)} testId="input-gs-expected"
                onChange={(v) => setVariantParams("gainShare", { improvementExpectedUsd: v })} />
              <NumField label="Improvement worst $" value={num(gs.improvementWorstUsd)} testId="input-gs-worst"
                onChange={(v) => setVariantParams("gainShare", { improvementWorstUsd: v })} />
            </div>
          )}

          {variant === "volume_unit" && (
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Price per unit $" value={num(vol.pricePerUnit)} testId="input-vol-price"
                onChange={(v) => setVariantParams("volume", { pricePerUnit: v })} />
              <NumField label="Minimum fee $" value={num(vol.minimumFeeUsd)} testId="input-vol-min"
                onChange={(v) => setVariantParams("volume", { minimumFeeUsd: v })} />
              <div />
              <NumField label="Units best" value={num(vol.unitsBest)} testId="input-vol-best"
                onChange={(v) => setVariantParams("volume", { unitsBest: v })} />
              <NumField label="Units expected" value={num(vol.unitsExpected)} testId="input-vol-expected"
                onChange={(v) => setVariantParams("volume", { unitsExpected: v })} />
              <NumField label="Units worst" value={num(vol.unitsWorst)} testId="input-vol-worst"
                onChange={(v) => setVariantParams("volume", { unitsWorst: v })} />
            </div>
          )}

          {variant === "sla_based" && (
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Base fee $" value={num(sla.baseFeeUsd)} testId="input-sla-base"
                onChange={(v) => setVariantParams("sla", { baseFeeUsd: v })} />
              <NumField label="Worst-case credit (0–1)" value={worstCredit} testId="input-sla-credit" step={0.05}
                onChange={(v) =>
                  setVariantParams("sla", { bands: [{ label: "Met", creditPct: 0 }, { label: "Missed", creditPct: v }] })
                } />
            </div>
          )}

          {variant === "success_fee" && (
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Base fee $" value={num(sf.baseFeeUsd)} testId="input-sf-base"
                onChange={(v) => setVariantParams("successFee", { baseFeeUsd: v })} />
              <NumField label="Success fee $" value={num(sf.successFeeUsd)} testId="input-sf-fee"
                onChange={(v) => setVariantParams("successFee", { successFeeUsd: v })} />
              <NumField label="Success probability (0–1)" value={num(sf.successProbabilityPct)} testId="input-sf-prob" step={0.05}
                onChange={(v) => setVariantParams("successFee", { successProbabilityPct: v })} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function NumField({
  label,
  value,
  onChange,
  testId,
  step,
}: {
  label: string;
  value: number | "";
  onChange: (v: number) => void;
  testId: string;
  step?: number;
}) {
  return (
    <label className="text-xs text-text-mute font-mono uppercase tracking-widest">
      {label}
      <Input
        type="number"
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="bg-bg-elevate border-border text-text mt-1"
        data-testid={testId}
      />
    </label>
  );
}
