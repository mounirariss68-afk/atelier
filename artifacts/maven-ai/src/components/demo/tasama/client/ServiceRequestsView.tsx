import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Clock, ChevronDown, AlertCircle, Download, ArrowRight } from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientRequests, tDict } from "../tasama-i18n";
import { useToast } from "./ToastContext";
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

const OVERDUE_GUIDANCE: Partial<Record<RequestType, { tasama: { en: string; ar: string }; you: { en: string; ar: string } }>> = {
  "salary-certificate": {
    tasama: { en: "Generating bilingual letter, applying client letterhead, awaiting compliance officer signature.", ar: "إعداد الخطاب ثنائي اللغة وتطبيق ترويسة العميل بانتظار توقيع مسؤول الالتزام." },
    you:    { en: "Confirm recipient bank or embassy name and preferred delivery format (email PDF / sealed hard copy).", ar: "أكّد اسم البنك أو السفارة المستلِمة وتنسيق التسليم المفضل (PDF أو نسخة ورقية مختومة)." },
  },
  "experience-letter": {
    tasama: { en: "Drafting service-history letter from HRMS dates and final job title; legal review pending.", ar: "صياغة خطاب الخبرة من سجل الخدمة والمسمى الوظيفي النهائي بانتظار المراجعة القانونية." },
    you:    { en: "Approve final job title and any optional remarks (achievements, salary disclosure).", ar: "اعتمد المسمى الوظيفي النهائي وأي ملاحظات اختيارية (الإنجازات أو الإفصاح عن الراتب)." },
  },
  "leave-request": {
    tasama: { en: "Recalculating accrual balance and posting to next payroll run.", ar: "إعادة احتساب رصيد الإجازات وقيدها في دورة الرواتب التالية." },
    you:    { en: "Manager approval required on the leave dates and handover plan.", ar: "اعتماد المدير مطلوب على تواريخ الإجازة وخطة التسليم." },
  },
  "iqama-renewal": {
    tasama: { en: "Filing renewal with Absher; awaiting Muqeem confirmation and updated insurance policy.", ar: "تقديم التجديد عبر أبشر بانتظار تأكيد مقيم وتحديث وثيقة التأمين." },
    you:    { en: "Upload current passport copy (≥6 months validity) and pay government fee invoice.", ar: "ارفع نسخة جواز السفر الحالية (صلاحية ≥6 أشهر) وسدّد فاتورة الرسوم الحكومية." },
  },
  "loan-request": {
    tasama: { en: "Running affordability check (DBR ≤ 65%) and structuring repayment schedule.", ar: "إجراء فحص القدرة المالية (نسبة الالتزام ≤ 65%) وهيكلة جدول السداد." },
    you:    { en: "Sign loan agreement and confirm payroll-deduction term (max 24 months).", ar: "وقّع عقد القرض وأكّد مدة الاستقطاع من الراتب (بحد أقصى 24 شهرًا)." },
  },
  "advance-request": {
    tasama: { en: "Validating eligibility (no overlap with prior advance) and queuing same-day Mudad transfer.", ar: "التحقق من الأهلية (عدم تعارض مع سلفة سابقة) وإدراج التحويل عبر مدد في اليوم نفسه." },
    you:    { en: "Provide reason code and confirm one-month full deduction from next salary.", ar: "حدّد رمز السبب وأكّد الخصم الكامل من راتب الشهر التالي." },
  },
  "data-correction": {
    tasama: { en: "Reviewing supporting evidence and updating master record once verified.", ar: "مراجعة المستندات المؤيدة وتحديث السجل الرئيسي بعد التحقق." },
    you:    { en: "Attach the legal document (national ID, passport, or marriage certificate) proving the correction.", ar: "أرفق الوثيقة الرسمية (الهوية أو جواز السفر أو وثيقة الزواج) المثبِتة للتصحيح." },
  },
  "iban-update": {
    tasama: { en: "Verifying new IBAN with SAMA and re-routing next payroll deposit.", ar: "التحقق من رقم الآيبان الجديد مع ساما وإعادة توجيه إيداع الراتب القادم." },
    you:    { en: "Upload IBAN certificate from your bank dated within the last 30 days.", ar: "ارفع شهادة الآيبان من بنكك مؤرخة خلال آخر 30 يومًا." },
  },
};

interface QuickRequestOption {
  id: string;
  type: RequestType;
  labelKey: "requestTypeSalaryCert" | "requestTypeIqama" | "requestTypeHrdf" | "requestTypeFinalSettlement" | "requestTypeSalaryAdj" | "requestTypeOther";
  catKey: "requestCatPayroll" | "requestCatGov" | "requestCatLifecycle" | "requestCatOther";
}

const QUICK_REQUESTS: QuickRequestOption[] = [
  { id: "salary-cert", type: "salary-certificate", labelKey: "requestTypeSalaryCert", catKey: "requestCatPayroll" },
  { id: "salary-adj", type: "promotion-request", labelKey: "requestTypeSalaryAdj", catKey: "requestCatPayroll" },
  { id: "iqama", type: "iqama-renewal", labelKey: "requestTypeIqama", catKey: "requestCatGov" },
  { id: "hrdf", type: "training-nomination", labelKey: "requestTypeHrdf", catKey: "requestCatGov" },
  { id: "final-settlement", type: "exit-request", labelKey: "requestTypeFinalSettlement", catKey: "requestCatLifecycle" },
  { id: "other", type: "data-correction", labelKey: "requestTypeOther", catKey: "requestCatOther" },
];

export default function ServiceRequestsView() {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientRequests, lang);
  const data = useTasamaData();
  const { toast } = useToast();
  const requests = data.serviceRequests.filter((r) => r.clientId === CLIENT_ID);
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID);

  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selected, setSelected] = useState<ServiceRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [presetType, setPresetType] = useState<RequestType | undefined>(undefined);
  const [splitOpen, setSplitOpen] = useState(false);
  const [expandedOverdueId, setExpandedOverdueId] = useState<string | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!splitOpen) return;
    const onClick = (e: MouseEvent) => {
      if (splitRef.current && !splitRef.current.contains(e.target as Node)) setSplitOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSplitOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [splitOpen]);

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
    toast(t.submitToast, "success");
  };

  const statusLabel = (s: string) => s === "submitted" ? t.statusSubmitted : s === "in-review" ? t.statusInReview : s === "in-progress" ? t.statusInProgress : s === "completed" ? t.statusCompleted : t.statusRejected;

  const groupedQuick = useMemo(() => {
    const groups: Record<string, QuickRequestOption[]> = {};
    QUICK_REQUESTS.forEach((q) => {
      if (!groups[q.catKey]) groups[q.catKey] = [];
      groups[q.catKey].push(q);
    });
    return groups;
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{active.length} {t.openSuffix}</p>
        </div>
        <div ref={splitRef} className="relative">
          <div className="flex items-stretch rounded-lg overflow-hidden shadow-sm">
            <button
              onClick={() => { setPresetType(undefined); setCreateOpen(true); }}
              className="px-4 py-2 bg-[#0F0698] text-white text-sm font-semibold hover:bg-[#3B30E0] transition-colors flex items-center gap-2"
            >
              <Plus size={14} /> {t.newRequest}
            </button>
            <button
              onClick={() => setSplitOpen(!splitOpen)}
              className="px-2 py-2 bg-[#0F0698] text-white border-s border-white/20 hover:bg-[#3B30E0] transition-colors"
              aria-label="More request types"
            >
              <ChevronDown size={14} className={`transition-transform ${splitOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          <AnimatePresence>
            {splitOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute end-0 top-full mt-1 w-72 bg-white border border-gray-100 rounded-xl shadow-xl z-30 overflow-hidden"
              >
                {Object.entries(groupedQuick).map(([catKey, items]) => (
                  <div key={catKey} className="py-1">
                    <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50">
                      {t[catKey as keyof typeof t]}
                    </p>
                    {items.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => {
                          setPresetType(q.type);
                          setSplitOpen(false);
                          setCreateOpen(true);
                          toast(t.newRequestSplitToast, "info");
                        }}
                        className="w-full text-start px-3 py-2 text-xs hover:bg-blue-50 text-gray-700 hover:text-[#0F0698] transition-colors"
                      >
                        {t[q.labelKey]}
                      </button>
                    ))}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">{t.filterType}</span>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
            <option value="all">{t.filterAll}</option>
            {types.map((tp) => <option key={tp} value={tp}>{getRequestTypeLabel(tp, lang)}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">{t.filterStatus}</span>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
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
              const expanded = expandedOverdueId === r.id;
              return (
                <div key={r.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${overdue ? "border-amber-200" : "border-gray-100"}`}>
                  <button onClick={() => setSelected(r)} className="w-full p-4 text-start hover:bg-gray-50/40 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${sCol.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${sCol.bg} ${sCol.text}`}>{statusLabel(r.status)}</span>
                          <span className="text-[10px] text-gray-400">{r.id}</span>
                          {(r.priority === "high" || r.priority === "critical") && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-700">{t.priorityUrgent ?? "Urgent"}</span>
                          )}
                          {overdue && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                              <AlertCircle size={9} /> {t.slaOverdue}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold mb-0.5">{lang === "en" ? r.titleEn : r.titleAr}</p>
                        <p className="text-[11px] text-gray-500 line-clamp-2">{lang === "en" ? r.description : r.descriptionAr}</p>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {emp && <span className="text-[10px] text-gray-400">{lang === "en" ? emp.fullNameEn : emp.fullNameAr}</span>}
                          <span className="text-[10px] text-gray-400">{formatDate(r.requestedAt, lang)}</span>
                          {r.assignedAgent && <span className="text-[10px] text-[#3B30E0] font-medium">{getAgentName(r.assignedAgent, lang)}</span>}
                          <span className={`text-[10px] font-semibold flex items-center gap-1 ms-auto ${overdue ? "text-amber-700" : "text-gray-500"}`}>
                            <Clock size={10} />
                            {overdue ? t.slaOverdue : `${slaHours}h ${t.slaRemaining}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                  {overdue && (
                    <div className="border-t border-amber-200 bg-amber-50/40">
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedOverdueId(expanded ? null : r.id); }}
                        className="w-full px-4 py-2 text-[11px] font-semibold text-amber-800 hover:bg-amber-100/40 transition-colors flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5"><AlertCircle size={11} /> {t.overdueExpand}</span>
                        <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                      </button>
                      <AnimatePresence>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            {(() => {
                              const g = OVERDUE_GUIDANCE[r.type];
                              const tasamaText = g ? g.tasama[lang] : t.overdueDefaultTasama;
                              const youText = g ? g.you[lang] : t.overdueDefaultYou;
                              return (
                                <div className="px-4 pb-3 grid md:grid-cols-2 gap-3 text-[11px]">
                                  <div className="bg-white/70 rounded-lg p-3 border border-amber-200/60">
                                    <p className="text-[10px] font-bold uppercase text-amber-700 mb-1.5 tracking-wide">{t.overdueWaitTasama}</p>
                                    <p className="text-gray-700 leading-relaxed">{tasamaText}</p>
                                  </div>
                                  <div className="bg-white/70 rounded-lg p-3 border border-amber-200/60">
                                    <p className="text-[10px] font-bold uppercase text-amber-700 mb-1.5 tracking-wide">{t.overdueWaitYou}</p>
                                    <p className="text-gray-700 leading-relaxed">{youText}</p>
                                  </div>
                                </div>
                              );
                            })()}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
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
        {createOpen && <CreateForm presetType={presetType} onClose={() => setCreateOpen(false)} onSubmit={submit} />}
      </AnimatePresence>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        className={`fixed top-0 ${isRtl ? "left-0" : "right-0"} h-full w-[440px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto tasama-scroll`}
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
                  <div className={`absolute -start-[22px] top-0.5 w-3 h-3 rounded-full ${e.done ? "bg-[#0F0698]" : "bg-gray-200"}`} />
                  <p className={`text-xs ${e.done ? "font-semibold text-gray-800" : "text-gray-400"}`}>{e.label}</p>
                  {e.time && e.done && <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(e.time, lang)}</p>}
                </div>
              ))}
            </div>
          </div>

          {request.status === "completed" && (
            <div>
              <p className="text-[11px] font-bold uppercase text-gray-400 mb-2 tracking-wide">{t.detailOutput}</p>
              <button className="w-full px-4 py-3 border border-[#0F0698] text-[#0F0698] hover:bg-blue-50 rounded-lg text-xs font-semibold flex items-center justify-center gap-2">
                <Download size={13} /> {t.detailDownload}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function CreateForm({ presetType, onClose, onSubmit }: { presetType?: RequestType; onClose: () => void; onSubmit: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientRequests, lang);
  const isRtl = lang === "ar";
  const data = useTasamaData();
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID && e.status !== "separated");

  const [type, setType] = useState<RequestType>(presetType ?? "salary-certificate");
  const [employeeId, setEmployeeId] = useState<string>(employees[0]?.id ?? "");
  const [priority, setPriority] = useState<string>("medium");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          <Plus size={16} className="text-[#0F0698]" />
          <p className="text-sm font-bold flex-1">{t.newRequest}</p>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t.formType}>
            <select value={type} onChange={(e) => setType(e.target.value as RequestType)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
              {REQUEST_TYPES.map((rt) => <option key={rt} value={rt}>{getRequestTypeLabel(rt, lang)}</option>)}
            </select>
          </Field>
          <Field label={t.formEmployee}>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
              {employees.map((e) => <option key={e.id} value={e.id}>{lang === "en" ? e.fullNameEn : e.fullNameAr}</option>)}
            </select>
          </Field>
          <Field label={t.formPriority}>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
              <option value="low">{lang === "en" ? "Low" : "منخفض"}</option>
              <option value="medium">{t.priorityNormal}</option>
              <option value="high">{lang === "en" ? "High" : "عالٍ"}</option>
              <option value="critical">{t.priorityUrgent}</option>
            </select>
          </Field>
          <Field label={t.formNotes}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">{t.formCancel}</button>
          <button onClick={onSubmit} className="px-4 py-2 text-xs font-semibold bg-[#0F0698] text-white hover:bg-[#3B30E0] rounded-lg flex items-center gap-1.5">
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
