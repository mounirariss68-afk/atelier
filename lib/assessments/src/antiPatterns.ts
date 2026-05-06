import type { AntiPatternRule, AntiPatternFlag, AntiPatternTestContext } from "./types";

export const antiPatternRules: AntiPatternRule[] = [
  {
    id: "agent-without-process",
    label: { en: "Agent without process redesign", ar: "وكيل بدون إعادة تصميم العملية", tr: "Süreç yeniden tasarımı olmadan ajan" },
    description: {
      en: "You're deploying agents on top of legacy SOPs. This is the #1 reason Gartner expects 40% of agentic projects to be cancelled.",
      ar: "تنشرون وكلاء على إجراءات قديمة. هذا هو السبب الأول لتوقع جارتنر إلغاء 40% من مشاريع الوكلاء.",
      tr: "Eski SOP'ların üzerine ajanlar konuşlandırıyorsunuz. Gartner'ın ajansal projelerin %40'ının iptal edilmesini beklemesinin 1 numaralı nedeni budur.",
    },
    fix: {
      en: "Adopt a 'no agent without redesign' rule at intake. Map the value stream end-to-end before approving the next agent.",
      ar: "اعتمدوا قاعدة 'لا وكيل بدون إعادة تصميم'. خرّطوا سلسلة القيمة الكاملة قبل اعتماد الوكيل التالي.",
      tr: "Kabulde 'yeniden tasarım olmadan ajan yok' kuralını benimseyin. Bir sonraki ajanı onaylamadan önce değer akışını uçtan uca haritalandırın.",
    },
    severity: "critical",
    appliesTo: ["ari"],
    test: (c) => (c.dimensionScores.process ?? 5) < 2.5 && (c.dimensionScores.architecture ?? 0) >= 3.0,
  },
  {
    id: "vendor-lock",
    label: { en: "Single-vendor agentic lock-in", ar: "ارتباط بمزود وكلاء واحد", tr: "Tek tedarikçiye ajansal bağımlılık" },
    description: {
      en: "Your stack is one hyperscaler deep. The first regulator question on sovereign workloads will become a multi-quarter remediation.",
      ar: "مكدسكم على مزود سحابي واحد فقط. أول سؤال تنظيمي للأحمال السيادية سيصبح برنامج معالجة لعدة أرباع.",
      tr: "Yığınınız tek bir hiperskaler derinliğinde. Egemen iş yükleri hakkındaki ilk düzenleyici sorusu, birden fazla çeyrek süren bir iyileştirme programına dönüşecek.",
    },
    fix: {
      en: "Introduce a model gateway and a sovereign-cloud (or self-hosted open-weight) path for regulated workloads.",
      ar: "أدخلوا بوابة نموذج ومساراً سيادياً (أو نموذج أوزان مفتوحة) للأحمال المنظمة.",
      tr: "Düzenlenmiş iş yükleri için bir model ağ geçidi ve egemen bulut (veya kendi kendine barındırılan açık ağırlık) yolu ekleyin.",
    },
    severity: "warning",
    appliesTo: ["ari", "mvi"],
    test: (c) => {
      const arch = c.dimensionScores.architecture;
      const cloud = c.dimensionScores.cloud;
      const a = c.answers["ari.a4"];
      const b = c.answers["mvi.cl2"];
      return (a === "a") || (b === "a" || b === "b") || (arch !== undefined && arch < 2.5) || (cloud !== undefined && cloud < 2.5);
    },
  },
  {
    id: "ethics-theatre",
    label: { en: "Ethics-committee theatre", ar: "مسرح لجنة الأخلاقيات", tr: "Etik komitesi tiyatrosu" },
    description: {
      en: "You have a Responsible AI committee but no continuous evals or guardrails wired into delivery.",
      ar: "لديكم لجنة ذكاء مسؤول لكن بدون تقييمات أو حواجز مستمرة في التسليم.",
      tr: "Bir Sorumlu AI komiteniz var, ancak teslimata bağlı sürekli değerlendirmeler veya korkuluklar yok.",
    },
    fix: {
      en: "Move from committee minutes to gated promotions with eval thresholds and a policy engine in production.",
      ar: "انتقلوا من محاضر اللجنة إلى بوابات ترقية بعتبات تقييم ومحرك سياسات في الإنتاج.",
      tr: "Komite tutanaklarından, değerlendirme eşikleri ve üretimde bir politika motoru olan kapılı terfilere geçin.",
    },
    severity: "warning",
    appliesTo: ["ari", "dafi"],
    test: (c) => {
      const r = c.dimensionScores.responsible ?? c.dimensionScores.ethics;
      const o = c.dimensionScores.governance ?? c.dimensionScores.scale;
      return (r !== undefined && r < 3) && (o !== undefined && o > 3);
    },
  },
  {
    id: "training-as-strategy",
    label: { en: "Training-as-strategy", ar: "التدريب كاستراتيجية", tr: "Strateji olarak eğitim" },
    description: {
      en: "You've shipped lots of certifications and awareness sessions but no production agents and no operating-model change.",
      ar: "أصدرتم الكثير من الشهادات وجلسات التوعية لكن لا وكلاء في الإنتاج ولا تغيير في نموذج التشغيل.",
      tr: "Çok sayıda sertifika ve farkındalık oturumu yayınladınız ancak üretim ajanı yok ve işletim modeli değişikliği yok.",
    },
    fix: {
      en: "Re-route 30% of training spend into a 90-day 'agent-in-production' sprint with a P&L-owning sponsor.",
      ar: "أعيدوا توجيه 30% من إنفاق التدريب إلى سباق 90 يوماً 'وكيل في الإنتاج' مع راعٍ يملك P&L.",
      tr: "Eğitim harcamasının %30'unu, P&L sahibi bir sponsorla 90 günlük 'üretimde ajan' sprintine yönlendirin.",
    },
    severity: "warning",
    appliesTo: ["ari"],
    test: (c) => (c.dimensionScores.people ?? 0) > 3.2 && (c.dimensionScores.scale ?? 5) < 2.5,
  },
  {
    id: "data-foundations-debt",
    label: { en: "Data-foundations debt", ar: "دين أساسات البيانات", tr: "Veri-temel borcu" },
    description: {
      en: "Your AI ambition outpaces your data foundations. Anything you ship will hit a wall the first time it leaves the lab.",
      ar: "طموح الذكاء الاصطناعي يتجاوز أساسات بياناتكم. أي شيء تطلقونه سيصطدم بحائط عند أول خروج من المختبر.",
      tr: "AI hırsınız veri temellerinizi aşıyor. Yayınladığınız her şey laboratuvardan ilk çıkışında bir duvara çarpacak.",
    },
    fix: {
      en: "Pause new agentic launches and ringfence one squad to clear the top-3 data debts in the next 90 days.",
      ar: "أوقفوا إطلاقات الوكلاء الجديدة وخصّصوا فريقاً لإزالة أعلى 3 ديون بيانات خلال 90 يوماً.",
      tr: "Yeni ajansal lansmanları duraklatın ve önümüzdeki 90 gün içinde ilk 3 veri borcunu temizlemek üzere bir ekibi ayırın.",
    },
    severity: "critical",
    appliesTo: ["ari", "dafi", "mvi"],
    test: (c) => {
      const data = c.dimensionScores.data ?? c.dimensionScores.platform ?? c.dimensionScores.quality;
      return data !== undefined && data < 2.3;
    },
  },
  {
    id: "outsourced-cognition",
    label: { en: "Outsourced cognition", ar: "تفويض الإدراك للخارج", tr: "Dışarıdan sağlanan biliş" },
    description: {
      en: "Your engineering org is heavily outsourced and AI-augmented engineering is low-adoption — you'll struggle to keep agents alive in production.",
      ar: "هندستكم في الغالب خارجية والتبني للذكاء الاصطناعي منخفض — ستصعب حياة الوكلاء في الإنتاج.",
      tr: "Mühendislik organizasyonunuz büyük ölçüde dışarıdan sağlanıyor ve AI destekli mühendisliğin benimsenmesi düşük — ajanları üretimde canlı tutmakta zorlanacaksınız.",
    },
    fix: {
      en: "Insource a core platform team and roll out a sanctioned AI coding assistant to 100% of engineers in 60 days.",
      ar: "أعيدوا فريق المنصة الأساسي إلى الداخل وانشروا مساعد كود AI لكل المهندسين خلال 60 يوماً.",
      tr: "Bir çekirdek platform ekibini içeride istihdam edin ve 60 gün içinde mühendislerin %100'üne onaylı bir AI kodlama asistanı sunun.",
    },
    severity: "warning",
    appliesTo: ["mvi"],
    test: (c) => (c.dimensionScores.talent ?? 5) < 2.5 && (c.dimensionScores["ai-sdlc"] ?? 5) < 2.5,
  },
  {
    id: "compliance-cliff",
    label: { en: "Compliance cliff", ar: "هاوية الامتثال", tr: "Uyum uçurumu" },
    description: {
      en: "Your AI ambition exceeds your PDPL/SAMA/CBUAE/SDAIA posture. Expect a hard regulator stop within 12 months.",
      ar: "طموحكم في AI يتجاوز وضعكم في PDPL/SAMA/CBUAE/SDAIA. توقعوا إيقافاً تنظيمياً صارماً خلال 12 شهراً.",
      tr: "AI hırsınız PDPL/SAMA/CBUAE/SDAIA duruşunuzu aşıyor. 12 ay içinde sert bir düzenleyici durdurma bekleyin.",
    },
    fix: {
      en: "Run a 60-day sovereign + compliance gap closure sprint before the next agent goes live.",
      ar: "نفّذوا سباقاً لإغلاق فجوات السيادة والامتثال خلال 60 يوماً قبل إطلاق الوكيل التالي.",
      tr: "Bir sonraki ajan yayına geçmeden önce 60 günlük bir egemenlik + uyum boşluğu kapatma sprinti yürütün.",
    },
    severity: "critical",
    appliesTo: ["ari", "dafi", "mvi"],
    test: (c) => {
      const gov = c.dimensionScores.governance ?? c.dimensionScores.responsible ?? c.dimensionScores.risk;
      const overall = c.overallScore;
      return gov !== undefined && gov < 2.5 && overall >= 3.0;
    },
  },
];

export function detectAntiPatterns(ctx: AntiPatternTestContext): AntiPatternFlag[] {
  return antiPatternRules
    .filter((r) => r.appliesTo.includes(ctx.slug))
    .filter((r) => {
      try {
        return r.test(ctx);
      } catch {
        return false;
      }
    })
    .map((r) => ({ id: r.id, label: r.label, description: r.description, fix: r.fix, severity: r.severity }));
}
