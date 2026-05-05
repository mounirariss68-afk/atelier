import { Link } from "wouter";
import { motion } from "framer-motion";
import { Brain, Code2, Database, Rocket, ArrowRight, Package } from "lucide-react";
import { services } from "@/data/content";
import { useLang, tStr } from "@/lib/lang";

const COPY = {
  eyebrow: { en: "Our Services", ar: "خدماتنا", tr: "Hizmetlerimiz" },
  title: {
    en: "Services — the project-led path to outcomes.",
    ar: "الخدمات — المسار القائم على المشاريع للوصول إلى النتائج.",
    tr: "Hizmetler — sonuçlara giden proje öncülüğündeki yol.",
  },
  introA: {
    en: "This is Maven's project-led path: custom transformation engagements when the problem is bespoke, the sponsor is senior, and the operating model has to change. Four value propositions, each a stand-alone offer, often blended together.",
    ar: "هذا هو مسار مافن القائم على المشاريع: ارتباطات تحول مخصصة عندما تكون المشكلة فريدة والراعي على المستوى التنفيذي ويجب تغيير نموذج التشغيل. أربعة عروض قيمة، كل منها مستقل، وغالباً ما تُدمج معاً.",
    tr: "Bu, Maven'in proje öncülüğündeki yoludur: sorun kendine özgü olduğunda, sponsor üst düzey olduğunda ve operasyon modelinin değişmesi gerektiğinde özel dönüşüm çalışmaları. Her biri bağımsız bir teklif olan ve sıkça birlikte sunulan dört değer önermesi.",
  },
  introB: {
    en: "When the problem is shared across the industry and configuration beats invention, start with the asset-led Marketplace instead — most engagements blend the two.",
    ar: "عندما تكون المشكلة مشتركة عبر القطاع وتتفوق التهيئة على الابتكار، ابدأ بدلاً من ذلك بالسوق القائم على الأصول — ومعظم الارتباطات تمزج بين المسارين.",
    tr: "Sorun sektör genelinde ortak olduğunda ve yapılandırma yeniden icattan üstün geldiğinde, bunun yerine varlık öncülüğündeki Marketplace ile başlayın — çoğu çalışma her ikisini de harmanlar.",
  },
  marketplaceLink: { en: "asset-led Marketplace", ar: "السوق القائم على الأصول", tr: "varlık öncülüğündeki Marketplace" },
  povLink: { en: "Read the POV", ar: "اقرأ المنظور", tr: "Bakış açısını okuyun" },
};

const serviceIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Brain, Code2, Database, Rocket,
};

export default function Services() {
  const { lang, dir } = useLang();
  return (
    <div className="pt-20" dir={dir}>
      <section className="bg-[#0E2841] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">
            {tStr(COPY.eyebrow, lang)}
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl font-extrabold text-white mt-3 mb-5 max-w-3xl leading-tight"
          >
            {tStr(COPY.title, lang)}
          </motion.h1>
          <p className="text-xl text-gray-300 max-w-3xl leading-relaxed">
            {tStr(COPY.introA, lang)} {tStr(COPY.introB, lang)}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-[#F5A623] hover:text-white font-semibold underline underline-offset-4">
              <Package size={14} /> {tStr(COPY.marketplaceLink, lang)} <ArrowRight size={14} />
            </Link>
            <Link href="/insights/two-paths-to-outcomes" className="inline-flex items-center gap-1.5 text-[#F5A623] hover:text-white font-semibold underline underline-offset-4">
              {tStr(COPY.povLink, lang)} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-8">
            {services.map((service, i) => {
              const Icon = serviceIcons[service.icon] || Brain;
              return (
                <motion.div
                  key={service.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="group border border-gray-100 rounded-2xl p-8 hover:shadow-xl transition-all hover:border-transparent"
                >
                  <div className="flex items-start justify-between mb-6">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: service.color + "18" }}
                    >
                      <Icon size={26} style={{ color: service.color }} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full" style={{ backgroundColor: service.color + "15", color: service.color }}>
                      Buyer: {service.buyer}
                    </span>
                  </div>
                  <h2 className="text-2xl font-extrabold text-[#0E2841] mb-2">{service.title}</h2>
                  <p className="text-[#156082] font-semibold text-sm mb-4">{service.tagline}</p>
                  <p className="text-gray-600 leading-relaxed mb-6">{service.description}</p>
                  <div className="grid grid-cols-3 gap-4 mb-7">
                    {service.stats.map((stat, j) => (
                      <div key={j} className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="font-bold text-[#0E2841] text-sm">{stat.value}</div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-tight">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={`/services/${service.slug}`}
                    className="inline-flex items-center gap-2 font-bold px-6 py-3 rounded-xl text-white transition-colors"
                    style={{ backgroundColor: service.color }}
                  >
                    Learn more <ArrowRight size={16} />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-[#F8F9FA]">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-[#0E2841] mb-4">Not sure where to start?</h2>
          <p className="text-gray-600 mb-8">Most of our engagements begin with a three-day scoping sprint. We map your AI landscape, identify the highest-value opportunities, and propose a sequenced plan — before you commit to anything.</p>
          <Link href="/contact" className="inline-flex items-center gap-2 bg-[#F5A623] text-white font-bold px-8 py-4 rounded-xl hover:bg-[#d4622a] transition-colors">
            Schedule a discovery call <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}
