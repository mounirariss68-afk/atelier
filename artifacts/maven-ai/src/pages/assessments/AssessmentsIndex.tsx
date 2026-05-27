import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Clock, ShieldCheck, Sparkles, Users } from "lucide-react";
import { assessmentsList } from "@workspace/assessments";
import { useLang, tStr, type T } from "@/lib/lang";

export default function AssessmentsIndex() {
  const { lang, dir } = useLang();
  const t = (s: T) => tStr(s, lang);
  return (
    <div dir={dir} className="pt-20 bg-gradient-to-b from-white via-slate-50 to-white">
      <section className="bg-[#0A1230] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <span className="inline-flex items-center gap-2 bg-[#C45BB8]/20 border border-[#C45BB8]/30 text-[#C45BB8] text-xs font-semibold px-4 py-2 rounded-full uppercase tracking-wider mb-6">
            {t({ en: "Diagnostic Suite", ar: "حزمة التشخيص", tr: "Teşhis Paketi" })}
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight max-w-4xl">
            {t({
              en: "Where do you actually stand?",
              ar: "أين تقفون فعلاً؟",
              tr: "Aslında nerede duruyorsunuz?",
            })}
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-300 max-w-3xl leading-relaxed">
            {t({
              en: "Four short, partner-grade diagnostics calibrated for the GCC. Each one delivers a tier rating, peer benchmark, sovereign sub-score, anti-pattern detection, an executive memo signed by the partnership, and a branded PDF report. No CRM. No email wall. No bot.",
              ar: "أربعة تشخيصات قصيرة بمستوى شراكة معايرة لمنطقة الخليج. كل واحد يقدم تصنيف نضج، مقارنة أقران، نتيجة سيادية، أنماط مضادة، مذكرة تنفيذية بتوقيع الشركاء، وتقرير PDF منمّق.",
              tr: "Körfez için kalibre edilmiş, ortak seviyesinde dört kısa teşhis. Her biri bir olgunluk seviyesi, emsal karşılaştırması, egemen alt-skor, anti-pattern tespiti, ortaklık tarafından imzalanmış bir yönetici notu ve markalı bir PDF raporu sunar. CRM yok. E-posta duvarı yok. Bot yok.",
            })}
          </p>
          <div className="mt-8 flex flex-wrap gap-4 text-sm text-gray-300">
            <span className="inline-flex items-center gap-2"><Clock size={14} /> 6–14 {t({ en: "minutes each", ar: "دقائق لكل تشخيص", tr: "dakika (her biri)" })}</span>
            <span className="inline-flex items-center gap-2"><ShieldCheck size={14} /> {t({ en: "Sovereign sub-score baked in", ar: "نتيجة سيادية مدمجة", tr: "Yerleşik egemen alt-skor" })}</span>
            <span className="inline-flex items-center gap-2"><Users size={14} /> {t({ en: "Multi-stakeholder team mode", ar: "وضع فريق متعدد المعنيين", tr: "Çok-paydaşlı takım modu" })}</span>
            <span className="inline-flex items-center gap-2"><Sparkles size={14} /> {t({ en: "AI-personalized memo", ar: "مذكرة مخصصة بالذكاء الاصطناعي", tr: "AI-kişiselleştirilmiş not" })}</span>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="grid md:grid-cols-2 gap-6">
          {assessmentsList.map((a, i) => (
            <motion.div
              key={a.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="bg-white rounded-2xl border border-gray-200 p-7 hover:shadow-2xl hover:-translate-y-1 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: a.brandColor }}
                >
                  {a.code}
                </span>
                <span className="text-xs font-medium text-gray-500">
                  {a.estMinutes} {t({ en: "min", ar: "دقيقة", tr: "dk" })}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#0A1230] mb-2 leading-tight">
                {t(a.title)}
              </h2>
              <p className="text-sm text-gray-500 mb-3 italic">{t(a.subtitle)}</p>
              <p className="text-gray-700 leading-relaxed mb-5 text-sm">{t(a.description)}</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {a.dimensions.slice(0, 4).map((d) => (
                  <span
                    key={d.id}
                    className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full font-medium"
                  >
                    {t(d.title)}
                  </span>
                ))}
                {a.dimensions.length > 4 && (
                  <span className="text-xs text-slate-500 px-2 py-1">
                    +{a.dimensions.length - 4} {t({ en: "more", ar: "أخرى", tr: "daha" })}
                  </span>
                )}
              </div>
              <Link
                href={`/assessments/${a.slug}`}
                className="inline-flex items-center gap-2 font-bold transition"
                style={{ color: a.brandColor }}
                data-testid={`link-start-${a.slug}`}
              >
                {t({ en: "Start the assessment", ar: "ابدأ التقييم", tr: "Değerlendirmeye başlayın" })}
                <ArrowRight size={16} className="rtl:-scale-x-100" />
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 bg-gradient-to-br from-[#0A1230] to-[#5B7CFF] rounded-3xl p-8 sm:p-12 text-white">
          <div className="grid md:grid-cols-[2fr,1fr] gap-8 items-center">
            <div>
              <span className="inline-block text-xs font-bold uppercase tracking-widest text-[#C45BB8] mb-3">
                {t({ en: "Reinvention Index", ar: "مؤشر إعادة الابتكار", tr: "Yeniden İcat İndeksi" })}
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold mb-3">
                {t({
                  en: "Complete all three core assessments → unlock your composite Reinvention Index",
                  ar: "أكمل التقييمات الثلاثة → افتح مؤشر إعادة الابتكار المركّب",
                  tr: "Üç temel değerlendirmeyi tamamlayın → bileşik Yeniden İcat İndeksinizi açın",
                })}
              </h3>
              <p className="text-gray-200 leading-relaxed">
                {t({
                  en: "ARI + MVI + DAFI combine into a single 0–100 readiness rating. The number boards take seriously.",
                  ar: "ARI + MVI + DAFI تتحد في نتيجة جاهزية واحدة من 100. رقم تأخذه مجالس الإدارة بجدية.",
                  tr: "ARI + MVI + DAFI, tek bir 0–100 hazırlık derecesinde birleşir. Yönetim kurullarının ciddiye aldığı sayı.",
                })}
              </p>
            </div>
            <Link
              href="/assessments/ari"
              className="bg-[#C45BB8] hover:bg-[#A04A99] text-white font-bold px-6 py-4 rounded-xl text-center transition"
            >
              {t({ en: "Start with ARI →", ar: "ابدأ بـ ARI →", tr: "ARI ile başlayın →" })}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
