import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Clock, Calendar, User, Tag } from "lucide-react";
import { insights, insightTitle, insightSummary, insightContent } from "@/data/content";
import { useLang } from "@/lib/lang";

const categoryColors: Record<string, string> = {
  "Agentic AI": "#156082",
  "Data & Governance": "#F5A623",
  "Legacy Modernization": "#F5A623",
  "Industry Trends": "#196B24",
};

export default function InsightDetail() {
  const [, params] = useRoute("/insights/:slug");
  const { lang, dir } = useLang();
  const insight = insights.find((i) => i.slug === params?.slug);

  if (!insight) {
    return (
      <div className="pt-20 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#0E2841] mb-4">Article not found</h1>
          <Link href="/insights" className="text-[#156082] font-semibold hover:underline">Back to Insights</Link>
        </div>
      </div>
    );
  }

  const related = insights.filter((i) => i.id !== insight.id && (i.category === insight.category || i.tags.some((t) => insight.tags.includes(t)))).slice(0, 3);
  const catColor = categoryColors[insight.category] || "#156082";

  const localizedTitle = insightTitle(insight, lang);
  const localizedSummary = insightSummary(insight, lang);
  const localizedContent = insightContent(insight, lang);

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-16 relative overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/insights" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-8 transition-colors">
            <ArrowLeft size={14} /> Back to Insights
          </Link>
          <div className="grid lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-8">
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span
                  className="text-xs font-bold px-3 py-1.5 rounded-full text-white"
                  style={{ backgroundColor: catColor }}
                >
                  {insight.type}
                </span>
                <span className="text-gray-300 text-sm">{insight.category}</span>
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
                <span className="flex items-center gap-2"><Calendar size={14} /> {insight.date}</span>
                <span className="flex items-center gap-2"><Clock size={14} /> {insight.readTime}</span>
              </div>
            </div>
            <div className="lg:col-span-4">
              <div className="rounded-xl overflow-hidden h-52 bg-[#156082] relative">
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
                <h3 className="font-bold text-[#0E2841] mb-4 text-sm uppercase tracking-wider">About the author</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{insight.author}</p>
                <p className="text-xs text-gray-400 mt-2">Maven AI Research & Advisory</p>
              </div>

              {/* Key takeaways */}
              <div className="bg-[#0E2841] rounded-xl p-6 text-white">
                <h3 className="font-bold mb-4 text-sm uppercase tracking-wider text-[#F5A623]">Key takeaways</h3>
                <ul className="space-y-3">
                  {[
                    "Senior-led delivery closes the pilot-to-production gap",
                    "Data governance is the prerequisite for trustworthy AI",
                    "90-day MVP delivery is achievable with the right model",
                    "Platform-agnostic advice produces better outcomes",
                  ].slice(0, 3).map((point, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-300">
                      <span className="text-[#F5A623] font-bold mt-0.5">→</span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA */}
              <div className="border border-gray-200 rounded-xl p-6">
                <h3 className="font-bold text-[#0E2841] mb-2 text-sm">Talk to our team</h3>
                <p className="text-xs text-gray-500 mb-4 leading-relaxed">Want to discuss how these insights apply to your organization?</p>
                <Link href="/contact" className="inline-flex items-center gap-1.5 bg-[#F5A623] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-[#d4622a] transition-colors">
                  Schedule a call <ArrowRight size={13} />
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
            <h2 className="text-2xl font-extrabold text-[#0E2841] mb-8">Related insights</h2>
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
                    <div className="h-36 bg-[#0E2841] relative overflow-hidden">
                      <img src={rel.coverImage} alt={insightTitle(rel, lang)} className="w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-500" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                    <div className="p-5">
                      <span className="text-xs font-semibold" style={{ color: categoryColors[rel.category] || "#156082" }}>{rel.category}</span>
                      <h3 className="font-bold text-[#0E2841] text-sm mt-1.5 mb-2 leading-snug group-hover:text-[#156082] transition-colors line-clamp-2">{insightTitle(rel, lang)}</h3>
                      <span className="text-xs text-gray-400">{rel.readTime}</span>
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
