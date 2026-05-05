import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Download, FileText, ChevronRight, User as UserIcon, AlertTriangle } from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientEmployees as t18n, tDict } from "../tasama-i18n";
import {
  formatSAR, formatPercent, formatDate, getEmployeeStatusLabel, getDepartmentLabel,
  getNationalityLabel, getMonthName, computeGosi,
  type TasamaEmployee, type EmployeeStatus,
} from "@/data/tasama-seed";

const CLIENT_ID = "client-alnakhla";

const STATUS_COLORS: Record<EmployeeStatus, { bg: string; text: string }> = {
  active: { bg: "bg-emerald-50", text: "text-emerald-700" },
  "on-leave": { bg: "bg-amber-50", text: "text-amber-700" },
  probation: { bg: "bg-blue-50", text: "text-blue-700" },
  separated: { bg: "bg-red-50", text: "text-red-700" },
  onboarding: { bg: "bg-purple-50", text: "text-purple-700" },
};

export default function EmployeesView() {
  const { lang } = useTasamaDemoLang();
  const t = tDict(t18n, lang);
  const data = useTasamaData();
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID);

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<string>("all");
  const [nationality, setNationality] = useState<"all" | "saudi" | "non-saudi">("all");
  const [status, setStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const departments = useMemo(() => Array.from(new Set(employees.map((e) => e.department))), [employees]);
  const statuses = useMemo(() => Array.from(new Set(employees.map((e) => e.status))), [employees]);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (department !== "all" && e.department !== department) return false;
      if (nationality === "saudi" && !e.isSaudi) return false;
      if (nationality === "non-saudi" && e.isSaudi) return false;
      if (status !== "all" && e.status !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.fullNameEn.toLowerCase().includes(q) && !e.fullNameAr.includes(search) && !e.id.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [employees, department, nationality, status, search]);

  const selected = selectedId ? employees.find((e) => e.id === selectedId) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{filtered.length} {t.countSuffix}</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="ps-9 pe-3 py-2 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20 focus:border-[#0F0698]"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <FilterSelect label={t.filterDepartment} value={department} onChange={setDepartment} options={[{ value: "all", label: t.filterAll }, ...departments.map((d) => ({ value: d, label: getDepartmentLabel(d, lang) }))]} />
        <FilterSelect label={t.filterNationality} value={nationality} onChange={(v) => setNationality(v as "all" | "saudi" | "non-saudi")} options={[{ value: "all", label: t.filterAll }, { value: "saudi", label: t.natSaudi }, { value: "non-saudi", label: t.natNonSaudi }]} />
        <FilterSelect label={t.filterStatus} value={status} onChange={setStatus} options={[{ value: "all", label: t.filterAll }, ...statuses.map((s) => ({ value: s, label: getEmployeeStatusLabel(s as EmployeeStatus, lang) }))]} />
      </div>

      {employees.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {lang === "en" ? "No employee records found for this client" : "لم يتم العثور على سجلات موظفين لهذا العميل"}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {lang === "en"
                ? "The Tasama database has not been seeded yet. Run pnpm --filter @workspace/scripts run seed:tasama to load the demo dataset (18 + 14 + 10 employees across 3 client companies)."
                : "لم يتم تعبئة قاعدة بيانات تَسَامى بعد. شغّل pnpm --filter @workspace/scripts run seed:tasama لتحميل البيانات التجريبية (18 + 14 + 10 موظفًا عبر 3 شركات عميلة)."}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
              <tr>
                <th className="text-start px-4 py-2.5">{t.colNumber}</th>
                <th className="text-start px-4 py-2.5">{t.colName}</th>
                <th className="text-start px-4 py-2.5">{t.colDepartment}</th>
                <th className="text-start px-4 py-2.5">{t.colPosition}</th>
                <th className="text-start px-4 py-2.5">{t.colHireDate}</th>
                <th className="text-end px-4 py-2.5">{t.colBasic}</th>
                <th className="text-start px-4 py-2.5">{t.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-400">{t.noEmployees}</td></tr>
              )}
              {filtered.map((e) => {
                const sc = data.salaryComponents.find((s) => s.employeeId === e.id);
                const sCol = STATUS_COLORS[e.status] ?? STATUS_COLORS.active;
                return (
                  <tr key={e.id} onClick={() => setSelectedId(e.id)} className="border-t border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                    <td className="px-4 py-3 text-[11px] text-gray-500 font-mono">{e.id}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-[10px] font-bold text-[#0F0698] flex-shrink-0">
                          {(lang === "en" ? e.fullNameEn : e.fullNameAr).split(" ").slice(0, 2).map((p) => p[0]).join("")}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">{lang === "en" ? e.fullNameEn : e.fullNameAr}</p>
                          <p className="text-[10px] text-gray-400">{e.isSaudi ? t.saudiPill : t.nonSaudiPill} · {getNationalityLabel(e.nationality, lang)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{getDepartmentLabel(e.department, lang)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{lang === "en" ? e.role : e.roleAr}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{formatDate(e.hireDate, lang)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 font-semibold text-end">{sc ? formatSAR(sc.basicSalary) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${sCol.bg} ${sCol.text}`}>
                        {getEmployeeStatusLabel(e.status, lang)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {selected && <EmployeeDetailPanel employee={selected} onClose={() => setSelectedId(null)} />}
      </AnimatePresence>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-gray-500 uppercase">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function EmployeeDetailPanel({ employee, onClose }: { employee: TasamaEmployee; onClose: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(t18n, lang);
  const isRtl = lang === "ar";
  const data = useTasamaData();

  const sc = data.salaryComponents.find((s) => s.employeeId === employee.id);
  const lb = data.leaveBalances.find((l) => l.employeeId === employee.id);
  const eosb = data.eosbProvisions.filter((e) => e.employeeId === employee.id).sort((a, b) => (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth))[0];
  const recentPayslips = data.payslips
    .filter((p) => p.employeeId === employee.id)
    .sort((a, b) => (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth))
    .slice(0, 3);
  const docs = data.documents.filter((d) => d.employeeId === employee.id).slice(0, 4);
  const gosi = sc ? computeGosi(sc.basicSalary + sc.housingAllowance, employee.isSaudi) : null;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <motion.div
        initial={{ x: isRtl ? "-100%" : "100%" }}
        animate={{ x: 0 }}
        exit={{ x: isRtl ? "-100%" : "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className={`fixed top-0 ${isRtl ? "left-0" : "right-0"} h-full w-[480px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto`}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 z-10">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#0F0698] to-[#3B30E0] text-white flex items-center justify-center font-bold">
            {(lang === "en" ? employee.fullNameEn : employee.fullNameAr).split(" ").slice(0, 2).map((p) => p[0]).join("")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{lang === "en" ? employee.fullNameEn : employee.fullNameAr}</p>
            <p className="text-[11px] text-gray-500">{lang === "en" ? employee.role : employee.roleAr} · {employee.id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label={t.closeDetail}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Section title={t.detailContract}>
            <Row label={t.contractType} value={employee.contractType === "limited" ? (lang === "en" ? "Limited" : "محدد") : employee.contractType === "unlimited" ? (lang === "en" ? "Unlimited" : "غير محدد") : (lang === "en" ? "Probation" : "تجربة")} />
            <Row label={t.contractStart} value={formatDate(employee.hireDate, lang)} />
            <Row label={t.noticePeriod} value={`30 ${t.daysNoticeLabel}`} />
            <Row label={lang === "en" ? "Iqama / National ID" : "الإقامة / الهوية"} value={employee.iqamaNumber ?? employee.nationalId ?? "—"} />
          </Section>

          {sc && (
            <Section title={t.detailSalary}>
              <Row label={t.salaryBasic} value={formatSAR(sc.basicSalary)} />
              <Row label={t.salaryHousing} value={formatSAR(sc.housingAllowance)} />
              <Row label={t.salaryTransport} value={formatSAR(sc.transportAllowance)} />
              {sc.otherAllowances.length > 0 && <Row label={t.salaryOther} value={formatSAR(sc.otherAllowances.reduce((s, a) => s + a.amount, 0))} />}
              <Row label={t.salaryGross} value={formatSAR(sc.grossMonthly)} bold />
            </Section>
          )}

          {gosi && (
            <Section title={t.detailGosi}>
              <Row label={t.gosiContribType} value={employee.isSaudi ? (lang === "en" ? "Saudi (12% + 10% + 2%)" : "سعودي (12%+10%+2%)") : (lang === "en" ? "Non-Saudi (2% OHRP)" : "غير سعودي (2%)")} />
              <Row label={t.gosiEmployer} value={formatSAR(gosi.totalEmployer)} />
              <Row label={t.gosiEmployee} value={formatSAR(gosi.totalEmployee)} />
            </Section>
          )}

          {lb && (
            <Section title={t.detailLeave}>
              <Row label={lang === "en" ? "Annual entitled" : "المستحق السنوي"} value={`${lb.annualEntitlement} ${lang === "en" ? "days" : "يوم"}`} />
              <Row label={lang === "en" ? "Used" : "المستخدم"} value={`${lb.annualUsed} ${lang === "en" ? "days" : "يوم"}`} />
              <Row label={lang === "en" ? "Remaining" : "المتبقي"} value={`${lb.annualRemaining} ${lang === "en" ? "days" : "يوم"}`} bold />
              <Row label={lang === "en" ? "Sick used" : "مرضي مستخدم"} value={`${lb.sickUsedDays} ${lang === "en" ? "days" : "يوم"}`} />
            </Section>
          )}

          {eosb && (
            <Section title={t.detailEosb}>
              <Row label={t.eosbYears} value={`${employee.yearsOfService.toFixed(1)} ${lang === "en" ? "years" : "سنة"}`} />
              <Row label={t.eosbMonthly} value={formatSAR(eosb.accruedThisMonth)} />
              <Row label={t.eosbCumulative} value={formatSAR(eosb.cumulativeProvision)} />
              <Row label={t.eosbEstimate} value={formatSAR(eosb.estimatedFullPayout)} bold />
            </Section>
          )}

          {recentPayslips.length > 0 && (
            <Section title={t.detailPayslips}>
              <div className="space-y-1.5">
                {recentPayslips.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-xs font-semibold">{getMonthName(p.periodMonth, lang)} {p.periodYear}</p>
                      <p className="text-[10px] text-gray-400">{lang === "en" ? "Net" : "الصافي"} {formatSAR(p.netPay)} · {lang === "en" ? "Gross" : "الإجمالي"} {formatSAR(p.grossPay)}</p>
                    </div>
                    <button className="text-[11px] text-[#0F0698] font-semibold hover:underline flex items-center gap-1">
                      <Download size={11} /> {t.payslipDownload}
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {docs.length > 0 && (
            <Section title={t.detailDocuments}>
              <div className="space-y-1.5">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                    <FileText size={14} className="text-[#3B30E0]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{lang === "en" ? d.titleEn : d.titleAr}</p>
                      <p className="text-[10px] text-gray-400">{formatDate(d.issuedAt, lang)} · {d.referenceNumber}</p>
                    </div>
                    <ChevronRight size={12} className="text-gray-300 rtl:rotate-180" />
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </motion.div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase text-gray-400 mb-2 tracking-wide">{title}</h3>
      <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className={`text-xs ${bold ? "font-bold text-gray-900" : "font-semibold text-gray-700"}`}>{value}</span>
    </div>
  );
}
