// Tasama Payroll Intelligence Hub — frontend type definitions, bilingual
// label helpers, and shared constants for the three demo experiences
// (Digital Team / Client Portal / Manager Dashboard).
//
// Architectural twin of `arcelik-seed.ts`. All bilingual helpers default
// to AR (the demo's default audience is KSA) but accept a `lang` arg.

export type Lang = "en" | "ar";

// ─── Core entity interfaces (mirror the DB schema) ───────────────────────

export interface TasamaClient {
  id: string;
  legalNameEn: string;
  legalNameAr: string;
  industry: string;
  employeeCount: number;
  saudiCount: number;
  expatCount: number;
  saudizationBand: SaudizationBand;
  saudizationPercent: number;
  monthlyPayrollGross: number;
  contactName: string;
  contactEmail: string;
  activeEvents: string[];
  onboardedAt: string;
  payrollCutoffDay: number;
}

export interface TasamaEmployee {
  id: string;
  clientId: string;
  fullNameEn: string;
  fullNameAr: string;
  nationality: string;
  isSaudi: boolean;
  role: string;
  roleAr: string;
  department: string;
  hireDate: string;
  yearsOfService: number;
  status: EmployeeStatus;
  contractType: "limited" | "unlimited" | "probation";
  iqamaNumber: string | null;
  nationalId: string | null;
  iban: string;
  bankName: string;
  email: string;
  phone: string;
  storyTags: string[];
  notes: string | null;
}

export interface SalaryComponent {
  id: string;
  employeeId: string;
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: { label: string; labelAr: string; amount: number }[];
  grossMonthly: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type PayrollRunStatus = "in-preparation" | "draft" | "approved" | "settled" | "filed";

export interface PayrollRun {
  id: string;
  clientId: string;
  periodYear: number;
  periodMonth: number;
  runDate: string;
  status: PayrollRunStatus;
  totalGross: number;
  totalNet: number;
  totalGosiEmployer: number;
  totalGosiEmployee: number;
  employeeCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
  settledAt: string | null;
  mudadBatchRef: string | null;
  notes: string | null;
}

export type PaymentStatus = "pending" | "paid" | "rejected";

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  clientId: string;
  periodYear: number;
  periodMonth: number;
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: number;
  overtime: number;
  bonus: number;
  retroAdjustment: number;
  grossPay: number;
  gosiEmployeeDeduction: number;
  otherDeductions: number;
  netPay: number;
  paymentStatus: PaymentStatus;
  paymentDate: string | null;
  mudadRef: string | null;
}

export type DocumentType =
  | "employment-contract"
  | "termination-letter"
  | "promotion-letter"
  | "salary-increase-letter"
  | "bonus-letter"
  | "performance-review"
  | "contract-renewal"
  | "maternity-leave-approval"
  | "salary-certificate"
  | "experience-letter"
  | "gosi-registration"
  | "final-settlement";

export interface TasamaDocument {
  id: string;
  clientId: string;
  employeeId: string | null;
  type: DocumentType;
  titleEn: string;
  titleAr: string;
  referenceNumber: string;
  issuedAt: string;
  signedByName: string;
  signedByTitle: string;
  language: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractedFields: Record<string, { value: string; confidence: number }>;
  overallConfidence: number;
  storagePath: string;
  processedAt: string;
}

export type RequestType =
  | "salary-certificate"
  | "experience-letter"
  | "leave-request"
  | "iqama-renewal"
  | "loan-request"
  | "advance-request"
  | "training-nomination"
  | "promotion-request"
  | "transfer-request"
  | "exit-request"
  | "data-correction"
  | "iban-update";

export type RequestStatus = "submitted" | "in-review" | "in-progress" | "completed" | "rejected";

export interface ServiceRequest {
  id: string;
  clientId: string;
  employeeId: string | null;
  type: RequestType;
  titleEn: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  status: RequestStatus;
  priority: "low" | "medium" | "high" | "critical";
  requestedBy: string;
  requestedAt: string;
  assignedAgent: string | null;
  completedAt: string | null;
  payload: Record<string, unknown>;
  slaTargetHours: number;
}

export interface GosiRecord {
  id: string;
  employeeId: string;
  clientId: string;
  periodYear: number;
  periodMonth: number;
  isSaudi: boolean;
  basicPlusHousing: number;
  employerAnnuity: number;
  employeeAnnuity: number;
  ohrpEmployer: number;
  totalEmployer: number;
  totalEmployee: number;
  filingStatus: "draft" | "submitted" | "accepted" | "rejected";
  filedAt: string | null;
  filingReference: string | null;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  annualEntitlement: number;
  annualUsed: number;
  annualRemaining: number;
  sickUsedDays: number;
  otherLeaveUsed: Record<string, number>;
  pendingRequests: { type: string; days: number; startDate: string }[];
  asOfDate: string;
}

export interface EosbProvision {
  id: string;
  employeeId: string;
  clientId: string;
  periodYear: number;
  periodMonth: number;
  yearsOfService: number;
  lastBasicPlusHousing: number;
  accruedThisMonth: number;
  cumulativeProvision: number;
  estimatedFullPayout: number;
}

export type CalendarEventType =
  | "gosi-filing"
  | "mudad-submission"
  | "iqama-renewal"
  | "saudization-review"
  | "wps-deadline"
  | "tax-event"
  | "contract-renewal"
  | "leave-event";

export interface RegulatoryCalendarEntry {
  id: string;
  eventType: CalendarEventType;
  nameEn: string;
  nameAr: string;
  clientId: string | null;
  employeeId: string | null;
  dueDate: string;
  type: "filed" | "upcoming";
  descriptionEn: string;
  descriptionAr: string;
  referenceNumber: string | null;
  completedAt: string | null;
}

export interface AgentPerformanceRecord {
  id: string;
  agentId: string;
  periodYear: number;
  periodMonth: number;
  accuracy: number;
  speed: number;
  autonomy: number;
  quality: number;
  composite: number;
  tasksProcessed: number;
  humanOverrides: number;
  escalations: number;
  avgLatencySeconds: number;
  errorCount: number;
  notableEvents: string[];
}

// ─── Roles, statuses, agents, departments ────────────────────────────────

export type PayrollRole = "payroll-manager" | "finance-controller" | "compliance-officer";

export type EmployeeStatus = "active" | "on-leave" | "probation" | "separated" | "onboarding";

export type SaudizationBand =
  | "platinum"
  | "green-high"
  | "green-mid"
  | "green-low"
  | "yellow"
  | "red";

export const TASAMA_AGENT_IDS = [
  "payroll-orchestrator",
  "document-intelligence",
  "salary-calculation",
  "gosi-compliance",
  "mudad-bank-transfer",
  "eosb-provision",
  "leave-management",
  "saudization-monitor",
  "performance-audit",
  "client-communications",
] as const;

export type TasamaAgentId = (typeof TASAMA_AGENT_IDS)[number];

const AGENT_NAME_AR: Record<string, string> = {
  "payroll-orchestrator": "منسّق الرواتب",
  "document-intelligence": "وكيل ذكاء الوثائق",
  "salary-calculation": "وكيل حساب الرواتب",
  "gosi-compliance": "وكيل امتثال التأمينات",
  "mudad-bank-transfer": "وكيل تحويلات مُدد",
  "eosb-provision": "وكيل مخصصات نهاية الخدمة",
  "leave-management": "وكيل إدارة الإجازات",
  "saudization-monitor": "وكيل مراقبة السعودة",
  "performance-audit": "وكيل الأداء والتدقيق",
  "client-communications": "وكيل اتصالات العملاء",
};

const AGENT_NAME_EN: Record<string, string> = {
  "payroll-orchestrator": "Payroll Orchestrator",
  "document-intelligence": "Document Intelligence Agent",
  "salary-calculation": "Salary Calculation Agent",
  "gosi-compliance": "GOSI Compliance Agent",
  "mudad-bank-transfer": "Mudad Bank Transfer Agent",
  "eosb-provision": "EOSB Provision Agent",
  "leave-management": "Leave Management Agent",
  "saudization-monitor": "Saudization Monitor Agent",
  "performance-audit": "Performance & Audit Agent",
  "client-communications": "Client Communications Agent",
};

export function getAgentName(agentId: string, lang: Lang = "ar"): string {
  return lang === "en" ? (AGENT_NAME_EN[agentId] ?? agentId) : (AGENT_NAME_AR[agentId] ?? agentId);
}

// ─── Bilingual label helpers ─────────────────────────────────────────────

const DOCUMENT_TYPE_AR: Record<DocumentType, string> = {
  "employment-contract": "عقد عمل",
  "termination-letter": "رسالة إنهاء خدمة",
  "promotion-letter": "رسالة ترقية",
  "salary-increase-letter": "رسالة زيادة راتب",
  "bonus-letter": "رسالة مكافأة",
  "performance-review": "تقييم أداء",
  "contract-renewal": "تجديد عقد",
  "maternity-leave-approval": "اعتماد إجازة أمومة",
  "salary-certificate": "شهادة راتب",
  "experience-letter": "شهادة خبرة",
  "gosi-registration": "تسجيل التأمينات",
  "final-settlement": "تسوية نهائية",
};

const DOCUMENT_TYPE_EN: Record<DocumentType, string> = {
  "employment-contract": "Employment Contract",
  "termination-letter": "Termination Letter",
  "promotion-letter": "Promotion Letter",
  "salary-increase-letter": "Salary Increase Letter",
  "bonus-letter": "Bonus Letter",
  "performance-review": "Performance Review",
  "contract-renewal": "Contract Renewal",
  "maternity-leave-approval": "Maternity Leave Approval",
  "salary-certificate": "Salary Certificate",
  "experience-letter": "Experience Letter",
  "gosi-registration": "GOSI Registration Confirmation",
  "final-settlement": "Final Settlement Statement",
};

export function getDocumentTypeLabel(type: DocumentType, lang: Lang = "ar"): string {
  return lang === "en" ? DOCUMENT_TYPE_EN[type] : DOCUMENT_TYPE_AR[type];
}

const REQUEST_TYPE_AR: Record<RequestType, string> = {
  "salary-certificate": "شهادة راتب",
  "experience-letter": "شهادة خبرة",
  "leave-request": "طلب إجازة",
  "iqama-renewal": "تجديد إقامة",
  "loan-request": "طلب سلفة",
  "advance-request": "طلب مقدم راتب",
  "training-nomination": "ترشيح تدريبي",
  "promotion-request": "طلب ترقية",
  "transfer-request": "طلب نقل",
  "exit-request": "طلب خروج",
  "data-correction": "تصحيح بيانات",
  "iban-update": "تحديث آيبان",
};

const REQUEST_TYPE_EN: Record<RequestType, string> = {
  "salary-certificate": "Salary Certificate",
  "experience-letter": "Experience Letter",
  "leave-request": "Leave Request",
  "iqama-renewal": "Iqama Renewal",
  "loan-request": "Loan Request",
  "advance-request": "Salary Advance",
  "training-nomination": "Training Nomination",
  "promotion-request": "Promotion Request",
  "transfer-request": "Transfer Request",
  "exit-request": "Exit Request",
  "data-correction": "Data Correction",
  "iban-update": "IBAN Update",
};

export function getRequestTypeLabel(type: RequestType, lang: Lang = "ar"): string {
  return lang === "en" ? REQUEST_TYPE_EN[type] : REQUEST_TYPE_AR[type];
}

const LEAVE_TYPE_AR: Record<string, string> = {
  annual: "إجازة سنوية",
  sick: "إجازة مرضية",
  maternity: "إجازة أمومة",
  paternity: "إجازة أبوة",
  marriage: "إجازة زواج",
  bereavement: "إجازة وفاة",
  hajj: "إجازة حج",
  iddah: "إجازة عدة",
  unpaid: "إجازة بدون راتب",
};

const LEAVE_TYPE_EN: Record<string, string> = {
  annual: "Annual Leave",
  sick: "Sick Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  marriage: "Marriage Leave",
  bereavement: "Bereavement Leave",
  hajj: "Hajj Leave",
  iddah: "Iddah Leave",
  unpaid: "Unpaid Leave",
};

export function getLeaveTypeLabel(type: string, lang: Lang = "ar"): string {
  return lang === "en" ? (LEAVE_TYPE_EN[type] ?? type) : (LEAVE_TYPE_AR[type] ?? type);
}

const SAUDIZATION_BAND_AR: Record<SaudizationBand, string> = {
  platinum: "بلاتيني",
  "green-high": "أخضر مرتفع",
  "green-mid": "أخضر متوسط",
  "green-low": "أخضر منخفض",
  yellow: "أصفر",
  red: "أحمر",
};

const SAUDIZATION_BAND_EN: Record<SaudizationBand, string> = {
  platinum: "Platinum",
  "green-high": "Green-High",
  "green-mid": "Green-Mid",
  "green-low": "Green-Low",
  yellow: "Yellow",
  red: "Red",
};

export function getSaudizationBandLabel(band: SaudizationBand, lang: Lang = "ar"): string {
  return lang === "en" ? SAUDIZATION_BAND_EN[band] : SAUDIZATION_BAND_AR[band];
}

export const SAUDIZATION_BAND_COLOR: Record<SaudizationBand, string> = {
  platinum: "#7C3AED",
  "green-high": "#059669",
  "green-mid": "#10B981",
  "green-low": "#34D399",
  yellow: "#F59E0B",
  red: "#DC2626",
};

const STATUS_AR: Record<EmployeeStatus, string> = {
  active: "نشط",
  "on-leave": "في إجازة",
  probation: "تحت التجربة",
  separated: "منفصل",
  onboarding: "قيد التأهيل",
};

const STATUS_EN: Record<EmployeeStatus, string> = {
  active: "Active",
  "on-leave": "On Leave",
  probation: "Probation",
  separated: "Separated",
  onboarding: "Onboarding",
};

export function getEmployeeStatusLabel(status: EmployeeStatus, lang: Lang = "ar"): string {
  return lang === "en" ? STATUS_EN[status] : STATUS_AR[status];
}

const DEPARTMENT_AR: Record<string, string> = {
  engineering: "الهندسة",
  operations: "العمليات",
  finance: "المالية",
  hr: "الموارد البشرية",
  it: "تقنية المعلومات",
  sales: "المبيعات",
  retail: "التجزئة",
  warehouse: "المستودع",
  admin: "الإدارة",
  construction: "الإنشاءات",
  product: "المنتج",
  design: "التصميم",
  qa: "ضمان الجودة",
  devops: "DevOps",
  executive: "الإدارة التنفيذية",
};

const DEPARTMENT_EN: Record<string, string> = {
  engineering: "Engineering",
  operations: "Operations",
  finance: "Finance",
  hr: "Human Resources",
  it: "Information Technology",
  sales: "Sales",
  retail: "Retail",
  warehouse: "Warehouse",
  admin: "Administration",
  construction: "Construction",
  product: "Product",
  design: "Design",
  qa: "Quality Assurance",
  devops: "DevOps",
  executive: "Executive",
};

export function getDepartmentLabel(dept: string, lang: Lang = "ar"): string {
  return lang === "en" ? (DEPARTMENT_EN[dept] ?? dept) : (DEPARTMENT_AR[dept] ?? dept);
}

const NATIONALITY_AR: Record<string, string> = {
  saudi: "سعودي",
  indian: "هندي",
  pakistani: "باكستاني",
  egyptian: "مصري",
  filipino: "فلبيني",
  american: "أمريكي",
  jordanian: "أردني",
  syrian: "سوري",
  yemeni: "يمني",
  sudanese: "سوداني",
  bangladeshi: "بنغلاديشي",
  nepali: "نيبالي",
  british: "بريطاني",
  lebanese: "لبناني",
};

const NATIONALITY_EN: Record<string, string> = {
  saudi: "Saudi",
  indian: "Indian",
  pakistani: "Pakistani",
  egyptian: "Egyptian",
  filipino: "Filipino",
  american: "American",
  jordanian: "Jordanian",
  syrian: "Syrian",
  yemeni: "Yemeni",
  sudanese: "Sudanese",
  bangladeshi: "Bangladeshi",
  nepali: "Nepali",
  british: "British",
  lebanese: "Lebanese",
};

export function getNationalityLabel(code: string, lang: Lang = "ar"): string {
  return lang === "en" ? (NATIONALITY_EN[code] ?? code) : (NATIONALITY_AR[code] ?? code);
}

const CAL_EVENT_TYPE_AR: Record<CalendarEventType, string> = {
  "gosi-filing": "تقديم التأمينات",
  "mudad-submission": "تقديم مُدد",
  "iqama-renewal": "تجديد إقامة",
  "saudization-review": "مراجعة السعودة",
  "wps-deadline": "موعد حماية الأجور",
  "tax-event": "حدث ضريبي",
  "contract-renewal": "تجديد عقد",
  "leave-event": "حدث إجازة",
};

const CAL_EVENT_TYPE_EN: Record<CalendarEventType, string> = {
  "gosi-filing": "GOSI Filing",
  "mudad-submission": "Mudad Submission",
  "iqama-renewal": "Iqama Renewal",
  "saudization-review": "Saudization Review",
  "wps-deadline": "Wage Protection Deadline",
  "tax-event": "Tax Event",
  "contract-renewal": "Contract Renewal",
  "leave-event": "Leave Event",
};

export function getCalendarEventName(entry: RegulatoryCalendarEntry, lang: Lang = "ar"): string {
  if (entry.nameEn && lang === "en") return entry.nameEn;
  if (entry.nameAr && lang === "ar") return entry.nameAr;
  return lang === "en" ? CAL_EVENT_TYPE_EN[entry.eventType] : CAL_EVENT_TYPE_AR[entry.eventType];
}

const PROCESS_TYPE_AR: Record<string, string> = {
  separation: "فصل موظف",
  onboarding: "تأهيل موظف",
  "salary-adjustment": "تعديل راتب",
  "maternity-leave": "إجازة أمومة",
  "iqama-renewal": "تجديد إقامة",
  "monthly-payroll": "دورة رواتب شهرية",
  "gosi-filing": "تقديم التأمينات الشهري",
};

const PROCESS_TYPE_EN: Record<string, string> = {
  separation: "Employee Separation",
  onboarding: "Employee Onboarding",
  "salary-adjustment": "Salary Adjustment",
  "maternity-leave": "Maternity Leave",
  "iqama-renewal": "Iqama Renewal",
  "monthly-payroll": "Monthly Payroll Cycle",
  "gosi-filing": "GOSI Monthly Filing",
};

export function getProcessTypeName(type: string, lang: Lang = "ar"): string {
  return lang === "en" ? (PROCESS_TYPE_EN[type] ?? type) : (PROCESS_TYPE_AR[type] ?? type);
}

const MONTH_NAMES_EN = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_AR = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function getMonthName(month: number, lang: Lang = "ar"): string {
  return lang === "en" ? MONTH_NAMES_EN[month] : MONTH_NAMES_AR[month];
}

// ─── Formatters ──────────────────────────────────────────────────────────

export function formatSAR(amount: number): string {
  return `SAR ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string, lang: Lang = "ar"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "en" ? "en-US" : "ar-SA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── GOSI calculation helpers (used by the agent generator) ──────────────

export interface GosiBreakdown {
  base: number;
  employerAnnuity: number;
  employeeAnnuity: number;
  ohrpEmployer: number;
  totalEmployer: number;
  totalEmployee: number;
}

export function computeGosi(basicPlusHousing: number, isSaudi: boolean): GosiBreakdown {
  const employerAnnuity = isSaudi ? Math.round(basicPlusHousing * 0.12) : 0;
  const employeeAnnuity = isSaudi ? Math.round(basicPlusHousing * 0.10) : 0;
  const ohrpEmployer = Math.round(basicPlusHousing * 0.02);
  return {
    base: basicPlusHousing,
    employerAnnuity,
    employeeAnnuity,
    ohrpEmployer,
    totalEmployer: employerAnnuity + ohrpEmployer,
    totalEmployee: employeeAnnuity,
  };
}

// EOSB calculation per Article 84 (employer-initiated termination = 100%).
export function computeEosb(yearsOfService: number, lastBasicPlusHousing: number): number {
  const firstYearsCount = Math.min(5, yearsOfService);
  const remainingYears = Math.max(0, yearsOfService - 5);
  const firstPart = firstYearsCount * 0.5 * lastBasicPlusHousing;
  const remainingPart = remainingYears * 1.0 * lastBasicPlusHousing;
  return Math.round(firstPart + remainingPart);
}

// Resignation discount factor per spec (vs full employer-initiated payout).
export function resignationFactor(yearsOfService: number): number {
  if (yearsOfService < 2) return 0;
  if (yearsOfService < 5) return 0.33;
  if (yearsOfService < 10) return 0.67;
  return 1;
}

// ─── Bilingual demo localisation helper (small dictionary lookup) ────────

export function bi<T extends Record<string, string>>(en: T, ar: T): { en: T; ar: T } {
  return { en, ar };
}

// ─── Agent-output types (shared by tasama-agent.ts) ──────────────────────

export type Severity = "critical" | "high" | "medium" | "low";
export type RecommendationStatus = "pending" | "approved" | "rejected" | "modified";
export type TaskStatus = "open" | "in-progress" | "done";

export interface ReasoningStep {
  source: string;
  observation: string;
  conclusion: string;
}

export interface PayrollRecommendation {
  id: string;
  type: string;
  title: string;
  summary: string;
  targetRole: PayrollRole;
  severity: Severity;
  /** 0-100 confidence scale */
  confidence: number;
  reasoning: ReasoningStep[];
  /** Payroll-specific impact (cost, compliance posture, SLA effect) */
  impact: { cost: string; compliance: string; sla: string };
  recommendedAction: string;
  alternatives: string[];
  status: RecommendationStatus;
  createdAt: string;
  decidedBy?: string;
  decisionNote?: string;
  outcome?: string;
}

export interface AgentPerformanceScore {
  agentId: TasamaAgentId;
  agentName: { en: string; ar: string };
  health: "healthy" | "degraded" | "warning";
  /** 0-100 scale */
  accuracyScore: number;
  speedScore: number;
  autonomyScore: number;
  qualityScore: number;
  compositeScore: number;
  /** Last 6 months of composite scores for sparkline */
  trend: number[];
  tasksThisCycle: number;
  avgLatencySeconds: number;
  errorCount: number;
  humanOverrideRate: number;
  escalationRate: number;
  confidenceCalibration: number;
  notableEvents: string[];
}

export interface DecisionAnalytics {
  overallApprovalRate: number;
  overallModificationRate: number;
  overallRejectionRate: number;
  byAgent: { agentId: string; agentName: string; approved: number; modified: number; rejected: number }[];
  byRole: { role: PayrollRole; avgDecisionTimeMinutes: number; approvalRate: number }[];
  topRejectionReasons: { reason: string; count: number }[];
  automationRate: number;
  humanTouchPointsPerCycle: number;
  confidenceCalibrationCurve: { bucket: string; predicted: number; actual: number }[];
}

export interface ClientAgentInsight {
  id: string;
  clientId: string;
  type: "info" | "action-required" | "opportunity" | "risk";
  title: string;
  titleAr: string;
  detail: string;
  detailAr: string;
  agentSource: TasamaAgentId;
  /** 0-100 */
  confidence: number;
  linkedEntityId?: string;
  createdAt: string;
}

export interface SimulatorRecommendation {
  id: string;
  title: string;
  description: string;
  suggestedMode: "headcount" | "salary" | "compliance";
  suggestedParams: Record<string, unknown>;
  impact: string;
  /** 0-100 */
  confidence: number;
  agentSource: string;
}

export interface ProcessStep {
  id: string;
  name: string;
  nameAr: string;
  agentId: TasamaAgentId | "human-checkpoint";
  agentName: string;
  status: "completed" | "active" | "pending";
  completedAt?: string;
  output?: string;
}

export interface EmployeeProcess {
  id: string;
  type: "separation" | "onboarding" | "salary-adjustment" | "maternity-leave" | "iqama-renewal";
  clientId: string;
  employeeId: string;
  employeeName: { en: string; ar: string };
  startedAt: string;
  estimatedCompletion: string;
  steps: ProcessStep[];
  activityLog: { timestamp: string; agentName: string; description: string; outcome: string }[];
}
