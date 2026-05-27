/**
 * /dge/method — HAPA + UX Authority methodology page.
 * Static narrative explaining the H1–H6 contract, the may / mayOnlyWithHuman /
 * mustNever shape of the BehaviouralContract, and the AUTHORIZE card pattern.
 */
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck, AlertTriangle, ClipboardCheck, FileLock2 } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";

const HAPA = [
  { id: "H1", en: "Honest", ar: "صادق", desc: { en: "The agent reveals what it is, what it knows, and how confident it is. No hidden persona, no overstated certainty.", ar: "يكشف الوكيل ماهيته وحدوده ودرجة ثقته. لا شخصية خفية ولا ثقة مبالغ بها." } },
  { id: "H2", en: "Helpful", ar: "نافع", desc: { en: "Useful inside the citizen's actual job-to-be-done — not deflective, not evasive, not page-views-driven.", ar: "نافع داخل مهمة المواطن الفعلية — دون مراوغة." } },
  { id: "H3", en: "Harmless", ar: "غير مؤذٍ", desc: { en: "No discriminatory drift, no dark-pattern nudge, no irreversible side-effects without an explicit human commit.", ar: "بلا تحيّز، بلا أنماط مخادعة، بلا آثار غير قابلة للتراجع دون التزام بشري." } },
  { id: "H4", en: "Auditable", ar: "قابل للتدقيق", desc: { en: "Every step lands in an immutable timeline with citations, the cited source, and the contract clause it satisfied.", ar: "كل خطوة تُسجَّل بسجل غير قابل للتعديل مع الاستشهادات." } },
  { id: "H5", en: "Bilingual", ar: "ثنائي اللغة", desc: { en: "EN and AR shipped from the same authored source — never machine-translated at runtime.", ar: "العربية والإنجليزية من نفس المصدر — لا ترجمة آلية عند التشغيل." } },
  { id: "H6", en: "Human-gated", ar: "بإذن بشري", desc: { en: "Consequential actions pause until a named human commits. The AUTHORIZE card is the surface; the audit log is the receipt.", ar: "تتوقّف الإجراءات حتى يلتزم بشري مسمَّى." } },
];

export default function DgeMethod() {
  const { lang, dir } = useLang();
  return (
    <div className="pt-20" dir={dir}>
      <section className="bg-[#0A1230] py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/marketplace/dge-effortless" className="inline-flex items-center gap-1 text-[#C45BB8] text-xs font-bold mb-4">
            <ArrowLeft size={12} /> {tStr({ en: "Back to DGE hub", ar: "العودة إلى مركز DGE" }, lang)}
          </Link>
          <p className="text-[#C45BB8] font-semibold text-xs uppercase tracking-widest">
            {tStr({ en: "Method", ar: "المنهج" }, lang)}
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white mt-3 mb-3">
            {tStr({ en: "HAPA + UX Authority", ar: "HAPA + صلاحية التجربة" }, lang)}{" "}
            <span className="italic text-[#C45BB8]">{tStr({ en: "— how every step is gated.", ar: "— كيف تُنظَّم كل خطوة." }, lang)}</span>
          </h1>
          <div className="border-l-4 border-[#C45BB8] ps-4 max-w-[540px]">
            <p className="text-base text-gray-200 leading-relaxed">
              {tStr({
                en: "The DGE Behavioural Contract is a typed structure with three lists — may, mayOnlyWithHuman, mustNever. The runtime checks every action against the contract before it ever reaches a citizen surface, and the result lands in the audit timeline as outcome: ok | pending | authorised | blocked.",
                ar: "عقد DGE السلوكي بنية مُكتَبة من ثلاث قوائم — يجوز، يجوز فقط بإذن إنسان، يجب ألا. يفحص المحرّك كل إجراء قبل وصوله إلى المواطن، وتُسجَّل النتيجة في سجل التدقيق.",
              }, lang)}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#FBF8F2] py-14">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-extrabold text-[#024F4F] mb-6 flex items-center gap-2">
            <ShieldCheck size={22} /> {tStr({ en: "HAPA H1–H6", ar: "HAPA H1–H6" }, lang)}
          </h2>
          <div className="grid md:grid-cols-2 gap-4 mb-12">
            {HAPA.map((h) => (
              <div key={h.id} className="bg-white rounded-xl border border-[#E5DFD3] p-5 shadow-sm" data-testid={`hapa-${h.id}`}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-xl font-extrabold text-[#B98A4D] italic">{h.id}</span>
                  <span className="text-base font-bold text-[#024F4F]">{tStr({ en: h.en, ar: h.ar }, lang)}</span>
                </div>
                <p className="text-sm text-[#475259] leading-relaxed">{tStr(h.desc, lang)}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-[#E5DFD3] p-5 shadow-sm">
              <ClipboardCheck size={20} className="text-[#006A6A] mb-2" />
              <h3 className="font-bold text-[#024F4F] mb-1">{tStr({ en: "may", ar: "يجوز" }, lang)}</h3>
              <p className="text-xs text-[#475259]">{tStr({ en: "Actions the agent performs autonomously — drafting, clustering, scoring, retrieving with citations.", ar: "إجراءات يقوم بها الوكيل ذاتياً — صياغة وتجميع وتقييم واسترجاع بالاستشهادات." }, lang)}</p>
            </div>
            <div className="bg-white rounded-xl border border-[#E5DFD3] p-5 shadow-sm">
              <FileLock2 size={20} className="text-[#B98A4D] mb-2" />
              <h3 className="font-bold text-[#024F4F] mb-1">{tStr({ en: "mayOnlyWithHuman", ar: "يجوز فقط بإذن إنسان" }, lang)}</h3>
              <p className="text-xs text-[#475259]">{tStr({ en: "Consequential actions paused behind an AUTHORIZE card naming the committing human.", ar: "إجراءات ذات أثر، متوقّفة خلف بطاقة اعتماد تسمّي البشري الملتزم." }, lang)}</p>
            </div>
            <div className="bg-white rounded-xl border border-[#E5DFD3] p-5 shadow-sm">
              <AlertTriangle size={20} className="text-[#B23A3A] mb-2" />
              <h3 className="font-bold text-[#024F4F] mb-1">{tStr({ en: "mustNever", ar: "يجب ألا" }, lang)}</h3>
              <p className="text-xs text-[#475259]">{tStr({ en: "Hard-blocked at the runner. Even a scripted step trying to perform one is recorded as outcome: blocked.", ar: "محظور صلباً عند المحرّك. أي محاولة تُسجَّل كنتيجة: محظور." }, lang)}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
