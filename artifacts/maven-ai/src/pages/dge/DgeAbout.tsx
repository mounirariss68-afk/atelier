/**
 * /dge/about — the agent ecosystem map. Lists all 8 Agentic Factories,
 * their promise, and named sentinels. Static narrative; mirrors the
 * Publicis Sapient deck's ecosystem diagram.
 */
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import { FACTORIES } from "@/data/dge/factories";

export default function DgeAbout() {
  const { lang, dir } = useLang();
  return (
    <div className="pt-20" dir={dir}>
      <section className="bg-[#0A1230] py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/marketplace/dge-effortless" className="inline-flex items-center gap-1 text-[#C45BB8] text-xs font-bold mb-4">
            <ArrowLeft size={12} /> {tStr({ en: "Back to DGE hub", ar: "العودة إلى مركز DGE" }, lang)}
          </Link>
          <p className="text-[#C45BB8] font-semibold text-xs uppercase tracking-widest">
            {tStr({ en: "DGE Agent Ecosystem", ar: "منظومة وكلاء DGE" }, lang)}
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white mt-3 mb-3">
            {tStr({ en: "Eight Agentic Factories", ar: "ثماني مصانع ذكاء وكيلي" }, lang)}{" "}
            <span className="italic text-[#C45BB8]">{tStr({ en: "— one shared shell.", ar: "— هيكل مشترك واحد." }, lang)}</span>
          </h1>
          <div className="border-l-4 border-[#C45BB8] ps-4 max-w-[540px]">
            <p className="text-base text-gray-200 leading-relaxed">
              {tStr({
                en: "Every factory is a small team of named sentinels with a single promise. They share the DGE CX Hub system of record, the HAPA H1–H6 contract, and a sovereign Falcon-Arabic LLM running on Azure UAE-North via Core42.",
                ar: "كل مصنع فريق صغير من حرّاس مسمَّيين بوعد واحد. يشتركون في مركز تجربة العميل، وعقد HAPA من H1 إلى H6، ونموذج Falcon-Arabic السيادي على Azure UAE-North عبر Core42.",
              }, lang)}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#FBF8F2] py-14">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-2 gap-5">
          {FACTORIES.map((f, i) => (
            <div key={f.id} className="bg-white rounded-2xl border border-[#E5DFD3] p-5 shadow-sm" data-testid={`factory-${f.id}`}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-2xl font-extrabold italic text-[#B98A4D]">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[10px] uppercase tracking-widest font-bold text-[#006A6A]">
                  {tStr({ en: "Factory", ar: "مصنع" }, lang)}
                </span>
              </div>
              <h3 className="text-lg font-extrabold text-[#024F4F]">{tStr(f.name, lang)}</h3>
              <p className="text-sm italic text-[#B98A4D] mb-3">"{tStr(f.promise, lang)}"</p>
              <ul className="space-y-1 text-xs text-[#475259]">
                {f.sentinels.map((s, j) => (
                  <li key={j} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-[#006A6A]" />{tStr(s, lang)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
