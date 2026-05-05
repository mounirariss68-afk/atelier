import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, ArrowUp, ArrowDown, Wallet, ShieldCheck, Banknote, Users, CalendarClock, Loader2, X, FileText } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientPayroll, tDict } from "../tasama-i18n";
import { useToast } from "./ToastContext";
import { formatSAR, getMonthName, type Payslip, type TasamaEmployee } from "@/data/tasama-seed";

const CLIENT_ID = "client-alnakhla";

export default function PayrollView() {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientPayroll, lang);
  const data = useTasamaData();
  const { toast } = useToast();
  const client = data.clients.find((c) => c.id === CLIENT_ID);

  const runs = useMemo(
    () => data.payrollRuns
      .filter((r) => r.clientId === CLIENT_ID)
      .sort((a, b) => (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth)),
    [data.payrollRuns],
  );

  const NOW = new Date("2026-05-05T00:00:00Z");
  const inPrepRun = runs.find((r) => r.status === "in-preparation");
  const cutoffDay = client?.payrollCutoffDay ?? 25;
  const cutoffDate = inPrepRun ? new Date(Date.UTC(inPrepRun.periodYear, inPrepRun.periodMonth - 1, cutoffDay)) : null;
  const settleDate = inPrepRun ? new Date(Date.UTC(inPrepRun.periodYear, inPrepRun.periodMonth - 1, 27)) : null;
  const daysToCutoff = cutoffDate ? Math.max(0, Math.ceil((cutoffDate.getTime() - NOW.getTime()) / 86_400_000)) : 0;
  const fmtDate = (d: Date) => d.toLocaleString(lang === "en" ? "en-US" : "ar-SA", { month: "short", day: "numeric", timeZone: "UTC" });

  const settledRuns = useMemo(() => runs.filter((r) => r.status !== "in-preparation"), [runs]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(settledRuns[0]?.id ?? runs[0]?.id ?? null);
  const [showVariance, setShowVariance] = useState(false);
  const [drawerPayslip, setDrawerPayslip] = useState<Payslip | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  const prevRun = runs[runs.findIndex((r) => r.id === selectedRun?.id) + 1];

  const payslips = useMemo(
    () => (selectedRun ? data.payslips.filter((p) => p.runId === selectedRun.id) : []),
    [selectedRun, data.payslips],
  );
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID);

  const totals = payslips.reduce(
    (acc, p) => ({
      basic: acc.basic + p.basicSalary,
      housing: acc.housing + p.housingAllowance,
      transport: acc.transport + p.transportAllowance,
      other: acc.other + p.otherAllowances + p.bonus + p.retroAdjustment,
      overtime: acc.overtime + p.overtime,
      gross: acc.gross + p.grossPay,
      gosi: acc.gosi + p.gosiEmployeeDeduction,
      deductions: acc.deductions + p.gosiEmployeeDeduction + p.otherDeductions,
      net: acc.net + p.netPay,
    }),
    { basic: 0, housing: 0, transport: 0, other: 0, overtime: 0, gross: 0, gosi: 0, deductions: 0, net: 0 },
  );

  const variance = payslips
    .map((p) => {
      const prevP = prevRun ? data.payslips.find((x) => x.runId === prevRun.id && x.employeeId === p.employeeId) : null;
      const delta = prevP ? p.grossPay - prevP.grossPay : 0;
      return { p, delta };
    })
    .filter((v) => Math.abs(v.delta) > 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const currentRunId = inPrepRun?.id ?? runs[0]?.id;
  const trend = useMemo(() => runs.slice(0, 6).reverse().map((r) => ({
    id: r.id,
    label: getMonthName(r.periodMonth, lang).slice(0, 3),
    gross: r.totalGross,
    isCurrent: r.id === currentRunId,
    isSelected: r.id === selectedRun?.id,
  })), [runs, lang, selectedRun?.id, currentRunId]);

  const isRtl = lang === "ar";

  return (
    <div className="space-y-5">
      {inPrepRun && cutoffDate && settleDate && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-r from-[#0F0698] to-[#3B30E0] text-white rounded-xl p-4 flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
            <Loader2 size={18} className="animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                {lang === "en" ? "In Preparation" : "قيد التحضير"}
              </span>
              <p className="text-sm font-bold">
                {getMonthName(inPrepRun.periodMonth, lang)} {inPrepRun.periodYear}
                {" "}<span className="text-blue-100 font-normal">· {inPrepRun.employeeCount} {lang === "en" ? "employees" : "موظف"}</span>
              </p>
            </div>
            <p className="text-[11px] text-blue-100 mt-1">
              {lang === "en"
                ? `Cutoff ${fmtDate(cutoffDate)} (in ${daysToCutoff} days) · settles ${fmtDate(settleDate)} via Mudad`
                : `الإقفال ${fmtDate(cutoffDate)} (خلال ${daysToCutoff} أيام) · التسوية ${fmtDate(settleDate)} عبر مدد`}
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end flex-shrink-0">
            <div className="flex items-center gap-1.5 text-blue-100 text-[10px] font-bold uppercase tracking-wider">
              <CalendarClock size={11} /> {lang === "en" ? "Days to cutoff" : "أيام للإقفال"}
            </div>
            <p className="text-2xl font-extrabold leading-none mt-1">T-{daysToCutoff}d</p>
          </div>
        </motion.div>
      )}

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{lang === "en" ? "Monthly payroll register" : "سجل الرواتب الشهري"}</p>
        </div>
      </div>

      {/* Period pill row */}
      <div className="flex items-center gap-2 overflow-x-auto tasama-scroll pb-1 -mx-1 px-1">
        <span className="text-[11px] font-semibold text-gray-500 uppercase flex-shrink-0">{t.monthSelector}</span>
        {runs.slice(0, 6).map((r) => {
          const active = r.id === selectedRun?.id;
          const isInPrep = r.status === "in-preparation";
          return (
            <button
              key={r.id}
              onClick={() => setSelectedRunId(r.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors border ${
                active
                  ? "bg-[#0F0698] text-white border-[#0F0698]"
                  : isInPrep
                    ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                    : "bg-white text-gray-600 border-gray-200 hover:border-[#0F0698] hover:text-[#0F0698]"
              }`}
            >
              {getMonthName(r.periodMonth, lang).slice(0, 3)} {r.periodYear}
              {isInPrep && <span className="ms-1 text-[9px] opacity-70">●</span>}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Wallet} color="#0F0698" label={t.summaryGross} value={formatSAR(totals.gross)} />
        <SummaryCard icon={ShieldCheck} color="#7C3AED" label={t.summaryDeductions} value={formatSAR(totals.deductions)} />
        <SummaryCard icon={Banknote} color="#10B981" label={t.summaryNet} value={formatSAR(totals.net)} />
        <SummaryCard icon={Users} color="#3B82F6" label={t.summaryEmployees} value={String(payslips.length)} />
      </div>

      {trend.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">{t.trendTitle}</h2>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-[#4f46e5]" /> {t.chartCurrentBadge}
              </span>
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-indigo-200" /> {t.chartTooltipGross}
              </span>
            </div>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} reversed={isRtl} />
                <YAxis hide domain={[0, "dataMax + 50000"]} />
                <Tooltip
                  cursor={{ fill: "rgba(15, 6, 152, 0.04)" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 11, padding: "6px 10px" }}
                  formatter={(value: number) => [formatSAR(value), t.chartTooltipGross]}
                  labelStyle={{ color: "#0F0698", fontWeight: 600 }}
                />
                <Bar dataKey="gross" radius={[6, 6, 0, 0]} onClick={(d: { id?: string }) => d.id && setSelectedRunId(d.id)} className="cursor-pointer">
                  {trend.map((d) => (
                    <Cell key={d.id} fill={d.isCurrent ? "#4f46e5" : d.isSelected ? "#6366f1" : "#c7d2fe"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-bold">
            {selectedRun ? `${getMonthName(selectedRun.periodMonth, lang)} ${selectedRun.periodYear}` : ""} · {payslips.length} {lang === "en" ? "payslips" : "كشف"}
          </h2>
          {prevRun && (
            <button onClick={() => setShowVariance(!showVariance)} className="text-[11px] font-semibold text-[#0F0698] hover:underline">
              {showVariance ? t.hideVariance : t.showVariance}
            </button>
          )}
        </div>
        <div className="overflow-x-auto tasama-scroll">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase">
              <tr>
                <th className="text-start px-4 py-2.5">{t.colName}</th>
                <th className="text-end px-3 py-2.5">{t.colBasic}</th>
                <th className="text-end px-3 py-2.5">{t.colHousing}</th>
                <th className="text-end px-3 py-2.5">{t.colTransport}</th>
                <th className="text-end px-3 py-2.5">{t.colOvertime}</th>
                <th className="text-end px-3 py-2.5">{t.colGross}</th>
                <th className="text-end px-3 py-2.5">{t.colGosi}</th>
                <th className="text-end px-3 py-2.5 font-bold text-gray-700">{t.colNet}</th>
                <th className="text-start px-3 py-2.5">{t.colStatus}</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-gray-400">{t.noPayslips}</td></tr>
              )}
              {payslips.map((p) => {
                const e = employees.find((x) => x.id === p.employeeId);
                if (!e) return null;
                const statusLabel = p.paymentStatus === "paid" ? t.statusPaid : p.paymentStatus === "rejected" ? t.statusRejected : t.statusPending;
                const statusColor = p.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-700" : p.paymentStatus === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
                return (
                  <tr key={p.id} onClick={() => setDrawerPayslip(p)} className="border-t border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-semibold">{lang === "en" ? e.fullNameEn : e.fullNameAr}</p>
                      <p className="text-[10px] text-gray-400">{e.id}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-end">{formatSAR(p.basicSalary)}</td>
                    <td className="px-3 py-2.5 text-xs text-end">{formatSAR(p.housingAllowance)}</td>
                    <td className="px-3 py-2.5 text-xs text-end">{formatSAR(p.transportAllowance)}</td>
                    <td className="px-3 py-2.5 text-xs text-end">{p.overtime > 0 ? formatSAR(p.overtime) : "—"}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-end">{formatSAR(p.grossPay)}</td>
                    <td className="px-3 py-2.5 text-xs text-end text-purple-600">−{formatSAR(p.gosiEmployeeDeduction)}</td>
                    <td className="px-3 py-2.5 text-xs font-bold text-end text-emerald-700">{formatSAR(p.netPay)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusColor}`}>{statusLabel}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={(ev) => { ev.stopPropagation(); setDrawerPayslip(p); }} className="text-[11px] text-[#0F0698] hover:underline flex items-center gap-1" title={t.download}>
                        <FileText size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {payslips.length > 0 && (
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-4 py-3 text-xs font-bold uppercase text-gray-600">{t.totalsRow}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end">{formatSAR(totals.basic)}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end">{formatSAR(totals.housing)}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end">{formatSAR(totals.transport)}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end">{formatSAR(totals.overtime)}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end">{formatSAR(totals.gross)}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end text-purple-600">−{formatSAR(totals.gosi)}</td>
                  <td className="px-3 py-3 text-xs font-bold text-end text-emerald-700">{formatSAR(totals.net)}</td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {showVariance && variance.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold mb-3">{t.varianceTitle}</h2>
          <div className="space-y-2">
            {variance.map(({ p, delta }) => {
              const e = employees.find((x) => x.id === p.employeeId);
              if (!e) return null;
              const up = delta > 0;
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{lang === "en" ? e.fullNameEn : e.fullNameAr}</p>
                    <p className="text-[10px] text-gray-400">
                      {p.bonus > 0 ? (lang === "en" ? "Performance bonus" : "مكافأة أداء") : p.overtime > 0 ? (lang === "en" ? "Overtime hours" : "ساعات إضافية") : p.retroAdjustment !== 0 ? (lang === "en" ? "Retro adjustment" : "تسوية بأثر رجعي") : (lang === "en" ? "Salary adjustment" : "تعديل راتب")}
                    </p>
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-bold ${up ? "text-emerald-600" : "text-red-600"}`}>
                    {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    {formatSAR(Math.abs(delta))}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {drawerPayslip && (
          <PayslipDrawer
            payslip={drawerPayslip}
            employee={employees.find((e) => e.id === drawerPayslip.employeeId)}
            onClose={() => setDrawerPayslip(null)}
            onDownload={() => toast(t.drawerPdfToast, "info")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryCard({ icon: Icon, color, label, value }: { icon: typeof Wallet; color: string; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:border-indigo-200 transition-all">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "15" }}>
          <Icon size={14} style={{ color }} />
        </div>
        <p className="text-[11px] text-gray-500 font-semibold uppercase">{label}</p>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function PayslipDrawer({ payslip, employee, onClose, onDownload }: { payslip: Payslip; employee?: TasamaEmployee; onClose: () => void; onDownload: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientPayroll, lang);
  const isRtl = lang === "ar";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const earnings = [
    { label: t.colBasic, value: payslip.basicSalary },
    { label: t.colHousing, value: payslip.housingAllowance },
    { label: t.colTransport, value: payslip.transportAllowance },
    { label: t.colOvertime, value: payslip.overtime },
    { label: lang === "en" ? "Bonus" : "مكافأة", value: payslip.bonus },
    { label: lang === "en" ? "Other allowances" : "بدلات أخرى", value: payslip.otherAllowances },
    { label: lang === "en" ? "Retro adjustment" : "تسوية بأثر رجعي", value: payslip.retroAdjustment },
  ].filter((r) => r.value !== 0);

  const deductions = [
    { label: t.colGosi, value: payslip.gosiEmployeeDeduction },
    { label: lang === "en" ? "Other deductions" : "خصومات أخرى", value: payslip.otherDeductions },
  ].filter((r) => r.value !== 0);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <motion.div
        initial={{ x: isRtl ? "-100%" : "100%" }}
        animate={{ x: 0 }}
        exit={{ x: isRtl ? "-100%" : "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className={`fixed top-0 ${isRtl ? "left-0" : "right-0"} h-full w-[420px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto tasama-scroll flex flex-col`}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 z-10">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-[#0F0698]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{employee ? (lang === "en" ? employee.fullNameEn : employee.fullNameAr) : "—"}</p>
            <p className="text-[11px] text-gray-500">{getMonthName(payslip.periodMonth, lang)} {payslip.periodYear} · {t.drawerTitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          <div>
            <p className="text-[11px] font-bold uppercase text-gray-400 mb-2 tracking-wide">{t.drawerEarnings}</p>
            <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
              {earnings.map((r) => (
                <div key={r.label} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{r.label}</span>
                  <span className="font-semibold text-gray-800">{formatSAR(r.value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-200 mt-2">
                <span className="font-bold uppercase text-gray-600">{t.colGross}</span>
                <span className="font-bold text-gray-900">{formatSAR(payslip.grossPay)}</span>
              </div>
            </div>
          </div>

          {deductions.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase text-gray-400 mb-2 tracking-wide">{t.drawerDeductions}</p>
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                {deductions.map((r) => (
                  <div key={r.label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{r.label}</span>
                    <span className="font-semibold text-purple-700">−{formatSAR(r.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/60 border border-emerald-200 rounded-lg p-4 flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-emerald-800">{t.drawerNet}</span>
            <span className="text-xl font-extrabold text-emerald-700">{formatSAR(payslip.netPay)}</span>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4">
          <button
            onClick={onDownload}
            className="w-full px-4 py-2.5 bg-[#0F0698] text-white rounded-lg text-xs font-semibold hover:bg-[#3B30E0] transition-colors flex items-center justify-center gap-2"
          >
            <Download size={14} /> {t.drawerDownloadPdf}
          </button>
        </div>
      </motion.div>
    </>
  );
}
