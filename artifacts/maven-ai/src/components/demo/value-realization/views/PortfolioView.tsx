import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, AlertTriangle, ChevronRight, Sparkles } from "lucide-react";
import { useDemoLang, tBi } from "../DemoLangContext";
import { portfolio, t as tr } from "../value-realization-i18n";
import { useValueRealizationData } from "@/hooks/useValueRealizationData";
import {
  totals,
  topStalled,
  generateRecommendations,
  formatAED,
  gap,
  realisationPct,
  CONDUCTOR_AGENTS,
} from "@/data/value-realization-agent";
import { getSponsor, type Initiative } from "@/data/value-realization-seed";
import { BRAND, BRAND_INK, NAVY, SEMANTIC, CHART_PALETTE } from "../tokens";

interface Props {
  filterBu: string | "all";
  filterType: string | "all";
  filterStatus: string | "all";
  onSelectInitiative: (id: string) => void;
  onJumpApprovals: () => void;
  onJumpChase: () => void;
}

export default function PortfolioView({
  filterBu, filterType, filterStatus,
  onSelectInitiative, onJumpApprovals, onJumpChase,
}: Props) {
  const { lang } = useDemoLang();
  const data = useValueRealizationData();
  const [sortByGap, setSortByGap] = useState(true);

  const filtered = useMemo(() => {
    return data.initiatives.filter((i) => {
      if (filterBu !== "all" && i.buId !== filterBu) return false;
      if (filterType !== "all" && i.type !== filterType) return false;
      if (filterStatus !== "all" && i.status !== filterStatus) return false;
      return true;
    });
  }, [data, filterBu, filterType, filterStatus]);

  const tot = totals();
  const stalled = topStalled(5);
  const recs = generateRecommendations().slice(0, 3);

  const sortedTable = useMemo(() => {
    const arr = [...filtered];
    if (sortByGap) arr.sort((a, b) => gap(b) - gap(a));
    else arr.sort((a, b) => b.realizedAnnual - a.realizedAnnual);
    return arr;
  }, [filtered, sortByGap]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: NAVY }} data-testid="text-portfolio-title">
          {tr(portfolio, "title", lang)}
        </h1>
        <p className="text-sm text-gray-500">{tr(portfolio, "subtitle", lang)}</p>
      </header>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label={tr(portfolio, "kpiPromised", lang)}
          value={formatAED(tot.promised)}
          sub={tr(portfolio, "kpiPromisedSub", lang)}
          icon={<TrendingUp size={16} />}
          tone="ink"
          testId="kpi-promised"
        />
        <KpiTile
          label={tr(portfolio, "kpiRealized", lang)}
          value={formatAED(tot.realized)}
          sub={tr(portfolio, "kpiRealizedSub", lang)}
          icon={<TrendingUp size={16} />}
          tone="brand"
          testId="kpi-realized"
        />
        <KpiTile
          label={tr(portfolio, "kpiGap", lang)}
          value={formatAED(tot.gap)}
          sub={`${tot.gapPct}% ${tr(portfolio, "kpiGapSub", lang)}`}
          icon={<TrendingDown size={16} />}
          tone="critical"
          testId="kpi-gap"
        />
        <KpiTile
          label={tr(portfolio, "kpiAtRisk", lang)}
          value={String(tot.atRiskCount)}
          sub={tr(portfolio, "kpiAtRiskSub", lang)}
          icon={<AlertTriangle size={16} />}
          tone="attention"
          testId="kpi-at-risk"
        />
      </div>

      {/* Value tower + Stalled rail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="bg-white border border-gray-200 rounded-xl p-4 lg:col-span-2" data-testid="card-value-tower">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold" style={{ color: NAVY }}>{tr(portfolio, "valueTowerTitle", lang)}</h2>
              <p className="text-xs text-gray-500">{tr(portfolio, "valueTowerSub", lang)}</p>
            </div>
          </div>
          <ValueTower initiatives={filtered.slice(0, 12)} lang={lang} onSelect={onSelectInitiative} />
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-4" data-testid="card-stalled-rail">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold" style={{ color: NAVY }}>{tr(portfolio, "stalledRailTitle", lang)}</h2>
              <p className="text-xs text-gray-500">{tr(portfolio, "stalledRailSub", lang)}</p>
            </div>
            <button onClick={onJumpChase} className="text-xs font-semibold flex items-center gap-1" style={{ color: BRAND }} data-testid="button-open-chase">
              {tr(portfolio, "stalledOpenChase", lang)}
            </button>
          </div>
          <ul className="space-y-2">
            {stalled.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => onSelectInitiative(i.id)}
                  className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                  data-testid={`stalled-${i.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: NAVY }}>{tBi(i.name, lang)}</p>
                      <p className="text-[11px] text-gray-500 truncate">{tBi(i.businessUnit, lang)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold" style={{ color: SEMANTIC.critical }}>−{formatAED(gap(i), { withCurrency: false })}</p>
                      <p className="text-[10px] text-gray-500">{i.driftDays || 0}d drift</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Recommendation stack */}
      <section className="bg-white border border-gray-200 rounded-xl p-4" data-testid="card-recs-stack">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: BRAND }} />
            <div>
              <h2 className="text-base font-bold" style={{ color: NAVY }}>{tr(portfolio, "recsTitle", lang)}</h2>
              <p className="text-xs text-gray-500">{tr(portfolio, "recsSub", lang)}</p>
            </div>
          </div>
          <button onClick={onJumpApprovals} className="text-xs font-semibold" style={{ color: BRAND }} data-testid="button-open-approvals">
            {tr(portfolio, "drillIn", lang)}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {recs.map((r) => {
            const agent = CONDUCTOR_AGENTS.find((a) => a.id === r.agentId);
            const init = data.initiatives.find((i) => i.id === r.initiativeId);
            return (
              <div key={r.id} className="rounded-lg border border-gray-100 p-3 hover:border-gray-300 transition-colors" data-testid={`rec-card-${r.id}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: agent?.color }}>
                  {agent ? tBi(agent.name, lang) : ""}
                </p>
                <p className="text-sm font-semibold mt-1" style={{ color: NAVY }}>{tBi(r.title, lang)}</p>
                {init && <p className="text-[11px] text-gray-500 mt-0.5">{tBi(init.name, lang)}</p>}
                <p className="text-[11px] text-gray-600 mt-2 line-clamp-3">{tBi(r.rationale, lang)}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#E8F2EA", color: BRAND_INK }}>
                    {r.confidence}% {tr(portfolio, "confidenceLabel", lang)}
                  </span>
                  <button
                    onClick={onJumpApprovals}
                    className="text-[11px] font-semibold flex items-center gap-0.5"
                    style={{ color: BRAND }}
                    data-testid={`button-rec-open-${r.id}`}
                  >
                    {tr(portfolio, "drillIn", lang)} <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* All initiatives table */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="card-portfolio-table">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ color: NAVY }}>{tr(portfolio, "portfolioTableTitle", lang)}</h2>
          <button
            onClick={() => setSortByGap((s) => !s)}
            className="text-xs font-semibold text-gray-500 hover:text-gray-800"
            data-testid="button-sort-toggle"
          >
            {tr(portfolio, "sortByGap", lang)}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{tr(portfolio, "th_initiative", lang)}</th>
                <th className="px-3 py-2 text-left font-semibold">{tr(portfolio, "th_bu", lang)}</th>
                <th className="px-3 py-2 text-left font-semibold">{tr(portfolio, "th_status", lang)}</th>
                <th className="px-3 py-2 text-right font-semibold">{tr(portfolio, "th_promised", lang)}</th>
                <th className="px-3 py-2 text-right font-semibold">{tr(portfolio, "th_realized", lang)}</th>
                <th className="px-3 py-2 text-right font-semibold">{tr(portfolio, "th_gap", lang)}</th>
                <th className="px-3 py-2 text-right font-semibold">{tr(portfolio, "th_drift", lang)}</th>
                <th className="px-3 py-2 text-left font-semibold">{tr(portfolio, "th_sponsor", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {sortedTable.map((i) => {
                const sp = getSponsor(i.sponsorId);
                const pct = realisationPct(i);
                return (
                  <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => onSelectInitiative(i.id)} data-testid={`row-${i.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-semibold" style={{ color: NAVY }}>{tBi(i.name, lang)}</div>
                      <div className="text-[10px] text-gray-500">{pct}% {tr(portfolio, "realisationLabel", lang)}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{tBi(i.businessUnit, lang)}</td>
                    <td className="px-3 py-2"><StatusPill status={i.status} lang={lang} /></td>
                    <td className="px-3 py-2 text-right">{formatAED(i.promisedAnnual)}</td>
                    <td className="px-3 py-2 text-right font-semibold" style={{ color: BRAND_INK }}>{formatAED(i.realizedAnnual)}</td>
                    <td className="px-3 py-2 text-right font-semibold" style={{ color: SEMANTIC.critical }}>−{formatAED(gap(i), { withCurrency: false })}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{i.driftDays > 0 ? i.driftDays : "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{sp ? tBi(sp.name, lang) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function KpiTile({ label, value, sub, icon, tone, testId }: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  tone: "ink" | "brand" | "critical" | "attention"; testId: string;
}) {
  const colors: Record<typeof tone, { bg: string; fg: string; ring: string }> = {
    ink: { bg: NAVY, fg: "#FFFFFF", ring: "#1f3a5e" },
    brand: { bg: BRAND, fg: "#FFFFFF", ring: BRAND_INK },
    critical: { bg: "#FEE2E2", fg: SEMANTIC.critical, ring: SEMANTIC.critical },
    attention: { bg: "#FEF3C7", fg: SEMANTIC.attention, ring: SEMANTIC.attention },
  };
  const c = colors[tone];
  const dark = tone === "ink" || tone === "brand";
  return (
    <div className="rounded-xl p-4" style={{ background: c.bg, color: c.fg }} data-testid={testId}>
      <div className="flex items-center justify-between">
        <p className={`text-[10px] uppercase font-bold tracking-wider ${dark ? "text-white/70" : ""}`} style={!dark ? { color: c.fg } : undefined}>
          {label}
        </p>
        {icon}
      </div>
      <p className="text-2xl font-extrabold mt-2">{value}</p>
      <p className={`text-[10px] mt-1 ${dark ? "text-white/60" : "opacity-80"}`}>{sub}</p>
    </div>
  );
}

function ValueTower({ initiatives, lang, onSelect }: { initiatives: Initiative[]; lang: "en" | "ar"; onSelect: (id: string) => void }) {
  if (initiatives.length === 0) {
    return <div className="text-xs text-gray-500 py-8 text-center">No initiatives match the filters.</div>;
  }
  const max = Math.max(...initiatives.map((i) => i.promisedAnnual));
  return (
    <div className="space-y-2">
      {initiatives.map((i) => {
        const promisedW = (i.promisedAnnual / max) * 100;
        const realizedW = (i.realizedAnnual / max) * 100;
        return (
          <button
            key={i.id}
            onClick={() => onSelect(i.id)}
            className="w-full group"
            data-testid={`tower-${i.id}`}
          >
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="truncate font-semibold text-left" style={{ color: NAVY }}>{tBi(i.name, lang)}</span>
              <span className="text-gray-500 flex-shrink-0">{formatAED(i.realizedAnnual, { withCurrency: false })} / {formatAED(i.promisedAnnual, { withCurrency: false })}</span>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden border border-gray-200 bg-gray-50">
              <div className="absolute inset-y-0 left-0 border-r border-gray-300/60" style={{ width: `${promisedW}%`, background: "rgba(25,107,36,0.08)" }} />
              <div className="absolute inset-y-0 left-0 group-hover:opacity-90 transition-opacity" style={{ width: `${realizedW}%`, background: BRAND }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({ status, lang }: { status: string; lang: "en" | "ar" }) {
  const map: Record<string, { en: string; ar: string; bg: string; fg: string }> = {
    "idea": { en: "Idea", ar: "فكرة", bg: "#F3F4F6", fg: "#4B5563" },
    "pilot": { en: "Pilot", ar: "تجريبي", bg: "#FEF3C7", fg: "#92400E" },
    "scaling": { en: "Scaling", ar: "توسعة", bg: "#DBEAFE", fg: "#1D4ED8" },
    "in-production": { en: "Live", ar: "في الإنتاج", bg: "#D1FAE5", fg: BRAND_INK },
  };
  const m = map[status] ?? map.idea;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.fg }}>{lang === "ar" ? m.ar : m.en}</span>;
}
