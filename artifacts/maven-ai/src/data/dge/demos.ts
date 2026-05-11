/**
 * The six DGE Effortless 2.0 demo specs. Each demo is declarative seed
 * data that the shared DGE shell renders as Citizen / Operator /
 * Governance tabs. Hand-authored EN+AR throughout. Synthetic only.
 */
import type { BiText } from "@/lib/sim/types";
import type { Hapa, BehaviouralContract } from "@/lib/dge/runtime";

export interface DgeKpi {
  label: BiText;
  before: string;
  after: string;
  delta: BiText;
}

export interface DgeAuthoriseAction {
  intent: BiText;
  by: BiText;
  commits: BiText;
  hapa: Hapa[];
}

export interface DgeForbidden {
  attempt: BiText;
  agent: BiText;
  contract: BehaviouralContract;
}

export interface DgeStep {
  agent: BiText;
  surface: "citizen" | "operator" | "governance";
  label: BiText;
  detail?: BiText;
  hapa?: Hapa[];
  citations?: BiText[];
}

export interface DgeTabContent {
  /** Lead persona on the surface (e.g. "Aisha (Citizen)"). */
  persona: BiText;
  /** Short narrative shown above the panel. */
  intro: BiText;
  /** Card-style blocks for the surface. */
  blocks: Array<{
    title: BiText;
    body: BiText;
    /** Optional rows of small label/value pairs (KPI-ish). */
    rows?: Array<[BiText, BiText]>;
    /** Optional bullets. */
    bullets?: BiText[];
  }>;
}

export interface DgeDemo {
  slug: string;
  number: string;
  title: BiText;
  oneLine: BiText;
  factory: string;
  agentStack: BiText[];
  kpis: DgeKpi[];
  citizen: DgeTabContent;
  operator: DgeTabContent;
  governance: DgeTabContent;
  steps: DgeStep[];
  authorise: DgeAuthoriseAction;
  forbidden: DgeForbidden;
}

const std = (may: string[], pause: string[], block: string[]): BehaviouralContract => ({
  may,
  mayOnlyWithHuman: pause,
  mustNever: block,
});

export const DGE_DEMOS: DgeDemo[] = [
  // ============================================================
  // 1 — Catalogue & Channel Sentinel
  // ============================================================
  {
    slug: "dge-catalogue-channel",
    number: "01",
    title: { en: "Catalogue & Channel Sentinel", ar: "حارس الكتالوج والقناة" },
    oneLine: {
      en: "Detects drift on a pharmacist licence fee and rationalises 105 outdated channel emails to 55 — with a citation gate that stops uncited fee changes.",
      ar: "يكتشف الانحراف في رسوم رخصة الصيدلي ويختصر 105 بريد قناة قديم إلى 55 — مع بوابة استشهاد توقف أي تغيير غير موثّق.",
    },
    factory: "catalogue-channel",
    agentStack: [
      { en: "Catalog Sentinel", ar: "حارس الكتالوج" },
      { en: "Channel Sentinel", ar: "حارس القناة" },
      { en: "Migration Sentinel", ar: "حارس الترحيل" },
    ],
    kpis: [
      { label: { en: "Catalogue freshness", ar: "حداثة الكتالوج" }, before: "91%", after: "99.4%", delta: { en: "+8.4 pts", ar: "+8.4 نقطة" } },
      { label: { en: "Active channels", ar: "القنوات النشطة" }, before: "400", after: "273", delta: { en: "−32%", ar: "−32%" } },
      { label: { en: "Time-to-update", ar: "زمن التحديث" }, before: "14 days", after: "6 minutes", delta: { en: "−99%", ar: "−99%" } },
    ],
    citizen: {
      persona: { en: "Aisha — pharmacist renewing her licence", ar: "عائشة — صيدلية تجدّد رخصتها" },
      intro: {
        en: "Aisha opens TAMM, taps Health, and searches for 'renew pharmacy licence'. Last week she would have seen the wrong fee.",
        ar: "تفتح عائشة TAMM وتضغط الصحة وتبحث عن 'تجديد رخصة الصيدلة'. الأسبوع الماضي كانت سترى رسوماً خاطئة.",
      },
      blocks: [
        {
          title: { en: "TAMM Spaces · Health · Pharmacy licence renewal", ar: "TAMM Spaces · الصحة · تجديد رخصة الصيدلة" },
          body: { en: "Fee shown: AED 540 — updated 8 minutes ago.", ar: "الرسم المعروض: 540 درهماً — حُدِّث قبل 8 دقائق." },
          rows: [
            [{ en: "Processing time", ar: "وقت المعالجة" }, { en: "3 working days", ar: "3 أيام عمل" }],
            [{ en: "Required documents", ar: "المستندات المطلوبة" }, { en: "Emirates ID, Health licence, Photo", ar: "هوية، رخصة صحية، صورة" }],
            [{ en: "Last citation", ar: "آخر استشهاد" }, { en: "DGE Circular 2026-04, 09 May", ar: "تعميم DGE 2026-04، 9 مايو" }],
          ],
        },
      ],
    },
    operator: {
      persona: { en: "Khalid — Catalogue Operator, DGE", ar: "خالد — مشغّل الكتالوج، DGE" },
      intro: {
        en: "Catalog Sentinel flagged a fee drift this morning. Khalid reviews the diff, confirms the cited circular, and gates publication on Director Layla's authorisation.",
        ar: "أبلغ حارس الكتالوج عن انحراف في الرسوم هذا الصباح. يراجع خالد الفرق ويؤكّد التعميم ويوقف النشر بانتظار اعتماد المديرة ليلى.",
      },
      blocks: [
        {
          title: { en: "Drift detected — Pharmacy licence fee", ar: "تم اكتشاف انحراف — رسم رخصة الصيدلة" },
          body: { en: "Currently published: AED 480. Authoritative source: AED 540 (DGE Circular 2026-04). Drift age: 11 days.", ar: "المنشور حالياً: 480 درهماً. المصدر المعتمد: 540 درهماً (تعميم DGE 2026-04). عمر الانحراف: 11 يوماً." },
          bullets: [
            { en: "Diff cites Circular 2026-04 (linked).", ar: "الفرق يستشهد بالتعميم 2026-04 (مرفق)." },
            { en: "Validation Sentinel: schema OK, no breaking changes.", ar: "حارس التحقق: المخطط سليم، لا تغييرات مكسورة." },
            { en: "Migration Sentinel: 0 downstream forms affected.", ar: "حارس الترحيل: لا نماذج متأثرة." },
          ],
        },
      ],
    },
    governance: {
      persona: { en: "Director Layla — DGE CX Director", ar: "المديرة ليلى — مديرة تجربة العميل" },
      intro: {
        en: "Channel Sentinel proposes collapsing 105 broadcast email templates to 55 deduplicated, governed templates. The Sankey shows where every retired template's audience will land.",
        ar: "يقترح حارس القناة تقليص 105 قوالب بريد إلى 55 قالباً موحّداً. المخطط يبيّن أين ينتقل جمهور كل قالب متقاعد.",
      },
      blocks: [
        {
          title: { en: "Email rationalisation · 105 → 55", ar: "ترشيد البريد · 105 → 55" },
          body: { en: "Sankey: 105 templates collapse into 55 governed templates. 12 templates flagged for entity-owner review.", ar: "المخطط: 105 قوالب تنطوي إلى 55 قالباً محوكَماً. 12 قالباً معلّق لمراجعة المالك." },
          rows: [
            [{ en: "Estimated effort saved", ar: "الجهد الموفّر" }, { en: "180 owner-hours / month", ar: "180 ساعة شهرياً" }],
            [{ en: "Brand consistency score", ar: "اتساق العلامة" }, { en: "62 → 94", ar: "62 → 94" }],
          ],
        },
        {
          title: { en: "New entity onboarding", ar: "إدماج جهة جديدة" },
          body: { en: "Onboarded Health Authority sub-entity #57 in 6 minutes — 14 channels mapped, 23 services linked.", ar: "إدماج جهة فرعية لهيئة الصحة #57 في 6 دقائق — 14 قناة و23 خدمة." },
        },
      ],
    },
    steps: [
      { agent: { en: "Catalog Sentinel", ar: "حارس الكتالوج" }, surface: "operator", label: { en: "Drift detected on pharmacy licence fee.", ar: "اكتشاف انحراف في رسم رخصة الصيدلة." }, hapa: ["H1", "H2"], citations: [{ en: "DGE Circular 2026-04", ar: "تعميم DGE 2026-04" }] },
      { agent: { en: "Validation Sentinel", ar: "حارس التحقق" }, surface: "operator", label: { en: "Schema check — no breaking changes.", ar: "فحص المخطط — لا تغييرات مكسورة." }, hapa: ["H4"] },
      { agent: { en: "Migration Sentinel", ar: "حارس الترحيل" }, surface: "operator", label: { en: "Impact simulation — 0 downstream forms affected.", ar: "محاكاة الأثر — لا نماذج متأثرة." }, hapa: ["H3"] },
      { agent: { en: "Channel Sentinel", ar: "حارس القناة" }, surface: "governance", label: { en: "Proposed 105 → 55 email collapse with Sankey.", ar: "اقتراح طي 105 → 55 بريد." }, hapa: ["H5", "H6"] },
    ],
    authorise: {
      intent: { en: "Authorise publish to TAMM", ar: "اعتماد النشر إلى TAMM" },
      by: { en: "Director Layla", ar: "المديرة ليلى" },
      commits: { en: "Update pharmacy licence fee to AED 540 across TAMM Spaces and 14 channels, citing Circular 2026-04.", ar: "تحديث رسم رخصة الصيدلة إلى 540 درهماً عبر TAMM و14 قناة، استشهاداً بالتعميم 2026-04." },
      hapa: ["H1", "H4", "H6"],
    },
    forbidden: {
      attempt: { en: "Catalog Sentinel attempts to push the fee change without a citation.", ar: "يحاول حارس الكتالوج دفع تغيير الرسوم دون استشهاد." },
      agent: { en: "Catalog Sentinel", ar: "حارس الكتالوج" },
      contract: std(["propose_change_with_citation"], ["publish_to_tamm"], ["push_change_without_citation"]),
    },
  },

  // ============================================================
  // 2 — Complaint Recovery & Root-Cause Engine
  // ============================================================
  {
    slug: "dge-complaint-recovery",
    number: "02",
    title: { en: "Complaint Recovery & Root-Cause Engine", ar: "محرّك استرداد الشكاوى والسبب الجذري" },
    oneLine: {
      en: "Clusters 200 complaints into 4 root causes, drafts a CEP workshop brief, and overlays mystery-shopper coverage on the Unified Complaint Manual heatmap.",
      ar: "يجمّع 200 شكوى في 4 أسباب جذرية، ويصوغ موجز ورشة CEP، ويغطّي خريطة دليل الشكاوى الموحّد.",
    },
    factory: "complaint-recovery",
    agentStack: [
      { en: "Intake Sentinel", ar: "حارس الاستلام" },
      { en: "Root-Cause Sentinel", ar: "حارس السبب الجذري" },
      { en: "Recovery Designer", ar: "مصمّم الاسترداد" },
      { en: "Mystery Shopper", ar: "المتسوّق السري" },
    ],
    kpis: [
      { label: { en: "Cycle time", ar: "زمن الدورة" }, before: "11 days", after: "3.5 days", delta: { en: "−68%", ar: "−68%" } },
      { label: { en: "Repeat complaints", ar: "تكرار الشكاوى" }, before: "22%", after: "6%", delta: { en: "−16 pts", ar: "−16 نقطة" } },
      { label: { en: "Mystery-shopper coverage", ar: "تغطية المتسوّق السري" }, before: "35%", after: "100%", delta: { en: "+65 pts", ar: "+65 نقطة" } },
    ],
    citizen: {
      persona: { en: "Omar — files a complaint about a delayed inspection", ar: "عمر — يقدّم شكوى حول تأخير تفتيش" },
      intro: {
        en: "Omar files via TAMM. The Intake Sentinel acknowledges in 8 seconds and offers three resolution paths — none of them generic.",
        ar: "يقدّم عمر شكواه عبر TAMM. يستلم حارس الاستلام خلال 8 ثوانٍ ويعرض ثلاثة مسارات حلّ مخصّصة.",
      },
      blocks: [
        {
          title: { en: "Acknowledged in 8 seconds", ar: "تم الاستلام خلال 8 ثوانٍ" },
          body: { en: "Three resolution paths offered: rebook this week, refund in 24h, or recover via concierge call from Mariam.", ar: "ثلاثة مسارات: إعادة الحجز هذا الأسبوع، استرداد خلال 24 ساعة، أو معالجة شخصية من مريم." },
        },
      ],
    },
    operator: {
      persona: { en: "Mariam — Complaint Lead, DGE", ar: "مريم — قائدة الشكاوى، DGE" },
      intro: {
        en: "Root-Cause Sentinel groups today's 200 complaints into 4 clusters. The largest — 47 complaints sharing one cause — gets a drafted CEP workshop brief Mariam reviews.",
        ar: "يجمّع حارس السبب الجذري 200 شكوى في 4 مجموعات. الأكبر — 47 شكوى لسبب واحد — يحصل على موجز ورشة CEP لمريم.",
      },
      blocks: [
        {
          title: { en: "Cluster #1 · Inspection-slot starvation", ar: "المجموعة #1 · شُحّ مواعيد التفتيش" },
          body: { en: "47 complaints share one cause: municipal inspector calendars are full 2 weeks out across 3 entities.", ar: "47 شكوى تشترك في سبب واحد: تقاويم المفتشين البلديين مكتظّة لأسبوعين عبر 3 جهات." },
          rows: [
            [{ en: "Affected services", ar: "الخدمات المتأثرة" }, { en: "Trade licence, F&B permit, Renovation", ar: "رخصة تجارية، تصريح أغذية، تجديد" }],
            [{ en: "Drafted brief", ar: "الموجز المسوَّد" }, { en: "Ready — 14 attendees, 3-hour workshop", ar: "جاهز — 14 مشاركاً، 3 ساعات" }],
          ],
        },
      ],
    },
    governance: {
      persona: { en: "Director Layla — DGE CX Director", ar: "المديرة ليلى — مديرة تجربة العميل" },
      intro: {
        en: "The Unified Complaint Management Manual covers 20 ADGE systems. Today's heatmap shows 17 green, 2 amber (mystery-shopper backlog), 1 red (CRM webhook drift).",
        ar: "يغطّي دليل الشكاوى الموحّد 20 نظاماً. الخريطة اليوم: 17 أخضر، 2 أصفر، 1 أحمر.",
      },
      blocks: [
        {
          title: { en: "Mystery-shopper coverage heatmap", ar: "خريطة تغطية المتسوّق السري" },
          body: { en: "100% of customer-facing services touched in the last 30 days. Pre/post perception survey: trust +14 pts.", ar: "100% من الخدمات تم لمسها خلال 30 يوماً. مسح الإدراك: ثقة +14 نقطة." },
        },
      ],
    },
    steps: [
      { agent: { en: "Intake Sentinel", ar: "حارس الاستلام" }, surface: "citizen", label: { en: "Acknowledged Omar in 8s with 3 paths.", ar: "استلام عمر خلال 8 ثوانٍ بثلاثة مسارات." }, hapa: ["H2", "H6"] },
      { agent: { en: "Root-Cause Sentinel", ar: "حارس السبب الجذري" }, surface: "operator", label: { en: "Clustered 200 complaints into 4 root causes.", ar: "تجميع 200 شكوى في 4 أسباب." }, hapa: ["H1", "H4"] },
      { agent: { en: "Recovery Designer", ar: "مصمّم الاسترداد" }, surface: "operator", label: { en: "Drafted CEP workshop brief for Cluster #1.", ar: "صياغة موجز ورشة CEP للمجموعة #1." }, hapa: ["H6"] },
      { agent: { en: "Mystery Shopper", ar: "المتسوّق السري" }, surface: "governance", label: { en: "Refreshed heatmap to 100% coverage.", ar: "تحديث الخريطة إلى 100%." }, hapa: ["H5"] },
    ],
    authorise: {
      intent: { en: "Authorise launch of CEP recovery workshop", ar: "اعتماد إطلاق ورشة استرداد CEP" },
      by: { en: "Director Layla", ar: "المديرة ليلى" },
      commits: { en: "Convene 14 named attendees from 3 entities, allocate 3-hour slot, send pre-reads, commit to redesign signoff in 7 days.", ar: "حشد 14 مشاركاً من 3 جهات، 3 ساعات، إرسال القراءة، اعتماد إعادة التصميم خلال 7 أيام." },
      hapa: ["H4", "H6"],
    },
    forbidden: {
      attempt: { en: "Recovery Designer tries to close 47 complaints in bulk without owner sign-off.", ar: "يحاول مصمّم الاسترداد إغلاق 47 شكوى دفعة دون اعتماد المالك." },
      agent: { en: "Recovery Designer", ar: "مصمّم الاسترداد" },
      contract: std(["draft_workshop_brief", "cluster_complaints"], ["close_complaint"], ["bulk_close_without_owner"]),
    },
  },

  // ============================================================
  // 3 — Effortless QR Feedback & "Effortless Makers"
  // ============================================================
  {
    slug: "dge-effortless-qr",
    number: "03",
    title: { en: "Effortless QR Feedback & Effortless Makers", ar: "ملاحظات QR وصنّاع التجربة" },
    oneLine: {
      en: "Reads 400 mixed-language QR submissions from 20 outlets, surfaces 3 frontline 'Effortless Makers', and stops a nomination that lacks a verifiable citation.",
      ar: "يقرأ 400 ملاحظة من 20 فرعاً، يكشف 3 صنّاع تجربة من الخط الأمامي، ويوقف ترشيحاً يفتقر إلى استشهاد.",
    },
    factory: "qr-feedback",
    agentStack: [
      { en: "QR Intake Sentinel", ar: "حارس استلام QR" },
      { en: "Quality Sentinel", ar: "حارس الجودة" },
      { en: "Theme Sentinel", ar: "حارس المواضيع" },
      { en: "Recognition Sentinel", ar: "حارس التقدير" },
    ],
    kpis: [
      { label: { en: "Submissions / week", ar: "ملاحظات / أسبوع" }, before: "0", after: "2,800", delta: { en: "+2,800", ar: "+2,800" } },
      { label: { en: "Theme-to-action time", ar: "زمن الموضوع للفعل" }, before: "6 weeks", after: "4 days", delta: { en: "−93%", ar: "−93%" } },
      { label: { en: "Recognitions / month", ar: "تقدير / شهر" }, before: "0", after: "47", delta: { en: "+47", ar: "+47" } },
    ],
    citizen: {
      persona: { en: "Visitor at TAMM Service Centre — Yas Mall", ar: "زائر مركز خدمة TAMM — ياس مول" },
      intro: {
        en: "A 30-second mobile QR landing — one open question, voice input affordance, RTL-perfect Arabic keyboard, and a humane thank-you.",
        ar: "صفحة QR سريعة — سؤال واحد، إدخال صوتي، لوحة عربية مثالية، وشكر إنساني.",
      },
      blocks: [
        {
          title: { en: "How was your visit today?", ar: "كيف كانت زيارتك اليوم؟" },
          body: { en: "Voice or type. We read every word. Your privacy is protected — no name required.", ar: "صوت أو كتابة. نقرأ كل كلمة. خصوصيتك محمية — لا حاجة للاسم." },
        },
      ],
    },
    operator: {
      persona: { en: "Saeed — Outlet Manager, Yas Mall", ar: "سعيد — مدير الفرع، ياس مول" },
      intro: {
        en: "Theme Sentinel clusters today's submissions; Quality Sentinel filters 11% noise with cited reasons; Recognition Sentinel surfaces three Effortless Maker candidates.",
        ar: "يجمّع حارس المواضيع الإرسالات؛ يصفّي حارس الجودة 11% ضوضاء؛ يبرز حارس التقدير ثلاثة مرشّحين.",
      },
      blocks: [
        {
          title: { en: "Effortless Maker · Fatima A.", ar: "صانعة تجربة · فاطمة أ." },
          body: { en: "12 verbatim citations naming Fatima for going beyond on a wedding-permit edge case.", ar: "12 استشهاداً يذكر فاطمة لتجاوزها مع حالة تصريح زفاف." },
          rows: [
            [{ en: "Sentiment", ar: "المشاعر" }, { en: "+0.94", ar: "+0.94" }],
            [{ en: "Memorability", ar: "إمكانية التذكّر" }, { en: "High", ar: "عالية" }],
          ],
        },
      ],
    },
    governance: {
      persona: { en: "Director Layla — CX Affairs", ar: "المديرة ليلى — شؤون التجربة" },
      intro: {
        en: "Experience-driver heatmap by outlet, leaderboard of Effortless Makers, and a monthly recommendations feed exported as PDF.",
        ar: "خريطة محرّكات التجربة، لوحة صنّاع التجربة، وموجز توصيات شهري.",
      },
      blocks: [
        {
          title: { en: "Top emerging theme", ar: "أبرز موضوع ناشئ" },
          body: { en: "'Wait time at queue ticket dispenser' — 38 mentions across 6 outlets, sentiment −0.41.", ar: "'وقت الانتظار عند جهاز التذاكر' — 38 ذكراً عبر 6 فروع، مشاعر −0.41." },
        },
      ],
    },
    steps: [
      { agent: { en: "QR Intake Sentinel", ar: "حارس استلام QR" }, surface: "citizen", label: { en: "Captured 400 mixed-language submissions.", ar: "تم التقاط 400 ملاحظة." }, hapa: ["H1", "H2"] },
      { agent: { en: "Quality Sentinel", ar: "حارس الجودة" }, surface: "operator", label: { en: "Filtered 11% noise — 44 items, with reasons.", ar: "تصفية 11% ضوضاء — 44 عنصراً." }, hapa: ["H4"] },
      { agent: { en: "Theme Sentinel", ar: "حارس المواضيع" }, surface: "operator", label: { en: "Clustered themes; emerging: queue dispenser wait.", ar: "تجميع المواضيع؛ ناشئ: انتظار جهاز التذاكر." }, hapa: ["H1"] },
      { agent: { en: "Recognition Sentinel", ar: "حارس التقدير" }, surface: "operator", label: { en: "Surfaced 3 Effortless Maker candidates with citations.", ar: "إبراز 3 مرشّحين بالاستشهادات." }, hapa: ["H6"] },
    ],
    authorise: {
      intent: { en: "Authorise nomination of Fatima A. as Effortless Maker", ar: "اعتماد ترشيح فاطمة أ. صانعة تجربة" },
      by: { en: "Saeed (Outlet Manager)", ar: "سعيد (مدير الفرع)" },
      commits: { en: "Send nomination to CX Affairs with the 12 cited verbatim quotes; trigger AED 1,500 recognition flow.", ar: "إرسال الترشيح مع 12 اقتباساً موثّقاً؛ تفعيل تقدير 1,500 درهم." },
      hapa: ["H6"],
    },
    forbidden: {
      attempt: { en: "Recognition Sentinel tries to nominate a name that has 0 citations.", ar: "يحاول حارس التقدير ترشيح اسم بلا استشهاد." },
      agent: { en: "Recognition Sentinel", ar: "حارس التقدير" },
      contract: std(["surface_candidate", "summarise_themes"], ["nominate_employee"], ["nominate_without_citation"]),
    },
  },

  // ============================================================
  // 4 — Red Team Rapid-Response Console
  // ============================================================
  {
    slug: "dge-red-team",
    number: "04",
    title: { en: "Red Team Rapid-Response Console", ar: "كونسول الاستجابة السريعة" },
    oneLine: {
      en: "Driving-licence renewal outage: triages incident in 10s, generates a 3-day workshop plan, maps 14 stakeholders, drafts kickoff briefs in EN+AR.",
      ar: "عطل تجديد رخصة القيادة: فرز خلال 10 ثوانٍ، خطة ورشة 3 أيام، خريطة 14 معنيّاً، موجزات بالعربية والإنجليزية.",
    },
    factory: "red-team",
    agentStack: [
      { en: "Triage Sentinel", ar: "حارس الفرز" },
      { en: "Workshop Architect", ar: "مهندس الورشة" },
      { en: "Stakeholder Mapper", ar: "خرائط أصحاب المصلحة" },
      { en: "Brief Writer", ar: "كاتب الموجز" },
    ],
    kpis: [
      { label: { en: "Mobilisation time", ar: "زمن الحشد" }, before: "7 days", after: "3 hours", delta: { en: "−98%", ar: "−98%" } },
      { label: { en: "Workshop prep", ar: "تحضير الورشة" }, before: "4 days", after: "40 min", delta: { en: "−99%", ar: "−99%" } },
      { label: { en: "In-SLA closure", ar: "إغلاق ضمن SLA" }, before: "62%", after: "96%", delta: { en: "+34 pts", ar: "+34 نقطة" } },
    ],
    citizen: {
      persona: { en: "Hessa — needs to renew her driving licence today", ar: "حصة — تحتاج تجديد رخصتها اليوم" },
      intro: {
        en: "The renewal flow is broken. The Triage Sentinel detects the spike at 09:14 and offers Hessa a workaround drafted by Brief Writer.",
        ar: "تعطّل التدفّق. اكتشف حارس الفرز الارتفاع عند 09:14 وعرض حلاً بديلاً.",
      },
      blocks: [
        {
          title: { en: "Service interruption — driving licence renewal", ar: "انقطاع الخدمة — تجديد رخصة القيادة" },
          body: { en: "We're on it. Use the temporary phone-renewal queue at 800-DGE — same priority, same fee.", ar: "نعمل على الحل. استخدم قائمة التجديد الهاتفية 800-DGE — أولوية ورسوم متطابقة." },
        },
      ],
    },
    operator: {
      persona: { en: "Faisal — Red Team Lead, DGE", ar: "فيصل — قائد فريق الاستجابة، DGE" },
      intro: {
        en: "Faisal's console: incident timelined in 10s, 3-day workshop generated in 40 min, 14 must-attend stakeholders mapped.",
        ar: "كونسول فيصل: تسلسل خلال 10 ثوانٍ، خطة 3 أيام خلال 40 دقيقة، 14 معنيّاً.",
      },
      blocks: [
        {
          title: { en: "Incident timeline", ar: "تسلسل الحادث" },
          body: { en: "09:14 spike → 09:14:10 root signal isolated → 09:17 workaround pushed → 12:14 mobilisation complete.", ar: "09:14 الارتفاع → 09:14:10 إشارة جذرية → 09:17 الحل البديل → 12:14 اكتمال الحشد." },
        },
        {
          title: { en: "3-day workshop plan", ar: "خطة ورشة 3 أيام" },
          body: { en: "Day 1 frame, Day 2 prototype, Day 3 sign-off. Pre-reads, room set-up, materials all attached.", ar: "اليوم 1 تأطير، اليوم 2 نموذج، اليوم 3 اعتماد. مرفق كامل." },
        },
      ],
    },
    governance: {
      persona: { en: "Director Layla — DGE CX Director", ar: "المديرة ليلى — مديرة التجربة" },
      intro: {
        en: "Last-30-days Red Team activity log, SLA tracker for request → mobilisation → first prototype → closure.",
        ar: "سجل 30 يوماً، متتبّع SLA من الطلب إلى الإغلاق.",
      },
      blocks: [
        {
          title: { en: "30-day Red Team log", ar: "سجل 30 يوماً" },
          body: { en: "9 sprints, 8 in-SLA, 1 amber (vendor-blocked). Average closure: 6.4 days.", ar: "9 جولات، 8 ضمن SLA، 1 أصفر. متوسط الإغلاق: 6.4 أيام." },
        },
      ],
    },
    steps: [
      { agent: { en: "Triage Sentinel", ar: "حارس الفرز" }, surface: "operator", label: { en: "Incident timelined in 10 seconds.", ar: "تسلسل الحادث خلال 10 ثوانٍ." }, hapa: ["H1", "H2"] },
      { agent: { en: "Workshop Architect", ar: "مهندس الورشة" }, surface: "operator", label: { en: "Generated 3-day workshop plan in 40 min.", ar: "إنشاء خطة 3 أيام خلال 40 دقيقة." }, hapa: ["H6"] },
      { agent: { en: "Stakeholder Mapper", ar: "خرائط أصحاب المصلحة" }, surface: "operator", label: { en: "Identified 14 must-attend stakeholders.", ar: "تحديد 14 معنيّاً." }, hapa: ["H4"] },
      { agent: { en: "Brief Writer", ar: "كاتب الموجز" }, surface: "operator", label: { en: "Drafted EN+AR kickoff, deliverable, debrief.", ar: "صياغة الموجزات بالعربية والإنجليزية." }, hapa: ["H5"] },
    ],
    authorise: {
      intent: { en: "Authorise mobilisation of Red Team sprint", ar: "اعتماد حشد جولة فريق الاستجابة" },
      by: { en: "Faisal (Red Team Lead)", ar: "فيصل (قائد الفريق)" },
      commits: { en: "Block calendars for 14 stakeholders, book Hub Room A, send EN+AR pre-reads, target Day-3 sign-off.", ar: "حجز تقاويم 14 معنيّاً، قاعة A، موجزات، اعتماد اليوم الثالث." },
      hapa: ["H4", "H6"],
    },
    forbidden: {
      attempt: { en: "Workshop Architect tries to schedule a workshop on a public holiday with no fallback plan.", ar: "يحاول مهندس الورشة جدولتها في عطلة رسمية بلا بديل." },
      agent: { en: "Workshop Architect", ar: "مهندس الورشة" },
      contract: std(["draft_plan", "draft_brief"], ["mobilise_workshop"], ["schedule_on_public_holiday"]),
    },
  },

  // ============================================================
  // 5 — Service Redesign Co-Pilot
  // ============================================================
  {
    slug: "dge-service-redesign",
    number: "05",
    title: { en: "Service Redesign Co-Pilot", ar: "مساعد إعادة تصميم الخدمات" },
    oneLine: {
      en: "Five-phase pipeline (Research → Journey → Blueprint → Action Plan → QA Gate) for 'Issue a New Trade Licence' across 4 entities and 9 As-Is touchpoints.",
      ar: "خط أنابيب من 5 مراحل لـ 'إصدار رخصة تجارية جديدة' عبر 4 جهات و9 نقاط لمس.",
    },
    factory: "service-redesign",
    agentStack: [
      { en: "Research Sentinel", ar: "حارس البحث" },
      { en: "Journey Sentinel", ar: "حارس الرحلة" },
      { en: "Blueprint Sentinel", ar: "حارس المخطّط" },
      { en: "Action Plan Sentinel", ar: "حارس خطة العمل" },
      { en: "QA Gate Sentinel", ar: "بوابة الجودة" },
    ],
    kpis: [
      { label: { en: "Redesign cycle", ar: "دورة إعادة التصميم" }, before: "12 weeks", after: "18 days", delta: { en: "−79%", ar: "−79%" } },
      { label: { en: "Workshop prep", ar: "تحضير الورشة" }, before: "80 hours", after: "6 hours", delta: { en: "−93%", ar: "−93%" } },
      { label: { en: "Service freshness", ar: "حداثة الخدمة" }, before: "12%", after: "100%", delta: { en: "+88 pts", ar: "+88 نقطة" } },
    ],
    citizen: {
      persona: { en: "New entrepreneur opening a café", ar: "ريادي يفتتح مقهى" },
      intro: {
        en: "The new 3-screen 'Start a Business' experience plays in 90 seconds. As-Is took 28 days; To-Be takes 4.",
        ar: "تجربة 'ابدأ عملك' في 3 شاشات و90 ثانية. القديم 28 يوماً؛ الجديد 4.",
      },
      blocks: [
        { title: { en: "Step 1 · Confirm name", ar: "خطوة 1 · تأكيد الاسم" }, body: { en: "Name check across 4 registries in 2 seconds.", ar: "فحص الاسم عبر 4 سجلات خلال ثانيتين." } },
        { title: { en: "Step 2 · Pick activity", ar: "خطوة 2 · اختر النشاط" }, body: { en: "Top 6 suggestions ranked by demand in your district.", ar: "6 مقترحات مرتّبة بالطلب في حيّك." } },
        { title: { en: "Step 3 · Pay & receive", ar: "خطوة 3 · ادفع واستلم" }, body: { en: "Pay AED 590; licence PDF arrives in 3 minutes.", ar: "ادفع 590 درهماً؛ يصل PDF خلال 3 دقائق." } },
      ],
    },
    operator: {
      persona: { en: "Reem — Service Designer, DGE", ar: "ريم — مصمّمة خدمات، DGE" },
      intro: {
        en: "5-phase pipeline cockpit: Research Pack with AMBER findings, As-Is/To-Be journey, blueprint swim-lane, action plan, QA scorecard.",
        ar: "كونسول 5 مراحل: حزمة بحث، رحلة، مخطّط، خطة، بطاقة جودة.",
      },
      blocks: [
        {
          title: { en: "Phase 3 · Service Blueprint", ar: "المرحلة 3 · المخطّط" },
          body: { en: "Frontstage / Backstage / Support / Event contracts wired with payload schemas and audit fields.", ar: "الواجهة / الكواليس / الدعم / عقود الأحداث مع مخططات وسجل تدقيق." },
        },
        {
          title: { en: "Phase 5 · QA Gate", ar: "المرحلة 5 · بوابة الجودة" },
          body: { en: "TAMM CX framework GREEN, accessibility GREEN, bilingual GREEN, 14 life-moments coherence AMBER (one missing).", ar: "إطار TAMM أخضر، الوصول أخضر، ثنائي اللغة أخضر، تماسك أصفر." },
        },
      ],
    },
    governance: {
      persona: { en: "Programme Director — 500 services in flight", ar: "مدير البرنامج — 500 خدمة" },
      intro: {
        en: "Phase per service, weekly throughput, SLA risk, and freshness sweep flagging services last touched >90 days.",
        ar: "مرحلة لكل خدمة، إنتاجية أسبوعية، مخاطر SLA، وفحص حداثة.",
      },
      blocks: [
        {
          title: { en: "Portfolio scoreboard", ar: "لوحة المحفظة" },
          body: { en: "Weekly throughput: 22 services. Stale (>90d) flagged: 18. SLA at-risk: 4.", ar: "أسبوعياً: 22 خدمة. متقادم: 18. مخاطرة: 4." },
        },
      ],
    },
    steps: [
      { agent: { en: "Research Sentinel", ar: "حارس البحث" }, surface: "operator", label: { en: "Research Pack ready, Singapore + Estonia benchmarks.", ar: "حزمة البحث جاهزة، معايير سنغافورة وإستونيا." }, hapa: ["H1", "H4"] },
      { agent: { en: "Journey Sentinel", ar: "حارس الرحلة" }, surface: "operator", label: { en: "As-Is/To-Be journey with 4 moments of truth.", ar: "رحلة قديم/جديد بـ 4 لحظات حقيقة." }, hapa: ["H6"] },
      { agent: { en: "Blueprint Sentinel", ar: "حارس المخطّط" }, surface: "operator", label: { en: "Service blueprint generated with payload schemas.", ar: "إنشاء المخطّط مع المخططات." }, hapa: ["H5"] },
      { agent: { en: "Action Plan Sentinel", ar: "حارس خطة العمل" }, surface: "operator", label: { en: "Milestones, owners, risk register, facilitation pack.", ar: "محطات، مسؤولون، سجل مخاطر، حزمة تيسير." } },
      { agent: { en: "QA Gate Sentinel", ar: "بوابة الجودة" }, surface: "governance", label: { en: "Scorecard 4 GREEN, 1 AMBER — coherence flagged.", ar: "بطاقة 4 أخضر، 1 أصفر." }, hapa: ["H6"] },
    ],
    authorise: {
      intent: { en: "Authorise commit of To-Be journey", ar: "اعتماد رحلة المستقبل" },
      by: { en: "Reem (Service Designer)", ar: "ريم (مصمّمة خدمات)" },
      commits: { en: "Promote To-Be journey to Action Plan; lock 4 entities to milestone calendar; trigger blueprint review.", ar: "ترقية الرحلة إلى خطة العمل، قفل 4 جهات على جدول المحطّات، تفعيل مراجعة المخطّط." },
      hapa: ["H4", "H6"],
    },
    forbidden: {
      attempt: { en: "Action Plan Sentinel tries to publish a journey that failed the QA Gate AMBER step.", ar: "يحاول حارس الخطة نشر رحلة فشلت في بوابة الجودة." },
      agent: { en: "Action Plan Sentinel", ar: "حارس خطة العمل" },
      contract: std(["draft_plan", "schedule_milestones"], ["promote_to_be"], ["publish_with_open_amber"]),
    },
  },

  // ============================================================
  // 6 — Spokes Review Agent
  // ============================================================
  {
    slug: "dge-spokes-review",
    number: "06",
    title: { en: "Spokes Review Agent", ar: "وكيل مراجعة الجهات الفرعية" },
    oneLine: {
      en: "Reviews 12 synthetic spoke service-design submissions, completeness + principles scorecard, drafts critique in EN+AR; blocks feedback on a submission missing the To-Be journey.",
      ar: "يراجع 12 إرسالاً من الجهات الفرعية، بطاقة اكتمال + مبادئ، وصياغة نقد بالعربية والإنجليزية.",
    },
    factory: "spokes-review",
    agentStack: [
      { en: "Submission Reader", ar: "قارئ الإرسال" },
      { en: "Coherence Sentinel", ar: "حارس التناسق" },
      { en: "Principles Sentinel", ar: "حارس المبادئ" },
      { en: "Critique Drafter", ar: "كاتب النقد" },
    ],
    kpis: [
      { label: { en: "Turnaround time", ar: "وقت الإنجاز" }, before: "9 days", after: "12 hours", delta: { en: "−95%", ar: "−95%" } },
      { label: { en: "First-pass acceptance", ar: "قبول من المرة الأولى" }, before: "22%", after: "51%", delta: { en: "+29 pts", ar: "+29 نقطة" } },
      { label: { en: "Reviews / FTE / month", ar: "مراجعات / موظف / شهر" }, before: "35", after: "120", delta: { en: "+243%", ar: "+243%" } },
    ],
    citizen: {
      persona: { en: "Why this matters to citizens", ar: "لماذا يهمّ هذا المواطنين" },
      intro: {
        en: "Spokes Review keeps every entity's service design coherent with the DGE life-moments framework — so a citizen never re-explains themselves between agencies.",
        ar: "تحافظ المراجعة على تناسق التصميم عبر الجهات — حتى لا يضطر المواطن لإعادة الشرح بين الوزارات.",
      },
      blocks: [
        {
          title: { en: "What changes for the citizen", ar: "ما الذي يتغيّر للمواطن" },
          body: { en: "Consistent forms, shared identity, single payment gateway, one inbox — across 60 entities.", ar: "نماذج موحّدة، هوية مشتركة، بوابة دفع واحدة، صندوق واحد — عبر 60 جهة." },
        },
      ],
    },
    operator: {
      persona: { en: "Hala — Spokes Reviewer, DGE", ar: "هالة — مراجعة الجهات، DGE" },
      intro: {
        en: "Hala's queue: 12 submissions, completeness check, principles scorecard, missing-artefacts list, prior precedents, drafted EN+AR feedback.",
        ar: "قائمة هالة: 12 إرسالاً، فحص اكتمال، بطاقة مبادئ، قائمة مفقودات، سوابق، ومسوّدات تغذية راجعة.",
      },
      blocks: [
        {
          title: { en: "Submission #07 · ADAA — Trade licence renewal", ar: "إرسال #07 · أداء — تجديد رخصة تجارية" },
          body: { en: "Completeness 86% (To-Be journey missing). Principles 4/5 (Always Fair partial). Critique drafted in 8 minutes.", ar: "اكتمال 86% (الرحلة المستقبلية مفقودة). مبادئ 4/5. النقد جاهز خلال 8 دقائق." },
        },
      ],
    },
    governance: {
      persona: { en: "Director Layla — Spokes Programme", ar: "المديرة ليلى — برنامج الجهات" },
      intro: {
        en: "750 reviews planned this year — completed, in-progress, iterating, first-feedback SLA, quality trend per entity.",
        ar: "750 مراجعة هذا العام — مكتمل، قيد التنفيذ، تكرار، SLA، اتجاه جودة.",
      },
      blocks: [
        {
          title: { en: "Programme dashboard", ar: "لوحة البرنامج" },
          body: { en: "412 completed · 86 in-progress · 28 iterating. Median first-feedback SLA: 11 hours.", ar: "412 مكتمل · 86 قيد التنفيذ · 28 تكرار. متوسّط SLA: 11 ساعة." },
        },
      ],
    },
    steps: [
      { agent: { en: "Submission Reader", ar: "قارئ الإرسال" }, surface: "operator", label: { en: "Parsed 12 submissions and supporting artefacts.", ar: "تحليل 12 إرسالاً ومرفقاتها." }, hapa: ["H1"] },
      { agent: { en: "Coherence Sentinel", ar: "حارس التناسق" }, surface: "operator", label: { en: "Cross-checked against 14 life-moments framework.", ar: "فحص متبادل مقابل 14 لحظة حياتية." }, hapa: ["H4", "H6"] },
      { agent: { en: "Principles Sentinel", ar: "حارس المبادئ" }, surface: "operator", label: { en: "Scored 4 of 5 promises GREEN, 1 partial.", ar: "تقييم 4 من 5 وعود أخضر، 1 جزئي." }, hapa: ["H6"] },
      { agent: { en: "Critique Drafter", ar: "كاتب النقد" }, surface: "operator", label: { en: "Drafted EN+AR feedback in 8 minutes.", ar: "صياغة تغذية راجعة خلال 8 دقائق." }, hapa: ["H5"] },
    ],
    authorise: {
      intent: { en: "Authorise return of feedback to submitting team", ar: "اعتماد إرسال التغذية الراجعة" },
      by: { en: "Hala (Spokes Reviewer)", ar: "هالة (مراجعة الجهات)" },
      commits: { en: "Send drafted EN+AR feedback to ADAA team and auto-schedule the next 30-day follow-up.", ar: "إرسال التغذية إلى أداء وجدولة متابعة 30 يوماً." },
      hapa: ["H6"],
    },
    forbidden: {
      attempt: { en: "Critique Drafter tries to send feedback on a submission whose To-Be journey is missing.", ar: "يحاول كاتب النقد إرسال تغذية على إرسال تنقصه الرحلة المستقبلية." },
      agent: { en: "Critique Drafter", ar: "كاتب النقد" },
      contract: std(["draft_critique", "score_principles"], ["send_feedback"], ["send_feedback_when_incomplete"]),
    },
  },
];

export function getDgeDemo(slug: string): DgeDemo | undefined {
  return DGE_DEMOS.find((d) => d.slug === slug);
}
