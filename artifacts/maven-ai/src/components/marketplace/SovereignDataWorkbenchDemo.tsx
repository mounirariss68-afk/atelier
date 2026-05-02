import { useMemo, useState } from "react";
import { Database, RotateCcw, ShieldCheck, ArrowRight } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

interface Source {
  id: string;
  label: { en: string; ar: string };
  classification: "public" | "internal" | "restricted" | "secret";
  recordsM: number;
  freshnessHrs: number;
  selected: boolean;
}

interface Transform {
  id: string;
  label: { en: string; ar: string };
  enabled: boolean;
  obligation: { en: string; ar: string };
}

interface Sink {
  id: string;
  label: { en: string; ar: string };
  region: string;
  blocked: boolean;
  reason: { en: string; ar: string };
}

const SOURCES: Source[] = [
  { id: "billing", label: { en: "Telecom billing CDRs", ar: "سجلات فوترة اتصالات" }, classification: "restricted", recordsM: 480, freshnessHrs: 6, selected: true },
  { id: "crm", label: { en: "Sovereign CRM contacts", ar: "جهات اتصال CRM السيادي" }, classification: "restricted", recordsM: 12, freshnessHrs: 2, selected: true },
  { id: "ext-fx", label: { en: "External FX rates feed", ar: "تدفق أسعار صرف خارجي" }, classification: "public", recordsM: 0.05, freshnessHrs: 1, selected: false },
  { id: "hr", label: { en: "HR roster snapshot", ar: "لقطة قوائم الموارد البشرية" }, classification: "secret", recordsM: 0.05, freshnessHrs: 24, selected: false },
];

const TRANSFORMS_INIT: Transform[] = [
  { id: "pii", label: { en: "PII masking", ar: "إخفاء بيانات شخصية" }, enabled: true, obligation: { en: "PDPL Art 10 — masking required outside Lawful Basis", ar: "حماية البيانات م 10 — إخفاء مطلوب خارج الأساس القانوني" } },
  { id: "geo", label: { en: "Geo-fence to in-country region", ar: "تقييد جغرافي للمنطقة الداخلية" }, enabled: true, obligation: { en: "Sovereign cloud charter — sovereignty boundary", ar: "ميثاق السحابة السيادية — حدود السيادة" } },
  { id: "lineage", label: { en: "Lineage tag (always on)", ar: "وسم النسب (دائماً)" }, enabled: true, obligation: { en: "Internal data contract requires upstream lineage", ar: "عقد البيانات الداخلي يستلزم نسباً تصاعدياً" } },
  { id: "agg", label: { en: "Aggregate ≥ 100 subjects", ar: "تجميع ≥ 100 شخص" }, enabled: false, obligation: { en: "Re-identification risk control", ar: "ضابط مخاطر إعادة التعريف" } },
];

const SINKS_DEF = (transforms: Transform[]): Sink[] => {
  const pii = transforms.find((t) => t.id === "pii")!.enabled;
  const geo = transforms.find((t) => t.id === "geo")!.enabled;
  const agg = transforms.find((t) => t.id === "agg")!.enabled;
  return [
    {
      id: "lake",
      label: { en: "Sovereign data lake (gov-cloud)", ar: "بحيرة بيانات سيادية (سحابة الحكومة)" },
      region: "in-country",
      blocked: false,
      reason: { en: "Always allowed — in-country, full controls.", ar: "مسموح دائماً — داخل البلد، ضوابط كاملة." },
    },
    {
      id: "bi",
      label: { en: "BI dashboard (analytics group)", ar: "لوحة تحليلات (مجموعة التحليلات)" },
      region: "in-country",
      blocked: !pii,
      reason: pii
        ? { en: "Allowed — PII masked.", ar: "مسموح — إخفاء PII فعّال." }
        : { en: "Blocked — PII masking is OFF.", ar: "محظور — إخفاء PII مُطفأ." },
    },
    {
      id: "bench",
      label: { en: "External benchmarking partner", ar: "شريك تقييم خارجي" },
      region: "cross-border",
      blocked: !(pii && geo && agg),
      reason:
        pii && geo && agg
          ? { en: "Allowed — masked, geo-aware, aggregated.", ar: "مسموح — مُخفى ومراعٍ للجغرافيا ومجمّع." }
          : {
              en: `Blocked — needs ${[!pii && "PII masking", !geo && "geo-fence", !agg && "aggregation"]
                .filter(Boolean)
                .join(", ")}.`,
              ar: `محظور — يحتاج ${[!pii && "إخفاء PII", !geo && "تقييد جغرافي", !agg && "تجميع"].filter(Boolean).join("، ")}.`,
            },
    },
    {
      id: "model",
      label: { en: "Model training cluster (in-country)", ar: "عنقود تدريب النماذج (داخلي)" },
      region: "in-country",
      blocked: !pii,
      reason: pii
        ? { en: "Allowed — masked features only.", ar: "مسموح — ميزات مُخفاة فقط." }
        : { en: "Blocked — training on raw PII forbidden.", ar: "محظور — التدريب على PII خام ممنوع." },
    },
  ];
};

const CLASS_COLOR: Record<Source["classification"], string> = {
  public: "#196B24",
  internal: "#156082",
  restricted: "#F5A623",
  secret: "#B91C1C",
};

const COPY = {
  eyebrow: { en: "Sovereign Data Workbench", ar: "بنش البيانات السيادي" },
  title: {
    en: "Pipelines that respect sovereignty boundaries — by construction.",
    ar: "خطوط بيانات تحترم حدود السيادة — بطبيعتها.",
  },
  intro: {
    en: "Pick sources, toggle transforms, and the lineage graph and the per-sink policy decision regenerate. Every blocked sink names the obligation that blocked it.",
    ar: "اختر المصادر، بدّل التحويلات، فيُعاد رسم رسم النسب وقرار السياسة لكل وجهة. كل وجهة محظورة تذكر الالتزام الذي يمنعها.",
  },
  reset: { en: "Reset workbench", ar: "إعادة البنش" },
  sources: { en: "Sources", ar: "المصادر" },
  transforms: { en: "Transforms (data contract)", ar: "تحويلات (عقد البيانات)" },
  lineage: { en: "Lineage preview", ar: "معاينة النسب" },
  sinks: { en: "Permitted destinations", ar: "الوجهات المسموح بها" },
  records: { en: "records", ar: "سجل" },
  freshness: { en: "Fresh", ar: "حداثة" },
  hours: { en: "h", ar: "س" },
  on: { en: "ON", ar: "ON" },
  off: { en: "OFF", ar: "OFF" },
  obligation: { en: "Obligation", ar: "الالتزام" },
  allowed: { en: "Allowed", ar: "مسموح" },
  blocked: { en: "Blocked", ar: "محظور" },
  reason: { en: "Why", ar: "لماذا" },
  millions: { en: "M", ar: "م" },
  noSources: { en: "Pick at least one source to draft a pipeline.", ar: "اختر مصدراً على الأقل لصياغة خط بيانات." },
};

export default function SovereignDataWorkbenchDemo() {
  const { lang } = useLang();
  const [sources, setSources] = useState<Source[]>(() => SOURCES.map((s) => ({ ...s })));
  const [transforms, setTransforms] = useState<Transform[]>(() => TRANSFORMS_INIT.map((t) => ({ ...t })));

  const reset = () => {
    setSources(SOURCES.map((s) => ({ ...s })));
    setTransforms(TRANSFORMS_INIT.map((t) => ({ ...t })));
  };

  const toggleSource = (id: string) =>
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)));
  const toggleTransform = (id: string) =>
    setTransforms((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));

  const sinks = useMemo(() => SINKS_DEF(transforms), [transforms]);
  const selected = sources.filter((s) => s.selected);
  const allowedCount = sinks.filter((k) => !k.blocked).length;

  return (
    <DemoShell
      slug="sovereign-data-workbench"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#0E2841"
      Icon={Database}
      note={{
        en: "Sample classifications and obligations are illustrative — modeled on PDPL + sovereign-cloud charter alignment.",
        ar: "التصنيفات والالتزامات توضيحية — تحاكي مواءمة PDPL وميثاق السحابة السيادية.",
      }}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Sources + Transforms */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
              {tStr(COPY.sources, lang)}
            </p>
            <div className="space-y-2">
              {sources.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSource(s.id)}
                  className={`w-full text-start bg-white rounded-2xl border-2 p-4 transition-colors ${
                    s.selected ? "border-[#0E2841]" : "border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: CLASS_COLOR[s.classification] }}
                    >
                      {s.classification}
                    </span>
                    <span className="ms-auto text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {s.recordsM}
                      {tStr(COPY.millions, lang)} {tStr(COPY.records, lang)} · {tStr(COPY.freshness, lang)}{" "}
                      {s.freshnessHrs}
                      {tStr(COPY.hours, lang)}
                    </span>
                  </div>
                  <p className="font-bold text-[#0E2841]">{tStr(s.label, lang)}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
              {tStr(COPY.transforms, lang)}
            </p>
            <div className="space-y-2">
              {transforms.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleTransform(t.id)}
                  disabled={t.id === "lineage"}
                  className={`w-full text-start bg-white rounded-2xl border-2 p-4 transition-colors disabled:opacity-90 ${
                    t.enabled ? "border-[#196B24]" : "border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: t.enabled ? "#196B24" : "#94A3B8" }}
                    >
                      {t.enabled ? tStr(COPY.on, lang) : tStr(COPY.off, lang)}
                    </span>
                  </div>
                  <p className="font-bold text-[#0E2841]">{tStr(t.label, lang)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">
                    {tStr(COPY.obligation, lang)}: {tStr(t.obligation, lang)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Lineage graph */}
      <section className="py-10 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.lineage, lang)}
          </p>
          {selected.length === 0 ? (
            <p className="text-sm text-gray-500 italic">{tStr(COPY.noSources, lang)}</p>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
              <Column title={tStr(COPY.sources, lang)}>
                {selected.map((s) => (
                  <Box key={s.id} color={CLASS_COLOR[s.classification]} title={tStr(s.label, lang)} subtitle={s.classification} />
                ))}
              </Column>
              <Column title={tStr(COPY.transforms, lang)}>
                {transforms
                  .filter((t) => t.enabled)
                  .map((t) => (
                    <Box key={t.id} color="#196B24" title={tStr(t.label, lang)} subtitle="enabled" />
                  ))}
                {transforms.filter((t) => t.enabled).length === 0 && (
                  <p className="text-xs text-gray-400 italic">
                    {tStr({ en: "No transforms enabled", ar: "لا تحويلات مفعّلة" }, lang)}
                  </p>
                )}
              </Column>
              <Column title={tStr(COPY.sinks, lang)}>
                {sinks.map((k) => (
                  <Box
                    key={k.id}
                    color={k.blocked ? "#B91C1C" : "#196B24"}
                    title={tStr(k.label, lang)}
                    subtitle={k.blocked ? tStr(COPY.blocked, lang) : tStr(COPY.allowed, lang)}
                  />
                ))}
              </Column>
            </div>
          )}
        </div>
      </section>

      {/* Decisions */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 inline-flex items-center gap-2">
            <ShieldCheck size={14} /> {tStr(COPY.sinks, lang)} ({allowedCount}/{sinks.length}{" "}
            {tStr(COPY.allowed, lang)})
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {sinks.map((k) => (
              <div
                key={k.id}
                className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-3"
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-white mt-0.5"
                  style={{ backgroundColor: k.blocked ? "#B91C1C" : "#196B24" }}
                >
                  {k.blocked ? tStr(COPY.blocked, lang) : tStr(COPY.allowed, lang)}
                </span>
                <div className="flex-1">
                  <p className="font-bold text-[#0E2841]">{tStr(k.label, lang)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
                    {k.region}
                  </p>
                  <p className="text-xs text-gray-700 mt-2 leading-relaxed">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] me-1">
                      {tStr(COPY.reason, lang)}:
                    </span>
                    {tStr(k.reason, lang)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </DemoShell>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 relative">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{title}</p>
      {children}
    </div>
  );
}

function Box({
  title,
  subtitle,
  color,
}: {
  title: string;
  subtitle: string;
  color: string;
}) {
  return (
    <div
      className="rounded-xl border-2 p-3 bg-white relative flex items-start gap-2"
      style={{ borderColor: color }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[#0E2841] text-sm leading-tight truncate">{title}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{subtitle}</p>
      </div>
      <ArrowRight size={12} className="text-gray-300 mt-1 flex-shrink-0 rtl:rotate-180" />
    </div>
  );
}
