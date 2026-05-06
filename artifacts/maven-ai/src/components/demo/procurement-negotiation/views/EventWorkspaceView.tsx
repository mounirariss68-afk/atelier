import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { CheckCircle2, FileText, ChevronRight } from "lucide-react";
import { useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { useProcurementDemoLang } from "../DemoLangContext";
import { workspace as t, events as et } from "../procurement-i18n";
import {
  totalForSupplier, tcoForSupplier, savingsPctVsBaseline,
  getBid, totalBaseline, SARm, type LineItem,
} from "@/data/procurement-negotiation-seed";
import {
  generateRoundSummaries, landedCostForSplit, generateAwardMemo,
} from "@/data/procurement-negotiation-agent";
import { BRAND, BRAND_MUTED, NAVY, SEMANTIC } from "../tokens";

type CostView = "price" | "tco";

export default function EventWorkspaceView() {
  const { suppliers, lineItems, events } = useProcurementData();
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const event = events[0];

  const [costView, setCostView] = useState<CostView>("price");
  const [splitA, setSplitA] = useState(70);
  const [signed, setSigned] = useState(false);

  // Allow the AI chat ("Switch to TCO view" intent) to flip the matrix
  // mode. The shell-level event bus is a window CustomEvent so the chat
  // drawer (mounted at shell root) can talk to the workspace view without
  // a deeper context tree.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: CostView }>).detail;
      if (detail?.view === "tco" || detail?.view === "price") setCostView(detail.view);
    };
    window.addEventListener("procurement:set-cost-view", handler);
    return () => window.removeEventListener("procurement:set-cost-view", handler);
  }, []);

  // For the matrix, show top 8 suppliers + 8 line items (compact)
  const matrixSuppliers = suppliers.slice(0, 8);
  const matrixItems = lineItems.slice(0, 10);

  const supplierA = suppliers[0]; // sup-a
  const supplierB = suppliers[1]; // sup-b
  const totalAlone = costView === "tco" ? tcoForSupplier(supplierA.id, 3) : totalForSupplier(supplierA.id, 3);
  const landed = landedCostForSplit(supplierA.id, supplierB.id, splitA, costView);
  const savingsPct = savingsPctVsBaseline(landed);
  const baseline = totalBaseline();
  const memo = generateAwardMemo(lang);

  const rounds = generateRoundSummaries();
  const chartData = [
    { name: isAr ? "الأساس" : "Baseline", savings: 0 },
    { name: "R1", savings: rounds[0].savingsPct },
    { name: "R2", savings: rounds[1].savingsPct },
    { name: "R3", savings: rounds[2].savingsPct },
  ];

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
          <span>{event.refId}</span>
          <ChevronRight size={11} className={isAr ? "rotate-180" : ""} />
          <span>{isAr ? event.categoryAr : event.categoryEn}</span>
        </div>
        <h1 className="text-2xl font-bold text-[#0E2841]">{t.title[lang]}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.subtitle[lang]}</p>
      </header>

      {/* Faisal's morning callout */}
      <div className="rounded-xl p-4 border-l-[3px]" style={{ background: BRAND_MUTED, borderLeftColor: BRAND }}>
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>{t.storyHeader[lang]}</p>
        <p className="text-sm text-[#0E2841] mt-1">{t.storyBody[lang]}</p>
      </div>

      {/* Bid matrix */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-[#0E2841]">{t.bidMatrix[lang]}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{t.bidMatrixSub[lang]}</p>
          </div>
          <div className="flex bg-gray-100 rounded-full p-0.5 text-[11px] font-semibold">
            <button onClick={() => setCostView("price")} className={`px-3 py-1 rounded-full transition-colors ${costView === "price" ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500"}`}>{t.viewPrice[lang]}</button>
            <button onClick={() => setCostView("tco")} className={`px-3 py-1 rounded-full transition-colors ${costView === "tco" ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500"}`}>{t.viewTco[lang]}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <BidMatrix items={matrixItems} suppliers={matrixSuppliers} costView={costView} isAr={isAr} />
        </div>
      </section>

      {/* Round timeline + Allocation slider */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-[#0E2841]">{t.roundTimeline[lang]}</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-4">{t.roundTimelineSub[lang]}</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={36} unit="%" />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <ReferenceLine y={event.savingsTargetPct} stroke={SEMANTIC.warn} strokeDasharray="3 3" label={{ value: `${isAr ? "هدف" : "Target"} ${event.savingsTargetPct}%`, fontSize: 10, fill: SEMANTIC.warn, position: isAr ? "insideTopLeft" : "insideTopRight" }} />
                <Line type="monotone" dataKey="savings" stroke={BRAND} strokeWidth={2.5} dot={{ r: 4, fill: BRAND }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {rounds.map((r) => (
              <div key={r.round} className="bg-gray-50 rounded-lg p-2">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">{t.round[lang]} {r.round}</div>
                <div className="text-sm font-bold text-[#0E2841]">{r.savingsPct.toFixed(1)}%</div>
                <div className="text-[10px] text-gray-500">{r.participating} {t.participating[lang]}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-[#0E2841]">{t.allocation[lang]}</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-4">{t.allocationSub[lang]}</p>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: BRAND }} />
                  <span className="font-bold text-[#0E2841]">{isAr ? supplierA.nameAr : supplierA.nameEn}</span>
                  <span className="text-gray-400">{splitA}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{100 - splitA}%</span>
                  <span className="font-bold text-[#0E2841]">{isAr ? supplierB.nameAr : supplierB.nameEn}</span>
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#156082]" />
                </div>
              </div>
              <div className="relative h-3 rounded-full overflow-hidden bg-gray-100">
                <div className="h-full" style={{ width: `${splitA}%`, background: BRAND }} />
                <div className="absolute top-0 h-full bg-[#156082]" style={{ ...(isAr ? { right: `${splitA}%`, width: `${100 - splitA}%` } : { left: `${splitA}%`, width: `${100 - splitA}%` }) }} />
              </div>
              <input type="range" min={0} max={100} step={5} value={splitA} onChange={(e) => setSplitA(Number(e.target.value))} className="w-full mt-2 accent-[#D9534F]" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Tile label={t.landed[lang]} value={SARm(landed)} />
              <Tile label={t.savingsVsBase[lang]} value={`${savingsPct.toFixed(1)}%`} highlight={savingsPct >= event.savingsTargetPct ? "good" : "warn"} />
              <Tile label={isAr ? "100% للمورد A" : "100% to Supplier A"} value={SARm(totalAlone)} />
              <Tile label={isAr ? "الأساس" : "Baseline"} value={SARm(baseline)} />
            </div>
          </div>
        </section>
      </div>

      {/* Award memo + sign */}
      <section className="bg-white border-2 rounded-xl p-5" style={{ borderColor: signed ? SEMANTIC.good : BRAND }}>
        <div className="flex items-start gap-3">
          <FileText size={18} style={{ color: signed ? SEMANTIC.good : BRAND }} />
          <div className="flex-1">
            <h2 className="text-sm font-bold text-[#0E2841]">{t.awardMemo[lang]}</h2>
            <p className="text-[12px] font-bold text-[#0E2841] mt-2">{memo.headline}</p>
            <ul className="text-[12px] text-gray-700 list-disc list-inside mt-1.5 space-y-1">
              {memo.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            {signed && (
              <div className="mt-3 flex items-center gap-2 text-[12px] font-semibold" style={{ color: SEMANTIC.good }}>
                <CheckCircle2 size={14} /> {t.awardSigned[lang]}
              </div>
            )}
          </div>
          <button
            onClick={() => setSigned(true)}
            disabled={signed}
            className="px-4 py-2 rounded-lg text-white text-xs font-bold disabled:opacity-50"
            style={{ background: signed ? SEMANTIC.good : BRAND }}
          >
            {signed ? t.awardSigned[lang] : t.signAward[lang]}
          </button>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: "good" | "warn" }) {
  const color = highlight === "good" ? SEMANTIC.good : highlight === "warn" ? SEMANTIC.warn : "#0E2841";
  return (
    <div className="bg-gray-50 rounded-lg p-2.5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold mt-1" style={{ color }}>{value}</div>
    </div>
  );
}

function BidMatrix({ items, suppliers, costView, isAr }: { items: LineItem[]; suppliers: ReturnType<typeof useProcurementData>["suppliers"]; costView: CostView; isAr: boolean }) {
  // Per-supplier TCO multiplier: applied per-cell so the matrix actually
  // re-renders when the user toggles to TCO mode. Equivalent to the ratio
  // tcoForSupplier(R3) / totalForSupplier(R3), so cell ordering matches
  // the supplier-level TCO numbers used elsewhere in the workspace.
  const tcoMult: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of suppliers) {
      const total = totalForSupplier(s.id, 3);
      const tco = tcoForSupplier(s.id, 3);
      m[s.id] = total > 0 ? tco / total : 1;
    }
    return m;
  }, [suppliers]);

  // Per-row best, recomputed against whichever cost view is active so the
  // outline highlight tracks the toggle.
  const bestPerItem: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    for (const it of items) {
      let bestS = suppliers[0].id;
      let bestP = Infinity;
      for (const s of suppliers) {
        const b = getBid(it.id, s.id, 3);
        if (!b) continue;
        const v = costView === "tco" ? b.unitPrice * tcoMult[s.id] : b.unitPrice;
        if (v < bestP) { bestP = v; bestS = s.id; }
      }
      out[it.id] = bestS;
    }
    return out;
  }, [items, suppliers, costView, tcoMult]);

  return (
    <table className="w-full text-[11px] min-w-[720px]">
      <thead>
        <tr className="bg-gray-50 text-gray-600">
          <th className={`px-2 py-2 ${isAr ? "text-right" : "text-left"} font-semibold sticky ${isAr ? "right-0" : "left-0"} bg-gray-50 z-10`}>{isAr ? "البند" : "Line item"}</th>
          {suppliers.map((s) => (
            <th key={s.id} className="px-2 py-2 font-semibold text-center" title={isAr ? s.nameAr : s.nameEn}>{s.code}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id} className="border-t border-gray-100">
            <td className={`px-2 py-1.5 sticky ${isAr ? "right-0" : "left-0"} bg-white z-10 font-mono text-gray-700 whitespace-nowrap`}>
              <div className="text-[10px] font-bold text-[#0E2841]">{it.code}</div>
              <div className="text-[9px] text-gray-400 line-clamp-1 max-w-[180px]">{isAr ? it.descriptionAr : it.descriptionEn}</div>
            </td>
            {suppliers.map((s) => {
              const b = getBid(it.id, s.id, 3);
              if (!b) return <td key={s.id} className="px-2 py-1.5 text-center text-gray-300">—</td>;
              const cellValue = costView === "tco" ? b.unitPrice * tcoMult[s.id] : b.unitPrice;
              // Compare against the same baseline regardless of mode so
              // the TCO toggle reveals the supplier's freight/payment/lead-
              // time/ESG load relative to baseline unit price.
              const pct = ((cellValue - it.baselineUnitPrice) / it.baselineUnitPrice) * 100;
              const isBest = bestPerItem[it.id] === s.id;
              const intensity = Math.min(1, Math.abs(pct) / 8);
              const bg = pct < 0
                ? `rgba(16,185,129,${0.08 + intensity * 0.18})`
                : pct > 0
                  ? `rgba(245,158,11,${0.08 + intensity * 0.18})`
                  : "transparent";
              return (
                <td key={s.id} className={`px-2 py-1.5 text-center font-mono ${isBest ? "outline outline-2 outline-offset-[-2px]" : ""}`}
                    style={{ background: bg, outlineColor: isBest ? BRAND : undefined }}
                    title={`${cellValue.toLocaleString()} (${pct.toFixed(1)}%)${costView === "tco" ? " · TCO" : ""}`}>
                  <div className="text-[11px] font-semibold text-[#0E2841]">{Math.round(cellValue).toLocaleString()}</div>
                  <div className={`text-[9px] ${pct < 0 ? "text-emerald-700" : pct > 0 ? "text-amber-700" : "text-gray-400"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
