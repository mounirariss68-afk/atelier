import type { AssessmentDefinition } from "./types";

export const uvr: AssessmentDefinition = {
  slug: "uvr",
  serviceSlug: "ai-strategy-value-engineering",
  code: "UVR",
  brandColor: "#9E480E",
  estMinutes: 10,
  title: { en: "Use-case Value & Readiness", ar: "قيمة وجاهزية حالات الاستخدام", tr: "Kullanım Senaryosu Değer ve Hazırlık" },
  subtitle: {
    en: "Rank up to 3 candidate AI use cases on a Value vs. Readiness portfolio.",
    ar: "رتّبوا حتى 3 حالات استخدام للذكاء الاصطناعي على محفظة القيمة مقابل الجاهزية.",
    tr: "Değer ve Hazırlık portföyünde 3'e kadar AI kullanım senaryosu adayını sıralayın.",
  },
  description: {
    en: "Stop debating use cases in slide form. Score them in 10 minutes against value drivers, organizational readiness, and effort.",
    ar: "اخرجوا من جدل حالات الاستخدام في الشرائح. قيّموها خلال 10 دقائق بمحرّكات القيمة والجاهزية والجهد.",
    tr: "Kullanım senaryolarını slaytlarda tartışmayı bırakın. Değer faktörleri, kurumsal hazırlık ve çabaya göre 10 dakikada puanlayın.",
  },
  memoPromptHint:
    "Frame the memo around portfolio choices. Reference cost-of-action vs. cost-of-inaction. Highlight Quick Wins and Strategic Bets first; Park/Avoid second.",
  antiVendor: {
    en: [
      "If you want a 12-week strategy presentation across 50 use cases, an MBB firm is the right fit.",
      "If your sponsor wants every use case greenlit, talk to a vendor that sells the platform underneath.",
    ],
    ar: [
      "إذا أردتم عرضاً استراتيجياً لمدة 12 أسبوعاً عبر 50 حالة، فإن شركة MBB هي الأنسب.",
      "إذا أراد الراعي اعتماد كل الحالات، تحدثوا مع موردي المنصات.",
    ],
    tr: [
      "50 kullanım senaryosu için 12 haftalık bir strateji sunumu istiyorsanız, bir MBB firması sizin için doğru tercihtir.",
      "Sponsorunuz her kullanım senaryosunun onaylanmasını istiyorsa, altta yatan platformu satan bir tedarikçiyle görüşün.",
    ],
  },
  dimensions: [
    {
      id: "value",
      title: { en: "Value Drivers", ar: "محركات القيمة", tr: "Değer Faktörleri" },
      weight: 0.50,
      description: { en: "EBIT impact, customer outcome, risk reduction, strategic differentiation.", ar: "أثر الأرباح، نتيجة العميل، خفض المخاطر، التميز الاستراتيجي.", tr: "EBIT etkisi, müşteri sonucu, risk azaltma, stratejik farklılaşma." },
      questions: [
        {
          id: "uvr.v1",
          prompt: { en: "Direct EBIT impact within 12 months?", ar: "أثر مباشر على الأرباح خلال 12 شهراً؟", tr: "12 ay içinde doğrudan EBIT etkisi?" },
          options: [
            { id: "a", label: { en: "Negligible (<$0.1M).", ar: "ضئيل (<$0.1M).", tr: "İhmal edilebilir (<$0.1M)." }, score: 1 },
            { id: "b", label: { en: "Modest ($0.1–1M).", ar: "متواضع ($0.1–1M).", tr: "Mütevazı ($0.1–1M)." }, score: 2 },
            { id: "c", label: { en: "Material ($1–5M).", ar: "ملموس ($1–5M).", tr: "Önemli ($1–5M)." }, score: 3 },
            { id: "d", label: { en: "Significant ($5–25M).", ar: "كبير ($5–25M).", tr: "Büyük ($5–25M)." }, score: 4 },
            { id: "e", label: { en: "Transformational (>$25M).", ar: "تحوّلي (>$25M).", tr: "Dönüştürücü (>$25M)." }, score: 5 },
          ],
        },
        {
          id: "uvr.v2",
          prompt: { en: "Customer / citizen outcome lift?", ar: "تحسين نتيجة العميل/المواطن؟", tr: "Müşteri / vatandaş sonucu iyileştirmesi?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Marginal experience improvement.", ar: "تحسين تجربة هامشي.", tr: "Marjinal deneyim iyileştirmesi." }, score: 2 },
            { id: "c", label: { en: "Measurable NPS / satisfaction lift.", ar: "تحسين NPS / رضا قابل للقياس.", tr: "Ölçülebilir NPS / memnuniyet artışı." }, score: 3 },
            { id: "d", label: { en: "Step-change in journey speed or quality.", ar: "قفزة في سرعة أو جودة الرحلة.", tr: "Yolculuk hızında veya kalitesinde basamak değişimi." }, score: 4 },
            { id: "e", label: { en: "New product or service unlocked.", ar: "فتح منتج أو خدمة جديدة.", tr: "Yeni ürün veya hizmetin önü açıldı." }, score: 5 },
          ],
        },
        {
          id: "uvr.v3",
          prompt: { en: "Risk / compliance reduction?", ar: "خفض المخاطر / الامتثال؟", tr: "Risk / uyum azaltımı?" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد.", tr: "Yok." }, score: 1 },
            { id: "b", label: { en: "Minor incident reduction.", ar: "خفض حوادث طفيف.", tr: "Küçük olay azaltımı." }, score: 2 },
            { id: "c", label: { en: "Audit / control improvement.", ar: "تحسين تدقيق / ضبط.", tr: "Denetim / kontrol iyileştirmesi." }, score: 3 },
            { id: "d", label: { en: "Material regulatory exposure reduction.", ar: "خفض تعرض تنظيمي ملموس.", tr: "Önemli düzenleyici maruziyet azaltımı." }, score: 4 },
            { id: "e", label: { en: "Eliminates a top-3 enterprise risk.", ar: "يلغي مخاطرة من أعلى 3 مخاطر مؤسسية.", tr: "İlk 3 kurumsal riskten birini ortadan kaldırır." }, score: 5 },
          ],
        },
        {
          id: "uvr.v4",
          prompt: { en: "Strategic differentiation in your market?", ar: "تمايز استراتيجي في سوقكم؟", tr: "Pazarınızda stratejik farklılaşma?" },
          options: [
            { id: "a", label: { en: "Table-stakes.", ar: "متطلب أساسي.", tr: "Temel gereklilik." }, score: 1 },
            { id: "b", label: { en: "Catches us up.", ar: "يجعلنا في المستوى.", tr: "Bizi yakalıyor." }, score: 2 },
            { id: "c", label: { en: "Modest edge.", ar: "ميزة متواضعة.", tr: "Mütevazı avantaj." }, score: 3 },
            { id: "d", label: { en: "Clear competitive moat for 1–2 years.", ar: "حصن تنافسي لـ 1–2 سنة.", tr: "1–2 yıllık net rekabet avantajı." }, score: 4 },
            { id: "e", label: { en: "Defensible moat tied to proprietary data / process.", ar: "حصن دفاعي مرتبط ببيانات/عملية ملكية.", tr: "Tescilli veri / sürece bağlı savunulabilir rekabet avantajı." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "readiness",
      title: { en: "Organizational Readiness", ar: "الجاهزية المؤسسية", tr: "Kurumsal Hazırlık" },
      weight: 0.40,
      description: { en: "Sponsor, data, integration, regulatory clarity, change capacity.", ar: "الراعي، البيانات، التكامل، وضوح التنظيم، قدرة التغيير.", tr: "Sponsor, veri, entegrasyon, düzenleyici netlik, değişim kapasitesi." },
      questions: [
        {
          id: "uvr.r1",
          prompt: { en: "Sponsor seniority and conviction?", ar: "مستوى الراعي وقناعته؟", tr: "Sponsorun kıdemi ve kararlılığı?" },
          options: [
            { id: "a", label: { en: "No identified sponsor.", ar: "لا يوجد راعٍ.", tr: "Belirlenmiş sponsor yok." }, score: 1 },
            { id: "b", label: { en: "Mid-management.", ar: "إدارة وسطى.", tr: "Orta düzey yönetim." }, score: 2 },
            { id: "c", label: { en: "Function head.", ar: "قائد وظيفة.", tr: "Fonksiyon başkanı." }, score: 3 },
            { id: "d", label: { en: "ExCo member with budget.", ar: "عضو ExCo مع ميزانية.", tr: "Bütçesi olan ExCo üyesi." }, score: 4 },
            { id: "e", label: { en: "CEO-sponsored with board KPI.", ar: "يرعاه CEO مع KPI للمجلس.", tr: "Yönetim kurulu KPI'sı ile CEO sponsorluğunda." }, score: 5 },
          ],
        },
        {
          id: "uvr.r2",
          prompt: { en: "Data + system access required?", ar: "البيانات + الوصول للأنظمة المطلوبة؟", tr: "Gerekli veri + sistem erişimi?" },
          options: [
            { id: "a", label: { en: "Major data + integration gaps.", ar: "فجوات بيانات وتكامل كبيرة.", tr: "Büyük veri + entegrasyon boşlukları." }, score: 1 },
            { id: "b", label: { en: "Significant gaps; some workarounds.", ar: "فجوات كبيرة؛ بعض الحلول البديلة.", tr: "Önemli boşluklar; bazı geçici çözümler." }, score: 2 },
            { id: "c", label: { en: "Available with effort.", ar: "متوفرة بجهد.", tr: "Çabayla mevcut." }, score: 3 },
            { id: "d", label: { en: "Mostly available with stable APIs.", ar: "متوفرة في الغالب بـ APIs مستقرة.", tr: "Çoğunlukla kararlı API'lerle mevcut." }, score: 4 },
            { id: "e", label: { en: "Fully available; production-grade.", ar: "متوفرة كاملة؛ بمستوى إنتاج.", tr: "Tamamen mevcut; üretim seviyesinde." }, score: 5 },
          ],
        },
        {
          id: "uvr.r3",
          prompt: { en: "Regulatory / compliance clarity?", ar: "وضوح التنظيم / الامتثال؟", tr: "Düzenleyici / uyum netliği?" },
          options: [
            { id: "a", label: { en: "Unclear; novel territory.", ar: "غير واضح؛ منطقة جديدة.", tr: "Belirsiz; yeni bir alan." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Some open questions.", ar: "بعض الأسئلة المفتوحة.", tr: "Bazı açık sorular." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Defined controls; minor uncertainty.", ar: "ضوابط محددة؛ شك بسيط.", tr: "Tanımlanmış kontroller; küçük belirsizlik." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Compliant by design.", ar: "ممتثل بالتصميم.", tr: "Tasarım gereği uyumlu." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Regulator pre-engaged and supportive.", ar: "المنظم منخرط مسبقاً وداعم.", tr: "Düzenleyici önceden devrede ve destekleyici." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "uvr.r4",
          prompt: { en: "Change-management capacity for affected teams?", ar: "قدرة إدارة التغيير للفرق المتأثرة؟", tr: "Etkilenen ekipler için değişim yönetimi kapasitesi?" },
          options: [
            { id: "a", label: { en: "Saturated; no bandwidth.", ar: "مشبَع؛ لا قدرة.", tr: "Doymuş; kapasite yok." }, score: 1 },
            { id: "b", label: { en: "Limited; competing priorities.", ar: "محدود؛ أولويات متنافسة.", tr: "Sınırlı; rakip öncelikler." }, score: 2 },
            { id: "c", label: { en: "Moderate; could absorb with help.", ar: "متوسط؛ يستطيع الاستيعاب بمساعدة.", tr: "Orta; yardımla absorbe edebilir." }, score: 3 },
            { id: "d", label: { en: "Good; team is asking for it.", ar: "جيد؛ الفريق يطلبه.", tr: "İyi; ekip bunu talep ediyor." }, score: 4 },
            { id: "e", label: { en: "Excellent; team is co-designing.", ar: "ممتاز؛ الفريق يصمم بالاشتراك.", tr: "Mükemmel; ekip ortak tasarlıyor." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "effort",
      title: { en: "Effort & Cost-to-Build", ar: "الجهد والتكلفة للبناء", tr: "Çaba ve İnşa Maliyeti" },
      weight: 0.10,
      description: { en: "Build/integration effort. High effort lowers placement.", ar: "جهد البناء/التكامل. الجهد العالي يخفض الموقع.", tr: "İnşa/entegrasyon çabası. Yüksek çaba konumu düşürür." },
      questions: [
        {
          id: "uvr.e1",
          prompt: { en: "Build / integration effort estimate?", ar: "تقدير جهد البناء / التكامل؟", tr: "İnşa / entegrasyon çaba tahmini?" },
          options: [
            { id: "a", label: { en: "Massive (>9 months, >$2M).", ar: "ضخم (>9 شهور، >$2M).", tr: "Devasa (>9 ay, >$2M)." }, score: 1 },
            { id: "b", label: { en: "Large (6–9 months, $0.5–2M).", ar: "كبير (6–9 شهور، $0.5–2M).", tr: "Büyük (6–9 ay, $0.5–2M)." }, score: 2 },
            { id: "c", label: { en: "Medium (3–6 months).", ar: "متوسط (3–6 شهور).", tr: "Orta (3–6 ay)." }, score: 3 },
            { id: "d", label: { en: "Modest (8–12 weeks).", ar: "متواضع (8–12 أسبوع).", tr: "Mütevazı (8–12 hafta)." }, score: 4 },
            { id: "e", label: { en: "Small (4–8 weeks).", ar: "صغير (4–8 أسبوع).", tr: "Küçük (4–8 hafta)." }, score: 5 },
          ],
        },
      ],
    },
  ],
  recommendations: {},
};
