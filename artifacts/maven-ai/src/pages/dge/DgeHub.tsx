/**
 * DGE Effortless 2.0 — marketplace hub landing.
 * Six numbered demo cards in the Maven brand grid (eyebrow → italic gold
 * accent → 540px lede with gold left rule), each linking to its
 * /demo/dge-<slug> route. Maven brand chrome stays — the moment a user
 * clicks into a demo, the TAMM/ADGE theme takes over.
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, ShieldCheck, BookOpen, Network } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import { DGE_DEMOS } from "@/data/dge/demos";
import { FACTORIES } from "@/data/dge/factories";

export default function DgeHub() {
  const { lang, dir } = useLang();
  return (
    <div className="pt-20" dir={dir}>
      <section className="bg-[#0A1230] py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-[#C45BB8] font-semibold text-xs uppercase tracking-widest">
            {tStr({ en: "DGE × Publicis Sapient × Cognirise", ar: "DGE × Publicis Sapient × Cognirise" }, lang)}
          </p>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white mt-3 mb-2 leading-tight">
            <span className="italic text-[#C45BB8]">{tStr({ en: "DGE Effortless 2.0", ar: "DGE الجهد المنعدم 2.0" }, lang)}</span>
            {" — "}
            {tStr({ en: "Agentic CX Demonstrator", ar: "عرض تجربة الذكاء الوكيلي" }, lang)}
          </h1>
          <div className="border-l-4 border-[#C45BB8] ps-4 max-w-[540px] mt-4">
            <p className="text-base sm:text-lg text-gray-200 leading-relaxed">
              {tStr({
                en: "Six self-contained agentic CX demos plug into one shared shell. Every consequential action is gated behind a labelled AUTHORIZE card naming the human committing to it. Every step is recorded against HAPA H1–H6 contracts and an immutable audit log.",
                ar: "ستة عروض ذكاء وكيلي مستقلة تتّصل بهيكل مشترك واحد. كل إجراء يمرّ عبر بطاقة اعتماد تُسمّي الشخص الملتزم به، وكل خطوة تُسجَّل على عقود HAPA من H1 إلى H6 ضمن سجل تدقيق غير قابل للتعديل.",
              }, lang)}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/dge/about" className="inline-flex items-center gap-1.5 text-[#C45BB8] hover:text-white text-sm font-bold underline underline-offset-4">
              <Network size={14} /> {tStr({ en: "DGE Agent Ecosystem", ar: "منظومة وكلاء DGE" }, lang)}
            </Link>
            <Link href="/dge/method" className="inline-flex items-center gap-1.5 text-[#C45BB8] hover:text-white text-sm font-bold underline underline-offset-4">
              <BookOpen size={14} /> {tStr({ en: "HAPA + Authority method", ar: "منهج HAPA والصلاحية" }, lang)}
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#FBF8F2] py-14">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#006A6A] mb-2">
            {tStr({ en: "Six demos · TAMM / ADGE design system", ar: "ستة عروض · نظام TAMM / ADGE" }, lang)}
          </p>
          <div className="grid md:grid-cols-2 gap-5">
            {DGE_DEMOS.map((d, i) => {
              const factory = FACTORIES.find((f) => f.id === d.factory);
              return (
                <motion.div
                  key={d.slug}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white rounded-2xl border border-[#E5DFD3] p-6 flex flex-col shadow-sm hover:shadow-md transition-shadow"
                  data-testid={`dge-demo-card-${d.slug}`}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-3">
                    <span className="text-3xl font-extrabold text-[#B98A4D] italic">{d.number}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[#E1F2EE] text-[#024F4F]">
                      {tStr(factory?.name ?? { en: "", ar: "" }, lang)}
                    </span>
                  </div>
                  <h3 className="text-xl font-extrabold text-[#024F4F] mb-2 leading-snug">
                    {tStr(d.title, lang)}
                  </h3>
                  <p className="text-sm text-[#475259] leading-relaxed mb-4 max-w-[480px]">
                    {tStr(d.oneLine, lang)}
                  </p>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {d.kpis.map((k, j) => (
                      <div key={j} className="rounded-md p-2 bg-[#FBF8F2] border border-[#E5DFD3]">
                        <p className="text-[9px] uppercase tracking-widest text-[#8A9499] font-bold">{tStr(k.label, lang)}</p>
                        <p className="text-xs font-bold text-[#024F4F] mt-0.5">{k.before} → {k.after}</p>
                        <p className="text-[10px] font-bold text-[#2F7A4D]">{tStr(k.delta, lang)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-4">
                    {d.agentStack.map((a, k) => (
                      <span key={k} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#F1E3CD] text-[#5A3000]">
                        {tStr(a, lang)}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={`/demo/${d.slug}`}
                    className="mt-auto inline-flex items-center gap-2 text-sm font-bold text-[#006A6A] hover:text-[#024F4F]"
                    data-testid={`dge-launch-${d.slug}`}
                  >
                    {tStr({ en: "Open the demo", ar: "افتح العرض" }, lang)}
                    <ArrowRight size={14} className="rtl:rotate-180" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
