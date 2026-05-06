import type { AssessmentDefinition } from "./types";

export const mvi: AssessmentDefinition = {
  slug: "mvi",
  serviceSlug: "ai-driven-sdlc",
  code: "MVI",
  brandColor: "#E97132",
  estMinutes: 12,
  title: { en: "Modernization Velocity Index", ar: "مؤشر سرعة التحديث", tr: "Modernizasyon Hız Endeksi" },
  subtitle: {
    en: "How fast can your engineering organization modernize legacy and ship AI-grade software?",
    ar: "ما السرعة التي يمكن لمؤسستك الهندسية بها تحديث النظم القديمة وإطلاق برمجيات بمستوى الذكاء الاصطناعي؟",
    tr: "Mühendislik organizasyonunuz eski sistemleri ne kadar hızlı modernize edebilir ve AI seviyesinde yazılım yayınlayabilir?",
  },
  description: {
    en: "Benchmark your application portfolio knowledge, AI-augmented SDLC adoption, DevEx, sovereign-cloud posture, and engineering operating model.",
    ar: "قارن معرفتكم بمحفظة التطبيقات، وتبني SDLC المعزز بالذكاء الاصطناعي، وتجربة المطور، والوضع السيادي، ونموذج تشغيل الهندسة.",
    tr: "Uygulama portföyü bilginizi, AI destekli SDLC benimsenmesini, DevEx'i, egemen bulut duruşunu ve mühendislik işletim modelini kıyaslayın.",
  },
  memoPromptHint:
    "Frame the memo around modernization velocity. Reference the 70%-IT-spend-on-maintenance fact and the 40–60% SDLC compression possible with AI-augmented engineering.",
  antiVendor: {
    en: [
      "If you need a 200-person offshore staff augmentation deal, an Indian SI will outprice us.",
      "If your sole modernization goal is replatforming to Oracle Cloud, talk to Oracle Consulting.",
      "If you need full-stack ServiceNow rollout, talk to Accenture or DXC.",
    ],
    ar: [
      "إذا كنتم بحاجة لصفقة استعانة بفريق عن بعد بـ 200 شخص، فإن SI هندي سيتفوق علينا في السعر.",
      "إذا كان هدف التحديث الوحيد هو الانتقال إلى Oracle Cloud، تحدثوا مع Oracle Consulting.",
      "إذا كنتم بحاجة لطرح ServiceNow كامل، تحدثوا مع Accenture أو DXC.",
    ],
    tr: [
      "200 kişilik bir yurt dışı personel takviye anlaşmasına ihtiyacınız varsa, bir Hindistan SI'si bizden daha düşük fiyat verecektir.",
      "Tek modernizasyon hedefiniz Oracle Cloud'a yeniden platformlama ise, Oracle Consulting ile görüşün.",
      "Tam yığın ServiceNow kurulumuna ihtiyacınız varsa, Accenture veya DXC ile görüşün.",
    ],
  },
  dimensions: [
    {
      id: "portfolio",
      title: { en: "Application Portfolio Knowledge", ar: "معرفة محفظة التطبيقات", tr: "Uygulama Portföyü Bilgisi" },
      weight: 0.15,
      description: { en: "Inventory completeness, criticality classification, dependency mapping.", ar: "اكتمال الجرد، تصنيف الأهمية، خرائط الاعتماديات.", tr: "Envanter eksiksizliği, kritiklik sınıflandırması, bağımlılık haritalama." },
      questions: [
        {
          id: "mvi.p1",
          prompt: { en: "Application inventory completeness?", ar: "اكتمال جرد التطبيقات؟", tr: "Uygulama envanteri eksiksizliği?" },
          options: [
            { id: "a", label: { en: "No central inventory.", ar: "لا يوجد جرد مركزي.", tr: "Merkezi envanter yok." }, score: 1 },
            { id: "b", label: { en: "Spreadsheet maintained quarterly.", ar: "جدول بيانات يُحدّث كل ربع.", tr: "Üç ayda bir güncellenen elektronik tablo." }, score: 2 },
            { id: "c", label: { en: "CMDB with 70–80% coverage.", ar: "CMDB يغطي 70–80%.", tr: "%70–80 kapsamlı CMDB." }, score: 3 },
            { id: "d", label: { en: "Living inventory with automated discovery.", ar: "جرد حي باكتشاف آلي.", tr: "Otomatik keşifli canlı envanter." }, score: 4 },
            { id: "e", label: { en: "Real-time dependency graph with criticality scoring.", ar: "رسم اعتماديات لحظي مع تصنيف الأهمية.", tr: "Kritiklik puanlamalı gerçek zamanlı bağımlılık grafiği." }, score: 5 },
          ],
        },
        {
          id: "mvi.p2",
          prompt: { en: "Legacy criticality classification?", ar: "تصنيف أهمية الأنظمة القديمة؟", tr: "Eski sistem kritiklik sınıflandırması?" },
          options: [
            { id: "a", label: { en: "No formal classification.", ar: "لا تصنيف رسمي.", tr: "Resmi sınıflandırma yok." }, score: 1 },
            { id: "b", label: { en: "Tier 1/2/3 by IT.", ar: "تصنيف من قبل تقنية المعلومات.", tr: "BT tarafından Tier 1/2/3." }, score: 2 },
            { id: "c", label: { en: "Joint IT + business criticality matrix.", ar: "مصفوفة أهمية مشتركة بين الأعمال والتقنية.", tr: "Ortak BT + iş kritiklik matrisi." }, score: 3 },
            { id: "d", label: { en: "Risk-weighted modernization roadmap signed off.", ar: "خارطة طريق تحديث مرجحة بالمخاطر معتمدة.", tr: "Onaylanmış risk ağırlıklı modernizasyon yol haritası." }, score: 4 },
            { id: "e", label: { en: "Continuous portfolio re-prioritization tied to enterprise risk.", ar: "إعادة ترتيب أولويات مستمرة مرتبطة بمخاطر المؤسسة.", tr: "Kurumsal riske bağlı sürekli portföy yeniden önceliklendirme." }, score: 5 },
          ],
        },
        {
          id: "mvi.p3",
          prompt: { en: "Dependency mapping across legacy systems?", ar: "خرائط الاعتماديات عبر الأنظمة القديمة؟", tr: "Eski sistemlerde bağımlılık haritalama?" },
          options: [
            { id: "a", label: { en: "Tribal knowledge only.", ar: "معرفة شفهية فقط.", tr: "Yalnızca aşiret bilgisi." }, score: 1 },
            { id: "b", label: { en: "Manual maps in Visio/PowerPoint.", ar: "خرائط يدوية في Visio/PowerPoint.", tr: "Visio/PowerPoint'te manuel haritalar." }, score: 2 },
            { id: "c", label: { en: "Static CMDB-based dependency lists.", ar: "قوائم اعتماديات ثابتة من CMDB.", tr: "CMDB tabanlı statik bağımlılık listeleri." }, score: 3 },
            { id: "d", label: { en: "Code-level dependency graphs auto-refreshed.", ar: "رسوم اعتماديات على مستوى الكود تُحدث آلياً.", tr: "Otomatik yenilenen kod düzeyinde bağımlılık grafikleri." }, score: 4 },
            { id: "e", label: { en: "Live dependency + data-flow graph used for impact analysis.", ar: "رسم اعتماديات وتدفق بيانات حي يُستخدم لتحليل الأثر.", tr: "Etki analizi için kullanılan canlı bağımlılık + veri akış grafiği." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "coverage",
      title: { en: "Code & Documentation Coverage", ar: "تغطية الكود والوثائق", tr: "Kod ve Dokümantasyon Kapsamı" },
      weight: 0.10,
      description: { en: "Test coverage, documentation currency, ADR practice.", ar: "تغطية الاختبارات، حداثة الوثائق، ممارسة قرارات المعمارية.", tr: "Test kapsamı, dokümantasyon güncelliği, ADR uygulaması." },
      questions: [
        {
          id: "mvi.c1",
          prompt: { en: "Average automated test coverage on critical apps?", ar: "متوسط تغطية الاختبارات الآلية للتطبيقات الحيوية؟", tr: "Kritik uygulamalarda ortalama otomatik test kapsamı?" },
          options: [
            { id: "a", label: { en: "<20%.", ar: "أقل من 20%.", tr: "<%20." }, score: 1 },
            { id: "b", label: { en: "20–40%.", ar: "20–40%.", tr: "%20–40." }, score: 2 },
            { id: "c", label: { en: "40–60%.", ar: "40–60%.", tr: "%40–60." }, score: 3 },
            { id: "d", label: { en: "60–80%.", ar: "60–80%.", tr: "%60–80." }, score: 4 },
            { id: "e", label: { en: ">80% with mutation testing on critical paths.", ar: "أكثر من 80% مع اختبارات الطفرات للمسارات الحرجة.", tr: ">%80 ve kritik yollarda mutasyon testi." }, score: 5 },
          ],
        },
        {
          id: "mvi.c2",
          prompt: { en: "Documentation currency for legacy systems?", ar: "حداثة الوثائق للأنظمة القديمة؟", tr: "Eski sistemler için dokümantasyon güncelliği?" },
          options: [
            { id: "a", label: { en: "Largely outdated or missing.", ar: "قديمة أو مفقودة في الغالب.", tr: "Büyük ölçüde güncel olmayan veya eksik." }, score: 1 },
            { id: "b", label: { en: "Some current docs, mostly architectural.", ar: "بعض الوثائق الحديثة، معظمها معماري.", tr: "Bazı güncel dokümanlar, çoğunlukla mimari." }, score: 2 },
            { id: "c", label: { en: "Functional + technical docs current for top systems.", ar: "وثائق وظيفية وتقنية محدّثة لأهم الأنظمة.", tr: "Üst sistemler için işlevsel + teknik dokümanlar güncel." }, score: 3 },
            { id: "d", label: { en: "Living docs maintained alongside code.", ar: "وثائق حية تُحفظ مع الكود.", tr: "Kodla birlikte tutulan canlı dokümanlar." }, score: 4 },
            { id: "e", label: { en: "AI-generated specs + human-curated ADRs as source of truth.", ar: "مواصفات مولدة بالذكاء الاصطناعي مع قرارات معمارية بشرية المصدر الموثوق.", tr: "Doğruluk kaynağı olarak AI tarafından oluşturulan spesifikasyonlar + insan tarafından düzenlenmiş ADR'ler." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "ai-sdlc",
      title: { en: "AI-Augmented SDLC Adoption", ar: "تبني SDLC معزز بالذكاء الاصطناعي", tr: "AI Destekli SDLC Benimsenmesi" },
      weight: 0.20,
      description: { en: "Copilot/Codeium/Cursor adoption, AI code review, AI test generation, agentic refactoring.", ar: "تبني Copilot/Codeium/Cursor، مراجعة الكود بالذكاء الاصطناعي، توليد الاختبارات، إعادة الهيكلة.", tr: "Copilot/Codeium/Cursor benimsenmesi, AI kod incelemesi, AI test üretimi, ajansal yeniden yapılandırma." },
      questions: [
        {
          id: "mvi.s1",
          prompt: { en: "AI coding assistant adoption among engineers?", ar: "تبني مساعد الكود الذكي بين المهندسين؟", tr: "Mühendisler arasında AI kodlama asistanı benimsenmesi?" },
          options: [
            { id: "a", label: { en: "<10%.", ar: "أقل من 10%.", tr: "<%10." }, score: 1 },
            { id: "b", label: { en: "10–30% in pilots.", ar: "10–30% في التجارب.", tr: "Pilotlarda %10–30." }, score: 2 },
            { id: "c", label: { en: "30–60% with informal usage.", ar: "30–60% بشكل غير رسمي.", tr: "Gayri resmi kullanımla %30–60." }, score: 3 },
            { id: "d", label: { en: ">60% with measured productivity uplift.", ar: "أكثر من 60% مع قياس تحسن الإنتاجية.", tr: "Ölçülmüş verimlilik artışıyla >%60." }, score: 4 },
            { id: "e", label: { en: ">80% with role-customized AI workflows + agentic refactoring.", ar: "أكثر من 80% مع تدفقات ذكاء اصطناعي مخصصة وإعادة هيكلة وكيلية.", tr: "Role özelleştirilmiş AI iş akışları + ajansal yeniden yapılandırma ile >%80." }, score: 5 },
          ],
        },
        {
          id: "mvi.s2",
          prompt: { en: "AI usage in code review?", ar: "استخدام الذكاء الاصطناعي في مراجعة الكود؟", tr: "Kod incelemesinde AI kullanımı?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Optional AI suggestions in PRs.", ar: "اقتراحات اختيارية في طلبات السحب.", tr: "PR'larda isteğe bağlı AI önerileri." }, score: 2 },
            { id: "c", label: { en: "AI review enforced for security & secrets.", ar: "مراجعة AI إلزامية للأمن والأسرار.", tr: "Güvenlik ve sırlar için zorunlu AI incelemesi." }, score: 3 },
            { id: "d", label: { en: "AI review across security, performance, and style with auto-fixes.", ar: "مراجعة AI شاملة (أمن، أداء، أسلوب) مع إصلاحات آلية.", tr: "Otomatik düzeltmelerle güvenlik, performans ve stil genelinde AI incelemesi." }, score: 4 },
            { id: "e", label: { en: "Agentic refactoring PRs raised by AI and auto-merged on green.", ar: "طلبات سحب لإعادة الهيكلة يرفعها الذكاء الاصطناعي وتُدمج تلقائياً.", tr: "AI tarafından açılan ve yeşilde otomatik birleştirilen ajansal yeniden yapılandırma PR'ları." }, score: 5 },
          ],
        },
        {
          id: "mvi.s3",
          prompt: { en: "AI-driven legacy spec extraction?", ar: "استخراج المواصفات من النظم القديمة بالذكاء الاصطناعي؟", tr: "AI odaklı eski sistem spesifikasyon çıkarımı?" },
          options: [
            { id: "a", label: { en: "Not used.", ar: "غير مستخدم.", tr: "Kullanılmıyor." }, score: 1 },
            { id: "b", label: { en: "Tried in one POC.", ar: "جُرّب في POC واحد.", tr: "Bir POC'de denendi." }, score: 2 },
            { id: "c", label: { en: "Used on 1–2 modernization programs.", ar: "مستخدم في برنامج تحديث أو اثنين.", tr: "1–2 modernizasyon programında kullanıldı." }, score: 3 },
            { id: "d", label: { en: "Standard practice for any modernization.", ar: "ممارسة قياسية لأي تحديث.", tr: "Her modernizasyon için standart uygulama." }, score: 4 },
            { id: "e", label: { en: "AI-driven spec + auto-generated test scaffolds + migration plan as one workflow.", ar: "مواصفات بالذكاء الاصطناعي + هياكل اختبار مولدة + خطة هجرة كتدفق واحد.", tr: "Tek bir iş akışı olarak AI odaklı spesifikasyon + otomatik üretilen test iskeletleri + geçiş planı." }, score: 5 },
          ],
        },
        {
          id: "mvi.s4",
          prompt: { en: "AI-generated test coverage for new code?", ar: "تغطية اختبارات مولدة بالذكاء الاصطناعي للكود الجديد؟", tr: "Yeni kod için AI tarafından oluşturulan test kapsamı?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Engineers occasionally use it ad-hoc.", ar: "يستخدمها المهندسون أحياناً.", tr: "Mühendisler ara sıra ad-hoc kullanır." }, score: 2 },
            { id: "c", label: { en: "AI generates ~50% of unit tests.", ar: "AI يولّد نحو 50% من اختبارات الوحدة.", tr: "AI birim testlerinin ~%50'sini oluşturur." }, score: 3 },
            { id: "d", label: { en: ">75% of unit + integration tests AI-assisted.", ar: "أكثر من 75% من اختبارات الوحدة والتكامل بمساعدة AI.", tr: "Birim + entegrasyon testlerinin >%75'i AI destekli." }, score: 4 },
            { id: "e", label: { en: "Continuous AI test generation tied to coverage SLAs in CI.", ar: "توليد اختبارات مستمر مرتبط باتفاقيات تغطية في CI.", tr: "CI'da kapsam SLA'lerine bağlı sürekli AI test üretimi." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "devex",
      title: { en: "Engineering Productivity & DevEx", ar: "إنتاجية الهندسة وتجربة المطور", tr: "Mühendislik Verimliliği ve DevEx" },
      weight: 0.15,
      description: { en: "DORA metrics, platform engineering, internal developer portal.", ar: "مقاييس DORA، هندسة المنصة، بوابة المطورين الداخلية.", tr: "DORA metrikleri, platform mühendisliği, dahili geliştirici portalı." },
      questions: [
        {
          id: "mvi.d1",
          prompt: { en: "DORA metrics tracking maturity?", ar: "نضج تتبع مقاييس DORA؟", tr: "DORA metrikleri izleme olgunluğu?" },
          options: [
            { id: "a", label: { en: "Not tracked.", ar: "غير متتبَّعة.", tr: "İzlenmiyor." }, score: 1 },
            { id: "b", label: { en: "Lead time tracked manually.", ar: "زمن التسليم يُتابع يدوياً.", tr: "Teslim süresi manuel izleniyor." }, score: 2 },
            { id: "c", label: { en: "All 4 DORA metrics dashboarded.", ar: "كل مقاييس DORA الأربعة في لوحة.", tr: "4 DORA metriğinin tamamı kontrol panelinde." }, score: 3 },
            { id: "d", label: { en: "Per-team DORA metrics + improvement targets.", ar: "DORA لكل فريق مع أهداف تحسين.", tr: "Ekip başına DORA metrikleri + iyileştirme hedefleri." }, score: 4 },
            { id: "e", label: { en: "Elite DORA performance benchmarked externally.", ar: "أداء DORA من فئة Elite مع مقارنة خارجية.", tr: "Dışarıda kıyaslanmış Elite DORA performansı." }, score: 5 },
          ],
        },
        {
          id: "mvi.d2",
          prompt: { en: "Internal developer portal / platform?", ar: "بوابة/منصة مطور داخلية؟", tr: "Dahili geliştirici portalı / platformu?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Wiki + scattered tools.", ar: "ويكي + أدوات متفرقة.", tr: "Wiki + dağınık araçlar." }, score: 2 },
            { id: "c", label: { en: "IDP for service catalog only.", ar: "IDP لكاتالوج الخدمات فقط.", tr: "Yalnızca hizmet kataloğu için IDP." }, score: 3 },
            { id: "d", label: { en: "Backstage-class IDP with golden paths.", ar: "IDP من فئة Backstage مع مسارات ذهبية.", tr: "Altın yollarla Backstage sınıfı IDP." }, score: 4 },
            { id: "e", label: { en: "IDP with golden paths, scorecards, and AI assistants embedded.", ar: "IDP مع مسارات ذهبية وبطاقات وأذرع AI.", tr: "Altın yollar, puan kartları ve gömülü AI asistanlarına sahip IDP." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "cloud",
      title: { en: "Architecture & Cloud Readiness", ar: "جاهزية المعمارية والسحابة", tr: "Mimari ve Bulut Hazırlığı" },
      weight: 0.15,
      description: { en: "Containerization, target cloud, IaC, observability.", ar: "الحاويات، السحابة المستهدفة، البنية ككود، المراقبة.", tr: "Konteynerleştirme, hedef bulut, IaC, gözlemlenebilirlik." },
      questions: [
        {
          id: "mvi.cl1",
          prompt: { en: "Workloads containerized?", ar: "نسبة الأحمال في الحاويات؟", tr: "Konteynerleştirilmiş iş yükleri?" },
          options: [
            { id: "a", label: { en: "<10%.", ar: "أقل من 10%.", tr: "<%10." }, score: 1 },
            { id: "b", label: { en: "10–30%.", ar: "10–30%.", tr: "%10–30." }, score: 2 },
            { id: "c", label: { en: "30–60%.", ar: "30–60%.", tr: "%30–60." }, score: 3 },
            { id: "d", label: { en: "60–85%.", ar: "60–85%.", tr: "%60–85." }, score: 4 },
            { id: "e", label: { en: ">85% with k8s as default.", ar: "أكثر من 85% مع k8s كافتراضي.", tr: "Varsayılan olarak k8s ile >%85." }, score: 5 },
          ],
        },
        {
          id: "mvi.cl2",
          prompt: { en: "Sovereign / on-prem cloud capability?", ar: "قدرة سحابة سيادية/داخلية؟", tr: "Egemen / şirket içi bulut yeteneği?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا توجد.", tr: "Yok." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Discussed; no plan.", ar: "تمت مناقشتها بدون خطة.", tr: "Tartışıldı; plan yok." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Hybrid; some workloads on sovereign.", ar: "هجين؛ بعض الأحمال على السيادية.", tr: "Hibrit; bazı iş yükleri egemen üzerinde." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Multi-region sovereign + public cloud capable.", ar: "متعدد المناطق سيادية + سحابة عامة.", tr: "Çok bölgeli egemen + genel bulut yeteneği." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Production-grade sovereign + on-prem with auto-failover.", ar: "سيادية وداخلية بمستوى إنتاج مع تجاوز فشل آلي.", tr: "Otomatik yedeklemeli üretim seviyesinde egemen + şirket içi." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "mvi.cl3",
          prompt: { en: "IaC + observability maturity?", ar: "نضج البنية ككود والمراقبة؟", tr: "IaC + gözlemlenebilirlik olgunluğu?" },
          options: [
            { id: "a", label: { en: "Mostly manual provisioning + log files.", ar: "غالباً يدوي + ملفات سجل.", tr: "Çoğunlukla manuel sağlama + günlük dosyaları." }, score: 1 },
            { id: "b", label: { en: "Some Terraform + APM tools.", ar: "بعض Terraform + أدوات APM.", tr: "Bir miktar Terraform + APM araçları." }, score: 2 },
            { id: "c", label: { en: "IaC for new workloads + centralized observability.", ar: "IaC للأحمال الجديدة + مراقبة مركزية.", tr: "Yeni iş yükleri için IaC + merkezi gözlemlenebilirlik." }, score: 3 },
            { id: "d", label: { en: "Policy-as-code + SLO-driven ops.", ar: "سياسات ككود + عمليات قائمة على SLOs.", tr: "Kod olarak politika + SLO odaklı operasyonlar." }, score: 4 },
            { id: "e", label: { en: "Policy-as-code, OpenTelemetry-everywhere, AI-assisted incident triage.", ar: "سياسات ككود، OpenTelemetry في كل مكان، فرز حوادث بمساعدة AI.", tr: "Kod olarak politika, her yerde OpenTelemetry, AI destekli olay sınıflandırma." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "risk",
      title: { en: "Risk, Compliance & Sovereign Code", ar: "المخاطر والامتثال وسيادة الكود", tr: "Risk, Uyum ve Egemen Kod" },
      weight: 0.10,
      description: { en: "SAST/DAST, secret scanning, sovereign-cloud constraints, regulated workloads.", ar: "SAST/DAST، فحص الأسرار، قيود السحابة السيادية، الأحمال المنظمة.", tr: "SAST/DAST, sır taraması, egemen bulut kısıtlamaları, düzenlenmiş iş yükleri." },
      questions: [
        {
          id: "mvi.r1",
          prompt: { en: "Application security in CI/CD?", ar: "أمن التطبيقات في CI/CD؟", tr: "CI/CD'de uygulama güvenliği?" },
          options: [
            { id: "a", label: { en: "Manual audits only.", ar: "تدقيقات يدوية فقط.", tr: "Yalnızca manuel denetimler." }, score: 1 },
            { id: "b", label: { en: "SAST in some pipelines.", ar: "SAST في بعض الأنابيب.", tr: "Bazı veri hatlarında SAST." }, score: 2 },
            { id: "c", label: { en: "SAST + secret scanning across most.", ar: "SAST + فحص أسرار في الغالب.", tr: "Çoğunda SAST + sır taraması." }, score: 3 },
            { id: "d", label: { en: "SAST + DAST + SCA + secrets across all.", ar: "SAST + DAST + SCA + أسرار في الكل.", tr: "Tümünde SAST + DAST + SCA + sırlar." }, score: 4 },
            { id: "e", label: { en: "Shift-left + runtime protection + automated remediation.", ar: "Shift-left + حماية وقت التشغيل + معالجة آلية.", tr: "Sola kaydırma + çalışma zamanı koruması + otomatik iyileştirme." }, score: 5 },
          ],
        },
        {
          id: "mvi.r2",
          prompt: { en: "Posture for regulated workloads (PDPL, SAMA, CBUAE)?", ar: "وضع الأحمال المنظمة (PDPL، SAMA، CBUAE)؟", tr: "Düzenlenmiş iş yükleri için duruş (PDPL, SAMA, CBUAE)?" },
          options: [
            { id: "a", label: { en: "Awareness only.", ar: "وعي فقط.", tr: "Yalnızca farkındalık." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Some controls in regulated apps.", ar: "بعض الضوابط في التطبيقات المنظمة.", tr: "Düzenlenmiş uygulamalarda bazı kontroller." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Compliance baseline templates.", ar: "قوالب أساس امتثال.", tr: "Uyum temel şablonları." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Continuous compliance with attestations.", ar: "امتثال مستمر مع شهادات.", tr: "Tasdiklerle sürekli uyum." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Sovereign-by-default + continuous attestation evidence per release.", ar: "سيادي افتراضياً + أدلة شهادات لكل إصدار.", tr: "Varsayılan olarak egemen + her sürüm için sürekli tasdik kanıtı." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "talent",
      title: { en: "Talent, Change & Operating Model", ar: "المواهب والتغيير ونموذج التشغيل", tr: "Yetenek, Değişim ve İşletim Modeli" },
      weight: 0.15,
      description: { en: "Re-skilling, vendor mix, in-source/out-source ratio, agile maturity.", ar: "إعادة التأهيل، مزيج الموردين، نسبة الداخلي/الخارجي، نضج الرشاقة.", tr: "Yeniden beceri kazandırma, tedarikçi karışımı, içerden/dışarıdan oranı, çevik olgunluk." },
      questions: [
        {
          id: "mvi.t1",
          prompt: { en: "In-source vs. out-source engineering ratio?", ar: "نسبة الهندسة الداخلية مقابل الخارجية؟", tr: "İçerden vs. dışarıdan mühendislik oranı?" },
          options: [
            { id: "a", label: { en: ">80% outsourced.", ar: "أكثر من 80% خارجي.", tr: ">%80 dış kaynak." }, score: 1 },
            { id: "b", label: { en: "60–80% outsourced.", ar: "60–80% خارجي.", tr: "%60–80 dış kaynak." }, score: 2 },
            { id: "c", label: { en: "40–60% outsourced.", ar: "40–60% خارجي.", tr: "%40–60 dış kaynak." }, score: 3 },
            { id: "d", label: { en: "20–40% outsourced.", ar: "20–40% خارجي.", tr: "%20–40 dış kaynak." }, score: 4 },
            { id: "e", label: { en: "<20% outsourced; product-led in-house engineering.", ar: "أقل من 20% خارجي؛ هندسة داخلية بقيادة المنتج.", tr: "<%20 dış kaynak; ürün liderliğinde şirket içi mühendislik." }, score: 5 },
          ],
        },
        {
          id: "mvi.t2",
          prompt: { en: "Engineering operating model?", ar: "نموذج تشغيل الهندسة؟", tr: "Mühendislik işletim modeli?" },
          options: [
            { id: "a", label: { en: "Project-based delivery.", ar: "تسليم قائم على المشاريع.", tr: "Proje tabanlı teslimat." }, score: 1 },
            { id: "b", label: { en: "Mix of project + product squads.", ar: "مزيج مشاريع وفرق منتج.", tr: "Proje + ürün ekiplerinin karışımı." }, score: 2 },
            { id: "c", label: { en: "Product squads with platform support.", ar: "فرق منتج مع دعم المنصة.", tr: "Platform desteğine sahip ürün ekipleri." }, score: 3 },
            { id: "d", label: { en: "Stream-aligned + platform + enabling teams (Team Topologies).", ar: "فرق محاذاة + منصة + تمكين (Team Topologies).", tr: "Akışa hizalı + platform + etkinleştirici ekipler (Team Topologies)." }, score: 4 },
            { id: "e", label: { en: "Topologies model + AI agents embedded as 'team members'.", ar: "نموذج Topologies + وكلاء AI كأعضاء فريق.", tr: "'Ekip üyeleri' olarak gömülü AI ajanları + Topologies modeli." }, score: 5 },
          ],
        },
        {
          id: "mvi.t3",
          prompt: { en: "AI-era reskilling for engineers?", ar: "إعادة تأهيل المهندسين لعصر الذكاء الاصطناعي؟", tr: "Mühendisler için AI çağı yeniden becerilendirme?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Optional Copilot training.", ar: "تدريب اختياري على Copilot.", tr: "İsteğe bağlı Copilot eğitimi." }, score: 2 },
            { id: "c", label: { en: "Mandatory baseline + role-specific paths.", ar: "تدريب أساسي إلزامي + مسارات حسب الدور.", tr: "Zorunlu temel + role özel yollar." }, score: 3 },
            { id: "d", label: { en: "Funded reskilling tied to certifications.", ar: "إعادة تأهيل ممول مرتبط بالشهادات.", tr: "Sertifikasyonlara bağlı finanse edilen yeniden becerilendirme." }, score: 4 },
            { id: "e", label: { en: "Continuous learning with internal AI engineering certification.", ar: "تعلم مستمر مع شهادات هندسة AI داخلية.", tr: "Dahili AI mühendislik sertifikasyonu ile sürekli öğrenme." }, score: 5 },
          ],
        },
      ],
    },
  ],
  recommendations: {
    portfolio: {
      Nascent: {
        quickWins90d: [{ en: "Pick one critical legacy system and run AI-driven spec extraction this quarter.", ar: "اختيار نظام قديم حرج واحد وتشغيل استخراج مواصفات بالذكاء الاصطناعي هذا الربع.", tr: "Bir kritik eski sistem seçin ve bu çeyrekte AI odaklı spesifikasyon çıkarımı yürütün." }],
        roadmap6m: [{ en: "Stand up a living application inventory with automated discovery.", ar: "تأسيس جرد تطبيقات حي باكتشاف آلي.", tr: "Otomatik keşifli canlı bir uygulama envanteri kurun." }],
        strategic12m: [{ en: "Real-time dependency graph powering impact analysis for every release.", ar: "رسم اعتماديات لحظي يقود تحليل الأثر لكل إصدار.", tr: "Her sürüm için etki analizini güçlendiren gerçek zamanlı bağımlılık grafiği." }],
      },
      Emerging: {
        quickWins90d: [{ en: "Joint IT + business criticality matrix for top 30 apps.", ar: "مصفوفة أهمية مشتركة لأعلى 30 تطبيقاً.", tr: "İlk 30 uygulama için ortak BT + iş kritiklik matrisi." }],
        roadmap6m: [{ en: "Risk-weighted modernization roadmap signed off by ExCo.", ar: "خارطة طريق تحديث مرجحة بالمخاطر معتمدة من ExCo.", tr: "ExCo tarafından onaylanmış risk ağırlıklı modernizasyon yol haritası." }],
        strategic12m: [{ en: "Continuous portfolio re-prioritization tied to enterprise risk.", ar: "إعادة ترتيب أولويات مستمرة مرتبطة بمخاطر المؤسسة.", tr: "Kurumsal riske bağlı sürekli portföy yeniden önceliklendirme." }],
      },
    },
    "ai-sdlc": {
      Nascent: {
        quickWins90d: [{ en: "Roll out a sanctioned AI coding assistant to 100% of engineers in 60 days.", ar: "نشر مساعد كود AI معتمد لجميع المهندسين خلال 60 يوماً.", tr: "60 gün içinde mühendislerin %100'üne onaylı bir AI kodlama asistanı sunun." }],
        roadmap6m: [{ en: "Standardize AI code review (security, secrets) across all repos.", ar: "توحيد مراجعة الكود بالذكاء الاصطناعي عبر جميع المستودعات.", tr: "Tüm depolarda AI kod incelemesini (güvenlik, sırlar) standartlaştırın." }],
        strategic12m: [{ en: "Agentic refactoring + AI test generation in CI as standard.", ar: "إعادة هيكلة وكيلية + توليد اختبارات في CI كقياس.", tr: "Standart olarak CI'da ajansal yeniden yapılandırma + AI test üretimi." }],
      },
      Emerging: {
        quickWins90d: [{ en: "Add AI-driven legacy spec extraction to your modernization runbook.", ar: "إضافة استخراج مواصفات بالذكاء الاصطناعي إلى دليل التحديث.", tr: "Modernizasyon kılavuzunuza AI odaklı eski sistem spesifikasyon çıkarımını ekleyin." }],
        roadmap6m: [{ en: "Move AI test generation from optional to mandatory on critical paths.", ar: "نقل توليد الاختبارات من اختياري إلى إلزامي على المسارات الحرجة.", tr: "Kritik yollarda AI test üretimini isteğe bağlıdan zorunluya taşıyın." }],
        strategic12m: [{ en: "Operate role-customized AI workflows + agentic refactoring at scale.", ar: "تشغيل تدفقات AI مخصصة للدور + إعادة هيكلة وكيلية على نطاق واسع.", tr: "Geniş ölçekte role özelleştirilmiş AI iş akışları + ajansal yeniden yapılandırma işletin." }],
      },
    },
    devex: {
      Nascent: {
        quickWins90d: [{ en: "Instrument all four DORA metrics this quarter.", ar: "ضبط مقاييس DORA الأربعة هذا الربع.", tr: "Bu çeyrekte dört DORA metriğinin tamamını araçlandırın." }],
        roadmap6m: [{ en: "Stand up a Backstage-class IDP with 5 golden paths.", ar: "تأسيس IDP من فئة Backstage مع 5 مسارات ذهبية.", tr: "5 altın yolla Backstage sınıfı bir IDP kurun." }],
        strategic12m: [{ en: "Embed AI assistants into IDP scorecards.", ar: "تضمين AI في بطاقات IDP.", tr: "IDP puan kartlarına AI asistanlarını gömün." }],
      },
    },
    cloud: {
      Nascent: {
        quickWins90d: [{ en: "Containerize 5 Tier-1 workloads.", ar: "وضع 5 أحمال من المستوى الأول في حاويات.", tr: "5 Tier-1 iş yükünü konteynerleştirin." }],
        roadmap6m: [{ en: "Adopt IaC for new workloads + central observability.", ar: "تبنّي IaC للأحمال الجديدة + مراقبة مركزية.", tr: "Yeni iş yükleri için IaC + merkezi gözlemlenebilirlik benimseyin." }],
        strategic12m: [{ en: "Stand up sovereign-capable hybrid cloud with auto-failover.", ar: "تأسيس سحابة هجينة سيادية مع تجاوز فشل آلي.", tr: "Otomatik yedeklemeli egemenlik destekli hibrit bulut kurun." }],
      },
    },
    risk: {
      Nascent: {
        quickWins90d: [{ en: "SAST + secret scanning across all repos in 60 days.", ar: "SAST + فحص أسرار عبر جميع المستودعات خلال 60 يوماً.", tr: "60 gün içinde tüm depolarda SAST + sır taraması." }],
        roadmap6m: [{ en: "Compliance baseline templates for PDPL/SAMA workloads.", ar: "قوالب أساس امتثال لـ PDPL/SAMA.", tr: "PDPL/SAMA iş yükleri için uyum temel şablonları." }],
        strategic12m: [{ en: "Sovereign-by-default + continuous attestation per release.", ar: "سيادي افتراضياً + شهادات مستمرة لكل إصدار.", tr: "Varsayılan olarak egemen + her sürümde sürekli tasdik." }],
      },
    },
    talent: {
      Nascent: {
        quickWins90d: [{ en: "Mandatory AI-engineer baseline training for 100% of engineers.", ar: "تدريب أساسي إلزامي لكل المهندسين.", tr: "Mühendislerin %100'ü için zorunlu AI mühendisi temel eğitimi." }],
        roadmap6m: [{ en: "Stream-aligned product squads + platform team established.", ar: "تأسيس فرق منتج محاذاة + فريق منصة.", tr: "Akışa hizalı ürün ekipleri + platform ekibi kuruldu." }],
        strategic12m: [{ en: "Reduce outsourced ratio to <40%; AI agents embedded as team members.", ar: "خفض نسبة الخارجي لأقل من 40%؛ وكلاء AI كأعضاء فريق.", tr: "Dış kaynak oranını <%40'a düşürün; ekip üyeleri olarak gömülü AI ajanları." }],
      },
    },
    coverage: {
      Nascent: {
        quickWins90d: [{ en: "Drive AI-generated unit tests to 50% coverage on Tier-1 systems.", ar: "رفع تغطية اختبارات الوحدة AI لـ 50% على أنظمة المستوى الأول.", tr: "Tier-1 sistemlerde AI tarafından oluşturulan birim testlerini %50 kapsama çıkarın." }],
        roadmap6m: [{ en: "AI-generated specs as living documentation source-of-truth.", ar: "مواصفات AI كمصدر موثوق للوثائق الحية.", tr: "Canlı dokümantasyonun doğruluk kaynağı olarak AI tarafından oluşturulan spesifikasyonlar." }],
        strategic12m: [{ en: "Continuous AI test generation with coverage SLAs in CI.", ar: "توليد اختبارات AI مستمر مع SLAs في CI.", tr: "CI'da kapsam SLA'leri ile sürekli AI test üretimi." }],
      },
    },
  },
};
