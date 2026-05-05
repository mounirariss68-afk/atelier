import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import {
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
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";

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

type ClassFilter = "all" | (typeof marketplaceClasses)[number]["id"];
type IndustryFilter = "all" | string;
type HorizontalFilter = "all" | (typeof marketplaceHorizontals)[number]["id"];

const COPY = {
  eyebrow: { en: "Marketplace", ar: "السوق" },
  title: {
    en: "What good looks like — the asset-led path to outcomes.",
    ar: "كيف يبدو الجيد — المسار القائم على الأصول للوصول إلى النتائج.",
  },
  intro: {
    en: "This is Maven's asset-led path: productized agents you can adopt, configure, and run — instead of commissioning a custom build. MIT NANDA finds 95% of enterprise GenAI pilots deliver no measurable P&L impact; productized assets close the gap by shipping in weeks, not quarters. When the problem is bespoke and the operating model has to change, the project-led path through our services is the right starting point — most engagements blend the two.",
    ar: "هذا هو مسار مافن القائم على الأصول: وكلاء جاهزون للاعتماد والتهيئة والتشغيل — بدلاً من تكليف ببناء مخصص. وجدت دراسة MIT NANDA أن 95% من تجارب الذكاء التوليدي المؤسسية لا تحقق أثراً مالياً قابلاً للقياس؛ الأصول الجاهزة تسد الفجوة بالتسليم خلال أسابيع لا أرباع. عندما تكون المشكلة مخصصة ويتطلب الأمر تغيير نموذج التشغيل، فإن المسار القائم على المشاريع عبر خدماتنا هو نقطة البداية الصحيحة — ومعظم الارتباطات تمزج بين المسارين.",
    tr: "Bu, Maven'in varlık öncülüğündeki yoludur: özel bir geliştirme yaptırmak yerine benimseyebileceğiniz, yapılandırabileceğiniz ve çalıştırabileceğiniz ürünleştirilmiş ajanlar. MIT NANDA, kurumsal GenAI pilotlarının %95'inin ölçülebilir P&L etkisi sağlamadığını ortaya koyuyor; ürünleştirilmiş varlıklar, çeyreklerde değil haftalarda devreye girerek bu boşluğu kapatıyor. Sorun kendine özgü olduğunda ve operasyon modelinin değişmesi gerektiğinde, hizmetlerimiz aracılığıyla proje öncülüğündeki yol doğru başlangıç noktasıdır — çoğu çalışma her ikisini de harmanlar.",
  },
  servicesLink: {
    en: "Project-led services",
    ar: "الخدمات القائمة على المشاريع",
    tr: "Proje öncülüğündeki hizmetler",
  },
  povLink: {
    en: "Read the Two Paths POV",
    ar: "اقرأ منظور المسارين",
    tr: "İki Yol bakış açısını okuyun",
  },
  classLabel: { en: "Class", ar: "الفئة" },
  industryLabel: { en: "Industry", ar: "القطاع" },
  horizontalLabel: { en: "Horizontal", ar: "أفقي" },
  all: { en: "All", ar: "الكل" },
  reset: { en: "Reset filters", ar: "إعادة ضبط المرشّحات" },
  liveBadge: { en: "Live demo", ar: "عرض تفاعلي" },
  comingSoonBadge: { en: "Coming soon", ar: "قريباً" },
  buyer: { en: "Buyer", ar: "المشتري" },
  open: { en: "Open the demo", ar: "افتح العرض" },
  read: { en: "Read the detail page", ar: "اقرأ صفحة التفاصيل" },
  empty: {
    en: "No tools match your filters yet.",
    ar: "لا توجد أدوات تطابق المرشّحات حالياً.",
  },
  classesHeading: { en: "The eight classes", ar: "الفئات الثماني" },
  count: { en: "tools", ar: "أداة" },
};

function readQueryFilter(qs: string, key: string, allowed: string[]): string {
  const v = new URLSearchParams(qs).get(key);
  if (v && allowed.includes(v)) return v;
  return "all";
}

export default function Marketplace() {
  const search = useSearch();
  const { lang, dir } = useLang();
  // ToolCard predates TR support and only knows EN/AR; coerce TR users to EN
  // for the card chrome until ToolCard's copy is localized.
  const cardLang: "en" | "ar" = lang === "ar" ? "ar" : "en";

  const allClasses: ClassFilter[] = ["all", ...marketplaceClasses.map((c) => c.id)];
  const allIndustries: IndustryFilter[] = ["all", ...industriesIndex.map((i) => i.id)];
  const allHorizontals: HorizontalFilter[] = ["all", ...marketplaceHorizontals.map((h) => h.id)];

  const [activeClass, setActiveClass] = useState<ClassFilter>(
    readQueryFilter(search, "class", allClasses) as ClassFilter,
  );
  const [activeIndustry, setActiveIndustry] = useState<IndustryFilter>(
    readQueryFilter(search, "industry", allIndustries),
  );
  const [activeHorizontal, setActiveHorizontal] = useState<HorizontalFilter>(
    readQueryFilter(search, "horizontal", allHorizontals) as HorizontalFilter,
  );

  // Re-sync filters when the user navigates with a new query string
  // (e.g. arriving from an Industries page deep link).
  useEffect(() => {
    setActiveClass(readQueryFilter(search, "class", allClasses) as ClassFilter);
    setActiveIndustry(readQueryFilter(search, "industry", allIndustries));
    setActiveHorizontal(readQueryFilter(search, "horizontal", allHorizontals) as HorizontalFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = useMemo(() => {
    return marketplaceTools.filter((t) => {
      if (activeClass !== "all" && t.class !== activeClass) return false;
      if (activeIndustry !== "all" && !t.industries.includes(activeIndustry)) return false;
      if (activeHorizontal !== "all" && !t.horizontals.includes(activeHorizontal)) return false;
      return true;
    });
  }, [activeClass, activeIndustry, activeHorizontal]);

  const liveTools = filtered.filter((t) => t.status === "live");
  const otherTools = filtered.filter((t) => t.status !== "live");

  const reset = () => {
    setActiveClass("all");
    setActiveIndustry("all");
    setActiveHorizontal("all");
  };

  const industryTitle = (id: string) =>
    industriesIndex.find((i) => i.id === id)?.title ?? id;

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">
            {tStr(COPY.eyebrow, lang)}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mt-3 mb-5 max-w-3xl leading-tight">
            {tStr(COPY.title, lang)}
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 max-w-3xl leading-relaxed">
            {tStr(COPY.intro, lang)}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link href="/services" className="inline-flex items-center gap-1.5 text-[#F5A623] hover:text-white font-semibold underline underline-offset-4">
              {tStr(COPY.servicesLink, lang)} <ArrowRight size={14} />
            </Link>
            <Link href="/insights/two-paths-to-outcomes" className="inline-flex items-center gap-1.5 text-[#F5A623] hover:text-white font-semibold underline underline-offset-4">
              {tStr(COPY.povLink, lang)} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Class strip */}
      <section className="bg-white border-b border-gray-100 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">
            {tStr(COPY.classesHeading, lang)}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {marketplaceClasses.map((c) => {
              const count = marketplaceTools.filter((t) => t.class === c.id).length;
              const active = activeClass === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveClass(active ? "all" : c.id)}
                  className={`text-start p-4 rounded-xl border transition-all ${
                    active
                      ? "border-[#0E2841] bg-[#0E2841] text-white shadow-sm"
                      : "border-gray-200 bg-white hover:border-[#0E2841] hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className={`text-sm font-bold ${active ? "text-white" : "text-[#0E2841]"}`}>
                      {tStr(c.title, lang)}
                    </span>
                    <span className={`text-xs font-semibold ${active ? "text-[#F5A623]" : "text-gray-400"}`}>
                      {count}
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${active ? "text-gray-300" : "text-gray-500"}`}>
                    {tStr(c.description, lang)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Filter bar */}
      <section className="bg-[#F8F9FA] border-b border-gray-100 sticky top-20 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500 me-1">
              {tStr(COPY.industryLabel, lang)}
            </span>
            {allIndustries.map((id) => (
              <button
                key={`ind-${id}`}
                onClick={() => setActiveIndustry(id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  activeIndustry === id
                    ? "bg-[#0E2841] text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841]"
                }`}
              >
                {id === "all" ? tStr(COPY.all, lang) : industryTitle(id)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500 me-1">
              {tStr(COPY.horizontalLabel, lang)}
            </span>
            {allHorizontals.map((id) => {
              const meta = marketplaceHorizontals.find((h) => h.id === id);
              const label =
                id === "all" ? tStr(COPY.all, lang) : meta ? tStr(meta.title, lang) : id;
              return (
                <button
                  key={`h-${id}`}
                  onClick={() => setActiveHorizontal(id as HorizontalFilter)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    activeHorizontal === id
                      ? "bg-[#F5A623] text-white"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-[#F5A623] hover:text-[#F5A623]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
            <button
              onClick={reset}
              className="ms-auto text-xs font-semibold text-gray-500 hover:text-[#0E2841] underline decoration-dotted"
            >
              {tStr(COPY.reset, lang)}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {filtered.length} {tStr(COPY.count, lang)}
          </p>
        </div>
      </section>

      {/* Live tools */}
      <section className="py-14 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-base">{tStr(COPY.empty, lang)}</p>
              <button
                onClick={reset}
                className="mt-4 text-[#156082] font-semibold hover:underline text-sm"
              >
                {tStr(COPY.reset, lang)}
              </button>
            </div>
          ) : (
            <>
              {liveTools.length > 0 && (
                <div className="grid lg:grid-cols-2 gap-6">
                  {liveTools.map((t, i) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      lang={cardLang}
                      idx={i}
                      featured
                      industryTitle={industryTitle}
                    />
                  ))}
                </div>
              )}

              {otherTools.length > 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {otherTools.map((t, i) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      lang={cardLang}
                      idx={i}
                      industryTitle={industryTitle}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function ToolCard({
  tool,
  lang,
  idx,
  featured,
  industryTitle,
}: {
  tool: (typeof marketplaceTools)[number];
  lang: import("@/lib/lang").Lang;
  idx: number;
  featured?: boolean;
  industryTitle: (id: string) => string;
}) {
  const Icon = ICONS[tool.icon] ?? Sparkles;
  const isLive = tool.status === "live";
  const horizontalLabels = tool.horizontals
    .map((h) => marketplaceHorizontals.find((mh) => mh.id === h))
    .filter(Boolean) as (typeof marketplaceHorizontals)[number][];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.05, duration: 0.4 }}
      className={`relative report-card border rounded-2xl overflow-hidden bg-white hover:shadow-xl transition-all flex flex-col ${
        featured ? "border-2" : "border border-gray-100"
      }`}
      style={featured ? { borderColor: tool.accent } : undefined}
    >
      <div
        className="h-1.5 w-full"
        style={{ background: tool.accent }}
        aria-hidden="true"
      />
      <div className={`p-6 sm:p-7 flex flex-col gap-4 flex-1 ${featured ? "" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: tool.accent + "1A" }}
          >
            <Icon size={22} style={{ color: tool.accent }} />
          </div>
          <span
            className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
              isLive ? "text-white" : "text-gray-500 bg-gray-100"
            }`}
            style={isLive ? { backgroundColor: tool.accent } : undefined}
          >
            {isLive
              ? tStr(COPY.liveBadge, lang)
              : tStr(COPY.comingSoonBadge, lang)}
          </span>
        </div>

        <div>
          <h3 className={`font-extrabold text-[#0E2841] mb-2 ${featured ? "text-2xl" : "text-lg"}`}>
            {tStr(tool.title, lang)}
          </h3>
          <p className={`text-gray-600 leading-relaxed ${featured ? "text-base" : "text-sm"}`}>
            {tStr(tool.pitch, lang)}
          </p>
        </div>

        <div className="text-xs text-gray-500 leading-relaxed">
          <span className="font-semibold text-[#0E2841]">{tStr(COPY.buyer, lang)}: </span>
          {tStr(tool.buyer, lang)}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {tool.industries.slice(0, 4).map((ind) => (
            <span
              key={ind}
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-gray-100 text-gray-600"
            >
              {industryTitle(ind)}
            </span>
          ))}
          {tool.industries.length > 4 && (
            <span className="text-[10px] font-semibold text-gray-400 px-2 py-1">
              +{tool.industries.length - 4}
            </span>
          )}
          {horizontalLabels.map((h) => (
            <span
              key={h.id}
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded"
              style={{ backgroundColor: tool.accent + "1A", color: tool.accent }}
            >
              {tStr(h.title, lang)}
            </span>
          ))}
        </div>

        <div className="mt-auto pt-2">
          <Link
            href={`/marketplace/${tool.slug}`}
            className="inline-flex items-center gap-2 text-sm font-bold transition-colors"
            style={{ color: tool.accent }}
          >
            {isLive ? tStr(COPY.open, lang) : tStr(COPY.read, lang)}
            <ArrowRight size={14} className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
