/**
 * Network Ops War Room — seed data for the NOC Director Console.
 *
 * Sample/illustrative GCC telco network: Sahara Telecom (fictional pan-GCC
 * operator). ~30 sites, 50 links, 6 incidents, 4 enterprise services, 8
 * field crews. All names, IDs, KPIs, and SLAs are sample data.
 */

export type SiteType = "core" | "aggregation" | "edge" | "datacenter";
export type SiteStatus = "ok" | "degraded" | "down";

export interface Site {
  id: string;
  name: { en: string; ar: string };
  city: { en: string; ar: string };
  country: "SA" | "AE" | "QA" | "BH" | "KW" | "OM";
  lat: number;
  lng: number;
  type: SiteType;
  status: SiteStatus;
  customers: number;
}

export type LinkStatus = "ok" | "degraded" | "down";
export type LinkKind = "fibre" | "microwave";

export interface NetLink {
  id: string;
  fromId: string;
  toId: string;
  kind: LinkKind;
  capacityGbps: number;
  utilisation: number; // 0..1
  status: LinkStatus;
}

export type Severity = "p1" | "p2" | "p3" | "p4";
export type IncidentStatus = "active" | "mitigating" | "monitoring" | "resolved";

export interface Incident {
  id: string;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  severity: Severity;
  status: IncidentStatus;
  openedAt: string; // ISO time
  affectedSiteIds: string[];
  affectedCustomers: number;
  rootCauseHypothesis: { en: string; ar: string };
  recommendedAction: { en: string; ar: string };
  evidence: { en: string; ar: string }[];
  regulatorClock?: { startedAt: string; budgetMin: number; bufferMin: number };
  awaitingApproval?: boolean;
  serviceIds: string[];
  timeline?: IncidentTimelineEntry[];
  runbook?: RunbookStep[];
  customerImpact?: { en: string; ar: string };
}

export type TimelinePhase = "detection" | "correlation" | "root-cause" | "dispatch" | "comms" | "resolution";
export interface IncidentTimelineEntry {
  phase: TimelinePhase;
  ts: string;
  label: { en: string; ar: string };
  done: boolean;
}

export type RunbookStepStatus = "done" | "active" | "pending" | "blocked";
export interface RunbookStep {
  id: string;
  title: { en: string; ar: string };
  detail: { en: string; ar: string };
  status: RunbookStepStatus;
  owner: { en: string; ar: string };
}

export interface ServiceSla {
  id: string;
  name: { en: string; ar: string };
  customer: { en: string; ar: string };
  slaPct: number;
  currentPct: number;
  status: "ok" | "at-risk" | "breached";
  monthlyCreditAtRisk: number; // SAR
  dependsOnSiteIds: string[];
}

export type CrewStatus = "available" | "dispatched" | "on-site" | "returning";
export interface Crew {
  id: string;
  name: { en: string; ar: string };
  lead: { en: string; ar: string };
  city: { en: string; ar: string };
  lat: number;
  lng: number;
  status: CrewStatus;
  etaMin?: number;
  assignedIncidentId?: string;
}

export interface ApprovalItem {
  id: string;
  incidentId: string;
  title: { en: string; ar: string };
  detail: { en: string; ar: string };
  recommendation: { en: string; ar: string };
  confidence: number; // 0..100
  raisedBy: { en: string; ar: string };
  raisedAt: string;
  severity: Severity;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: { en: string; ar: string };
  action: { en: string; ar: string };
  detail: { en: string; ar: string };
  kind: "agent" | "human" | "system";
}

// ── Sites (30) ──────────────────────────────────────────────────────────
export const SITES: Site[] = [
  // Saudi Arabia (12)
  { id: "RUH-CORE-01", name: { en: "Riyadh Core 1", ar: "نواة الرياض 1" }, city: { en: "Riyadh", ar: "الرياض" }, country: "SA", lat: 24.7136, lng: 46.6753, type: "core", status: "ok", customers: 1_240_000 },
  { id: "RUH-CORE-02", name: { en: "Riyadh Core 2", ar: "نواة الرياض 2" }, city: { en: "Riyadh", ar: "الرياض" }, country: "SA", lat: 24.6500, lng: 46.7100, type: "core", status: "ok", customers: 980_000 },
  { id: "RUH-AGG-01", name: { en: "Riyadh North Agg", ar: "تجميع شمال الرياض" }, city: { en: "Riyadh", ar: "الرياض" }, country: "SA", lat: 24.8200, lng: 46.6300, type: "aggregation", status: "ok", customers: 320_000 },
  { id: "RUH-EDGE-04", name: { en: "Riyadh South Edge", ar: "حافة جنوب الرياض" }, city: { en: "Riyadh", ar: "الرياض" }, country: "SA", lat: 24.5800, lng: 46.6900, type: "edge", status: "degraded", customers: 145_000 },
  { id: "JED-CORE-01", name: { en: "Jeddah Core", ar: "نواة جدة" }, city: { en: "Jeddah", ar: "جدة" }, country: "SA", lat: 21.4858, lng: 39.1925, type: "core", status: "ok", customers: 870_000 },
  { id: "JED-EDGE-02", name: { en: "Jeddah Corniche Edge", ar: "حافة كورنيش جدة" }, city: { en: "Jeddah", ar: "جدة" }, country: "SA", lat: 21.5400, lng: 39.1400, type: "edge", status: "ok", customers: 210_000 },
  { id: "DMM-CORE-01", name: { en: "Dammam Core", ar: "نواة الدمام" }, city: { en: "Dammam", ar: "الدمام" }, country: "SA", lat: 26.4207, lng: 50.0888, type: "core", status: "ok", customers: 540_000 },
  { id: "DMM-AGG-02", name: { en: "Dhahran Aggregation", ar: "تجميع الظهران" }, city: { en: "Dhahran", ar: "الظهران" }, country: "SA", lat: 26.2667, lng: 50.1500, type: "aggregation", status: "down", customers: 180_000 },
  { id: "MEC-EDGE-01", name: { en: "Mecca Edge", ar: "حافة مكة" }, city: { en: "Mecca", ar: "مكة" }, country: "SA", lat: 21.3891, lng: 39.8579, type: "edge", status: "ok", customers: 410_000 },
  { id: "MED-EDGE-01", name: { en: "Medina Edge", ar: "حافة المدينة" }, city: { en: "Medina", ar: "المدينة" }, country: "SA", lat: 24.5247, lng: 39.5692, type: "edge", status: "ok", customers: 240_000 },
  { id: "TBK-EDGE-01", name: { en: "Tabuk Edge", ar: "حافة تبوك" }, city: { en: "Tabuk", ar: "تبوك" }, country: "SA", lat: 28.3838, lng: 36.5550, type: "edge", status: "ok", customers: 95_000 },
  { id: "ABH-EDGE-01", name: { en: "Abha Edge", ar: "حافة أبها" }, city: { en: "Abha", ar: "أبها" }, country: "SA", lat: 18.2164, lng: 42.5053, type: "edge", status: "ok", customers: 78_000 },

  // UAE (8)
  { id: "AUH-CORE-01", name: { en: "Abu Dhabi Core", ar: "نواة أبوظبي" }, city: { en: "Abu Dhabi", ar: "أبوظبي" }, country: "AE", lat: 24.4539, lng: 54.3773, type: "core", status: "ok", customers: 620_000 },
  { id: "AUH-DC-01", name: { en: "Abu Dhabi DC", ar: "مركز بيانات أبوظبي" }, city: { en: "Abu Dhabi", ar: "أبوظبي" }, country: "AE", lat: 24.4200, lng: 54.5000, type: "datacenter", status: "ok", customers: 0 },
  { id: "DXB-CORE-01", name: { en: "Dubai Core", ar: "نواة دبي" }, city: { en: "Dubai", ar: "دبي" }, country: "AE", lat: 25.2048, lng: 55.2708, type: "core", status: "ok", customers: 980_000 },
  { id: "DXB-EDGE-02", name: { en: "Dubai Marina Edge", ar: "حافة مرسى دبي" }, city: { en: "Dubai", ar: "دبي" }, country: "AE", lat: 25.0800, lng: 55.1400, type: "edge", status: "ok", customers: 320_000 },
  { id: "SHJ-AGG-01", name: { en: "Sharjah Aggregation", ar: "تجميع الشارقة" }, city: { en: "Sharjah", ar: "الشارقة" }, country: "AE", lat: 25.3463, lng: 55.4209, type: "aggregation", status: "degraded", customers: 410_000 },
  { id: "SHJ-EDGE-04", name: { en: "Sharjah South Edge", ar: "حافة جنوب الشارقة" }, city: { en: "Sharjah", ar: "الشارقة" }, country: "AE", lat: 25.2400, lng: 55.4500, type: "edge", status: "down", customers: 84_310 },
  { id: "AJM-EDGE-01", name: { en: "Ajman Edge", ar: "حافة عجمان" }, city: { en: "Ajman", ar: "عجمان" }, country: "AE", lat: 25.4111, lng: 55.4351, type: "edge", status: "ok", customers: 150_000 },
  { id: "RAK-EDGE-01", name: { en: "Ras Al Khaimah Edge", ar: "حافة رأس الخيمة" }, city: { en: "Ras Al Khaimah", ar: "رأس الخيمة" }, country: "AE", lat: 25.7895, lng: 55.9432, type: "edge", status: "ok", customers: 92_000 },

  // Qatar (3)
  { id: "DOH-CORE-01", name: { en: "Doha Core", ar: "نواة الدوحة" }, city: { en: "Doha", ar: "الدوحة" }, country: "QA", lat: 25.2854, lng: 51.5310, type: "core", status: "ok", customers: 510_000 },
  { id: "DOH-EDGE-02", name: { en: "Doha West Edge", ar: "حافة غرب الدوحة" }, city: { en: "Doha", ar: "الدوحة" }, country: "QA", lat: 25.2900, lng: 51.4500, type: "edge", status: "ok", customers: 220_000 },
  { id: "DOH-DC-01", name: { en: "Doha DC", ar: "مركز بيانات الدوحة" }, city: { en: "Doha", ar: "الدوحة" }, country: "QA", lat: 25.3100, lng: 51.5200, type: "datacenter", status: "ok", customers: 0 },

  // Bahrain (2)
  { id: "BAH-CORE-01", name: { en: "Manama Core", ar: "نواة المنامة" }, city: { en: "Manama", ar: "المنامة" }, country: "BH", lat: 26.2285, lng: 50.5860, type: "core", status: "ok", customers: 280_000 },
  { id: "BAH-EDGE-02", name: { en: "Riffa Edge", ar: "حافة الرفاع" }, city: { en: "Riffa", ar: "الرفاع" }, country: "BH", lat: 26.1300, lng: 50.5550, type: "edge", status: "ok", customers: 95_000 },

  // Kuwait (2)
  { id: "KWI-CORE-01", name: { en: "Kuwait City Core", ar: "نواة مدينة الكويت" }, city: { en: "Kuwait City", ar: "مدينة الكويت" }, country: "KW", lat: 29.3759, lng: 47.9774, type: "core", status: "ok", customers: 460_000 },
  { id: "KWI-EDGE-02", name: { en: "Hawalli Edge", ar: "حافة حولي" }, city: { en: "Hawalli", ar: "حولي" }, country: "KW", lat: 29.3328, lng: 48.0289, type: "edge", status: "ok", customers: 175_000 },

  // Oman (3)
  { id: "MCT-CORE-01", name: { en: "Muscat Core", ar: "نواة مسقط" }, city: { en: "Muscat", ar: "مسقط" }, country: "OM", lat: 23.5880, lng: 58.3829, type: "core", status: "ok", customers: 380_000 },
  { id: "MCT-EDGE-02", name: { en: "Seeb Edge", ar: "حافة السيب" }, city: { en: "Seeb", ar: "السيب" }, country: "OM", lat: 23.6700, lng: 58.1900, type: "edge", status: "ok", customers: 140_000 },
  { id: "SLL-EDGE-01", name: { en: "Salalah Edge", ar: "حافة صلالة" }, city: { en: "Salalah", ar: "صلالة" }, country: "OM", lat: 17.0151, lng: 54.0924, type: "edge", status: "ok", customers: 68_000 },
];

// ── Links (50) ──────────────────────────────────────────────────────────
function L(id: string, fromId: string, toId: string, kind: LinkKind, capacityGbps: number, utilisation: number, status: LinkStatus): NetLink {
  return { id, fromId, toId, kind, capacityGbps, utilisation, status };
}

export const LINKS: NetLink[] = [
  // Riyadh metro
  L("L-001", "RUH-CORE-01", "RUH-CORE-02", "fibre", 800, 0.42, "ok"),
  L("L-002", "RUH-CORE-01", "RUH-AGG-01", "fibre", 400, 0.58, "ok"),
  L("L-003", "RUH-CORE-02", "RUH-EDGE-04", "fibre", 200, 0.71, "degraded"),
  L("L-004", "RUH-AGG-01", "RUH-EDGE-04", "microwave", 40, 0.31, "ok"),
  // Saudi backbone
  L("L-005", "RUH-CORE-01", "JED-CORE-01", "fibre", 800, 0.66, "ok"),
  L("L-006", "RUH-CORE-02", "DMM-CORE-01", "fibre", 800, 0.59, "ok"),
  L("L-007", "JED-CORE-01", "MEC-EDGE-01", "fibre", 200, 0.48, "ok"),
  L("L-008", "JED-CORE-01", "JED-EDGE-02", "fibre", 200, 0.39, "ok"),
  L("L-009", "JED-CORE-01", "MED-EDGE-01", "fibre", 200, 0.44, "ok"),
  L("L-010", "DMM-CORE-01", "DMM-AGG-02", "fibre", 200, 0.0, "down"),
  L("L-011", "DMM-CORE-01", "BAH-CORE-01", "fibre", 400, 0.51, "ok"),
  L("L-012", "RUH-CORE-01", "TBK-EDGE-01", "fibre", 100, 0.32, "ok"),
  L("L-013", "JED-CORE-01", "ABH-EDGE-01", "fibre", 100, 0.27, "ok"),
  L("L-014", "RUH-AGG-01", "MED-EDGE-01", "microwave", 40, 0.45, "ok"),

  // Saudi ↔ UAE
  L("L-015", "DMM-CORE-01", "AUH-CORE-01", "fibre", 800, 0.62, "ok"),
  L("L-016", "RUH-CORE-02", "AUH-CORE-01", "fibre", 400, 0.55, "ok"),

  // UAE metro
  L("L-017", "AUH-CORE-01", "DXB-CORE-01", "fibre", 800, 0.68, "ok"),
  L("L-018", "AUH-CORE-01", "AUH-DC-01", "fibre", 400, 0.41, "ok"),
  L("L-019", "DXB-CORE-01", "DXB-EDGE-02", "fibre", 200, 0.52, "ok"),
  L("L-020", "DXB-CORE-01", "SHJ-AGG-01", "fibre", 400, 0.78, "degraded"),
  L("L-021", "SHJ-AGG-01", "SHJ-EDGE-04", "fibre", 200, 0.0, "down"),
  L("L-022", "SHJ-AGG-01", "AJM-EDGE-01", "fibre", 100, 0.43, "ok"),
  L("L-023", "AJM-EDGE-01", "RAK-EDGE-01", "microwave", 20, 0.28, "ok"),
  L("L-024", "DXB-CORE-01", "AJM-EDGE-01", "microwave", 40, 0.37, "ok"),
  L("L-025", "DXB-CORE-01", "SHJ-EDGE-04", "microwave", 20, 0.85, "degraded"),

  // GCC backbone
  L("L-026", "AUH-CORE-01", "DOH-CORE-01", "fibre", 400, 0.49, "ok"),
  L("L-027", "DOH-CORE-01", "DOH-EDGE-02", "fibre", 200, 0.36, "ok"),
  L("L-028", "DOH-CORE-01", "DOH-DC-01", "fibre", 200, 0.44, "ok"),
  L("L-029", "DOH-CORE-01", "BAH-CORE-01", "fibre", 200, 0.41, "ok"),
  L("L-030", "BAH-CORE-01", "BAH-EDGE-02", "fibre", 100, 0.38, "ok"),
  L("L-031", "BAH-CORE-01", "KWI-CORE-01", "fibre", 200, 0.46, "ok"),
  L("L-032", "DMM-CORE-01", "KWI-CORE-01", "fibre", 400, 0.53, "ok"),
  L("L-033", "KWI-CORE-01", "KWI-EDGE-02", "fibre", 100, 0.33, "ok"),
  L("L-034", "AUH-CORE-01", "MCT-CORE-01", "fibre", 400, 0.58, "ok"),
  L("L-035", "DXB-CORE-01", "MCT-CORE-01", "fibre", 200, 0.42, "ok"),
  L("L-036", "MCT-CORE-01", "MCT-EDGE-02", "fibre", 100, 0.31, "ok"),
  L("L-037", "MCT-CORE-01", "SLL-EDGE-01", "fibre", 100, 0.26, "ok"),

  // Resilience / secondary
  L("L-038", "RUH-CORE-01", "RUH-AGG-01", "microwave", 20, 0.18, "ok"),
  L("L-039", "JED-CORE-01", "MEC-EDGE-01", "microwave", 20, 0.22, "ok"),
  L("L-040", "DMM-CORE-01", "DMM-AGG-02", "microwave", 20, 0.0, "down"),
  L("L-041", "AUH-DC-01", "DXB-CORE-01", "fibre", 200, 0.51, "ok"),
  L("L-042", "DXB-EDGE-02", "SHJ-AGG-01", "microwave", 20, 0.39, "ok"),
  L("L-043", "RUH-CORE-01", "DMM-CORE-01", "fibre", 400, 0.61, "ok"),
  L("L-044", "JED-CORE-01", "RUH-CORE-02", "fibre", 200, 0.44, "ok"),
  L("L-045", "MED-EDGE-01", "TBK-EDGE-01", "fibre", 40, 0.21, "ok"),
  L("L-046", "ABH-EDGE-01", "JED-CORE-01", "microwave", 20, 0.24, "ok"),
  L("L-047", "BAH-EDGE-02", "DMM-CORE-01", "microwave", 20, 0.29, "ok"),
  L("L-048", "DOH-DC-01", "DOH-EDGE-02", "fibre", 100, 0.34, "ok"),
  L("L-049", "AUH-CORE-01", "AJM-EDGE-01", "fibre", 100, 0.36, "ok"),
  L("L-050", "RAK-EDGE-01", "MCT-EDGE-02", "fibre", 40, 0.18, "ok"),
];

// ── Incidents (6) ───────────────────────────────────────────────────────
export const INCIDENTS: Incident[] = [
  {
    id: "INC-2026-3041",
    title: { en: "Fibre cut · Sharjah-South feeder", ar: "قطع ألياف · مغذّي جنوب الشارقة" },
    description: {
      en: "TX-NORTH-04 transport degradation suspected. 4 cells in Sharjah-South show packet loss 9.4–14.2%. Auto-detected at 14:01:48.",
      ar: "اشتباه تدهور نقل TX-NORTH-04. 4 خلايا بفقد حزم 9.4–14.2%. اكتشاف آلي 14:01:48.",
    },
    severity: "p1",
    status: "mitigating",
    openedAt: "2026-05-01T14:03:00Z",
    affectedSiteIds: ["SHJ-EDGE-04", "SHJ-AGG-01"],
    affectedCustomers: 84_310,
    rootCauseHypothesis: { en: "Fibre cut on South-Sharjah feeder km-21", ar: "قطع ألياف على مغذّي جنوب الشارقة كم 21" },
    recommendedAction: { en: "Roll back TX-NORTH-04 to last-good config and re-route via TX-NORTH-09", ar: "تراجع TX-NORTH-04 وإعادة التوجيه عبر TX-NORTH-09" },
    evidence: [
      { en: "Telemetry: loss > 8% on 4 cells, BBU drift not present", ar: "القياس: فقد > 8% على 4 خلايا" },
      { en: "Topology: blast radius isolated to South-Sharjah feeder", ar: "الطوبولوجيا: النطاق محصور بمغذّي جنوب الشارقة" },
      { en: "Change log: no recent CRs on TX-NORTH-04", ar: "سجل التغيير: لا تغييرات حديثة" },
    ],
    regulatorClock: { startedAt: "2026-05-01T14:03:00Z", budgetMin: 30, bufferMin: 16 },
    awaitingApproval: true,
    serviceIds: ["svc-port-logistics"],
    customerImpact: {
      en: "84,310 mobile customers in South Sharjah currently see slow data and dropped voice calls. The Sharjah Port Authority cannot scan inbound containers — every minute risks a customs queue.",
      ar: "84,310 عميلاً في جنوب الشارقة يعانون من بطء البيانات وانقطاع المكالمات. هيئة ميناء الشارقة لا تستطيع مسح الحاويات الواردة — كل دقيقة تأخير تعني طابوراً جمركياً.",
    },
    timeline: [
      { phase: "detection", ts: "2026-05-01T14:01:48Z", label: { en: "Telemetry alarm — packet loss spike", ar: "إنذار قياس — ارتفاع فقد الحزم" }, done: true },
      { phase: "correlation", ts: "2026-05-01T14:04:12Z", label: { en: "Blast radius computed (4 cells, 1 SLA)", ar: "حُسب نطاق التأثير (4 خلايا، اتفاقية واحدة)" }, done: true },
      { phase: "root-cause", ts: "2026-05-01T14:06:30Z", label: { en: "Fibre cut hypothesis · 96% confidence", ar: "فرضية قطع الألياف · ثقة 96%" }, done: true },
      { phase: "dispatch", ts: "2026-05-01T14:09:30Z", label: { en: "Crew SHJ-1 dispatched · ETA 28 min", ar: "إرسال فريق SHJ-1 · 28 دقيقة" }, done: true },
      { phase: "comms", ts: "2026-05-01T14:13:00Z", label: { en: "Customer SMS draft awaiting approval", ar: "مسوّدة SMS للعميل بانتظار الاعتماد" }, done: false },
      { phase: "resolution", ts: "2026-05-01T14:33:00Z", label: { en: "Target restore time", ar: "وقت الاستعادة المستهدف" }, done: false },
    ],
    runbook: [
      { id: "rb-1", title: { en: "Roll back TX-NORTH-04 to last-good config", ar: "تراجع TX-NORTH-04 إلى آخر إعداد سليم" }, detail: { en: "Restores 78% of sessions in ~6 minutes", ar: "يستعيد 78% خلال 6 دقائق" }, status: "done", owner: { en: "NOC Conductor", ar: "منسّق NOC" } },
      { id: "rb-2", title: { en: "Re-route via TX-NORTH-09", ar: "إعادة التوجيه عبر TX-NORTH-09" }, detail: { en: "Confirmed no congestion downstream", ar: "تأكيد عدم وجود ازدحام لاحق" }, status: "done", owner: { en: "Topology Mapper", ar: "خرائطيّ الطوبولوجيا" } },
      { id: "rb-3", title: { en: "Dispatch field crew to feeder km-21", ar: "إرسال فريق ميداني إلى مغذّي كم 21" }, detail: { en: "Crew SHJ-1 en route, ETA 28 min", ar: "فريق SHJ-1 في الطريق، 28 دقيقة" }, status: "active", owner: { en: "Runbook Player", ar: "مشغّل الإجراءات" } },
      { id: "rb-4", title: { en: "Approve customer notification SMS", ar: "اعتماد رسالة SMS للعميل" }, detail: { en: "Bilingual draft prepared, awaiting Reem", ar: "مسوّدة ثنائية اللغة بانتظار ريم" }, status: "pending", owner: { en: "Comms Drafter", ar: "كاتب التواصل" } },
      { id: "rb-5", title: { en: "File TDRA major-incident notification", ar: "إيداع إخطار TDRA" }, detail: { en: "Buffer 16 min on regulator clock", ar: "هامش 16 دقيقة على عدّاد المنظّم" }, status: "pending", owner: { en: "Impact Translator", ar: "مترجم الأثر" } },
    ],
  },
  {
    id: "INC-2026-3038",
    title: { en: "ROADM degradation · Eastern Province", ar: "تدهور ROADM · المنطقة الشرقية" },
    description: {
      en: "Dhahran aggregation showing optical SNR degradation across 2 wavelengths. Customers report intermittent VPN drops.",
      ar: "تدهور SNR على موجتَين في تجميع الظهران. تقارير قطع VPN متقطّعة.",
    },
    severity: "p2",
    status: "active",
    openedAt: "2026-05-01T13:21:00Z",
    affectedSiteIds: ["DMM-AGG-02", "DMM-CORE-01"],
    affectedCustomers: 38_400,
    rootCauseHypothesis: { en: "Aging ROADM line card · vendor RMA likely required", ar: "بطاقة ROADM متهالكة · قد تتطلب استبدال" },
    recommendedAction: { en: "Schedule line-card swap window 02:00–04:00, route traffic via L-043", ar: "جدولة استبدال نافذة 02:00–04:00، تحويل عبر L-043" },
    evidence: [
      { en: "Optical SNR: 14.2 dB (target 18+)", ar: "SNR ضوئي: 14.2 ديسيبل (هدف 18+)" },
      { en: "Vendor advisory: known issue on this card revision", ar: "تنبيه المورد: مشكلة معروفة على هذه المراجعة" },
    ],
    awaitingApproval: false,
    serviceIds: ["svc-bank-vpn"],
  },
  {
    id: "INC-2026-3033",
    title: { en: "Riyadh-South edge — capacity stress", ar: "حافة جنوب الرياض — ضغط سعة" },
    description: {
      en: "Edge utilisation > 70% during evening peak. Customers seeing slow page loads.",
      ar: "استخدام الحافة > 70% أثناء ذروة المساء. بطء في تحميل الصفحات.",
    },
    severity: "p3",
    status: "monitoring",
    openedAt: "2026-04-30T19:15:00Z",
    affectedSiteIds: ["RUH-EDGE-04"],
    affectedCustomers: 12_500,
    rootCauseHypothesis: { en: "Sustained traffic growth post Q1 promotions", ar: "نمو حركة بعد عروض الربع الأول" },
    recommendedAction: { en: "Open capacity uplift CR for next maintenance window", ar: "فتح طلب تغيير لرفع السعة" },
    evidence: [
      { en: "Peak utilisation 71% (4-week trend)", ar: "ذروة 71% خلال 4 أسابيع" },
    ],
    serviceIds: [],
  },
  {
    id: "INC-2026-3029",
    title: { en: "DDoS scrubbing · Doha enterprise tenant", ar: "تنقية DDoS · عميل أعمال بالدوحة" },
    description: {
      en: "Volumetric attack 14 Gbps targeting customer prefix; scrubbing centre engaged.",
      ar: "هجوم حجمي 14 جيجابت يستهدف بادئة عميل؛ مركز التنقية مفعّل.",
    },
    severity: "p2",
    status: "mitigating",
    openedAt: "2026-05-01T12:48:00Z",
    affectedSiteIds: ["DOH-EDGE-02", "DOH-CORE-01"],
    affectedCustomers: 8_200,
    rootCauseHypothesis: { en: "Botnet-driven UDP reflection attack", ar: "هجوم انعكاس UDP من شبكة روبوتات" },
    recommendedAction: { en: "Maintain scrubbing, notify customer, monitor for 30 min stable", ar: "إبقاء التنقية، إخطار العميل، مراقبة 30 دقيقة" },
    evidence: [
      { en: "Scrubbing centre: 99.4% drop ratio sustained", ar: "نسبة إسقاط 99.4% مستمرة" },
    ],
    serviceIds: ["svc-govt-cloud"],
  },
  {
    id: "INC-2026-3024",
    title: { en: "Mecca peak — RAN congestion advisory", ar: "ذروة مكة — تحذير ازدحام RAN" },
    description: {
      en: "Pre-Hajj traffic profile beginning. Predictive model flags 88% probability of cell overload by week 22.",
      ar: "بدء ملف حركة ما قبل الحج. النموذج يتوقع احتمال 88% للتحميل الزائد بحلول الأسبوع 22.",
    },
    severity: "p3",
    status: "monitoring",
    openedAt: "2026-04-29T08:00:00Z",
    affectedSiteIds: ["MEC-EDGE-01"],
    affectedCustomers: 0,
    rootCauseHypothesis: { en: "Seasonal pilgrim density growth", ar: "نمو كثافة الحجاج الموسمي" },
    recommendedAction: { en: "Activate Hajj capacity playbook, deploy COWs by week 21", ar: "تفعيل خطة الحج، نشر محطات متنقّلة بالأسبوع 21" },
    evidence: [
      { en: "Predictive model 88% confidence", ar: "النموذج التنبؤي بثقة 88%" },
    ],
    serviceIds: ["svc-hajj-operator"],
  },
  {
    id: "INC-2026-3018",
    title: { en: "Microwave fade · RAK-Muscat link", ar: "تدهور موجي · رابط رأس الخيمة-مسقط" },
    description: {
      en: "Atmospheric fade event on L-050 microwave segment. Traffic auto-routed via fibre, no customer impact.",
      ar: "حدث تدهور جوي على المقطع الموجي L-050. توجيه آلي عبر الألياف، دون أثر على العملاء.",
    },
    severity: "p4",
    status: "monitoring",
    openedAt: "2026-05-01T05:42:00Z",
    affectedSiteIds: ["RAK-EDGE-01", "MCT-EDGE-02"],
    affectedCustomers: 0,
    rootCauseHypothesis: { en: "Weather — heavy rain attenuation", ar: "طقس — توهين أمطار غزيرة" },
    recommendedAction: { en: "No action — auto-recovered at 06:14", ar: "لا إجراء — استعادة آلية 06:14" },
    evidence: [
      { en: "Restored autonomously at 06:14:22", ar: "استعيد آلياً 06:14:22" },
    ],
    serviceIds: [],
  },
];

// ── Services / SLA (4) ──────────────────────────────────────────────────
export const SERVICES: ServiceSla[] = [
  {
    id: "svc-port-logistics",
    name: { en: "Port Logistics MPLS", ar: "MPLS لوجستيات الميناء" },
    customer: { en: "Sharjah Port Authority", ar: "هيئة ميناء الشارقة" },
    slaPct: 99.95,
    currentPct: 99.41,
    status: "breached",
    monthlyCreditAtRisk: 124_000,
    dependsOnSiteIds: ["SHJ-EDGE-04", "SHJ-AGG-01", "DXB-CORE-01"],
  },
  {
    id: "svc-bank-vpn",
    name: { en: "Banking VPN — Eastern Province", ar: "VPN مصرفي — المنطقة الشرقية" },
    customer: { en: "Al-Khaleej Bank", ar: "بنك الخليج" },
    slaPct: 99.9,
    currentPct: 99.84,
    status: "at-risk",
    monthlyCreditAtRisk: 56_000,
    dependsOnSiteIds: ["DMM-CORE-01", "DMM-AGG-02"],
  },
  {
    id: "svc-govt-cloud",
    name: { en: "Government Cloud Interconnect", ar: "وصلة السحابة الحكومية" },
    customer: { en: "Qatar Digital Authority", ar: "الهيئة الرقمية القطرية" },
    slaPct: 99.99,
    currentPct: 99.97,
    status: "ok",
    monthlyCreditAtRisk: 0,
    dependsOnSiteIds: ["DOH-CORE-01", "DOH-DC-01"],
  },
  {
    id: "svc-hajj-operator",
    name: { en: "Hajj Operator Capacity Pool", ar: "حوض سعة مشغّل الحج" },
    customer: { en: "Mecca Pilgrim Services", ar: "خدمات حجّاج مكة" },
    slaPct: 99.5,
    currentPct: 99.6,
    status: "ok",
    monthlyCreditAtRisk: 0,
    dependsOnSiteIds: ["MEC-EDGE-01", "JED-CORE-01"],
  },
];

// ── Crews (8) ───────────────────────────────────────────────────────────
export const CREWS: Crew[] = [
  { id: "crew-shj-01", name: { en: "Sharjah Crew 1", ar: "فريق الشارقة 1" }, lead: { en: "Khaled Al-Marri", ar: "خالد المرّي" }, city: { en: "Sharjah", ar: "الشارقة" }, lat: 25.30, lng: 55.43, status: "dispatched", etaMin: 28, assignedIncidentId: "INC-2026-3041" },
  { id: "crew-shj-02", name: { en: "Sharjah Crew 2", ar: "فريق الشارقة 2" }, lead: { en: "Yousef Al-Hammadi", ar: "يوسف الحمادي" }, city: { en: "Sharjah", ar: "الشارقة" }, lat: 25.34, lng: 55.40, status: "available", etaMin: undefined },
  { id: "crew-dxb-01", name: { en: "Dubai Crew 1", ar: "فريق دبي 1" }, lead: { en: "Hamza Al-Falasi", ar: "حمزة الفلاسي" }, city: { en: "Dubai", ar: "دبي" }, lat: 25.18, lng: 55.27, status: "available", etaMin: undefined },
  { id: "crew-auh-01", name: { en: "Abu Dhabi Crew 1", ar: "فريق أبوظبي 1" }, lead: { en: "Saif Al-Mansoori", ar: "سيف المنصوري" }, city: { en: "Abu Dhabi", ar: "أبوظبي" }, lat: 24.45, lng: 54.40, status: "on-site", etaMin: 0, assignedIncidentId: "INC-2026-3038" },
  { id: "crew-dmm-01", name: { en: "Dammam Crew 1", ar: "فريق الدمام 1" }, lead: { en: "Faisal Al-Qahtani", ar: "فيصل القحطاني" }, city: { en: "Dammam", ar: "الدمام" }, lat: 26.42, lng: 50.10, status: "dispatched", etaMin: 42, assignedIncidentId: "INC-2026-3038" },
  { id: "crew-ruh-01", name: { en: "Riyadh Crew 1", ar: "فريق الرياض 1" }, lead: { en: "Abdulrahman Al-Otaibi", ar: "عبدالرحمن العتيبي" }, city: { en: "Riyadh", ar: "الرياض" }, lat: 24.71, lng: 46.67, status: "returning", etaMin: 18 },
  { id: "crew-jed-01", name: { en: "Jeddah Crew 1", ar: "فريق جدة 1" }, lead: { en: "Mohammed Al-Harbi", ar: "محمد الحربي" }, city: { en: "Jeddah", ar: "جدة" }, lat: 21.49, lng: 39.19, status: "available", etaMin: undefined },
  { id: "crew-doh-01", name: { en: "Doha Crew 1", ar: "فريق الدوحة 1" }, lead: { en: "Nasser Al-Kuwari", ar: "ناصر الكواري" }, city: { en: "Doha", ar: "الدوحة" }, lat: 25.29, lng: 51.53, status: "available", etaMin: undefined },
];

// ── Pending approvals ───────────────────────────────────────────────────
export const APPROVALS: ApprovalItem[] = [
  {
    id: "apv-001",
    incidentId: "INC-2026-3041",
    title: { en: "Approve rollback of TX-NORTH-04", ar: "اعتماد تراجع TX-NORTH-04" },
    detail: {
      en: "Topology reasoner narrowed the fault to the South-Sharjah feeder. Re-route via TX-NORTH-09 restores 78% of affected sessions in ~6 minutes; 22% require field crew.",
      ar: "حدّد المحلّل العطل في مغذّي جنوب الشارقة. إعادة التوجيه تستعيد 78% خلال 6 دقائق؛ 22% بحاجة لفريق ميداني.",
    },
    recommendation: { en: "Approve rollback & re-route", ar: "موافقة على التراجع وإعادة التوجيه" },
    confidence: 96,
    raisedBy: { en: "Mitigation Drafter", ar: "كاتب التخفيف" },
    raisedAt: "2026-05-01T14:09:00Z",
    severity: "p1",
  },
  {
    id: "apv-002",
    incidentId: "INC-2026-3041",
    title: { en: "File TDRA major-incident notification", ar: "إيداع إخطار TDRA للحادث الكبير" },
    detail: {
      en: "Filing draft uses TDRA template MI-A2, includes affected MSISDN count (84,310), root-cause hypothesis, and ETA-to-restore. 16 min remaining on the 30-min clock.",
      ar: "المسوّدة على نموذج MI-A2 وتضمّ 84,310 مشتركاً والسبب المفترض ووقت الاستعادة. 16 دقيقة متبقّية.",
    },
    recommendation: { en: "File now to preserve buffer", ar: "إيداع الآن للحفاظ على الهامش" },
    confidence: 94,
    raisedBy: { en: "Regulator Filer", ar: "كاتب الإيداع التنظيمي" },
    raisedAt: "2026-05-01T14:11:00Z",
    severity: "p1",
  },
  {
    id: "apv-003",
    incidentId: "INC-2026-3038",
    title: { en: "Schedule ROADM line-card swap", ar: "جدولة استبدال بطاقة ROADM" },
    detail: {
      en: "Vendor advisory confirms known defect on this card revision. Maintenance window 02:00–04:00 with traffic re-routed via L-043 has lowest customer impact.",
      ar: "تنبيه المورد يؤكد عيباً معروفاً. نافذة 02:00–04:00 مع التحويل عبر L-043 أقل أثر.",
    },
    recommendation: { en: "Approve and notify enterprise tenant", ar: "اعتماد وإخطار العميل المؤسسي" },
    confidence: 89,
    raisedBy: { en: "Topology Reasoner", ar: "محلّل الطوبولوجيا" },
    raisedAt: "2026-05-01T13:30:00Z",
    severity: "p2",
  },
  {
    id: "apv-005",
    incidentId: "INC-2026-3041",
    title: { en: "Approve customer notification SMS + email", ar: "اعتماد رسالة SMS والبريد للعميل" },
    detail: {
      en: "Bilingual draft (EN/AR) explains the Sharjah-South service issue, ETA-to-restore (~32 min), and a 5% goodwill credit. Targeted to 84,310 affected MSISDNs and the Sharjah Port Authority NOC contact.",
      ar: "مسوّدة ثنائية اللغة تشرح المشكلة في جنوب الشارقة، وقت الاستعادة (~32 دقيقة)، ورصيد حسن نية 5%. مستهدفة 84,310 مشتركاً وجهة اتصال هيئة ميناء الشارقة.",
    },
    recommendation: { en: "Send now — silence costs trust", ar: "أرسل الآن — الصمت يكلّف الثقة" },
    confidence: 92,
    raisedBy: { en: "Comms Agent", ar: "وكيل الاتصالات" },
    raisedAt: "2026-05-01T14:13:00Z",
    severity: "p1",
  },
  {
    id: "apv-006",
    incidentId: "INC-2026-3041",
    title: { en: "Confirm field crew dispatch to feeder km-21", ar: "تأكيد إرسال فريق ميداني إلى مغذّي كم 21" },
    detail: {
      en: "Crew SHJ-1 (Khaled Al-Marri, 4 engineers) is staged 28 min from the suspected break point. Approval finalises overtime budget and unlocks emergency civil-works permit.",
      ar: "فريق SHJ-1 (خالد المرّي، 4 مهندسين) على بعد 28 دقيقة من نقطة الكسر المتوقّعة. الموافقة تثبّت ميزانية الوقت الإضافي وتفتح تصريح الأشغال المدنية الطارئة.",
    },
    recommendation: { en: "Dispatch crew SHJ-1 now", ar: "إرسال فريق SHJ-1 الآن" },
    confidence: 95,
    raisedBy: { en: "Field Ops Coordinator", ar: "منسّق العمليات الميدانية" },
    raisedAt: "2026-05-01T14:08:00Z",
    severity: "p1",
  },
  {
    id: "apv-004",
    incidentId: "INC-2026-3024",
    title: { en: "Activate Hajj capacity playbook", ar: "تفعيل خطة سعة الحج" },
    detail: {
      en: "Predictive model flags 88% probability of cell overload at MEC-EDGE-01 by week 22. Standard playbook deploys 6 cells-on-wheels and 2 backhaul links by week 21.",
      ar: "النموذج يتوقع احتمال 88% للتحميل الزائد بمكة بحلول الأسبوع 22. الخطة تنشر 6 محطات متنقلة بالأسبوع 21.",
    },
    recommendation: { en: "Approve early activation", ar: "اعتماد التفعيل المبكر" },
    confidence: 88,
    raisedBy: { en: "Topology Reasoner", ar: "محلّل الطوبولوجيا" },
    raisedAt: "2026-04-30T08:15:00Z",
    severity: "p3",
  },
];

// ── Audit log ───────────────────────────────────────────────────────────
export const AUDIT: AuditEntry[] = [
  { id: "a-001", ts: "2026-05-01T14:03:00Z", actor: { en: "Telemetry Watcher", ar: "مراقب القياس" }, action: { en: "Detected packet loss spike", ar: "كشف ارتفاع فقد الحزم" }, detail: { en: "4 cells in Sharjah-South, loss 9.4–14.2%", ar: "4 خلايا بفقد 9.4–14.2%" }, kind: "agent" },
  { id: "a-002", ts: "2026-05-01T14:04:00Z", actor: { en: "NOC Orchestrator", ar: "منسّق غرفة العمليات" }, action: { en: "Opened major-incident triage", ar: "فتح فرز الحادث الكبير" }, detail: { en: "Regulator clock started 30:00 budget", ar: "بدأ عدّاد المنظّم بميزانية 30:00" }, kind: "agent" },
  { id: "a-003", ts: "2026-05-01T14:06:00Z", actor: { en: "Topology Reasoner", ar: "محلّل الطوبولوجيا" }, action: { en: "Computed blast radius", ar: "حساب نطاق التأثير" }, detail: { en: "Root: fibre cut · 84,310 MSISDNs · 1 enterprise SLA", ar: "السبب: قطع ألياف · 84,310 مشترك · اتفاقية واحدة" }, kind: "agent" },
  { id: "a-004", ts: "2026-05-01T14:08:00Z", actor: { en: "Mitigation Drafter", ar: "كاتب التخفيف" }, action: { en: "Drafted rollback plan", ar: "صياغة خطة التراجع" }, detail: { en: "Re-route via TX-NORTH-09 · restores 78% in 6 min", ar: "إعادة التوجيه عبر TX-NORTH-09 · 78% خلال 6 دقائق" }, kind: "agent" },
  { id: "a-005", ts: "2026-05-01T14:09:30Z", actor: { en: "Reem Al-Dosari", ar: "ريم الدوسري" }, action: { en: "Approved rollback", ar: "اعتماد التراجع" }, detail: { en: "Approved with default re-route, dispatched crew-shj-01", ar: "اعتماد بإعادة التوجيه الافتراضية، إرسال فريق-shj-01" }, kind: "human" },
  { id: "a-006", ts: "2026-05-01T14:11:34Z", actor: { en: "NOC Orchestrator", ar: "منسّق غرفة العمليات" }, action: { en: "Executed rollback", ar: "تنفيذ التراجع" }, detail: { en: "Loss < 1% on 3 of 4 cells; 22% await field crew", ar: "الفقد < 1% على 3 خلايا؛ 22% ينتظرون الفريق" }, kind: "system" },
  { id: "a-007", ts: "2026-05-01T13:21:00Z", actor: { en: "Telemetry Watcher", ar: "مراقب القياس" }, action: { en: "Optical SNR alarm", ar: "إنذار SNR ضوئي" }, detail: { en: "DMM-AGG-02 SNR 14.2 dB (target 18+)", ar: "SNR 14.2 ديسيبل (هدف 18+)" }, kind: "agent" },
  { id: "a-008", ts: "2026-05-01T12:48:00Z", actor: { en: "Telemetry Watcher", ar: "مراقب القياس" }, action: { en: "Volumetric attack detected", ar: "كشف هجوم حجمي" }, detail: { en: "14 Gbps UDP reflection at DOH-EDGE-02 customer prefix", ar: "14 جيجابت انعكاس UDP" }, kind: "agent" },
  { id: "a-009", ts: "2026-05-01T12:50:00Z", actor: { en: "Mitigation Drafter", ar: "كاتب التخفيف" }, action: { en: "Engaged scrubbing centre", ar: "تفعيل مركز التنقية" }, detail: { en: "Auto-policy applied · 99.4% drop ratio sustained", ar: "سياسة آلية مطبّقة · 99.4% إسقاط مستمر" }, kind: "agent" },
  { id: "a-010", ts: "2026-04-30T19:15:00Z", actor: { en: "Telemetry Watcher", ar: "مراقب القياس" }, action: { en: "Capacity threshold breach", ar: "تجاوز عتبة السعة" }, detail: { en: "RUH-EDGE-04 evening peak 71%", ar: "ذروة مساء 71%" }, kind: "agent" },
  { id: "a-011", ts: "2026-04-30T08:15:00Z", actor: { en: "Topology Reasoner", ar: "محلّل الطوبولوجيا" }, action: { en: "Hajj capacity advisory", ar: "تحذير سعة الحج" }, detail: { en: "MEC-EDGE-01 overload risk 88% by W22", ar: "مخاطر تحميل زائد 88% بـ مكة بحلول W22" }, kind: "agent" },
  { id: "a-012", ts: "2026-05-01T05:42:00Z", actor: { en: "Telemetry Watcher", ar: "مراقب القياس" }, action: { en: "Microwave fade event", ar: "حدث تدهور موجي" }, detail: { en: "L-050 atmospheric fade · auto-recovered 06:14", ar: "تدهور جوي L-050 · استعادة آلية 06:14" }, kind: "system" },
];

// ── KPI helper ──────────────────────────────────────────────────────────
export interface KpiSnapshot {
  p1: number;
  p2: number;
  p3: number;
  mttrMin: number;
  mttrDeltaPct: number;
  slaAtRisk: number;
  customersImpacted: number;
  decisionsWaiting: number;
}

export function computeKpis(): KpiSnapshot {
  const open = INCIDENTS.filter((i) => i.status !== "resolved");
  return {
    p1: open.filter((i) => i.severity === "p1").length,
    p2: open.filter((i) => i.severity === "p2").length,
    p3: open.filter((i) => i.severity === "p3").length,
    mttrMin: 24,
    mttrDeltaPct: -38,
    slaAtRisk: SERVICES.filter((s) => s.status !== "ok").length,
    customersImpacted: open.reduce((s, i) => s + i.affectedCustomers, 0),
    decisionsWaiting: APPROVALS.length + 2,
  };
}

export function siteById(id: string) {
  return SITES.find((s) => s.id === id);
}
export function incidentById(id: string) {
  return INCIDENTS.find((i) => i.id === id);
}
export function serviceById(id: string) {
  return SERVICES.find((s) => s.id === id);
}
