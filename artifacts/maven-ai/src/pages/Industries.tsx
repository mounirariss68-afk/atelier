import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Building2, Wifi, TrendingUp, Zap, ShoppingBag, Plane, Car, ExternalLink } from "lucide-react";
import {
  industries,
  industryTitle,
  industrySubtitle,
  industryHeroStatLabel,
  industryDescription,
  industryApproach,
  industryChallenge,
  industryStatLabel,
  industryCaseField,
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";

const industryIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Building2, Wifi, TrendingUp, Zap, ShoppingBag, Plane, Car,
};

const COPY = {
  eyebrow: { en: "Industries", ar: "الصناعات", tr: "Sektörler" },
  heroTitle: { en: "Deep domain expertise in the sectors that matter most.", ar: "خبرة قطاعية عميقة في القطاعات الأكثر أهمية.", tr: "En önemli sektörlerde derin alan uzmanlığı." },
  heroPara: { en: "Maven AI works where AI transformation is most consequential and most complex — across the GCC's flagship sectors, from sovereign public services to global hospitality.", ar: "تعمل Maven AI حيث يكون تحول الذكاء الاصطناعي الأكثر تأثيراً والأكثر تعقيداً — عبر القطاعات الرائدة في الخليج، من الخدمات العامة السيادية إلى الضيافة العالمية.", tr: "Maven AI, AI dönüşümünün en sonuçlu ve en karmaşık olduğu yerlerde — Körfez'in amiral sektörlerinde, egemen kamu hizmetlerinden küresel konaklamaya kadar — çalışıyor." },
  noteEyebrow: { en: "A note on this page —", ar: "ملاحظة حول هذه الصفحة —", tr: "Bu sayfa hakkında bir not —" },
  noteBody: { en: "the headline figures and key metrics below are drawn from named third-party sources (PwC, McKinsey, BCG, Strategy&, IMARC, Mordor Intelligence, EY, Saudi Aramco, the Saudi Tourism Authority and the Public Investment Fund), and link to those sources. The case studies are illustrative scenarios showing how agentic AI can deliver value in each industry — not delivered Maven AI engagements; any numbers inside them are round figures or public benchmark ranges, not specific outcomes Maven AI has produced.", ar: "الأرقام الرئيسية والمقاييس أدناه مستمدة من مصادر طرف ثالث مذكورة بالاسم (PwC, McKinsey, BCG, Strategy&, IMARC, Mordor Intelligence, EY, أرامكو، هيئة السياحة السعودية وصندوق الاستثمارات العامة)، ومرتبطة بهذه المصادر. حالات الاستخدام عبارة عن سيناريوهات توضيحية تبيّن كيف يمكن للذكاء الاصطناعي الوكيلي تقديم القيمة في كل قطاع — وليست مشاريع نفذتها Maven AI؛ أي أرقام بداخلها هي أرقام تقديرية أو نطاقات مرجعية عامة، وليست نتائج محددة حققتها Maven AI.", tr: "Aşağıdaki başlık rakamları ve temel metrikler, adı belirtilen üçüncü taraf kaynaklardan (PwC, McKinsey, BCG, Strategy&, IMARC, Mordor Intelligence, EY, Saudi Aramco, Suudi Turizm Otoritesi ve Kamu Yatırım Fonu) alınmıştır ve bu kaynaklara bağlanmaktadır. Vaka çalışmaları, agentic AI'nın her sektörde nasıl değer üretebileceğini gösteren örnek senaryolardır — Maven AI'nın gerçekleştirdiği projeler değildir; içlerindeki sayılar yuvarlak rakamlar veya kamuya açık karşılaştırma aralıklarıdır, Maven AI'nın ürettiği belirli sonuçlar değildir." },
  challengesTitle: { en: "Industry challenges we address", ar: "تحديات القطاع التي نعالجها", tr: "Ele aldığımız sektör zorlukları" },
  approachTitle: { en: "Our approach", ar: "منهجنا", tr: "Yaklaşımımız" },
  metricsTitle: { en: "Key metrics", ar: "المقاييس الرئيسية", tr: "Temel metrikler" },
  scenarioLabel: { en: "Illustrative scenario", ar: "سيناريو توضيحي", tr: "Örnek senaryo" },
  challenge: { en: "Challenge", ar: "التحدي", tr: "Zorluk" },
  approach: { en: "Approach", ar: "المنهج", tr: "Yaklaşım" },
  goodLooks: { en: "What good looks like", ar: "كيف يبدو التميّز", tr: "İyi neye benzer" },
  talkTeamPrefix: { en: "Talk to our", ar: "تحدّث مع فريق", tr: "Ekibimizle konuşun:" },
  talkTeamSuffix: { en: "team", ar: "", tr: "" },
  relatedTools: { en: "Related tools in the Marketplace", ar: "أدوات ذات صلة في السوق", tr: "Marketplace'teki ilgili araçlar" },
  ctaTitle: { en: "Don't see your sector?", ar: "لا تجدون قطاعكم؟", tr: "Sektörünüzü göremiyor musunuz?" },
  ctaPara: { en: "Maven AI works with organizations across the GCC economy. Our agentic AI and data capabilities apply across industries — from healthcare to logistics to energy.", ar: "تعمل Maven AI مع المؤسسات عبر اقتصاد الخليج. قدراتنا في الذكاء الاصطناعي الوكيلي والبيانات تنطبق على كل القطاعات — من الرعاية الصحية إلى اللوجستيات إلى الطاقة.", tr: "Maven AI, Körfez ekonomisindeki kuruluşlarla çalışır. Agentic AI ve veri yeteneklerimiz; sağlıktan lojistiğe, enerjiye kadar tüm sektörlerde geçerlidir." },
  ctaButton: { en: "Discuss your industry", ar: "ناقش قطاعك", tr: "Sektörünüzü tartışalım" },
  source: { en: "Source", ar: "المصدر", tr: "Kaynak" },
};

type Source = { name: string; year: number; url: string };

function SourceCaption({ source, prefix }: { source: Source; prefix: string }) {
  return (
    <p className="text-[11px] text-gray-500 leading-snug mt-1.5">
      {prefix}:{" "}
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-gray-300 hover:decoration-[#0E2841] hover:text-[#0E2841] transition-colors"
      >
        {source.name} ({source.year})
        <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
      </a>
    </p>
  );
}

export default function Industries() {
  const { lang, dir } = useLang();
  const sourceLabel = tStr(COPY.source, lang);
  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">{tStr(COPY.eyebrow, lang)}</span>
          <h1 className="text-5xl font-extrabold text-white mt-3 mb-5 max-w-3xl leading-tight">
            {tStr(COPY.heroTitle, lang)}
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl">
            {tStr(COPY.heroPara, lang)}
          </p>
          <p className="text-xs text-gray-400 max-w-2xl mt-6 leading-relaxed">
            <span className="text-[#F5A623] font-semibold uppercase tracking-wider">{tStr(COPY.noteEyebrow, lang)} </span>
            {tStr(COPY.noteBody, lang)}
          </p>
        </div>
      </section>

      {/* Industry nav */}
      <div className="bg-white border-b border-gray-100 sticky top-20 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6 py-4 overflow-x-auto">
            {industries.map((ind) => (
              <a key={ind.id} href={`#${ind.id}`} className="text-sm font-semibold text-gray-500 hover:text-[#0E2841] transition-colors whitespace-nowrap flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ind.color }} />
                {industryTitle(ind, lang)}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Industries */}
      {industries.map((industry, idx) => {
        const Icon = industryIcons[industry.icon] || Building2;
        const indTitle = industryTitle(industry, lang);
        return (
          <section key={industry.id} id={industry.id} className={`py-24 scroll-mt-32 ${idx % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {/* Header */}
              <div className="flex items-start gap-5 mb-12">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: industry.color + "18" }}>
                  <Icon size={28} style={{ color: industry.color }} />
                </div>
                <div>
                  <motion.h2
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-3xl font-extrabold text-[#0E2841] mb-1"
                  >
                    {indTitle}
                  </motion.h2>
                  <p className="text-lg font-semibold" style={{ color: industry.color }}>{industrySubtitle(industry, lang)}</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-12 gap-10">
                {/* Main content */}
                <div className="lg:col-span-7 space-y-10">
                  {/* Hero stat */}
                  <div className="p-7 rounded-2xl" style={{ backgroundColor: industry.color + "10" }}>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-5xl font-black" style={{ color: industry.color }}>{industry.heroStat}</span>
                      <span className="text-gray-600 font-medium">{industryHeroStatLabel(industry, lang)}</span>
                    </div>
                    <SourceCaption source={industry.heroStatSource} prefix={sourceLabel} />
                  </div>

                  <p className="text-gray-700 leading-relaxed text-lg">{industryDescription(industry, lang)}</p>

                  {/* Challenges */}
                  <div>
                    <h3 className="text-lg font-bold text-[#0E2841] mb-5">{tStr(COPY.challengesTitle, lang)}</h3>
                    <div className="space-y-3">
                      {industry.challenges.map((challenge, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.06 }}
                          className="flex gap-3 items-start"
                        >
                          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: industry.color + "20" }}>
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: industry.color }} />
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed">{industryChallenge(industry, i, lang)}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Our approach */}
                  <div className="p-7 bg-[#0E2841] rounded-2xl text-white">
                    <h3 className="font-bold text-[#F5A623] text-sm uppercase tracking-wider mb-3">{tStr(COPY.approachTitle, lang)}</h3>
                    <p className="text-gray-300 leading-relaxed">{industryApproach(industry, lang)}</p>
                  </div>
                </div>

                {/* Sidebar: Stats + Case vignette */}
                <div className="lg:col-span-5 space-y-5">
                  {/* Stats */}
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
                    <h3 className="font-bold text-[#0E2841] text-sm uppercase tracking-wider">{tStr(COPY.metricsTitle, lang)}</h3>
                    {industry.stats.map((stat, i) => (
                      <div key={i} className="flex items-start gap-4">
                        <div className="text-2xl font-extrabold flex-shrink-0 min-w-[64px]" style={{ color: industry.color }}>{stat.value}</div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-600 leading-relaxed">{industryStatLabel(industry, i, lang)}</p>
                          {stat.source && <SourceCaption source={stat.source} prefix={sourceLabel} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Illustrative scenario */}
                  <div className="rounded-xl border-2 p-6" style={{ borderColor: industry.color + "40" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: industry.color }} />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>{tStr(COPY.scenarioLabel, lang)}</span>
                    </div>
                    <h4 className="font-bold text-[#0E2841] mb-2">{industryCaseField(industry, "title", lang)}</h4>
                    <p className="text-xs text-gray-500 italic mb-4 leading-relaxed">{industryCaseField(industry, "framing", lang)}</p>
                    <div className="space-y-3">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>{tStr(COPY.challenge, lang)}</span>
                        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{industryCaseField(industry, "challenge", lang)}</p>
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>{tStr(COPY.approach, lang)}</span>
                        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{industryCaseField(industry, "approach", lang)}</p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: industry.color + "10" }}>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>{tStr(COPY.goodLooks, lang)}</span>
                        <p className="text-sm font-semibold text-[#0E2841] mt-1 leading-relaxed">{industryCaseField(industry, "outcome", lang)}</p>
                      </div>
                    </div>
                  </div>

                  <Link href="/contact" className="block w-full text-center font-bold py-3.5 rounded-xl text-white transition-colors" style={{ backgroundColor: industry.color }}>
                    {tStr(COPY.talkTeamPrefix, lang)} {indTitle} {tStr(COPY.talkTeamSuffix, lang)} <ArrowRight size={14} className="inline ml-1 rtl:-scale-x-100" />
                  </Link>

                  <Link
                    href={`/marketplace?industry=${industry.id}`}
                    className="block w-full text-center font-semibold py-3 rounded-xl border-2 transition-colors hover:bg-gray-50"
                    style={{ borderColor: industry.color, color: industry.color }}
                  >
                    {tStr(COPY.relatedTools, lang)} <ArrowRight size={14} className="inline ml-1 rtl:-scale-x-100" />
                  </Link>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-[#0E2841] to-[#156082]">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-5">{tStr(COPY.ctaTitle, lang)}</h2>
          <p className="text-gray-300 mb-8 text-lg">{tStr(COPY.ctaPara, lang)}</p>
          <Link href="/contact" className="inline-flex items-center gap-2 bg-[#F5A623] text-white font-bold px-8 py-4 rounded-xl hover:bg-[#d4622a] transition-colors">
            {tStr(COPY.ctaButton, lang)} <ArrowRight size={18} className="rtl:-scale-x-100" />
          </Link>
        </div>
      </section>
    </div>
  );
}
