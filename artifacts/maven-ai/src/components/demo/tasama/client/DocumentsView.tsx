import { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Upload, FileText, X, Check, AlertTriangle, Brain, ChevronRight, ChevronLeft, FileImage } from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientDocuments, tDict } from "../tasama-i18n";
import { formatDate, getDocumentTypeLabel, getAgentName, type TasamaDocument, type DocumentType } from "@/data/tasama-seed";

const CLIENT_ID = "client-alnakhla";

const DOC_STATUS_COLORS: Record<string, string> = {
  digitized: "bg-emerald-50 text-emerald-700",
  processing: "bg-amber-50 text-amber-700",
  pending: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
};

export default function DocumentsView() {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientDocuments, lang);
  const data = useTasamaData();

  const documents = data.documents.filter((d) => d.clientId === CLIENT_ID);
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedDoc, setSelectedDoc] = useState<TasamaDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const types = useMemo(() => Array.from(new Set(documents.map((d) => d.type))), [documents]);

  const filtered = useMemo(() => documents.filter((d) => {
    if (filterType !== "all" && d.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!d.titleEn.toLowerCase().includes(q) && !d.titleAr.includes(search) && !d.referenceNumber.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [documents, filterType, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{t.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{filtered.length} {t.countSuffix}</p>
        </div>
        <button onClick={() => setUploadOpen(true)} className="px-4 py-2 bg-[#0F0698] text-white rounded-lg text-sm font-semibold hover:bg-[#3B30E0] transition-colors flex items-center gap-2">
          <Upload size={14} /> {t.uploadButton}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchPlaceholder} className="ps-9 pe-3 py-2 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20 focus:border-[#0F0698]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">{t.filterType}</span>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="all">{t.filterAll}</option>
            {types.map((tp) => <option key={tp} value={tp}>{getDocumentTypeLabel(tp, lang)}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 && (
          <div className="col-span-full bg-white rounded-xl border border-gray-100 p-8 text-center text-xs text-gray-400">{t.noDocuments}</div>
        )}
        {filtered.map((d) => {
          const emp = employees.find((e) => e.id === d.employeeId);
          const conf = Math.round(d.overallConfidence * 100);
          return (
            <motion.button
              key={d.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelectedDoc(d)}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-start hover:shadow-md hover:border-blue-200 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileText size={16} className="text-[#0F0698]" />
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${DOC_STATUS_COLORS.digitized}`}>{t.statusDigitized}</span>
              </div>
              <p className="text-xs font-bold mb-1 line-clamp-2">{lang === "en" ? d.titleEn : d.titleAr}</p>
              <p className="text-[10px] text-gray-400 mb-2">{getDocumentTypeLabel(d.type, lang)} · {d.referenceNumber}</p>
              {emp && <p className="text-[11px] text-gray-600 mb-2">{lang === "en" ? emp.fullNameEn : emp.fullNameAr}</p>}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                <span className="text-[10px] text-gray-400">{formatDate(d.issuedAt, lang)}</span>
                <div className="flex items-center gap-1">
                  <Brain size={10} className="text-[#3B30E0]" />
                  <span className={`text-[10px] font-bold ${conf >= 90 ? "text-emerald-600" : conf >= 75 ? "text-amber-600" : "text-red-600"}`}>{conf}%</span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedDoc && <SplitViewer doc={selectedDoc} onClose={() => setSelectedDoc(null)} />}
        {uploadOpen && <UploadWizard onClose={() => setUploadOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  employeeName: "fieldEmployeeName",
  oldPosition: "fieldOldPosition",
  newPosition: "fieldNewPosition",
  effectiveDate: "fieldEffectiveDate",
  newBasic: "fieldNewBasic",
  newHousing: "fieldNewHousing",
  approvalAuthority: "fieldApprovalAuthority",
  terminationType: "fieldTerminationType",
  reason: "fieldReason",
  lastWorkingDay: "fieldLastWorkingDay",
  noticePeriod: "fieldNoticePeriod",
  eosbEligibility: "fieldEosbEligibility",
  settlementAmount: "fieldSettlementAmount",
  position: "fieldPosition",
  contractType: "fieldContractType",
  probationPeriod: "fieldProbationPeriod",
  basicSalary: "fieldBasicSalary",
  housingAllowance: "fieldHousing",
  transportAllowance: "fieldTransport",
  workingHours: "fieldWorkingHours",
  leaveEntitlement: "fieldLeaveEntitlement",
  currentSalary: "fieldCurrentSalary",
  newSalary: "fieldNewSalary",
  increasePercent: "fieldIncreasePct",
  bonusAmount: "fieldBonusAmount",
  performancePeriod: "fieldPerformancePeriod",
  paymentDate: "fieldPaymentDate",
  reviewPeriod: "fieldReviewPeriod",
  overallRating: "fieldOverallRating",
  reviewer: "fieldReviewer",
};

function SplitViewer({ doc, onClose }: { doc: TasamaDocument; onClose: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientDocuments, lang);
  const isRtl = lang === "ar";
  const [toast, setToast] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});

  const overall = Math.round(doc.overallConfidence * 100);
  const fields = Object.entries(doc.extractedFields);

  const apply = () => {
    setToast(t.splitViewerToast);
    setTimeout(() => { setToast(null); onClose(); }, 1500);
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-4 md:inset-8 bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="flex-shrink-0 px-5 py-3 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <FileText size={16} className="text-[#0F0698]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{lang === "en" ? doc.titleEn : doc.titleAr}</p>
            <p className="text-[11px] text-gray-400">{doc.referenceNumber} · {formatDate(doc.issuedAt, lang)}</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50">
            <Brain size={14} className="text-[#0F0698]" />
            <span className="text-[11px] font-semibold text-[#0F0698]">{t.splitViewerOverall}: <span className={`font-bold ${overall >= 90 ? "text-emerald-700" : overall >= 75 ? "text-amber-700" : "text-red-700"}`}>{overall}%</span></span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label={t.splitViewerCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-x divide-gray-100 rtl:divide-x-reverse">
          <div className="overflow-y-auto bg-gray-50 p-6">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-3">{t.splitViewerOriginal}</p>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-md mx-auto" style={{ minHeight: "500px" }}>
              <div className="border-b border-gray-200 pb-4 mb-4 text-center">
                <p className="text-xs font-bold text-[#0F0698]">AL-NAKHLA CONSTRUCTION CO.</p>
                <p className="text-[10px] text-gray-500 mt-1">شركة النخلة للمقاولات</p>
              </div>
              <div className="space-y-3 text-[11px] leading-relaxed text-gray-700">
                <p className="text-end font-semibold">{doc.referenceNumber}</p>
                <p className="text-end">{formatDate(doc.issuedAt, "en")}</p>
                <p className="font-bold text-center mt-6">{doc.titleEn}</p>
                <p className="font-bold text-center" dir="rtl">{doc.titleAr}</p>
                <div className="mt-6 space-y-2 opacity-90">
                  {fields.slice(0, 8).map(([k, v]) => (
                    <p key={k}><span className="font-semibold">{(t[FIELD_LABELS[k] ?? ""] ?? k)}:</span> {v.value}</p>
                  ))}
                </div>
                <div className="mt-8 pt-4 border-t border-gray-200">
                  <p className="text-[10px]">{doc.signedByName}</p>
                  <p className="text-[10px] text-gray-500">{doc.signedByTitle}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-y-auto p-6">
            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-blue-50/60 border border-blue-100">
              <Brain size={14} className="text-[#0F0698]" />
              <p className="text-[11px] text-[#0F0698] font-semibold">{t.splitViewerExtractedBy}</p>
            </div>

            <div className="space-y-2.5">
              {fields.map(([k, v]) => {
                const conf = Math.round(v.confidence * 100);
                const confColor = conf >= 90 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : conf >= 75 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-red-600 bg-red-50 border-red-200";
                const confLabel = conf >= 90 ? t.confidenceHigh : conf >= 75 ? t.confidenceMedium : t.confidenceLow;
                const labelKey = FIELD_LABELS[k];
                const label = labelKey ? t[labelKey] : k;
                return (
                  <div key={k} className="bg-white border border-gray-100 rounded-lg p-3 hover:border-blue-200 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-600">{label}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${confColor}`}>
                        {conf}% {confLabel}
                      </span>
                    </div>
                    <input
                      value={editedFields[k] ?? v.value}
                      onChange={(e) => setEditedFields((p) => ({ ...p, [k]: e.target.value }))}
                      className="w-full text-xs font-semibold text-gray-800 bg-transparent border-none focus:outline-none focus:ring-0 px-0"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">{t.splitViewerCancel}</button>
          <button onClick={apply} className="px-4 py-2 text-xs font-semibold bg-[#0F0698] text-white hover:bg-[#3B30E0] rounded-lg flex items-center gap-1.5">
            <Check size={13} /> {t.splitViewerApply}
          </button>
        </div>

        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-20 start-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </motion.div>
        )}
      </motion.div>
    </>
  );
}

const UPLOAD_DOC_TYPES: DocumentType[] = [
  "employment-contract", "termination-letter", "promotion-letter", "salary-increase-letter",
  "bonus-letter", "performance-review", "contract-renewal", "maternity-leave-approval",
];

function UploadWizard({ onClose }: { onClose: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientDocuments, lang);
  const isRtl = lang === "ar";
  const data = useTasamaData();
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID && e.status !== "separated");

  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState<DocumentType>("promotion-letter");
  const [employeeId, setEmployeeId] = useState<string>(employees[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPT_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

  const validateAndSetFile = (f: File | null | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!ACCEPT_MIME.includes(f.type) && !/\.(pdf|png|jpe?g)$/i.test(f.name)) {
      setFileError(lang === "en" ? "Only PDF, PNG, or JPG files are accepted." : "يُقبل فقط PDF أو PNG أو JPG.");
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError(lang === "en" ? "File too large (max 10 MB)." : "الملف كبير جدًا (الحد 10 ميجابايت).");
      setFile(null);
      return;
    }
    setFile(f);
  };

  const formatBytes = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

  const next = () => {
    if (step === 4) {
      setProcessing(true);
      setTimeout(() => { setProcessing(false); setDone(true); }, 1800);
      setTimeout(() => onClose(), 3500);
    } else {
      setStep(step + 1);
    }
  };

  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const BackIcon = isRtl ? ChevronRight : ChevronLeft;

  const employee = employees.find((e) => e.id === employeeId);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 top-1/2 -translate-y-1/2 md:w-[520px] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden"
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
          <Upload size={16} className="text-[#0F0698]" />
          <p className="text-sm font-bold flex-1">{t.uploadButton}</p>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-2">
          {[t.uploadStep1, t.uploadStep2, t.uploadStep3, t.uploadStep4].map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${step > i ? "bg-[#0F0698] text-white" : step === i + 1 ? "bg-blue-100 text-[#0F0698]" : "bg-gray-100 text-gray-400"}`}>
                {step > i ? <Check size={11} /> : i + 1}
              </div>
              <span className={`text-[10px] font-semibold ${step === i + 1 ? "text-[#0F0698]" : "text-gray-400"} hidden md:inline truncate`}>{label}</span>
              {i < 3 && <div className={`flex-1 h-px ${step > i + 1 ? "bg-[#0F0698]" : "bg-gray-100"}`} />}
            </div>
          ))}
        </div>

        <div className="p-5 min-h-[260px]">
          {processing ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-12 h-12 border-3 border-[#0F0698] border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm font-semibold">{t.uploadProcessing}</p>
              <p className="text-[11px] text-gray-400 mt-1">{getAgentName("document-intelligence", lang)}</p>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <Check size={22} className="text-emerald-700" />
              </div>
              <p className="text-sm font-semibold text-emerald-700">{t.uploadDone}</p>
            </div>
          ) : step === 1 ? (
            <div className="grid grid-cols-2 gap-2">
              {UPLOAD_DOC_TYPES.map((dt) => (
                <button key={dt} onClick={() => setDocType(dt)} className={`text-start p-3 rounded-lg border text-xs font-semibold transition-colors ${docType === dt ? "border-[#0F0698] bg-blue-50 text-[#0F0698]" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                  {getDocumentTypeLabel(dt, lang)}
                </button>
              ))}
            </div>
          ) : step === 2 ? (
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase mb-2 block">{t.uploadEmployeePicker}</label>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{lang === "en" ? e.fullNameEn : e.fullNameAr} ({e.id})</option>
                ))}
              </select>
            </div>
          ) : step === 3 ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => validateAndSetFile(e.target.files?.[0])}
                aria-label={t.uploadDropzone}
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  validateAndSetFile(e.dataTransfer.files?.[0]);
                }}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-[#0F0698] bg-blue-50" : "border-gray-200 hover:border-[#0F0698]"
                }`}
              >
                <FileImage size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-600">{t.uploadDropzone}</p>
                <p className="text-[11px] text-gray-400 mt-1">{t.uploadDropzoneSupported}</p>
                {file && (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg">
                    <FileText size={12} className="text-[#0F0698]" />
                    <span className="text-[11px] font-semibold text-[#0F0698]">{file.name}</span>
                    <span className="text-[10px] text-gray-500">({formatBytes(file.size)})</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="ms-1 text-gray-400 hover:text-red-600"
                      aria-label={lang === "en" ? "Remove file" : "إزالة الملف"}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
              {fileError && (
                <div className="mt-3 flex items-start gap-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <ReviewRow label={t.uploadStep1} value={getDocumentTypeLabel(docType, lang)} />
              <ReviewRow label={t.uploadStep2} value={employee ? (lang === "en" ? employee.fullNameEn : employee.fullNameAr) : "—"} />
              <ReviewRow label={t.uploadStep3} value={file ? `${file.name} (${formatBytes(file.size)})` : "—"} />
            </div>
          )}
        </div>

        {!processing && !done && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <button onClick={() => step > 1 ? setStep(step - 1) : onClose()} className="px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1">
              <BackIcon size={13} /> {step > 1 ? t.uploadBackButton : t.uploadCancelButton}
            </button>
            <button onClick={next} disabled={step === 3 && !file} className="px-4 py-2 text-xs font-semibold bg-[#0F0698] text-white hover:bg-[#3B30E0] rounded-lg flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
              {step === 4 ? t.uploadConfirmButton : t.uploadNextButton} <NextIcon size={13} />
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className="text-xs font-semibold text-gray-800">{value}</span>
    </div>
  );
}
