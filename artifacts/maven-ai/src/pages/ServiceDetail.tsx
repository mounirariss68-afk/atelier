import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Code2, Database, Rocket, CheckCircle, Clock } from "lucide-react";
import {
  services, insights,
  serviceTitle, serviceTagline, serviceBuyer, serviceDescription,
  serviceUseCase, serviceStatLabel, serviceEngagementField,
  insightTitle, insightDateLabel, insightReadTimeLabel,
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";

const serviceIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Brain, Code2, Database, Rocket,
};

const COPY = {
  back: { en: "← Back to Services", ar: "→ العودة إلى الخدمات", tr: "← Hizmetlere dön" },
  notFound: { en: "Service not found", ar: "الخدمة غير موجودة", tr: "Hizmet bulunamadı" },
  backLink: { en: "Back to Services", ar: "العودة إلى الخدمات", tr: "Hizmetlere dön" },
  buyer: { en: "Buyer", ar: "المشتري", tr: "Alıcı" },
  overview: { en: "Overview", ar: "نظرة عامة", tr: "Genel bakış" },
  useCases: { en: "Representative use cases", ar: "حالات استخدام تمثيلية", tr: "Temsili kullanım senaryoları" },
  engagementModel: { en: "Engagement model", ar: "نموذج الارتباط", tr: "Çalışma modeli" },
  relatedReport: { en: "Related Report", ar: "تقرير ذو صلة", tr: "İlgili rapor" },
  readReport: { en: "Read report", ar: "اقرأ التقرير", tr: "Raporu oku" },
  diagEyebrow: { en: "Free diagnostic · ~12 min", ar: "تشخيص مجاني · ~12 دقيقة", tr: "Ücretsiz teşhis · ~12 dk" },
  diagTitlePrefix: { en: "Benchmark your", ar: "قس نضج", tr: "Karşılaştırın:" },
  diagTitleSuffix: { en: "maturity", ar: "لديكم", tr: "olgunluğunuz" },
  diagSub: { en: "Get a sovereign-aware score, anti-pattern flags, GCC peer benchmark and a branded executive memo.", ar: "احصل على درجة سيادية، تنبيهات أنماط مضادة، مقارنة بأقران الخليج، ومذكرة تنفيذية بعلامتك.", tr: "Egemenlik bilinçli bir skor, anti-pattern uyarıları, Körfez emsal karşılaştırması ve markalı bir yönetici notu alın." },
  diagBtn: { en: "Take the diagnostic", ar: "ابدأ التشخيص", tr: "Teşhisi alın" },
  ctaTitlePrefix: { en: "Ready to explore", ar: "هل أنتم مستعدون لاستكشاف", tr: "Şunu keşfetmeye hazır mısınız:" },
  ctaTitleSuffix: { en: "?", ar: "؟", tr: "?" },
  ctaPara: { en: "Three days to scope. Three weeks to prototype. Let's start the conversation.", ar: "ثلاثة أيام للنطاق. ثلاثة أسابيع للنموذج الأولي. لنبدأ المحادثة.", tr: "Üç günde kapsam. Üç haftada prototip. Görüşmeyi başlatalım." },
  ctaBtn: { en: "Schedule a call", ar: "احجز مكالمة", tr: "Bir görüşme planlayın" },
};

export default function ServiceDetail() {
  const [, params] = useRoute("/services/:slug");
  const service = services.find((s) => s.slug === params?.slug);
  const { lang, dir } = useLang();

  if (!service) {
    return (
      <div className="pt-20 min-h-screen flex items-center justify-center" dir={dir}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#0E2841] mb-4">{tStr(COPY.notFound, lang)}</h1>
          <Link href="/services" className="text-[#156082] font-semibold hover:underline">{tStr(COPY.backLink, lang)}</Link>
        </div>
      </div>
    );
  }

  const Icon = serviceIcons[service.icon] || Brain;
  const relatedInsight = insights.find((i) => i.id === service.relatedReport);
  const sTitle = serviceTitle(service, lang);

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #F5A623 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/services" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-8 transition-colors">
            {tStr(COPY.back, lang)}
          </Link>
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: service.color + "30" }}>
              <Icon size={32} style={{ color: service.color }} />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4 inline-block" style={{ backgroundColor: service.color + "25", color: service.color }}>
                {tStr(COPY.buyer, lang)}: {serviceBuyer(service, lang)}
              </span>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl sm:text-5xl font-extrabold text-white mt-3 mb-4 max-w-3xl leading-tight"
              >
                {sTitle}
              </motion.h1>
              <p className="text-xl text-gray-300 max-w-2xl">{serviceTagline(service, lang)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {service.stats.map((stat, i) => (
              <div key={i} className="text-center p-4">
                <div className="text-3xl font-extrabold mb-1" style={{ color: service.color }}>{stat.value}</div>
                <div className="text-sm text-gray-500">{serviceStatLabel(service, i, lang)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Overview */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-7">
              <div className="section-divider" />
              <h2 className="text-3xl font-extrabold text-[#0E2841] mb-6">{tStr(COPY.overview, lang)}</h2>
              <p className="text-gray-600 text-lg leading-relaxed mb-10">{serviceDescription(service, lang)}</p>

              <h3 className="text-xl font-bold text-[#0E2841] mb-5">{tStr(COPY.useCases, lang)}</h3>
              <div className="space-y-4">
                {service.useCases.map((_uc, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08, duration: 0.4 }}
                    className="flex gap-3 p-4 border border-gray-100 rounded-xl"
                  >
                    <CheckCircle size={18} style={{ color: service.color }} className="mt-0.5 flex-shrink-0" />
                    <p className="text-gray-700 text-sm leading-relaxed">{serviceUseCase(service, i, lang)}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-6">
              {/* Engagement model */}
              <div className="bg-[#F8F9FA] rounded-2xl p-7">
                <h3 className="text-lg font-bold text-[#0E2841] mb-5 flex items-center gap-2">
                  <Clock size={18} style={{ color: service.color }} /> {tStr(COPY.engagementModel, lang)}
                </h3>
                <div className="space-y-4">
                  {service.engagementModel.map((_phase, i) => (
                    <div key={i} className="flex gap-4">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: service.color }}
                      >
                        {i + 1}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-[#0E2841] text-sm">{serviceEngagementField(service, "phase", i, lang)}</span>
                          <span className="text-xs text-gray-400 font-medium">{serviceEngagementField(service, "duration", i, lang)}</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{serviceEngagementField(service, "description", i, lang)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Related insight */}
              {relatedInsight && (
                <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="h-36 bg-[#0E2841] relative overflow-hidden">
                    <img
                      src={relatedInsight.coverImage}
                      alt={insightTitle(relatedInsight, lang)}
                      className="w-full h-full object-cover opacity-60"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0E2841]/80 to-transparent" />
                    <div className="absolute bottom-3 left-4">
                      <span className="text-xs font-bold text-white bg-[#F5A623] px-2 py-0.5 rounded">{tStr(COPY.relatedReport, lang)}</span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h4 className="font-bold text-[#0E2841] mb-2 text-sm leading-snug">{insightTitle(relatedInsight, lang)}</h4>
                    <p className="text-xs text-gray-500 mb-3">{insightReadTimeLabel(relatedInsight, lang)} · {insightDateLabel(relatedInsight.date, lang)}</p>
                    <Link href={`/insights/${relatedInsight.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#156082] hover:text-[#F5A623] transition-colors">
                      {tStr(COPY.readReport, lang)} <ArrowRight size={13} className="rtl:-scale-x-100" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Diagnostic CTA */}
      <section className="py-12 bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4">
          <div className="bg-white border-2 border-[#0F9ED5]/30 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#0F9ED5] mb-1">{tStr(COPY.diagEyebrow, lang)}</p>
              <h3 className="text-xl font-extrabold text-[#0E2841]">{tStr(COPY.diagTitlePrefix, lang)} {sTitle.toLowerCase()} {tStr(COPY.diagTitleSuffix, lang)}</h3>
              <p className="text-sm text-gray-600 mt-1">{tStr(COPY.diagSub, lang)}</p>
            </div>
            <Link href="/assessments" className="flex-shrink-0 bg-[#0F9ED5] hover:bg-[#0E8BB8] text-white font-bold px-6 py-3 rounded-xl whitespace-nowrap inline-flex items-center gap-2">
              {tStr(COPY.diagBtn, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20" style={{ backgroundColor: service.color }}>
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">{tStr(COPY.ctaTitlePrefix, lang)} {sTitle}{tStr(COPY.ctaTitleSuffix, lang)}</h2>
          <p className="text-white/80 mb-8 text-lg">{tStr(COPY.ctaPara, lang)}</p>
          <Link href="/contact" className="inline-flex items-center gap-2 bg-white text-[#0E2841] font-bold px-8 py-4 rounded-xl hover:bg-gray-100 transition-colors">
            {tStr(COPY.ctaBtn, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
          </Link>
        </div>
      </section>
    </div>
  );
}
