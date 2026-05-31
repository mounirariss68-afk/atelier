import type { AssessmentDefinition } from "./types";

export const ari: AssessmentDefinition = {
  slug: "ari",
  serviceSlug: "agentic-ai-transformation",
  code: "ARI",
  brandColor: "#156082",
  estMinutes: 12,
  title: { en: "Agentic Readiness Index", ar: "مؤشر الجاهزية الوكيلية", tr: "Ajansal Hazırlık Endeksi" },
  subtitle: {
    en: "How ready is your enterprise to put AI agents into production?",
    ar: "ما مدى جاهزية مؤسستك لنشر وكلاء الذكاء الاصطناعي في الإنتاج؟",
    tr: "Kurumunuz AI ajanlarını üretime almaya ne kadar hazır?",
  },
  description: {
    en: "Benchmark your organization across the seven capabilities that separate the 2% of GCC enterprises operating agents at scale from the rest.",
    ar: "قارن مؤسستك عبر القدرات السبع التي تميّز نسبة الـ 2% من شركات الخليج المشغّلة للوكلاء على نطاق واسع.",
    tr: "Kurumunuzu, ajanları geniş ölçekte işleten %2'lik GCC kuruluşunu diğerlerinden ayıran yedi yetenek üzerinden kıyaslayın.",
  },
  memoPromptHint:
    "Frame the memo around agentic operating-model readiness. Reference the 2%-at-scale stat and Gartner's 40%-cancellation finding when relevant.",
  antiVendor: {
    en: [
      "If your priority is full-stack ERP replacement, talk to Accenture or Wipro — that is not our practice.",
      "If you need a country-wide outsourced contact center transition, an offshore BPO partner will outprice us.",
      "If your sponsor demands a 200-page strategy deck before any working software, a Big-4 advisory will fit better.",
    ],
    ar: [
      "إذا كانت أولويتك استبدال نظام ERP بالكامل، فإن أكسنتشر أو ويبرو هي الجهة المناسبة لك.",
      "إذا كنت بحاجة إلى نقل مركز اتصالات بحجم وطني عبر الإسناد الخارجي، فإن شريك BPO سيتفوق علينا في السعر.",
      "إذا كان الراعي يطلب عرضاً استراتيجياً من 200 صفحة قبل أي برنامج عامل، فإن استشارات Big-4 ستكون الأنسب.",
    ],
    tr: [
      "Önceliğiniz tam yığın ERP değişimi ise, Accenture veya Wipro ile görüşün — bu bizim uzmanlık alanımız değildir.",
      "Ülke çapında dış kaynaklı bir iletişim merkezi geçişine ihtiyacınız varsa, yurt dışı bir BPO ortağı bizden daha düşük fiyat verecektir.",
      "Sponsorunuz çalışan herhangi bir yazılımdan önce 200 sayfalık bir strateji sunumu istiyorsa, bir Big-4 danışmanlığı daha uygun olacaktır.",
    ],
  },
  dimensions: [
    {
      id: "strategy",
      title: { en: "Strategy, Operating Model & Sponsorship", ar: "الاستراتيجية ونموذج التشغيل والرعاية", tr: "Strateji, İşletim Modeli ve Sponsorluk" },
      weight: 0.15,
      description: {
        en: "Is agentic AI a CEO-sponsored, P&L-owned program — or a side project of the CIO?",
        ar: "هل الذكاء الاصطناعي الوكيلي برنامج يرعاه الرئيس التنفيذي ومسؤول عنه في حساب الأرباح والخسائر — أم مشروع جانبي لرئيس تقنية المعلومات؟",
        tr: "Ajansal AI, CEO sponsorluğunda P&L sahipli bir program mı — yoksa CIO'nun yan projesi mi?",
      },
      questions: [
        {
          id: "ari.s1",
          prompt: { en: "Which best describes your agentic AI sponsorship today?", ar: "أيٌّ من التالي يصف أفضل رعاية الذكاء الاصطناعي الوكيلي لديكم اليوم؟", tr: "Bugün ajansal AI sponsorluğunuzu en iyi hangisi tanımlıyor?" },
          options: [
            { id: "a", label: { en: "No formal sponsor; experiments live inside individual functions.", ar: "لا يوجد راعٍ رسمي؛ التجارب داخل الوظائف الفردية.", tr: "Resmi sponsor yok; deneyler bireysel fonksiyonların içinde yaşıyor." }, score: 1 },
            { id: "b", label: { en: "CIO/CTO sponsors AI broadly; agents are not differentiated.", ar: "يرعى رئيس التقنية الذكاء الاصطناعي بشكل عام؛ لا تمييز للوكلاء.", tr: "CIO/CTO genel olarak AI'yı destekliyor; ajanlar farklılaştırılmamış." }, score: 2 },
            { id: "c", label: { en: "A named executive owns agentic AI but without P&L authority.", ar: "هناك تنفيذي مسمى يقود الوكلاء لكن دون صلاحية حساب الأرباح والخسائر.", tr: "Adı belirlenmiş bir yönetici ajansal AI'ya sahip ancak P&L yetkisi yok." }, score: 3 },
            { id: "d", label: { en: "P&L-owning business head co-sponsors with the CIO and reports outcomes quarterly.", ar: "قائد أعمال مسؤول عن حساب الأرباح والخسائر يرعى مع رئيس التقنية ويعرض النتائج كل ربع.", tr: "P&L sahibi iş başkanı CIO ile birlikte sponsor oluyor ve sonuçları üç ayda bir raporluyor." }, score: 4 },
            { id: "e", label: { en: "CEO-sponsored agentic transformation with board-level KPIs and dedicated funding.", ar: "تحول وكيلي يرعاه الرئيس التنفيذي مع مؤشرات على مستوى المجلس وتمويل مخصص.", tr: "Yönetim kurulu düzeyinde KPI'lar ve özel finansmanla CEO sponsorluğunda ajansal dönüşüm." }, score: 5 },
          ],
        },
        {
          id: "ari.s2",
          prompt: { en: "How clearly is value defined for your agentic initiatives?", ar: "ما مدى وضوح القيمة لمبادرات الوكلاء لديكم؟", tr: "Ajansal girişimleriniz için değer ne kadar net tanımlanmış?" },
          options: [
            { id: "a", label: { en: "Value is described qualitatively (productivity, innovation).", ar: "القيمة موصوفة نوعياً (إنتاجية، ابتكار).", tr: "Değer nitel olarak tanımlanır (verimlilik, inovasyon)." }, score: 1 },
            { id: "b", label: { en: "We track output metrics (tickets resolved, lines of code).", ar: "نتابع مقاييس المخرجات (عدد التذاكر، أسطر الكود).", tr: "Çıktı metriklerini takip ediyoruz (çözülen biletler, kod satırları)." }, score: 2 },
            { id: "c", label: { en: "We tie agents to specific operational KPIs per use case.", ar: "نربط الوكلاء بمؤشرات تشغيلية لكل حالة استخدام.", tr: "Ajanları her kullanım senaryosu için belirli operasyonel KPI'lara bağlıyoruz." }, score: 3 },
            { id: "d", label: { en: "Each production agent has a financial business case with attribution.", ar: "كل وكيل إنتاجي له حالة عمل مالية مع نسب أداء.", tr: "Her üretim ajanının atıflı bir finansal iş senaryosu var." }, score: 4 },
            { id: "e", label: { en: "Board-reviewed value tracker links every agent to enterprise EBIT or risk reduction.", ar: "متابع قيمة على مستوى المجلس يربط كل وكيل بأرباح المؤسسة أو خفض المخاطر.", tr: "Yönetim kurulu tarafından incelenen değer izleyici her ajanı kurumsal EBIT veya risk azaltımına bağlar." }, score: 5 },
          ],
        },
        {
          id: "ari.s3",
          prompt: { en: "How is agentic capability funded?", ar: "كيف يُموَّل بناء قدرات الوكلاء؟", tr: "Ajansal yetenek nasıl finanse ediliyor?" },
          options: [
            { id: "a", label: { en: "Funded ad-hoc out of existing IT budget.", ar: "تمويل ظرفي من ميزانية تقنية المعلومات الحالية.", tr: "Mevcut BT bütçesinden ad-hoc finanse ediliyor." }, score: 1 },
            { id: "b", label: { en: "Annual capex line for AI generally, no agentic split.", ar: "بند رأسمالي سنوي للذكاء الاصطناعي عموماً دون تخصيص للوكلاء.", tr: "Genel olarak AI için yıllık capex hattı, ajansal ayrım yok." }, score: 2 },
            { id: "c", label: { en: "Dedicated agentic AI program budget renewed annually.", ar: "ميزانية مخصصة لبرنامج وكيلي تُجدد سنوياً.", tr: "Yıllık olarak yenilenen özel ajansal AI program bütçesi." }, score: 3 },
            { id: "d", label: { en: "Multi-year funded transformation with a venture-style stage gate.", ar: "تحول ممول لعدة سنوات مع بوابات تمويل مرحلية.", tr: "Girişim tarzı aşama kapısıyla çok yıllı finanse edilen dönüşüm." }, score: 4 },
            { id: "e", label: { en: "Outcome-based co-funding model with the business; reinvested savings.", ar: "نموذج تمويل مشترك مع الأعمال يقوم على النتائج وإعادة استثمار الوفورات.", tr: "İşletme ile sonuç tabanlı ortak finansman modeli; yeniden yatırılan tasarruflar." }, score: 5 },
          ],
        },
        {
          id: "ari.s4",
          prompt: { en: "How is your senior team aligned on what an 'AI agent' actually is?", ar: "ما مدى توافق الفريق التنفيذي على تعريف 'وكيل الذكاء الاصطناعي' فعلياً؟", tr: "Üst düzey ekibiniz 'AI ajanı'nın gerçekte ne olduğu konusunda nasıl hizalanmış?" },
          options: [
            { id: "a", label: { en: "Confused. Different leaders use the term differently.", ar: "غير متوافقين. يستخدم القادة المصطلح بطرق مختلفة.", tr: "Karışık. Farklı liderler terimi farklı kullanıyor." }, score: 1 },
            { id: "b", label: { en: "Some shared awareness; no formal taxonomy.", ar: "وعي مشترك جزئي؛ لا توجد تصنيفات رسمية.", tr: "Bir miktar paylaşılmış farkındalık; resmi taksonomi yok." }, score: 2 },
            { id: "c", label: { en: "Working definition published internally.", ar: "تعريف عملي منشور داخلياً.", tr: "Dahili olarak yayınlanmış çalışan tanım." }, score: 3 },
            { id: "d", label: { en: "Maturity-tier taxonomy used across architecture and business reviews.", ar: "تصنيف مستويات نضج مستخدم في مراجعات المعمارية والأعمال.", tr: "Mimari ve iş incelemelerinde kullanılan olgunluk seviyesi taksonomisi." }, score: 4 },
            { id: "e", label: { en: "Shared lexicon, governance posture, and operating playbook used at every level.", ar: "قاموس مشترك ونهج حوكمة ودليل تشغيل يُستخدم في كل المستويات.", tr: "Her düzeyde kullanılan paylaşılan sözlük, yönetişim duruşu ve işletim kılavuzu." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "process",
      title: { en: "Process Re-engineering Readiness", ar: "جاهزية إعادة هندسة العمليات", tr: "Süreç Yeniden Mühendislik Hazırlığı" },
      weight: 0.15,
      description: {
        en: "Gartner expects 40% of agentic projects to be cancelled by 2027 — overwhelmingly because the underlying processes were never re-engineered. How ready are yours?",
        ar: "تتوقع جارتنر إلغاء 40% من مشاريع الوكلاء بحلول 2027 — معظمها لأن العمليات الأساسية لم يُعَد تصميمها.",
        tr: "Gartner, 2027 yılına kadar ajansal projelerin %40'ının iptal edilmesini bekliyor — büyük ölçüde altta yatan süreçler hiç yeniden tasarlanmadığı için. Sizinkiler ne kadar hazır?",
      },
      questions: [
        {
          id: "ari.p1",
          prompt: { en: "How are processes currently selected for agentic automation?", ar: "كيف يتم حالياً اختيار العمليات للأتمتة الوكيلية؟", tr: "Şu anda ajansal otomasyon için süreçler nasıl seçiliyor?" },
          options: [
            { id: "a", label: { en: "Chosen opportunistically by individual teams.", ar: "تختارها الفرق بشكل ظرفي.", tr: "Bireysel ekipler tarafından fırsatçı bir şekilde seçilir." }, score: 1 },
            { id: "b", label: { en: "Selected via a use-case backlog, prioritized by sponsor demand.", ar: "تُختار عبر قائمة استخدامات حسب طلب الراعي.", tr: "Sponsor talebine göre önceliklendirilmiş bir kullanım senaryosu birikiminden seçilir." }, score: 2 },
            { id: "c", label: { en: "Filtered against a value/feasibility scoring framework.", ar: "تُنقّى عبر إطار تقييم للقيمة والجدوى.", tr: "Değer/uygulanabilirlik puanlama çerçevesine göre filtrelenir." }, score: 3 },
            { id: "d", label: { en: "Process mining + value mapping identifies highest-leverage flows first.", ar: "تعدين العمليات وخرائط القيمة تحدد التدفقات الأعلى رافعة أولاً.", tr: "Süreç madenciliği + değer haritalama önce en yüksek kaldıraçlı akışları belirler." }, score: 4 },
            { id: "e", label: { en: "Continuous portfolio steering with kill criteria and reinvestment rules.", ar: "توجيه مستمر للمحفظة مع معايير إيقاف وقواعد إعادة استثمار.", tr: "Durdurma kriterleri ve yeniden yatırım kurallarıyla sürekli portföy yönlendirme." }, score: 5 },
          ],
        },
        {
          id: "ari.p2",
          prompt: { en: "When deploying an agent, how is the underlying process treated?", ar: "عند نشر وكيل، كيف تُعامل العملية الأساسية؟", tr: "Bir ajan dağıtırken, altta yatan süreç nasıl ele alınır?" },
          options: [
            { id: "a", label: { en: "Left as-is; agent automates the existing steps.", ar: "تُترك كما هي؛ يقوم الوكيل بأتمتة الخطوات الحالية.", tr: "Olduğu gibi bırakılır; ajan mevcut adımları otomatikleştirir." }, score: 1 },
            { id: "b", label: { en: "Minor tweaks; we trust the legacy SOP.", ar: "تعديلات بسيطة؛ نثق بإجراءات التشغيل القديمة.", tr: "Küçük ince ayarlar; eski SOP'ye güveniyoruz." }, score: 2 },
            { id: "c", label: { en: "Process simplified before automation.", ar: "تُبسَّط العملية قبل الأتمتة.", tr: "Otomasyondan önce süreç basitleştirilir." }, score: 3 },
            { id: "d", label: { en: "End-to-end value stream redesign before agent build.", ar: "إعادة تصميم سلسلة القيمة الكاملة قبل بناء الوكيل.", tr: "Ajan inşasından önce uçtan uca değer akışı yeniden tasarımı." }, score: 4 },
            { id: "e", label: { en: "Process designed agent-first; humans handle exception handling only.", ar: "تصمَّم العملية وفق منطق الوكيل أولاً؛ ويتدخل البشر للاستثناءات فقط.", tr: "Süreç ajan-öncelikli tasarlanır; insanlar yalnızca istisna işlemeyi yürütür." }, score: 5 },
          ],
        },
        {
          id: "ari.p3",
          prompt: { en: "Who owns process change after an agent goes live?", ar: "من يملك تغيير العمليات بعد إطلاق الوكيل؟", tr: "Bir ajan yayına girdikten sonra süreç değişikliğine kim sahip?" },
          options: [
            { id: "a", label: { en: "No one is formally responsible.", ar: "لا أحد مسؤول رسمياً.", tr: "Resmi olarak kimse sorumlu değil." }, score: 1 },
            { id: "b", label: { en: "The IT/AI team handles it on a best-effort basis.", ar: "يتولاها فريق التقنية/الذكاء الاصطناعي بأفضل جهد.", tr: "BT/AI ekibi en iyi çaba bazında ele alır." }, score: 2 },
            { id: "c", label: { en: "Process owners exist for major flows.", ar: "يوجد ملاك عمليات للتدفقات الرئيسية.", tr: "Önemli akışlar için süreç sahipleri vardır." }, score: 3 },
            { id: "d", label: { en: "Cross-functional pods own outcomes including the process.", ar: "فرق متعددة الوظائف تملك النتائج بما في ذلك العملية.", tr: "Çapraz işlevli ekipler süreç dahil sonuçlara sahiptir." }, score: 4 },
            { id: "e", label: { en: "BizOps + product teams continuously evolve agentic flows in production.", ar: "فرق العمليات والمنتج تطوّر تدفقات الوكلاء باستمرار في الإنتاج.", tr: "BizOps + ürün ekipleri üretimde ajansal akışları sürekli geliştirir." }, score: 5 },
          ],
        },
        {
          id: "ari.p4",
          prompt: { en: "How are operating-model implications captured before launch?", ar: "كيف تُلتقط تبعات نموذج التشغيل قبل الإطلاق؟", tr: "İşletim modeli etkileri lansmandan önce nasıl yakalanır?" },
          options: [
            { id: "a", label: { en: "Not at all. We focus on the model and tools.", ar: "لا تُلتقط. نركّز على النموذج والأدوات.", tr: "Hiç değil. Modele ve araçlara odaklanıyoruz." }, score: 1 },
            { id: "b", label: { en: "Loose change-management conversation pre-go-live.", ar: "نقاش غير منظم لإدارة التغيير قبل الإطلاق.", tr: "Yayına geçmeden önce gevşek değişim yönetimi sohbeti." }, score: 2 },
            { id: "c", label: { en: "RACI updated; some training delivered.", ar: "تحديث RACI وتقديم بعض التدريب.", tr: "RACI güncellendi; bazı eğitimler verildi." }, score: 3 },
            { id: "d", label: { en: "Operating-model blueprint produced and signed off pre-launch.", ar: "إصدار مخطط نموذج تشغيل واعتماده قبل الإطلاق.", tr: "Lansman öncesi işletim modeli planı üretildi ve onaylandı." }, score: 4 },
            { id: "e", label: { en: "Operating-model and workforce plan revised quarterly with each release.", ar: "تحديث نموذج التشغيل وخطة القوى العاملة كل ربع مع كل إصدار.", tr: "İşletim modeli ve iş gücü planı her sürümle birlikte üç ayda bir revize edilir." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "architecture",
      title: { en: "Agent Architecture, Orchestration & Tooling", ar: "بنية الوكلاء والتنسيق والأدوات", tr: "Ajan Mimarisi, Orkestrasyon ve Araçlar" },
      weight: 0.15,
      description: { en: "From zero formal stack to a multi-agent platform with policy-driven routing.", ar: "من غياب أي مكدس إلى منصة متعددة الوكلاء بتوجيه قائم على السياسات.", tr: "Sıfır resmi yığından politika odaklı yönlendirmeye sahip çok ajanlı bir platforma." },
      questions: [
        {
          id: "ari.a1",
          prompt: { en: "Which best describes your current agent orchestration approach?", ar: "أيٌّ من التالي يصف أفضل أسلوبكم في تنسيق الوكلاء؟", tr: "Mevcut ajan orkestrasyon yaklaşımınızı en iyi hangisi tanımlıyor?" },
          options: [
            { id: "a", label: { en: "We have not deployed any production agents.", ar: "لم ننشر أي وكلاء في الإنتاج.", tr: "Üretime herhangi bir ajan dağıtmadık." }, score: 1 },
            { id: "b", label: { en: "No-code copilots (Copilot Studio / ChatGPT Enterprise) without a formal orchestration layer.", ar: "أدوات بدون كود (Copilot Studio / ChatGPT Enterprise) دون طبقة تنسيق رسمية.", tr: "Resmi orkestrasyon katmanı olmadan kod gerektirmeyen yardımcılar (Copilot Studio / ChatGPT Enterprise)." }, score: 2 },
            { id: "c", label: { en: "One orchestration framework chosen (LangGraph, Bedrock Agents) but limited multi-agent patterns.", ar: "إطار تنسيق واحد مختار (LangGraph، Bedrock Agents) مع أنماط محدودة.", tr: "Bir orkestrasyon çerçevesi seçildi (LangGraph, Bedrock Agents) ancak sınırlı çoklu ajan kalıpları." }, score: 3 },
            { id: "d", label: { en: "Standardized orchestration stack with a tool/skill registry shared across teams.", ar: "مكدس تنسيق موحد مع سجل أدوات/مهارات مشترك بين الفرق.", tr: "Ekipler arasında paylaşılan araç/beceri kayıt defteriyle standartlaştırılmış orkestrasyon yığını." }, score: 4 },
            { id: "e", label: { en: "Multi-agent platform with policy-driven routing, evals, and reusable templates across BUs.", ar: "منصة متعددة الوكلاء مع توجيه قائم على السياسات وتقييمات وقوالب قابلة لإعادة الاستخدام.", tr: "İş birimleri arasında politika odaklı yönlendirme, değerlendirmeler ve yeniden kullanılabilir şablonlarla çok ajanlı platform." }, score: 5 },
          ],
        },
        {
          id: "ari.a2",
          prompt: { en: "How are tools/skills exposed to agents?", ar: "كيف تُتاح الأدوات/المهارات للوكلاء؟", tr: "Araçlar/beceriler ajanlara nasıl sunuluyor?" },
          options: [
            { id: "a", label: { en: "Hand-coded per agent, no reuse.", ar: "مكتوبة يدوياً لكل وكيل دون إعادة استخدام.", tr: "Her ajan için elle kodlanır, yeniden kullanım yok." }, score: 1 },
            { id: "b", label: { en: "Some shared utilities; no formal registry.", ar: "بعض الأدوات المشتركة دون سجل رسمي.", tr: "Bazı paylaşılan yardımcı programlar; resmi kayıt defteri yok." }, score: 2 },
            { id: "c", label: { en: "Tool catalog in a wiki; reused informally.", ar: "كتالوج أدوات في الويكي يُعاد استخدامه بشكل غير رسمي.", tr: "Wiki'de araç kataloğu; gayri resmi olarak yeniden kullanılır." }, score: 3 },
            { id: "d", label: { en: "Versioned tool registry with auth, observability, and SLAs.", ar: "سجل أدوات بإصدارات مع المصادقة والمراقبة واتفاقيات الخدمة.", tr: "Kimlik doğrulama, gözlemlenebilirlik ve SLA'lerle sürümlü araç kayıt defteri." }, score: 4 },
            { id: "e", label: { en: "Tool marketplace with discovery, governance, and chargeback.", ar: "سوق أدوات مع الاكتشاف والحوكمة وإعادة تحميل التكلفة.", tr: "Keşif, yönetişim ve geri yüklemeli araç pazarı." }, score: 5 },
          ],
        },
        {
          id: "ari.a3",
          prompt: { en: "Sovereign / on-prem capability for agentic workloads?", ar: "قدرة سيادية/داخلية لأحمال الوكلاء؟", tr: "Ajansal iş yükleri için egemen / şirket içi yetenek?" },
          options: [
            { id: "a", label: { en: "Public cloud only; no sovereign option.", ar: "سحابة عامة فقط؛ لا يوجد خيار سيادي.", tr: "Yalnızca genel bulut; egemen seçenek yok." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Considering sovereign but no live capability.", ar: "ندرس الخيار السيادي لكن لا توجد قدرة فعلية.", tr: "Egemenlik düşünülüyor ancak canlı yetenek yok." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Hybrid posture; some inference on sovereign cloud.", ar: "وضع هجين؛ بعض الاستدلال على السحابة السيادية.", tr: "Hibrit duruş; egemen bulutta bir miktar çıkarım." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Production agents running on sovereign cloud with policy controls.", ar: "وكلاء إنتاج يعملون على السحابة السيادية مع ضوابط سياسية.", tr: "Politika kontrolleriyle egemen bulutta çalışan üretim ajanları." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Full sovereign & on-prem capability with multi-region failover.", ar: "قدرة سيادية وداخلية كاملة مع تجاوز فشل متعدد المناطق.", tr: "Çok bölgeli yedekleme ile tam egemen ve şirket içi yetenek." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.a4",
          prompt: { en: "Choice of model providers / inference stack?", ar: "اختيار مزودي النماذج/مكدس الاستدلال؟", tr: "Model sağlayıcı / çıkarım yığını seçimi?" },
          options: [
            { id: "a", label: { en: "Single vendor lock-in (e.g., one hyperscaler).", ar: "ارتباط بمزود واحد (مثل سحابة كبرى واحدة).", tr: "Tek tedarikçiye bağımlılık (örn. bir hiperskaler)." }, score: 1 },
            { id: "b", label: { en: "One primary + one experimental.", ar: "مزود رئيسي وآخر تجريبي.", tr: "Bir birincil + bir deneysel." }, score: 2 },
            { id: "c", label: { en: "Multiple providers; routing decided per use case manually.", ar: "عدة مزودين؛ يدوياً يتم اختيار التوجيه لكل استخدام.", tr: "Birden fazla sağlayıcı; her kullanım senaryosu için yönlendirme manuel olarak kararlaştırılır." }, score: 3 },
            { id: "d", label: { en: "Abstracted via gateway with cost/perf-aware routing.", ar: "مجرد عبر بوابة مع توجيه يراعي التكلفة والأداء.", tr: "Maliyet/performans bilinçli yönlendirme ile ağ geçidi üzerinden soyutlanmış." }, score: 4 },
            { id: "e", label: { en: "Policy-driven gateway plus self-hosted open weights for sovereign workloads.", ar: "بوابة قائمة على السياسات بالإضافة إلى أوزان مفتوحة مستضافة ذاتياً للأحمال السيادية.", tr: "Politika odaklı ağ geçidi artı egemen iş yükleri için kendi kendine barındırılan açık ağırlıklar." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "data",
      title: { en: "Data, APIs & Knowledge Foundations", ar: "أساسات البيانات وواجهات البرمجة والمعرفة", tr: "Veri, API'ler ve Bilgi Temelleri" },
      weight: 0.15,
      description: { en: "Agents are only as good as the systems they can read, write to, and reason over.", ar: "قيمة الوكلاء بقدر الأنظمة التي يستطيعون قراءتها والكتابة فيها والاستدلال منها.", tr: "Ajanlar yalnızca okuyabildikleri, yazabildikleri ve üzerinde akıl yürütebildikleri sistemler kadar iyidir." },
      questions: [
        {
          id: "ari.d1",
          prompt: { en: "Coverage of systems-of-record by stable APIs?", ar: "تغطية أنظمة السجلات بواجهات برمجة مستقرة؟", tr: "Kayıt sistemlerinin kararlı API'lerle kapsamı?" },
          options: [
            { id: "a", label: { en: "<25% of core systems exposed.", ar: "أقل من 25% من الأنظمة الأساسية متاحة.", tr: "Çekirdek sistemlerin <%25'i açıkta." }, score: 1 },
            { id: "b", label: { en: "25–50% with mixed quality.", ar: "25–50% بجودة متفاوتة.", tr: "Karışık kaliteyle %25–50." }, score: 2 },
            { id: "c", label: { en: "50–75% with versioned APIs.", ar: "50–75% بواجهات مُصدَرة.", tr: "Sürümlü API'lerle %50–75." }, score: 3 },
            { id: "d", label: { en: ">75% with documented contracts.", ar: "أكثر من 75% بعقود موثقة.", tr: "Belgelenmiş sözleşmelerle >%75." }, score: 4 },
            { id: "e", label: { en: "Universal API/event coverage with discoverable contracts and SLAs.", ar: "تغطية شاملة لواجهات/أحداث مع عقود قابلة للاكتشاف واتفاقيات خدمة.", tr: "Keşfedilebilir sözleşmeler ve SLA'lerle evrensel API/olay kapsamı." }, score: 5 },
          ],
        },
        {
          id: "ari.d2",
          prompt: { en: "Knowledge bases for retrieval (RAG)?", ar: "قواعد المعرفة للاسترجاع المعزز (RAG)؟", tr: "Geri alma için bilgi tabanları (RAG)?" },
          options: [
            { id: "a", label: { en: "None. Agents rely on model parametric knowledge.", ar: "لا يوجد. يعتمد الوكلاء على معرفة النموذج فقط.", tr: "Yok. Ajanlar model parametrik bilgisine dayanır." }, score: 1 },
            { id: "b", label: { en: "Ad-hoc PDF/SharePoint indexing per project.", ar: "فهرسة ظرفية لـ PDF/SharePoint لكل مشروع.", tr: "Proje başına ad-hoc PDF/SharePoint indeksleme." }, score: 2 },
            { id: "c", label: { en: "Centralized vector store with ingestion pipelines.", ar: "مخزن متجهات مركزي مع أنابيب استيعاب.", tr: "Alım veri hatlarına sahip merkezi vektör deposu." }, score: 3 },
            { id: "d", label: { en: "Curated knowledge graph + structured + unstructured KBs.", ar: "رسم معرفي منسَّق مع قواعد منظمة وغير منظمة.", tr: "Düzenlenmiş bilgi grafiği + yapılandırılmış + yapılandırılmamış bilgi tabanları." }, score: 4 },
            { id: "e", label: { en: "Federated knowledge fabric with provenance, freshness SLAs, and Arabic NLP support.", ar: "نسيج معرفي اتحادي مع أصل المعلومة وتحديثات بمستوى خدمة ودعم لمعالجة اللغة العربية.", tr: "Köken, tazelik SLA'leri ve Arapça NLP desteği ile federe bilgi dokusu." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.d3",
          prompt: { en: "Arabic / multilingual NLP readiness for agents?", ar: "جاهزية معالجة العربية/متعددة اللغات للوكلاء؟", tr: "Ajanlar için Arapça / çok dilli NLP hazırlığı?" },
          options: [
            { id: "a", label: { en: "English only.", ar: "الإنجليزية فقط.", tr: "Yalnızca İngilizce." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Translated UIs; underlying agent works in English.", ar: "واجهات مترجمة؛ يعمل الوكيل أساساً بالإنجليزية.", tr: "Çevrilmiş arayüzler; altta yatan ajan İngilizce çalışır." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Arabic-capable models in pilot.", ar: "نماذج تدعم العربية في التجربة.", tr: "Pilotta Arapça destekli modeller." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Production Arabic-native agents for select journeys.", ar: "وكلاء عربية أصلية في الإنتاج لرحلات مختارة.", tr: "Seçili yolculuklar için üretim Arapça yerel ajanları." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Bilingual EN/AR-native agents across all customer & employee journeys.", ar: "وكلاء ثنائيو اللغة EN/AR لكل رحلات العملاء والموظفين.", tr: "Tüm müşteri ve çalışan yolculuklarında çift dilli EN/AR yerel ajanlar." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "people",
      title: { en: "Human-in-the-loop & Workforce Readiness", ar: "الإنسان في الحلقة وجاهزية القوى العاملة", tr: "İnsan-Döngüde ve İş Gücü Hazırlığı" },
      weight: 0.15,
      description: { en: "Agents change roles, span of control, and incentives — usually in that order.", ar: "تغيّر الوكلاء الأدوار ونطاق الإشراف والحوافز — عادةً بهذا الترتيب.", tr: "Ajanlar rolleri, kontrol kapsamını ve teşvikleri değiştirir — genellikle bu sırayla." },
      questions: [
        {
          id: "ari.h1",
          prompt: { en: "How is human oversight built into your agents?", ar: "كيف يُبنى الإشراف البشري داخل وكلائكم؟", tr: "İnsan denetimi ajanlarınıza nasıl entegre edilmiştir?" },
          options: [
            { id: "a", label: { en: "Not designed; humans review only when the agent fails.", ar: "غير مصمَّم؛ يتدخل البشر فقط عند فشل الوكيل.", tr: "Tasarlanmamış; insanlar yalnızca ajan başarısız olduğunda inceler." }, score: 1 },
            { id: "b", label: { en: "Manual sampling of outputs by team leads.", ar: "أخذ عينات يدوي من المخرجات من قبل قادة الفريق.", tr: "Ekip liderleri tarafından çıktıların manuel örneklemesi." }, score: 2 },
            { id: "c", label: { en: "Approval workflows for high-impact actions.", ar: "تدفقات موافقة للإجراءات عالية الأثر.", tr: "Yüksek etkili eylemler için onay iş akışları." }, score: 3 },
            { id: "d", label: { en: "Risk-tiered HITL policies with audit trails.", ar: "سياسات HITL مبنية على مستويات المخاطر مع سجلات تدقيق.", tr: "Denetim izleriyle risk katmanlı HITL politikaları." }, score: 4 },
            { id: "e", label: { en: "Adaptive autonomy: confidence + risk scoring decides when human reviews.", ar: "استقلالية تكيفية: نتيجة الثقة والمخاطر تحدد توقيت المراجعة البشرية.", tr: "Uyarlanabilir özerklik: güven + risk puanlaması insanın ne zaman inceleyeceğine karar verir." }, score: 5 },
          ],
        },
        {
          id: "ari.h2",
          prompt: { en: "Workforce re-skilling around agentic AI?", ar: "إعادة تأهيل القوى العاملة حول الوكلاء؟", tr: "Ajansal AI etrafında iş gücü yeniden becerilendirme?" },
          options: [
            { id: "a", label: { en: "None planned.", ar: "لا توجد خطط.", tr: "Planlanan yok." }, score: 1 },
            { id: "b", label: { en: "Awareness sessions and a few certifications.", ar: "جلسات توعية وبعض الشهادات.", tr: "Farkındalık oturumları ve birkaç sertifikasyon." }, score: 2 },
            { id: "c", label: { en: "Role-based learning paths underway.", ar: "مسارات تعلم حسب الدور قيد التنفيذ.", tr: "Role dayalı öğrenme yolları sürüyor." }, score: 3 },
            { id: "d", label: { en: "Funded reskilling program with measured uptake.", ar: "برنامج إعادة تأهيل ممول مع قياس التبني.", tr: "Ölçülmüş benimsemeyle finanse edilen yeniden becerilendirme programı." }, score: 4 },
            { id: "e", label: { en: "Strategic workforce plan including local talent (Saudization/Emiratization) tied to agent rollout.", ar: "خطة استراتيجية للقوى العاملة تشمل المواهب المحلية مرتبطة بإطلاق الوكلاء.", tr: "Ajan kullanıma sunumuna bağlı yerel yeteneği (Suudileşme/Emiratileşme) içeren stratejik iş gücü planı." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.h3",
          prompt: { en: "Frontline adoption posture for agents?", ar: "وضع تبني الوكلاء على خط المواجهة؟", tr: "Ajanlar için ön cephe benimseme duruşu?" },
          options: [
            { id: "a", label: { en: "Mostly skeptical / blocking.", ar: "في الغالب متشككون/معرقلون.", tr: "Çoğunlukla şüpheci / engelleyici." }, score: 1 },
            { id: "b", label: { en: "Curious but uncertain about job impact.", ar: "متحمسون لكن غير متأكدين من الأثر على الوظائف.", tr: "Meraklı ancak iş etkisi konusunda belirsiz." }, score: 2 },
            { id: "c", label: { en: "Selectively engaged; champions emerge.", ar: "اشتراك انتقائي؛ يظهر أبطال.", tr: "Seçici olarak katılımcı; şampiyonlar ortaya çıkıyor." }, score: 3 },
            { id: "d", label: { en: "Frontline co-designs with the agent team.", ar: "خط المواجهة يصمم بالاشتراك مع فريق الوكلاء.", tr: "Ön cephe ajan ekibiyle birlikte tasarlıyor." }, score: 4 },
            { id: "e", label: { en: "Frontline drives the backlog; agents are seen as a multiplier.", ar: "خط المواجهة يقود القائمة؛ الوكلاء يُعتبرون مضاعِفاً.", tr: "Ön cephe birikim listesini yönlendirir; ajanlar bir çarpan olarak görülür." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "responsible",
      title: { en: "Responsible AI, Guardrails & Evals", ar: "الذكاء الاصطناعي المسؤول والحواجز والتقييمات", tr: "Sorumlu AI, Korkuluklar ve Değerlendirmeler" },
      weight: 0.15,
      description: { en: "From ethics committee theatre to McKinsey-grade evals for the agentic world.", ar: "من مجرد لجان أخلاقيات إلى تقييمات بمستوى McKinsey للعالم الوكيلي.", tr: "Etik komitesi tiyatrosundan ajansal dünya için McKinsey düzeyinde değerlendirmelere." },
      questions: [
        {
          id: "ari.r1",
          prompt: { en: "How do you evaluate agent quality before promotion?", ar: "كيف تُقيِّمون جودة الوكيل قبل الترقية؟", tr: "Terfiden önce ajan kalitesini nasıl değerlendiriyorsunuz?" },
          options: [
            { id: "a", label: { en: "Manual demo to a stakeholder.", ar: "عرض يدوي للجهة المعنية.", tr: "Bir paydaşa manuel gösterim." }, score: 1 },
            { id: "b", label: { en: "Spot-checks of outputs.", ar: "فحوص عشوائية للمخرجات.", tr: "Çıktıların noktasal kontrolleri." }, score: 2 },
            { id: "c", label: { en: "Static eval set per use case.", ar: "مجموعة تقييم ثابتة لكل استخدام.", tr: "Kullanım senaryosu başına statik değerlendirme seti." }, score: 3 },
            { id: "d", label: { en: "Continuous evals + regression tests in CI.", ar: "تقييمات مستمرة واختبارات تراجع في CI.", tr: "CI'da sürekli değerlendirmeler + regresyon testleri." }, score: 4 },
            { id: "e", label: { en: "Multi-dimensional evals: task success, faithfulness, safety, cost — gated promotions.", ar: "تقييمات متعددة الأبعاد: نجاح المهمة، الإخلاص، السلامة، التكلفة — مع بوابات ترقية.", tr: "Çok boyutlu değerlendirmeler: görev başarısı, doğruluk, güvenlik, maliyet — kapılı terfiler." }, score: 5 },
          ],
        },
        {
          id: "ari.r2",
          prompt: { en: "Guardrails on agent behavior in production?", ar: "حواجز سلوك الوكيل في الإنتاج؟", tr: "Üretimdeki ajan davranışı üzerinde korkuluklar?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا توجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Prompt-level instructions only.", ar: "تعليمات على مستوى الأمر فقط.", tr: "Yalnızca prompt düzeyinde talimatlar." }, score: 2 },
            { id: "c", label: { en: "Input/output filters and basic classifiers.", ar: "فلاتر للمدخلات/المخرجات ومصنفات أساسية.", tr: "Giriş/çıkış filtreleri ve temel sınıflandırıcılar." }, score: 3 },
            { id: "d", label: { en: "Policy engine + tool-level allowlists + redaction.", ar: "محرك سياسات + قوائم سماح للأدوات + إخفاء.", tr: "Politika motoru + araç düzeyinde izin listeleri + yeniden düzenleme." }, score: 4 },
            { id: "e", label: { en: "End-to-end policy enforcement with PDPL/SAMA/CBUAE-aware controls.", ar: "تطبيق سياسات شامل مع ضوابط واعية بـ PDPL/SAMA/CBUAE.", tr: "PDPL/SAMA/CBUAE bilinçli kontrollerle uçtan uca politika uygulaması." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.r3",
          prompt: { en: "Compliance posture vs. SDAIA/PDPL/SAMA/CBUAE?", ar: "وضع الامتثال مقابل SDAIA/PDPL/SAMA/CBUAE؟", tr: "SDAIA/PDPL/SAMA/CBUAE karşısında uyum duruşu?" },
          options: [
            { id: "a", label: { en: "Not formally addressed.", ar: "غير معالج رسمياً.", tr: "Resmi olarak ele alınmamış." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Awareness; gap analysis pending.", ar: "وعي؛ تحليل الفجوات قيد الانتظار.", tr: "Farkındalık; boşluk analizi bekliyor." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Gap analysis complete; remediation underway.", ar: "تحليل الفجوات مكتمل؛ المعالجة جارية.", tr: "Boşluk analizi tamamlandı; iyileştirme sürüyor." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Controls implemented and audited annually.", ar: "ضوابط مطبَّقة ومراجَعة سنوياً.", tr: "Kontroller uygulanmış ve yıllık olarak denetlenmiş." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Continuous compliance with attestation evidence per release.", ar: "امتثال مستمر مع أدلة شهادات لكل إصدار.", tr: "Her sürüm için tasdik kanıtıyla sürekli uyum." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "scale",
      title: { en: "Operational Scale, FinOps & Value Realization", ar: "النطاق التشغيلي والمالية والتحقق من القيمة", tr: "Operasyonel Ölçek, FinOps ve Değer Gerçekleştirme" },
      weight: 0.10,
      description: { en: "Only 2% of GCC enterprises run agents at scale. Are you in or out?", ar: "فقط 2% من شركات الخليج تشغل الوكلاء على نطاق واسع. هل أنتم منهم؟", tr: "GCC kuruluşlarının yalnızca %2'si ajanları geniş ölçekte çalıştırır. İçeride misiniz, dışarıda mı?" },
      questions: [
        {
          id: "ari.o1",
          prompt: { en: "How many agents are in true production today?", ar: "كم عدد الوكلاء في الإنتاج الفعلي اليوم؟", tr: "Bugün gerçek üretimde kaç ajan var?" },
          options: [
            { id: "a", label: { en: "Zero. All experiments.", ar: "صفر. كلها تجارب.", tr: "Sıfır. Hepsi deneme." }, score: 1 },
            { id: "b", label: { en: "1–2 in pilot mode.", ar: "1–2 في وضع تجريبي.", tr: "Pilot modda 1–2." }, score: 2 },
            { id: "c", label: { en: "3–5 in production with limited scope.", ar: "3–5 في الإنتاج بنطاق محدود.", tr: "Sınırlı kapsamlı üretimde 3–5." }, score: 3 },
            { id: "d", label: { en: "5–15 in production with measurable outcomes.", ar: "5–15 في الإنتاج بنتائج قابلة للقياس.", tr: "Ölçülebilir sonuçlarla üretimde 5–15." }, score: 4 },
            { id: "e", label: { en: "15+ enterprise-wide agents with consolidated value tracking.", ar: "أكثر من 15 وكيل على مستوى المؤسسة مع تتبع قيمة موحد.", tr: "Konsolide değer izleme ile 15+ kurumsal ajan." }, score: 5 },
          ],
          skipIf: undefined,
        },
        {
          id: "ari.o2",
          prompt: { en: "FinOps maturity for agentic workloads?", ar: "نضج المالية التشغيلية لأحمال الوكلاء؟", tr: "Ajansal iş yükleri için FinOps olgunluğu?" },
          options: [
            { id: "a", label: { en: "No visibility into per-agent cost.", ar: "لا توجد رؤية للتكلفة لكل وكيل.", tr: "Ajan başına maliyete görünürlük yok." }, score: 1 },
            { id: "b", label: { en: "Aggregate token spend monitored monthly.", ar: "إجمالي إنفاق الرموز يُراقب شهرياً.", tr: "Toplam token harcaması aylık olarak izleniyor." }, score: 2 },
            { id: "c", label: { en: "Per-team chargeback in place.", ar: "إعادة تحميل تكلفة لكل فريق.", tr: "Ekip başına geri yükleme mevcut." }, score: 3 },
            { id: "d", label: { en: "Per-agent unit economics tracked vs. value delivered.", ar: "اقتصاديات وحدة لكل وكيل تُتابع مقابل القيمة.", tr: "Sağlanan değere karşı ajan başına birim ekonomi izleniyor." }, score: 4 },
            { id: "e", label: { en: "Real-time cost-aware routing with automated cost controls.", ar: "توجيه واعٍ بالتكلفة في الوقت الحقيقي مع ضوابط آلية.", tr: "Otomatik maliyet kontrolleriyle gerçek zamanlı maliyet bilinçli yönlendirme." }, score: 5 },
          ],
          skipIf: { questionId: "ari.o1", optionIds: ["a"] },
        },
        {
          id: "ari.o3",
          prompt: { en: "How do you measure realized value from agents?", ar: "كيف تقيسون القيمة المحققة من الوكلاء؟", tr: "Ajanlardan elde edilen gerçek değeri nasıl ölçüyorsunuz?" },
          options: [
            { id: "a", label: { en: "We don't.", ar: "لا نقيس.", tr: "Ölçmüyoruz." }, score: 1 },
            { id: "b", label: { en: "Anecdotal stories.", ar: "حكايات.", tr: "Anekdotsal hikayeler." }, score: 2 },
            { id: "c", label: { en: "Productivity metrics per use case.", ar: "مقاييس إنتاجية لكل حالة استخدام.", tr: "Kullanım senaryosu başına verimlilik metrikleri." }, score: 3 },
            { id: "d", label: { en: "EBIT/risk-reduction attribution per agent.", ar: "نسب أرباح/خفض مخاطر لكل وكيل.", tr: "Ajan başına EBIT/risk azaltma atfı." }, score: 4 },
            { id: "e", label: { en: "Board-level value tracker with 3rd-party attestation.", ar: "متابع قيمة على مستوى المجلس مع تصديق طرف ثالث.", tr: "3. taraf tasdiki ile yönetim kurulu düzeyinde değer izleyici." }, score: 5 },
          ],
          skipIf: { questionId: "ari.o1", optionIds: ["a"] },
        },
      ],
    },
  ],
  recommendations: {
    strategy: {
      Nascent: {
        quickWins90d: [
          { en: "Name a single executive sponsor with P&L authority for one agentic use case.", ar: "تسمية راعٍ تنفيذي واحد بصلاحية حساب الأرباح والخسائر لاستخدام وكيلي واحد.", tr: "Bir ajansal kullanım senaryosu için P&L yetkisine sahip tek bir yönetici sponsor adlandırın." },
          { en: "Run a 2-week value-case sprint to quantify the business outcome of one agent.", ar: "تشغيل سباق حالة قيمة لمدة أسبوعين لقياس النتيجة لوكيل واحد.", tr: "Bir ajanın iş sonucunu ölçmek için 2 haftalık bir değer-senaryosu sprinti yürütün." },
        ],
        roadmap6m: [
          { en: "Stand up a cross-functional agentic council (CEO + CIO + CFO + business head).", ar: "تأسيس مجلس وكيلي متعدد الوظائف (CEO + CIO + CFO + قائد أعمال).", tr: "Çapraz işlevli bir ajansal konsey kurun (CEO + CIO + CFO + iş başkanı)." },
          { en: "Publish an internal 'what is an agent' lexicon and maturity tier playbook.", ar: "نشر معجم داخلي لتعريف الوكيل ودليل لمستويات النضج.", tr: "Dahili bir 'ajan nedir' sözlüğü ve olgunluk katmanı kılavuzu yayımlayın." },
        ],
        strategic12m: [
          { en: "Embed agentic AI as a board-level KPI tied to enterprise EBIT impact.", ar: "تضمين الذكاء الاصطناعي الوكيلي كمؤشر على مستوى المجلس مرتبط بالأثر على أرباح المؤسسة.", tr: "Kurumsal EBIT etkisine bağlı yönetim kurulu düzeyinde bir KPI olarak ajansal AI'yı gömün." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Move from CIO-led to business-head co-sponsorship for the top 2 agentic programs.", ar: "الانتقال من قيادة CIO إلى رعاية مشتركة لأهم برنامجين وكيليين.", tr: "İlk 2 ajansal program için CIO liderliğinden iş başkanı ortak sponsorluğuna geçin." },
        ],
        roadmap6m: [
          { en: "Tie each production agent to a financial business case with attribution.", ar: "ربط كل وكيل إنتاجي بحالة عمل مالية ذات نسب أداء.", tr: "Her üretim ajanını atıflı bir finansal iş senaryosuna bağlayın." },
        ],
        strategic12m: [
          { en: "Refresh corporate strategy to make agentic operating model an explicit enterprise pillar.", ar: "تحديث الاستراتيجية المؤسسية لتجعل النموذج الوكيلي ركيزة صريحة.", tr: "Ajansal işletim modelini açık bir kurumsal sütun yapmak için kurumsal stratejiyi yenileyin." },
        ],
      },
      Established: {
        quickWins90d: [
          { en: "Add an outcome-based co-funding clause with the business for the next 2 agent releases.", ar: "إضافة بند تمويل مشترك قائم على النتائج للأعمال للإطلاقين القادمين.", tr: "Sonraki 2 ajan sürümü için iş ile sonuç tabanlı bir ortak finansman maddesi ekleyin." },
        ],
        roadmap6m: [
          { en: "Stand up an enterprise agentic value tracker reviewed by the executive committee monthly.", ar: "تأسيس متابع قيمة وكيلي مؤسسي تراجعه اللجنة التنفيذية شهرياً.", tr: "Yürütme komitesi tarafından aylık olarak gözden geçirilen kurumsal bir ajansal değer izleyici kurun." },
        ],
        strategic12m: [
          { en: "Position the firm as a regional agentic reference; pursue published case studies and Cognirise Verified status.", ar: "تموضع الشركة كمرجع وكيلي إقليمي؛ السعي لدراسات حالة منشورة وشهادة Cognirise Verified.", tr: "Firmayı bölgesel bir ajansal referans olarak konumlandırın; yayımlanmış vaka çalışmaları ve Cognirise Verified statüsünün peşinden gidin." },
        ],
      },
    },
    process: {
      Nascent: {
        quickWins90d: [
          { en: "Run process mining on one high-volume flow to identify agentic candidates.", ar: "تشغيل تعدين عمليات على تدفق عالي الحجم لتحديد المرشحين للوكلاء.", tr: "Ajansal adayları belirlemek için yüksek hacimli bir akışta süreç madenciliği yürütün." },
        ],
        roadmap6m: [
          { en: "Re-engineer 3 end-to-end value streams agent-first before next agent goes live.", ar: "إعادة هندسة 3 سلاسل قيمة شاملة بمنطق الوكيل أولاً قبل إطلاق الوكيل التالي.", tr: "Bir sonraki ajan yayına girmeden önce 3 uçtan uca değer akışını ajan-öncelikli yeniden mühendisleyin." },
        ],
        strategic12m: [
          { en: "Embed BizOps + product pods that own agentic flows in production end-to-end.", ar: "إنشاء فرق BizOps والمنتج تملك تدفقات الوكلاء في الإنتاج.", tr: "Üretimde uçtan uca ajansal akışlara sahip BizOps + ürün ekiplerini gömün." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Kill 3 agent pilots whose underlying processes were not redesigned.", ar: "إلغاء 3 تجارب وكلاء لم يُعَد تصميم عملياتها.", tr: "Altta yatan süreçleri yeniden tasarlanmamış 3 ajan pilotunu sonlandırın." },
        ],
        roadmap6m: [
          { en: "Adopt a 'no agent without process redesign' rule, enforced at intake.", ar: "اعتماد قاعدة 'لا وكيل بدون إعادة تصميم العملية' عند الاستلام.", tr: "Kabulde uygulanan bir 'süreç yeniden tasarımı olmadan ajan yok' kuralı benimseyin." },
        ],
        strategic12m: [
          { en: "Stand up a continuous portfolio steering function with kill criteria.", ar: "تأسيس وظيفة توجيه محفظة مستمرة بمعايير إيقاف.", tr: "Durdurma kriterleri ile sürekli bir portföy yönlendirme fonksiyonu kurun." },
        ],
      },
    },
    architecture: {
      Nascent: {
        quickWins90d: [
          { en: "Pick one orchestration framework (LangGraph, Bedrock Agents, or AI Refinery) and standardize.", ar: "اختر إطار تنسيق واحداً ووحّد عليه.", tr: "Bir orkestrasyon çerçevesi (LangGraph, Bedrock Agents veya AI Refinery) seçin ve standartlaştırın." },
        ],
        roadmap6m: [
          { en: "Build a versioned tool/skill registry with auth and observability.", ar: "بناء سجل أدوات بإصدارات مع المصادقة والمراقبة.", tr: "Kimlik doğrulama ve gözlemlenebilirlikle sürümlü bir araç/beceri kayıt defteri oluşturun." },
        ],
        strategic12m: [
          { en: "Stand up a multi-agent platform with policy-driven routing and a tool marketplace.", ar: "تأسيس منصة متعددة الوكلاء بتوجيه قائم على السياسات وسوق أدوات.", tr: "Politika odaklı yönlendirme ve bir araç pazarı ile çok ajanlı bir platform kurun." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Introduce a model gateway for cost/performance routing.", ar: "إدخال بوابة نموذج للتوجيه حسب التكلفة/الأداء.", tr: "Maliyet/performans yönlendirmesi için bir model ağ geçidi ekleyin." },
        ],
        roadmap6m: [
          { en: "Add sovereign-cloud or on-prem option for regulated workloads.", ar: "إضافة خيار سحابة سيادية أو داخلية للأحمال المنظمة.", tr: "Düzenlenmiş iş yükleri için egemen bulut veya şirket içi seçenek ekleyin." },
        ],
        strategic12m: [
          { en: "Operate self-hosted open-weight models alongside frontier APIs for sovereign workloads.", ar: "تشغيل نماذج مفتوحة الأوزان مستضافة ذاتياً إلى جانب واجهات APIs الحدودية.", tr: "Egemen iş yükleri için ön cephe API'lerinin yanı sıra kendi kendine barındırılan açık ağırlıklı modelleri işletin." },
        ],
      },
    },
    data: {
      Nascent: {
        quickWins90d: [
          { en: "Inventory APIs across the top 5 systems-of-record; close the most painful gaps.", ar: "حصر واجهات APIs لأهم 5 أنظمة سجلات وإغلاق أكبر الفجوات إيلاماً.", tr: "İlk 5 kayıt sisteminde API'leri envanterleyin; en sancılı boşlukları kapatın." },
        ],
        roadmap6m: [
          { en: "Build a centralized vector store with managed ingestion pipelines.", ar: "بناء مخزن متجهات مركزي بأنابيب استيعاب مُدارة.", tr: "Yönetilen alım veri hatlarıyla merkezi bir vektör deposu oluşturun." },
        ],
        strategic12m: [
          { en: "Stand up a federated knowledge fabric with provenance and Arabic NLP.", ar: "تأسيس نسيج معرفي اتحادي مع أصل المعلومة ومعالجة العربية.", tr: "Köken ve Arapça NLP ile federe bir bilgi dokusu kurun." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Deploy a managed Arabic-capable embedding model behind your retrieval layer.", ar: "نشر نموذج تضمين يدعم العربية خلف طبقة الاسترجاع.", tr: "Geri alma katmanınızın arkasına yönetilen Arapça destekli bir gömme modeli dağıtın." },
        ],
        roadmap6m: [
          { en: "Achieve >75% API/event coverage for systems an agent might touch.", ar: "تحقيق تغطية تتجاوز 75% للأنظمة التي قد يتعامل معها الوكيل.", tr: "Bir ajanın temas edebileceği sistemler için >%75 API/olay kapsamına ulaşın." },
        ],
        strategic12m: [
          { en: "Operate a curated knowledge graph spanning structured + unstructured sources.", ar: "تشغيل رسم معرفي منسَّق يغطي مصادر منظمة وغير منظمة.", tr: "Yapılandırılmış + yapılandırılmamış kaynakları kapsayan düzenlenmiş bir bilgi grafiğini işletin." },
        ],
      },
    },
    people: {
      Nascent: {
        quickWins90d: [
          { en: "Define HITL policy tiers based on action risk; document for engineers.", ar: "تعريف مستويات HITL بناءً على مخاطر الإجراء وتوثيقها.", tr: "Eylem riskine göre HITL politika katmanlarını tanımlayın; mühendisler için belgeleyin." },
        ],
        roadmap6m: [
          { en: "Launch role-based reskilling for the top 3 affected functions.", ar: "إطلاق إعادة تأهيل حسب الدور لأكثر 3 وظائف تأثراً.", tr: "En çok etkilenen 3 fonksiyon için role dayalı yeniden becerilendirme başlatın." },
        ],
        strategic12m: [
          { en: "Tie agent rollout to a strategic workforce plan including local talent.", ar: "ربط نشر الوكلاء بخطة استراتيجية للقوى العاملة تشمل المواهب المحلية.", tr: "Ajan kullanıma sunumunu yerel yeteneği içeren stratejik bir iş gücü planına bağlayın." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Move from sampling to risk-tiered HITL with audit trails.", ar: "الانتقال من العينات إلى HITL بمستويات مخاطر مع سجلات تدقيق.", tr: "Örneklemeden denetim izleriyle risk katmanlı HITL'e geçin." },
        ],
        roadmap6m: [
          { en: "Co-design next 2 agents with frontline teams from day one.", ar: "تصميم الوكيلين القادمين بالاشتراك مع فرق خط المواجهة من اليوم الأول.", tr: "Sonraki 2 ajanı ön cephe ekipleriyle ilk günden ortak tasarlayın." },
        ],
        strategic12m: [
          { en: "Adaptive autonomy controls — confidence + risk decide when humans review.", ar: "ضوابط استقلالية تكيفية — الثقة والمخاطر تحدد المراجعة البشرية.", tr: "Uyarlanabilir özerklik kontrolleri — güven + risk insanların ne zaman inceleyeceğine karar verir." },
        ],
      },
    },
    responsible: {
      Nascent: {
        quickWins90d: [
          { en: "Stand up a continuous eval harness for the top 2 agents (faithfulness, safety, cost).", ar: "إنشاء أداة تقييم مستمرة لأهم وكيلين (الإخلاص، السلامة، التكلفة).", tr: "İlk 2 ajan için sürekli bir değerlendirme koşum takımı kurun (doğruluk, güvenlik, maliyet)." },
        ],
        roadmap6m: [
          { en: "Implement a policy engine with tool-level allowlists and PII redaction.", ar: "تطبيق محرك سياسات مع قوائم سماح للأدوات وإخفاء PII.", tr: "Araç düzeyinde izin listeleri ve PII yeniden düzenleme ile bir politika motoru uygulayın." },
        ],
        strategic12m: [
          { en: "Achieve continuous PDPL/SAMA/CBUAE attestation per agent release.", ar: "تحقيق تصديق مستمر لـ PDPL/SAMA/CBUAE لكل إصدار وكيل.", tr: "Her ajan sürümünde sürekli PDPL/SAMA/CBUAE tasdiki elde edin." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Add gated promotions: agent cannot ship to prod without passing eval thresholds.", ar: "إضافة بوابات ترقية: لا ينتقل الوكيل للإنتاج دون تجاوز عتبات التقييم.", tr: "Kapılı terfiler ekleyin: ajan değerlendirme eşiklerini geçmeden üretime gönderilemez." },
        ],
        roadmap6m: [
          { en: "Wire SDAIA / PDPL controls into the policy engine.", ar: "ربط ضوابط SDAIA / PDPL داخل محرك السياسات.", tr: "SDAIA / PDPL kontrollerini politika motoruna bağlayın." },
        ],
        strategic12m: [
          { en: "Publish a Cognirise Verified responsible-AI report to clients and regulators.", ar: "نشر تقرير Cognirise Verified للذكاء الاصطناعي المسؤول للعملاء والمنظمين.", tr: "Müşterilere ve düzenleyicilere bir Cognirise Verified sorumlu-AI raporu yayımlayın." },
        ],
      },
    },
    scale: {
      Nascent: {
        quickWins90d: [
          { en: "Pick one production agent and define unit economics (cost per task vs. value).", ar: "اختيار وكيل إنتاج واحد وتعريف اقتصاديات الوحدة (التكلفة لكل مهمة مقابل القيمة).", tr: "Bir üretim ajanı seçin ve birim ekonomiyi tanımlayın (görev başına maliyet vs. değer)." },
        ],
        roadmap6m: [
          { en: "Move from aggregate token spend to per-team chargeback.", ar: "الانتقال من إجمالي إنفاق الرموز إلى إعادة تحميل التكلفة لكل فريق.", tr: "Toplam token harcamasından ekip başına geri yüklemeye geçin." },
        ],
        strategic12m: [
          { en: "Operate 5+ agents with EBIT/risk-reduction attribution per agent.", ar: "تشغيل 5+ وكلاء مع نسب أرباح/خفض مخاطر لكل وكيل.", tr: "Ajan başına EBIT/risk azaltma atfı ile 5+ ajan işletin." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Add cost-aware routing across model providers.", ar: "إضافة توجيه واعٍ بالتكلفة عبر مزودي النماذج.", tr: "Model sağlayıcılar arasında maliyet bilinçli yönlendirme ekleyin." },
        ],
        roadmap6m: [
          { en: "Stand up a board-level value tracker; quarterly attestation.", ar: "تأسيس متابع قيمة على مستوى المجلس؛ تصديق ربع سنوي.", tr: "Yönetim kurulu düzeyinde bir değer izleyici kurun; üç aylık tasdik." },
        ],
        strategic12m: [
          { en: "Become a published GCC reference for agentic at scale (15+ agents).", ar: "أن تصبح مرجع إقليمياً منشور للوكلاء على نطاق واسع (15+ وكيل).", tr: "Geniş ölçekli ajansal için yayımlanmış bir GCC referansı olun (15+ ajan)." },
        ],
      },
    },
  },
};
