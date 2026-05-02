import { Link, useParams } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  TrendingUp,
  ClipboardList,
  Users,
  ShoppingCart,
  Activity,
  ShieldCheck,
  BarChart3,
  Hotel,
  Battery,
  LineChart,
  Headphones,
  Database,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import {
  marketplaceTools,
  marketplaceClasses,
  marketplaceHorizontals,
  industriesIndex,
  servicesIndex,
  assessmentsIndex,
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";
import NotFound from "./not-found";
import ValueRealizationDemo from "@/components/marketplace/ValueRealizationDemo";

const ICONS: Record<string, LucideIcon> = {
  TrendingUp,
  ClipboardList,
  Users,
  ShoppingCart,
  Activity,
  ShieldCheck,
  BarChart3,
  Hotel,
  Battery,
  LineChart,
  Headphones,
  Database,
  BookOpen,
};

const COPY = {
  back: { en: "Back to Marketplace", ar: "العودة إلى السوق" },
  liveBadge: { en: "Live demo", ar: "عرض تفاعلي" },
  comingSoonBadge: { en: "Coming soon", ar: "قريباً" },
  buyer: { en: "Named buyer", ar: "المشتري المستهدف" },
  classLabel: { en: "Class", ar: "الفئة" },
  industriesLabel: { en: "Industries", ar: "القطاعات" },
  horizontalsLabel: { en: "Horizontals", ar: "الأفقي" },
  pitch: { en: "The pitch", ar: "الفكرة" },
  what: { en: "What it owns and how it works", ar: "ما يملكه وكيف يعمل" },
  screensTitle: { en: "Demo screens", ar: "شاشات العرض" },
  dataTitle: { en: "Data model", ar: "نموذج البيانات" },
  inputs: { en: "Inputs", ar: "المدخلات" },
  internal: { en: "Internal IP", ar: "الملكية الفكرية الداخلية" },
  outputs: { en: "Outputs", ar: "المخرجات" },
  ctaPartner: {
    en: "Talk to a partner about this tool",
    ar: "تحدّث مع شريك حول هذه الأداة",
  },
  ctaService: {
    en: "Related Maven AI service",
    ar: "خدمة Maven AI المرتبطة",
  },
  ctaAssessment: {
    en: "Run the related diagnostic",
    ar: "شغّل التشخيص المرتبط",
  },
  comingSoonNote: {
    en: "This tool's interactive demo is in development. The detail below is the same brief our delivery teams use when scoping it inside an engagement — the screens are described in plain English so you can pressure-test the design before we build it for you.",
    ar: "العرض التفاعلي لهذه الأداة قيد التطوير. التفاصيل أدناه هي الموجز نفسه الذي تستخدمه فرق التسليم عند تحديد نطاقها داخل الارتباط — تُوصف الشاشات بلغة واضحة لتختبر التصميم قبل أن نبنيه لك.",
  },
};

export default function MarketplaceDetail() {
  const params = useParams();
  const slug = (params as { slug?: string }).slug;
  const tool = marketplaceTools.find((t) => t.slug === slug);
  const { lang, dir } = useLang();

  if (!tool) return <NotFound />;

  if (tool.slug === "value-realization") {
    return <ValueRealizationDemo />;
  }

  const Icon = ICONS[tool.icon] ?? Sparkles;
  const cls = marketplaceClasses.find((c) => c.id === tool.class);
  const horizontalMetas = tool.horizontals
    .map((h) => marketplaceHorizontals.find((mh) => mh.id === h))
    .filter(Boolean) as (typeof marketplaceHorizontals)[number][];
  const industryEntries = tool.industries
    .map((id) => industriesIndex.find((i) => i.id === id))
    .filter(Boolean) as (typeof industriesIndex)[number][];
  const relatedService = tool.relatedService
    ? servicesIndex.find((s) => s.slug === tool.relatedService)
    : undefined;
  const relatedAssessment = tool.relatedAssessment
    ? assessmentsIndex.find((a) => a.slug === tool.relatedAssessment)
    : undefined;
  const isLive = tool.status === "live";

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white mb-6"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>

          <div className="flex items-start gap-5 mb-6">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: tool.accent + "33" }}
            >
              <Icon size={26} style={{ color: tool.accent }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {cls && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: tool.accent }}
                  >
                    {tStr(cls.title, lang)}
                  </span>
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    isLive ? "bg-white text-[#0E2841]" : "bg-white/10 text-gray-300"
                  }`}
                >
                  {isLive ? tStr(COPY.liveBadge, lang) : tStr(COPY.comingSoonBadge, lang)}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                {tStr(tool.title, lang)}
              </h1>
            </div>
          </div>

          <p className="text-lg text-gray-200 max-w-3xl leading-relaxed">{tStr(tool.pitch, lang)}</p>

          <div className="grid sm:grid-cols-3 gap-4 mt-8 pt-8 border-t border-white/10">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-1">
                {tStr(COPY.buyer, lang)}
              </p>
              <p className="text-sm text-white">{tStr(tool.buyer, lang)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-1">
                {tStr(COPY.industriesLabel, lang)}
              </p>
              <p className="text-sm text-white">
                {industryEntries.map((i) => i.title).join(" · ")}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-1">
                {tStr(COPY.horizontalsLabel, lang)}
              </p>
              <p className="text-sm text-white">
                {horizontalMetas.length === 0
                  ? "—"
                  : horizontalMetas.map((h) => tStr(h.title, lang)).join(" · ")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Coming soon banner */}
      {!isLive && (
        <section className="bg-[#FFFAF0] border-b border-amber-100 py-5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-sm text-amber-900 leading-relaxed max-w-4xl">
              <span className="font-bold">
                {tStr(COPY.comingSoonBadge, lang)} —{" "}
              </span>
              {tStr(COPY.comingSoonNote, lang)}
            </p>
          </div>
        </section>
      )}

      {/* Long description */}
      <section className="py-14 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.what, lang)}
          </p>
          <div className="space-y-5">
            {tool.longDescription.map((p, i) => (
              <p key={i} className="text-base text-gray-700 leading-relaxed">
                {tStr(p, lang)}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Demo screens */}
      <section className="py-14 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.screensTitle, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tool.screens.map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
              >
                <div
                  className="h-2 w-full"
                  style={{ background: tool.accent }}
                  aria-hidden="true"
                />
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: tool.accent }}
                    >
                      {i + 1}
                    </span>
                    <h3 className="font-bold text-[#0E2841]">{tStr(s.title, lang)}</h3>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {tStr(s.caption, lang)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Data model */}
      <section className="py-14 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.dataTitle, lang)}
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {(
              [
                { label: COPY.inputs, items: tool.dataModel.inputs, color: "#156082" },
                { label: COPY.internal, items: tool.dataModel.internal, color: tool.accent },
                { label: COPY.outputs, items: tool.dataModel.outputs, color: "#196B24" },
              ] as const
            ).map((col) => (
              <div key={col.label.en} className="rounded-2xl border border-gray-100 p-6">
                <p
                  className="text-[11px] font-bold uppercase tracking-widest mb-4"
                  style={{ color: col.color }}
                >
                  {tStr(col.label, lang)}
                </p>
                <ul className="space-y-3">
                  {col.items.map((item, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span
                        className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                        style={{ background: col.color }}
                      />
                      <span className="text-sm text-gray-700 leading-relaxed">
                        {tStr(item, lang)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTAs */}
      <section className="py-16 bg-gradient-to-br from-[#0E2841] to-[#156082]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-2 gap-5">
          <Link
            href={`/contact?topic=${tool.slug}`}
            className="group p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
              {tStr({ en: "Engage", ar: "ابدأ" }, lang)}
            </span>
            <span className="text-lg font-bold text-white">{tStr(COPY.ctaPartner, lang)}</span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5A623] mt-2">
              {tStr({ en: "Open contact form", ar: "افتح نموذج التواصل" }, lang)}
              <ArrowRight size={14} className="rtl:rotate-180" />
            </span>
          </Link>

          {relatedService ? (
            <Link
              href={`/services/${relatedService.slug}`}
              className="group p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                {tStr(COPY.ctaService, lang)}
              </span>
              <span className="text-lg font-bold text-white">{relatedService.title}</span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5A623] mt-2">
                {tStr({ en: "Read service brief", ar: "اقرأ موجز الخدمة" }, lang)}
                <ArrowRight size={14} className="rtl:rotate-180" />
              </span>
            </Link>
          ) : (
            <Link
              href="/services"
              className="group p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                {tStr({ en: "Services", ar: "الخدمات" }, lang)}
              </span>
              <span className="text-lg font-bold text-white">
                {tStr({ en: "Explore Maven AI services", ar: "استعرض خدمات Maven AI" }, lang)}
              </span>
            </Link>
          )}

          {relatedAssessment && (
            <Link
              href={`/assessments/${relatedAssessment.slug}`}
              className="group p-6 bg-[#F5A623] hover:bg-[#d4622a] rounded-2xl transition-colors flex flex-col gap-2 sm:col-span-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">
                {tStr(COPY.ctaAssessment, lang)}
              </span>
              <span className="text-lg font-bold text-white">
                {relatedAssessment.code} — {relatedAssessment.name}
              </span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-white mt-2">
                {tStr({ en: "Run the diagnostic", ar: "شغّل التشخيص" }, lang)}
                <ArrowRight size={14} className="rtl:rotate-180" />
              </span>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
