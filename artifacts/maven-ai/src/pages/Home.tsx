import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Code2, Database, Rocket, ChevronRight, Quote, ExternalLink, Briefcase, Package, GitMerge } from "lucide-react";
import {
  stats, services, insights, industries, SITE_SOURCES,
  serviceTitle, serviceBuyer, serviceDescription,
  industryTitle, industrySubtitle, industryHeroStatLabel,
  insightTitle, insightSummary,
  insightCategoryLabel, insightTypeLabel, insightDateLabel, insightReadTimeLabel,
  INSIGHT_CATEGORY_COLORS, homepageStatLabel,
} from "@/data/content";
import PartnerLogos from "@/components/PartnerLogos";
import TwoPathsDiagram from "@/components/TwoPathsDiagram";
import { useLang, tStr, formatNumber } from "@/lib/lang";

const HOME_COPY = {
  heroBadge: { en: "Intelligence that elevates", ar: "ذكاء يرتقي", tr: "Yükselten zekâ" },
  heroLine1: { en: "From AI ambition", ar: "من طموح الذكاء الاصطناعي", tr: "AI hırsından" },
  heroLine2: { en: "to AI in production.", ar: "إلى الذكاء الاصطناعي في الإنتاج.", tr: "üretime AI'ya." },
  heroPara: {
    en: "Cognirise is a boutique AI advisory and engineering firm built for outcomes. We close the gap between enterprise AI ambition and enterprise AI in production — with senior delivery, lean economics, and an agentic-native practice.",
    ar: "Cognirise شركة استشارات وهندسة ذكاء اصطناعي بوتيكية مبنية لتحقيق النتائج. نسد الفجوة بين طموح الذكاء الاصطناعي في المؤسسات وتطبيقه الفعلي في الإنتاج — بفرق قيادية، واقتصاديات مرنة، وممارسة وكيلية أصيلة.",
    tr: "Cognirise, sonuç odaklı butik bir AI danışmanlık ve mühendislik firmasıdır. Kurumsal AI hırsı ile kurumsal AI üretimi arasındaki açığı kapatıyoruz — kıdemli teslimat, yalın ekonomi ve agentic-native bir pratikle.",
  },
  heroCtaPrimary: { en: "Take a free 12-min diagnostic", ar: "ابدأ تشخيصاً مجانياً مدته 12 دقيقة", tr: "Ücretsiz 12 dakikalık teşhis alın" },
  heroCtaSecondary: { en: "Start the conversation", ar: "ابدأ المحادثة", tr: "Görüşmeyi başlatın" },
  diagEyebrow: { en: "Cognirise Diagnostic Suite · Free · ~12 min", ar: "مجموعة تشخيص Cognirise · مجاناً · ~12 دقيقة", tr: "Cognirise Teşhis Paketi · Ücretsiz · ~12 dk" },
  diagTitle: { en: "Where does your AI program actually stand against the GCC peer band?", ar: "أين يقف برنامج الذكاء الاصطناعي لديكم فعلياً مقابل أقرانكم في الخليج؟", tr: "AI programınız aslında Körfez emsalleriyle karşılaştırıldığında nerede duruyor?" },
  diagSub: { en: "Four diagnostics — Agentic Readiness, Model & Value, Data & Governance, Use Case Value — produce a sovereign-aware score, an executive memo, and a branded board pack.", ar: "أربعة تشخيصات — الجاهزية الوكيلية، النموذج والقيمة، البيانات والحوكمة، قيمة حالات الاستخدام — تنتج درجة سيادية، مذكرة تنفيذية، وحزمة مجلس بعلامتكم.", tr: "Dört teşhis — Agentic Hazırlık, Model & Değer, Veri & Yönetişim, Kullanım Senaryosu Değeri — egemenlik bilinçli bir skor, yönetici notu ve markalı bir yönetim paketi üretir." },
  diagStartAri: { en: "Start ARI →", ar: "ابدأ ARI ←", tr: "ARI'ya başla →" },
  diagAllFour: { en: "See all 4 diagnostics", ar: "عرض التشخيصات الأربعة", tr: "4 teşhisin tümünü görün" },
  statsEyebrow: { en: "The Middle East AI opportunity — by the published numbers", ar: "فرصة الذكاء الاصطناعي في الشرق الأوسط — بالأرقام المنشورة", tr: "Orta Doğu AI fırsatı — yayımlanan rakamlarla" },
  sourceLabel: { en: "Source", ar: "المصدر", tr: "Kaynak" },
  gapTitle: { en: "The gap we exist to close", ar: "الفجوة التي وُجدنا لسدها", tr: "Kapatmak için var olduğumuz açık" },
  gapParaPart1: { en: "MIT's 2025", ar: "تقرير MIT لعام 2025", tr: "MIT'in 2025" },
  gapParaPart2: { en: "State of AI in Business", ar: "حالة الذكاء الاصطناعي في الأعمال", tr: "İşte Yapay Zekânın Durumu" },
  gapParaPart3: { en: "report found that", ar: "وجد أن", tr: "raporu" },
  gapParaPart4: { en: "95% of enterprise GenAI pilots delivered no measurable P&L impact", ar: "95% من تجارب الذكاء الاصطناعي التوليدي في المؤسسات لم تحقق أي أثر قابل للقياس على الأرباح والخسائر", tr: "kurumsal GenAI pilotlarının %95'inin ölçülebilir bir kâr/zarar etkisi yaratmadığını" },
  gapParaPart5: { en: "— only 5% of integrated systems generated meaningful value. We exist to put GCC enterprises in the 5%.", ar: "— فقط 5% من الأنظمة المتكاملة حققت قيمة فعلية. نحن موجودون لوضع شركات الخليج في فئة الـ 5%.", tr: "— entegre sistemlerin yalnızca %5'inin anlamlı değer ürettiğini ortaya koydu. Körfez şirketlerini bu %5'e taşımak için varız." },
  gapMitSource: { en: "MIT NANDA — The GenAI Divide: State of AI in Business (2025)", ar: "MIT NANDA — The GenAI Divide: State of AI in Business (2025)", tr: "MIT NANDA — The GenAI Divide: State of AI in Business (2025)" },
  gapItem1Title: { en: "Pilot purgatory", ar: "مطهر التجارب", tr: "Pilot çıkmazı" },
  gapItem1Desc: { en: "Dozens of POCs, no production path. The fix is governance plus orchestration plus change leadership — work the Tier-1 margin model rejects.", ar: "عشرات تجارب الإثبات بلا مسار للإنتاج. الحل هو حوكمة وتنسيق وقيادة تغيير — عمل يرفضه نموذج هامش الفئة الأولى.", tr: "Onlarca POC, üretim yolu yok. Çözüm: yönetişim, orkestrasyon ve değişim liderliği — Tier-1 marj modelinin reddettiği iş." },
  gapItem2Title: { en: "Technical debt trap", ar: "فخ الدين التقني", tr: "Teknik borç tuzağı" },
  gapItem2Desc: { en: "Industry research puts 60–80% of IT budgets into maintaining existing systems (with telcos at the higher end). AI-driven SDLC is the path out — almost no one delivers it on-prem for sovereign clients.", ar: "تشير الأبحاث إلى أن 60–80% من ميزانيات IT تذهب لصيانة الأنظمة القائمة (الاتصالات في الطرف الأعلى). دورة التطوير المدفوعة بالذكاء الاصطناعي هي المخرج — قلة من يقدمونها داخل المؤسسة للعملاء السياديين.", tr: "Sektör araştırması BT bütçelerinin %60–80'inin mevcut sistemlerin bakımına gittiğini gösteriyor (telekomlar üst uçta). AI öncülüğündeki SDLC çıkış yoludur — neredeyse kimse bunu egemen müşteriler için on-prem teslim etmiyor." },
  gapItem3Title: { en: "Data & governance vacuum", ar: "فراغ البيانات والحوكمة", tr: "Veri & yönetişim boşluğu" },
  gapItem3Desc: { en: "AI exposes data debt instantly. Big-4 sells strategy, hyperscalers sell tools. No one delivers the operating activation that makes agents trustworthy.", ar: "الذكاء الاصطناعي يكشف دين البيانات فوراً. الشركات الأربع الكبرى تبيع الاستراتيجية، والـ hyperscalers يبيعون الأدوات. لا أحد يقدم التفعيل التشغيلي الذي يجعل الوكلاء جديرين بالثقة.", tr: "AI, veri borcunu anında ortaya çıkarır. Big-4 strateji satar, hiper ölçekleyiciler araç satar. Ajanları güvenilir kılan operasyonel aktivasyonu kimse teslim etmez." },
  gapItem4Title: { en: "Adoption gap", ar: "فجوة التبني", tr: "Benimseme açığı" },
  gapItem4Desc: { en: "BCG finds only 26% of companies have moved past AI pilots to generate any value at scale — and just 4% sit at the elite frontier. The bottleneck is delivery, not models.", ar: "تجد BCG أن 26% فقط من الشركات تجاوزت مرحلة التجارب لتحقيق أي قيمة على نطاق واسع — وفقط 4% في المقدمة النخبوية. الاختناق في التنفيذ، لا النماذج.", tr: "BCG, şirketlerin yalnızca %26'sının AI pilotlarını geçerek ölçekte değer ürettiğini ve sadece %4'ünün elit cephede olduğunu buluyor. Darboğaz modeller değil, teslimattır." },
  diffTitle: { en: "How Cognirise is different", ar: "ما الذي يميز Cognirise", tr: "Cognirise'nın farkı nedir" },
  diffItem1Title: { en: "Production-led", ar: "مدفوع بالإنتاج", tr: "Üretim öncülüğünde" },
  diffItem1Desc: { en: "We deliver AI in production, not AI in PowerPoint. Measured outcomes, not advisory.", ar: "نوصل الذكاء الاصطناعي إلى الإنتاج، لا إلى عروض PowerPoint. نتائج مقاسة، لا مجرد استشارة.", tr: "AI'yı üretime teslim ederiz, PowerPoint'e değil. Ölçülen sonuçlar, danışmanlık değil." },
  diffItem2Title: { en: "Boutique by design", ar: "بوتيكية بالتصميم", tr: "Tasarımı gereği butik" },
  diffItem2Desc: { en: "Senior partners and principals on every engagement. No pyramid, no bench-warming.", ar: "شركاء كبار ومديرون في كل مهمة. بلا هرم، بلا انتظار على الدكة.", tr: "Her çalışmada kıdemli ortaklar ve principallar. Piramit yok, bekleme yok." },
  diffItem3Title: { en: "Agentic-native", ar: "وكيلي أصيل", tr: "Agentic-native" },
  diffItem3Desc: { en: "Built around agentic AI as the operating fabric — not retrofitted onto a legacy services model.", ar: "مبنية حول الذكاء الاصطناعي الوكيلي كنسيج تشغيلي — لا مرقّع على نموذج خدمات قديم.", tr: "Operasyonel doku olarak agentic AI etrafında kuruldu — eski hizmet modeline sonradan eklenmedi." },
  diffItem4Title: { en: "Lean economics", ar: "اقتصاديات مرنة", tr: "Yalın ekonomi" },
  diffItem4Desc: { en: "Boutique structure plus partner leverage delivers what Tier-1 cost bases cannot match.", ar: "البنية البوتيكية مع رافعة الشركاء توفر ما لا تستطيع قواعد تكلفة الفئة الأولى مجاراته.", tr: "Butik yapı ve ortak kaldıracı, Tier-1 maliyet tabanlarının eşleşemeyeceği şeyi sağlar." },
  diffItem5Title: { en: "Platform-agnostic", ar: "مستقلة عن المنصة", tr: "Platform bağımsız" },
  diffItem5Desc: { en: "Clients pick the right stack. Our economics aren't tied to any vendor.", ar: "العملاء يختارون المنصة المناسبة. اقتصادنا غير مرتبط بأي مورد.", tr: "Müşteriler doğru yığını seçer. Ekonomimiz hiçbir tedarikçiye bağlı değil." },
  diffLearnMore: { en: "Learn more about our approach", ar: "تعرّف أكثر على منهجنا", tr: "Yaklaşımımız hakkında daha fazla bilgi" },
  servicesTitle: { en: "Four value propositions", ar: "أربعة عروض قيمة", tr: "Dört değer önerisi" },
  servicesSub: { en: "Built for what clients actually need to ship.", ar: "مبنية حول ما يحتاجه العملاء فعلاً للإطلاق.", tr: "Müşterilerin gerçekten ürün çıkarmak için ihtiyaç duyduğu şey için tasarlandı." },
  learnMore: { en: "Learn more", ar: "اعرف المزيد", tr: "Daha fazla bilgi" },
  featuredTitle: { en: "Featured insights", ar: "أبرز الرؤى", tr: "Öne çıkan içgörüler" },
  featuredSub: { en: "Research, perspectives, and analysis from the Cognirise team.", ar: "أبحاث ومنظورات وتحليلات من فريق Cognirise.", tr: "Cognirise ekibinden araştırma, bakış açıları ve analizler." },
  allInsights: { en: "All insights", ar: "كل الرؤى", tr: "Tüm içgörüler" },
  read: { en: "Read", ar: "اقرأ", tr: "Oku" },
  founderQuote: {
    en: "The organizations that will win the next decade are not the ones that started AI first — they are the ones that moved AI from the slide deck to production. That is the only gap we exist to close.",
    ar: "المؤسسات التي ستفوز في العقد القادم ليست تلك التي بدأت الذكاء الاصطناعي أولاً — بل تلك التي نقلته من الشرائح إلى الإنتاج. هذه هي الفجوة الوحيدة التي وُجدنا لسدها.",
    tr: "Önümüzdeki on yılı kazanacak kuruluşlar, AI'ya ilk başlayanlar değil — AI'yı slayttan üretime taşıyanlardır. Kapatmak için var olduğumuz tek açık budur.",
  },
  founderRole: { en: "Senior Partner", ar: "شريك أول", tr: "Kıdemli Ortak" },
  industriesTitle: { en: "Where we work", ar: "أين نعمل", tr: "Nerede çalışıyoruz" },
  industriesSub: { en: "Deep domain knowledge in the sectors that matter most in the GCC.", ar: "خبرة قطاعية عميقة في القطاعات الأكثر أهمية في الخليج.", tr: "Körfez'de en önemli sektörlerde derin alan bilgisi." },
  explore: { en: "Explore", ar: "استكشف", tr: "Keşfet" },
  mpBadge: { en: "New · Marketplace", ar: "جديد · السوق", tr: "Yeni · Marketplace" },
  mpTitle: { en: "What good looks like — interactive demos, not slides.", ar: "كيف يبدو التميّز — عروض تفاعلية، لا شرائح.", tr: "İyi neye benzer — slaytlar değil, interaktif demolar." },
  mpPara: {
    en: "MIT NANDA finds 95% of enterprise GenAI pilots deliver no measurable P&L impact. Our Marketplace is the answer: a working CFO scoreboard for AI initiatives, plus detail pages for fourteen demos across the seven industries we know best.",
    ar: "تجد MIT NANDA أن 95% من تجارب GenAI في المؤسسات لا تحقق أثراً مالياً قابلاً للقياس. سوقنا هو الإجابة: لوحة قياس فعلية للمدير المالي حول مبادرات الذكاء الاصطناعي، بالإضافة إلى صفحات تفصيلية لأربعة عشر عرضاً عبر القطاعات السبعة التي نعرفها جيداً.",
    tr: "MIT NANDA, kurumsal GenAI pilotlarının %95'inin ölçülebilir kâr/zarar etkisi yaratmadığını bulguluyor. Marketplace'imiz cevap: AI girişimleri için çalışan bir CFO skor tablosu, artı en iyi bildiğimiz yedi sektördeki on dört demonun detay sayfaları.",
  },
  mpCtaTool: { en: "Open the Value Realization Tool", ar: "افتح أداة تحقيق القيمة", tr: "Değer Gerçekleştirme Aracını aç" },
  mpCtaBrowse: { en: "Browse the Marketplace", ar: "تصفح السوق", tr: "Marketplace'e göz at" },
  vrEyebrow: { en: "Value Realization · sample", ar: "تحقيق القيمة · عينة", tr: "Değer Gerçekleştirme · örnek" },
  vrUnits: { en: "AED · annual", ar: "درهم · سنوياً", tr: "AED · yıllık" },
  vrRow1: { en: "Citizen-services agent", ar: "وكيل خدمات المواطنين", tr: "Vatandaş hizmetleri ajanı" },
  vrRow2: { en: "Network-ops copilot", ar: "مساعد عمليات الشبكة", tr: "Ağ operasyonları yardımcısı" },
  vrRow3: { en: "Procurement intelligence", ar: "ذكاء المشتريات", tr: "Tedarik zekâsı" },
  vrRow4: { en: "Demand forecaster", ar: "متنبئ الطلب", tr: "Talep tahmincisi" },
  vrRow5: { en: "Hospitality revenue", ar: "إيرادات الضيافة", tr: "Konaklama geliri" },
  vrRealRate: { en: "Realization rate", ar: "معدل التحقيق", tr: "Gerçekleştirme oranı" },
  vrAtRisk: { en: "Value at risk", ar: "قيمة معرضة للخطر", tr: "Risk altındaki değer" },
  ctaTitle: { en: "Ready to move AI from the slide to production?", ar: "هل أنتم مستعدون لنقل الذكاء الاصطناعي من الشريحة إلى الإنتاج؟", tr: "AI'yı slayttan üretime taşımaya hazır mısınız?" },
  ctaPara: { en: "Three-day scope. Three-week prototype. 90-day MVP. Let's talk about where to start.", ar: "نطاق في ثلاثة أيام. نموذج أولي في ثلاثة أسابيع. منتج أولي في 90 يوماً. لنتحدث عن نقطة البداية.", tr: "Üç günlük kapsam. Üç haftalık prototip. 90 günlük MVP. Nereden başlayacağımızı konuşalım." },
  ctaPrimary: { en: "Start the conversation", ar: "ابدأ المحادثة", tr: "Görüşmeyi başlatın" },
  ctaSecondary: { en: "Read our research", ar: "اقرأ أبحاثنا", tr: "Araştırmamızı okuyun" },
};

const TWO_PATHS_COPY = {
  eyebrow: { en: "Our POV", ar: "وجهة نظرنا", tr: "Bakış Açımız" },
  title: {
    en: "Two paths to outcomes — project-led and asset-led.",
    ar: "مساران للوصول إلى النتائج — قائم على المشاريع وقائم على الأصول.",
    tr: "Sonuçlara giden iki yol — proje öncülüğünde ve varlık öncülüğünde.",
  },
  introA: {
    en: "Cognirise works two rails to the same destination.",
    ar: "تعمل Cognirise على مسارين للوصول إلى نفس الوجهة.",
    tr: "Cognirise aynı hedefe iki rayda çalışır.",
  },
  introProject: {
    en: "Project-led engagements when the problem is bespoke and the operating model has to change.",
    ar: "ارتباطات قائمة على المشاريع عندما تكون المشكلة فريدة ويجب تغيير نموذج التشغيل.",
    tr: "Sorun kendine özgü olduğunda ve operasyon modelinin değişmesi gerektiğinde proje öncülüğündeki çalışmalar.",
  },
  introAsset: {
    en: "Asset-led adoption of productized agents from our Marketplace when the problem is shared across the industry and time-to-value matters more than custom IP.",
    ar: "اعتماد قائم على الأصول لوكلاء جاهزين من سوقنا عندما تكون المشكلة مشتركة عبر القطاع ويكون الوقت اللازم لتحقيق القيمة أهم من الملكية الفكرية المخصصة.",
    tr: "Sorun sektör genelinde ortak olduğunda ve değer süresi özel IP'den daha önemli olduğunda Marketplace'imizdeki ürünleştirilmiş ajanların varlık öncülüğünde benimsenmesi.",
  },
  introBlend: {
    en: "Most engagements blend the two.",
    ar: "معظم الارتباطات تمزج بين المسارين.",
    tr: "Çoğu çalışma her ikisini harmanlar.",
  },
  framework: {
    en: "The decision lens — five factors",
    ar: "عدسة القرار — خمسة عوامل",
    tr: "Karar merceği — beş faktör",
  },
  cardProject: { en: "Project-led", ar: "قائم على المشاريع", tr: "Proje öncülüğünde" },
  cardAsset: { en: "Asset-led", ar: "قائم على الأصول", tr: "Varlık öncülüğünde" },
  cardBlended: { en: "Blended", ar: "مدمج", tr: "Harmanlanmış" },
  cardProjectDesc: {
    en: "Bespoke transformation, AI-driven SDLC, data & governance foundations, sovereign on-prem builds. Senior partners on every call.",
    ar: "تحول مخصص، ودورة حياة تطوير البرمجيات المدفوعة بالذكاء الاصطناعي، وأسس البيانات والحوكمة، وعمليات بناء سيادية محلية. شركاء كبار في كل مكالمة.",
    tr: "Özel dönüşüm, AI öncülüğündeki SDLC, veri & yönetişim temelleri, sovereign on-prem geliştirmeleri. Her görüşmede kıdemli ortaklar.",
  },
  cardAssetDesc: {
    en: "Productized agents from the Marketplace — adopt, configure, run. Faster time-to-value when a configured asset beats a custom build.",
    ar: "وكلاء جاهزون من السوق — اعتماد وتهيئة وتشغيل. وقت أسرع لتحقيق القيمة عندما يتفوق الأصل المهيأ على البناء المخصص.",
    tr: "Marketplace'ten ürünleştirilmiş ajanlar — benimseyin, yapılandırın, çalıştırın. Yapılandırılmış bir varlık özel bir geliştirmeyi geçtiğinde daha hızlı değer süresi.",
  },
  cardBlendedDesc: {
    en: "Asset pilot to project scale. Project discovery to asset rollout. Parallel rails on larger programmes.",
    ar: "من تجربة الأصول إلى نطاق المشاريع. من اكتشاف المشاريع إلى نشر الأصول. مسارات متوازية للبرامج الأكبر.",
    tr: "Varlık pilotundan proje ölçeğine. Proje keşfinden varlık dağıtımına. Daha büyük programlarda paralel raylar.",
  },
  ctaServices: { en: "Explore services", ar: "استكشف الخدمات", tr: "Hizmetleri keşfedin" },
  ctaMarketplace: { en: "Browse the Marketplace", ar: "تصفح السوق", tr: "Marketplace'e göz atın" },
  ctaPov: { en: "Read the POV", ar: "اقرأ المنظور", tr: "Bakış açısını okuyun" },
};

const DECISION_FACTORS = [
  {
    label: { en: "Problem specificity", ar: "خصوصية المشكلة", tr: "Sorun özgünlüğü" },
    project: { en: "Bespoke", ar: "فريدة", tr: "Kendine özgü" },
    asset: { en: "Industry-shared", ar: "مشتركة في القطاع", tr: "Sektörde ortak" },
  },
  {
    label: { en: "Sponsorship & mandate", ar: "الرعاية والتفويض", tr: "Sponsorluk & yetki" },
    project: { en: "C-suite, model change", ar: "تنفيذي، تغيير النموذج", tr: "C-suite, model değişikliği" },
    asset: { en: "Function head, budget", ar: "رئيس وظيفي، ميزانية", tr: "Fonksiyon başkanı, bütçe" },
  },
  {
    label: { en: "Time-to-value", ar: "الوقت لتحقيق القيمة", tr: "Değer süresi" },
    project: { en: "12–26 weeks OK", ar: "12–26 أسبوع مقبول", tr: "12–26 hafta uygun" },
    asset: { en: "Weeks required", ar: "أسابيع مطلوبة", tr: "Haftalar gerekli" },
  },
  {
    label: { en: "AI & data maturity", ar: "نضج الذكاء الاصطناعي والبيانات", tr: "AI & veri olgunluğu" },
    project: { en: "Foundations needed", ar: "تحتاج إلى أسس", tr: "Temeller gerekli" },
    asset: { en: "Plug-in ready", ar: "جاهز للتوصيل", tr: "Tak-çalıştır hazır" },
  },
  {
    label: { en: "Risk & IP appetite", ar: "شهية المخاطر والملكية الفكرية", tr: "Risk & IP iştahı" },
    project: { en: "Exclusive IP, sovereign", ar: "ملكية حصرية، سيادية", tr: "Özel IP, sovereign" },
    asset: { en: "Shared IP, configured", ar: "ملكية مشتركة، مهيأة", tr: "Ortak IP, yapılandırılmış" },
  },
];

const mounirHeadshot = "/images/founder-mounir.png";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } }),
};

const serviceIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Brain, Code2, Database, Rocket,
};

function AnimatedCounter({ value }: { value: string }) {
  return <span>{value}</span>;
}

export default function Home() {
  const { lang } = useLang();
  const featuredInsights = insights.filter((i) => i.featured).slice(0, 3);

  return (
    <div className="pt-20">
      {/* ── HERO ── */}
      <section className="relative min-h-[88vh] bg-[#0A1230] flex items-center overflow-hidden">
        {/* Animated background grid */}
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(rgba(91,124,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(91,124,255,0.4) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />
        </div>
        {/* Radial glow */}
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-[#5B7CFF]/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-[#8A5BD6]/25 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="max-w-4xl">
            <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
              <span className="inline-flex items-center gap-2 bg-[#5B7CFF]/15 border border-[#5B7CFF]/30 text-[#5B7CFF] text-xs font-semibold px-4 py-2 rounded-full uppercase tracking-wider mb-8">
                {tStr(HOME_COPY.heroBadge, lang)}
              </span>
            </motion.div>

            <motion.h1
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={1}
              className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white leading-[1.05] tracking-tight mb-8"
            >
              {tStr(HOME_COPY.heroLine1, lang)}
              <br />
              <span style={{ backgroundImage: "linear-gradient(90deg,#5B7CFF 0%,#8A5BD6 30%,#C45BB8 60%,#FF7B5A 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{tStr(HOME_COPY.heroLine2, lang)}</span>
            </motion.h1>

            <motion.p
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={2}
              className="text-xl text-gray-300 leading-relaxed max-w-2xl mb-12"
            >
              {tStr(HOME_COPY.heroPara, lang)}
            </motion.p>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={3}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
              <Link
                href="/assessments"
                className="inline-flex items-center gap-2 bg-[#5B7CFF] hover:bg-[#4A6BE6] text-white font-bold px-8 py-4 rounded-xl text-base transition-colors shadow-lg"
              >
                {tStr(HOME_COPY.heroCtaPrimary, lang)} <ArrowRight size={18} className="rtl:-scale-x-100" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 border border-white/30 hover:border-white/60 text-white font-semibold px-8 py-4 rounded-xl text-base transition-colors"
              >
                {tStr(HOME_COPY.heroCtaSecondary, lang)} <ChevronRight size={18} className="rtl:-scale-x-100" />
              </Link>
            </motion.div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* ── DIAGNOSTIC SUITE BANNER ── */}
      <section className="bg-gradient-to-r from-[#0A1230] via-[#1B2755] to-[#0A1230] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#C45BB8] mb-2">{tStr(HOME_COPY.diagEyebrow, lang)}</p>
            <p className="text-2xl font-extrabold leading-tight">{tStr(HOME_COPY.diagTitle, lang)}</p>
            <p className="text-sm text-white/80 mt-2">{tStr(HOME_COPY.diagSub, lang)}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <Link href="/assessments/ari" className="bg-white text-[#0A1230] font-bold px-5 py-3 rounded-lg whitespace-nowrap hover:bg-gray-100">{tStr(HOME_COPY.diagStartAri, lang)}</Link>
            <Link href="/assessments" className="border border-white/40 text-white font-semibold px-5 py-3 rounded-lg whitespace-nowrap hover:bg-white/10">{tStr(HOME_COPY.diagAllFour, lang)}</Link>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-8">
            {tStr(HOME_COPY.statsEyebrow, lang)}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="text-center md:text-left md:px-2"
              >
                <div className="text-5xl font-extrabold text-[#0A1230] mb-2 leading-none">
                  <AnimatedCounter value={stat.value} />
                </div>
                <div className="text-sm text-gray-700 font-medium leading-snug mb-2">
                  {homepageStatLabel(stat, lang)}
                </div>
                <p className="text-[11px] text-gray-500 leading-snug">
                  {tStr(HOME_COPY.sourceLabel, lang)}:{" "}
                  <a
                    href={stat.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-gray-300 hover:decoration-[#0A1230] hover:text-[#0A1230] transition-colors"
                  >
                    {stat.source.name} ({stat.source.year})
                    <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
                  </a>
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE GAP WE CLOSE ── */}
      <section className="py-24 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <div className="section-divider mx-auto" />
            <h2 className="text-4xl font-extrabold text-[#0A1230] mb-5">{tStr(HOME_COPY.gapTitle, lang)}</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              {tStr(HOME_COPY.gapParaPart1, lang)} <em>{tStr(HOME_COPY.gapParaPart2, lang)}</em> {tStr(HOME_COPY.gapParaPart3, lang)} <span className="font-semibold text-[#0A1230]">{tStr(HOME_COPY.gapParaPart4, lang)}</span> {tStr(HOME_COPY.gapParaPart5, lang)}
            </p>
            <p className="text-xs text-gray-500 mt-4">
              {tStr(HOME_COPY.sourceLabel, lang)}:{" "}
              <a
                href="https://nanda.media.mit.edu/ai_report_2025.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-gray-300 hover:decoration-[#0A1230] hover:text-[#0A1230] transition-colors"
              >
                {tStr(HOME_COPY.gapMitSource, lang)}
                <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
              </a>
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-5">
              {[
                { num: "01", title: tStr(HOME_COPY.gapItem1Title, lang), desc: tStr(HOME_COPY.gapItem1Desc, lang) },
                { num: "02", title: tStr(HOME_COPY.gapItem2Title, lang), desc: tStr(HOME_COPY.gapItem2Desc, lang), source: SITE_SOURCES.eyTelcoLegacy },
                { num: "03", title: tStr(HOME_COPY.gapItem3Title, lang), desc: tStr(HOME_COPY.gapItem3Desc, lang) },
                { num: "04", title: tStr(HOME_COPY.gapItem4Title, lang), desc: tStr(HOME_COPY.gapItem4Desc, lang), source: SITE_SOURCES.bcgValueAI },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="flex gap-4 p-5 bg-white rounded-xl border border-gray-100 shadow-sm"
                >
                  <span className="text-[#C45BB8] font-black text-xl leading-none mt-0.5 w-8 flex-shrink-0">{item.num}</span>
                  <div>
                    <h3 className="font-bold text-[#0A1230] mb-1">{item.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{item.desc}</p>
                    {item.source && (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        {tStr(HOME_COPY.sourceLabel, lang)}:{" "}
                        <a
                          href={item.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-gray-300 hover:decoration-[#0A1230] hover:text-[#0A1230] transition-colors"
                        >
                          {item.source.name} ({item.source.year})
                          <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
                        </a>
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="bg-[#0A1230] rounded-2xl p-10 text-white"
            >
              <h3 className="text-2xl font-bold mb-8">{tStr(HOME_COPY.diffTitle, lang)}</h3>
              <div className="space-y-6">
                {[
                  { label: tStr(HOME_COPY.diffItem1Title, lang), desc: tStr(HOME_COPY.diffItem1Desc, lang) },
                  { label: tStr(HOME_COPY.diffItem2Title, lang), desc: tStr(HOME_COPY.diffItem2Desc, lang) },
                  { label: tStr(HOME_COPY.diffItem3Title, lang), desc: tStr(HOME_COPY.diffItem3Desc, lang) },
                  { label: tStr(HOME_COPY.diffItem4Title, lang), desc: tStr(HOME_COPY.diffItem4Desc, lang) },
                  { label: tStr(HOME_COPY.diffItem5Title, lang), desc: tStr(HOME_COPY.diffItem5Desc, lang) },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#C45BB8] mt-2 flex-shrink-0" />
                    <div>
                      <span className="font-bold text-white">{item.label} — </span>
                      <span className="text-gray-300 text-sm">{item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/about" className="mt-8 inline-flex items-center gap-2 text-[#C45BB8] font-semibold text-sm hover:text-white transition-colors">
                {tStr(HOME_COPY.diffLearnMore, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── TWO PATHS POV ── */}
      <section className="py-24 bg-gradient-to-b from-white to-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto mb-12"
          >
            <div className="section-divider mx-auto" />
            <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white bg-[#0A1230] mb-4">
              {tStr(TWO_PATHS_COPY.eyebrow, lang)}
            </span>
            <h2 className="text-4xl font-extrabold text-[#0A1230] mb-5 leading-tight">
              {tStr(TWO_PATHS_COPY.title, lang)}
            </h2>
            <p className="text-lg text-gray-600 leading-relaxed">
              {tStr(TWO_PATHS_COPY.introA, lang)}{" "}
              <strong className="text-[#5B7CFF]">{tStr(TWO_PATHS_COPY.introProject, lang)}</strong>{" "}
              <strong className="text-[#C45BB8]">{tStr(TWO_PATHS_COPY.introAsset, lang)}</strong>{" "}
              {tStr(TWO_PATHS_COPY.introBlend, lang)}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <TwoPathsDiagram />
          </motion.div>

          {/* Decision lens — five factors */}
          <div className="mt-14 max-w-5xl mx-auto">
            <p className="text-xs font-bold uppercase tracking-widest text-[#0A1230] mb-4 text-center">
              {tStr(TWO_PATHS_COPY.framework, lang)}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {DECISION_FACTORS.map((f, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06, duration: 0.4 }}
                  className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm"
                >
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#0A1230] mb-3 leading-snug">
                    {tStr(f.label, lang)}
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#5B7CFF] flex-shrink-0" />
                      <span className="text-xs text-gray-700 leading-snug">{tStr(f.project, lang)}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#C45BB8] flex-shrink-0" />
                      <span className="text-xs text-gray-700 leading-snug">{tStr(f.asset, lang)}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mt-12 max-w-5xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase size={16} className="text-[#5B7CFF]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#5B7CFF]">{tStr(TWO_PATHS_COPY.cardProject, lang)}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{tStr(TWO_PATHS_COPY.cardProjectDesc, lang)}</p>
              <Link href="/services" className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-[#5B7CFF] hover:text-[#0A1230]">
                {tStr(TWO_PATHS_COPY.ctaServices, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
              </Link>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} className="text-[#C45BB8]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#C45BB8]">{tStr(TWO_PATHS_COPY.cardAsset, lang)}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{tStr(TWO_PATHS_COPY.cardAssetDesc, lang)}</p>
              <Link href="/marketplace" className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-[#C45BB8] hover:text-[#A04A99]">
                {tStr(TWO_PATHS_COPY.ctaMarketplace, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
              </Link>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <GitMerge size={16} className="text-[#8A5BD6]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#8A5BD6]">{tStr(TWO_PATHS_COPY.cardBlended, lang)}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{tStr(TWO_PATHS_COPY.cardBlendedDesc, lang)}</p>
              <Link href="/insights/two-paths-to-outcomes" className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-[#8A5BD6] hover:text-[#0A1230]">
                {tStr(TWO_PATHS_COPY.ctaPov, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <div className="section-divider" />
            <h2 className="text-4xl font-extrabold text-[#0A1230] mb-4">{tStr(HOME_COPY.servicesTitle, lang)}</h2>
            <p className="text-lg text-gray-600 max-w-xl">{tStr(HOME_COPY.servicesSub, lang)}</p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {services.map((service, i) => {
              const Icon = serviceIcons[service.icon] || Brain;
              return (
                <motion.div
                  key={service.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="report-card group border border-gray-100 rounded-2xl p-7 hover:border-transparent hover:shadow-xl cursor-pointer"
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                    style={{ backgroundColor: service.color + "18" }}
                  >
                    <Icon size={24} style={{ color: service.color }} />
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: service.color }}>
                    {serviceBuyer(service, lang)}
                  </div>
                  <h3 className="text-lg font-bold text-[#0A1230] mb-3 leading-snug">{serviceTitle(service, lang)}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed mb-5">{serviceDescription(service, lang)}</p>
                  <Link
                    href={`/services/${service.slug}`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#5B7CFF] group-hover:text-[#C45BB8] transition-colors"
                  >
                    {tStr(HOME_COPY.learnMore, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PLATFORM PARTNERS ── */}
      <PartnerLogos variant="light" />

      {/* ── FEATURED INSIGHTS ── */}
      <section className="py-24 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-14">
            <div>
              <div className="section-divider" />
              <h2 className="text-4xl font-extrabold text-[#0A1230] mb-2">{tStr(HOME_COPY.featuredTitle, lang)}</h2>
              <p className="text-gray-600">{tStr(HOME_COPY.featuredSub, lang)}</p>
            </div>
            <Link href="/insights" className="hidden sm:inline-flex items-center gap-2 text-[#5B7CFF] font-semibold text-sm hover:text-[#C45BB8] transition-colors">
              {tStr(HOME_COPY.allInsights, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
            </Link>
          </div>

          <div className="grid lg:grid-cols-3 gap-7">
            {featuredInsights.map((insight, i) => (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="report-card group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm cursor-pointer"
              >
                <Link href={`/insights/${insight.slug}`}>
                  <div className="h-52 overflow-hidden bg-[#0A1230] relative">
                    <img
                      src={insight.coverImage}
                      alt={insightTitle(insight, lang)}
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0A1230]/80 to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <span
                        className="text-xs font-bold px-3 py-1 rounded-full"
                        style={{
                          backgroundColor: INSIGHT_CATEGORY_COLORS[insight.category] ?? "#8A5BD6",
                          color: "white",
                        }}
                      >
                        {insightTypeLabel(insight.type, lang)}
                      </span>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-[#5B7CFF]">{insightCategoryLabel(insight.category, lang)}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{insightDateLabel(insight.date, lang)}</span>
                    </div>
                    <h3 className="font-bold text-[#0A1230] text-lg leading-snug mb-3 group-hover:text-[#5B7CFF] transition-colors">
                      {insightTitle(insight, lang)}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed mb-4">{insightSummary(insight, lang)}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{insightReadTimeLabel(insight, lang)}</span>
                      <span className="text-sm font-semibold text-[#5B7CFF] group-hover:text-[#C45BB8] transition-colors flex items-center gap-1">
                        {tStr(HOME_COPY.read, lang)} <ArrowRight size={13} className="rtl:-scale-x-100" />
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOUNDER QUOTE ── */}
      <section className="py-24 bg-[#0A1230] relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #C45BB8 1px, transparent 1px)`, backgroundSize: "40px 40px" }} />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Quote size={48} className="text-[#C45BB8] mx-auto mb-8 opacity-60" />
          <blockquote className="text-2xl sm:text-3xl font-semibold text-white leading-relaxed mb-10">
            "{tStr(HOME_COPY.founderQuote, lang)}"
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-[#5B7CFF] border-2 border-[#C45BB8]">
              <img
                src={mounirHeadshot}
                alt="Mounir Aris"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="text-left">
              <div className="text-white font-bold">Mounir Aris</div>
              <div className="text-gray-400 text-sm">{tStr(HOME_COPY.founderRole, lang)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── INDUSTRIES ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <div className="section-divider" />
            <h2 className="text-4xl font-extrabold text-[#0A1230] mb-4">{tStr(HOME_COPY.industriesTitle, lang)}</h2>
            <p className="text-lg text-gray-600 max-w-xl">{tStr(HOME_COPY.industriesSub, lang)}</p>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {industries.map((ind, i) => (
              <motion.div
                key={ind.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="report-card group p-8 border border-gray-100 rounded-2xl hover:border-transparent hover:shadow-xl flex flex-col"
              >
                <div className="text-5xl font-extrabold mb-2 leading-none" style={{ color: ind.color }}>{ind.heroStat}</div>
                <p className="text-[11px] text-gray-500 leading-snug mb-4">
                  {industryHeroStatLabel(ind, lang)}
                  <br />
                  <a
                    href={ind.heroStatSource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 underline decoration-gray-300 hover:decoration-[#0A1230] hover:text-[#0A1230] transition-colors"
                  >
                    {ind.heroStatSource.name} ({ind.heroStatSource.year})
                    <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
                  </a>
                </p>
                <h3 className="text-xl font-bold text-[#0A1230] mb-3">{industryTitle(ind, lang)}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6 flex-1">{industrySubtitle(ind, lang)}</p>
                <Link href={`/industries#${ind.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#5B7CFF] group-hover:text-[#C45BB8] transition-colors">
                  {tStr(HOME_COPY.explore, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MARKETPLACE TEASER ── */}
      <section className="py-20 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <div className="section-divider" />
              <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white bg-[#5B7CFF] mb-4">
                {tStr(HOME_COPY.mpBadge, lang)}
              </span>
              <h2 className="text-4xl font-extrabold text-[#0A1230] mb-5 max-w-2xl leading-tight">
                {tStr(HOME_COPY.mpTitle, lang)}
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl leading-relaxed mb-6">
                {tStr(HOME_COPY.mpPara, lang)}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/marketplace/value-realization"
                  className="inline-flex items-center gap-2 bg-[#0A1230] hover:bg-[#5B7CFF] text-white font-bold px-6 py-3.5 rounded-xl transition-colors"
                >
                  {tStr(HOME_COPY.mpCtaTool, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
                </Link>
                <Link
                  href="/marketplace"
                  className="inline-flex items-center gap-2 border border-[#0A1230] text-[#0A1230] hover:bg-[#0A1230] hover:text-white font-bold px-6 py-3.5 rounded-xl transition-colors"
                >
                  {tStr(HOME_COPY.mpCtaBrowse, lang)}
                </Link>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#5B7CFF]">
                    {tStr(HOME_COPY.vrEyebrow, lang)}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {tStr(HOME_COPY.vrUnits, lang)}
                  </span>
                </div>
                {[
                  { label: tStr(HOME_COPY.vrRow1, lang), expected: 4.2, realized: 3.35, color: "#8A5BD6" },
                  { label: tStr(HOME_COPY.vrRow2, lang), expected: 6.8, realized: 4.6, color: "#8A5BD6" },
                  { label: tStr(HOME_COPY.vrRow3, lang), expected: 9.5, realized: 5.2, color: "#C45BB8" },
                  { label: tStr(HOME_COPY.vrRow4, lang), expected: 3.1, realized: 1.4, color: "#5B7CFF" },
                  { label: tStr(HOME_COPY.vrRow5, lang), expected: 5.4, realized: 0.0, color: "#B91C1C" },
                ].map((row) => {
                  const max = 9.5;
                  const expW = (row.expected / max) * 100;
                  const realW = (row.realized / max) * 100;
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex justify-between text-[11px] text-gray-600">
                        <span className="font-semibold">{row.label}</span>
                        <span className="text-gray-400">
                          AED {formatNumber(row.realized, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M / {formatNumber(row.expected, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M
                        </span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="absolute inset-y-0 start-0 rounded-full"
                          style={{ width: `${expW}%`, background: "#0A123022" }}
                        />
                        <div
                          className="absolute inset-y-0 start-0 rounded-full"
                          style={{ width: `${realW}%`, background: row.color }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-gray-500 leading-relaxed pt-2 border-t border-gray-100">
                  {tStr(HOME_COPY.vrRealRate, lang)} <span className="font-bold text-[#0A1230]">{formatNumber(49, lang)}%</span> · {tStr(HOME_COPY.vrAtRisk, lang)} <span className="font-bold text-[#B91C1C]">AED {formatNumber(9.7, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 bg-gradient-to-br from-[#0A1230] via-[#8A5BD6] to-[#5B7CFF]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl font-extrabold text-white mb-6">
              {tStr(HOME_COPY.ctaTitle, lang)}
            </h2>
            <p className="text-xl text-gray-300 mb-10 max-w-xl mx-auto">
              {tStr(HOME_COPY.ctaPara, lang)}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/contact" className="inline-flex items-center gap-2 bg-white hover:bg-gray-100 text-[#0A1230] font-bold px-8 py-4 rounded-xl text-base transition-colors shadow-lg">
                {tStr(HOME_COPY.ctaPrimary, lang)} <ArrowRight size={18} className="rtl:-scale-x-100" />
              </Link>
              <Link href="/insights" className="inline-flex items-center gap-2 border border-white/30 hover:border-white text-white font-semibold px-8 py-4 rounded-xl text-base transition-colors">
                {tStr(HOME_COPY.ctaSecondary, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
