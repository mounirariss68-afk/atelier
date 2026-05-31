import { Link, useParams } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
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
  Brain,
  MessageSquare,
  Eye,
  Wallet,
  Play,
  Network,
  Zap,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  marketplaceTools,
  marketplaceClasses,
  marketplaceHorizontals,
  industriesIndex,
  servicesIndex,
  assessmentsIndex,
  marketplaceAgentCasts,
  industryTitle as industryTitleI18n,
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";
import NotFound from "./not-found";
import AgentTopologyDiagram from "@/components/marketplace/AgentTopologyDiagram";
import { getScenario } from "@/lib/sim/scenarios";

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
  Brain,
  MessageSquare,
  BrainCircuit: Brain,
};

// "Why we built it this way" — three killer angles strip rendered on the
// Cognirise Personal Agent detail page only. Lives at module scope so the JSX
// inside the component stays scannable.
const PERSONAL_AGENT_ANGLES: {
  icon: LucideIcon;
  badge: { en: string; ar: string; tr?: string };
  title: { en: string; ar: string; tr?: string };
  body: { en: string; ar: string; tr?: string };
}[] = [
  {
    icon: Wallet,
    badge: { en: "Employee-owned", ar: "مملوك للموظف", tr: "Çalışana ait" },
    title: { en: "Your Personal Context Graph belongs to you, not the vendor.", ar: "رسم سياقك الشخصي ملكك أنت، لا المورّد.", tr: "Kişisel Bağlam Grafiğiniz size aittir, satıcıya değil." },
    body: { en: "Cedric, M365 Copilot Memory and ChatGPT Memory all lock the employee's accumulated context inside the vendor's silo. We invert this: the PCG is portable as JSON-LD on demand and travels with the employee between jobs. The employer pays for work-scope access, never for the memory itself.", ar: "سيدريك وذاكرة M365 Copilot وذاكرة ChatGPT جميعها تحبس السياق المتراكم للموظف داخل صومعة المورّد. نقلب هذا: الرسم قابل للتصدير كـ JSON-LD متى شئت ويسافر مع الموظف بين الوظائف. يدفع صاحب العمل مقابل وصول نطاق العمل، لا مقابل الذاكرة نفسها.", tr: "Cedric, M365 Copilot Memory ve ChatGPT Memory çalışanın biriktirdiği bağlamı satıcının silosunda kilitler. Bunu tersine çeviriyoruz: PCG istek üzerine JSON-LD olarak taşınabilir ve çalışanla birlikte işler arasında gider. İşveren bellek için değil, iş-kapsamı erişim için öder." },
  },
  {
    icon: Eye,
    badge: { en: "Glass-box trust", ar: "ثقة شفّافة", tr: "Cam-kutu güveni" },
    title: { en: "Every answer cites its nodes. Every action drops a receipt with one-click undo.", ar: "كل إجابة تستشهد بعقدها. كل إجراء يترك إيصالاً مع زر تراجع واحد.", tr: "Her cevap kaynağındaki düğümleri gösterir. Her eylem, tek-tıkla geri-al içeren bir makbuz bırakır." },
    body: { en: "The Cockpit's right-hand rail is non-negotiable. The same nodes the retriever picked appear under the chat reply, and every autonomous action — sent follow-up, booked slot, drafted offer — drops a receipt listing the cited nodes, autonomy level, and time saved. Black-box anxiety is the #1 reason enterprise pilots stall; we removed it from the product, not from the policy.", ar: "الشريط الأيمن في القمرة غير قابل للتفاوض. نفس العقد التي اختارها المسترجع تظهر أسفل ردّ الدردشة، وكل إجراء آلي — متابعة مرسلة، موعد محجوز، عرض مصاغ — يترك إيصالاً يذكر العقد المستشهَد بها ومستوى الاستقلالية والوقت الموفّر. قلق الصندوق الأسود السبب الأول لتعطّل التجارب المؤسسية؛ أزلناه من المنتج لا من السياسة.", tr: "Kokpit'in sağ şeridi pazarlık konusu değildir. Getiricinin seçtiği aynı düğümler sohbet cevabının altında görünür ve her özerk eylem — gönderilen takip, ayrılan slot, taslak teklif — atıf yapılan düğümleri, özerklik seviyesini ve kazanılan zamanı listeleyen bir makbuz bırakır. Kara-kutu kaygısı kurumsal pilotların durmasının 1 numaralı sebebi; bunu üründen kaldırdık, politikadan değil." },
  },
  {
    icon: Brain,
    badge: { en: "Cross-life agent", ar: "مساعد عبر الحياة", tr: "Yaşamlar arası ajan" },
    title: { en: "One agent for the whole person. Drafts an offer letter. Remembers the recital.", ar: "مساعد واحد للشخص بأكمله. يصوغ خطاب العرض. يتذكّر حفلة الابنة.", tr: "Tek insan için tek ajan. Teklif mektubu yazar. Konseri hatırlar." },
    body: { en: "The fragmentation of work and personal AI today is artificial — the human is one person. Atlas can prep the ACME QBR and block the calendar for a daughter's recital because both signals already live in the PCG. The privacy boundary is by scope (Work / Personal), not by vendor. Toggle Personal off and you see exactly the slice the employer would ever access.", ar: "تجزئة الذكاء الاصطناعي للعمل والحياة الشخصية اليوم مصطنعة — الإنسان واحد. أطلس يُجهّز عرض ACME QBR ويحجز تقويم حفلة ابنة الموظف لأن كلتا الإشارتين موجودتان في الرسم. حدود الخصوصية بالنطاق (عمل/شخصي) لا بالمورّد. أوقف 'شخصي' ترى الشريحة التي قد يصل إليها صاحب العمل تماماً.", tr: "Bugünkü iş ve kişisel yapay zekâ ayrımı yapaydır — insan bir kişidir. Atlas hem ACME QBR'yi hazırlayabilir hem de bir kızın konseri için takvimi bloklayabilir çünkü her iki sinyal de zaten PCG'dedir. Gizlilik sınırı kapsama göredir (İş / Kişisel), satıcıya göre değil. Kişisel'i kapatın ve işverenin erişebileceği tam dilimi görün." },
  },
];

const COPY = {
  back: { en: "Back to Marketplace", ar: "العودة إلى السوق", tr: "Marketplace'e dön" },
  liveBadge: { en: "Live demo", ar: "عرض تفاعلي", tr: "Canlı demo" },
  comingSoonBadge: { en: "Coming soon", ar: "قريباً", tr: "Yakında" },
  buyer: { en: "Named buyer", ar: "المشتري المستهدف", tr: "Hedef alıcı" },
  classLabel: { en: "Class", ar: "الفئة", tr: "Sınıf" },
  industriesLabel: { en: "Industries", ar: "القطاعات", tr: "Sektörler" },
  horizontalsLabel: { en: "Horizontals", ar: "الأفقي", tr: "Yataylar" },
  what: { en: "What it owns and how it works", ar: "ما يملكه وكيف يعمل", tr: "Neyi sahiplenir ve nasıl çalışır" },
  topologyTitle: { en: "Agent topology", ar: "طوبولوجيا الوكلاء", tr: "Ajan topolojisi" },
  topologyKicker: {
    en: "An orchestrator coordinates a small cast of specialists. Human checkpoints gate every irreversible action.",
    ar: "منسّق يقود فريقاً صغيراً من المتخصّصين. تتحكّم نقاط الموافقة البشرية في كل إجراء لا رجعة فيه.",
    tr: "Bir orkestra şefi küçük bir uzman ekibini koordine eder. İnsan kontrol noktaları her geri-alınamaz eylemi denetler.",
  },
  screensTitle: { en: "Demo screens", ar: "شاشات العرض", tr: "Demo ekranları" },
  dataTitle: { en: "Data model", ar: "نموذج البيانات", tr: "Veri modeli" },
  inputs: { en: "Inputs", ar: "المدخلات", tr: "Girdiler" },
  internal: { en: "Internal IP", ar: "الملكية الفكرية الداخلية", tr: "Dahili IP" },
  outputs: { en: "Outputs", ar: "المخرجات", tr: "Çıktılar" },
  launchTitle: { en: "Launch the interactive demo", ar: "ابدأ العرض التفاعلي", tr: "İnteraktif demoyu başlat" },
  launchBody: {
    en: "Watch the orchestrator and its specialist agents run a deterministic scenario end-to-end — including the human checkpoint, the audit log, and the live KPIs. The demo opens in its own dedicated workspace so the marketing chrome stays out of the way.",
    ar: "شاهد المنسّق ومعاوِنيه يشغّلون سيناريو حتمياً من البداية للنهاية — بما في ذلك نقطة الموافقة البشرية وسجل التدقيق ومؤشرات الأداء المباشرة. يفتح العرض في مساحته المخصّصة بعيداً عن واجهة التسويق.",
    tr: "Orkestra şefinin ve uzman ajanlarının deterministik bir senaryoyu uçtan uca çalıştırmasını izleyin — insan kontrol noktası, denetim günlüğü ve canlı KPI'lar dahil. Demo, pazarlama arayüzünün karışmaması için kendi özel çalışma alanında açılır.",
  },
  launchCta: { en: "Launch demo", ar: "ابدأ العرض", tr: "Demoyu başlat" },
  ctaPartner: { en: "Talk to a partner about this tool", ar: "تحدّث مع شريك حول هذه الأداة", tr: "Bu araç hakkında bir ortakla konuşun" },
  ctaService: { en: "Related Cognirise service", ar: "خدمة Cognirise المرتبطة", tr: "İlgili Cognirise hizmeti" },
  ctaAssessment: { en: "Run the related diagnostic", ar: "شغّل التشخيص المرتبط", tr: "İlgili teşhisi çalıştırın" },
  comingSoonNote: {
    en: "An interactive scenario for this tool is being scripted as part of the agentic marketplace redesign. The detail below — agent topology, data model, screens — is the canonical brief our delivery teams use when scoping it.",
    ar: "يجري الآن إعداد سيناريو تفاعلي لهذه الأداة ضمن إعادة تصميم السوق الوكيلي. التفاصيل أدناه — طوبولوجيا الوكلاء ونموذج البيانات والشاشات — هي الموجز الرسمي الذي تستخدمه فرق التسليم عند تحديد النطاق.",
    tr: "Bu araç için interaktif bir senaryo, ajansal marketplace yeniden tasarımının bir parçası olarak yazılıyor. Aşağıdaki ayrıntılar — ajan topolojisi, veri modeli, ekranlar — teslim ekiplerimizin kapsam belirlerken kullandığı resmi özettir.",
  },
  workflowsTitle: { en: "Autonomous workflows", ar: "سير العمل المستقل", tr: "Otonom iş akışları" },
  workflowsKicker: {
    en: "Each workflow is a scripted run the orchestrator can launch end-to-end. The cast of agents, the trigger, and the human checkpoint are spelled out so the buyer knows exactly what they are approving.",
    ar: "كل سير عمل هو تشغيل مكتوب يمكن للمنسّق إطلاقه من البداية إلى النهاية. فريق الوكلاء والمحفّز ونقطة الموافقة البشرية موضّحون كي يعرف المشتري بالضبط ما يوافق عليه.",
    tr: "Her iş akışı, orkestra şefinin uçtan uca başlatabileceği yazılmış bir koşumdur. Ajanlar, tetikleyici ve insan kontrol noktası açıkça belirtilir, böylece alıcı tam olarak neyi onayladığını bilir.",
  },
  workflowTrigger: { en: "Trigger", ar: "المحفّز", tr: "Tetikleyici" },
  workflowSteps: { en: "Steps", ar: "الخطوات", tr: "Adımlar" },
  kpisTitle: { en: "KPI impact", ar: "أثر مؤشرات الأداء", tr: "KPI etkisi" },
  kpisKicker: {
    en: "Baseline metrics the demo's seeded scenario moves. Sources are cited so the CFO can trace every number.",
    ar: "المؤشرات الأساسية التي يحرّكها سيناريو العرض. المصادر موثّقة كي يستطيع المدير المالي تتبّع كل رقم.",
    tr: "Demonun başlangıç senaryosunun hareket ettirdiği temel metrikler. CFO'nun her sayıyı takip edebilmesi için kaynaklar belirtilmiştir.",
  },
  kpiBaseline: { en: "Baseline", ar: "خط الأساس", tr: "Başlangıç değeri" },
  kpiSource: { en: "Source", ar: "المصدر", tr: "Kaynak" },
};

export default function MarketplaceDetail() {
  const params = useParams();
  const slug = (params as { slug?: string }).slug;
  const tool = marketplaceTools.find((t) => t.slug === slug);
  const { lang, dir } = useLang();

  if (!tool) return <NotFound />;

  const Icon = ICONS[tool.icon] ?? Sparkles;
  const cls = marketplaceClasses.find((c) => c.id === tool.class);
  const horizontalMetas = tool.horizontals
    .map((h) => marketplaceHorizontals.find((mh) => mh.id === h))
    .filter(Boolean) as (typeof marketplaceHorizontals)[number][];
  const industryEntries = tool.industries
    .map((id) => industriesIndex.find((i) => i.id === id))
    .filter(Boolean) as (typeof industriesIndex)[number][];
  const relatedService = tool.relatedService
    ? servicesIndex.find((s) => s.slug === tool.relatedService)
    : undefined;
  const relatedAssessment = tool.relatedAssessment
    ? assessmentsIndex.find((a) => a.slug === tool.relatedAssessment)
    : undefined;
  const isLive = tool.status === "live";
  const cast = marketplaceAgentCasts[tool.slug];
  const scenario = getScenario(tool.slug);
  const hasScenario = !!scenario;
  const agentNameById = (id: string) =>
    scenario?.agents.find((a) => a.id === id)?.name ?? { en: id, ar: id };

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0A1230] py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white mb-6"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>

          <div className="flex items-start gap-5 mb-6">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: tool.accent + "33" }}
            >
              <Icon size={26} style={{ color: tool.accent }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {cls && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: tool.accent }}
                  >
                    {tStr(cls.title, lang)}
                  </span>
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    isLive ? "bg-white text-[#0A1230]" : "bg-white/10 text-gray-300"
                  }`}
                >
                  {isLive ? tStr(COPY.liveBadge, lang) : tStr(COPY.comingSoonBadge, lang)}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                {tStr(tool.title, lang)}
              </h1>
            </div>
          </div>

          <p className="text-lg text-gray-200 max-w-3xl leading-relaxed">
            {tStr(tool.pitch, lang)}
          </p>

          {hasScenario && !tool.demoVariants?.length && (
            <Link
              href={`/demo/${tool.slug}`}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#C45BB8] text-[#0A1230] font-bold text-sm hover:bg-[#FFC15E] transition-colors"
            >
              <Play size={14} fill="currentColor" />
              {tStr(COPY.launchCta, lang)}
            </Link>
          )}

          {tool.demoVariants && tool.demoVariants.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-3">
              {tool.demoVariants.map((v) => {
                const VIcon = ICONS[v.icon] ?? Play;
                return (
                  <Link
                    key={v.id}
                    href={`/demo/${tool.slug}/${v.route}`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#C45BB8] text-[#0A1230] font-bold text-sm hover:bg-[#FFC15E] transition-colors"
                  >
                    <VIcon size={14} />
                    {tStr(v.label, lang)}
                  </Link>
                );
              })}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-4 mt-8 pt-8 border-t border-white/10">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-1">
                {tStr(COPY.buyer, lang)}
              </p>
              <p className="text-sm text-white">{tStr(tool.buyer, lang)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-1">
                {tStr(COPY.industriesLabel, lang)}
              </p>
              <p className="text-sm text-white">
                {industryEntries.map((i) => industryTitleI18n(i as unknown as Record<string, unknown>, lang)).join(" · ")}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-1">
                {tStr(COPY.horizontalsLabel, lang)}
              </p>
              <p className="text-sm text-white">
                {horizontalMetas.length === 0
                  ? "—"
                  : horizontalMetas.map((h) => tStr(h.title, lang)).join(" · ")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Coming-soon notice (no scenario yet) */}
      {!hasScenario && (
        <section className="bg-[#FFFAF0] border-b border-amber-100 py-5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-sm text-amber-900 leading-relaxed max-w-4xl">
              <span className="font-bold">
                {tStr(COPY.comingSoonBadge, lang)} —{" "}
              </span>
              {tStr(COPY.comingSoonNote, lang)}
            </p>
          </div>
        </section>
      )}

      {/* Long description / problem & solution */}
      <section className="py-14 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.what, lang)}
          </p>
          <div className="space-y-5">
            {tool.longDescription.map((p, i) => (
              <p key={i} className="text-base text-gray-700 leading-relaxed">
                {tStr(p, lang)}
              </p>
            ))}
          </div>

          {/* Personal-agent-only: "Why we built it this way" + concept doc link.
              Conditional because the three killer angles only make sense for
              a tool whose differentiator is its memory/trust model. */}
          {tool.slug === "cognirise-personal-agent" && (
            <div className="mt-12 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 rounded-2xl bg-gradient-to-br from-[#a78bfa]/10 via-white to-[#5B7CFF]/5 border border-[#a78bfa]/20">
              <div className="flex items-start gap-3 mb-5">
                <div className="w-9 h-9 rounded-lg bg-[#a78bfa]/15 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} className="text-[#a78bfa]" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#a78bfa] mb-1">
                    {tStr({ en: "Why we built it this way", ar: "لماذا بنيناه هكذا", tr: "Neden böyle inşa ettik" }, lang)}
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed max-w-3xl">
                    {tStr(
                      {
                        en: "Three product decisions we will not compromise on, and the reasons each one matters more than the spec sheet says.",
                        ar: "ثلاثة قرارات منتج لن نتنازل عنها، وسبب أهمية كلٍّ منها أكثر مما تقوله ورقة المواصفات.",
                        tr: "Taviz vermeyeceğimiz üç ürün kararı ve her birinin neden teknik özet sayfasından daha önemli olduğu.",
                      },
                      lang,
                    )}
                  </p>
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {PERSONAL_AGENT_ANGLES.map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.07, duration: 0.35 }}
                      className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-[#a78bfa]/15 flex items-center justify-center">
                          <Icon size={14} className="text-[#a78bfa]" />
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-[#a78bfa]">
                          {tStr(a.badge, lang)}
                        </span>
                      </div>
                      <h4 className="text-base font-extrabold text-[#0A1230] mb-2 leading-snug">
                        {tStr(a.title, lang)}
                      </h4>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {tStr(a.body, lang)}
                      </p>
                    </motion.div>
                  );
                })}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/personal-agent/concept"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-[#0A1230] text-white font-bold text-xs hover:bg-[#091828]"
                >
                  <BookOpen size={12} />
                  {tStr({ en: "Read the concept & research doc", ar: "اقرأ وثيقة المفهوم والبحث", tr: "Konsept ve araştırma belgesini okuyun" }, lang)}
                  <ArrowRight size={12} className="rtl:rotate-180" />
                </Link>
                <Link
                  href="/demo/cognirise-personal-agent/cockpit"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-[#a78bfa] text-[#0A1230] font-bold text-xs hover:bg-[#c4b5fd]"
                >
                  <MessageSquare size={12} />
                  {tStr({ en: "Open the Cockpit", ar: "افتح القمرة", tr: "Kokpit'i aç" }, lang)}
                </Link>
                <Link
                  href="/demo/cognirise-personal-agent/mind"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-[#0A1230]/30 text-[#0A1230] font-bold text-xs hover:bg-[#0A1230] hover:text-white"
                >
                  <Brain size={12} />
                  {tStr({ en: "Open the Mind", ar: "افتح العقل", tr: "Zihni aç" }, lang)}
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Agent topology */}
      {cast && (
        <section className="py-14 bg-[#091828]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-[#C45BB8]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Network size={16} className="text-[#C45BB8]" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-1">
                  {tStr(COPY.topologyTitle, lang)}
                </p>
                <p className="text-base text-gray-200 leading-relaxed max-w-3xl">
                  {tStr(COPY.topologyKicker, lang)}
                </p>
              </div>
            </div>
            <AgentTopologyDiagram cast={cast} accent={tool.accent} />
          </div>
        </section>
      )}

      {/* Demo screens */}
      <section className="py-14 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.screensTitle, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tool.screens.map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
              >
                <div
                  className="h-2 w-full"
                  style={{ background: tool.accent }}
                  aria-hidden="true"
                />
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: tool.accent }}
                    >
                      {i + 1}
                    </span>
                    <h3 className="font-bold text-[#0A1230]">{tStr(s.title, lang)}</h3>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {tStr(s.caption, lang)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Autonomous workflows */}
      {scenario && scenario.workflows.length > 0 && (
        <section className="py-14 bg-white border-t border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-start gap-3 mb-8">
              <div className="w-9 h-9 rounded-lg bg-[#5B7CFF]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap size={16} className="text-[#5B7CFF]" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5B7CFF] mb-1">
                  {tStr(COPY.workflowsTitle, lang)}
                </p>
                <p className="text-base text-gray-700 leading-relaxed max-w-3xl">
                  {tStr(COPY.workflowsKicker, lang)}
                </p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              {scenario.workflows.map((wf) => (
                <div
                  key={wf.id}
                  className="border border-gray-200 rounded-2xl p-6 bg-[#FBFCFD] flex flex-col gap-4"
                >
                  <div>
                    <h3 className="text-lg font-bold text-[#0A1230] mb-1">
                      {tStr(wf.name, lang)}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {tStr(wf.description, lang)}
                    </p>
                  </div>
                  <div className="text-xs text-gray-700 bg-white border border-gray-100 rounded-lg px-3 py-2">
                    <span className="font-bold uppercase tracking-widest text-[10px] text-[#C45BB8] me-2">
                      {tStr(COPY.workflowTrigger, lang)}:
                    </span>
                    {tStr(wf.trigger, lang)}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                      {tStr(COPY.workflowSteps, lang)}
                    </p>
                    <ol className="space-y-2">
                      {wf.steps.map((s, i) => (
                        <li key={i} className="flex gap-3 items-start">
                          <span
                            className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: tool.accent }}
                          >
                            {i + 1}
                          </span>
                          <span className="text-sm text-gray-800 leading-snug">
                            <span className="font-bold text-[#0A1230]">
                              {s.kind === "checkpoint"
                                ? tStr(
                                    s.human ?? { en: "Human checkpoint", ar: "نقطة بشرية", tr: "İnsan kontrol noktası" },
                                    lang,
                                  )
                                : tStr(agentNameById(s.agentId ?? ""), lang)}
                            </span>{" "}
                            — {tStr(s.label, lang)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* KPI impact */}
      {scenario && scenario.kpis.length > 0 && (
        <section className="py-14 bg-[#F8F9FA] border-y border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-start gap-3 mb-8">
              <div className="w-9 h-9 rounded-lg bg-[#8A5BD6]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Target size={16} className="text-[#8A5BD6]" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8A5BD6] mb-1">
                  {tStr(COPY.kpisTitle, lang)}
                </p>
                <p className="text-base text-gray-700 leading-relaxed max-w-3xl">
                  {tStr(COPY.kpisKicker, lang)}
                </p>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#0A1230] text-white">
                  <tr>
                    <th className="text-start rtl:text-right px-5 py-3 font-bold text-xs uppercase tracking-widest">
                      {tStr({ en: "Metric", ar: "المؤشر", tr: "Metrik" }, lang)}
                    </th>
                    <th className="text-start rtl:text-right px-5 py-3 font-bold text-xs uppercase tracking-widest">
                      {tStr(COPY.kpiBaseline, lang)}
                    </th>
                    <th className="text-start rtl:text-right px-5 py-3 font-bold text-xs uppercase tracking-widest">
                      {tStr(COPY.kpiSource, lang)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.kpis.map((k, i) => (
                    <tr
                      key={k.id}
                      className={i % 2 === 0 ? "bg-white" : "bg-[#FBFCFD]"}
                    >
                      <td className="px-5 py-4 font-semibold text-[#0A1230] align-top">
                        {tStr(k.label, lang)}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className="inline-block px-2.5 py-1 rounded-md font-bold text-sm"
                          style={{
                            backgroundColor: tool.accent + "1A",
                            color: tool.accent,
                          }}
                        >
                          {k.initial}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-600 italic align-top">
                        {k.source ? tStr(k.source, lang) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Data model */}
      <section className="py-14 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.dataTitle, lang)}
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {(
              [
                { label: COPY.inputs, items: tool.dataModel.inputs, color: "#5B7CFF" },
                { label: COPY.internal, items: tool.dataModel.internal, color: tool.accent },
                { label: COPY.outputs, items: tool.dataModel.outputs, color: "#8A5BD6" },
              ] as const
            ).map((col) => (
              <div key={col.label.en} className="rounded-2xl border border-gray-100 p-6">
                <p
                  className="text-[11px] font-bold uppercase tracking-widest mb-4"
                  style={{ color: col.color }}
                >
                  {tStr(col.label, lang)}
                </p>
                <ul className="space-y-3">
                  {col.items.map((item, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span
                        className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                        style={{ background: col.color }}
                      />
                      <span className="text-sm text-gray-700 leading-relaxed">
                        {tStr(item, lang)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Launch CTA — single demo */}
      {hasScenario && !tool.demoVariants?.length && (
        <section className="py-16 bg-gradient-to-br from-[#0A1230] to-[#5B7CFF]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-3">
              {tStr({ en: "Try it now", ar: "جرّبها الآن", tr: "Şimdi deneyin" }, lang)}
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
              {tStr(COPY.launchTitle, lang)}
            </h2>
            <p className="text-base text-gray-200 leading-relaxed max-w-2xl mx-auto mb-6">
              {tStr(COPY.launchBody, lang)}
            </p>
            <Link
              href={`/demo/${tool.slug}`}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#C45BB8] text-[#0A1230] font-bold text-base hover:bg-[#FFC15E] transition-colors"
            >
              <Play size={16} fill="currentColor" />
              {tStr(COPY.launchCta, lang)}
            </Link>
          </div>
        </section>
      )}

      {/* Launch CTA — multi-variant demos */}
      {tool.demoVariants && tool.demoVariants.length > 0 && (
        <section className="py-16 bg-gradient-to-br from-[#0A1230] to-[#5B7CFF]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-3">
                {tStr({ en: "Choose your experience", ar: "اختر تجربتك", tr: "Deneyiminizi seçin" }, lang)}
              </p>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3">
                {tStr({ en: "Three demos, three perspectives", ar: "ثلاثة عروض، ثلاث وجهات نظر", tr: "Üç demo, üç bakış açısı" }, lang)}
              </h2>
              <p className="text-base text-gray-300 max-w-2xl mx-auto">
                {tStr({ en: "Each demo shows the same platform from a different stakeholder's view.", ar: "كل عرض يُظهر المنصة نفسها من منظور صاحب مصلحة مختلف.", tr: "Her demo aynı platformu farklı bir paydaşın bakış açısından gösterir." }, lang)}
              </p>
            </div>
            <div className={`grid gap-5 ${tool.demoVariants.length === 3 ? "sm:grid-cols-3" : tool.demoVariants.length === 2 ? "sm:grid-cols-2" : ""}`}>
              {tool.demoVariants.map((v) => {
                const VIcon = ICONS[v.icon] ?? Play;
                return (
                  <Link
                    key={v.id}
                    href={`/demo/${tool.slug}/${v.route}`}
                    className="group relative p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: tool.accent }}>
                        <VIcon size={20} className="text-white" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8]">
                        {tStr(v.audience, lang)}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white">{tStr(v.label, lang)}</h3>
                    <p className="text-sm text-gray-300 leading-relaxed flex-1">{tStr(v.description, lang)}</p>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#C45BB8] mt-2 group-hover:gap-3 transition-all">
                      <Play size={12} fill="currentColor" />
                      {tStr({ en: "Launch demo", ar: "ابدأ العرض", tr: "Demoyu başlat" }, lang)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Service / assessment CTAs */}
      <section className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-2 gap-5">
          <Link
            href={`/contact?topic=${tool.slug}`}
            className="group p-6 bg-[#F8F9FA] hover:bg-[#EAEEF1] border border-gray-200 rounded-2xl transition-colors flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8]">
              {tStr({ en: "Engage", ar: "ابدأ" }, lang)}
            </span>
            <span className="text-lg font-bold text-[#0A1230]">{tStr(COPY.ctaPartner, lang)}</span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B7CFF] mt-2">
              {tStr({ en: "Open contact form", ar: "افتح نموذج التواصل" }, lang)}
              <ArrowRight size={14} className="rtl:rotate-180" />
            </span>
          </Link>

          {relatedService ? (
            <Link
              href={`/services/${relatedService.slug}`}
              className="group p-6 bg-[#F8F9FA] hover:bg-[#EAEEF1] border border-gray-200 rounded-2xl transition-colors flex flex-col gap-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8]">
                {tStr(COPY.ctaService, lang)}
              </span>
              <span className="text-lg font-bold text-[#0A1230]">{relatedService.title}</span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B7CFF] mt-2">
                {tStr({ en: "Read service brief", ar: "اقرأ موجز الخدمة" }, lang)}
                <ArrowRight size={14} className="rtl:rotate-180" />
              </span>
            </Link>
          ) : (
            <Link
              href="/services"
              className="group p-6 bg-[#F8F9FA] hover:bg-[#EAEEF1] border border-gray-200 rounded-2xl transition-colors flex flex-col gap-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8]">
                {tStr({ en: "Services", ar: "الخدمات" }, lang)}
              </span>
              <span className="text-lg font-bold text-[#0A1230]">
                {tStr({ en: "Explore Cognirise services", ar: "استعرض خدمات Cognirise" }, lang)}
              </span>
            </Link>
          )}

          {relatedAssessment && (
            <Link
              href={`/assessments/${relatedAssessment.slug}`}
              className="group p-6 bg-[#C45BB8] hover:bg-[#FFC15E] rounded-2xl transition-colors flex flex-col gap-2 sm:col-span-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">
                {tStr(COPY.ctaAssessment, lang)}
              </span>
              <span className="text-lg font-bold text-white">
                {relatedAssessment.code} — {relatedAssessment.name}
              </span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-white mt-2">
                {tStr({ en: "Run the diagnostic", ar: "شغّل التشخيص" }, lang)}
                <ArrowRight size={14} className="rtl:rotate-180" />
              </span>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
