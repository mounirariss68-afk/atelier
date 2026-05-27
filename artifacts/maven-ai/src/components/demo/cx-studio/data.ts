import type { T } from "@/lib/lang";

export type SquadId =
  | "listening"
  | "design"
  | "operations"
  | "outcomes"
  | "governance";

export interface Squad {
  id: SquadId;
  name: T;
  blurb: T;
  color: string;
}

export const SQUADS: Squad[] = [
  {
    id: "listening",
    name: { en: "Listening & Insight", ar: "الإصغاء والاستبصار", tr: "Dinleme ve İçgörü" },
    blurb: {
      en: "Turns transcripts, ethnography and benchmarks into structured customer truth.",
      ar: "يحوّل النصوص والإثنوغرافيا والمعايير إلى حقيقة منظّمة عن العميل.",
      tr: "Transkriptleri, etnografi ve kıyaslamaları yapılandırılmış müşteri gerçeğine çevirir.",
    },
    color: "#0E7C7B",
  },
  {
    id: "design",
    name: { en: "Service Design", ar: "تصميم الخدمة", tr: "Hizmet Tasarımı" },
    blurb: {
      en: "Maps the journey, blueprints the service, picks the moments that matter, prototypes the redesign.",
      ar: "يرسم الرحلة، يصمّم الخدمة، يختار اللحظات المؤثّرة، ويُنشئ النموذج الأوّلي.",
      tr: "Yolculuğu haritalar, hizmeti blueprint'ler, önemli anları seçer ve yeniden tasarımı prototipler.",
    },
    color: "#F5715A",
  },
  {
    id: "operations",
    name: { en: "Operations & Channels", ar: "العمليات والقنوات", tr: "Operasyon ve Kanallar" },
    blurb: {
      en: "Allocates channels, designs the pilot, coaches the frontline that has to land it.",
      ar: "يخصّص القنوات، يصمّم التجربة، ويدرّب الصف الأمامي.",
      tr: "Kanal tahsis eder, pilotu tasarlar, ön safları koçlar.",
    },
    color: "#5B7CFF",
  },
  {
    id: "outcomes",
    name: { en: "Outcomes & Value", ar: "النتائج والقيمة", tr: "Sonuçlar ve Değer" },
    blurb: {
      en: "Ties every redesign to a measurable KPI, a P&L number and a forecastable CSAT lift.",
      ar: "يربط كل إعادة تصميم بمؤشر قابل للقياس ورقم في الميزانية وتوقّع تحسّن CSAT.",
      tr: "Her yeniden tasarımı ölçülebilir KPI, P&L sayısı ve tahminlenebilir CSAT artışına bağlar.",
    },
    color: "#7C3AED",
  },
  {
    id: "governance",
    name: { en: "Governance & Change", ar: "الحوكمة والتغيير", tr: "Yönetişim ve Değişim" },
    blurb: {
      en: "Makes the redesign safe to deploy, fair to all dialects, and adopted across the network.",
      ar: "يجعل التصميم آمناً للنشر، عادلاً لكل اللهجات، ومتبنّى عبر الشبكة.",
      tr: "Yeniden tasarımı güvenle dağıtılabilir, tüm lehçelere adil ve ağ genelinde benimsenen kılar.",
    },
    color: "#0A1230",
  },
];

export type AgentId =
  | "customer-insight" | "ethnographic-researcher" | "ecosystem-mapper" | "persona-modeler"
  | "journey-mapper" | "service-blueprinter" | "moments-designer" | "usability-tester"
  | "channel-orchestrator" | "touchpoint-designer" | "staff-experience"
  | "kpi-tree-compiler" | "cx-strategist" | "csat-forecaster"
  | "compliance-sentinel" | "emotion-sentiment" | "change-manager";

export type WorkbenchKey =
  | "voc-themes" | "ethno-notes" | "bench-grid" | "personas"
  | "journey" | "blueprint" | "moments" | "concept-board"
  | "channel-matrix" | "pilot-plan" | "coach-board"
  | "kpi-tree" | "cost-waterfall" | "csat-forecast"
  | "compliance-map" | "bias-log" | "change-plan";

export interface Agent {
  id: AgentId;
  squad: SquadId;
  name: T;
  role: T;
  inputs: T[];
  output: T;
  workbench: WorkbenchKey;
  /** Tool calls the agent makes — surfaced in the cockpit drawer. */
  toolCalls: Array<{ tool: string; arg: T; ms: number }>;
  /** Operator persona owner (who relies most on this agent). */
  ownedBy: PersonaId;
  checkpoint: T;
  trace: T[];
  /** Narrator caption surfaced during scripted run. */
  narration: T;
}

export type PersonaId = "cx-director" | "service-designer" | "ops-lead" | "exec-sponsor";

export const PERSONAS: Array<{ id: PersonaId; name: T; focus: T; pinned: AgentId[] }> = [
  {
    id: "cx-director",
    name: { en: "CX Director", ar: "مدير تجربة العميل", tr: "CX Direktörü" },
    focus: { en: "Owns the journey, signs the moments-of-truth catalogue, owns the NPS narrative.", ar: "يملك الرحلة، يوقّع كتالوج لحظات الحقيقة، ويملك سرد NPS.", tr: "Yolculuğu sahiplenir, hakikat anı kataloğunu imzalar, NPS anlatısını yönetir." },
    pinned: ["journey-mapper", "moments-designer", "csat-forecaster", "change-manager"],
  },
  {
    id: "service-designer",
    name: { en: "Service Designer", ar: "مصمّم الخدمة", tr: "Hizmet Tasarımcısı" },
    focus: { en: "Lives in the blueprint, the prototypes, and the persona work. Drives the redesign drafts.", ar: "يعيش في المخطط والنماذج وعمل الشخصيات. يقود مسوّدات إعادة التصميم.", tr: "Blueprint, prototip ve persona çalışmasında yaşar. Yeniden tasarım taslaklarını yürütür." },
    pinned: ["persona-modeler", "ethnographic-researcher", "service-blueprinter", "usability-tester"],
  },
  {
    id: "ops-lead",
    name: { en: "Operations Lead", ar: "قائد العمليات", tr: "Operasyon Lideri" },
    focus: { en: "Owns the pilot plan, channel allocation and frontline adoption — \"will my branches land it?\"", ar: "يملك خطة التجربة وتخصيص القنوات وتبنّي الصف الأمامي.", tr: "Pilot planı, kanal tahsisi ve ön saf benimsemesini sahiplenir." },
    pinned: ["channel-orchestrator", "touchpoint-designer", "staff-experience", "cx-strategist"],
  },
  {
    id: "exec-sponsor",
    name: { en: "Executive Sponsor", ar: "الراعي التنفيذي", tr: "Yönetici Sponsor" },
    focus: { en: "Reads the KPI tree, the cost waterfall, the compliance map. Signs the board narrative.", ar: "يقرأ شجرة المؤشرات، شلال التكلفة، خريطة الامتثال. يوقّع سرد المجلس.", tr: "KPI ağacını, maliyet şelalesini, uyumluluk haritasını okur. Yönetim anlatısını imzalar." },
    pinned: ["customer-insight", "kpi-tree-compiler", "cx-strategist", "compliance-sentinel"],
  },
];

// ─── Scenarios ──────────────────────────────────────────────────────────
export type ScenarioId = "falcon-sme" | "etisalat-enterprise";

export interface Scenario {
  id: ScenarioId;
  client: T;
  industry: T;
  scenario: T;
  contractValue: T;
  sponsor: T;
  brief: T;
  /** Customer-side personas (named, three each). */
  customers: Array<{ id: string; name: T; segment: T; quote: T }>;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "falcon-sme",
    client: { en: "Falcon Bank", ar: "بنك فالكون", tr: "Falcon Bank" },
    industry: { en: "Financial services · UAE / KSA", ar: "خدمات مالية · الإمارات / السعودية", tr: "Finansal hizmetler · BAE / KSA" },
    scenario: { en: "SME onboarding redesign — close a −22 NPS gap vs Gulf benchmark in 90 days.", ar: "إعادة تصميم استقبال الشركات الصغيرة — إغلاق فجوة NPS −22 خلال 90 يوماً.", tr: "KOBİ onboarding yeniden tasarımı — −22 NPS açığını 90 günde kapatma." },
    contractValue: { en: "AED 4.2M, 90 days", ar: "4.2 مليون درهم، 90 يوماً", tr: "4,2 M AED, 90 gün" },
    sponsor: { en: "Hala Al-Mazrouei, Chief Customer Officer", ar: "هلا المزروعي، كبير مسؤولي العملاء", tr: "Hala Al-Mazrouei, Müşteri Direktörü" },
    brief: { en: "Falcon's SME onboarding takes 11 working days against a Gulf median of 4. Customers churn at KYC stage 3, RM hand-offs go silent for 5+ days, and the Arabic flow reads as a literal translation.", ar: "استقبال الشركات الصغيرة في فالكون يستغرق 11 يوم عمل مقابل وسيط خليجي 4. العملاء يتركون عند مرحلة KYC الثالثة، تحويل RM يصمت 5 أيام، والتدفق العربي يبدو ترجمة حرفية.", tr: "Falcon'un KOBİ onboarding süresi 11 iş günü, Körfez medyanı 4. Müşteriler KYC 3. aşamada kayboluyor, RM devirleri 5+ gün sessiz." },
    customers: [
      { id: "khalid", name: { en: "Khalid — Riyadh trading-co founder", ar: "خالد — مؤسّس شركة تجارة الرياض", tr: "Khalid — Riyad ticaret-co kurucu" }, segment: { en: "SME, AED 8M revenue", ar: "شركة صغيرة، 8 مليون درهم", tr: "KOBİ, 8 M AED" }, quote: { en: "I sent the same trade licence four times. No one reads it.", ar: "أرسلت الرخصة التجارية أربع مرات. لا أحد يقرأها.", tr: "Aynı ticaret lisansını dört kez gönderdim. Kimse okumuyor." } },
      { id: "mariam", name: { en: "Mariam — Dubai clinic owner", ar: "مريم — مالكة عيادة دبي", tr: "Mariam — Dubai klinik sahibi" }, segment: { en: "Healthcare SME", ar: "شركة صحية", tr: "Sağlık KOBİ" }, quote: { en: "Branch told me to use the app. App told me to go to branch.", ar: "الفرع طلب أن أستخدم التطبيق. التطبيق طلب أن أذهب للفرع.", tr: "Şube uygulama dedi. Uygulama şube dedi." } },
      { id: "elif", name: { en: "Elif — Istanbul logistics CEO", ar: "إليف — مديرة لوجستيات إسطنبول", tr: "Elif — İstanbul lojistik CEO" }, segment: { en: "Mid-market SME", ar: "شركة متوسطة", tr: "Orta-pazar KOBİ" }, quote: { en: "Two weeks waiting for an RM call that never came.", ar: "أسبوعان بانتظار اتصال RM لم يصل.", tr: "İki hafta hiç gelmeyen bir RM çağrısı bekledim." } },
    ],
  },
  {
    id: "etisalat-enterprise",
    client: { en: "Etisalat", ar: "اتصالات", tr: "Etisalat" },
    industry: { en: "Telecom · UAE", ar: "اتصالات · الإمارات", tr: "Telekom · BAE" },
    scenario: { en: "Enterprise account activation redesign — collapse 18-day provisioning to 5 days, CSAT +20.", ar: "إعادة تصميم تفعيل حسابات المؤسّسات — تقليص التوفير من 18 إلى 5 أيام، CSAT +20.", tr: "Kurumsal hesap aktivasyonu — 18 günlük tedariği 5 güne indirme, CSAT +20." },
    contractValue: { en: "AED 5.6M, 120 days", ar: "5.6 مليون درهم، 120 يوماً", tr: "5,6 M AED, 120 gün" },
    sponsor: { en: "Yousef Bin Khalid, EVP Enterprise", ar: "يوسف بن خالد، نائب الرئيس للأعمال", tr: "Yousef Bin Khalid, Kurumsal EVP" },
    brief: { en: "Enterprise activation requires 9 hand-offs across sales, billing, network, and field-ops; SLAs are missed on 41% of orders. Account managers spend 60% of their week chasing internal queues.", ar: "تفعيل المؤسّسات يتطلّب 9 تحويلات عبر المبيعات والفوترة والشبكة والميدان؛ تُخلَف الـ SLA على 41% من الطلبات.", tr: "Kurumsal aktivasyon 9 devir gerektirir, SLA'lar siparişlerin %41'inde kaçar." },
    customers: [
      { id: "khalid-e", name: { en: "Khalid — head of IT, retail chain (220 sites)", ar: "خالد — رئيس IT، سلسلة تجزئة", tr: "Khalid — IT başkanı, perakende zinciri" }, segment: { en: "Enterprise, 220 sites", ar: "مؤسّسة، 220 موقع", tr: "Kurumsal, 220 site" }, quote: { en: "I've been chasing one circuit for 23 days.", ar: "أتابع دائرة واحدة منذ 23 يوماً.", tr: "23 gündür tek bir devre peşinde koşuyorum." } },
      { id: "mariam-e", name: { en: "Mariam — COO, healthcare network", ar: "مريم — COO، شبكة صحية", tr: "Mariam — COO, sağlık ağı" }, segment: { en: "Enterprise, regulated", ar: "مؤسّسة، منظّمة", tr: "Kurumsal, düzenlenmiş" }, quote: { en: "Three account managers in three months.", ar: "ثلاثة مدراء حسابات في ثلاثة أشهر.", tr: "Üç ayda üç hesap yöneticisi." } },
      { id: "elif-e", name: { en: "Elif — CFO, logistics group", ar: "إليف — CFO، مجموعة لوجستيات", tr: "Elif — CFO, lojistik grubu" }, segment: { en: "Enterprise, multi-country", ar: "مؤسّسة، متعدّدة الدول", tr: "Kurumsal, çok-ülkeli" }, quote: { en: "I can't reconcile invoices because every site is on a different plan.", ar: "لا أستطيع تسوية الفواتير لأن كل موقع على خطة مختلفة.", tr: "Faturaları mutabık kılamıyorum çünkü her site farklı planda." } },
    ],
  },
];

export const AGENTS: Agent[] = [
  // ── Listening & Insight ───────────────────────────────────────────
  {
    id: "customer-insight", squad: "listening",
    name: { en: "Customer Insight Synthesizer", ar: "مُلخّص رؤى العميل", tr: "Müşteri İçgörü Sentezleyici" },
    role: { en: "Clusters complaint, survey and call-transcript verbatims into ranked themes with NPS impact.", ar: "يجمّع الشكاوى والاستبيانات ونصوص المكالمات في موضوعات مرتّبة مع أثر NPS.", tr: "Şikayet, anket ve çağrı transkriptlerini NPS etkili sıralı temalara kümeler." },
    inputs: [
      { en: "1,247 NPS verbatims (Q4)", ar: "1,247 إجابة NPS (الربع الرابع)", tr: "1.247 NPS cevabı (Ç4)" },
      { en: "812 complaint logs", ar: "812 سجل شكوى", tr: "812 şikayet kaydı" },
      { en: "3,108 call transcripts (EN/AR)", ar: "3,108 نصّ مكالمة", tr: "3.108 çağrı transkripti" },
    ],
    output: { en: "Ranked VoC themes with sample quotes", ar: "موضوعات VoC مرتّبة مع اقتباسات", tr: "Örneklerle sıralı VoC temaları" },
    workbench: "voc-themes",
    toolCalls: [
      { tool: "embed.bilingual", arg: { en: "5,167 verbatims", ar: "5,167 إجابة", tr: "5.167 cevap" }, ms: 4220 },
      { tool: "cluster.hdbscan", arg: { en: "min=18", ar: "حد أدنى=18", tr: "min=18" }, ms: 1840 },
      { tool: "rank.npsImpact", arg: { en: "logit β fit", ar: "ملاءمة β", tr: "logit β uyumu" }, ms: 920 },
    ],
    ownedBy: "exec-sponsor",
    checkpoint: { en: "Insight lead reviews top 5 themes", ar: "قائد الاستبصار يراجع أعلى 5 موضوعات", tr: "İçgörü lideri ilk 5 temayı inceler" },
    trace: [
      { en: "Embedded 5,167 verbatims with bilingual sentence transformer.", ar: "تضمين 5,167 إجابة بمحوّل جمل ثنائي اللغة.", tr: "5.167 cevap iki dilli dönüştürücü ile gömüldü." },
      { en: "Clustered into 14 candidate themes (HDBSCAN, min_cluster_size=18).", ar: "تجميع في 14 موضوعاً مرشّحاً.", tr: "14 aday tema kümelendi." },
      { en: "Pruned to 7 with TF-IDF distinctness ≥ 0.62.", ar: "تقليم إلى 7.", tr: "TF-IDF ile 7'ye indirildi." },
      { en: "Ranked by frequency × NPS impact (β = -0.41 for top theme).", ar: "ترتيب بالتكرار × أثر NPS.", tr: "Frekans × NPS etkisi ile sıralandı." },
    ],
    narration: { en: "We start with the customer's own words — 5,167 verbatims clustered into 7 themes ranked by their pull on NPS.", ar: "نبدأ بكلمات العميل نفسه — 5,167 إجابة مجمّعة في 7 موضوعات مرتّبة حسب أثرها على NPS.", tr: "Müşterinin kendi sözleriyle başlıyoruz — 5.167 cevap, NPS etkisine göre sıralı 7 temaya kümelenmiş." },
  },
  {
    id: "ethnographic-researcher", squad: "listening",
    name: { en: "Ethnographic Researcher", ar: "الباحث الإثنوغرافي", tr: "Etnografik Araştırmacı" },
    role: { en: "Generates field-study notes from session recordings — what customers actually do, not what they say.", ar: "يولّد ملاحظات ميدانية من تسجيلات الجلسات — ما يفعله العملاء فعلاً.", tr: "Oturum kayıtlarından saha çalışması notları üretir — müşterilerin gerçekte yaptığı." },
    inputs: [{ en: "12 in-branch session recordings, 9 app screen-recordings", ar: "12 تسجيل جلسة فرع، 9 تسجيل شاشة", tr: "12 şube oturum kaydı, 9 ekran kaydı" }],
    output: { en: "Field-study note set with behaviour codes", ar: "مجموعة ملاحظات ميدانية مع رموز السلوك", tr: "Davranış kodlu saha notu seti" },
    workbench: "ethno-notes",
    toolCalls: [
      { tool: "transcribe.video", arg: { en: "21 sessions", ar: "21 جلسة", tr: "21 oturum" }, ms: 6810 },
      { tool: "code.behaviour", arg: { en: "rubric v3", ar: "نظام التصنيف v3", tr: "rubrik v3" }, ms: 2310 },
    ],
    ownedBy: "service-designer",
    checkpoint: { en: "Service Designer validates the behaviour codes", ar: "مصمّم الخدمة يتحقّق من رموز السلوك", tr: "Hizmet Tasarımcısı davranış kodlarını doğrular" },
    trace: [
      { en: "Transcribed 21 sessions (4h 18m total).", ar: "تفريغ 21 جلسة (4س 18د).", tr: "21 oturum tarandı." },
      { en: "Coded 187 behaviour moments against rubric v3.", ar: "ترميز 187 لحظة سلوك مقابل النظام v3.", tr: "187 davranış anı v3 rubriğine kodlandı." },
      { en: "Cross-checked with Insight Synthesizer — 6 theme overlaps confirmed.", ar: "تدقيق متقاطع مع المُلخّص — 6 تطابقات.", tr: "İçgörü Sentezleyici ile çapraz kontrol — 6 örtüşme." },
    ],
    narration: { en: "What customers say in surveys is half the truth. The Ethnographic Researcher watches what they do.", ar: "ما يقوله العملاء في الاستبيانات نصف الحقيقة. الباحث الإثنوغرافي يراقب ما يفعلونه.", tr: "Müşterilerin söylediği yarı gerçektir. Etnografik Araştırmacı ne yaptıklarını izler." },
  },
  {
    id: "ecosystem-mapper", squad: "listening",
    name: { en: "Ecosystem Mapper", ar: "مُحلِّل المنظومة", tr: "Ekosistem Haritacısı" },
    role: { en: "Maps every actor in the customer's ecosystem — 6 regional bank peers, 4 fintechs, 3 govt registries — and scores Falcon's relative position on each journey stage.", ar: "يرسم منظومة العميل ويقيّم موقع فالكون النسبي.", tr: "Müşterinin ekosistemini haritalar ve Falcon'un göreli konumunu puanlar." },
    inputs: [{ en: "6 peer mystery-shop runs", ar: "6 جولات تسوّق سرّي", tr: "6 gizli müşteri turu" }],
    output: { en: "Benchmark grid (peers × stages) with deltas", ar: "شبكة معايير (منافسون × مراحل)", tr: "Kıyaslama ızgarası (rakipler × aşamalar)" },
    workbench: "bench-grid",
    toolCalls: [
      { tool: "shop.script", arg: { en: "6 peers × 7 stages", ar: "6 منافسين × 7 مراحل", tr: "6 rakip × 7 aşama" }, ms: 9120 },
      { tool: "score.normalize", arg: { en: "0–100 scale", ar: "مقياس 0–100", tr: "0–100 ölçeği" }, ms: 410 },
    ],
    ownedBy: "exec-sponsor",
    checkpoint: { en: "Strategy lead confirms peer set", ar: "قائد الاستراتيجية يؤكد مجموعة المنافسين", tr: "Strateji lideri rakip kümesini onaylar" },
    trace: [
      { en: "Mystery-shopped 6 peers across 7 journey stages.", ar: "تسوّق سرّي عبر 6 منافسين × 7 مراحل.", tr: "6 rakipte 7 aşama gizli müşteri." },
      { en: "Falcon ranks 5th of 7 on KYC, 6th on RM intro.", ar: "فالكون 5/7 في KYC، 6/7 في RM.", tr: "Falcon KYC'de 5/7, RM'de 6/7." },
    ],
    narration: { en: "We benchmark against the regional peer set — Falcon is bottom-quartile on the two moments that matter most.", ar: "نقارن بمجموعة المنافسين الإقليمية — فالكون في الربع الأدنى.", tr: "Bölgesel rakiplerle kıyaslıyoruz — Falcon en kritik iki anda alt çeyrekte." },
  },
  {
    id: "persona-modeler", squad: "listening",
    name: { en: "Persona Modeler", ar: "نمذجة الشخصيات", tr: "Persona Modelleyici" },
    role: { en: "Builds 3 evidence-backed personas (Khalid, Mariam, Elif) tied to themes and behaviour codes.", ar: "يبني 3 شخصيات مدعومة بالأدلة (خالد، مريم، إليف).", tr: "Kanıt destekli 3 persona (Khalid, Mariam, Elif) oluşturur." },
    inputs: [{ en: "VoC themes + ethnography codes + CRM segments", ar: "موضوعات VoC + رموز إثنوغرافيا + شرائح CRM", tr: "VoC temaları + etnografi kodları + CRM segmentleri" }],
    output: { en: "3 evidence-backed personas (Khalid, Mariam, Elif)", ar: "3 شخصيات (خالد، مريم، إليف)", tr: "3 persona (Khalid, Mariam, Elif)" },
    workbench: "personas",
    toolCalls: [
      { tool: "join.crmSegments", arg: { en: "industry × revenue × tenure", ar: "قطاع × إيراد × أقدمية", tr: "sektör × gelir × süre" }, ms: 1310 },
      { tool: "draft.cards", arg: { en: "3 cards × 5 fields", ar: "3 بطاقات × 5 حقول", tr: "3 kart × 5 alan" }, ms: 720 },
    ],
    ownedBy: "service-designer",
    checkpoint: { en: "CMO confirms persona names + cover", ar: "مدير التسويق يؤكد الأسماء والصورة", tr: "CMO persona adlarını + görseli onaylar" },
    trace: [
      { en: "Selected 3 personas covering 78% of complaint volume.", ar: "اختيار 3 شخصيات تغطّي 78% من الشكاوى.", tr: "Şikayetlerin %78'ini kapsayan 3 persona." },
      { en: "Backfilled jobs/pains/gains from 42 quotes per persona.", ar: "تعبئة من 42 اقتباساً لكل شخصية.", tr: "Persona başına 42 alıntı." },
    ],
    narration: { en: "Three personas: Khalid the trading-co founder, Mariam the clinic owner, Elif the logistics CEO.", ar: "ثلاث شخصيات: خالد، مريم، إليف.", tr: "Üç persona: Khalid, Mariam, Elif." },
  },
  // ── Service Design ────────────────────────────────────────────────
  {
    id: "journey-mapper", squad: "design",
    name: { en: "Journey Mapper", ar: "رسم الرحلات", tr: "Yolculuk Haritacısı" },
    role: { en: "Reconstructs the actual end-to-end journey from event logs and stitches it to personas.", ar: "يعيد بناء الرحلة الفعلية من سجلات الأحداث.", tr: "Loglardan gerçek yolculuğu yeniden inşa eder." },
    inputs: [{ en: "App + branch + call-centre event logs", ar: "سجلات أحداث التطبيق + الفرع + المركز", tr: "Uyg + şube + çağrı logları" }],
    output: { en: "7-stage journey with friction scores", ar: "رحلة 7 مراحل مع درجات الاحتكاك", tr: "Sürtüşme skorlu 7 aşamalı yolculuk" },
    workbench: "journey",
    toolCalls: [
      { tool: "stitch.events", arg: { en: "28,440 events / 11 systems", ar: "28,440 حدثاً / 11 نظاماً", tr: "28.440 olay / 11 sistem" }, ms: 3140 },
      { tool: "mine.sequence", arg: { en: "PrefixSpan, support 0.18", ar: "PrefixSpan", tr: "PrefixSpan, destek 0,18" }, ms: 2870 },
    ],
    ownedBy: "cx-director",
    checkpoint: { en: "Onboarding ops head verifies stage owners", ar: "رئيس عمليات الاستقبال يتحقّق من المسؤولين", tr: "Onboarding ops başkanı sahipleri doğrular" },
    trace: [
      { en: "Stitched 28,440 events across 11 systems via shared customer_id.", ar: "ربط 28,440 حدثاً عبر 11 نظاماً.", tr: "11 sistemde 28.440 olay dikildi." },
      { en: "Detected 7 canonical stages with sequence-mining.", ar: "اكتشاف 7 مراحل قانونية.", tr: "7 kanonik aşama tespit edildi." },
      { en: "Friction score = drop-off × time-in-stage × repeat-contacts.", ar: "الاحتكاك = التسرّب × الزمن × التواصل المتكرر.", tr: "Sürtüşme = düşüş × süre × tekrar." },
    ],
    narration: { en: "Seven stages, reconstructed from 28,440 real events across 11 systems. Stage 3 — KYC — is where it bleeds.", ar: "سبع مراحل من 28,440 حدثاً حقيقياً. المرحلة الثالثة — KYC — هي مكان النزيف.", tr: "Yedi aşama, 28.440 gerçek olaydan yeniden inşa. 3. aşama — KYC — kanama burada." },
  },
  {
    id: "service-blueprinter", squad: "design",
    name: { en: "Service Blueprinter", ar: "مصمّم الخدمة", tr: "Hizmet Blueprint'çisi" },
    role: { en: "Drafts the front-stage / back-stage blueprint for each journey stage with system + actor lanes.", ar: "يصوغ المخطط الأمامي/الخلفي لكل مرحلة.", tr: "Her aşama için ön/arka-sahne blueprint." },
    inputs: [{ en: "Journey stages + system inventory + RACI", ar: "المراحل + جرد الأنظمة + RACI", tr: "Aşamalar + sistem envanteri + RACI" }],
    output: { en: "Service blueprint with system + actor lanes", ar: "مخطط خدمة مع مسارات الأنظمة والأشخاص", tr: "Sistem + aktör koridorlu blueprint" },
    workbench: "blueprint",
    toolCalls: [
      { tool: "draft.lanes", arg: { en: "7 stages × 4 lanes", ar: "7 مراحل × 4 مسارات", tr: "7 aşama × 4 koridor" }, ms: 1840 },
      { tool: "detect.handoffs", arg: { en: "invisible hand-offs", ar: "تحويلات خفية", tr: "görünmez devirler" }, ms: 1120 },
    ],
    ownedBy: "service-designer",
    checkpoint: { en: "CCO signs the blueprint", ar: "كبير مسؤولي العملاء يوقّع المخطط", tr: "CCO blueprint'i imzalar" },
    trace: [
      { en: "For each of 7 stages: actor lane + system lane + evidence row.", ar: "لكل مرحلة: مسار شخص + نظام + أدلة.", tr: "Her aşama için: aktör + sistem + kanıt." },
      { en: "Found 4 invisible hand-offs (ops → branch → core banking) — flagged.", ar: "وجد 4 تحويلات خفية — مرفوعة.", tr: "4 görünmez devir — işaretlendi." },
    ],
    narration: { en: "The blueprint exposes four invisible hand-offs no team owned — that's where the customer falls between the cracks.", ar: "المخطط يكشف أربعة تحويلات خفية لم تملكها أي فرقة.", tr: "Blueprint, hiçbir takımın sahiplenmediği dört görünmez devri ifşa eder." },
  },
  {
    id: "moments-designer", squad: "design",
    name: { en: "Moments-of-Truth Designer", ar: "مصمّم لحظات الحقيقة", tr: "Hakikat Anı Tasarımcısı" },
    role: { en: "Identifies the 3–5 moments that disproportionately drive NPS and designs interventions.", ar: "يحدّد 3–5 لحظات تحرّك NPS ويصمّم التدخّلات.", tr: "NPS'i en çok etkileyen 3–5 anı tespit eder." },
    inputs: [{ en: "Blueprint + friction scores + benchmark grid", ar: "المخطط + الاحتكاك + شبكة المعايير", tr: "Blueprint + sürtüşme + kıyaslama" }],
    output: { en: "5 moments-of-truth with intervention briefs", ar: "5 لحظات حقيقة مع موجزات تدخّل", tr: "5 müdahale brief'i olan an" },
    workbench: "moments",
    toolCalls: [
      { tool: "regress.npsDrivers", arg: { en: "stage features", ar: "ميزات المراحل", tr: "aşama özellikleri" }, ms: 1240 },
      { tool: "draft.interventions", arg: { en: "5 briefs", ar: "5 موجزات", tr: "5 brief" }, ms: 980 },
    ],
    ownedBy: "cx-director",
    checkpoint: { en: "CCO ranks moments 1–5", ar: "CCO يرتّب اللحظات 1–5", tr: "CCO anları 1–5 sıralar" },
    trace: [
      { en: "Regressed NPS on stage features → top 5 explain 71% of variance.", ar: "انحدار NPS → أعلى 5 تفسّر 71%.", tr: "Regresyon — ilk 5 varyansın %71'i." },
      { en: "Drafted 5 intervention briefs with target uplift bands.", ar: "صياغة 5 موجزات تدخّل.", tr: "5 müdahale brief'i taslandı." },
    ],
    narration: { en: "Five moments. They explain 71% of the NPS variance. Get these right and the rest follows.", ar: "خمس لحظات. تفسّر 71% من تباين NPS.", tr: "Beş an. NPS varyansının %71'ini açıklar." },
  },
  {
    id: "usability-tester", squad: "design",
    name: { en: "Usability & Testing Lead", ar: "قائد قابلية الاستخدام والاختبار", tr: "Kullanılabilirlik & Test Lideri" },
    role: { en: "Drafts 3 redesign concepts per moment and runs unmoderated remote tests with 12 SME owners — concepts ranked by usability score × NPS lift.", ar: "يصوغ 3 نماذج لكل لحظة ويختبرها مع 12 صاحب أعمال.", tr: "An başına 3 konsept taslar ve 12 KOBİ sahibiyle test eder." },
    inputs: [{ en: "Moments-of-truth briefs + design system", ar: "موجزات لحظات الحقيقة + نظام التصميم", tr: "An brief'leri + tasarım sistemi" }],
    output: { en: "Concept boards (3 per moment) with feasibility scores", ar: "لوحات نماذج (3 لكل لحظة)", tr: "Konsept panoları (an başına 3)" },
    workbench: "concept-board",
    toolCalls: [
      { tool: "ideate.concepts", arg: { en: "3 per moment × 5", ar: "3 × 5", tr: "an başına 3 × 5" }, ms: 2640 },
      { tool: "score.feasibility", arg: { en: "5-axis rubric", ar: "نظام 5 محاور", tr: "5-eksen rubrik" }, ms: 410 },
    ],
    ownedBy: "service-designer",
    checkpoint: { en: "Service Designer + Brand pick the chosen concept per moment", ar: "مصمّم الخدمة والعلامة يختاران النموذج المعتمد", tr: "Hizmet Tasarımcısı + Marka, an başına seçilen konsepti belirler" },
    trace: [
      { en: "Generated 15 concepts (3 per moment).", ar: "توليد 15 نموذجاً.", tr: "15 konsept üretildi." },
      { en: "Scored on feasibility (cost, build-time, regulator-fit, brand-fit, accessibility).", ar: "تسجيل الجدوى على 5 محاور.", tr: "5 eksende fizibilite skoru." },
    ],
    narration: { en: "For every moment, three concepts. We pick the one that's both feasible and on-brand.", ar: "لكل لحظة، ثلاثة نماذج. نختار الأنسب.", tr: "Her an için üç konsept. Hem uygulanabilir hem markaya uygun olanı seçeriz." },
  },
  // ── Operations & Channels ─────────────────────────────────────────
  {
    id: "channel-orchestrator", squad: "operations",
    name: { en: "Channel Orchestrator", ar: "منسّق القنوات", tr: "Kanal Orkestratörü" },
    role: { en: "Decides which channel owns each moment — branch, app, call centre, WhatsApp, RM.", ar: "يقرر القناة لكل لحظة.", tr: "Her anın kanalına karar verir." },
    inputs: [{ en: "Moments + cost & capability data", ar: "اللحظات + التكلفة والقدرة", tr: "Anlar + maliyet/yeterlilik" }],
    output: { en: "Channel allocation matrix per moment", ar: "مصفوفة تخصيص القنوات", tr: "Kanal tahsis matrisi" },
    workbench: "channel-matrix",
    toolCalls: [
      { tool: "score.channels", arg: { en: "moment × channel", ar: "لحظة × قناة", tr: "an × kanal" }, ms: 940 },
    ],
    ownedBy: "ops-lead",
    checkpoint: { en: "Head of Channels signs allocation", ar: "رئيس القنوات يوقّع التخصيص", tr: "Kanal Başkanı tahsisi imzalar" },
    trace: [
      { en: "Scored each (moment × channel) on cost, NPS lift, capacity.", ar: "تسجيل كل زوج بالتكلفة والتحسّن والسعة.", tr: "Maliyet, NPS, kapasite skoru." },
      { en: "Selected channel-of-record per moment with secondary fallback.", ar: "اختيار قناة سجل + بديل ثانوي.", tr: "Ana kanal + ikincil yedek." },
    ],
    narration: { en: "Each moment gets a channel-of-record and a secondary fallback. No more \"app says branch, branch says app\".", ar: "لكل لحظة قناة سجل وبديل ثانوي.", tr: "Her ana ana kanal ve ikincil yedek. Artık \"uygulama şubeyi, şube uygulamayı\" yok." },
  },
  {
    id: "touchpoint-designer", squad: "operations",
    name: { en: "Touchpoint Designer", ar: "مصمّم نقاط التواصل", tr: "Temas Noktası Tasarımcısı" },
    role: { en: "Designs every customer touchpoint that lands the redesign — the 4-branch / 6-week launch matrix with treatment and holdout arms, success criteria, and stop-conditions.", ar: "يصمّم نقاط التواصل التي تنفّذ إعادة التصميم.", tr: "Yeniden tasarımı taşıyan her müşteri temas noktasını tasarlar." },
    inputs: [{ en: "Channel matrix + branch capacity + pilot statistics", ar: "مصفوفة القنوات + سعة الفروع + إحصاءات", tr: "Kanal matrisi + şube kapasitesi + istatistik" }],
    output: { en: "Pilot plan with arms, holdout, success criteria", ar: "خطة تجربة مع المجموعات والمعايير", tr: "Kollar, kontrol, kriter içeren pilot planı" },
    workbench: "pilot-plan",
    toolCalls: [
      { tool: "power.calc", arg: { en: "MDE 4 NPS pts, α 0.05", ar: "MDE 4 نقاط، α 0.05", tr: "MDE 4 puan, α 0,05" }, ms: 280 },
      { tool: "select.branches", arg: { en: "stratified by region", ar: "مقسّم حسب المنطقة", tr: "bölgeye göre" }, ms: 410 },
    ],
    ownedBy: "ops-lead",
    checkpoint: { en: "Operations Lead approves pilot scope + stop conditions", ar: "قائد العمليات يعتمد نطاق التجربة وشروط الإيقاف", tr: "Operasyon Lideri pilot kapsamı + durdurma koşullarını onaylar" },
    trace: [
      { en: "Power-analysis: 4 branches × 6 weeks for MDE = 4 NPS points at α 0.05.", ar: "تحليل القوة: 4 فروع × 6 أسابيع لـ MDE = 4 نقاط.", tr: "Güç analizi: 4 şube × 6 hafta, MDE = 4 puan." },
      { en: "Selected DXB-Marina, AUH-Corniche, RUH-Olaya, IST-Levent (region-stratified).", ar: "اختيار 4 فروع.", tr: "4 şube seçildi." },
      { en: "Stop-condition: NPS regression > 3 pts vs holdout in any week.", ar: "شرط الإيقاف: تراجع NPS > 3 نقاط أسبوعياً.", tr: "Durdurma: NPS > 3 puan gerileme." },
    ],
    narration: { en: "Don't deploy 220 branches. Pilot 4 of them with a holdout, then expand only if the lift survives the data.", ar: "لا تنشر في 220 فرعاً. جرّب 4 مع مقارنة.", tr: "220 şubeye dağıtma. 4'ünü kontrol grubuyla pilotla." },
  },
  {
    id: "staff-experience", squad: "operations",
    name: { en: "Staff Experience Lead", ar: "قائد تجربة الموظف", tr: "Personel Deneyimi Lideri" },
    role: { en: "Owns the staff side of the experience — drafts coaching nudges for branch staff and call-centre agents, tracks adoption and frontline sentiment by branch.", ar: "يملك جانب الموظف من التجربة — توجيهات وتتبّع التبنّي.", tr: "Deneyimin personel tarafını sahiplenir — koçluk ve benimseme izleme." },
    inputs: [{ en: "Pilot QA scores + adoption telemetry + house style", ar: "نتائج جودة التجربة + قياسات التبنّي + الأسلوب", tr: "Pilot KS + benimseme + ev stili" }],
    output: { en: "Coaching nudges + branch adoption telemetry", ar: "توجيهات + قياسات تبنّي الفروع", tr: "Koçluk dürtmeleri + benimseme telemetrisi" },
    workbench: "coach-board",
    toolCalls: [
      { tool: "diagnose.adoption", arg: { en: "branch × KPI", ar: "فرع × KPI", tr: "şube × KPI" }, ms: 620 },
      { tool: "draft.nudges", arg: { en: "14 nudges", ar: "14 توجيهاً", tr: "14 dürtme" }, ms: 410 },
    ],
    ownedBy: "ops-lead",
    checkpoint: { en: "L&D head signs the coaching cadence", ar: "رئيس التعلّم يوقّع الوتيرة", tr: "L&D başkanı kadansı imzalar" },
    trace: [
      { en: "Branch adoption: 71% (target 85%). Drafted 14 nudges to 3 trailing branches.", ar: "تبنّي الفروع: 71% (الهدف 85%).", tr: "Benimseme: %71 (hedef %85)." },
      { en: "Predicted adoption at 90 days: 88% (band 82..92).", ar: "التوقّع بعد 90 يوماً: 88%.", tr: "90 gün tahmini: %88." },
    ],
    narration: { en: "The redesign is only as good as the branch that runs it. Coaching nudges go to the three trailing branches.", ar: "إعادة التصميم بقدر الفرع الذي يشغّلها.", tr: "Yeniden tasarım onu çalıştıran şube kadar iyidir." },
  },
  // ── Outcomes & Value ──────────────────────────────────────────────
  {
    id: "kpi-tree-compiler", squad: "outcomes",
    name: { en: "KPI Tree Compiler", ar: "مُجمّع شجرة المؤشرات", tr: "KPI Ağaç Derleyicisi" },
    role: { en: "Compiles a KPI tree from north-star NPS down to per-moment leading indicators.", ar: "يجمّع شجرة من NPS إلى المؤشرات القيادية.", tr: "Kuzey-yıldızı NPS'ten öncü göstergelere ağaç derler." },
    inputs: [{ en: "Moments + KPI library", ar: "اللحظات + مكتبة المؤشرات", tr: "Anlar + KPI kütüphanesi" }],
    output: { en: "KPI tree with current vs target deltas", ar: "شجرة مؤشرات مع الفروقات", tr: "Mevcut vs hedef deltalı KPI ağacı" },
    workbench: "kpi-tree",
    toolCalls: [
      { tool: "compile.tree", arg: { en: "NPS → 4 → 11 → 17", ar: "NPS → 4 → 11 → 17", tr: "NPS → 4 → 11 → 17" }, ms: 740 },
    ],
    ownedBy: "exec-sponsor",
    checkpoint: { en: "CFO confirms target deltas are board-defensible", ar: "المدير المالي يؤكد قابلية الدفاع", tr: "CFO hedef deltaları onaylar" },
    trace: [
      { en: "Linked NPS → 4 driver KPIs → 11 leading indicators → 17 agent actions.", ar: "ربط NPS → 4 → 11 → 17.", tr: "NPS → 4 → 11 → 17 bağlandı." },
      { en: "Set target deltas using the CSAT forecaster's bands.", ar: "تحديد الفروقات بنطاقات المتنبّئ.", tr: "Hedefler tahminci bantlarıyla." },
    ],
    narration: { en: "Every agent action terminates in a measurable leading indicator. Nothing floats.", ar: "كل إجراء وكيل ينتهي بمؤشر قابل للقياس.", tr: "Her ajan eylemi ölçülebilir bir göstergede son bulur." },
  },
  {
    id: "cx-strategist", squad: "outcomes",
    name: { en: "CX Strategist", ar: "خبير استراتيجية تجربة العميل", tr: "CX Stratejisti" },
    role: { en: "Owns the strategic CX narrative — links cost-to-serve, NPS forecast and KPI tree into the board-level case for the redesign.", ar: "يملك السرد الاستراتيجي لتجربة العميل — يربط التكلفة و NPS وشجرة المؤشرات.", tr: "Stratejik CX anlatısını sahiplenir — maliyet, NPS tahmini ve KPI ağacını birleştirir." },
    inputs: [{ en: "Channel matrix + unit cost data", ar: "مصفوفة + بيانات تكلفة", tr: "Kanal matrisi + birim maliyet" }],
    output: { en: "Cost-to-serve waterfall + scenario deltas", ar: "شلال تكلفة الخدمة", tr: "Hizmet maliyeti şelalesi" },
    workbench: "cost-waterfall",
    toolCalls: [
      { tool: "model.waterfall", arg: { en: "5 levers", ar: "5 رافعات", tr: "5 kaldıraç" }, ms: 510 },
    ],
    ownedBy: "exec-sponsor",
    checkpoint: { en: "CFO signs the waterfall", ar: "المدير المالي يوقّع الشلال", tr: "CFO şelaleyi imzalar" },
    trace: [
      { en: "Baseline cx-strategist per onboarded SME: AED 1,820.", ar: "التكلفة الحالية: 1,820 درهم.", tr: "Baseline: 1.820 AED." },
      { en: "After redesign: AED 1,140 (−37%).", ar: "بعد إعادة التصميم: 1,140 (−37%).", tr: "Yeniden tasarım: 1.140 (−%37)." },
    ],
    narration: { en: "Cost-to-serve drops from 1,820 to 1,140 per onboarded SME. That's the funding for the change plan.", ar: "تكلفة الخدمة تنخفض من 1,820 إلى 1,140.", tr: "Hizmet maliyeti 1.820'den 1.140'a düşer." },
  },
  {
    id: "csat-forecaster", squad: "outcomes",
    name: { en: "NPS / CSAT Forecaster", ar: "متنبّئ رضا العملاء", tr: "NPS / CSAT Tahmincisi" },
    role: { en: "Forecasts NPS and CSAT shift if proposed designs land — sensitivity-tested.", ar: "يتنبّأ بتغيّر NPS و CSAT.", tr: "NPS / CSAT değişimini tahmin eder." },
    inputs: [{ en: "Moments + interventions + historical lift coefficients", ar: "اللحظات + التدخّلات + المعاملات", tr: "Anlar + müdahaleler + katsayılar" }],
    output: { en: "NPS / CSAT forecast + sensitivity bands", ar: "توقّع + نطاقات الحساسية", tr: "Tahmin + duyarlılık bantları" },
    workbench: "csat-forecast",
    toolCalls: [
      { tool: "forecast.npsLift", arg: { en: "MCMC, 10k samples", ar: "MCMC، 10 آلاف", tr: "MCMC, 10k örnek" }, ms: 1840 },
    ],
    ownedBy: "cx-director",
    checkpoint: { en: "Insight lead validates lift coefficients", ar: "قائد الاستبصار يتحقّق من المعاملات", tr: "İçgörü lideri katsayıları doğrular" },
    trace: [
      { en: "Current NPS: +18. Forecast at 6 months: +34 (band +28..+39).", ar: "NPS الحالي: +18. التوقّع: +34.", tr: "Mevcut: +18. Tahmin: +34." },
      { en: "Sensitivity: 80% of lift driven by Moment 2 (KYC SLA) and Moment 4 (RM intro).", ar: "الحساسية: 80% من اللحظتين 2 و4.", tr: "İyileşmenin %80'i Moment 2 ve 4'ten." },
    ],
    narration: { en: "+18 today, +34 forecast at six months. Eighty percent of the lift comes from KYC SLA and RM intro.", ar: "+18 اليوم، +34 بعد 6 أشهر.", tr: "Bugün +18, 6 ay tahmini +34." },
  },
  // ── Governance & Change ───────────────────────────────────────────
  {
    id: "compliance-sentinel", squad: "governance",
    name: { en: "Compliance Sentinel", ar: "حارس الامتثال", tr: "Uyumluluk Bekçisi" },
    role: { en: "Maps every change to SAMA / CBUAE / CBRT / PDPL clauses and flags conflicts.", ar: "يربط كل تغيير بالبنود التنظيمية.", tr: "Her değişimi regülatör maddelerine eşler." },
    inputs: [{ en: "Change items + regulatory rule library", ar: "عناصر التغيير + المكتبة التنظيمية", tr: "Değişim + regülatör kütüphanesi" }],
    output: { en: "Compliance map + open clause conflicts", ar: "خريطة امتثال + تعارضات", tr: "Uyumluluk haritası + çelişkiler" },
    workbench: "compliance-map",
    toolCalls: [
      { tool: "rule.map", arg: { en: "23 changes × 41 clauses", ar: "23 × 41", tr: "23 × 41" }, ms: 1140 },
    ],
    ownedBy: "exec-sponsor",
    checkpoint: { en: "Compliance Lead signs every clause status", ar: "قائد الامتثال يوقّع حالة كل بند", tr: "Uyumluluk Lideri her madde durumunu imzalar" },
    trace: [
      { en: "Mapped 23 change items to 41 regulatory clauses.", ar: "ربط 23 إلى 41 بنداً.", tr: "23 değişim 41 maddeye eşlendi." },
      { en: "2 conflicts open — both with CBUAE eKYC §3.4.", ar: "تعارضان مفتوحان مع CBUAE eKYC §3.4.", tr: "2 açık çelişki — CBUAE eKYC §3.4." },
    ],
    narration: { en: "Twenty-three changes, forty-one regulatory clauses, two open conflicts — both with CBUAE eKYC §3.4.", ar: "23 تغييراً، 41 بنداً، تعارضان مفتوحان.", tr: "23 değişim, 41 madde, 2 açık çelişki." },
  },
  {
    id: "emotion-sentiment", squad: "governance",
    name: { en: "Emotion & Sentiment Auditor", ar: "مدقّق المشاعر والإحساس", tr: "Duygu & His Denetçisi" },
    role: { en: "Audits every drafted resolution for emotional tone — flags incidents where dialect, gender or sentiment bias would degrade the customer's experience.", ar: "يدقّق كل مسوّدة للنبرة العاطفية — يرفع حوادث التحيّز.", tr: "Her taslağı duygusal ton için denetler — önyargı olaylarını işaretler." },
    inputs: [{ en: "Drafts + routing decisions + protected attributes", ar: "المسوّدات + قرارات التوجيه", tr: "Taslaklar + yönlendirme" }],
    output: { en: "Bias incidents + remediation prompts", ar: "حوادث تحيّز + توجيهات", tr: "Önyargı olayları + düzeltme" },
    workbench: "bias-log",
    toolCalls: [
      { tool: "test.parity", arg: { en: "1,000 draft pairs", ar: "1,000 زوج", tr: "1.000 çift" }, ms: 2940 },
    ],
    ownedBy: "service-designer",
    checkpoint: { en: "AI Ethics committee reviews monthly", ar: "لجنة أخلاقيات الذكاء تراجع شهرياً", tr: "AI Etik komitesi aylık inceler" },
    trace: [
      { en: "Tested 1,000 draft pairs (EN vs AR) — tone gap within 0.04 (acceptable).", ar: "اختبار 1,000 زوج — الفجوة 0.04.", tr: "1.000 çift — fark 0,04." },
      { en: "Detected 3 routing-priority gaps by SME size.", ar: "اكتشاف 3 فجوات.", tr: "3 fark tespit edildi." },
    ],
    narration: { en: "Bias never sleeps. We test 1,000 EN/AR draft pairs every week, and we open tickets for the routing skews.", ar: "التحيّز لا ينام. نختبر 1,000 زوج أسبوعياً.", tr: "Önyargı uyumaz. Her hafta 1.000 çift test ederiz." },
  },
  {
    id: "change-manager", squad: "governance",
    name: { en: "Change Manager", ar: "مدير التغيير", tr: "Değişim Yöneticisi" },
    role: { en: "Drafts the 90/180/365-day change plan tied to journey, KPI tree, pilot, and squads.", ar: "يصوغ خطة التغيير 90/180/365 يوماً.", tr: "90/180/365 günlük değişim planını taslar." },
    inputs: [{ en: "Blueprint + KPI tree + compliance map + cost waterfall + pilot results", ar: "المخطط + الشجرة + الامتثال + التكلفة + التجربة", tr: "Blueprint + KPI + uyumluluk + maliyet + pilot" }],
    output: { en: "Phased change plan with owners + dates", ar: "خطة تغيير مرحلية", tr: "Sahipli kademeli plan" },
    workbench: "change-plan",
    toolCalls: [
      { tool: "compile.gantt", arg: { en: "12 workstreams × 365d", ar: "12 مساراً × 365 يوماً", tr: "12 iş kolu × 365g" }, ms: 1340 },
    ],
    ownedBy: "cx-director",
    checkpoint: { en: "Steering committee approves the plan", ar: "اللجنة التوجيهية تعتمد الخطة", tr: "Yönlendirme komitesi onaylar" },
    trace: [
      { en: "12 workstreams across 90/180/365-day horizons, 23 named owners.", ar: "12 مسار عمل، 23 مسؤول.", tr: "12 iş kolu, 23 sahip." },
      { en: "Critical path: KYC API rebuild (T+45) → blueprint v2 (T+90).", ar: "المسار الحرج: KYC API → المخطط v2.", tr: "Kritik yol: KYC API → blueprint v2." },
    ],
    narration: { en: "Twelve workstreams, twenty-three named owners, one critical path. The plan is the contract.", ar: "12 مسار عمل، 23 مسؤول، مسار حرج واحد.", tr: "12 iş kolu, 23 sahip, tek kritik yol." },
  },
];

// ─── Workbench artefact data ────────────────────────────────────────────

export const VOC_THEMES: Array<{ rank: number; theme: T; volume: number; npsImpact: number; quote: T }> = [
  { rank: 1, theme: { en: "KYC document loop", ar: "حلقة مستندات KYC", tr: "KYC belge döngüsü" }, volume: 318, npsImpact: -19, quote: { en: "I sent the same papers four times.", ar: "أرسلت نفس الأوراق أربع مرات.", tr: "Aynı belgeleri dört kez gönderdim." } },
  { rank: 2, theme: { en: "RM never followed up", ar: "مدير العلاقة لم يتواصل", tr: "RM hiç dönmedi" }, volume: 241, npsImpact: -14, quote: { en: "Two weeks, no call from anyone.", ar: "أسبوعان دون أي اتصال.", tr: "İki hafta, kimseden çağrı yok." } },
  { rank: 3, theme: { en: "Branch ↔ app handoff broken", ar: "تحويل الفرع ↔ التطبيق مكسور", tr: "Şube ↔ uygulama devri kopuk" }, volume: 187, npsImpact: -11, quote: { en: "Branch said use the app, app said go to branch.", ar: "الفرع قال استخدم التطبيق.", tr: "Şube uygulamayı dedi." } },
  { rank: 4, theme: { en: "Arabic forms machine-translated", ar: "نماذج عربية بترجمة آلية", tr: "Arapça formlar makine çevirisi" }, volume: 143, npsImpact: -8, quote: { en: "The Arabic version reads like a robot.", ar: "النسخة العربية تبدو روبوتاً.", tr: "Arapça versiyon robot gibi." } },
  { rank: 5, theme: { en: "First transaction limits unclear", ar: "حدود أول معاملة غير واضحة", tr: "İlk işlem limitleri belirsiz" }, volume: 121, npsImpact: -6, quote: { en: "I was rejected without warning.", ar: "تم رفضي دون إنذار.", tr: "Uyarı olmadan reddedildim." } },
  { rank: 6, theme: { en: "Status pings disappear after upload", ar: "إشعارات الحالة تختفي", tr: "Durum bildirimleri kayboluyor" }, volume: 98, npsImpact: -5, quote: { en: "Uploaded at 09:00, no update for 3 days.", ar: "رفعت في 9 صباحاً، لا تحديث لـ3 أيام.", tr: "09:00'da yükledim, 3 gün haber yok." } },
  { rank: 7, theme: { en: "Conflicting answers across channels", ar: "إجابات متناقضة بين القنوات", tr: "Kanallar arası çelişen cevaplar" }, volume: 76, npsImpact: -4, quote: { en: "Three people, three different rules.", ar: "ثلاثة أشخاص، ثلاث قواعد.", tr: "Üç kişi, üç farklı kural." } },
];

// ~120 VoC verbatim snippets — surfaced in the Insight workbench as
// scrollable evidence behind the ranked themes.
function genSnippets(): Array<{ id: string; theme: number; quote: T; nps: number }> {
  const tmpls: Array<{ theme: number; nps: number; en: string; ar: string; tr: string }> = [
    { theme: 1, nps: -8, en: "Asked me for the trade licence for the third time.", ar: "طلب مني الرخصة التجارية للمرة الثالثة.", tr: "Ticaret lisansını üçüncü kez istediler." },
    { theme: 1, nps: -9, en: "I uploaded the CR — system says missing.", ar: "رفعت السجل — يقول النظام مفقود.", tr: "CR yükledim — sistem yok diyor." },
    { theme: 1, nps: -7, en: "Documents looped back four times.", ar: "الوثائق دارت أربع مرات.", tr: "Belgeler dört kez döndü." },
    { theme: 1, nps: -10, en: "Same KYC questions every Monday.", ar: "نفس أسئلة KYC كل اثنين.", tr: "Her pazartesi aynı KYC soruları." },
    { theme: 2, nps: -9, en: "RM was changed without notice.", ar: "تغيّر مدير العلاقة دون إخطار.", tr: "RM habersiz değişti." },
    { theme: 2, nps: -8, en: "Three weeks, no callback.", ar: "ثلاثة أسابيع دون اتصال.", tr: "Üç hafta, geri arama yok." },
    { theme: 2, nps: -10, en: "Generic email, no name.", ar: "بريد عام دون اسم.", tr: "Genel e-posta, isim yok." },
    { theme: 3, nps: -7, en: "Branch refused, said use the app.", ar: "الفرع رفض وطلب استخدام التطبيق.", tr: "Şube reddetti, uygulama dedi." },
    { theme: 3, nps: -8, en: "App froze at face-scan.", ar: "تطبيق توقّف عند مسح الوجه.", tr: "Uygulama yüz taramada dondu." },
    { theme: 4, nps: -5, en: "The Arabic copy is unreadable.", ar: "النص العربي غير قابل للقراءة.", tr: "Arapça metin okunmaz." },
    { theme: 4, nps: -4, en: "Buttons mistranslated as verbs.", ar: "الأزرار مترجمة كأفعال.", tr: "Butonlar fiil olarak çevrilmiş." },
    { theme: 5, nps: -5, en: "Card declined on first salary run.", ar: "البطاقة رُفضت في أول دفعة راتب.", tr: "İlk maaşta kart reddedildi." },
    { theme: 5, nps: -6, en: "No warning the limit was 5k.", ar: "لا إنذار أن الحد 5 آلاف.", tr: "Limit 5 bin olduğuna dair uyarı yok." },
    { theme: 6, nps: -4, en: "Uploaded but never got SMS.", ar: "رفعت ولم أتلقَّ SMS.", tr: "Yükledim ama SMS gelmedi." },
    { theme: 7, nps: -3, en: "Branch and call-centre give different rules.", ar: "الفرع والمركز يعطيان قواعد مختلفة.", tr: "Şube ve çağrı merkezi farklı kurallar verir." },
  ];
  // Multiply to ~120 by tagging numbered IDs.
  const out: Array<{ id: string; theme: number; quote: T; nps: number }> = [];
  for (let i = 0; i < 8; i++) {
    tmpls.forEach((s, k) => {
      out.push({
        id: `v${i * tmpls.length + k + 1}`,
        theme: s.theme,
        nps: s.nps,
        quote: { en: s.en, ar: s.ar, tr: s.tr },
      });
    });
  }
  return out.slice(0, 120);
}
export const VOC_SNIPPETS = genSnippets();

export const ETHNO_NOTES: Array<{ id: string; observation: T; behaviour: T; severity: "low" | "med" | "high" }> = [
  { id: "ETH-01", observation: { en: "Customer pinches phone screen 4× trying to enlarge KYC checklist.", ar: "العميل يكبّر الشاشة 4 مرات لقراءة قائمة KYC.", tr: "Müşteri KYC listesini büyütmek için ekrana 4 kez basıyor." }, behaviour: { en: "Visual-density overload", ar: "اكتظاظ بصري", tr: "Görsel yoğunluk fazlası" }, severity: "high" },
  { id: "ETH-02", observation: { en: "Customer steps outside branch to call helpline mid-application.", ar: "العميل يخرج للاتصال بالخط الساخن أثناء التقديم.", tr: "Müşteri başvuru sırasında destek hattını aramak için dışarı çıkıyor." }, behaviour: { en: "Trust gap with branch staff", ar: "فجوة ثقة مع موظف الفرع", tr: "Şube personeline güven boşluğu" }, severity: "high" },
  { id: "ETH-03", observation: { en: "Customer takes photo of upload screen \"in case it's lost\".", ar: "العميل يلتقط صورة لشاشة الرفع \"احتياطاً\".", tr: "Müşteri yükleme ekranının fotoğrafını çekiyor \"kaybolursa diye\"." }, behaviour: { en: "Compensating for status opacity", ar: "تعويض عن غموض الحالة", tr: "Durum belirsizliğini telafi" }, severity: "med" },
  { id: "ETH-04", observation: { en: "Two customers in waiting area swap WhatsApp tips on \"the right photo angle\".", ar: "عميلان في الانتظار يتبادلان نصائح حول زاوية التصوير.", tr: "Bekleme alanında iki müşteri \"doğru fotoğraf açısı\" hakkında ipucu paylaşıyor." }, behaviour: { en: "Customers compensating for design failure", ar: "العملاء يعوّضون عن فشل التصميم", tr: "Tasarım başarısızlığını telafi" }, severity: "med" },
  { id: "ETH-05", observation: { en: "Customer asks RM \"are you actually mine?\" after introduction.", ar: "العميل يسأل RM \"هل أنت لي فعلاً؟\".", tr: "Müşteri RM'ye \"Gerçekten benim misiniz?\" diye soruyor." }, behaviour: { en: "RM-ownership ambiguity", ar: "غموض ملكية RM", tr: "RM sahiplik belirsizliği" }, severity: "high" },
  { id: "ETH-06", observation: { en: "App user toggles language EN→AR→EN twice per session.", ar: "مستخدم يبدّل اللغة مرتين كل جلسة.", tr: "Kullanıcı oturum başına iki kez dil değiştiriyor." }, behaviour: { en: "Bilingual reading-check pattern", ar: "نمط مراجعة ثنائي اللغة", tr: "İki dilli okuma kontrolü" }, severity: "low" },
];

export const BENCH_GRID = {
  peers: [
    { name: { en: "Falcon", ar: "فالكون", tr: "Falcon" }, scores: [62, 58, 41, 47, 51, 44, 56] },
    { name: { en: "Peer A", ar: "منافس أ", tr: "Rakip A" }, scores: [78, 74, 71, 68, 72, 70, 76] },
    { name: { en: "Peer B", ar: "منافس ب", tr: "Rakip B" }, scores: [69, 66, 63, 60, 64, 61, 67] },
    { name: { en: "Peer C", ar: "منافس ج", tr: "Rakip C" }, scores: [82, 79, 78, 74, 77, 75, 80] },
    { name: { en: "Peer D", ar: "منافس د", tr: "Rakip D" }, scores: [71, 68, 65, 62, 66, 64, 69] },
    { name: { en: "Peer E", ar: "منافس هـ", tr: "Rakip E" }, scores: [66, 63, 58, 55, 60, 57, 64] },
    { name: { en: "Peer F", ar: "منافس و", tr: "Rakip F" }, scores: [74, 70, 68, 65, 69, 66, 72] },
  ],
  stages: [
    { en: "Discover", ar: "الاستكشاف", tr: "Keşif" },
    { en: "Apply", ar: "التقديم", tr: "Başvuru" },
    { en: "KYC", ar: "التحقّق", tr: "KYC" },
    { en: "Activate", ar: "التفعيل", tr: "Aktivasyon" },
    { en: "First txn", ar: "أول معاملة", tr: "İlk işlem" },
    { en: "RM intro", ar: "تعارف RM", tr: "RM tanışma" },
    { en: "Steady", ar: "الاستقرار", tr: "Kararlı" },
  ] as T[],
};

export const PERSONA_CARDS: Array<{ id: string; name: T; segment: T; jobs: T; pains: T; gains: T }> = [
  {
    id: "khalid",
    name: { en: "Khalid — trading-co founder", ar: "خالد — مؤسّس شركة تجارة", tr: "Khalid — ticaret-co kurucu" },
    segment: { en: "Riyadh, AED 8M revenue", ar: "الرياض، 8 مليون درهم", tr: "Riyad, 8 M AED" },
    jobs: { en: "Open the SME current account in <5 working days.", ar: "فتح الحساب في أقل من 5 أيام.", tr: "Hesabı <5 iş gününde açmak." },
    pains: { en: "Branch ↔ app loops, opaque KYC rejections.", ar: "حلقات الفرع/التطبيق، رفض KYC غامض.", tr: "Döngüler, belirsiz KYC ret." },
    gains: { en: "A single named RM and AR-native UI.", ar: "RM مسمّى واحد وواجهة عربية أصيلة.", tr: "Tek RM ve AR-yerli UI." },
  },
  {
    id: "mariam",
    name: { en: "Mariam — clinic owner", ar: "مريم — مالكة عيادة", tr: "Mariam — klinik sahibi" },
    segment: { en: "Dubai, healthcare SME", ar: "دبي، شركة صحية", tr: "Dubai, sağlık KOBİ" },
    jobs: { en: "Open the account + accept Apple Pay before clinic launch.", ar: "فتح الحساب + قبول Apple Pay.", tr: "Hesap açma + Apple Pay." },
    pains: { en: "Disjointed KYC, no clarity on Apple Pay timing.", ar: "KYC مفكّك، لا وضوح حول Apple Pay.", tr: "Dağınık KYC, Apple Pay belirsizliği." },
    gains: { en: "Single onboarding wizard with merchant services bundled.", ar: "معالج موحّد مع خدمات تجارية.", tr: "Tüccar dahil tek sihirbaz." },
  },
  {
    id: "elif",
    name: { en: "Elif — logistics CEO", ar: "إليف — مديرة لوجستيات", tr: "Elif — lojistik CEO" },
    segment: { en: "Istanbul, mid-market SME", ar: "إسطنبول، شركة متوسطة", tr: "İstanbul, orta-pazar KOBİ" },
    jobs: { en: "Move payroll + supplier payments onto Falcon within 30 days.", ar: "نقل الرواتب والموردين خلال 30 يوماً.", tr: "Bordro + tedarikçi 30 günde Falcon'a." },
    pains: { en: "Limits triggered without warning, RM hand-off opaque.", ar: "تفعيل الحدود دون إنذار.", tr: "Uyarısız limitler." },
    gains: { en: "Pre-set limits aligned to expected volume, RM 360.", ar: "حدود معدّة مسبقاً، RM 360.", tr: "Beklenen hacme uygun ön-limitler." },
  },
];

export const JOURNEY: Array<{ stage: T; channel: T; friction: number; nps: number }> = [
  { stage: { en: "1 · Discover", ar: "1 · الاستكشاف", tr: "1 · Keşif" }, channel: { en: "App / web", ar: "تطبيق / ويب", tr: "Uyg / web" }, friction: 18, nps: 4 },
  { stage: { en: "2 · Apply", ar: "2 · التقديم", tr: "2 · Başvuru" }, channel: { en: "App", ar: "تطبيق", tr: "Uygulama" }, friction: 41, nps: -2 },
  { stage: { en: "3 · KYC", ar: "3 · التحقّق", tr: "3 · KYC" }, channel: { en: "App + branch", ar: "تطبيق + فرع", tr: "Uyg + şube" }, friction: 78, nps: -22 },
  { stage: { en: "4 · Activate", ar: "4 · التفعيل", tr: "4 · Aktivasyon" }, channel: { en: "Call centre", ar: "مركز اتصال", tr: "Çağrı merkezi" }, friction: 52, nps: -9 },
  { stage: { en: "5 · First txn", ar: "5 · أول معاملة", tr: "5 · İlk işlem" }, channel: { en: "App", ar: "تطبيق", tr: "Uygulama" }, friction: 34, nps: -5 },
  { stage: { en: "6 · RM intro", ar: "6 · تعارف RM", tr: "6 · RM tanışma" }, channel: { en: "Phone / branch", ar: "هاتف / فرع", tr: "Telefon / şube" }, friction: 61, nps: -14 },
  { stage: { en: "7 · Steady-state", ar: "7 · الاستقرار", tr: "7 · Kararlı" }, channel: { en: "App + RM", ar: "تطبيق + RM", tr: "Uyg + RM" }, friction: 22, nps: 12 },
];

export const BLUEPRINT: Array<{ stage: T; frontstage: T; backstage: T; system: T }> = [
  { stage: { en: "Apply", ar: "التقديم", tr: "Başvuru" }, frontstage: { en: "App form + bilingual help bot", ar: "نموذج + مساعد ثنائي اللغة", tr: "Form + iki dilli bot" }, backstage: { en: "Loan-officer triage queue", ar: "صفّ فرز الموظف", tr: "Triaj kuyruğu" }, system: { en: "Origination v3 + CRM", ar: "v3 + CRM", tr: "Origination v3 + CRM" } },
  { stage: { en: "KYC", ar: "التحقّق", tr: "KYC" }, frontstage: { en: "Doc upload + status pill", ar: "رفع + شريط الحالة", tr: "Yükleme + durum" }, backstage: { en: "KYC analyst review (4-eyes)", ar: "مراجعة 4 عيون", tr: "4-göz inceleme" }, system: { en: "eKYC + watchlist screening", ar: "eKYC + قوائم المراقبة", tr: "eKYC + izleme listesi" } },
  { stage: { en: "Activate", ar: "التفعيل", tr: "Aktivasyon" }, frontstage: { en: "Welcome call + first-txn coach", ar: "ترحيب + مدرّب", tr: "Hoş geldin + koç" }, backstage: { en: "Limits engine + AML bootstrap", ar: "محرّك الحدود + AML", tr: "Limit motoru + AML" }, system: { en: "Core banking + AML", ar: "النواة + AML", tr: "Çekirdek + AML" } },
  { stage: { en: "RM intro", ar: "تعارف RM", tr: "RM tanışma" }, frontstage: { en: "Named RM card + booking link", ar: "بطاقة + رابط حجز", tr: "Kart + randevu" }, backstage: { en: "RM auto-assign by segment", ar: "تخصيص آلي بالشريحة", tr: "Segmente göre atama" }, system: { en: "RM 360 + calendar", ar: "RM 360 + التقويم", tr: "RM 360 + takvim" } },
];

export const MOMENTS: Array<{ rank: number; name: T; current: T; redesigned: T; lift: number }> = [
  { rank: 1, name: { en: "KYC SLA promise", ar: "وعد SLA لـ KYC", tr: "KYC SLA sözü" }, current: { en: "\"We'll get back to you\"", ar: "\"سنعود إليك\"", tr: "\"Size döneceğiz\"" }, redesigned: { en: "Live SLA pill: \"Decision in 4 hours\"", ar: "شريط حيّ: \"قرار خلال 4 ساعات\"", tr: "Canlı SLA: \"4 saatte karar\"" }, lift: 12 },
  { rank: 2, name: { en: "RM intro", ar: "تعارف RM", tr: "RM tanışma" }, current: { en: "Generic email \"your RM\"", ar: "بريد عام", tr: "Genel e-posta" }, redesigned: { en: "Named RM video intro within 24h", ar: "فيديو RM مسمّى خلال 24س", tr: "İsimli RM video 24s" }, lift: 9 },
  { rank: 3, name: { en: "First-txn coaching", ar: "تدريب أول معاملة", tr: "İlk işlem koçluğu" }, current: { en: "PDF guide", ar: "دليل PDF", tr: "PDF kılavuz" }, redesigned: { en: "In-app guided first transaction", ar: "موجّه داخل التطبيق", tr: "Uyg-içi rehberli işlem" }, lift: 6 },
  { rank: 4, name: { en: "Branch ↔ app continuity", ar: "استمرارية الفرع ↔ التطبيق", tr: "Şube ↔ uyg" }, current: { en: "Loop: branch → app → branch", ar: "حلقة", tr: "Döngü" }, redesigned: { en: "Single state shared across both", ar: "حالة موحّدة", tr: "Tek paylaşılan durum" }, lift: 5 },
  { rank: 5, name: { en: "Arabic-native UX", ar: "تجربة عربية أصيلة", tr: "AR-yerli UX" }, current: { en: "Machine-translated forms", ar: "ترجمة آلية", tr: "Makine çevirisi" }, redesigned: { en: "AR-native copy by Khaleeji editor", ar: "نسخ بمحرّر خليجي", tr: "Körfez editörü" }, lift: 4 },
];

export const CONCEPT_BOARD: Array<{ moment: T; concepts: Array<{ name: T; feasibility: number; lift: number; chosen: boolean }> }> = [
  { moment: { en: "KYC SLA promise", ar: "وعد SLA لـ KYC", tr: "KYC SLA sözü" }, concepts: [
    { name: { en: "Live SLA pill in app", ar: "شريط SLA في التطبيق", tr: "Uyg-içi SLA etiketi" }, feasibility: 88, lift: 12, chosen: true },
    { name: { en: "WhatsApp status broadcast", ar: "بث حالة واتساب", tr: "WhatsApp durum yayını" }, feasibility: 72, lift: 8, chosen: false },
    { name: { en: "Branch tablet status board", ar: "لوحة حالة في الفرع", tr: "Şube tablet panosu" }, feasibility: 54, lift: 5, chosen: false },
  ] },
  { moment: { en: "RM intro", ar: "تعارف RM", tr: "RM tanışma" }, concepts: [
    { name: { en: "Named RM video card", ar: "بطاقة فيديو مسمّاة", tr: "İsimli RM video kartı" }, feasibility: 81, lift: 9, chosen: true },
    { name: { en: "RM voice-note intro", ar: "تعارف صوتي", tr: "Sesli RM tanışma" }, feasibility: 90, lift: 6, chosen: false },
    { name: { en: "RM in-branch handshake", ar: "مصافحة في الفرع", tr: "Şubede el sıkışma" }, feasibility: 38, lift: 7, chosen: false },
  ] },
  { moment: { en: "First-txn coaching", ar: "تدريب أول معاملة", tr: "İlk işlem koçluğu" }, concepts: [
    { name: { en: "In-app guided flow", ar: "تدفق موجّه", tr: "Uyg-içi rehberli akış" }, feasibility: 84, lift: 6, chosen: true },
    { name: { en: "30-second tutorial reel", ar: "فيديو 30 ثانية", tr: "30-saniye tutorial" }, feasibility: 92, lift: 4, chosen: false },
    { name: { en: "Branch onboarding session", ar: "جلسة في الفرع", tr: "Şube oturumu" }, feasibility: 41, lift: 5, chosen: false },
  ] },
];

export const CHANNEL_MATRIX: Array<{ moment: T; channel: T; secondary: T }> = [
  { moment: { en: "KYC SLA promise", ar: "وعد SLA لـ KYC", tr: "KYC SLA sözü" }, channel: { en: "App", ar: "تطبيق", tr: "Uygulama" }, secondary: { en: "WhatsApp push", ar: "إشعار واتساب", tr: "WhatsApp" } },
  { moment: { en: "RM intro", ar: "تعارف RM", tr: "RM tanışma" }, channel: { en: "RM video", ar: "فيديو RM", tr: "RM video" }, secondary: { en: "Phone call back-up", ar: "مكالمة احتياطية", tr: "Telefon yedeği" } },
  { moment: { en: "First-txn coaching", ar: "تدريب أول معاملة", tr: "İlk işlem koçluğu" }, channel: { en: "In-app", ar: "داخل التطبيق", tr: "Uygulama içi" }, secondary: { en: "Call centre", ar: "مركز اتصال", tr: "Çağrı merkezi" } },
  { moment: { en: "Branch continuity", ar: "استمرارية الفرع", tr: "Şube sürekliliği" }, channel: { en: "Branch tablet", ar: "جهاز الفرع", tr: "Şube tablet" }, secondary: { en: "App", ar: "تطبيق", tr: "Uygulama" } },
  { moment: { en: "AR-native UX", ar: "تجربة عربية", tr: "AR-yerli UX" }, channel: { en: "App + email", ar: "تطبيق + بريد", tr: "Uyg + e-posta" }, secondary: { en: "—", ar: "—", tr: "—" } },
];

export const PILOT_PLAN = {
  branches: [
    { name: { en: "DXB-Marina", ar: "دبي مارينا", tr: "DXB-Marina" }, arm: "treatment" as const, region: "UAE" },
    { name: { en: "AUH-Corniche", ar: "أبوظبي الكورنيش", tr: "AUH-Corniche" }, arm: "treatment" as const, region: "UAE" },
    { name: { en: "RUH-Olaya", ar: "الرياض العليا", tr: "RUH-Olaya" }, arm: "treatment" as const, region: "KSA" },
    { name: { en: "IST-Levent", ar: "إسطنبول ليفنت", tr: "IST-Levent" }, arm: "treatment" as const, region: "TR" },
    { name: { en: "DXB-JLT (holdout)", ar: "دبي JLT (مقارنة)", tr: "DXB-JLT (kontrol)" }, arm: "holdout" as const, region: "UAE" },
    { name: { en: "JED-Tahlia (holdout)", ar: "جدة التحلية (مقارنة)", tr: "JED-Tahlia (kontrol)" }, arm: "holdout" as const, region: "KSA" },
  ],
  weeks: 6,
  mde: { en: "MDE 4 NPS pts at α 0.05", ar: "MDE 4 نقاط NPS عند α 0.05", tr: "MDE 4 NPS puan, α 0,05" },
  stop: { en: "Stop if NPS regresses > 3 pts vs holdout in any week.", ar: "إيقاف إذا تراجع NPS > 3 نقاط أسبوعياً.", tr: "Bir haftada NPS > 3 puan gerilerse durdur." },
};

export const KPI_TREE = {
  northStar: { name: { en: "SME NPS (Q4 → Q4+1)", ar: "NPS للشركات الصغيرة", tr: "KOBİ NPS" }, current: 18, target: 40 },
  drivers: [
    { name: { en: "KYC SLA p95 (hours)", ar: "SLA لـ KYC ع95", tr: "KYC SLA p95" }, current: 28, target: 4, dir: "down" as const },
    { name: { en: "RM-intro within 24h (%)", ar: "RM خلال 24س (%)", tr: "24s içinde RM (%)" }, current: 41, target: 92, dir: "up" as const },
    { name: { en: "Branch ↔ app loop / 100", ar: "حلقات / 100", tr: "Döngü / 100" }, current: 14, target: 2, dir: "down" as const },
    { name: { en: "AR-native CSAT", ar: "CSAT عربي", tr: "AR-yerli CSAT" }, current: 71, target: 88, dir: "up" as const },
  ],
};

export const COST_WATERFALL = [
  { label: { en: "Baseline", ar: "الأساس", tr: "Mevcut" }, value: 1820, type: "base" as const },
  { label: { en: "RM hand-off avoided", ar: "تفادي تحويل RM", tr: "RM devri kaldırıldı" }, value: -340, type: "down" as const },
  { label: { en: "KYC re-work avoided", ar: "تفادي إعادة KYC", tr: "KYC tekrarı kaldırıldı" }, value: -260, type: "down" as const },
  { label: { en: "App-native first-txn", ar: "أول معاملة داخل التطبيق", tr: "Uyg-yerli ilk işlem" }, value: -180, type: "down" as const },
  { label: { en: "QA + bias-audit run-cost", ar: "تكلفة الجودة + التحيّز", tr: "KS + önyargı maliyeti" }, value: 100, type: "up" as const },
  { label: { en: "Redesigned", ar: "بعد إعادة التصميم", tr: "Yeniden tasarlanmış" }, value: 1140, type: "base" as const },
];

export const CSAT_FORECAST = [
  { month: "M0", actual: 18 as number | null, low: 18, mid: 18, high: 18 },
  { month: "M1", actual: null, low: 19, mid: 21, high: 23 },
  { month: "M2", actual: null, low: 22, mid: 25, high: 28 },
  { month: "M3", actual: null, low: 25, mid: 29, high: 33 },
  { month: "M4", actual: null, low: 27, mid: 31, high: 35 },
  { month: "M5", actual: null, low: 28, mid: 33, high: 37 },
  { month: "M6", actual: null, low: 28, mid: 34, high: 39 },
];

export const COMPLIANCE_MAP: Array<{ change: T; clause: string; status: "ok" | "open" | "review"; note: T }> = [
  { change: { en: "eKYC live status pill", ar: "شريط eKYC حيّ", tr: "Canlı eKYC etiketi" }, clause: "CBUAE eKYC §3.4", status: "open", note: { en: "Customer-facing SLA must reference circular text verbatim.", ar: "يجب الاستشهاد بنص التعميم حرفياً.", tr: "SLA genelge metnini birebir referans almalı." } },
  { change: { en: "RM video intro", ar: "فيديو RM", tr: "RM video" }, clause: "PDPL §11", status: "ok", note: { en: "Consent banner already present in app.", ar: "إشعار الموافقة موجود.", tr: "Onam afişi mevcut." } },
  { change: { en: "App-native first-txn coach", ar: "مدرّب في التطبيق", tr: "Uyg-yerli ilk işlem koçu" }, clause: "SAMA AML §6.1", status: "review", note: { en: "Confirm prompts do not constitute investment advice.", ar: "تأكيد عدم تشكيل التوجيهات نصيحة استثمارية.", tr: "İstemlerin yatırım tavsiyesi olmadığını doğrula." } },
];

export const BIAS_LOG: Array<{ id: string; type: T; status: "open" | "closed"; note: T }> = [
  { id: "BIAS-031", type: { en: "Routing priority by SME size", ar: "أولوية حسب الحجم", tr: "Boyuta göre öncelik" }, status: "open", note: { en: "Smaller SMEs routed P3 too often.", ar: "الشركات الأصغر توجّه P3 كثيراً.", tr: "Küçük KOBİ'ler çok sık P3." } },
  { id: "BIAS-029", type: { en: "EN/AR tone gap", ar: "فجوة النبرة", tr: "EN/AR ton farkı" }, status: "closed", note: { en: "Within 0.04 (acceptable).", ar: "ضمن 0.04.", tr: "0,04 içinde." } },
];

export const COACH_BOARD = [
  { branch: { en: "DXB-Marina", ar: "دبي مارينا", tr: "DXB-Marina" }, adoption: 84, target: 85 },
  { branch: { en: "AUH-Corniche", ar: "أبوظبي الكورنيش", tr: "AUH-Corniche" }, adoption: 78, target: 85 },
  { branch: { en: "RUH-Olaya", ar: "الرياض العليا", tr: "RUH-Olaya" }, adoption: 62, target: 85 },
  { branch: { en: "IST-Levent", ar: "إسطنبول ليفنت", tr: "IST-Levent" }, adoption: 71, target: 85 },
];

export const CHANGE_PLAN: Array<{ horizon: string; items: Array<{ name: T; owner: T }> }> = [
  {
    horizon: "0–90d",
    items: [
      { name: { en: "Live KYC SLA pill in app", ar: "شريط SLA حيّ", tr: "Canlı KYC SLA" }, owner: { en: "Faisal (Ops)", ar: "فيصل (العمليات)", tr: "Faisal (Ops)" } },
      { name: { en: "Named-RM video intro workflow", ar: "تدفق فيديو RM", tr: "İsimli RM video akışı" }, owner: { en: "RM Tribe", ar: "قبيلة RM", tr: "RM Kabile" } },
      { name: { en: "Bilingual house-style v2", ar: "أسلوب ثنائي اللغة v2", tr: "İki dilli stil v2" }, owner: { en: "Brand", ar: "العلامة", tr: "Marka" } },
    ],
  },
  {
    horizon: "90–180d",
    items: [
      { name: { en: "App-native first-txn coach", ar: "مدرّب أول معاملة", tr: "Uyg-yerli koç" }, owner: { en: "Mobile Tribe", ar: "قبيلة الموبايل", tr: "Mobil Kabile" } },
      { name: { en: "Branch ↔ app shared state", ar: "حالة موحّدة", tr: "Paylaşılan durum" }, owner: { en: "Channel Eng", ar: "هندسة القنوات", tr: "Kanal Müh." } },
    ],
  },
  {
    horizon: "180–365d",
    items: [
      { name: { en: "Pre-set limits engine", ar: "محرّك حدود مسبقة", tr: "Ön-limit motoru" }, owner: { en: "Risk", ar: "المخاطر", tr: "Risk" } },
      { name: { en: "Adoption coaching at scale", ar: "تدريب التبنّي على نطاق", tr: "Ölçekte koçluk" }, owner: { en: "L&D", ar: "التعلّم", tr: "L&D" } },
    ],
  },
];

// ─── Scenario-scoped overlays ──────────────────────────────────────────
// Same 17 agents, scenario-portable artefacts. When the operator switches
// from Falcon Bank SME onboarding to Etisalat enterprise activation, the
// VoC themes, journey stages and hero customer card all re-skin so the
// demo proves portability across industries.

type VocTheme = { rank: number; theme: T; volume: number; npsImpact: number; quote: T };
type JourneyStage = { stage: T; channel: T; friction: number; nps: number };

export const SCENARIO_VOC: Record<ScenarioId, VocTheme[]> = {
  "falcon-sme": VOC_THEMES,
  "etisalat-enterprise": [
    { rank: 1, theme: { en: "SIM provisioning delays", ar: "تأخير تفعيل الشرائح", tr: "SIM tedarik gecikmesi" }, volume: 286, npsImpact: -21, quote: { en: "Ordered 240 lines, 9 days for activation.", ar: "طلبت 240 خطاً، 9 أيام للتفعيل.", tr: "240 hat sipariş, 9 gün aktivasyon." } },
    { rank: 2, theme: { en: "Contract signature loops", ar: "حلقات توقيع العقد", tr: "Sözleşme imza döngüsü" }, volume: 224, npsImpact: -16, quote: { en: "Three legal redlines, no version control.", ar: "ثلاث مراجعات قانونية بدون تحكّم.", tr: "Üç hukuki revizyon, sürüm kontrolü yok." } },
    { rank: 3, theme: { en: "Account manager opacity", ar: "غموض مدير الحساب", tr: "Hesap yöneticisi belirsizliği" }, volume: 198, npsImpact: -13, quote: { en: "I emailed three names, none replied.", ar: "راسلت ثلاثة أسماء، لم يردّ أحد.", tr: "Üç isme yazdım, kimse dönmedi." } },
    { rank: 4, theme: { en: "Portal vs invoice mismatch", ar: "تباين بوابة الفواتير", tr: "Portal-fatura uyumsuzluğu" }, volume: 154, npsImpact: -9, quote: { en: "Portal says 240 active, invoice charges 268.", ar: "البوابة 240، الفاتورة 268.", tr: "Portal 240, fatura 268." } },
    { rank: 5, theme: { en: "5G roaming setup unclear", ar: "إعداد تجوال 5G غير واضح", tr: "5G roaming ayarı belirsiz" }, volume: 132, npsImpact: -7, quote: { en: "Took an SLA escalation to enable roaming.", ar: "تطلّب تصعيد SLA.", tr: "SLA eskalasyonu gerekti." } },
    { rank: 6, theme: { en: "Helpdesk ticket black-hole", ar: "ثقب أسود لتذاكر الدعم", tr: "Destek bileti karadeliği" }, volume: 109, npsImpact: -6, quote: { en: "Ticket open 11 days, no owner.", ar: "تذكرة 11 يوماً بلا مالك.", tr: "11 gündür sahipsiz." } },
    { rank: 7, theme: { en: "Onboarding KPIs not shared", ar: "مؤشرات الإعداد غير مشتركة", tr: "Onboarding KPI paylaşımı yok" }, volume: 81, npsImpact: -4, quote: { en: "We never saw the SLA dashboard.", ar: "لم نرَ لوحة SLA.", tr: "SLA panosunu hiç görmedik." } },
  ],
};

export const SCENARIO_JOURNEY: Record<ScenarioId, JourneyStage[]> = {
  "falcon-sme": JOURNEY,
  "etisalat-enterprise": [
    { stage: { en: "1 · RFP intake", ar: "1 · طلب العرض", tr: "1 · RFP" }, channel: { en: "Sales / portal", ar: "مبيعات / بوابة", tr: "Satış / portal" }, friction: 24, nps: 2 },
    { stage: { en: "2 · Solutioning", ar: "2 · صياغة الحلّ", tr: "2 · Çözümleme" }, channel: { en: "Pre-sales", ar: "ما قبل البيع", tr: "Satış öncesi" }, friction: 38, nps: -3 },
    { stage: { en: "3 · Contracting", ar: "3 · التعاقد", tr: "3 · Sözleşme" }, channel: { en: "Legal + portal", ar: "قانوني + بوابة", tr: "Hukuk + portal" }, friction: 71, nps: -18 },
    { stage: { en: "4 · Provisioning", ar: "4 · التوفير", tr: "4 · Provisioning" }, channel: { en: "Ops portal", ar: "بوابة العمليات", tr: "Operasyon portalı" }, friction: 82, nps: -24 },
    { stage: { en: "5 · Activation", ar: "5 · التفعيل", tr: "5 · Aktivasyon" }, channel: { en: "Field tech + portal", ar: "ميداني + بوابة", tr: "Saha + portal" }, friction: 56, nps: -11 },
    { stage: { en: "6 · AM intro", ar: "6 · تعارف AM", tr: "6 · AM tanışma" }, channel: { en: "Phone / on-site", ar: "هاتف / موقع", tr: "Telefon / saha" }, friction: 48, nps: -8 },
    { stage: { en: "7 · Steady-state", ar: "7 · الاستقرار", tr: "7 · Kararlı" }, channel: { en: "Portal + AM", ar: "بوابة + AM", tr: "Portal + AM" }, friction: 26, nps: 9 },
  ],
};
