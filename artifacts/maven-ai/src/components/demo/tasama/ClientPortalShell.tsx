// Foundation placeholder shell for the Client Portal demo experience.
// Renders the per-client roster, salary roll, documents, and service requests
// driven by the /api/tasama endpoints. The full immersive client portal
// experience will be built in a downstream task.

import { useMemo, useState } from "react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "./DemoLangContext";
import {
  formatSAR,
  formatPercent,
  getDepartmentLabel,
  getEmployeeStatusLabel,
  getNationalityLabel,
  getRequestTypeLabel,
  getDocumentTypeLabel,
  getSaudizationBandLabel,
  type DocumentType,
  type RequestType,
} from "@/data/tasama-seed";
import { Building2, Users, Wallet, CalendarDays, FileText, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function ClientPortalShell() {
  const { lang, setLang } = useTasamaDemoLang();
  const data = useTasamaData();
  const [clientId, setClientId] = useState<string>(data.clients[0]?.id ?? "");
  const isAr = lang === "ar";

  const client = data.clients.find((c) => c.id === clientId);
  const employees = useMemo(() => data.employees.filter((e) => e.clientId === clientId), [data.employees, clientId]);
  const documents = useMemo(() => data.documents.filter((d) => d.clientId === clientId), [data.documents, clientId]);
  const requests = useMemo(() => data.serviceRequests.filter((r) => r.clientId === clientId), [data.serviceRequests, clientId]);
  const lastRun = useMemo(
    () =>
      data.payrollRuns
        .filter((r) => r.clientId === clientId)
        .sort((a, b) => (b.periodYear - a.periodYear) * 12 + (b.periodMonth - a.periodMonth))[0],
    [data.payrollRuns, clientId],
  );

  if (!client) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">No client data</div>;
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50">
      <header className="h-14 bg-[#0F766E] flex items-center px-5 gap-4 text-white">
        <Link href="/marketplace/tasama-payroll-hub" className="text-teal-100 hover:text-white flex items-center gap-1.5 text-xs">
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {isAr ? "العودة" : "Back"}
        </Link>
        <div className="h-5 w-px bg-teal-400" />
        <Building2 size={18} />
        <h1 className="text-sm font-bold">{isAr ? "بوابة العميل" : "Client Portal"}</h1>
        <div className="flex-1" />
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="text-xs bg-[#0E6B66] border border-teal-400 rounded px-2 py-1 text-white"
        >
          {data.clients.map((c) => (
            <option key={c.id} value={c.id} className="text-black">{isAr ? c.legalNameAr : c.legalNameEn}</option>
          ))}
        </select>
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="text-xs px-3 py-1 rounded-full bg-teal-700 hover:bg-teal-600 transition-colors"
        >
          {lang === "en" ? "العربية" : "English"}
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs text-gray-500 uppercase tracking-wider">{isAr ? "العميل" : "Client"}</div>
          <h2 className="text-xl font-bold text-gray-900 mt-1">{isAr ? client.legalNameAr : client.legalNameEn}</h2>
          <div className="text-xs text-gray-500 mt-1">
            {isAr ? "نطاق السعودة:" : "Saudization band:"} {getSaudizationBandLabel(client.saudizationBand as never, lang)} ({formatPercent(client.saudizationPercent)})
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<Users size={18} />} label={isAr ? "إجمالي الموظفين" : "Total employees"} value={`${employees.length}`} sub={`${employees.filter((e) => e.isSaudi).length} ${isAr ? "سعودي" : "Saudi"} • ${employees.filter((e) => !e.isSaudi).length} ${isAr ? "وافد" : "expat"}`} />
          <Stat icon={<Wallet size={18} />} label={isAr ? "إجمالي الراتب الشهري" : "Monthly gross"} value={formatSAR(client.monthlyPayrollGross)} sub={isAr ? "آخر دورة" : `Last cycle: ${lastRun ? `${lastRun.periodMonth}/${lastRun.periodYear}` : "—"}`} />
          <Stat icon={<FileText size={18} />} label={isAr ? "وثائق نشطة" : "Documents"} value={`${documents.length}`} sub={isAr ? "ثنائية اللغة" : "Bilingual EN/AR"} />
          <Stat icon={<CalendarDays size={18} />} label={isAr ? "طلبات نشطة" : "Active requests"} value={`${requests.filter((r) => r.status !== "completed" && r.status !== "rejected").length}`} sub={`${requests.filter((r) => r.status === "completed").length} ${isAr ? "مكتمل" : "completed"}`} />
        </div>

        {/* Employees */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <h3 className="px-5 py-3 text-sm font-bold border-b border-gray-200">{isAr ? "الموظفون" : "Employees"}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-[11px] uppercase text-gray-500">
                  <th className="text-start p-3">{isAr ? "الاسم" : "Name"}</th>
                  <th className="text-start p-3">{isAr ? "المنصب" : "Role"}</th>
                  <th className="text-start p-3">{isAr ? "الجنسية" : "Nationality"}</th>
                  <th className="text-start p-3">{isAr ? "القسم" : "Department"}</th>
                  <th className="text-start p-3">{isAr ? "سنوات الخدمة" : "Years"}</th>
                  <th className="text-start p-3">{isAr ? "الحالة" : "Status"}</th>
                </tr>
              </thead>
              <tbody>
                {employees.slice(0, 12).map((e) => (
                  <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="p-3 font-medium">{isAr ? e.fullNameAr : e.fullNameEn}</td>
                    <td className="p-3 text-gray-600">{isAr ? e.roleAr : e.role}</td>
                    <td className="p-3 text-gray-600">{getNationalityLabel(e.nationality, lang)}</td>
                    <td className="p-3 text-gray-600">{getDepartmentLabel(e.department, lang)}</td>
                    <td className="p-3 text-gray-600">{e.yearsOfService.toFixed(1)}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 text-[11px] rounded-full bg-teal-50 text-[#0F766E]">
                        {getEmployeeStatusLabel(e.status as never, lang)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {employees.length > 12 && (
            <div className="p-3 text-[11px] text-gray-400 text-center border-t border-gray-100">
              {isAr ? `${employees.length - 12} موظفًا إضافيًا` : `+${employees.length - 12} more employees`}
            </div>
          )}
        </section>

        {/* Documents + Requests */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <h3 className="px-5 py-3 text-sm font-bold border-b border-gray-200">{isAr ? "الوثائق" : "Documents"}</h3>
            <div className="divide-y divide-gray-100">
              {documents.map((d) => (
                <a
                  key={d.id}
                  href={`/api/tasama/documents/${d.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 hover:bg-gray-50"
                >
                  <div className="text-xs text-[#0F766E] font-semibold uppercase tracking-wider">
                    {getDocumentTypeLabel(d.type as DocumentType, lang)}
                  </div>
                  <div className="text-sm text-gray-900 mt-0.5">{isAr ? d.titleAr : d.titleEn}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {d.referenceNumber} • {d.issuedAt} • {(d.overallConfidence * 100).toFixed(1)}% confidence
                  </div>
                </a>
              ))}
              {documents.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">{isAr ? "لا توجد وثائق" : "No documents"}</div>}
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <h3 className="px-5 py-3 text-sm font-bold border-b border-gray-200">{isAr ? "طلبات الخدمة" : "Service requests"}</h3>
            <div className="divide-y divide-gray-100">
              {requests.map((r) => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-[#0F766E] font-semibold uppercase tracking-wider">
                        {getRequestTypeLabel(r.type as RequestType, lang)}
                      </div>
                      <div className="text-sm text-gray-900 mt-0.5 truncate">{isAr ? r.titleAr : r.titleEn}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{r.requestedAt} • {r.requestedBy}</div>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 text-[11px] rounded-full ${
                        r.status === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : r.status === "rejected"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                </div>
              ))}
              {requests.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">{isAr ? "لا توجد طلبات" : "No requests"}</div>}
            </div>
          </section>
        </div>

        <p className="text-[11px] text-gray-400 text-center pt-4 border-t border-gray-200">
          {isAr
            ? "هذا هو الأساس التقني لبوابة العميل. التجربة التفاعلية الكاملة قيد البناء."
            : "Foundation shell for the Client Portal. The full immersive experience is being built in downstream tasks."}
        </p>
      </main>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-[#0F766E]">{icon}</span>
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-gray-900 mt-2">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
