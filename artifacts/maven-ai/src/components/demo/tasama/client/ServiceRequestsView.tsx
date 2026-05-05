import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Clock, Check, AlertCircle, Inbox, Download, ArrowRight } from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientRequests, tDict } from "../tasama-i18n";
import { formatDate, getRequestTypeLabel, getAgentName, type ServiceRequest, type RequestType } from "@/data/tasama-seed";

const CLIENT_ID = "client-alnakhla";

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  submitted: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "in-review": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  "in-progress": { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  rejected: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

const REQUEST_TYPES: RequestType[] = [
  "salary-certificate", "experience-letter", "leave-request", "iqama-renewal",
  "loan-request", "advance-request", "data-correction", "iban-update",
];

export default function ServiceRequestsView() {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientRequests, lang);
  const data = useTasamaData();
  const requests = data.serviceRequests.filter((r) => r.clientId === CLIENT_ID);
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID);

  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selected, setSelected] = useState<ServiceRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => requests.filter((r) => {
    if (filterType !== "all" && r.type !== filterType) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  }), [requests, filterType, filterStatus]);

  const active = filtered.filter((r) => r.status !== "completed" && r.status !== "rejected");
  const completed = filtered.filter((r) => r.status === "completed" || r.status === "rejected");
  const types = useMemo(() => Array.from(new Set(requests.map((r) => r.type))), [requests]);
  const statuses = ["submitted", "in-review", "in-progress", "completed", "rejected"];

  const submit = () => {
    setCreateOpen(false);
    setToast(t.submitToast);
    setTimeout(() => setToast(null), 2000);
  };

  const statusLabel = (s: string) => s === "submitted" ? t.statusSubmitted : s === "in-review" ? t.statusInReview : s === "in-progress" ? t.statusInProgress : s === "completed" ? t.statusCompleted : t.statusRejected;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{active.length} {t.openSuffix}</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="px-4 py-2 bg-[#0F766E] text-white rounded-lg text-sm font-semibold hover:bg-[#0D9488] transition-colors flex items-center gap-2">
          <Plus size={14} /> {t.newRequest}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">{t.filterType}</span>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="all">{t.filterAll}</option>
            {types.map((tp) => <option key={tp} value={tp}>{getRequestTypeLabel(tp, lang)}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">{t.filterStatus}</span>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="all">{t.filterAll}</option>
            {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </div>
      </div>

      <Section title={t.sectionActive}>
        {active.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-400">{t.noRequests}</div>
        ) : (
          <div className="space-y-2">
            {active.map((r) => {
              const emp = employees.find((e) => e.id === r.employeeId);
              const sCol = STATUS_COLORS[r.status];
              const slaHours = Math.max(0, r.slaTargetHours - Math.floor((Date.now() - new Date(r.requestedAt).getTime()) / 3600000));
              const overdue = slaHours === 0;
              return (
                <button key={r.id} onClick={() => setSelected(r)} className="w-full bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-start hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${sCol.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${sCol.bg} ${sCol.text}`}>{statusLabel(r.status)}</span>
                        <span className="text-[10px] text-gray-400">{r.id}</span>
                        {r.priority === "high" || r.priority === "critical" ? (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-700">{t.priorityUrgent ?? "Urgent"}</span>
                        ) : null}
                      </div>
                      <p className="text-xs font-bold mb-0.5">{lang === "en" ? r.titleEn : r.titleAr}</p>
                      <p className="text-[11px] text-gray-500 line-clamp-2">{lang === "en" ? r.description : r.descriptionAr}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {emp && <span className="text-[10px] text-gray-400">{lang === "en" ? emp.fullNameEn : emp.fullNameAr}</span>}
                        <span className="text-[10px] text-gray-400">{formatDate(r.requestedAt, lang)}</span>
                        {r.assignedAgent && <span className="text-[10px] text-[#0D9488] font-medium">{getAgentName(r.assignedAgent, lang)}</span>}
                        <span className={`text-[10px] font-semibold flex items-center gap-1 ms-auto ${overdue ? "text-red-600" : "text-gray-500"}`}>
                          <Clock size={10} />
                          {overdue ? t.slaOverdue : `${slaHours}h ${t.slaRemaining}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {completed.length > 0 && (
        <Section title={t.sectionCompleted}>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {completed.slice(0, 6).map((r) => {
              const emp = employees.find((e) => e.id === r.employeeId);
              const sCol = STATUS_COLORS[r.status];
              return (
                <button key={r.id} onClick={() => setSelected(r)} className="w-full px-4 py-3 text-start hover:bg-gray-50/60 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sCol.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{lang === "en" ? r.titleEn : r.titleAr}</p>
                    <p className="text-[10px] text-gray-400">{r.id} · {emp ? (lang === "en" ? emp.fullNameEn : emp.fullNameAr) : ""}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${sCol.bg} ${sCol.text}`}>{statusLabel(r.status)}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <AnimatePresence>
        {selected && <RequestDetail request={selected} onClose={() => setSelected(null)} />}
        {createOpen && <CreateForm onClose={() => setCreateOpen(false)} onSubmit={submit} />}
      </AnimatePresence>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-6 start-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </motion.div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-bold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function RequestDetail({ request, onClose }: { request: ServiceRequest; onClose: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientRequests, lang);
  const isRtl = lang === "ar";
  const data = useTasamaData();
  const emp = data.employees.find((e) => e.id === request.employeeId);
  const sCol = STATUS_COLORS[request.status];
  const statusLabel = request.status === "submitted" ? t.statusSubmitted : request.status === "in-review" ? t.statusInReview : request.status === "in-progress" ? t.statusInProgress : request.status === "completed" ? t.statusCompleted : t.statusRejected;

  const events = [
    { key: "submitted", label: t.timelineSubmitted, time: request.requestedAt, done: true },
    { key: "assigned", label: `${t.timelineAssigned} ${request.assignedAgent ? getAgentName(request.assignedAgent, lang) : "—"}`, time: request.requestedAt, done: !!request.assignedAgent },
    { key: "processing", label: t.timelineProcessing, time: request.requestedAt, done: request.status === "in-progress" || request.status === "completed" },
    { key: "completed", label: t.timelineCompleted, time: request.completedAt ?? "", done: request.status === "completed" },
  ];

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <motion.div
        initial={{ x: isRtl ? "-100%" : "100%" }}
        animate={{ x: 0 }}
        exit={{ x: isRtl ? "-100%" : "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className={`fixed top-0 ${isRtl ? "left-0" : "right-0"} h-full w-[440px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto`}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${sCol.bg} ${sCol.text}`}>{statusLabel}</span>
              <span className="text-[10px] text-gray-400">{request.id}</span>
            </div>
            <p className="text-sm font-bold truncate">{lang === "en" ? request.titleEn : request.titleAr}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label={t.closeDetail}><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase text-gray-400 mb-2 tracking-wide">{t.detailDescription}</p>
            <p className="text-xs text-gray-700 leading-relaxed">{lang === "en" ? request.description : request.descriptionAr}</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">{t.requestedBy}</span><span className="font-semibold">{request.requestedBy}</span></div>
            {emp && <div className="flex justify-between"><span className="text-gray-500">{lang === "en" ? "Employee" : "الموظف"}</span><span className="font-semibold">{lang === "en" ? emp.fullNameEn : emp.fullNameAr}</span></div>}
            <div className="flex justify-between"><span className="text-gray-500">{lang === "en" ? "Type" : "النوع"}</span><span className="font-semibold">{getRequestTypeLabel(request.type, lang)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">{lang === "en" ? "Priority" : "الأولوية"}</span><span className="font-semibold capitalize">{request.priority}</span></div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase text-gray-400 mb-3 tracking-wide">{lang === "en" ? "Timeline" : "الجدول الزمني"}</p>
            <div className="space-y-3 relative ms-2 ps-4 border-s-2 border-gray-100">
              {events.map((e) => (
                <div key={e.key} className="relative">
                  <div className={`absolute -start-[22px] top-0.5 w-3 h-3 rounded-full ${e.done ? "bg-[#0F766E]" : "bg-gray-200"}`} />
                  <p className={`text-xs ${e.done ? "font-semibold text-gray-800" : "text-gray-400"}`}>{e.label}</p>
                  {e.time && e.done && <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(e.time, lang)}</p>}
                </div>
              ))}
            </div>
          </div>

          {request.status === "completed" && (
            <div>
              <p className="text-[11px] font-bold uppercase text-gray-400 mb-2 tracking-wide">{t.detailOutput}</p>
              <button className="w-full px-4 py-3 border border-[#0F766E] text-[#0F766E] hover:bg-teal-50 rounded-lg text-xs font-semibold flex items-center justify-center gap-2">
                <Download size={13} /> {t.detailDownload}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function CreateForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientRequests, lang);
  const isRtl = lang === "ar";
  const data = useTasamaData();
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID && e.status !== "separated");

  const [type, setType] = useState<RequestType>("salary-certificate");
  const [employeeId, setEmployeeId] = useState<string>(employees[0]?.id ?? "");
  const [priority, setPriority] = useState<string>("medium");
  const [notes, setNotes] = useState("");

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 top-1/2 -translate-y-1/2 md:w-[480px] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden"
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Plus size={16} className="text-[#0F766E]" />
          <p className="text-sm font-bold flex-1">{t.newRequest}</p>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t.formType}>
            <select value={type} onChange={(e) => setType(e.target.value as RequestType)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20">
              {REQUEST_TYPES.map((rt) => <option key={rt} value={rt}>{getRequestTypeLabel(rt, lang)}</option>)}
            </select>
          </Field>
          <Field label={t.formEmployee}>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20">
              {employees.map((e) => <option key={e.id} value={e.id}>{lang === "en" ? e.fullNameEn : e.fullNameAr}</option>)}
            </select>
          </Field>
          <Field label={t.formPriority}>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20">
              <option value="low">{lang === "en" ? "Low" : "منخفض"}</option>
              <option value="medium">{t.priorityNormal}</option>
              <option value="high">{lang === "en" ? "High" : "عالٍ"}</option>
              <option value="critical">{t.priorityUrgent}</option>
            </select>
          </Field>
          <Field label={t.formNotes}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">{t.formCancel}</button>
          <button onClick={onSubmit} className="px-4 py-2 text-xs font-semibold bg-[#0F766E] text-white hover:bg-[#0D9488] rounded-lg flex items-center gap-1.5">
            {t.formSubmit} <ArrowRight size={13} className="rtl:rotate-180" />
          </button>
        </div>
      </motion.div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-500 uppercase block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
