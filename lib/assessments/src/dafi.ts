import type { AssessmentDefinition } from "./types";

export const dafi: AssessmentDefinition = {
  slug: "dafi",
  serviceSlug: "data-governance-foundations",
  code: "DAFI",
  brandColor: "#0F9ED5",
  estMinutes: 13,
  title: { en: "Data & AI Foundations Index", ar: "مؤشر أساسات البيانات والذكاء الاصطناعي", tr: "Veri ve AI Temelleri Endeksi" },
  subtitle: {
    en: "How sound are the data and governance foundations underneath your AI ambitions?",
    ar: "ما مدى متانة أساسات البيانات والحوكمة تحت طموحاتكم في الذكاء الاصطناعي؟",
    tr: "AI hedeflerinizin altındaki veri ve yönetişim temelleri ne kadar sağlam?",
  },
  description: {
    en: "Aligned with Deloitte's 5×28 Digital Maturity Model, McKinsey's Data Quotient, and the EDM Council DCAM — adapted for GCC sovereign realities.",
    ar: "متوافق مع نموذج Deloitte الرقمي 5×28، ومعامل البيانات لـ McKinsey، وإطار DCAM — مع تكييف للواقع السيادي الخليجي.",
    tr: "Deloitte'un 5×28 Dijital Olgunluk Modeli, McKinsey'in Veri Katsayısı ve EDM Council DCAM ile uyumlu — GCC egemenlik gerçekliklerine uyarlanmıştır.",
  },
  memoPromptHint:
    "Frame the memo around data foundations as the first thing AI exposes. Reference PDPL, SAMA, CBUAE, SDAIA where relevant.",
  antiVendor: {
    en: [
      "If your goal is a multi-year data warehouse modernization with a single hyperscaler, talk to Deloitte or PwC.",
      "If you need an SAP MDM rollout exclusively, an SAP-certified SI is the right fit.",
      "If you're optimizing for the lowest tooling license cost, you'll find cheaper data integrators than us.",
    ],
    ar: [
      "إذا كان الهدف تحديث مستودع بيانات لعدة سنوات مع مزود سحابي واحد، تحدثوا مع Deloitte أو PwC.",
      "إذا كنتم بحاجة لطرح SAP MDM حصراً، فإن SI معتمداً من SAP هو الأنسب.",
      "إذا كنتم تبحثون عن أرخص رخص أدوات، ستجدون مكاملي بيانات أرخص منا.",
    ],
    tr: [
      "Hedefiniz tek bir hiperskaler ile çok yıllı bir veri ambarı modernizasyonu ise, Deloitte veya PwC ile görüşün.",
      "Yalnızca bir SAP MDM kurulumuna ihtiyacınız varsa, SAP sertifikalı bir SI doğru tercihtir.",
      "En düşük araç lisans maliyeti için optimize ediyorsanız, bizden daha ucuz veri entegratörleri bulacaksınız.",
    ],
  },
  dimensions: [
    {
      id: "strategy",
      title: { en: "Data Strategy & Operating Model", ar: "استراتيجية البيانات ونموذج التشغيل", tr: "Veri Stratejisi ve İşletim Modeli" },
      weight: 0.15,
      description: { en: "CDO/CAO role, data product orientation, federated vs. centralized.", ar: "دور CDO/CAO، توجه منتج البيانات، اتحادي مقابل مركزي.", tr: "CDO/CAO rolü, veri ürünü yönelimi, federe vs. merkezi." },
      questions: [
        {
          id: "dafi.s1",
          prompt: { en: "Senior accountability for data?", ar: "المساءلة العليا عن البيانات؟", tr: "Veri için kıdemli hesap verebilirlik?" },
          options: [
            { id: "a", label: { en: "No senior owner.", ar: "لا يوجد مالك أعلى.", tr: "Kıdemli sahip yok." }, score: 1 },
            { id: "b", label: { en: "CIO carries it informally.", ar: "يتولاها CIO بشكل غير رسمي.", tr: "CIO gayri resmi olarak üstleniyor." }, score: 2 },
            { id: "c", label: { en: "CDO/CAO appointed but limited mandate.", ar: "CDO/CAO معيّن لكن صلاحيته محدودة.", tr: "CDO/CAO atanmış ancak yetkisi sınırlı." }, score: 3 },
            { id: "d", label: { en: "CDO with P&L authority and seat at ExCo.", ar: "CDO بصلاحية P&L ومقعد في ExCo.", tr: "P&L yetkisi ve ExCo koltuğuna sahip CDO." }, score: 4 },
            { id: "e", label: { en: "CDO + Chief AI Officer with shared OKRs and board reporting.", ar: "CDO + Chief AI Officer بأهداف مشتركة وتقارير للمجلس.", tr: "Ortak OKR'lar ve yönetim kurulu raporlamasına sahip CDO + Baş AI Sorumlusu." }, score: 5 },
          ],
        },
        {
          id: "dafi.s2",
          prompt: { en: "Data product orientation?", ar: "توجه منتج البيانات؟", tr: "Veri ürünü yönelimi?" },
          options: [
            { id: "a", label: { en: "Pure project delivery.", ar: "تسليم مشاريع فقط.", tr: "Yalnızca proje teslimatı." }, score: 1 },
            { id: "b", label: { en: "Some named datasets treated as assets.", ar: "بعض مجموعات البيانات تُعامل كأصول.", tr: "Bazı adlandırılmış veri setleri varlık olarak ele alınır." }, score: 2 },
            { id: "c", label: { en: "Data product owners on key domains.", ar: "ملاك منتج بيانات للمجالات الرئيسية.", tr: "Önemli alanlarda veri ürünü sahipleri." }, score: 3 },
            { id: "d", label: { en: "Data products with SLAs, contracts, and feedback loops.", ar: "منتجات بيانات بـ SLAs وعقود وحلقات تغذية راجعة.", tr: "SLA'ler, sözleşmeler ve geri bildirim döngülerine sahip veri ürünleri." }, score: 4 },
            { id: "e", label: { en: "Federated data mesh with chargeback and discoverability.", ar: "Data mesh اتحادي مع إعادة تحميل تكلفة واكتشاف.", tr: "Geri yükleme ve keşfedilebilirlik ile federe veri ağı." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "platform",
      title: { en: "Data Architecture & Platforms", ar: "معمارية ومنصات البيانات", tr: "Veri Mimarisi ve Platformları" },
      weight: 0.15,
      description: { en: "Lakehouse, mesh, real-time, vector store, sovereign-cloud posture.", ar: "Lakehouse، mesh، الزمن الحقيقي، مخزن متجهات، الوضع السيادي.", tr: "Lakehouse, mesh, gerçek zamanlı, vektör deposu, egemen bulut duruşu." },
      questions: [
        {
          id: "dafi.p1",
          prompt: { en: "Primary analytic data platform?", ar: "منصة البيانات التحليلية الرئيسية؟", tr: "Birincil analitik veri platformu?" },
          options: [
            { id: "a", label: { en: "Mostly RDBMS / file shares.", ar: "غالباً RDBMS / مشاركات ملفات.", tr: "Çoğunlukla RDBMS / dosya paylaşımları." }, score: 1 },
            { id: "b", label: { en: "On-prem warehouse.", ar: "مستودع داخلي.", tr: "Şirket içi veri ambarı." }, score: 2 },
            { id: "c", label: { en: "Cloud warehouse + lake.", ar: "مستودع سحابي + بحيرة.", tr: "Bulut ambarı + göl." }, score: 3 },
            { id: "d", label: { en: "Lakehouse (Databricks/Snowflake/Fabric).", ar: "Lakehouse (Databricks/Snowflake/Fabric).", tr: "Lakehouse (Databricks/Snowflake/Fabric)." }, score: 4 },
            { id: "e", label: { en: "Lakehouse + mesh + production vector store + real-time.", ar: "Lakehouse + mesh + مخزن متجهات إنتاجي + زمن حقيقي.", tr: "Lakehouse + mesh + üretim vektör deposu + gerçek zamanlı." }, score: 5 },
          ],
        },
        {
          id: "dafi.p2",
          prompt: { en: "Sovereign / on-prem analytic capability?", ar: "قدرة تحليلية سيادية/داخلية؟", tr: "Egemen / şirket içi analitik kapasite?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا توجد.", tr: "Yok." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Limited; on-prem warehouse only.", ar: "محدود؛ مستودع داخلي فقط.", tr: "Sınırlı; yalnızca şirket içi ambar." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Hybrid; sensitive data stays sovereign.", ar: "هجين؛ البيانات الحساسة على السيادي.", tr: "Hibrit; hassas veriler egemen kalır." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Sovereign-first lakehouse with public cloud burst.", ar: "Lakehouse سيادي أولاً مع توسعة سحابة عامة.", tr: "Genel bulut taşmasıyla egemen-öncelikli lakehouse." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Multi-region sovereign + air-gapped capability.", ar: "متعدد المناطق سيادي + قدرة معزولة هوائياً.", tr: "Çok bölgeli egemen + hava boşluklu yetenek." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "mdm",
      title: { en: "Master & Reference Data / Lineage", ar: "البيانات الرئيسية والمرجعية / النسب", tr: "Ana ve Referans Verileri / Soy Bilgisi" },
      weight: 0.15,
      description: { en: "Customer/product/party MDM, lineage tooling, golden source.", ar: "MDM للعميل/المنتج/الطرف، أدوات النسب، المصدر الذهبي.", tr: "Müşteri/ürün/taraf MDM, soy bilgisi araçları, altın kaynak." },
      questions: [
        {
          id: "dafi.m1",
          prompt: { en: "Master data on critical entities (customer/party/product)?", ar: "البيانات الرئيسية للكيانات الحرجة؟", tr: "Kritik varlıklarda ana veriler (müşteri/taraf/ürün)?" },
          options: [
            { id: "a", label: { en: "Multiple sources, no mastering.", ar: "مصادر متعددة بدون توحيد.", tr: "Birden fazla kaynak, ana veri yok." }, score: 1 },
            { id: "b", label: { en: "Some manual reconciliation.", ar: "بعض التوفيق اليدوي.", tr: "Bir miktar manuel mutabakat." }, score: 2 },
            { id: "c", label: { en: "MDM tooling for 1–2 domains.", ar: "MDM لمجال أو اثنين.", tr: "1–2 alan için MDM aracı." }, score: 3 },
            { id: "d", label: { en: "Mastered customer + product + party.", ar: "موحَّد للعميل + المنتج + الطرف.", tr: "Müşteri + ürün + taraf ana verileri." }, score: 4 },
            { id: "e", label: { en: "AI-assisted mastering with continuous identity resolution.", ar: "توحيد بمساعدة AI مع حل هوية مستمر.", tr: "Sürekli kimlik çözümlemesi ile AI destekli ana veri yönetimi." }, score: 5 },
          ],
        },
        {
          id: "dafi.m2",
          prompt: { en: "Data lineage tooling?", ar: "أدوات نسب البيانات؟", tr: "Veri soy bilgisi aracı?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Manual lineage for compliance use cases only.", ar: "نسب يدوي لحالات الامتثال فقط.", tr: "Yalnızca uyum kullanım senaryoları için manuel soy bilgisi." }, score: 2 },
            { id: "c", label: { en: "Catalog-driven lineage on top platforms.", ar: "نسب بقيادة الكاتالوج على المنصات الرئيسية.", tr: "Üst platformlarda katalog odaklı soy bilgisi." }, score: 3 },
            { id: "d", label: { en: "End-to-end automated lineage including BI and ML features.", ar: "نسب آلي شامل يضم BI وميزات ML.", tr: "BI ve ML özellikleri dahil uçtan uca otomatik soy bilgisi." }, score: 4 },
            { id: "e", label: { en: "Real-time lineage feeding AI guardrails and impact analysis.", ar: "نسب لحظي يغذي حواجز AI وتحليل الأثر.", tr: "AI korkuluklarını ve etki analizini besleyen gerçek zamanlı soy bilgisi." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "quality",
      title: { en: "Data Quality & Observability", ar: "جودة البيانات والمراقبة", tr: "Veri Kalitesi ve Gözlemlenebilirlik" },
      weight: 0.10,
      description: { en: "DQ rules, profiling, SLAs, observability tools.", ar: "قواعد جودة البيانات، التوصيف، SLAs، أدوات المراقبة.", tr: "Veri kalitesi kuralları, profil oluşturma, SLA'ler, gözlemlenebilirlik araçları." },
      questions: [
        {
          id: "dafi.q1",
          prompt: { en: "Data quality measurement?", ar: "قياس جودة البيانات؟", tr: "Veri kalitesi ölçümü?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Periodic profiling on key tables.", ar: "توصيف دوري للجداول الرئيسية.", tr: "Önemli tablolarda dönemsel profil oluşturma." }, score: 2 },
            { id: "c", label: { en: "DQ rules in critical pipelines.", ar: "قواعد جودة في الأنابيب الحرجة.", tr: "Kritik veri hatlarında DQ kuralları." }, score: 3 },
            { id: "d", label: { en: "DQ SLAs with alerting and accountability.", ar: "SLAs لجودة البيانات مع تنبيه ومساءلة.", tr: "Uyarı ve hesap verebilirlikle DQ SLA'leri." }, score: 4 },
            { id: "e", label: { en: "Data observability platform with anomaly detection across all critical assets.", ar: "منصة مراقبة بيانات مع كشف الشذوذ عبر جميع الأصول الحرجة.", tr: "Tüm kritik varlıklarda anomali tespitiyle veri gözlemlenebilirlik platformu." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "governance",
      title: { en: "Data Governance, Privacy & Compliance", ar: "حوكمة البيانات والخصوصية والامتثال", tr: "Veri Yönetişimi, Gizlilik ve Uyum" },
      weight: 0.15,
      description: { en: "PDPL, SAMA, CBUAE, SDAIA, classification, consent.", ar: "PDPL، SAMA، CBUAE، SDAIA، التصنيف، الموافقة.", tr: "PDPL, SAMA, CBUAE, SDAIA, sınıflandırma, onay." },
      questions: [
        {
          id: "dafi.g1",
          prompt: { en: "PDPL (KSA/UAE) compliance posture?", ar: "وضع الامتثال لـ PDPL (السعودية/الإمارات)؟", tr: "PDPL (KSA/BAE) uyum duruşu?" },
          options: [
            { id: "a", label: { en: "Awareness only.", ar: "وعي فقط.", tr: "Yalnızca farkındalık." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Gap analysis underway.", ar: "تحليل فجوات قيد التنفيذ.", tr: "Boşluk analizi devam ediyor." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Controls implemented in major systems.", ar: "ضوابط مطبقة في الأنظمة الرئيسية.", tr: "Önemli sistemlerde kontroller uygulandı." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Continuous compliance with annual third-party audit.", ar: "امتثال مستمر مع تدقيق سنوي من طرف ثالث.", tr: "Yıllık üçüncü taraf denetimi ile sürekli uyum." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "PDPL-aware controls embedded by default; attested per release.", ar: "ضوابط واعية بـ PDPL افتراضياً؛ مصدّقة لكل إصدار.", tr: "PDPL bilinçli kontroller varsayılan olarak gömülü; her sürümde tasdikli." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "dafi.g2",
          prompt: { en: "Sectoral compliance (SAMA / CBUAE / SDAIA / NHRA)?", ar: "الامتثال القطاعي (SAMA / CBUAE / SDAIA / NHRA)؟", tr: "Sektörel uyum (SAMA / CBUAE / SDAIA / NHRA)?" },
          options: [
            { id: "a", label: { en: "Not applicable or not addressed.", ar: "غير منطبق أو غير معالج.", tr: "Geçerli değil veya ele alınmamış." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Limited to one regulation set.", ar: "محدود بمجموعة تنظيمية واحدة.", tr: "Tek bir düzenleme setiyle sınırlı." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Mapped controls across required regulators.", ar: "ضوابط معينة عبر المنظمين المطلوبين.", tr: "Gereken düzenleyicilerde haritalandırılmış kontroller." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Continuous compliance with regulator-grade reporting.", ar: "امتثال مستمر مع تقارير بمستوى المنظم.", tr: "Düzenleyici düzeyinde raporlamayla sürekli uyum." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Regulator-praised posture; reference engagements published.", ar: "وضع يثني عليه المنظم؛ نشر مرجعيات.", tr: "Düzenleyici tarafından övülen duruş; yayımlanmış referans çalışmaları." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "dafi.g3",
          prompt: { en: "Data classification and consent?", ar: "تصنيف البيانات والموافقة؟", tr: "Veri sınıflandırma ve onay?" },
          options: [
            { id: "a", label: { en: "No formal classification.", ar: "لا تصنيف رسمي.", tr: "Resmi sınıflandırma yok." }, score: 1 },
            { id: "b", label: { en: "Manual labels in some systems.", ar: "تسميات يدوية في بعض الأنظمة.", tr: "Bazı sistemlerde manuel etiketler." }, score: 2 },
            { id: "c", label: { en: "Tag-based classification on critical stores.", ar: "تصنيف بالعلامات على المخازن الحرجة.", tr: "Kritik depolarda etiket tabanlı sınıflandırma." }, score: 3 },
            { id: "d", label: { en: "Automated classification + consent management.", ar: "تصنيف آلي + إدارة موافقة.", tr: "Otomatik sınıflandırma + onay yönetimi." }, score: 4 },
            { id: "e", label: { en: "Continuous classification + consent honored across AI inference.", ar: "تصنيف مستمر + احترام الموافقة عبر استدلال AI.", tr: "Sürekli sınıflandırma + AI çıkarımında onaya uyulması." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "mlops",
      title: { en: "AI/ML Engineering & MLOps", ar: "هندسة الذكاء الاصطناعي و MLOps", tr: "AI/ML Mühendisliği ve MLOps" },
      weight: 0.15,
      description: { en: "Feature store, model registry, eval pipelines, GenAI ops.", ar: "متجر الميزات، سجل النماذج، أنابيب التقييم، عمليات GenAI.", tr: "Özellik deposu, model kayıt defteri, değerlendirme hatları, GenAI operasyonları." },
      questions: [
        {
          id: "dafi.o1",
          prompt: { en: "Model registry + lifecycle management?", ar: "سجل النماذج + إدارة دورة الحياة؟", tr: "Model kayıt defteri + yaşam döngüsü yönetimi?" },
          options: [
            { id: "a", label: { en: "None; models live on engineer laptops.", ar: "لا يوجد؛ النماذج على أجهزة المهندسين.", tr: "Yok; modeller mühendis dizüstü bilgisayarlarında." }, score: 1 },
            { id: "b", label: { en: "Notebooks committed to git.", ar: "Notebooks في git.", tr: "Git'e işlenmiş notebook'lar." }, score: 2 },
            { id: "c", label: { en: "Model registry (MLflow / Vertex / Bedrock).", ar: "سجل نماذج.", tr: "Model kayıt defteri (MLflow / Vertex / Bedrock)." }, score: 3 },
            { id: "d", label: { en: "Registry + automated promotion + drift monitoring.", ar: "سجل + ترقية آلية + مراقبة انحراف.", tr: "Kayıt defteri + otomatik terfi + sapma izleme." }, score: 4 },
            { id: "e", label: { en: "End-to-end MLOps incl. GenAI ops, eval suites, prompt registries.", ar: "MLOps شامل بما في ذلك GenAI، تقييمات، سجل أوامر.", tr: "GenAI operasyonları, değerlendirme paketleri ve prompt kayıt defterleri dahil uçtan uca MLOps." }, score: 5 },
          ],
        },
        {
          id: "dafi.o2",
          prompt: { en: "Feature store?", ar: "متجر الميزات؟", tr: "Özellik deposu?" },
          options: [
            { id: "a", label: { en: "Not used.", ar: "غير مستخدم.", tr: "Kullanılmıyor." }, score: 1 },
            { id: "b", label: { en: "Considering it.", ar: "قيد الدراسة.", tr: "Değerlendiriliyor." }, score: 2 },
            { id: "c", label: { en: "Feature store in pilot.", ar: "متجر ميزات تجريبي.", tr: "Pilot aşamada özellik deposu." }, score: 3 },
            { id: "d", label: { en: "Feature store powering production models.", ar: "متجر ميزات يقود نماذج إنتاج.", tr: "Üretim modellerini besleyen özellik deposu." }, score: 4 },
            { id: "e", label: { en: "Online + offline feature parity with governance.", ar: "تكافؤ ميزات أونلاين/أوفلاين مع حوكمة.", tr: "Yönetişimle çevrimiçi + çevrimdışı özellik paritesi." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "ethics",
      title: { en: "Trust, Ethics & Responsible AI", ar: "الثقة والأخلاق والذكاء الاصطناعي المسؤول", tr: "Güven, Etik ve Sorumlu AI" },
      weight: 0.10,
      description: { en: "Bias testing, explainability, model cards, human oversight.", ar: "اختبار التحيز، القابلية للتفسير، بطاقات النماذج، الإشراف البشري.", tr: "Önyargı testi, açıklanabilirlik, model kartları, insan denetimi." },
      questions: [
        {
          id: "dafi.e1",
          prompt: { en: "Bias and fairness testing?", ar: "اختبار التحيز والإنصاف؟", tr: "Önyargı ve adalet testi?" },
          options: [
            { id: "a", label: { en: "Not done.", ar: "غير مُجرى.", tr: "Yapılmıyor." }, score: 1 },
            { id: "b", label: { en: "Manual reviews.", ar: "مراجعات يدوية.", tr: "Manuel incelemeler." }, score: 2 },
            { id: "c", label: { en: "Bias tests on high-risk models.", ar: "اختبارات تحيز للنماذج عالية المخاطر.", tr: "Yüksek riskli modellerde önyargı testleri." }, score: 3 },
            { id: "d", label: { en: "Standardized fairness suite gating production.", ar: "مجموعة إنصاف موحدة كبوابة للإنتاج.", tr: "Üretim için kapı görevi gören standart adalet paketi." }, score: 4 },
            { id: "e", label: { en: "Fairness + explainability + monitoring across the model lifecycle.", ar: "إنصاف + تفسير + مراقبة عبر دورة حياة النموذج.", tr: "Model yaşam döngüsü boyunca adalet + açıklanabilirlik + izleme." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "literacy",
      title: { en: "Talent, Literacy & Culture", ar: "المواهب والإلمام والثقافة", tr: "Yetenek, Okuryazarlık ve Kültür" },
      weight: 0.05,
      description: { en: "Data literacy, citizen-developer enablement, hiring pipeline.", ar: "إلمام البيانات، تمكين المطور المواطن، خط التوظيف.", tr: "Veri okuryazarlığı, vatandaş-geliştirici desteği, işe alım hattı." },
      questions: [
        {
          id: "dafi.l1",
          prompt: { en: "Enterprise data literacy?", ar: "إلمام البيانات على مستوى المؤسسة؟", tr: "Kurumsal veri okuryazarlığı?" },
          options: [
            { id: "a", label: { en: "Low; tools used by specialists only.", ar: "منخفض؛ تستخدمها فئات متخصصة فقط.", tr: "Düşük; araçlar yalnızca uzmanlar tarafından kullanılır." }, score: 1 },
            { id: "b", label: { en: "Some BI self-service for analysts.", ar: "بعض BI الذاتي للمحللين.", tr: "Analistler için bir miktar self-servis BI." }, score: 2 },
            { id: "c", label: { en: "Citizen-developer enablement + training tracks.", ar: "تمكين المطور المواطن + مسارات تدريب.", tr: "Vatandaş-geliştirici desteği + eğitim yolları." }, score: 3 },
            { id: "d", label: { en: "Data literacy KPIs by function.", ar: "مؤشرات إلمام بالبيانات حسب الوظيفة.", tr: "Fonksiyona göre veri okuryazarlığı KPI'leri." }, score: 4 },
            { id: "e", label: { en: "Data + AI fluency considered baseline for every hire.", ar: "إلمام بالبيانات والذكاء الاصطناعي كأساس لكل توظيف.", tr: "Her işe alım için veri + AI yetkinliği temel kabul edilir." }, score: 5 },
          ],
        },
      ],
    },
  ],
  recommendations: {
    strategy: {
      Nascent: {
        quickWins90d: [{ en: "Appoint a CDO with explicit P&L authority and ExCo seat.", ar: "تعيين CDO بصلاحية P&L ومقعد في ExCo.", tr: "Açık P&L yetkisi ve ExCo koltuğu olan bir CDO atayın." }],
        roadmap6m: [{ en: "Define data products on top 5 domains with SLAs and contracts.", ar: "تعريف منتجات بيانات لأهم 5 مجالات بـ SLAs وعقود.", tr: "İlk 5 alanda SLA'ler ve sözleşmelerle veri ürünleri tanımlayın." }],
        strategic12m: [{ en: "Stand up a federated data mesh with chargeback and discoverability.", ar: "تأسيس data mesh اتحادي مع إعادة تحميل واكتشاف.", tr: "Geri yükleme ve keşfedilebilirlikle federe bir veri ağı kurun." }],
      },
    },
    platform: {
      Nascent: {
        quickWins90d: [{ en: "Stand up a managed lakehouse (Databricks / Fabric) for one priority domain.", ar: "تأسيس lakehouse مُدار لمجال أولوية واحد.", tr: "Bir öncelikli alan için yönetilen bir lakehouse (Databricks / Fabric) kurun." }],
        roadmap6m: [{ en: "Adopt sovereign-first hybrid posture for sensitive data.", ar: "اعتماد وضع هجين سيادي أولاً للبيانات الحساسة.", tr: "Hassas veriler için egemen-öncelikli hibrit duruş benimseyin." }],
        strategic12m: [{ en: "Production vector store + real-time pipelines feeding agents.", ar: "مخزن متجهات إنتاج + أنابيب لحظية تغذي الوكلاء.", tr: "Üretim vektör deposu + ajanları besleyen gerçek zamanlı veri hatları." }],
      },
    },
    mdm: {
      Nascent: {
        quickWins90d: [{ en: "Run identity-resolution proof on customer entity in 60 days.", ar: "إثبات حل هوية للعميل خلال 60 يوماً.", tr: "60 gün içinde müşteri varlığında kimlik çözümleme kanıtı yürütün." }],
        roadmap6m: [{ en: "Mastered customer + product domains live.", ar: "توحيد مجالات العميل والمنتج في الإنتاج.", tr: "Müşteri + ürün alanları canlı olarak ana veriye alındı." }],
        strategic12m: [{ en: "AI-assisted mastering + automated lineage feeding AI guardrails.", ar: "توحيد بمساعدة AI + نسب آلي يغذي حواجز AI.", tr: "AI destekli ana veri + AI korkuluklarını besleyen otomatik soy bilgisi." }],
      },
    },
    quality: {
      Nascent: {
        quickWins90d: [{ en: "Wire DQ rules into the top 3 critical pipelines.", ar: "وصل قواعد جودة في أهم 3 أنابيب.", tr: "İlk 3 kritik veri hattına DQ kurallarını bağlayın." }],
        roadmap6m: [{ en: "Stand up DQ SLAs with alerting and accountability.", ar: "تأسيس SLAs لجودة البيانات مع تنبيه ومساءلة.", tr: "Uyarı ve hesap verebilirlikle DQ SLA'lerini ayağa kaldırın." }],
        strategic12m: [{ en: "Adopt a data observability platform with anomaly detection.", ar: "تبنّي منصة مراقبة بيانات مع كشف شذوذ.", tr: "Anomali tespitiyle veri gözlemlenebilirlik platformu benimseyin." }],
      },
    },
    governance: {
      Nascent: {
        quickWins90d: [{ en: "Complete a PDPL gap analysis across the top 5 systems.", ar: "إكمال تحليل فجوات PDPL لأعلى 5 أنظمة.", tr: "İlk 5 sistemde PDPL boşluk analizini tamamlayın." }],
        roadmap6m: [{ en: "Implement automated classification + consent management.", ar: "تطبيق تصنيف آلي + إدارة موافقة.", tr: "Otomatik sınıflandırma + onay yönetimi uygulayın." }],
        strategic12m: [{ en: "PDPL/SAMA/CBUAE-aware controls attested per release.", ar: "ضوابط واعية بالأنظمة مصدّقة لكل إصدار.", tr: "Her sürümde PDPL/SAMA/CBUAE bilinçli kontroller tasdiklenir." }],
      },
      Emerging: {
        quickWins90d: [{ en: "Map controls across all required regulators in 60 days.", ar: "ربط الضوابط بكل المنظمين خلال 60 يوماً.", tr: "60 gün içinde tüm gereken düzenleyiciler için kontrolleri haritalandırın." }],
        roadmap6m: [{ en: "Stand up regulator-grade reporting and quarterly attestations.", ar: "تقارير بمستوى المنظم وشهادات ربع سنوية.", tr: "Düzenleyici düzeyinde raporlama ve üç aylık tasdikleri ayağa kaldırın." }],
        strategic12m: [{ en: "Become a published regulator reference for AI governance posture.", ar: "أن تصبحوا مرجعاً منشوراً للمنظم في حوكمة AI.", tr: "AI yönetişim duruşu için yayımlanmış bir düzenleyici referansı olun." }],
      },
    },
    mlops: {
      Nascent: {
        quickWins90d: [{ en: "Adopt a model registry (MLflow / Vertex / Bedrock) for all production models.", ar: "تبنّي سجل نماذج لكل النماذج الإنتاجية.", tr: "Tüm üretim modelleri için bir model kayıt defteri (MLflow / Vertex / Bedrock) benimseyin." }],
        roadmap6m: [{ en: "Add automated promotion + drift monitoring + GenAI eval suites.", ar: "إضافة ترقية آلية + مراقبة انحراف + تقييمات GenAI.", tr: "Otomatik terfi + sapma izleme + GenAI değerlendirme paketleri ekleyin." }],
        strategic12m: [{ en: "End-to-end MLOps incl. prompt registries and feature store parity.", ar: "MLOps شامل يضم سجل أوامر وتكافؤ ميزات.", tr: "Prompt kayıt defterleri ve özellik deposu paritesi dahil uçtan uca MLOps." }],
      },
    },
    ethics: {
      Nascent: {
        quickWins90d: [{ en: "Standardize a fairness suite for high-risk models gating production.", ar: "توحيد مجموعة إنصاف للنماذج عالية المخاطر كبوابة.", tr: "Üretime kapı görevi gören yüksek riskli modeller için bir adalet paketi standartlaştırın." }],
        roadmap6m: [{ en: "Add explainability + monitoring across the model lifecycle.", ar: "إضافة تفسير + مراقبة عبر دورة حياة النموذج.", tr: "Model yaşam döngüsü boyunca açıklanabilirlik + izleme ekleyin." }],
        strategic12m: [{ en: "Publish a Cognirise Verified responsible-AI report annually.", ar: "نشر تقرير Cognirise Verified للذكاء المسؤول سنوياً.", tr: "Yıllık olarak bir Cognirise Verified sorumlu-AI raporu yayımlayın." }],
      },
    },
    literacy: {
      Nascent: {
        quickWins90d: [{ en: "Mandatory data literacy baseline for all managers within 90 days.", ar: "تدريب أساسي إلزامي لإلمام البيانات لجميع المديرين.", tr: "90 gün içinde tüm yöneticiler için zorunlu veri okuryazarlığı temeli." }],
        roadmap6m: [{ en: "Stand up citizen-developer paths with funded training.", ar: "مسارات مطور مواطن بتدريب ممول.", tr: "Finanse edilen eğitimle vatandaş-geliştirici yolları kurun." }],
        strategic12m: [{ en: "Data + AI fluency in every job description.", ar: "إلمام بالبيانات والذكاء في كل توصيف وظيفة.", tr: "Her iş tanımında veri + AI yetkinliği." }],
      },
    },
  },
};
