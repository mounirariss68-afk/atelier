import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Clock, Calendar, User, Tag } from "lucide-react";
import {
  insights, insightTitle, insightSummary, insightContent,
  insightCategoryLabel, insightTypeLabel, insightDateLabel, insightReadTimeLabel,
  INSIGHT_CATEGORY_COLORS as categoryColors,
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";

const COPY = {
  notFound: { en: "Article not found", ar: "المقال غير موجود", tr: "Makale bulunamadı" },
  backInsights: { en: "Back to Insights", ar: "العودة إلى الرؤى", tr: "İçgörülere dön" },
  aboutAuthor: { en: "About the author", ar: "عن المؤلف", tr: "Yazar hakkında" },
  authorOrg: { en: "Cognirise Research & Advisory", ar: "أبحاث واستشارات Cognirise", tr: "Cognirise Araştırma ve Danışmanlık" },
  keyTakeaways: { en: "Key takeaways", ar: "النقاط الرئيسية", tr: "Temel çıkarımlar" },
  takeaway1: { en: "Senior-led delivery closes the pilot-to-production gap", ar: "القيادة العليا للتنفيذ تسد الفجوة بين النموذج الأولي والإنتاج", tr: "Kıdemli liderliğindeki teslimat, pilottan üretime geçiş açığını kapatır" },
  takeaway2: { en: "Data governance is the prerequisite for trustworthy AI", ar: "حوكمة البيانات شرط مسبق للذكاء الاصطناعي الموثوق", tr: "Veri yönetişimi, güvenilir AI'nın ön koşuludur" },
  takeaway3: { en: "90-day MVP delivery is achievable with the right model", ar: "تسليم MVP خلال 90 يوماً ممكن بالنموذج الصحيح", tr: "Doğru modelle 90 günde MVP teslimi mümkündür" },
  talkTeam: { en: "Talk to our team", ar: "تحدث مع فريقنا", tr: "Ekibimizle konuşun" },
  talkPara: { en: "Want to discuss how these insights apply to your organization?", ar: "هل ترغب في مناقشة كيف تنطبق هذه الرؤى على مؤسستك؟", tr: "Bu içgörülerin kuruluşunuza nasıl uygulanacağını tartışmak ister misiniz?" },
  scheduleCall: { en: "Schedule a call", ar: "احجز مكالمة", tr: "Bir görüşme planlayın" },
  related: { en: "Related insights", ar: "رؤى ذات صلة", tr: "İlgili içgörüler" },
};

export default function InsightDetail() {
  const [, params] = useRoute("/insights/:slug");
  const { lang, dir } = useLang();
  const insight = insights.find((i) => i.slug === params?.slug);

  if (!insight) {
    return (
      <div className="pt-20 min-h-screen flex items-center justify-center" dir={dir}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#0A1230] mb-4">{tStr(COPY.notFound, lang)}</h1>
          <Link href="/insights" className="text-[#5B7CFF] font-semibold hover:underline">{tStr(COPY.backInsights, lang)}</Link>
        </div>
      </div>
    );
  }

  const related = insights.filter((i) => i.id !== insight.id && (i.category === insight.category || i.tags.some((t) => insight.tags.includes(t)))).slice(0, 3);
  const catColor = categoryColors[insight.category] || "#5B7CFF";

  const localizedTitle = insightTitle(insight, lang);
  const localizedSummary = insightSummary(insight, lang);
  const localizedContent = insightContent(insight, lang);

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0A1230] py-16 relative overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/insights" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-8 transition-colors">
            <ArrowLeft size={14} className="rtl:-scale-x-100" /> {tStr(COPY.backInsights, lang)}
          </Link>
          <div className="grid lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-8">
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span
                  className="text-xs font-bold px-3 py-1.5 rounded-full text-white"
                  style={{ backgroundColor: catColor }}
                >
                  {insightTypeLabel(insight.type, lang)}
                </span>
                <span className="text-gray-300 text-sm">{insightCategoryLabel(insight.category, lang)}</span>
              </div>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl sm:text-4xl font-extrabold text-white leading-tight mb-5"
              >
                {localizedTitle}
              </motion.h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-7">{localizedSummary}</p>
              <div className="flex flex-wrap items-center gap-6 text-sm text-gray-400">
                <span className="flex items-center gap-2"><User size={14} /> {insight.author}</span>
                <span className="flex items-center gap-2"><Calendar size={14} /> {insightDateLabel(insight.date, lang)}</span>
                <span className="flex items-center gap-2"><Clock size={14} /> {insightReadTimeLabel(insight, lang)}</span>
              </div>
            </div>
            <div className="lg:col-span-4">
              <div className="rounded-xl overflow-hidden h-52 bg-[#5B7CFF] relative">
                <img
                  src={insight.coverImage}
                  alt={localizedTitle}
                  className="w-full h-full object-cover opacity-80"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12">
            {/* Article */}
            <div className="lg:col-span-8">
              <div
                className="article-content max-w-none"
                dangerouslySetInnerHTML={{ __html: localizedContent }}
              />

              {/* Tags */}
              <div className="mt-10 pt-8 border-t border-gray-100">
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag size={14} className="text-gray-400" />
                  {insight.tags.map((tag) => (
                    <span key={tag} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full font-medium">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="lg:col-span-4 space-y-6">
              {/* About the author */}
              <div className="bg-[#F8F9FA] rounded-xl p-6">
                <h3 className="font-bold text-[#0A1230] mb-4 text-sm uppercase tracking-wider">{tStr(COPY.aboutAuthor, lang)}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{insight.author}</p>
                <p className="text-xs text-gray-400 mt-2">{tStr(COPY.authorOrg, lang)}</p>
              </div>

              {/* Key takeaways */}
              <div className="bg-[#0A1230] rounded-xl p-6 text-white">
                <h3 className="font-bold mb-4 text-sm uppercase tracking-wider text-[#C45BB8]">{tStr(COPY.keyTakeaways, lang)}</h3>
                <ul className="space-y-3">
                  {[COPY.takeaway1, COPY.takeaway2, COPY.takeaway3].map((point, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-300">
                      <span className="text-[#C45BB8] font-bold mt-0.5">→</span>
                      {tStr(point, lang)}
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA */}
              <div className="border border-gray-200 rounded-xl p-6">
                <h3 className="font-bold text-[#0A1230] mb-2 text-sm">{tStr(COPY.talkTeam, lang)}</h3>
                <p className="text-xs text-gray-500 mb-4 leading-relaxed">{tStr(COPY.talkPara, lang)}</p>
                <Link href="/contact" className="inline-flex items-center gap-1.5 bg-[#C45BB8] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-[#A04A99] transition-colors">
                  {tStr(COPY.scheduleCall, lang)} <ArrowRight size={13} className="rtl:-scale-x-100" />
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Related */}
      {related.length > 0 && (
        <section className="py-16 bg-[#F8F9FA]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-extrabold text-[#0A1230] mb-8">{tStr(COPY.related, lang)}</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {related.map((rel, i) => (
                <motion.div
                  key={rel.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="report-card group bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm cursor-pointer"
                >
                  <Link href={`/insights/${rel.slug}`}>
                    <div className="h-36 bg-[#0A1230] relative overflow-hidden">
                      <img src={rel.coverImage} alt={insightTitle(rel, lang)} className="w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-500" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                    <div className="p-5">
                      <span className="text-xs font-semibold" style={{ color: categoryColors[rel.category] || "#5B7CFF" }}>{insightCategoryLabel(rel.category, lang)}</span>
                      <h3 className="font-bold text-[#0A1230] text-sm mt-1.5 mb-2 leading-snug group-hover:text-[#5B7CFF] transition-colors line-clamp-2">{insightTitle(rel, lang)}</h3>
                      <span className="text-xs text-gray-400">{insightReadTimeLabel(rel, lang)}</span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
