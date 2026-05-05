import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import {
  SlidersHorizontal, Sparkles, Play, RotateCcw, AlertTriangle, Users, Wallet, ShieldCheck, Brain, ArrowRight, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { useManagerFilters } from "../TasamaDashboardContext";
import { simulator } from "../tasama-i18n";
import {
  generatePayrollSimulatorRecommendations, runSimulator, generateQuickStats,
  type SimulatorInput,
} from "@/data/tasama-agent";
import { formatSAR, getSaudizationBandLabel } from "@/data/tasama-seed";
import type { SimulatorRecommendation } from "@/data/tasama-seed";

type Mode = "headcount" | "salary" | "compliance";

const BAND_TONE: Record<string, string> = {
  "green-high": "#059669",
  "green-mid": "#10B981",
  "green-low": "#34D399",
  yellow: "#F59E0B",
  red: "#DC2626",
  platinum: "#7C3AED",
};

const BAND_BG_BAR = [
  { from: 0, to: 30, color: "#DC2626", label: "thresholdRed" },
  { from: 30, to: 40, color: "#F59E0B", label: "thresholdYellow" },
  { from: 40, to: 60, color: "#34D399", label: "thresholdGreenLow" },
  { from: 60, to: 80, color: "#10B981", label: "thresholdGreenMid" },
  { from: 80, to: 100, color: "#059669", label: "thresholdGreenHigh" },
];

export default function PayrollSimulatorView() {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const { toast } = useToast();
  const isAr = lang === "ar";
  const data = useTasamaData();
  const { filters, update } = useManagerFilters();

  const [mode, setMode] = useState<Mode>("headcount");
  const [scope, setScope] = useState<string>(filters.clientId);
  const [saudiHires, setSaudiHires] = useState(0);
  const [expatHires, setExpatHires] = useState(0);
  const [saudiSeps, setSaudiSeps] = useState(0);
  const [expatSeps, setExpatSeps] = useState(0);
  const [salaryIncrease, setSalaryIncrease] = useState(0);
  const [gosiRate, setGosiRate] = useState(12);
  const [aiOptimizing, setAiOptimizing] = useState(false);

  const aiRecs = useMemo(() => generatePayrollSimulatorRecommendations(), []);
  const stats = generateQuickStats(lang);

  useEffect(() => {
    setScope(filters.clientId);
  }, [filters.clientId]);

  const baselineSaudi = useMemo(() => {
    const employees = scope === "all" ? data.employees : data.employees.filter((e) => e.clientId === scope);
    const saudi = employees.filter((e) => e.isSaudi).length;
    return employees.length ? (saudi / employees.length) * 100 : 0;
  }, [data.employees, scope]);

  const baselineGross = useMemo(() => {
    const employees = scope === "all" ? data.employees : data.employees.filter((e) => e.clientId === scope);
    return data.salaryComponents.filter((s) => employees.some((e) => e.id === s.employeeId)).reduce((sum, s) => sum + s.grossMonthly, 0);
  }, [data.salaryComponents, data.employees, scope]);

  const result = useMemo(() => {
    const input: SimulatorInput = {
      saudiHires, expatHires, saudiSeparations: saudiSeps, expatSeparations: expatSeps,
      salaryIncreasePct: salaryIncrease,
    };
    return runSimulator(input, scope === "all" ? undefined : scope);
  }, [saudiHires, expatHires, saudiSeps, expatSeps, salaryIncrease, scope]);

  const reset = () => {
    setSaudiHires(0); setExpatHires(0); setSaudiSeps(0); setExpatSeps(0);
    setSalaryIncrease(0); setGosiRate(12);
  };

  const loadRec = (r: SimulatorRecommendation) => {
    setMode(r.suggestedMode);
    const params = r.suggestedParams;
    if (typeof params.clientId === "string") {
      setScope(params.clientId);
      update({ clientId: params.clientId });
    }
    if (r.suggestedMode === "headcount") {
      const count = (params.count as number) ?? 0;
      const action = params.action as string | undefined;
      const nationality = params.nationality as string | undefined;
      setSaudiHires(0); setExpatHires(0); setSaudiSeps(0); setExpatSeps(0);
      if (action === "hire" && nationality === "saudi") setSaudiHires(count);
      else if (action === "hire" && nationality === "expat") setExpatHires(count);
      else if (action === "separate" && nationality === "saudi") setSaudiSeps(count);
      else if (action === "separate" && nationality === "expat") setExpatSeps(count);
    } else if (r.suggestedMode === "salary") {
      const inc = (params.increasePercent as number) ?? (params.newBasic && params.currentBasic
        ? ((params.newBasic as number) - (params.currentBasic as number)) / (params.currentBasic as number) * 100
        : 0);
      setSalaryIncrease(Math.round(inc * 10) / 10);
    } else if (r.suggestedMode === "compliance") {
      setGosiRate(((params.newRate as number) ?? 0.13) * 100);
    }
    toast({ title: t("optimizeToast", simulator), description: r.title });
  };

  const aiOptimize = () => {
    setAiOptimizing(true);
    setTimeout(() => {
      const top = [...aiRecs].sort((a, b) => b.confidence - a.confidence)[0];
      loadRec(top);
      setAiOptimizing(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <SlidersHorizontal size={20} className="text-[#0F766E]" />
          {t("title", simulator)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", simulator)}</p>
      </div>

      {/* Mode toggle + AI Optimize */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-gray-100 rounded-xl p-1">
          {(["headcount", "salary", "compliance"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                mode === m ? "bg-white text-[#0F766E] shadow-sm" : "text-gray-600"
              }`}
            >
              {t(m === "headcount" ? "modeHeadcount" : m === "salary" ? "modeSalary" : "modeCompliance", simulator)}
            </button>
          ))}
        </div>
        <button
          onClick={aiOptimize}
          disabled={aiOptimizing}
          className="px-4 py-2 bg-gradient-to-r from-[#0F766E] to-[#0D9488] text-white rounded-xl text-xs font-bold shadow-sm hover:shadow-md flex items-center gap-2 disabled:opacity-60"
        >
          <Sparkles size={14} className={aiOptimizing ? "animate-spin" : ""} />
          {aiOptimizing ? t("optimizing", simulator) : t("aiOptimize", simulator)}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inputs */}
        <div className="lg:col-span-1 space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t("scopeLabel", simulator)}</label>
              <select
                value={scope}
                onChange={(e) => { setScope(e.target.value); update({ clientId: e.target.value }); }}
                className="w-full mt-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium"
              >
                <option value="all">{t("fleetWide", simulator)}</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>{isAr ? c.legalNameAr : c.legalNameEn}</option>
                ))}
              </select>
            </div>

            {mode === "headcount" && (
              <>
                <Slider label={t("saudiHires", simulator)} value={saudiHires} setValue={setSaudiHires} min={0} max={10} icon={<Users size={12} />} accent="teal" />
                <Slider label={t("expatHires", simulator)} value={expatHires} setValue={setExpatHires} min={0} max={10} icon={<Users size={12} />} accent="amber" />
                <Slider label={t("saudiSeparations", simulator)} value={saudiSeps} setValue={setSaudiSeps} min={0} max={10} icon={<Users size={12} />} accent="red" />
                <Slider label={t("expatSeparations", simulator)} value={expatSeps} setValue={setExpatSeps} min={0} max={10} icon={<Users size={12} />} accent="red" />
              </>
            )}

            {mode === "salary" && (
              <>
                <Slider label={t("salaryIncrease", simulator)} value={salaryIncrease} setValue={setSalaryIncrease} min={-10} max={30} step={0.5} suffix="%" icon={<Wallet size={12} />} accent="teal" />
              </>
            )}

            {mode === "compliance" && (
              <>
                <Slider label={t("gosiRate", simulator)} value={gosiRate} setValue={setGosiRate} min={9} max={18} step={0.5} suffix="%" icon={<ShieldCheck size={12} />} accent="purple" />
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  {isAr ? "محاكاة سياسة GOSI: تأثير على تكاليف صاحب العمل عبر الأسطول." : "GOSI policy simulation: employer-side cost impact across the fleet."}
                </p>
              </>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={reset}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} />{t("reset", simulator)}
              </button>
            </div>
          </div>

          {/* Saudization band thresholds */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3">{t("bandViz", simulator)}</p>
            <div className="space-y-2">
              {BAND_BG_BAR.map((b) => {
                const active = result.newSaudization >= b.from && result.newSaudization < b.to;
                return (
                  <div key={b.label} className={`rounded-lg px-3 py-2 flex items-center justify-between text-xs transition-all ${active ? "ring-2 ring-offset-1" : ""}`}
                    style={{
                      background: `${b.color}15`,
                      ...(active ? { borderColor: b.color, boxShadow: `0 0 0 2px ${b.color}40` } : {}),
                    }}
                  >
                    <span className="font-semibold" style={{ color: b.color }}>{t(b.label, simulator)}</span>
                    {active && <CheckCircle2 size={12} style={{ color: b.color }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-gradient-to-br from-[#0F766E] to-[#0D9488] rounded-2xl p-6 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <Play size={14} />
              <h3 className="text-sm font-bold uppercase tracking-wider">{t("results", simulator)}</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Result label={t("newHeadcount", simulator)} value={`${result.newHeadcount}`} delta={result.newHeadcount - data.employees.length} />
              <Result
                label={t("newSaudization", simulator)}
                value={`${result.newSaudization}%`}
                delta={+(result.newSaudization - baselineSaudi).toFixed(1)}
                suffix="pp"
              />
              <Result
                label={t("newBand", simulator)}
                value={getSaudizationBandLabel(result.newBand as never, lang)}
                color={BAND_TONE[result.newBand]}
              />
              <Result label={t("newMonthlyGross", simulator)} value={formatSAR(result.newMonthlyGross)} delta={result.newMonthlyGross - baselineGross} isCurrency />
              <Result label={t("newGosiCost", simulator)} value={formatSAR(result.newGosiCost)} />
              <Result label={t("cycleLabel", simulator)} value={isAr ? "مايو 2026" : "May 2026"} />
            </div>
          </div>

          {/* Warnings */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className={result.warnings.length ? "text-amber-600" : "text-emerald-600"} />
              <h3 className="text-sm font-bold text-gray-900">{t("warningsTitle", simulator)}</h3>
            </div>
            {result.warnings.length === 0 ? (
              <p className="text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={12} />{t("noWarnings", simulator)}</p>
            ) : (
              <ul className="space-y-2">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-amber-600" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Comparison chart */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3">
              {t("baseline", simulator)} → {t("delta", simulator)}
            </p>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: t("baseline", simulator), gross: baselineGross, sa: baselineSaudi },
                    { name: isAr ? "السيناريو" : "Scenario", gross: result.newMonthlyGross, sa: result.newSaudization },
                  ]}
                  margin={{ left: 0, right: 5, top: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 9 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Bar yAxisId="left" dataKey="gross" fill="#0F766E" radius={[4, 4, 0, 0]} barSize={36} name={isAr ? "إجمالي شهري" : "Monthly gross"} />
                  <Bar yAxisId="right" dataKey="sa" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={36} name={isAr ? "السعودة %" : "Saudization %"} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* AI suggested scenarios */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Brain size={14} className="text-[#0F766E]" />
              {t("aiRecsTitle", simulator)}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{t("aiRecsHint", simulator)}</p>
          </div>
          <span className="text-xs text-gray-400">{aiRecs.length}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {aiRecs.map((r) => (
            <motion.div
              key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="border border-gray-100 rounded-xl p-4 hover:border-[#0F766E]/30 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-900 leading-snug">{r.title}</p>
                  <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed line-clamp-3">{r.description}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-[#0F766E] font-bold flex-shrink-0">
                  {r.confidence}%
                </span>
              </div>
              <p className="text-[11px] text-gray-700 mt-3 bg-gray-50 rounded-md px-2 py-1.5">
                <span className="text-[#0F766E] font-bold">{isAr ? "الأثر:" : "Impact:"} </span>
                {r.impact}
              </p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <span className="text-[10px] text-gray-400">{r.agentSource}</span>
                <button
                  onClick={() => loadRec(r)}
                  className="text-xs text-[#0F766E] font-bold hover:underline flex items-center gap-1"
                >
                  {t("loadScenario", simulator)} <ArrowRight size={11} className="rtl:rotate-180" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, setValue, min, max, step = 1, suffix = "", icon, accent }: {
  label: string; value: number; setValue: (v: number) => void;
  min: number; max: number; step?: number; suffix?: string; icon: React.ReactNode;
  accent: "teal" | "amber" | "red" | "purple";
}) {
  const accentClass = accent === "teal" ? "accent-[#0F766E]" : accent === "amber" ? "accent-amber-500" : accent === "red" ? "accent-red-500" : "accent-purple-500";
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
          <span className="text-gray-400">{icon}</span>{label}
        </label>
        <span className="text-xs font-bold text-[#0F766E] tabular-nums">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className={`w-full h-1.5 ${accentClass}`}
      />
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
        <span>{min}{suffix}</span><span>{max}{suffix}</span>
      </div>
    </div>
  );
}

function Result({ label, value, delta, suffix = "", color, isCurrency = false }: {
  label: string; value: string; delta?: number; suffix?: string; color?: string; isCurrency?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-teal-100 font-bold">{label}</p>
      <div className="text-2xl font-extrabold mt-1" style={color ? { color } : undefined}>{value}</div>
      {delta != null && delta !== 0 && (
        <p className={`text-[11px] font-bold mt-0.5 ${delta > 0 ? "text-emerald-200" : "text-red-200"}`}>
          {delta > 0 ? "▲" : "▼"} {isCurrency ? formatSAR(Math.abs(delta)) : `${Math.abs(delta).toFixed(1)}${suffix}`}
        </p>
      )}
    </div>
  );
}
