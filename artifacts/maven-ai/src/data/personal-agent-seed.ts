/**
 * Cognirise Personal Agent — seed data for the Cockpit and Mind demos.
 *
 * Two personas: Sales (Mariam · Atlas) and HR (Yusuf · Ember).
 * Everything is illustrative sample data — no real PII, no real CRM/ATS hits.
 *
 * Co-located with the demo components so the seed is auditable against
 * concept.md (see section 19, Demo-mapping appendix).
 */

import type { Lang } from "@/lib/lang";

export type PCGCategory =
  | "role"
  | "skill"
  | "relationship"
  | "preference"
  | "personal"
  | "project"
  | "tool"
  | "domain"
  | "communication";

export type PCGScope = "work" | "personal";

export type PCGMilestone = "day1" | "week1" | "month1" | "month6" | "year1";

export const MILESTONES: PCGMilestone[] = ["day1", "week1", "month1", "month6", "year1"];

export const MILESTONE_LABEL: Record<PCGMilestone, { en: string; ar: string; tr?: string }> = {
  day1: { en: "Day 1", ar: "اليوم 1", tr: "Gün 1" },
  week1: { en: "Week 1", ar: "الأسبوع 1", tr: "Hafta 1" },
  month1: { en: "Month 1", ar: "الشهر 1", tr: "Ay 1" },
  month6: { en: "Month 6", ar: "الشهر 6", tr: "Ay 6" },
  year1: { en: "Year 1", ar: "السنة 1", tr: "Yıl 1" },
};

export const CATEGORY_META: Record<
  PCGCategory,
  { label: { en: string; ar: string; tr?: string }; color: string }
> = {
  role: { label: { en: "Role", ar: "الدور", tr: "Rol" }, color: "#a78bfa" },
  skill: { label: { en: "Skill", ar: "المهارة", tr: "Beceri" }, color: "#60a5fa" },
  relationship: { label: { en: "Relationship", ar: "العلاقة", tr: "İlişki" }, color: "#34d399" },
  preference: { label: { en: "Preference", ar: "التفضيل", tr: "Tercih" }, color: "#fbbf24" },
  personal: { label: { en: "Personal", ar: "شخصي", tr: "Kişisel" }, color: "#f472b6" },
  project: { label: { en: "Project", ar: "المشروع", tr: "Proje" }, color: "#fb7185" },
  tool: { label: { en: "Tool", ar: "الأداة", tr: "Araç" }, color: "#94a3b8" },
  domain: { label: { en: "Domain", ar: "المجال", tr: "Alan" }, color: "#c084fc" },
  communication: { label: { en: "Communication", ar: "التواصل", tr: "İletişim" }, color: "#22d3ee" },
};

export interface PCGNode {
  id: string;
  category: PCGCategory;
  label: { en: string; ar: string; tr?: string };
  description: { en: string; ar: string; tr?: string };
  scope: PCGScope;
  source: { en: string; ar: string; tr?: string };
  learnedAt: PCGMilestone;
  confidence: number;
  useCount: number;
  decayState: "fresh" | "recent" | "stale";
  recentUses?: { en: string; ar: string; tr?: string }[];
}

export interface PCGEdge {
  from: string;
  to: string;
  kind: "knows" | "works_on" | "prefers" | "reports_to" | "owns" | "uses" | "remembers" | "attended" | "inferred_from";
  strength: number;
  learnedAt: PCGMilestone;
}

export interface ReceiptCitation {
  nodeId: string;
}

export interface PendingCard {
  id: string;
  title: { en: string; ar: string; tr?: string };
  preview: { en: string; ar: string; tr?: string };
  body: { en: string; ar: string; tr?: string };
  source: { en: string; ar: string; tr?: string };
  autonomyLevel: "L1" | "L2" | "L3";
  citedNodeIds: string[];
  estTimeSavedMin: number;
  kind: "email" | "offer-letter" | "booking" | "gift" | "faq" | "brief";
}

export interface LearningItem {
  id: string;
  text: { en: string; ar: string; tr?: string };
  source: { en: string; ar: string; tr?: string };
  citedNodeIds: string[];
  agoMinutes: number;
}

export interface InProgressItem {
  id: string;
  title: { en: string; ar: string; tr?: string };
  steps: { en: string; ar: string; tr?: string }[];
  currentStep: number;
}

export interface NudgeItem {
  id: string;
  title: { en: string; ar: string; tr?: string };
  body: { en: string; ar: string; tr?: string };
  citedNodeIds: string[];
  scope: PCGScope;
}

export interface ProactiveTrigger {
  message: { en: string; ar: string; tr?: string };
  citedNodeIds: string[];
  followupDraft: { en: string; ar: string; tr?: string };
}

export interface CockpitSeed {
  learnings: LearningItem[];
  pending: PendingCard[];
  inProgress: InProgressItem[];
  nudge: NudgeItem;
  /** A single magic moment the chat fires after the first approve. */
  proactive: ProactiveTrigger;
}

export interface LiveWorkdayEvent {
  /** Wall-clock label shown in the Mind event stream. */
  at: string;
  /** Human-readable explanation. */
  text: { en: string; ar: string; tr?: string };
  /** Node ids touched (added or used). */
  touchedNodeIds: string[];
  /** New nodes spawned at this tick (id → category for inline render). */
  spawnNodes?: Pick<PCGNode, "id" | "category" | "label" | "scope" | "confidence">[];
}

export interface Persona {
  id: "sales" | "hr";
  agentName: string;
  personName: { en: string; ar: string; tr?: string };
  role: { en: string; ar: string; tr?: string };
  company: { en: string; ar: string; tr?: string };
  accent: string;
  copresence: { en: string; ar: string; tr?: string };
  starterPrompts: { en: string; ar: string; tr?: string }[];
  pcg: { nodes: PCGNode[]; edges: PCGEdge[] };
  cockpit: CockpitSeed;
  liveWorkday: LiveWorkdayEvent[];
  systemPromptIntro: string;
  exportPayload: object;
}

// ─── Helper ──────────────────────────────────────────────────────────────
function n(
  id: string,
  category: PCGCategory,
  scope: PCGScope,
  label: { en: string; ar: string; tr?: string },
  description: { en: string; ar: string; tr?: string },
  source: { en: string; ar: string; tr?: string },
  learnedAt: PCGMilestone,
  confidence: number,
  useCount: number,
  recentUses?: { en: string; ar: string; tr?: string }[],
): PCGNode {
  const decayState =
    confidence >= 0.8 ? "fresh" : confidence >= 0.55 ? "recent" : "stale";
  return { id, category, scope, label, description, source, learnedAt, confidence, useCount, decayState, recentUses };
}

// =================================================================
// PERSONA A — SALES — Mariam Al-Hashimi · Atlas
// =================================================================
const SALES_NODES: PCGNode[] = [
  // Role + Tools — Day 1 (cold-start)
  n("s.role", "role", "work", { en: "Senior Account Executive", ar: "مدير حسابات أول", tr: "Kıdemli Müşteri Yöneticisi" }, { en: "Northwind Cloud — MENA enterprise B2B SaaS book of 24 accounts.", ar: "نورثويند كلاود — كتاب 24 حساباً مؤسسياً في منطقة الشرق الأوسط وشمال إفريقيا.", tr: "Northwind Cloud — MENA bölgesinde 24 kurumsal müşteri." }, { en: "Offer letter — Day 1", ar: "خطاب العرض — اليوم 1", tr: "Teklif mektubu — Gün 1" }, "day1", 1, 14),
  n("s.region", "domain", "work", { en: "MENA enterprise", ar: "مؤسسات منطقة MENA", tr: "MENA kurumsal" }, { en: "UAE, KSA, Egypt focus. Quarter ends 31 March.", ar: "تركيز على الإمارات والسعودية ومصر. ربع ينتهي 31 مارس.", tr: "BAE, Suudi Arabistan, Mısır odaklı. Çeyrek 31 Mart'ta bitiyor." }, { en: "Onboarding deck — Day 1", ar: "حزمة التهيئة — اليوم 1", tr: "Oryantasyon belgesi — Gün 1" }, "day1", 0.95, 8),
  n("s.t.salesforce", "tool", "work", { en: "Salesforce", ar: "Salesforce", tr: "Salesforce" }, { en: "Mariam's CRM. Atlas keeps it honest without her typing into it.", ar: "نظام إدارة العملاء. يحافظ أطلس على دقّته بدون أن تكتب فيه مريم.", tr: "Mariam'ın CRM'i. Atlas onun yazmasına gerek kalmadan günceltutar." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 22),
  n("s.t.outreach", "tool", "work", { en: "Outreach", ar: "Outreach", tr: "Outreach" }, { en: "Sequence + email sender.", ar: "أداة التسلسل والبريد.", tr: "Dizi + e-posta gönderici." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 11),
  n("s.t.gong", "tool", "work", { en: "Gong", ar: "Gong", tr: "Gong" }, { en: "Call recording + transcripts. Atlas's main observation source for relationships.", ar: "تسجيل المكالمات ونصوصها. مصدر الملاحظة الرئيسي لأطلس عن العلاقات.", tr: "Çağrı kaydı + transkriptler. Atlas'ın ilişkiler için ana gözlem kaynağı." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 18),
  n("s.t.calendar", "tool", "work", { en: "Calendar (Outlook)", ar: "التقويم (Outlook)", tr: "Takvim (Outlook)" }, { en: "Source of attendance signal and slot-preference inference.", ar: "مصدر إشارة الحضور واستنتاج تفضيل المواعيد.", tr: "Katılım sinyali ve slot-tercihi çıkarımı kaynağı." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 25),

  // Skills — Week 1
  n("s.sk.account-planning", "skill", "work", { en: "Account planning", ar: "تخطيط الحسابات", tr: "Müşteri planlaması" }, { en: "Mariam's strongest pre-meeting routine — Atlas pre-builds it now.", ar: "أقوى روتين لمريم قبل الاجتماع — يبنيه أطلس الآن سلفاً.", tr: "Mariam'ın en güçlü toplantı-öncesi rutini — Atlas şimdi önceden hazırlıyor." }, { en: "Manager 1:1 — Week 1", ar: "اجتماع المدير — الأسبوع 1", tr: "Yönetici 1:1 — Hafta 1" }, "week1", 0.92, 9),
  n("s.sk.multi-thread", "skill", "work", { en: "Multi-threading", ar: "التواصل متعدد الجبهات", tr: "Çoklu-kanal iletişim" }, { en: "Mariam reaches at least 3 stakeholders before any forecast.", ar: "تتواصل مريم مع 3 معنيين على الأقل قبل أي توقع.", tr: "Mariam, herhangi bir tahminden önce en az 3 paydaşa ulaşır." }, { en: "Inferred from CRM activity — Week 1", ar: "مستنتج من نشاط CRM — الأسبوع 1", tr: "CRM etkinliğinden çıkarıldı — Hafta 1" }, "week1", 0.84, 7),

  // Manager + early relationships — Week 1
  n("s.r.hassan", "relationship", "work", { en: "Hassan Idris", ar: "حسن إدريس", tr: "Hassan Idris" }, { en: "Mariam's sales manager. Wants weekly forecast clarity, hates surprises.", ar: "مدير المبيعات لمريم. يريد وضوح التوقع الأسبوعي ويكره المفاجآت.", tr: "Mariam'ın satış müdürü. Haftalık tahmin netliği ister, sürprizlerden hoşlanmaz." }, { en: "First 1:1 — Week 1", ar: "أول اجتماع فردي — الأسبوع 1", tr: "İlk 1:1 — Hafta 1" }, "week1", 0.95, 16, [{ en: "used in 4 weekly forecast briefs", ar: "استُخدمت في 4 موجزات توقع أسبوعية", tr: "4 haftalık tahmin brifinginde kullanıldı" }]),

  // Month 1 — first accounts in
  n("s.r.maya", "relationship", "work", { en: "Maya Chen (VP Procurement, ACME)", ar: "مايا تشين (نائب رئيس المشتريات، ACME)", tr: "Maya Chen (Tedarik Başkan Yrd., ACME)" }, { en: "Mariam's largest live opportunity. Direct, vegetarian, kids in soccer.", ar: "أكبر فرصة حية لمريم. مباشرة، نباتية، أطفالها في كرة القدم.", tr: "Mariam'ın en büyük canlı fırsatı. Direkt, vejetaryen, çocukları futbolda." }, { en: "Discovery call transcript — Month 1", ar: "نص مكالمة الاستكشاف — الشهر 1", tr: "Keşif görüşmesi transkripti — Ay 1" }, "month1", 0.97, 31, [{ en: "used in 9 follow-ups, 5 briefs, 2 chat answers", ar: "استُخدمت في 9 متابعات و5 موجزات وإجابتين", tr: "9 takipte, 5 brifingde, 2 sohbet yanıtında kullanıldı" }]),
  n("s.p.acme-eu", "project", "work", { en: "ACME EU rollout", ar: "إطلاق ACME في أوروبا", tr: "ACME AB lansmanı" }, { en: "Maya's headline 2026 initiative. Cloud-native pilot in Q1.", ar: "المبادرة الرئيسية لمايا في 2026. تجربة سحابية في الربع الأول.", tr: "Maya'nın 2026 manşet girişimi. Ç1'de bulut-tabanlı pilot." }, { en: "LinkedIn post — Month 1", ar: "منشور لينكدإن — الشهر 1", tr: "LinkedIn paylaşımı — Ay 1" }, "month1", 0.88, 14),
  n("s.p.acme-pricing", "project", "work", { en: "ACME pricing renegotiation", ar: "إعادة التفاوض على تسعير ACME", tr: "ACME fiyat yeniden müzakeresi" }, { en: "Active deal cycle. Pricing conversation in last week's call.", ar: "دورة صفقة نشطة. محادثة تسعير في مكالمة الأسبوع الماضي.", tr: "Aktif anlaşma döngüsü. Geçen haftaki görüşmede fiyat konuşması." }, { en: "Gong call — last week", ar: "مكالمة Gong — الأسبوع الماضي", tr: "Gong çağrısı — geçen hafta" }, "month1", 0.93, 19, [{ en: "cited in today's proactive ACME suggestion", ar: "مذكورة في اقتراح ACME الاستباقي اليوم", tr: "bugünkü proaktif ACME önerisinde alıntılandı" }]),

  // Month 6 — preferences and richer constellation
  n("s.pref.maya-tuesday", "preference", "work", { en: "Maya prefers Tuesday lunch slots", ar: "تفضّل مايا مواعيد الغداء الثلاثاء", tr: "Maya Salı öğle saatlerini tercih ediyor" }, { en: "Inferred from 6 successful meeting acceptances vs 3 declined Mon/Wed.", ar: "استنتاج من 6 قبول اجتماع مقابل 3 رفض الإثنين/الأربعاء.", tr: "6 başarılı toplantı kabulü vs 3 Pzt/Çar reddinden çıkarıldı." }, { en: "Calendar pattern — Month 6", ar: "نمط التقويم — الشهر 6", tr: "Takvim deseni — Ay 6" }, "month6", 0.86, 6),
  n("s.pref.maya-vegetarian", "preference", "personal", { en: "Maya is vegetarian", ar: "مايا نباتية", tr: "Maya vejetaryen" }, { en: "Mentioned at the Riyadh dinner. Atlas books vegan-friendly venues for ACME.", ar: "ذُكر في عشاء الرياض. يحجز أطلس أماكن مناسبة للنباتيين لـ ACME.", tr: "Riyad yemeğinde bahsedildi. Atlas ACME için vegan-dostu mekânlar ayırtıyor." }, { en: "Dinner conversation — Month 6", ar: "محادثة العشاء — الشهر 6", tr: "Yemek sohbeti — Ay 6" }, "month6", 0.97, 5),
  n("s.pref.maya-soccer", "preference", "personal", { en: "Maya's kids play soccer", ar: "أطفال مايا يلعبون كرة القدم", tr: "Maya'nın çocukları futbol oynuyor" }, { en: "Useful small-talk hook. Atlas surfaces it before any first-thing-Monday calls.", ar: "خط حديث ودّي مفيد. يطرحه أطلس قبل أي مكالمة صباح الإثنين.", tr: "Yararlı küçük-konuşma kancası. Atlas, herhangi bir Pazartesi-sabahı görüşmeden önce gündeme getirir." }, { en: "Gong transcript — Month 6", ar: "نص Gong — الشهر 6", tr: "Gong transkripti — Ay 6" }, "month6", 0.78, 3),
  n("s.r.sara", "relationship", "work", { en: "Sara Park (Procurement Lead, ACME)", ar: "سارة بارك (مديرة المشتريات، ACME)", tr: "Sara Park (Tedarik Lideri, ACME)" }, { en: "Reports to Maya. Detail-oriented, owns the contract redlines.", ar: "تتبع لمايا. مهتمّة بالتفاصيل ومسؤولة عن مراجعات العقد.", tr: "Maya'ya bağlı. Detay odaklı, sözleşme red-line'larından sorumlu." }, { en: "Meeting transcript — Month 6", ar: "نص الاجتماع — الشهر 6", tr: "Toplantı transkripti — Ay 6" }, "month6", 0.91, 12),
  n("s.r.layla", "relationship", "work", { en: "Layla Al-Mazrouei (CS counterpart)", ar: "ليلى المزروعي (نظيرة CS)", tr: "Layla Al-Mazrouei (CS karşılığı)" }, { en: "Customer Success counterpart on Mariam's live accounts. Shares health scores weekly.", ar: "نظيرة نجاح العملاء على حسابات مريم الحية. تشارك درجات الصحة أسبوعياً.", tr: "Mariam'ın canlı hesaplarındaki Müşteri Başarısı muadili. Sağlık skorlarını haftalık paylaşır." }, { en: "Slack thread — Month 6", ar: "محادثة Slack — الشهر 6", tr: "Slack konusu — Ay 6" }, "month6", 0.93, 17),
  n("s.r.techcorp", "relationship", "work", { en: "TechCorp — 3 contacts", ar: "TechCorp — 3 جهات اتصال", tr: "TechCorp — 3 kişi" }, { en: "Cold account. Mariam knows Karim Salem (CTO), Lina Bahri (Head of Eng), Tarek Fadel (CIO Adv).", ar: "حساب بارد. تعرف مريم كريم سالم وليني بحري وطارق فاضل.", tr: "Soğuk hesap. Mariam Karim Salem, Lina Bahri ve Tarek Fadel'i tanıyor." }, { en: "LinkedIn introductions — Month 6", ar: "تعارف LinkedIn — الشهر 6", tr: "LinkedIn tanıtımları — Ay 6" }, "month6", 0.7, 4),
  n("s.comm.style", "communication", "work", { en: "Voice: short, three options, signs M.", ar: "الأسلوب: قصير، ثلاثة خيارات، يوقّع M.", tr: "Üslup: kısa, üç seçenek, M. ile imzalar" }, { en: "Mariam writes short, lists three options, signs 'M.' Atlas's drafts match.", ar: "تكتب مريم بإيجاز، تضع ثلاثة خيارات، توقّع 'M.'. تطابق مسوّدات أطلس.", tr: "Mariam kısa yazar, üç seçenek listeler, 'M.' ile imzalar. Atlas taslakları eşler." }, { en: "Inferred from 200+ sent emails — Month 6", ar: "مستنتج من 200+ بريد مُرسل — الشهر 6", tr: "200+ gönderilmiş e-postadan çıkarıldı — Ay 6" }, "month6", 0.95, 47),

  // Personal — Month 6
  n("s.per.layan", "personal", "personal", { en: "Daughter Layan", ar: "الابنة ليان", tr: "Kızı Layan" }, { en: "Mariam's daughter, mentioned on Gong call when meeting was rescheduled.", ar: "ابنة مريم، ذُكرت في مكالمة Gong عند إعادة جدولة الاجتماع.", tr: "Mariam'ın kızı, toplantı yeniden planlandığında Gong görüşmesinde bahsedildi." }, { en: "Mariam mentioned, Gong — Month 6", ar: "ذكرتها مريم، Gong — الشهر 6", tr: "Mariam bahsetti, Gong — Ay 6" }, "month6", 0.97, 3),
  n("s.per.recital", "personal", "personal", { en: "Layan's recital — Thursday 6pm", ar: "حفلة ليان — الخميس 6 مساءً", tr: "Layan'ın konseri — Perşembe 18:00" }, { en: "This Thursday. Atlas blocks the calendar 5–8pm and pre-selects three local florists.", ar: "هذا الخميس. يحجز أطلس التقويم 5-8 مساءً ويختار ثلاثة محلات زهور محلية.", tr: "Bu Perşembe. Atlas takvimi 17:00–20:00 arası bloklar ve üç yerel çiçekçi seçer." }, { en: "Mariam mentioned, Gong — last week", ar: "ذكرتها مريم، Gong — الأسبوع الماضي", tr: "Mariam bahsetti, Gong — geçen hafta" }, "month6", 0.95, 1, [{ en: "used in today's personal nudge card", ar: "استُخدمت في تنبيه شخصي اليوم", tr: "bugünün kişisel hatırlatma kartında kullanıldı" }]),

  // Year 1 — depth, more contacts, expanded book
  n("s.r.ahmed-orange", "relationship", "work", { en: "Ahmed (Director, Orange)", ar: "أحمد (مدير، أورانج)", tr: "Ahmed (Direktör, Orange)" }, { en: "New account opened Month 8. Likes data-heavy briefings.", ar: "حساب جديد افتتح في الشهر 8. يحب الإحاطات الغنية بالبيانات.", tr: "8. ayda açılan yeni hesap. Veri ağırlıklı brifingleri sever." }, { en: "Discovery — Month 8", ar: "استكشاف — الشهر 8", tr: "Keşif — Ay 8" }, "year1", 0.88, 9),
  n("s.r.priya-emaar", "relationship", "work", { en: "Priya (CIO, Emaar)", ar: "بريا (CIO، إعمار)", tr: "Priya (CIO, Emaar)" }, { en: "Strategic relationship. Quarterly QBRs.", ar: "علاقة استراتيجية. مراجعات ربع سنوية.", tr: "Stratejik ilişki. Üç aylık QBR'lar." }, { en: "Account intro — Month 9", ar: "تعريف الحساب — الشهر 9", tr: "Hesap tanıtımı — Ay 9" }, "year1", 0.86, 8),
  n("s.r.imran-stc", "relationship", "work", { en: "Imran (Head Procurement, STC)", ar: "عمران (رئيس المشتريات، STC)", tr: "Imran (Tedarik Başkanı, STC)" }, { en: "Long sales cycle. Mariam multi-threads with two of his directs.", ar: "دورة بيع طويلة. تتواصل مريم مع اثنين من مرؤوسيه.", tr: "Uzun satış döngüsü. Mariam doğrudan iki kişisiyle çoklu-iletişim kurar." }, { en: "Outbound sequence — Month 10", ar: "تسلسل خارجي — الشهر 10", tr: "Giden dizi — Ay 10" }, "year1", 0.78, 6),
  n("s.r.yara-aramex", "relationship", "work", { en: "Yara (CFO, Aramex)", ar: "يارا (CFO، أرامكس)", tr: "Yara (CFO, Aramex)" }, { en: "Aramex CFO — pricing negotiator. Methodical, asks for ROI memos.", ar: "CFO أرامكس — مفاوضة تسعير. منهجية، تطلب مذكرات ROI.", tr: "Aramex CFO'su — fiyat müzakerecisi. Metodik, ROI notları ister." }, { en: "Discovery — Month 11", ar: "استكشاف — الشهر 11", tr: "Keşif — Ay 11" }, "year1", 0.87, 7),
  n("s.r.omar-saudia", "relationship", "work", { en: "Omar (VP IT, Saudia)", ar: "عمر (نائب رئيس IT، السعودية)", tr: "Omar (BT Başkan Yrd., Saudia)" }, { en: "Saudia VP IT. Pilot signed Month 11.", ar: "نائب رئيس IT السعودية. وقّع تجربة في الشهر 11.", tr: "Saudia BT Başkan Yardımcısı. 11. ayda pilot imzaladı." }, { en: "Pilot kickoff — Month 11", ar: "انطلاق التجربة — الشهر 11", tr: "Pilot başlangıcı — Ay 11" }, "year1", 0.9, 5),
  n("s.r.fatima-mubadala", "relationship", "work", { en: "Fatima (PM, Mubadala)", ar: "فاطمة (PM، مبادلة)", tr: "Fatima (PM, Mubadala)" }, { en: "Mubadala digital PM. Closed-won Month 12.", ar: "مديرة مشروع رقمي في مبادلة. صفقة فائزة في الشهر 12.", tr: "Mubadala dijital PM. 12. ayda kapatıldı-kazanıldı." }, { en: "Closed-won — Month 12", ar: "صفقة فائزة — الشهر 12", tr: "Kapatıldı-kazanıldı — Ay 12" }, "year1", 0.93, 6),
  n("s.r.network", "relationship", "personal", { en: "Personal MENA AE network (12)", ar: "شبكة AE MENA الشخصية (12)", tr: "Kişisel MENA AE ağı (12)" }, { en: "Mariam's portable peer network — moves with her between employers.", ar: "شبكة الأقران المحمولة لمريم — تنتقل معها بين أصحاب العمل.", tr: "Mariam'ın taşınabilir akran ağı — işverenler arasında onunla taşınır." }, { en: "LinkedIn — across roles", ar: "LinkedIn — عبر الأدوار", tr: "LinkedIn — roller boyunca" }, "year1", 0.9, 4),
  n("s.pref.maya-bcc", "preference", "work", { en: "Maya BCC's her chief of staff", ar: "تضع مايا رئيس مكتبها BCC", tr: "Maya genel müdürünü BCC'ye ekler" }, { en: "Mariam should always BCC kc@acme on Maya threads.", ar: "يجب على مريم دوماً BCC على kc@acme في خيوط مايا.", tr: "Mariam, Maya konularında her zaman kc@acme'yi BCC'ye eklemeli." }, { en: "Inferred from 11 threads — Year 1", ar: "مستنتج من 11 خيطاً — السنة 1", tr: "11 konudan çıkarıldı — Yıl 1" }, "year1", 0.84, 11),
  n("s.pref.no-friday-meet", "preference", "work", { en: "No Friday meetings (KSA)", ar: "لا اجتماعات الجمعة (السعودية)", tr: "Cuma toplantısı yok (KSA)" }, { en: "Mariam stops scheduling KSA meetings on Friday after the 4th cancellation.", ar: "توقفت مريم عن جدولة اجتماعات السعودية الجمعة بعد الإلغاء الرابع.", tr: "Mariam, 4. iptal sonrası KSA Cuma toplantılarını planlamayı bıraktı." }, { en: "Calendar pattern — Year 1", ar: "نمط التقويم — السنة 1", tr: "Takvim deseni — Yıl 1" }, "year1", 0.97, 8),
  n("s.per.ramadan", "personal", "personal", { en: "Mariam fasts Ramadan", ar: "تصوم مريم في رمضان", tr: "Mariam Ramazan'da oruç tutar" }, { en: "Atlas auto-shifts internal meetings to mornings during Ramadan.", ar: "ينقل أطلس الاجتماعات الداخلية إلى الصباح في رمضان.", tr: "Atlas, Ramazan'da iç toplantıları otomatik olarak sabaha kaydırır." }, { en: "Calendar pattern — Year 1", ar: "نمط التقويم — السنة 1", tr: "Takvim deseni — Yıl 1" }, "year1", 0.99, 6),
  n("s.per.parents-jeddah", "personal", "personal", { en: "Parents in Jeddah", ar: "الوالدان في جدة", tr: "Anne-baba Cidde'de" }, { en: "Mariam visits monthly. Atlas blocks calendar around the second weekend.", ar: "تزور مريم شهرياً. يحجز أطلس التقويم حول عطلة نهاية الأسبوع الثانية.", tr: "Mariam aylık ziyaret eder. Atlas, ikinci hafta sonu civarında takvimi bloklar." }, { en: "Repeated event — Year 1", ar: "حدث متكرر — السنة 1", tr: "Tekrarlayan etkinlik — Yıl 1" }, "year1", 0.95, 11),
  n("s.sk.cloud-pitch", "skill", "work", { en: "Cloud-native pitch", ar: "عرض السحابة الأصلية", tr: "Bulut-tabanlı sunum" }, { en: "Mariam's go-to deck for Engineering audiences. Atlas tunes it per persona.", ar: "العرض المفضّل لمريم لجمهور الهندسة. يضبطه أطلس لكل شخصية.", tr: "Mariam'ın Mühendislik dinleyicileri için tercih ettiği sunum. Atlas kişiye göre ayarlar." }, { en: "Reused 17× — Year 1", ar: "أُعيد استخدامه 17×  — السنة 1", tr: "17× yeniden kullanıldı — Yıl 1" }, "year1", 0.94, 17),
  n("s.dom.cloud-econ", "domain", "work", { en: "GCC cloud economics", ar: "اقتصاديات السحابة في الخليج", tr: "KİK bulut ekonomisi" }, { en: "Sovereign vs hyperscaler tradeoffs — Mariam's recurring Q.", ar: "مقايضات السحابة السيادية مقابل المقدمين الكبار — سؤال مريم المتكرر.", tr: "Egemen vs hiper-ölçek dengeleri — Mariam'ın tekrarlayan sorusu." }, { en: "Internal wiki + 12 calls — Year 1", ar: "ويكي داخلي + 12 مكالمة — السنة 1", tr: "İç wiki + 12 görüşme — Yıl 1" }, "year1", 0.85, 9),
];

const SALES_EDGES: PCGEdge[] = [
  { from: "s.role", to: "s.region", kind: "works_on", strength: 1, learnedAt: "day1" },
  { from: "s.role", to: "s.t.salesforce", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "s.role", to: "s.t.outreach", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "s.role", to: "s.t.gong", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "s.role", to: "s.t.calendar", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "s.role", to: "s.r.hassan", kind: "reports_to", strength: 1, learnedAt: "week1" },
  { from: "s.role", to: "s.sk.account-planning", kind: "uses", strength: 0.9, learnedAt: "week1" },
  { from: "s.role", to: "s.sk.multi-thread", kind: "uses", strength: 0.85, learnedAt: "week1" },
  { from: "s.r.maya", to: "s.p.acme-eu", kind: "owns", strength: 0.9, learnedAt: "month1" },
  { from: "s.r.maya", to: "s.p.acme-pricing", kind: "owns", strength: 0.95, learnedAt: "month1" },
  { from: "s.r.sara", to: "s.r.maya", kind: "reports_to", strength: 0.95, learnedAt: "month6" },
  { from: "s.r.maya", to: "s.pref.maya-tuesday", kind: "prefers", strength: 0.86, learnedAt: "month6" },
  { from: "s.r.maya", to: "s.pref.maya-vegetarian", kind: "prefers", strength: 0.97, learnedAt: "month6" },
  { from: "s.r.maya", to: "s.pref.maya-soccer", kind: "remembers", strength: 0.78, learnedAt: "month6" },
  { from: "s.r.maya", to: "s.pref.maya-bcc", kind: "prefers", strength: 0.84, learnedAt: "year1" },
  { from: "s.r.layla", to: "s.r.maya", kind: "knows", strength: 0.7, learnedAt: "month6" },
  { from: "s.role", to: "s.comm.style", kind: "uses", strength: 0.95, learnedAt: "month6" },
  { from: "s.role", to: "s.per.layan", kind: "remembers", strength: 0.97, learnedAt: "month6" },
  { from: "s.per.layan", to: "s.per.recital", kind: "attended", strength: 0.95, learnedAt: "month6" },
  { from: "s.role", to: "s.r.ahmed-orange", kind: "knows", strength: 0.85, learnedAt: "year1" },
  { from: "s.role", to: "s.r.priya-emaar", kind: "knows", strength: 0.86, learnedAt: "year1" },
  { from: "s.role", to: "s.r.imran-stc", kind: "knows", strength: 0.78, learnedAt: "year1" },
  { from: "s.role", to: "s.r.yara-aramex", kind: "knows", strength: 0.87, learnedAt: "year1" },
  { from: "s.role", to: "s.r.omar-saudia", kind: "knows", strength: 0.9, learnedAt: "year1" },
  { from: "s.role", to: "s.r.fatima-mubadala", kind: "knows", strength: 0.93, learnedAt: "year1" },
  { from: "s.role", to: "s.r.network", kind: "knows", strength: 0.9, learnedAt: "year1" },
  { from: "s.role", to: "s.pref.no-friday-meet", kind: "prefers", strength: 0.97, learnedAt: "year1" },
  { from: "s.role", to: "s.per.ramadan", kind: "remembers", strength: 0.99, learnedAt: "year1" },
  { from: "s.role", to: "s.per.parents-jeddah", kind: "remembers", strength: 0.95, learnedAt: "year1" },
  { from: "s.role", to: "s.sk.cloud-pitch", kind: "uses", strength: 0.94, learnedAt: "year1" },
  { from: "s.role", to: "s.dom.cloud-econ", kind: "uses", strength: 0.85, learnedAt: "year1" },
];

// =================================================================
// PERSONA B — HR — Yusuf Demir · Ember
// =================================================================
const HR_NODES: PCGNode[] = [
  // Day 1
  n("h.role", "role", "work", { en: "HR Business Partner — Engineering", ar: "شريك أعمال موارد بشرية — الهندسة", tr: "İK İş Ortağı — Mühendislik" }, { en: "Northwind. Supports a 200-engineer org across 14 leads.", ar: "نورثويند. يدعم منظمة من 200 مهندس عبر 14 قائداً.", tr: "Northwind. 14 lider üzerinden 200 mühendis organizasyonunu destekler." }, { en: "Offer letter — Day 1", ar: "خطاب العرض — اليوم 1", tr: "Teklif mektubu — Gün 1" }, "day1", 1, 22),
  n("h.t.workday", "tool", "work", { en: "Workday", ar: "Workday", tr: "Workday" }, { en: "HRIS — comp bands, headcount, leave.", ar: "نظام موارد بشرية — حدود التعويض، الأعداد، الإجازات.", tr: "İK bilgi sistemi — ücret bantları, kadro, izin." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 19),
  n("h.t.greenhouse", "tool", "work", { en: "Greenhouse", ar: "Greenhouse", tr: "Greenhouse" }, { en: "ATS — open reqs, candidate stages.", ar: "نظام تتبع المتقدمين — الطلبات المفتوحة، مراحل المرشحين.", tr: "ATS — açık pozisyonlar, aday aşamaları." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 11),
  n("h.t.servicenow", "tool", "work", { en: "ServiceNow HR", ar: "ServiceNow HR", tr: "ServiceNow HR" }, { en: "Case ticketing.", ar: "تذاكر الحالات.", tr: "Vaka biletleri." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 16),
  n("h.t.slack", "tool", "work", { en: "Slack", ar: "Slack", tr: "Slack" }, { en: "Theme detection across engineering channels.", ar: "كشف الموضوعات عبر قنوات الهندسة.", tr: "Mühendislik kanallarında tema tespiti." }, { en: "Tool inventory — Day 1", ar: "قائمة الأدوات — اليوم 1", tr: "Araç envanteri — Gün 1" }, "day1", 1, 24),

  // Week 1
  n("h.r.priya", "relationship", "work", { en: "Priya Nair (VP Engineering)", ar: "بريا نير (نائب رئيس الهندسة)", tr: "Priya Nair (Mühendislik Başkan Yrd.)" }, { en: "Yusuf's primary partner. Prefers async written briefs over meetings.", ar: "الشريك الأساسي ليوسف. تفضّل الموجزات الكتابية على الاجتماعات.", tr: "Yusuf'un birincil partneri. Toplantılar yerine async yazılı brifingleri tercih eder." }, { en: "First 1:1 — Week 1", ar: "أول اجتماع فردي — الأسبوع 1", tr: "İlk 1:1 — Hafta 1" }, "week1", 0.95, 21, [{ en: "used in 6 weekly briefs and 3 case discussions", ar: "استُخدمت في 6 موجزات أسبوعية و3 نقاشات حالات", tr: "6 haftalık brifingde ve 3 vaka tartışmasında kullanıldı" }]),
  n("h.r.ahmet", "relationship", "work", { en: "Ahmet Kaya (Head of TA)", ar: "أحمد قايا (رئيس استقطاب المواهب)", tr: "Ahmet Kaya (Yetenek Kazanım Başkanı)" }, { en: "Owns the Eng hiring funnel. Yusuf coordinates Q4 hiring with him.", ar: "يدير قمع توظيف الهندسة. ينسّق يوسف توظيف الربع الرابع معه.", tr: "Müh. işe alım hunisi onun. Yusuf onunla Ç4 işe alımını koordine eder." }, { en: "Greenhouse onboarding — Week 1", ar: "تهيئة Greenhouse — الأسبوع 1", tr: "Greenhouse oryantasyonu — Hafta 1" }, "week1", 0.93, 13),
  n("h.sk.case-mgmt", "skill", "work", { en: "Case management", ar: "إدارة الحالات", tr: "Vaka yönetimi" }, { en: "Yusuf's strongest core skill — visa, relocation, conflict, comp.", ar: "أقوى مهارة جوهرية ليوسف — التأشيرة، الانتقال، النزاع، التعويض.", tr: "Yusuf'un en güçlü temel becerisi — vize, taşınma, çatışma, ücret." }, { en: "Manager 1:1 — Week 1", ar: "اجتماع المدير — الأسبوع 1", tr: "Yönetici 1:1 — Hafta 1" }, "week1", 0.93, 8),

  // Month 1 — early policies and Eng leads
  n("h.dom.policy-sabbatical", "domain", "work", { en: "Sabbatical policy v2 (Mar 2026)", ar: "سياسة الإجازة الطويلة v2 (مارس 2026)", tr: "Sabbatical politikası v2 (Mart 2026)" }, { en: "Newly published. Three engineers asked Slack about it in the last hour.", ar: "نُشرت حديثاً. سأل عنها 3 مهندسين في Slack خلال الساعة الماضية.", tr: "Yeni yayımlandı. Üç mühendis son bir saatte Slack'te sordu." }, { en: "Policy doc — Month 1", ar: "وثيقة السياسة — الشهر 1", tr: "Politika belgesi — Ay 1" }, "month1", 0.96, 7, [{ en: "cited in today's pending FAQ card", ar: "مذكورة في بطاقة الأسئلة الشائعة المعلّقة اليوم", tr: "bugünün bekleyen SSS kartında alıntılandı" }]),
  n("h.dom.policy-comp", "domain", "work", { en: "Comp bands FY26", ar: "حدود التعويض FY26", tr: "Ücret bantları FY26" }, { en: "Updated bands. Yusuf references for offer letters and promotion debriefs.", ar: "حدود محدّثة. يستخدمها يوسف لخطابات العرض ومناقشات الترقية.", tr: "Güncellenmiş bantlar. Yusuf teklif mektupları ve terfi görüşmeleri için referans alır." }, { en: "Comp & Ben doc — Month 1", ar: "وثيقة التعويض والمزايا — الشهر 1", tr: "Comp & Ben belgesi — Ay 1" }, "month1", 1, 14),
  n("h.r.lead.ali", "relationship", "work", { en: "Ali (Eng Lead, Platform)", ar: "علي (قائد هندسة المنصة)", tr: "Ali (Müh. Lideri, Platform)" }, { en: "Senior lead. Has an open relocation case (Cairo → Dubai).", ar: "قائد كبير. لديه حالة انتقال مفتوحة (القاهرة → دبي).", tr: "Kıdemli lider. Açık bir taşınma vakası var (Kahire → Dubai)." }, { en: "1:1 + ServiceNow case — Month 1", ar: "اجتماع + حالة ServiceNow — الشهر 1", tr: "1:1 + ServiceNow vakası — Ay 1" }, "month1", 0.91, 6),
  n("h.r.lead.sami", "relationship", "work", { en: "Sami (Eng Lead, ML)", ar: "سامي (قائد هندسة ML)", tr: "Sami (Müh. Lideri, ML)" }, { en: "Quietly considering a sabbatical. Sentiment signal from 1:1 notes.", ar: "يفكر بهدوء في إجازة طويلة. إشارة من ملاحظات اللقاءات.", tr: "Sessizce bir sabbatical düşünüyor. 1:1 notlarından duygu sinyali." }, { en: "1:1 notes — Month 1", ar: "ملاحظات اللقاء — الشهر 1", tr: "1:1 notları — Ay 1" }, "month1", 0.78, 4, [{ en: "cross-referenced in today's sabbatical FAQ", ar: "مرجَّع في الأسئلة الشائعة عن الإجازة اليوم", tr: "bugünkü sabbatical SSS'sinde çapraz başvuruldu" }]),

  // Month 6 — projects, comm style, more leads
  n("h.p.q4-hiring", "project", "work", { en: "Q4 hiring plan (14 reqs)", ar: "خطة توظيف الربع الرابع (14 طلباً)", tr: "Ç4 işe alım planı (14 talep)" }, { en: "14 open requisitions. Yusuf and Ahmet sync weekly on funnel health.", ar: "14 طلباً مفتوحاً. ينسّق يوسف وأحمد أسبوعياً عن صحة القمع.", tr: "14 açık pozisyon. Yusuf ve Ahmet huni sağlığı için haftalık senkronize olur." }, { en: "Hiring plan doc — Month 6", ar: "وثيقة خطة التوظيف — الشهر 6", tr: "İşe alım planı belgesi — Ay 6" }, "month6", 0.93, 19),
  n("h.comm.style", "communication", "work", { en: "Voice: bullet briefs, signs Y. — HRBP", ar: "الأسلوب: نقاط، يوقّع Y. — HRBP", tr: "Üslup: madde madde, Y. — HRBP ile imzalar" }, { en: "Yusuf prefers bullet-pointed briefings. Ember matches.", ar: "يفضّل يوسف الإحاطات النقطية. تطابق إمبر.", tr: "Yusuf madde madde brifingleri tercih eder. Ember eşler." }, { en: "Inferred from 150+ briefs — Month 6", ar: "مستنتج من 150+ موجزاً — الشهر 6", tr: "150+ brifingden çıkarıldı — Ay 6" }, "month6", 0.95, 38),
  n("h.r.case.visa.maria", "relationship", "work", { en: "Maria's open visa case", ar: "حالة تأشيرة ماريا المفتوحة", tr: "Maria'nın açık vize vakası" }, { en: "Senior engineer; visa renewal stuck. Yusuf nudges legal weekly.", ar: "مهندسة كبيرة؛ تجديد التأشيرة عالق. يدفع يوسف الفريق القانوني أسبوعياً.", tr: "Kıdemli mühendis; vize yenileme takıldı. Yusuf hukuku haftalık dürter." }, { en: "ServiceNow case — Month 6", ar: "حالة ServiceNow — الشهر 6", tr: "ServiceNow vakası — Ay 6" }, "month6", 0.94, 7),
  n("h.r.lead.fatma", "relationship", "work", { en: "Fatma (Eng Lead, Web)", ar: "فطمة (قائدة هندسة الويب)", tr: "Fatma (Müh. Lideri, Web)" }, { en: "New parent — flexible-hours arrangement.", ar: "والدة جديدة — ترتيب ساعات مرنة.", tr: "Yeni anne — esnek saat düzenlemesi." }, { en: "1:1 — Month 6", ar: "اجتماع — الشهر 6", tr: "1:1 — Ay 6" }, "month6", 0.87, 5),
  n("h.dom.policy-flex", "domain", "work", { en: "Flexible-hours policy", ar: "سياسة الساعات المرنة", tr: "Esnek saat politikası" }, { en: "Yusuf cites for new-parent and caregiving cases.", ar: "يستشهد بها يوسف لحالات الوالدية والرعاية.", tr: "Yusuf yeni-ebeveyn ve bakım vakalarında alıntılar." }, { en: "Comp & Ben doc — Month 6", ar: "وثيقة C&B — الشهر 6", tr: "C&B belgesi — Ay 6" }, "month6", 0.97, 9),

  // Personal — Month 6
  n("h.per.mom-70", "personal", "personal", { en: "Mother's 70th in 3 weeks", ar: "ميلاد الأم السبعين خلال 3 أسابيع", tr: "Annenin 70'i 3 hafta sonra" }, { en: "Yusuf mentioned in family WhatsApp; sister proposed surprise dinner.", ar: "ذكر يوسف ذلك في عائلة WhatsApp؛ اقترحت الأخت عشاء مفاجأة.", tr: "Yusuf aile WhatsApp'ında bahsetti; kardeşi sürpriz yemek önerdi." }, { en: "Family group — Month 6", ar: "مجموعة العائلة — الشهر 6", tr: "Aile grubu — Ay 6" }, "month6", 0.92, 2, [{ en: "used in today's personal nudge card", ar: "استُخدمت في تنبيه شخصي اليوم", tr: "bugünün kişisel hatırlatma kartında kullanıldı" }]),
  n("h.per.toast-stories", "personal", "personal", { en: "Stories shared in past 1:1s about mom", ar: "قصص شاركها يوسف في لقاءات سابقة عن أمه", tr: "Annesi hakkında geçmiş 1:1'larda paylaşılan hikâyeler" }, { en: "Three anecdotes Ember can weave into a draft toast.", ar: "ثلاث حكايات يمكن لإمبر نسجها في كلمة.", tr: "Ember'ın bir konuşmaya örebileceği üç anekdot." }, { en: "1:1 transcripts — Month 6", ar: "نسخ اللقاءات — الشهر 6", tr: "1:1 transkriptleri — Ay 6" }, "month6", 0.85, 1),

  // Year 1
  n("h.p.sabbatical-rollout", "project", "work", { en: "Sabbatical policy rollout", ar: "إطلاق سياسة الإجازة الطويلة", tr: "Sabbatical politika lansmanı" }, { en: "Cross-team comms; Ember drafts FAQs and schedules office hours.", ar: "اتصالات عبر الفرق؛ تصوغ إمبر الأسئلة وتحجز ساعات مكتبية.", tr: "Çapraz-takım iletişimi; Ember SSS'leri taslakla ve ofis saatleri ayarlar." }, { en: "Project plan — Month 9", ar: "خطة المشروع — الشهر 9", tr: "Proje planı — Ay 9" }, "year1", 0.92, 11),
  n("h.r.lead.ji", "relationship", "work", { en: "Ji (Eng Lead, Mobile)", ar: "جي (قائد هندسة الموبايل)", tr: "Ji (Müh. Lideri, Mobil)" }, { en: "New cross-functional partner; promo case in flight.", ar: "شريك جديد متعدد الوظائف؛ حالة ترقية في التنفيذ.", tr: "Yeni çapraz-fonksiyonel ortak; uçuşta terfi vakası." }, { en: "Promo packet — Month 9", ar: "حزمة الترقية — الشهر 9", tr: "Terfi paketi — Ay 9" }, "year1", 0.86, 5),
  n("h.r.lead.dina", "relationship", "work", { en: "Dina (Eng Lead, SRE)", ar: "دينا (قائدة هندسة SRE)", tr: "Dina (Müh. Lideri, SRE)" }, { en: "On-call burnout signal from Slack. Ember tracks.", ar: "إشارة إرهاق المناوبة من Slack. تتابع إمبر.", tr: "Slack'ten çağrı-bekleme tükenmişlik sinyali. Ember izliyor." }, { en: "Slack sentiment — Month 10", ar: "مشاعر Slack — الشهر 10", tr: "Slack duygu — Ay 10" }, "year1", 0.79, 4),
  n("h.r.lead.10more", "relationship", "work", { en: "10 more Eng leads", ar: "10 قادة هندسة آخرين", tr: "10 başka Müh. Lideri" }, { en: "Stable working relationships with 10 more leads — bullets-only briefs.", ar: "علاقات عمل مستقرة مع 10 قادة آخرين — موجزات نقطية فقط.", tr: "10 başka liderle istikrarlı iş ilişkisi — sadece madde brifingler." }, { en: "Quarterly skip-levels — Year 1", ar: "تخطّي مستويات ربع سنوي — السنة 1", tr: "Üç aylık atlama-seviyeler — Yıl 1" }, "year1", 0.9, 14),
  n("h.dom.policy-pip", "domain", "work", { en: "PIP framework", ar: "إطار خطة تحسين الأداء", tr: "PIP çerçevesi" }, { en: "Performance improvement plan template; Yusuf coaches managers through it.", ar: "نموذج خطة تحسين الأداء؛ يدرّب يوسف المديرين عليه.", tr: "Performans iyileştirme planı şablonu; Yusuf yöneticileri buna göre koçluk eder." }, { en: "Mgr handbook — Year 1", ar: "دليل المدير — السنة 1", tr: "Yönetici el kitabı — Yıl 1" }, "year1", 0.95, 6),
  n("h.dom.policy-grievance", "domain", "work", { en: "Grievance handling", ar: "التعامل مع الشكاوى", tr: "Şikâyet ele alma" }, { en: "Strict workflow; Ember enforces refusal pattern (no auto-action).", ar: "سير عمل صارم؛ تطبّق إمبر نمط الرفض (لا إجراء آلي).", tr: "Katı iş akışı; Ember reddetme desenini uygular (otomatik eylem yok)." }, { en: "Compliance — Year 1", ar: "الامتثال — السنة 1", tr: "Uyumluluk — Yıl 1" }, "year1", 1, 3),
  n("h.sk.theme-reading", "skill", "work", { en: "Cross-channel theme reading", ar: "قراءة الموضوعات عبر القنوات", tr: "Çapraz-kanal tema okuma" }, { en: "Yusuf's signature ability — spotting patterns across Slack and 1:1s.", ar: "القدرة المميّزة ليوسف — رصد الأنماط عبر Slack واللقاءات.", tr: "Yusuf'un imza yeteneği — Slack ve 1:1'larda desen yakalama." }, { en: "Quarterly reviews — Year 1", ar: "مراجعات ربع سنوية — السنة 1", tr: "Üç aylık incelemeler — Yıl 1" }, "year1", 0.92, 13),
  n("h.per.cat-bilbo", "personal", "personal", { en: "Cat Bilbo, vet check Q2", ar: "القط بيلبو، فحص بيطري Q2", tr: "Kedi Bilbo, Ç2 veteriner kontrolü" }, { en: "Yusuf reschedules around vet appointments.", ar: "يعيد يوسف الجدولة حول مواعيد الطبيب البيطري.", tr: "Yusuf veteriner randevuları etrafında yeniden planlar." }, { en: "Calendar — Year 1", ar: "التقويم — السنة 1", tr: "Takvim — Yıl 1" }, "year1", 0.83, 3),
  n("h.per.istanbul-summer", "personal", "personal", { en: "Istanbul summers with family", ar: "صيف اسطنبول مع العائلة", tr: "Aileyle İstanbul yazları" }, { en: "Annual 3-week trip; Ember protects calendar.", ar: "رحلة سنوية 3 أسابيع؛ تحمي إمبر التقويم.", tr: "Yıllık 3 haftalık gezi; Ember takvimi korur." }, { en: "Recurring event — Year 1", ar: "حدث متكرر — السنة 1", tr: "Tekrarlayan etkinlik — Yıl 1" }, "year1", 0.99, 4),
  n("h.r.network", "relationship", "personal", { en: "Personal HR community (8)", ar: "مجتمع HR الشخصي (8)", tr: "Kişisel İK topluluğu (8)" }, { en: "Yusuf's portable peer network across past employers.", ar: "شبكة الأقران المحمولة ليوسف عبر أصحاب عمل سابقين.", tr: "Yusuf'un eski işverenler arasındaki taşınabilir akran ağı." }, { en: "LinkedIn — across roles", ar: "LinkedIn — عبر الأدوار", tr: "LinkedIn — roller boyunca" }, "year1", 0.9, 3),
];

const HR_EDGES: PCGEdge[] = [
  { from: "h.role", to: "h.t.workday", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "h.role", to: "h.t.greenhouse", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "h.role", to: "h.t.servicenow", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "h.role", to: "h.t.slack", kind: "uses", strength: 1, learnedAt: "day1" },
  { from: "h.role", to: "h.r.priya", kind: "knows", strength: 1, learnedAt: "week1" },
  { from: "h.role", to: "h.r.ahmet", kind: "knows", strength: 1, learnedAt: "week1" },
  { from: "h.role", to: "h.sk.case-mgmt", kind: "uses", strength: 0.95, learnedAt: "week1" },
  { from: "h.role", to: "h.dom.policy-sabbatical", kind: "uses", strength: 0.96, learnedAt: "month1" },
  { from: "h.role", to: "h.dom.policy-comp", kind: "uses", strength: 1, learnedAt: "month1" },
  { from: "h.r.priya", to: "h.r.lead.ali", kind: "knows", strength: 0.9, learnedAt: "month1" },
  { from: "h.r.priya", to: "h.r.lead.sami", kind: "knows", strength: 0.9, learnedAt: "month1" },
  { from: "h.r.lead.sami", to: "h.dom.policy-sabbatical", kind: "inferred_from", strength: 0.78, learnedAt: "month1" },
  { from: "h.role", to: "h.p.q4-hiring", kind: "works_on", strength: 0.95, learnedAt: "month6" },
  { from: "h.r.ahmet", to: "h.p.q4-hiring", kind: "owns", strength: 0.95, learnedAt: "month6" },
  { from: "h.role", to: "h.comm.style", kind: "uses", strength: 0.95, learnedAt: "month6" },
  { from: "h.role", to: "h.r.case.visa.maria", kind: "owns", strength: 0.94, learnedAt: "month6" },
  { from: "h.r.priya", to: "h.r.lead.fatma", kind: "knows", strength: 0.85, learnedAt: "month6" },
  { from: "h.r.lead.fatma", to: "h.dom.policy-flex", kind: "inferred_from", strength: 0.85, learnedAt: "month6" },
  { from: "h.role", to: "h.per.mom-70", kind: "remembers", strength: 0.92, learnedAt: "month6" },
  { from: "h.per.mom-70", to: "h.per.toast-stories", kind: "remembers", strength: 0.85, learnedAt: "month6" },
  { from: "h.role", to: "h.p.sabbatical-rollout", kind: "works_on", strength: 0.92, learnedAt: "year1" },
  { from: "h.p.sabbatical-rollout", to: "h.dom.policy-sabbatical", kind: "uses", strength: 0.95, learnedAt: "year1" },
  { from: "h.r.priya", to: "h.r.lead.ji", kind: "knows", strength: 0.86, learnedAt: "year1" },
  { from: "h.r.priya", to: "h.r.lead.dina", kind: "knows", strength: 0.79, learnedAt: "year1" },
  { from: "h.role", to: "h.r.lead.10more", kind: "knows", strength: 0.9, learnedAt: "year1" },
  { from: "h.role", to: "h.dom.policy-pip", kind: "uses", strength: 0.95, learnedAt: "year1" },
  { from: "h.role", to: "h.dom.policy-grievance", kind: "uses", strength: 1, learnedAt: "year1" },
  { from: "h.role", to: "h.sk.theme-reading", kind: "uses", strength: 0.92, learnedAt: "year1" },
  { from: "h.role", to: "h.per.cat-bilbo", kind: "remembers", strength: 0.83, learnedAt: "year1" },
  { from: "h.role", to: "h.per.istanbul-summer", kind: "remembers", strength: 0.99, learnedAt: "year1" },
  { from: "h.role", to: "h.r.network", kind: "knows", strength: 0.9, learnedAt: "year1" },
];

// ─── Cockpit seeds ───────────────────────────────────────────────────────
const SALES_COCKPIT: CockpitSeed = {
  learnings: [
    {
      id: "s.l.1",
      text: { en: "Maya at ACME just posted on LinkedIn about the new EU rollout — added as a fresh signal on the ACME EU rollout project.", ar: "نشرت مايا في ACME على LinkedIn عن الإطلاق الأوروبي الجديد — أُضيف كإشارة جديدة على مشروع إطلاق ACME الأوروبي.", tr: "ACME'den Maya, yeni AB lansmanı hakkında LinkedIn'de paylaşım yaptı — ACME AB lansman projesine yeni bir sinyal olarak eklendi." },
      source: { en: "From LinkedIn observation, 14 minutes ago", ar: "من ملاحظة LinkedIn، قبل 14 دقيقة", tr: "LinkedIn gözleminden, 14 dakika önce" },
      citedNodeIds: ["s.r.maya", "s.p.acme-eu"],
      agoMinutes: 14,
    },
    {
      id: "s.l.2",
      text: { en: "Sara Park reports to Maya — confirmed from today's 10am call transcript.", ar: "سارة بارك تتبع لمايا — مؤكد من نص مكالمة 10 صباحاً اليوم.", tr: "Sara Park Maya'ya bağlı — bugün saat 10'daki çağrı transkriptinden onaylandı." },
      source: { en: "From your 10am call transcript, 2h ago", ar: "من نص مكالمتك صباحاً، منذ ساعتين", tr: "Sabah 10'daki çağrı transkriptinden, 2 saat önce" },
      citedNodeIds: ["s.r.sara", "s.r.maya"],
      agoMinutes: 120,
    },
    {
      id: "s.l.3",
      text: { en: "Maya BCC's her chief of staff on every reply — applied as a draft preference for ACME threads.", ar: "تضع مايا رئيس مكتبها BCC في كل رد — طُبّق كتفضيل مسودة لخيوط ACME.", tr: "Maya her yanıtta genel müdürünü BCC'ye ekliyor — ACME konuları için taslak tercihi olarak uygulandı." },
      source: { en: "Inferred across 11 sent threads, this morning", ar: "مستنتج عبر 11 خيطاً مُرسلاً، صباح اليوم", tr: "11 gönderilmiş konuda çıkarıldı, bu sabah" },
      citedNodeIds: ["s.pref.maya-bcc", "s.r.maya"],
      agoMinutes: 240,
    },
  ],
  pending: [
    {
      id: "s.p.acme-followup",
      title: { en: "Follow-up to Maya at ACME", ar: "متابعة لمايا في ACME", tr: "ACME'deki Maya'ya takip" },
      preview: { en: "Three options for next step + thanks for yesterday's pricing call.", ar: "ثلاثة خيارات للخطوة التالية + شكر على مكالمة التسعير أمس.", tr: "Bir sonraki adım için üç seçenek + dünkü fiyat görüşmesi için teşekkür." },
      body: {
        en: "Hi Maya,\n\nThanks for yesterday's call on the renewal pricing — really useful to walk through the EU rollout context.\n\nThree options for the next step:\n  1. 30-min working session Tuesday with Sara to review the redlined MSA\n  2. Async memo from me Thursday with the three pricing scenarios\n  3. Combined: short Tuesday sync, memo follows Thursday\n\nLet me know what works.\n\nM.",
        ar: "مرحباً مايا،\n\nشكراً لمكالمة الأمس عن تسعير التجديد — كانت مفيدة جداً لاستعراض سياق الإطلاق الأوروبي.\n\nثلاثة خيارات للخطوة التالية:\n  1. جلسة عمل 30 دقيقة الثلاثاء مع سارة لمراجعة MSA المعدّل\n  2. مذكرة غير متزامنة مني الخميس مع سيناريوهات التسعير الثلاثة\n  3. مزيج: مزامنة قصيرة الثلاثاء، تتبعها المذكرة الخميس\n\nأخبريني بما يناسبك.\n\nM.",
        tr: "Merhaba Maya,\n\nDünkü yenileme fiyatlandırma görüşmesi için teşekkürler — AB lansman bağlamını ele almak çok yararlıydı.\n\nBir sonraki adım için üç seçenek:\n  1. Salı 30 dakikalık çalışma oturumu, Sara ile redlined MSA'yı incelemek için\n  2. Perşembe benden async bir memo, üç fiyatlandırma senaryosuyla\n  3. Kombine: kısa Salı senkronizasyonu, ardından Perşembe memo\n\nUygun olanı bana söyleyin.\n\nM.",
      },
      source: { en: "Drafted from yesterday's Gong transcript + ACME pricing project + Maya's voice profile", ar: "مصاغة من نص Gong أمس + مشروع تسعير ACME + ملف صوت مايا", tr: "Dünkü Gong transkriptinden + ACME fiyatlandırma projesinden + Maya ses profilinden taslakla hazırlandı" },
      autonomyLevel: "L3",
      citedNodeIds: ["s.r.maya", "s.p.acme-pricing", "s.r.sara", "s.comm.style", "s.pref.maya-bcc"],
      estTimeSavedMin: 18,
      kind: "email",
    },
    {
      id: "s.p.priya-brief",
      title: { en: "Pre-meeting brief — Priya at Emaar (3pm)", ar: "موجز قبل الاجتماع — بريا في إعمار (3 مساءً)", tr: "Toplantı-öncesi brifing — Emaar'dan Priya (15:00)" },
      preview: { en: "2-paragraph context, 3 talking points, 1 risk to flag.", ar: "فقرتا سياق، 3 نقاط نقاش، خطر واحد للتنبيه.", tr: "2 paragraf bağlam, 3 konuşma noktası, 1 işaretlenecek risk." },
      body: {
        en: "Context (2 para). Priya is Emaar's CIO; you've met twice this quarter. Her board signed off on the new agentic-AI initiative on Thursday. She prefers short, dense briefings.\n\nTalking points:\n  1. Reference Thursday's board approval (don't congratulate explicitly — Priya hates ceremonial)\n  2. Pivot quickly to integration risks — Emaar's SAP estate is on-prem\n  3. Tee up a working session with Karim (her CTO) before EOM\n\nRisk to flag: TechCorp is also in conversations with her team — Sara mentioned it on Slack.",
        ar: "السياق (فقرتان). بريا هي CIO إعمار؛ التقيت بها مرتين هذا الربع. وقّع مجلسها على مبادرة الذكاء الاصطناعي الوكيلية الجديدة الخميس. تفضّل الإحاطات القصيرة الكثيفة.\n\nنقاط الحوار:\n  1. أشيري لموافقة المجلس الخميس (دون تهنئة رسمية — تكره بريا الرسميات)\n  2. تحوّلي بسرعة إلى مخاطر التكامل — منظومة SAP لدى إعمار محلية\n  3. اقترحي جلسة عمل مع كريم (CTO لديها) قبل نهاية الشهر\n\nخطر للتنبيه: TechCorp في محادثات أيضاً — ذكرت سارة ذلك في Slack.",
        tr: "Bağlam (2 paragraf). Priya, Emaar'ın CIO'su; bu çeyrek onunla iki kez görüştünüz. Yönetim kurulu Perşembe yeni özerk-yapay zekâ girişimini onayladı. Kısa, yoğun brifingleri tercih eder.\n\nKonuşma noktaları:\n  1. Perşembe yönetim kurulu onayına atıfta bulun (açıkça tebrik etme — Priya törenseli sevmez)\n  2. Hızla entegrasyon risklerine geç — Emaar'ın SAP altyapısı şirket-içi\n  3. Karim (CTO'su) ile ay sonundan önce bir çalışma oturumu öner\n\nİşaretlenecek risk: TechCorp da onun ekibiyle görüşüyor — Sara Slack'te bahsetti.",
      },
      source: { en: "Drafted from Priya node + last 2 meeting notes + Slack signal from Sara", ar: "مصاغ من عقدة بريا + ملاحظات آخر اجتماعين + إشارة Slack من سارة", tr: "Priya düğümünden + son 2 toplantı notundan + Sara'dan Slack sinyalinden taslak" },
      autonomyLevel: "L2",
      citedNodeIds: ["s.r.priya-emaar"],
      estTimeSavedMin: 22,
      kind: "brief",
    },
    {
      id: "s.p.salesforce-clean",
      title: { en: "Salesforce hygiene — close 3 stale stages", ar: "نظافة Salesforce — إغلاق 3 مراحل قديمة", tr: "Salesforce hijyeni — 3 bayat aşamayı kapat" },
      preview: { en: "Three opportunities sitting in 'Discovery' for >45 days; Atlas suggests stage updates.", ar: "ثلاث فرص بقيت في 'الاستكشاف' لأكثر من 45 يوماً؛ يقترح أطلس تحديثات المرحلة.", tr: "45+ gündür 'Keşif'te bekleyen üç fırsat; Atlas aşama güncellemeleri öneriyor." },
      body: { en: "Atlas proposes:\n  • Aramex — Yara meeting last week — move to Qualification\n  • Saudia — pilot signed — move to Closed-Won\n  • Mubadala — Fatima — already closed, archive", ar: "يقترح أطلس:\n  • أرامكس — اجتماع يارا الأسبوع الماضي — انقل إلى التأهل\n  • السعودية — تمّ التوقيع — انقل إلى الفوز\n  • مبادلة — فاطمة — مغلقة بالفعل، أرشف", tr: "Atlas öneriyor:\n  • Aramex — geçen hafta Yara toplantısı — Niteleme'ye taşı\n  • Saudia — pilot imzalandı — Kapatıldı-Kazanıldı'ya taşı\n  • Mubadala — Fatima — zaten kapalı, arşivle" },
      source: { en: "Salesforce activity diff vs Gong + email", ar: "فرق نشاط Salesforce مقابل Gong + البريد", tr: "Salesforce etkinlik farkı vs Gong + e-posta" },
      autonomyLevel: "L2",
      citedNodeIds: ["s.t.salesforce", "s.r.yara-aramex", "s.r.omar-saudia", "s.r.fatima-mubadala"],
      estTimeSavedMin: 14,
      kind: "brief",
    },
  ],
  inProgress: [
    {
      id: "s.ip.qbr",
      title: { en: "ACME QBR deck — Layla's input pending", ar: "عرض QBR لـ ACME — مدخلات ليلى معلّقة", tr: "ACME QBR sunumu — Layla'nın girdisi bekliyor" },
      steps: [
        { en: "Pulled health scores from Salesforce", ar: "سحبت درجات الصحة من Salesforce", tr: "Sağlık skorları Salesforce'tan çekildi" },
        { en: "Drafting executive summary", ar: "صياغة الملخص التنفيذي", tr: "Yönetici özeti taslağı" },
        { en: "Waiting on Layla's renewal forecast", ar: "بانتظار توقع التجديد من ليلى", tr: "Layla'nın yenileme tahmini bekleniyor" },
        { en: "Final review with you", ar: "مراجعة نهائية معك", tr: "Sizinle son inceleme" },
      ],
      currentStep: 2,
    },
    {
      id: "s.ip.research",
      title: { en: "TechCorp account opener — researching", ar: "افتتاح حساب TechCorp — قيد البحث", tr: "TechCorp hesap açıcısı — araştırılıyor" },
      steps: [
        { en: "Mapped 3 contacts via LinkedIn", ar: "ربطت 3 جهات عبر LinkedIn", tr: "LinkedIn üzerinden 3 kişi haritalandı" },
        { en: "Reading their last 4 quarters of public filings", ar: "قراءة آخر 4 أرباع من إيداعاتهم", tr: "Son 4 çeyrek halka açık dosyalama okunuyor" },
        { en: "Drafting personalised outreach", ar: "صياغة تواصل مخصّص", tr: "Kişiselleştirilmiş ulaşım taslağı" },
      ],
      currentStep: 1,
    },
  ],
  nudge: {
    id: "s.n.recital",
    title: { en: "Layan's recital — Thursday 6pm", ar: "حفلة ليان — الخميس 6 مساءً", tr: "Layan'ın konseri — Perşembe 18:00" },
    body: {
      en: "Your daughter Layan's recital is Thursday at 6pm. I've blocked your calendar 5–8pm and pre-selected three local florists (one with vegan options because your mother-in-law is coming). Want me to order from the closest one, Dh 180?",
      ar: "حفلة ابنتك ليان الخميس 6 مساءً. حجزت تقويمك 5-8 مساءً واخترت ثلاثة محلات زهور محلية (واحد بخيارات نباتية لأن حماتك قادمة). أطلب من الأقرب، 180 درهم؟",
      tr: "Kızınız Layan'ın konseri Perşembe 18:00'de. Takviminizi 17:00–20:00 arası blokladım ve üç yerel çiçekçi seçtim (biri vegan seçenekli çünkü kayınvalideniz geliyor). En yakındakinden sipariş vereyim mi, 180 Dh?",
    },
    citedNodeIds: ["s.per.layan", "s.per.recital", "s.pref.maya-vegetarian"],
    scope: "personal",
  },
  proactive: {
    message: {
      en: "I noticed Maya at ACME just posted on LinkedIn about their new EU rollout — want me to draft a congratulatory note that ties back to last week's pricing conversation?",
      ar: "لاحظت أن مايا في ACME نشرت للتو على LinkedIn عن إطلاقها الأوروبي الجديد — أصوغ رسالة تهنئة تربطها بمحادثة التسعير الأسبوع الماضي؟",
      tr: "ACME'den Maya'nın yeni AB lansmanı hakkında LinkedIn'de paylaşım yaptığını fark ettim — geçen haftaki fiyat konuşmasına bağlanan bir tebrik notu taslağı hazırlayayım mı?",
    },
    citedNodeIds: ["s.r.maya", "s.p.acme-eu", "s.p.acme-pricing"],
    followupDraft: {
      en: "Maya — saw the EU rollout news on LinkedIn. Congratulations to your team. It threads neatly into last week's pricing conversation: the cloud-native package we discussed maps directly to a multi-region rollout. Worth 20 minutes Tuesday to walk you through how Sara's redline points already cover it. M.",
      ar: "مايا — رأيت خبر الإطلاق الأوروبي على LinkedIn. تهانينا لفريقك. يرتبط بشكل أنيق بمحادثة التسعير الأسبوع الماضي: حزمة السحابة الأصلية التي ناقشناها تنطبق مباشرة على إطلاق متعدد المناطق. يستحق 20 دقيقة الثلاثاء لأشرح لك كيف تغطّي مراجعات سارة ذلك بالفعل. M.",
      tr: "Maya — AB lansman haberini LinkedIn'de gördüm. Ekibinize tebrikler. Geçen haftaki fiyat konuşmasına güzel bağlanıyor: konuştuğumuz bulut-tabanlı paket çok-bölgeli lansmana doğrudan eşleniyor. Sara'nın red-line noktalarının bunu nasıl zaten kapsadığını size anlatmak için Salı 20 dakika değer. M.",
    },
  },
};

const HR_COCKPIT: CockpitSeed = {
  learnings: [
    {
      id: "h.l.1",
      text: { en: "Three engineers asked Slack about the new sabbatical policy in the last hour — drafted a one-page FAQ from the policy doc.", ar: "سأل ثلاثة مهندسين في Slack عن سياسة الإجازة الجديدة خلال الساعة الماضية — صيغ FAQ من صفحة واحدة من وثيقة السياسة.", tr: "Üç mühendis son bir saatte Slack'te yeni sabbatical politikası hakkında sordu — politika belgesinden tek-sayfalık SSS taslağı hazırlandı." },
      source: { en: "From #eng-talk Slack channel, last hour", ar: "من قناة #eng-talk في Slack، الساعة الماضية", tr: "#eng-talk Slack kanalından, son saat" },
      citedNodeIds: ["h.dom.policy-sabbatical", "h.t.slack"],
      agoMinutes: 35,
    },
    {
      id: "h.l.2",
      text: { en: "Sami (ML lead) seems to be quietly considering a sabbatical — flagged based on 1:1 transcript sentiment.", ar: "يبدو أن سامي (قائد ML) يفكر بهدوء في إجازة طويلة — أُشير إليه بناءً على مشاعر نص اللقاء.", tr: "Sami (ML lideri) sessizce bir sabbatical düşünüyor gibi — 1:1 transkript duygusuna dayalı işaretlendi." },
      source: { en: "From your 1:1 with Sami yesterday, transcript", ar: "من لقائك الفردي مع سامي أمس، النص", tr: "Dün Sami ile 1:1'inizden, transkript" },
      citedNodeIds: ["h.r.lead.sami", "h.dom.policy-sabbatical"],
      agoMinutes: 90,
    },
    {
      id: "h.l.3",
      text: { en: "Maria's visa renewal moved to 'pending legal review' — added watch.", ar: "انتقل تجديد تأشيرة ماريا إلى 'بانتظار المراجعة القانونية' — أُضيفت متابعة.", tr: "Maria'nın vize yenilemesi 'hukuki inceleme bekliyor'a geçti — izleme eklendi." },
      source: { en: "ServiceNow case update, 3h ago", ar: "تحديث حالة ServiceNow، منذ 3 ساعات", tr: "ServiceNow vaka güncellemesi, 3 saat önce" },
      citedNodeIds: ["h.r.case.visa.maria"],
      agoMinutes: 180,
    },
  ],
  pending: [
    {
      id: "h.p.sabbatical-faq",
      title: { en: "Sabbatical policy FAQ + office hours", ar: "أسئلة شائعة عن سياسة الإجازة + ساعات مكتبية", tr: "Sabbatical politikası SSS + ofis saatleri" },
      preview: { en: "1-page FAQ ready + 15-min office hours slot tomorrow at 2pm.", ar: "FAQ صفحة واحدة جاهز + ساعة مكتب 15 دقيقة غداً 2 مساءً.", tr: "Tek-sayfalık SSS hazır + yarın 14:00'te 15 dakikalık ofis saatleri slotu." },
      body: {
        en: "**Sabbatical policy v2 — quick FAQ**\n\n1. Who is eligible? Any engineer with 4+ continuous years of tenure.\n2. How long can I take? 4 to 12 weeks; longer requires VP signoff.\n3. Does it affect my comp band? No — your band freezes during sabbatical and resumes on return.\n4. How do I apply? Open a ServiceNow HR ticket tagged #sabbatical with your manager looped in.\n5. What about my project? You and your manager pre-agree a coverage plan as part of the application.\n\nOpen office hours: tomorrow 2:00–2:15pm in #eng-talk huddle. Bring questions.",
        ar: "**سياسة الإجازة الطويلة v2 — أسئلة شائعة**\n\n1. من المؤهل؟ أي مهندس بمدة خدمة مستمرة 4+ سنوات.\n2. كم المدة؟ 4 إلى 12 أسبوعاً؛ الأطول يتطلب موافقة نائب الرئيس.\n3. هل تؤثر على حدّي التعويضي؟ لا — يُجمَّد حدّك أثناء الإجازة ويستأنف عند العودة.\n4. كيف أتقدم؟ افتح تذكرة ServiceNow HR مع وسم #sabbatical مع تضمين مديرك.\n5. ماذا عن مشروعي؟ توافق أنت ومديرك مسبقاً على خطة تغطية كجزء من الطلب.\n\nساعات مكتبية مفتوحة: غداً 2:00-2:15 مساءً في #eng-talk. أحضر الأسئلة.",
        tr: "**Sabbatical politikası v2 — hızlı SSS**\n\n1. Kimler uygun? 4+ yıl kesintisiz görev süresi olan herhangi bir mühendis.\n2. Ne kadar süre alabilirim? 4 ila 12 hafta; daha uzunu Başkan Yrd. onayı gerektirir.\n3. Ücret bandımı etkiler mi? Hayır — bandınız sabbatical sırasında dondurulur ve dönüşte devam eder.\n4. Nasıl başvururum? #sabbatical etiketiyle bir ServiceNow HR bileti açın, yöneticinizi de ekleyin.\n5. Projem ne olacak? Siz ve yöneticiniz başvurunun bir parçası olarak bir kapsama planı üzerinde önceden anlaşırsınız.\n\nAçık ofis saatleri: yarın 14:00–14:15 #eng-talk huddle. Sorularınızı getirin.",
      },
      source: { en: "Drafted from policy doc + 3 Slack questions + Sami's 1:1 sentiment", ar: "صيغت من وثيقة السياسة + 3 أسئلة Slack + مشاعر لقاء سامي", tr: "Politika belgesi + 3 Slack sorusu + Sami'nin 1:1 duygusundan taslakla hazırlandı" },
      autonomyLevel: "L3",
      citedNodeIds: ["h.dom.policy-sabbatical", "h.t.slack", "h.r.lead.sami", "h.comm.style"],
      estTimeSavedMin: 28,
      kind: "faq",
    },
    {
      id: "h.p.offer-letter-mobile",
      title: { en: "Offer letter — Senior Mobile Engineer (Ji's req)", ar: "خطاب عرض — مهندس موبايل أول (طلب جي)", tr: "Teklif mektubu — Kıdemli Mobil Mühendis (Ji'nin talebi)" },
      preview: { en: "Drafted at L4 mid-band. Cites comp bands, Ji's hiring brief, and standard relocation clause.", ar: "صيغت في منتصف نطاق L4. تستشهد بحدود التعويض، موجز توظيف جي، وبند الانتقال القياسي.", tr: "L4 bandının ortasında taslak hazırlandı. Ücret bantlarına, Ji'nin işe alım brifingine ve standart taşınma maddesine atıfta bulunur." },
      body: { en: "Dear [Candidate],\n\nWe are pleased to offer you the position of Senior Mobile Engineer with Northwind, reporting to Ji.\n\nBase: AED 540,000 / year (L4 mid-band, see comp bands FY26).\nEquity: 18,000 RSUs vesting over 4 years.\nRelocation: standard package per relocation policy v3.\nStart date: to be agreed.\n\nThis offer is contingent on background checks and signed acceptance within 7 days.\n\nWelcome to Northwind.", ar: "عزيزي [المرشّح]،\n\nيسرّنا أن نعرض عليك منصب مهندس موبايل أول لدى نورثويند، تتبع لـ جي.\n\nالأساسي: 540,000 درهم/السنة (منتصف نطاق L4، انظر حدود التعويض FY26).\nالأسهم: 18,000 RSU بنضوج 4 سنوات.\nالانتقال: حزمة قياسية وفق سياسة الانتقال v3.\nتاريخ البدء: للتوافق.\n\nالعرض مشروط بفحص الخلفية والقبول الموقّع خلال 7 أيام.\n\nمرحباً بك في نورثويند.", tr: "Sayın [Aday],\n\nNorthwind'de Ji'ye bağlı Kıdemli Mobil Mühendis pozisyonunu size sunmaktan memnuniyet duyarız.\n\nTaban: 540.000 AED/yıl (L4 orta-bant, FY26 ücret bantlarına bakın).\nHisse: 4 yıl üzerinde hak ediş 18.000 RSU.\nTaşınma: taşınma politikası v3'e göre standart paket.\nBaşlangıç tarihi: kararlaştırılacak.\n\nBu teklif, arka plan kontrollerine ve 7 gün içinde imzalı kabule bağlıdır.\n\nNorthwind'e hoş geldiniz." },
      source: { en: "Comp bands FY26 + Ji's req intake notes + relocation policy v3", ar: "حدود التعويض FY26 + ملاحظات استلام طلب جي + سياسة الانتقال v3", tr: "FY26 ücret bantları + Ji'nin talep notları + taşınma politikası v3" },
      autonomyLevel: "L2",
      citedNodeIds: ["h.dom.policy-comp", "h.r.lead.ji", "h.r.ahmet"],
      estTimeSavedMin: 35,
      kind: "offer-letter",
    },
    {
      id: "h.p.priya-brief",
      title: { en: "Async brief for Priya — engineering health weekly", ar: "موجز غير متزامن لبريا — صحة الهندسة الأسبوعية", tr: "Priya için async brifing — haftalık mühendislik sağlığı" },
      preview: { en: "Bullet brief: 14 reqs, 3 hot cases, 2 sentiment flags.", ar: "موجز نقطي: 14 طلباً، 3 حالات ساخنة، تنبيهان مشاعر.", tr: "Madde brifing: 14 talep, 3 sıcak vaka, 2 duygu işareti." },
      body: { en: "**Eng health — week of [date]**\n  • Hiring funnel: 14 open / 6 in offer / 3 onboarding\n  • Hot cases: Maria visa (legal review), Ali relocation (signed), Sami (sentiment, no action yet)\n  • Sentiment flags: Dina's SRE team — on-call burnout signal in Slack; Fatma's flex schedule going well\n  • Sabbatical FAQ shipping today; office hours tomorrow 2pm\n\nY. — HRBP", ar: "**صحة الهندسة — أسبوع [التاريخ]**\n  • قمع التوظيف: 14 مفتوحة / 6 في العرض / 3 في التهيئة\n  • حالات ساخنة: تأشيرة ماريا (مراجعة قانونية)، انتقال علي (وُقّع)، سامي (مشاعر، لا إجراء بعد)\n  • تنبيهات مشاعر: فريق SRE لدى دينا — إشارة إرهاق المناوبة في Slack؛ جدول فطمة المرن يسير جيداً\n  • FAQ الإجازة يُنشر اليوم؛ ساعات مكتبية غداً 2 مساءً\n\nY. — HRBP", tr: "**Müh. sağlığı — [tarih] haftası**\n  • İşe alım hunisi: 14 açık / 6 teklifte / 3 oryantasyonda\n  • Sıcak vakalar: Maria vize (hukuki inceleme), Ali taşınma (imzalandı), Sami (duygu, henüz eylem yok)\n  • Duygu işaretleri: Dina'nın SRE ekibi — Slack'te çağrı-bekleme tükenmişlik sinyali; Fatma'nın esnek programı iyi gidiyor\n  • Sabbatical SSS bugün gönderiliyor; ofis saatleri yarın 14:00\n\nY. — HRBP" },
      source: { en: "Greenhouse + ServiceNow + Slack sentiment + your 1:1 notes", ar: "Greenhouse + ServiceNow + مشاعر Slack + ملاحظات لقاءاتك", tr: "Greenhouse + ServiceNow + Slack duygusu + 1:1 notlarınız" },
      autonomyLevel: "L3",
      citedNodeIds: ["h.r.priya", "h.p.q4-hiring", "h.r.case.visa.maria", "h.r.lead.dina", "h.comm.style"],
      estTimeSavedMin: 22,
      kind: "brief",
    },
  ],
  inProgress: [
    {
      id: "h.ip.case-relo",
      title: { en: "Ali's relocation — coordinating logistics", ar: "انتقال علي — تنسيق اللوجستيات", tr: "Ali'nin taşınması — lojistik koordinasyonu" },
      steps: [
        { en: "Confirmed offer, signed acceptance", ar: "تأكّد العرض، تمّ التوقيع", tr: "Teklif onaylandı, imzalı kabul" },
        { en: "Visa application initiated", ar: "بدأ طلب التأشيرة", tr: "Vize başvurusu başlatıldı" },
        { en: "Apartment search shortlist (3 options)", ar: "قائمة قصيرة لبحث الشقة (3 خيارات)", tr: "Daire arama kısa listesi (3 seçenek)" },
        { en: "Schedule arrival logistics", ar: "جدولة لوجستيات الوصول", tr: "Varış lojistiğini planla" },
      ],
      currentStep: 2,
    },
    {
      id: "h.ip.promo-ji",
      title: { en: "Ji's promotion packet — drafting", ar: "حزمة ترقية جي — جارٍ الصياغة", tr: "Ji'nin terfi paketi — taslak" },
      steps: [
        { en: "Pulled performance reviews + 360s", ar: "سحبت مراجعات الأداء + 360", tr: "Performans incelemeleri + 360'lar çekildi" },
        { en: "Drafting impact narrative", ar: "صياغة سرد الأثر", tr: "Etki anlatısı taslağı" },
        { en: "Awaiting Priya's calibration input", ar: "بانتظار مدخلات معايرة بريا", tr: "Priya'nın kalibrasyon girdisi bekleniyor" },
      ],
      currentStep: 1,
    },
  ],
  nudge: {
    id: "h.n.toast",
    title: { en: "Mom's 70th — draft a toast?", ar: "ميلاد الأم 70 — صياغة كلمة؟", tr: "Annenin 70'i — bir konuşma taslağı?" },
    body: {
      en: "Your mother's 70th is in 3 weeks. I noticed your sister proposed a surprise dinner in your family group last night. Want me to draft a short toast based on the stories you've shared in past calls — the Istanbul summer, the cat she rescued, the sabbatical advice she gave you?",
      ar: "ميلاد والدتك 70 خلال 3 أسابيع. لاحظت أن أختك اقترحت عشاء مفاجأة في مجموعة عائلتك ليلة أمس. أصوغ كلمة قصيرة بناءً على القصص التي شاركتها في لقاءات سابقة — صيف اسطنبول، القط الذي أنقذته، نصيحة الإجازة التي قدمتها لك؟",
      tr: "Annenizin 70'i 3 hafta sonra. Kardeşinizin dün gece aile grubunuzda sürpriz bir yemek önerdiğini fark ettim. Geçmiş görüşmelerde paylaştığınız hikâyelere dayalı kısa bir konuşma taslağı hazırlayayım mı — İstanbul yazı, kurtardığı kedi, size verdiği sabbatical tavsiyesi?",
    },
    citedNodeIds: ["h.per.mom-70", "h.per.toast-stories"],
    scope: "personal",
  },
  proactive: {
    message: {
      en: "Three more engineers DM'd me about sabbaticals after the FAQ went out — want me to upgrade the office-hours slot from 15 minutes to 30, and invite Sami's manager to the second half?",
      ar: "ثلاثة مهندسين آخرين راسلوني عن الإجازة بعد نشر FAQ — أرفع موعد الساعات المكتبية من 15 دقيقة إلى 30، وأدعو مدير سامي للنصف الثاني؟",
      tr: "SSS yayınlandıktan sonra üç mühendis daha sabbatical hakkında bana DM attı — ofis saatleri slotunu 15 dakikadan 30'a yükseltip Sami'nin yöneticisini ikinci yarıya davet edeyim mi?",
    },
    citedNodeIds: ["h.dom.policy-sabbatical", "h.r.lead.sami", "h.t.slack"],
    followupDraft: {
      en: "Hi all — based on the volume of questions today I've extended tomorrow's sabbatical office hours to 30 minutes (2:00–2:30pm). I've also invited Priya for the last 10 minutes for the team-coverage questions that came up. Y. — HRBP",
      ar: "مرحباً جميعاً — بناءً على حجم الأسئلة اليوم، مدّدت ساعات مكتب الإجازة غداً إلى 30 دقيقة (2:00-2:30 مساءً). دعوت أيضاً بريا للـ 10 دقائق الأخيرة لأسئلة تغطية الفريق. Y. — HRBP",
      tr: "Merhaba — bugünün soru hacmine bağlı olarak yarınki sabbatical ofis saatlerini 30 dakikaya uzattım (14:00–14:30). Çıkan ekip-kapsama soruları için Priya'yı da son 10 dakikaya davet ettim. Y. — HRBP",
    },
  },
};

// ─── Live workday scripts (for Mind play) ────────────────────────────────
const SALES_LIVE_WORKDAY: LiveWorkdayEvent[] = [
  { at: "10:14", text: { en: "Observed meeting with Sara Park (ACME) → confirmed reports_to Maya", ar: "لوحظ اجتماع مع سارة بارك (ACME) → تأكيد reports_to لمايا", tr: "Sara Park (ACME) ile toplantı gözlendi → reports_to Maya doğrulandı" }, touchedNodeIds: ["s.r.sara", "s.r.maya"] },
  { at: "10:42", text: { en: "Extracted entity 'Sara Park (Procurement Lead at ACME)' (confidence 0.91, source: meeting transcript)", ar: "استُخرج كيان 'سارة بارك (مديرة المشتريات في ACME)' (ثقة 0.91، مصدر: نص الاجتماع)", tr: "'Sara Park (ACME Tedarik Lideri)' varlığı çıkarıldı (güven 0,91, kaynak: toplantı transkripti)" }, touchedNodeIds: ["s.r.sara"] },
  { at: "11:03", text: { en: "Maya posted on LinkedIn about the EU rollout — added signal to ACME EU project node", ar: "نشرت مايا على LinkedIn عن الإطلاق الأوروبي — أُضيفت إشارة لعقدة مشروع ACME EU", tr: "Maya AB lansmanı hakkında LinkedIn'de paylaşım yaptı — ACME AB proje düğümüne sinyal eklendi" }, touchedNodeIds: ["s.r.maya", "s.p.acme-eu"] },
  { at: "11:31", text: { en: "Drafted follow-up to Maya, cited 5 PCG nodes, queued for approval", ar: "صياغة متابعة لمايا، استشهد بـ 5 عقد، بانتظار الموافقة", tr: "Maya'ya takip taslağı, 5 PCG düğümü alıntılandı, onay için sıraya alındı" }, touchedNodeIds: ["s.r.maya", "s.p.acme-pricing", "s.r.sara", "s.comm.style", "s.pref.maya-bcc"] },
  { at: "11:47", text: { en: "Approved → sent to Maya at 11:47, BCC kc@acme as preference dictates. Receipt logged.", ar: "تمت الموافقة → أُرسل إلى مايا 11:47، BCC kc@acme حسب التفضيل. سُجّل الإيصال.", tr: "Onaylandı → 11:47'de Maya'ya gönderildi, tercih gereği BCC kc@acme. Makbuz kaydedildi." }, touchedNodeIds: ["s.pref.maya-bcc"] },
  { at: "12:09", text: { en: "Calendar pattern reinforced — 7th successful Tuesday lunch acceptance from Maya. Confidence on preference up.", ar: "تعزّز نمط التقويم — قبول غداء الثلاثاء السابع من مايا. ارتفعت الثقة.", tr: "Takvim deseni pekiştirildi — Maya'dan 7. başarılı Salı öğle yemeği kabulü. Tercih güveni arttı." }, touchedNodeIds: ["s.pref.maya-tuesday"] },
  { at: "13:05", text: { en: "Personal: scheduled florist callback for Layan's recital — reminder set", ar: "شخصي: حجزت معاودة اتصال محل الزهور لحفلة ليان — تم تعيين التذكير", tr: "Kişisel: Layan'ın konseri için çiçekçi geri-arama planlandı — hatırlatıcı ayarlandı" }, touchedNodeIds: ["s.per.recital", "s.per.layan"] },
];

const HR_LIVE_WORKDAY: LiveWorkdayEvent[] = [
  { at: "09:22", text: { en: "Detected 3rd Slack question about sabbatical policy in 60 min — pattern flagged", ar: "كشف عن 3 أسئلة Slack حول سياسة الإجازة في 60 دقيقة — أُبلغ عن نمط", tr: "60 dakikada sabbatical politikası hakkında 3. Slack sorusu tespit edildi — desen işaretlendi" }, touchedNodeIds: ["h.t.slack", "h.dom.policy-sabbatical"] },
  { at: "09:38", text: { en: "Drafted one-page sabbatical FAQ from policy doc; cited 4 PCG nodes", ar: "صيغ FAQ صفحة واحدة عن الإجازة من وثيقة السياسة؛ استشهد بـ 4 عقد", tr: "Politika belgesinden tek-sayfalık sabbatical SSS taslağı; 4 PCG düğümü alıntılandı" }, touchedNodeIds: ["h.dom.policy-sabbatical", "h.t.slack", "h.r.lead.sami", "h.comm.style"] },
  { at: "09:51", text: { en: "Booked office-hours slot tomorrow 2:00–2:15pm in #eng-talk huddle", ar: "حُجز موعد ساعات مكتبية غداً 2:00-2:15 مساءً في #eng-talk", tr: "Yarın 14:00–14:15 #eng-talk huddle'da ofis saatleri ayarlandı" }, touchedNodeIds: ["h.t.slack"] },
  { at: "10:17", text: { en: "Updated Maria's visa case — moved 'pending legal review'; added watch", ar: "حُدّثت حالة تأشيرة ماريا — انتقلت إلى 'بانتظار المراجعة القانونية'؛ أُضيفت متابعة", tr: "Maria'nın vize vakası güncellendi — 'hukuki inceleme bekliyor'a taşındı; izleme eklendi" }, touchedNodeIds: ["h.r.case.visa.maria", "h.t.servicenow"] },
  { at: "10:48", text: { en: "Drafted Senior Mobile Engineer offer letter for Ji's req — comp band L4 mid", ar: "صيغ خطاب عرض مهندس موبايل أول لطلب جي — منتصف نطاق L4", tr: "Ji'nin talebi için Kıdemli Mobil Mühendis teklif mektubu taslağı — L4 orta bandı" }, touchedNodeIds: ["h.dom.policy-comp", "h.r.lead.ji", "h.r.ahmet"] },
  { at: "11:30", text: { en: "Drafted async weekly brief for Priya — 3 hot cases, 2 sentiment flags", ar: "صيغ موجز غير متزامن أسبوعي لبريا — 3 حالات ساخنة، تنبيهان مشاعر", tr: "Priya için async haftalık brifing taslağı — 3 sıcak vaka, 2 duygu işareti" }, touchedNodeIds: ["h.r.priya", "h.p.q4-hiring", "h.r.case.visa.maria", "h.r.lead.dina", "h.comm.style"] },
  { at: "12:14", text: { en: "Personal: noticed sister's family-group message about mom's 70th — drafted toast option", ar: "شخصي: لاحظ رسالة الأخت في العائلة عن ميلاد الأم 70 — صيغ خيار كلمة", tr: "Kişisel: kardeşin annenin 70'i hakkında aile-grubu mesajı fark edildi — konuşma seçeneği taslağı" }, touchedNodeIds: ["h.per.mom-70", "h.per.toast-stories"] },
];

// ─── JSON-LD export samples ──────────────────────────────────────────────
function exportPayloadFor(personaId: "sales" | "hr", nodes: PCGNode[], edges: PCGEdge[]): object {
  return {
    "@context": "https://cognirise.com/pcg/v1",
    "@type": "PersonalContextGraph",
    employee: personaId === "sales" ? "mariam.al-hashimi@employee.cognirise.com" : "yusuf.demir@employee.cognirise.com",
    exportedAt: "2026-05-04T12:00:00Z",
    agentVersion: "atlas-1.4.2 / ember-1.4.2",
    portability: {
      ownership: "employee",
      portable: true,
      revocableByEmployer: false,
    },
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: nodes.map((nd) => ({
      "@id": `pcg:${nd.id}`,
      "@type": `pcg:${nd.category}`,
      label: nd.label.en,
      scope: nd.scope,
      confidence: nd.confidence,
      learnedAt: nd.learnedAt,
      useCount: nd.useCount,
      provenance: { source: nd.source.en },
    })),
    edges: edges.map((e) => ({
      from: `pcg:${e.from}`,
      to: `pcg:${e.to}`,
      kind: e.kind,
      strength: e.strength,
      learnedAt: e.learnedAt,
    })),
  };
}

// ─── Personas ────────────────────────────────────────────────────────────
export const PERSONAS: Persona[] = [
  {
    id: "sales",
    agentName: "Atlas",
    personName: { en: "Mariam Al-Hashimi", ar: "مريم الهاشمي", tr: "Mariam Al-Hashimi" },
    role: { en: "Senior Account Executive · Northwind Cloud", ar: "مدير حسابات أول · نورثويند كلاود", tr: "Kıdemli Müşteri Yöneticisi · Northwind Cloud" },
    company: { en: "Northwind Cloud · MENA Enterprise", ar: "نورثويند كلاود · مؤسسات MENA", tr: "Northwind Cloud · MENA Kurumsal" },
    accent: "#a78bfa",
    copresence: { en: "Atlas is observing your day · 3 new learnings", ar: "أطلس يراقب يومك · 3 ملاحظات جديدة", tr: "Atlas gününüzü gözlüyor · 3 yeni öğrenme" },
    starterPrompts: [
      { en: "What's on my plate today?", ar: "ما المهام أمامي اليوم؟", tr: "Bugün önümde ne var?" },
      { en: "Draft a follow-up to Maya at ACME", ar: "صغ متابعة لمايا في ACME", tr: "ACME'deki Maya'ya takip taslakla" },
      { en: "Brief me on Priya at Emaar before the 3pm", ar: "أعطني موجزاً عن بريا في إعمار قبل اجتماع الـ 3 مساءً", tr: "15:00'ten önce Emaar'dan Priya hakkında brifing ver" },
      { en: "Do I know anyone at TechCorp?", ar: "هل أعرف أحداً في TechCorp؟", tr: "TechCorp'ta tanıdığım var mı?" },
      { en: "What did Maya say about pricing last week?", ar: "ماذا قالت مايا عن التسعير الأسبوع الماضي؟", tr: "Maya geçen hafta fiyatlandırma hakkında ne dedi?" },
      { en: "Prep for the ACME QBR", ar: "تجهيز لـ ACME QBR", tr: "ACME QBR için hazırlık" },
    ],
    pcg: { nodes: SALES_NODES, edges: SALES_EDGES },
    cockpit: SALES_COCKPIT,
    liveWorkday: SALES_LIVE_WORKDAY,
    systemPromptIntro: "You are Atlas, the Personal Agent for Mariam Al-Hashimi (Senior AE at Northwind Cloud, MENA region). Mariam writes short emails with three options and signs 'M.' Match that voice in any draft. Ground every answer strictly in the Personal Context Graph nodes provided below — if the answer is not supported by the nodes, say so honestly and propose the next step.",
    exportPayload: exportPayloadFor("sales", SALES_NODES, SALES_EDGES),
  },
  {
    id: "hr",
    agentName: "Ember",
    personName: { en: "Yusuf Demir", ar: "يوسف ديمير", tr: "Yusuf Demir" },
    role: { en: "HR Business Partner — Engineering · Northwind", ar: "شريك أعمال موارد بشرية — الهندسة · نورثويند", tr: "İK İş Ortağı — Mühendislik · Northwind" },
    company: { en: "Northwind · Engineering org (200 engineers)", ar: "نورثويند · منظمة الهندسة (200 مهندس)", tr: "Northwind · Mühendislik organizasyonu (200 mühendis)" },
    accent: "#fb923c",
    copresence: { en: "Ember is observing · 2 new learnings", ar: "إمبر تراقب · ملاحظتان جديدتان", tr: "Ember gözlüyor · 2 yeni öğrenme" },
    starterPrompts: [
      { en: "What did anyone ask about the sabbatical policy today?", ar: "من سأل عن سياسة الإجازة اليوم؟", tr: "Bugün sabbatical politikası hakkında kim ne sordu?" },
      { en: "Draft an offer letter for Ji's mobile req", ar: "صغ خطاب عرض لطلب جي للموبايل", tr: "Ji'nin mobil talebi için teklif mektubu taslakla" },
      { en: "Brief Priya for our Friday async", ar: "موجز لبريا قبل أسبوعنا الجمعة", tr: "Cuma async'imiz için Priya'ya brifing" },
      { en: "Where are we on Maria's visa?", ar: "أين نحن من تأشيرة ماريا؟", tr: "Maria'nın vizesinde nerede kaldık?" },
      { en: "Any sentiment flags in engineering this week?", ar: "أي تنبيهات مشاعر في الهندسة هذا الأسبوع؟", tr: "Bu hafta mühendislikte duygu işaretleri var mı?" },
      { en: "Help me prep Ji's promo packet", ar: "ساعدني في تجهيز حزمة ترقية جي", tr: "Ji'nin terfi paketini hazırlamama yardım et" },
    ],
    pcg: { nodes: HR_NODES, edges: HR_EDGES },
    cockpit: HR_COCKPIT,
    liveWorkday: HR_LIVE_WORKDAY,
    systemPromptIntro: "You are Ember, the Personal Agent for Yusuf Demir (HR Business Partner for Engineering at Northwind). Yusuf prefers bullet-pointed briefings and signs 'Y. — HRBP'. Match that voice in any draft. Ground every answer strictly in the Personal Context Graph nodes provided below — if the answer is not supported by the nodes, say so honestly and propose the next step.",
    exportPayload: exportPayloadFor("hr", HR_NODES, HR_EDGES),
  },
];

export function getPersona(id: Persona["id"]): Persona {
  const p = PERSONAS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown persona: ${id}`);
  return p;
}

/** Visible nodes / edges up to the given milestone (inclusive). */
export function pcgAt(persona: Persona, upTo: PCGMilestone): { nodes: PCGNode[]; edges: PCGEdge[] } {
  const order: Record<PCGMilestone, number> = { day1: 0, week1: 1, month1: 2, month6: 3, year1: 4 };
  const cap = order[upTo];
  const nodes = persona.pcg.nodes.filter((n) => order[n.learnedAt] <= cap);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = persona.pcg.edges.filter((e) => order[e.learnedAt] <= cap && ids.has(e.from) && ids.has(e.to));
  return { nodes, edges };
}

/** Tiny keyword retriever used by the Cockpit chat to build the grounding bundle. */
export function retrieveContext(persona: Persona, query: string, limit = 8): PCGNode[] {
  const q = query.toLowerCase();
  if (!q.trim()) return [];
  const scored = persona.pcg.nodes.map((n) => {
    const hay = `${n.label.en} ${n.description.en}`.toLowerCase();
    let s = 0;
    for (const term of q.split(/\s+/).filter((t) => t.length > 2)) {
      if (hay.includes(term)) s += 2;
    }
    s += n.confidence * 0.3 + Math.min(n.useCount, 20) * 0.05;
    return { n, s };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).filter((x) => x.s > 0.5).map((x) => x.n);
}

/** Render a system prompt for the Personal Agent chat, embedding the grounding bundle. */
export function buildSystemPrompt(persona: Persona, grounding: PCGNode[], lang: Lang): string {
  const langNote =
    lang === "ar"
      ? "Respond in modern standard Arabic (فصحى) unless the user writes in English/Turkish."
      : lang === "tr"
        ? "Respond in Turkish unless the user writes in English/Arabic."
        : "Respond in English unless the user writes in Arabic/Turkish.";
  const nodeLines = grounding.map((n) => `- [${n.category}, scope:${n.scope}, conf:${n.confidence.toFixed(2)}] ${n.label.en} — ${n.description.en} (id: ${n.id})`).join("\n");
  return `${persona.systemPromptIntro}

${langNote}

GROUNDING BUNDLE (the ONLY facts you may rely on for this turn):
${nodeLines || "(no relevant nodes — say so honestly and propose the next step)"}

RULES
1. Cite node ids in square brackets when you use them, e.g. "[s.r.maya]". This drives the live "Context used" rail in the UI.
2. Keep responses short — 2 to 4 short paragraphs maximum.
3. Never invent people, projects, deals, or numbers that are not in the grounding bundle.
4. End your answer with a single line in this exact format on its own line, nothing after it:
   <<<SUGGESTIONS>>>{"items":[]}<<<END>>>`;
}
