import { useState, useMemo } from "react";
import { useDemoLang, tBi } from "../DemoLangContext";
import { whatif as wDict, t as tr } from "../value-realization-i18n";
import { useValueRealizationData } from "@/hooks/useValueRealizationData";
import { forecastRealised, formatAED } from "@/data/value-realization-agent";
import { BRAND, BRAND_INK, NAVY, SEMANTIC } from "../tokens";

export default function WhatIfView() {
  const { lang } = useDemoLang();
  const { initiatives } = useValueRealizationData();
  const [pickedId, setPickedId] = useState<string>(initiatives[0]?.id ?? "");
  const init = initiatives.find((i) => i.id === pickedId) ?? initiatives[0];
  const [adoption, setAdoption] = useState<number>(init?.adoption ?? 50);
  const [shift, setShift] = useState<number>(0);

  const forecast = useMemo(() => init ? forecastRealised(init, adoption, shift) : 0, [init, adoption, shift]);
  const delta = init ? forecast - init.realizedAnnual : 0;

  if (!init) return <div className="text-sm text-gray-500">No initiatives.</div>;

  const reset = () => {
    setAdoption(init.adoption);
    setShift(0);
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: NAVY }} data-testid="text-whatif-title">{tr(wDict, "title", lang)}</h1>
        <p className="text-sm text-gray-500">{tr(wDict, "subtitle", lang)}</p>
      </header>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-4" data-testid="whatif-controls">
        <div>
          <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{tr(wDict, "pickInitiative", lang)}</label>
          <select
            value={pickedId}
            onChange={(e) => {
              setPickedId(e.target.value);
              const i = initiatives.find((x) => x.id === e.target.value);
              if (i) { setAdoption(i.adoption); setShift(0); }
            }}
            className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            data-testid="select-initiative"
          >
            {initiatives.map((i) => (
              <option key={i.id} value={i.id}>{tBi(i.name, lang)}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <label className="font-semibold text-gray-600">{tr(wDict, "adoptionLabel", lang)}</label>
            <span className="font-bold" style={{ color: BRAND_INK }}>{adoption}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={adoption}
            onChange={(e) => setAdoption(Number(e.target.value))}
            className="w-full"
            data-testid="slider-adoption"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <label className="font-semibold text-gray-600">{tr(wDict, "goLiveLabel", lang)}</label>
            <span className="font-bold" style={{ color: BRAND_INK }}>{shift > 0 ? `+${shift}` : shift}d</span>
          </div>
          <input
            type="range"
            min={-90}
            max={180}
            step={1}
            value={shift}
            onChange={(e) => setShift(Number(e.target.value))}
            className="w-full"
            data-testid="slider-shift"
          />
        </div>

        <button onClick={reset} className="text-xs font-semibold text-gray-500 hover:text-gray-800" data-testid="button-reset">
          {tr(wDict, "reset", lang)}
        </button>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Tile label={tr(wDict, "currentLabel", lang)} value={formatAED(init.realizedAnnual)} tone="ink" />
        <Tile label={tr(wDict, "forecastedLabel", lang)} value={formatAED(forecast)} sub={`${delta >= 0 ? "+" : ""}${formatAED(delta, { withCurrency: false })} ${tr(wDict, "deltaLabel", lang)}`} tone={delta >= 0 ? "brand" : "critical"} />
        <Tile label={tr(wDict, "promisedLabel", lang)} value={formatAED(init.promisedAnnual)} tone="muted" />
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4" data-testid="whatif-bar">
        <p className="text-xs text-gray-500 mb-2">{tBi(init.name, lang)}</p>
        <div className="space-y-1.5">
          <Bar label={tr(wDict, "currentLabel", lang)} value={init.realizedAnnual} max={init.promisedAnnual} color="#9CA3AF" />
          <Bar label={tr(wDict, "forecastedLabel", lang)} value={forecast} max={init.promisedAnnual} color={BRAND} />
          <Bar label={tr(wDict, "promisedLabel", lang)} value={init.promisedAnnual} max={init.promisedAnnual} color={NAVY} />
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "ink" | "brand" | "muted" | "critical" }) {
  const styles: Record<typeof tone, React.CSSProperties> = {
    ink: { background: NAVY, color: "#FFFFFF" },
    brand: { background: BRAND, color: "#FFFFFF" },
    critical: { background: "#FEE2E2", color: SEMANTIC.critical },
    muted: { background: "#F3F4F6", color: NAVY },
  };
  return (
    <div className="rounded-xl p-4" style={styles[tone]}>
      <p className="text-[10px] uppercase font-bold tracking-wider opacity-80">{label}</p>
      <p className="text-xl font-extrabold mt-1">{value}</p>
      {sub && <p className="text-[10px] opacity-80 mt-1">{sub}</p>}
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = Math.max(2, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-gray-600 font-semibold">{label}</span>
        <span className="text-gray-500">{formatAED(value)}</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}
