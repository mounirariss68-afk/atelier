import type { BiText } from "@/lib/sim/types";
import sovereignDataScenario from "@/lib/sim/scenarios/sovereign-data-steward";
import { DATA_PRODUCTS, productById, type DataProduct } from "./sovereign-data-seed";

export type Severity = "critical" | "high" | "medium" | "info";
export type RecStatus = "pending" | "approved" | "rejected" | "edited";

export interface ConsoleAgent { id: string; name: BiText; role: BiText; color: string; }

export const CONSOLE_AGENTS: ConsoleAgent[] = sovereignDataScenario.agents.map((a) => ({
  id: a.id, name: a.name, role: a.role, color: a.color ?? "#0A1230",
}));

export function consoleAgentById(id: string): ConsoleAgent | undefined {
  return CONSOLE_AGENTS.find((a) => a.id === id);
}

// Scenario checkpoints surfaced in the Approvals view
export interface ConsoleCheckpoint {
  id: string;
  human: BiText;
  question: BiText;
  rationale: BiText;
  options: { id: string; label: BiText; recommended?: boolean }[];
  recId: string;
}

export const CONSOLE_CHECKPOINTS: ConsoleCheckpoint[] = sovereignDataScenario.checkpoints.map((cp) => ({
  id: cp.id,
  human: cp.human,
  question: cp.question,
  rationale: cp.rationale,
  options: cp.options,
  recId: `rec-cp-${cp.id}`,
}));

export interface AgentRecommendation {
  id: string;
  agentId: string;
  productId: string;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: Severity;
  recommendedAction: BiText;
  alternateActions: BiText[];
  status: RecStatus;
  generatedAt: string;
  isCheckpoint?: boolean;
  checkpointHuman?: BiText;
}

export interface AgentAlert {
  id: string;
  agentId: string;
  productId: string;
  severity: Severity;
  title: BiText;
  detail: BiText;
  receivedAt: string;
}

export interface AuditEntry {
  id: string;
  agentId: string;
  productId: string;
  action: BiText;
  detail: BiText;
  timestamp: string;
}

const NOW = new Date("2026-05-04T11:54:00Z");
const isoHoursAgo = (h: number) => {
  const d = new Date(NOW);
  d.setHours(d.getHours() - h);
  return d.toISOString();
};

export function generateRecommendations(): AgentRecommendation[] {
  const out: AgentRecommendation[] = [];

  // Two checkpoint cards from the cockpit scenario
  out.push({
    id: "rec-cp-engineer-merge",
    agentId: "lineage",
    productId: "citizen-sentiment-dashboard",
    title: { en: "Merge Citizen Sentiment DAG (sink-2 stays blocked)", ar: "دمج مخطط مشاعر المواطنين (المصبّ الثاني محجوب)" },
    rationale: {
      en: "DAG: 4 sources → 6 transforms → 2 sinks. Lineage Compiler blocks sink-2 (Frankfurt BI partner) under PDPL Article 13. Sink-1 (in-Kingdom Looker) is allowed. Recommend merge with sink-2 left blocked.",
      ar: "المخطط: 4 مصادر → 6 تحويلات → 2 مصبّ. مسجّل النسب يحجب الثاني وفق المادة 13 PDPL. الأول مسموح. يُوصى بالدمج مع الإبقاء على الحجب.",
    },
    confidence: 96, severity: "critical",
    recommendedAction: { en: "Merge — sink-2 stays blocked", ar: "دمج — المصبّ الثاني محجوب" },
    alternateActions: [
      { en: "Request residency exception for sink-2", ar: "طلب استثناء إقامة" },
      { en: "Send back — re-design pipeline", ar: "إعادة التصميم" },
    ],
    status: "pending", generatedAt: isoHoursAgo(2),
    isCheckpoint: true, checkpointHuman: { en: "Data Engineer", ar: "مهندس البيانات" },
  });

  out.push({
    id: "rec-cp-owner-sign",
    agentId: "contract",
    productId: "citizen-sentiment-dashboard",
    title: { en: "Sign quality contract & publish data product", ar: "توقيع عقد الجودة ونشر المنتج" },
    rationale: {
      en: "Contract: 15-min refresh, sensitive · citizen-PII, 90 days hot / 2 years archive, in-Kingdom only, 99% completeness. Aligned with NDMO 3.1 + SDAIA AI-G 12. Recommend sign.",
      ar: "العقد: 15 دقيقة، حسّاس، 90 يوماً حار وسنتان أرشيف، داخل المملكة، اكتمال 99%. مطابق لـ NDMO 3.1 وSDAIA AI-G 12.",
    },
    confidence: 93, severity: "high",
    recommendedAction: { en: "Sign & publish", ar: "توقيع ونشر" },
    alternateActions: [
      { en: "Tighten SLA to 99.5%, then publish", ar: "رفع SLA إلى 99.5% ثم النشر" },
    ],
    status: "pending", generatedAt: isoHoursAgo(1),
    isCheckpoint: true, checkpointHuman: { en: "Data Owner (Ministry CX)", ar: "مالك البيانات (CX)" },
  });

  // Derived recommendations across the catalogue
  out.push({
    id: "rec-d-001",
    agentId: "ner",
    productId: "telemed-utilization",
    title: { en: "Refresh PII tags on Telemedicine Utilization", ar: "تحديث وسوم PII على الطب عن بُعد" },
    rationale: { en: "Arabic NER detected 6.2% PII density; current classification 'draft' lacks PII tagging required by NDMO 5.4.", ar: "كثافة PII 6.2%؛ التصنيف الحالي يفتقد الوسم وفق NDMO 5.4." },
    confidence: 88, severity: "high",
    recommendedAction: { en: "Apply 'sensitive' classification + tag 14 PII columns", ar: "تطبيق 'حسّاس' ووسم 14 عموداً" },
    alternateActions: [{ en: "Defer — request manual review", ar: "تأجيل — مراجعة بشرية" }],
    status: "pending", generatedAt: isoHoursAgo(5),
  });

  out.push({
    id: "rec-d-002",
    agentId: "lineage",
    productId: "iam-events",
    title: { en: "Block IAM Event Stream until residency proven", ar: "حجب تدفق الهوية حتى إثبات الإقامة" },
    rationale: { en: "Lineage gap on 4 of 12 PDPL controls. Until column-level lineage closes, sinks remain blocked.", ar: "ثغرة على 4 من 12 ضابط PDPL. تبقى المصبّات محجوبة." },
    confidence: 92, severity: "critical",
    recommendedAction: { en: "Keep blocked + open lineage sprint", ar: "الإبقاء على الحجب + موجة نسب" },
    alternateActions: [{ en: "Override block (requires CDO + DPO)", ar: "تجاوز الحجب (يتطلب CDO + DPO)" }],
    status: "pending", generatedAt: isoHoursAgo(8),
  });

  out.push({
    id: "rec-d-003",
    agentId: "schema",
    productId: "logistics-corridor",
    title: { en: "Re-profile Logistics Corridor schemas", ar: "إعادة تحليل بنية الممر اللوجستي" },
    rationale: { en: "Schema drift detected on 3 sources; lineage coverage dropped to 62%. Reprofile and refresh transforms.", ar: "انحراف بنية على 3 مصادر؛ النسب 62%. إعادة التحليل." },
    confidence: 79, severity: "medium",
    recommendedAction: { en: "Schedule re-profile run tonight", ar: "جدولة إعادة التحليل الليلة" },
    alternateActions: [{ en: "Wait for owner request", ar: "انتظار طلب المالك" }],
    status: "pending", generatedAt: isoHoursAgo(14),
  });

  out.push({
    id: "rec-d-004",
    agentId: "contract",
    productId: "embedding-vault",
    title: { en: "Draft quality contract for Embedding Vault", ar: "صياغة عقد الجودة لخزنة التضمينات" },
    rationale: { en: "Product is in draft for 6 weeks with no contract. SDAIA AI-G 12 requires contract before any reader gets access.", ar: "المنتج مسوّدة منذ 6 أسابيع دون عقد. SDAIA AI-G 12 تشترط ذلك." },
    confidence: 82, severity: "high",
    recommendedAction: { en: "Draft contract + route to Dr. Maha", ar: "صياغة العقد وإرسال للدكتورة مها" },
    alternateActions: [{ en: "Mark deprecated", ar: "تعليم مهمل" }],
    status: "pending", generatedAt: isoHoursAgo(20),
  });

  out.push({
    id: "rec-d-005",
    agentId: "orch",
    productId: "housing-applications",
    title: { en: "Retire Housing Applications Pipeline", ar: "سحب أنبوب طلبات الإسكان" },
    rationale: { en: "Deprecated 9 months; no consumer in last 90 days. Retire to free enclave compute.", ar: "مهمل 9 أشهر بلا مستهلك. السحب لتحرير الموارد." },
    confidence: 71, severity: "info",
    recommendedAction: { en: "Retire after 30-day grace period", ar: "السحب بعد مهلة 30 يوماً" },
    alternateActions: [{ en: "Keep for archival reference", ar: "الإبقاء للأرشفة" }],
    status: "approved", generatedAt: isoHoursAgo(36),
  });

  return out;
}

export function generateAlerts(): AgentAlert[] {
  return [
    {
      id: "a1", agentId: "lineage", productId: "citizen-sentiment-dashboard", severity: "critical",
      title: { en: "Sink-2 blocked under PDPL Article 13", ar: "المصبّ الثاني محجوب وفق المادة 13" },
      detail: { en: "Lineage Compiler refused publish to Frankfurt BI partner. Reason cited; awaiting engineer merge.", ar: "رفض مسجّل النسب النشر إلى فرانكفورت. البند مذكور؛ بانتظار دمج المهندس." },
      receivedAt: isoHoursAgo(2),
    },
    {
      id: "a2", agentId: "ner", productId: "telemed-utilization", severity: "high",
      title: { en: "PII density 6.2% — classification mismatch", ar: "كثافة PII 6.2% — تصنيف غير مطابق" },
      detail: { en: "Arabic NER tagged 14 PII columns; current draft lacks 'sensitive' classification.", ar: "وسمت الكيانات 14 عموداً؛ التصنيف الحالي 'مسوّدة'." },
      receivedAt: isoHoursAgo(5),
    },
    {
      id: "a3", agentId: "schema", productId: "logistics-corridor", severity: "medium",
      title: { en: "Schema drift on 3 sources", ar: "انحراف البنية على 3 مصادر" },
      detail: { en: "Lineage coverage fell from 91% to 62% over the weekend.", ar: "تراجعت تغطية النسب من 91% إلى 62%." },
      receivedAt: isoHoursAgo(14),
    },
    {
      id: "a4", agentId: "lineage", productId: "iam-events", severity: "high",
      title: { en: "IAM Events held: 4 PDPL controls open", ar: "احتجاز IAM: 4 ضوابط PDPL مفتوحة" },
      detail: { en: "Lineage gap on Articles 13, 22, 29, 15. Sinks remain blocked.", ar: "ثغرة على المواد 13 و22 و29 و15." },
      receivedAt: isoHoursAgo(8),
    },
    {
      id: "a5", agentId: "contract", productId: "embedding-vault", severity: "medium",
      title: { en: "Embedding Vault has no quality contract", ar: "خزنة التضمينات بلا عقد جودة" },
      detail: { en: "SDAIA AI-G 12 requires a signed contract before any reader access.", ar: "SDAIA AI-G 12 تشترط عقداً موقّعاً." },
      receivedAt: isoHoursAgo(20),
    },
  ];
}

export function generateAuditLog(): AuditEntry[] {
  const out: AuditEntry[] = [];
  sovereignDataScenario.events.forEach((ev, i) => {
    if (ev.kind === "think" || ev.kind === "tool-call" || ev.kind === "patch-workspace" || ev.kind === "checkpoint" || ev.kind === "complete") {
      out.push({
        id: `audit-scn-${i}`,
        agentId: ev.agentId ?? "orch",
        productId: "citizen-sentiment-dashboard",
        action: ev.label,
        detail: (ev as { toolResult?: BiText; detail?: BiText }).toolResult ?? (ev as { detail?: BiText }).detail ?? ev.label,
        timestamp: isoHoursAgo(8 - Math.floor(i / 3)),
      });
    }
  });
  out.push({
    id: "audit-x1", agentId: "lineage", productId: "iam-events",
    action: { en: "Hold publish — lineage gap", ar: "احتجاز النشر — ثغرة نسب" },
    detail: { en: "4 of 12 PDPL controls failing column-level lineage check.", ar: "4 من 12 ضابطاً تفشل في فحص النسب." },
    timestamp: isoHoursAgo(8),
  });
  out.push({
    id: "audit-x2", agentId: "ner", productId: "telemed-utilization",
    action: { en: "Tag 14 PII columns", ar: "وسم 14 عموداً" },
    detail: { en: "Arabic NER detected national IDs, MRN, and contact numbers.", ar: "رصدت الكيانات الهوية والرقم الطبي والاتصال." },
    timestamp: isoHoursAgo(5),
  });
  out.push({
    id: "audit-x3", agentId: "schema", productId: "logistics-corridor",
    action: { en: "Re-profile flagged", ar: "وسم لإعادة التحليل" },
    detail: { en: "Schema drift on 3 of 7 source tables.", ar: "انحراف على 3 من 7 جداول." },
    timestamp: isoHoursAgo(14),
  });
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getKpis() {
  const active = DATA_PRODUCTS.filter((p) => p.status === "active").length;
  const pending = generateRecommendations().filter((r) => r.status === "pending").length;
  const lineageAvg = Math.round(
    DATA_PRODUCTS.filter((p) => p.status !== "draft" && p.status !== "deprecated")
      .reduce((s, p) => s + p.lineageCoverage, 0) /
    DATA_PRODUCTS.filter((p) => p.status !== "draft" && p.status !== "deprecated").length,
  );
  const pdplPass = DATA_PRODUCTS.reduce((s, p) => s + p.pdplPass, 0);
  const pdplTotal = DATA_PRODUCTS.reduce((s, p) => s + p.pdplTotal, 0);
  const blockedSinks = DATA_PRODUCTS.reduce((s, p) => s + p.blockedSinks, 0);
  return { active, pending, lineageAvg, pdplPass, pdplTotal, blockedSinks };
}

export function staleProducts(): DataProduct[] {
  return DATA_PRODUCTS.filter((p) => p.freshnessMin >= 4320 && p.status === "active");
}

export function blockedProducts(): DataProduct[] {
  return DATA_PRODUCTS.filter((p) => p.blockedSinks > 0 || p.status === "blocked");
}

export function ownersIndex(): { owner: BiText; org: BiText; productCount: number; products: BiText[] }[] {
  const map = new Map<string, { owner: BiText; org: BiText; productCount: number; products: BiText[] }>();
  DATA_PRODUCTS.forEach((p) => {
    const key = p.owner.en;
    const ex = map.get(key);
    if (ex) { ex.productCount++; ex.products.push(p.name); }
    else map.set(key, { owner: p.owner, org: p.ownerOrg, productCount: 1, products: [p.name] });
  });
  return Array.from(map.values()).sort((a, b) => b.productCount - a.productCount);
}

export { productById, DATA_PRODUCTS };
