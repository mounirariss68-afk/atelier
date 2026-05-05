import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Wallet, ShieldCheck, ClipboardList, Activity, AlertTriangle,
  TrendingUp, FileText, Clock, CheckCircle2, CalendarClock,
  X, ChevronDown, ChevronUp, Brain, Banknote, Calculator,
  Send, FileSignature, Sparkles, BadgeCheck,
  ArrowRight, ChevronRight,
} from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { useManagerFilters } from "../TasamaDashboardContext";
import { operations, shell } from "../tasama-i18n";
import {
  generateQuickStats, generateOperationsDigest, generateActivityLog, generatePayrollAlerts,
  generatePayrollRecommendations, generateDecisionAnalytics,
} from "@/data/tasama-agent";
import type { PayrollActivityEntry, PayrollAlert } from "@/data/tasama-agent";
import {
  formatSAR, getAgentName, getCalendarEventName,
} from "@/data/tasama-seed";
import type { PayrollRole, TasamaAgentId } from "@/data/tasama-seed";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Brand tokens (FIX 13)
const BRAND_BLUE = "#2E4DA7";
const BRAND_NAVY = "#1F3864";
const SUBTITLE_COLOR = "#4B5563";

// FIX 3 — agent activity icons by type
const TYPE_ICON: Record<string, React.ReactNode> = {
  extraction: <FileText size={11} />,
  calculation: <Calculator size={11} />,
  filing: <FileSignature size={11} />,
  transfer: <Send size={11} />,
  monitoring: <ShieldCheck size={11} />,
  communication: <Send size={11} />,
  audit: <BadgeCheck size={11} />,
  orchestration: <Sparkles size={11} />,
};
const TYPE_BG: Record<string, string> = {
  extraction: "bg-indigo-50 text-indigo-700",
  calculation: "bg-blue-50 text-blue-700",
  filing: "bg-emerald-50 text-emerald-700",
  transfer: "bg-cyan-50 text-cyan-700",
  monitoring: "bg-amber-50 text-amber-700",
  communication: "bg-violet-50 text-violet-700",
  audit: "bg-purple-50 text-purple-700",
  orchestration: "bg-rose-50 text-rose-700",
};

// FIX 1 / FIX 7 — alert role mapping (derived at view layer; doesn't mutate data)
const ALERT_ROLE: Record<string, PayrollRole> = {
  "alert-001": "compliance-officer", // GOSI filing
  "alert-002": "compliance-officer", // Saudization band
  "alert-003": "compliance-officer", // Iqama renewal
  "alert-004": "finance-controller", // Final settlement (finance approval)
  "alert-005": "payroll-manager",    // Agent drift
  "alert-006": "payroll-manager",    // Document extractions
  "alert-007": "compliance-officer", // Mudad WPS — per spec, Mudad → Compliance
  "alert-008": "payroll-manager",    // Maternity leave
  "alert-009": "payroll-manager",    // Vacation advance
  "alert-010": "finance-controller", // Retroactive adjustment (payroll run)
};

// FIX 2 / FIX 7 — view-layer role override per spec for recommendations.
// Generator data (rec.targetRole) is sometimes routed by approval responsibility
// (e.g. salary increases route to Finance Controller for budget sign-off), but
// the spec wants the dashboard chips/filtering to reflect the originating
// functional role. We override here without mutating the data layer.
const REC_ROLE_OVERRIDE: Record<string, PayrollRole> = {
  // Salary adjustments — Payroll Manager domain
  "rec-002": "payroll-manager", // Noura Al-Salem salary increase
  "rec-006": "payroll-manager", // Sarah Johnson Q1 performance bonus
};

// FIX 7 — agent → role mapping for activity feed highlighting
const AGENT_ROLE: Record<TasamaAgentId, PayrollRole> = {
  "payroll-orchestrator": "payroll-manager",
  "document-intelligence": "payroll-manager",
  "salary-calculation": "payroll-manager",
  "gosi-compliance": "compliance-officer",
  "mudad-bank-transfer": "compliance-officer", // Mudad/WPS → Compliance per spec
  "eosb-provision": "finance-controller",
  "leave-management": "payroll-manager",
  "saudization-monitor": "compliance-officer",
  "performance-audit": "compliance-officer",
  "client-communications": "payroll-manager",
};

const ROLE_ICON: Record<PayrollRole, React.ReactNode> = {
  "payroll-manager": <Wallet size={9} />,
  "finance-controller": <FileText size={9} />,
  "compliance-officer": <ShieldCheck size={9} />,
};

const ROLE_LABEL_KEY: Record<PayrollRole, string> = {
  "payroll-manager": "rolePayrollManager",
  "finance-controller": "roleFinanceController",
  "compliance-officer": "roleComplianceOfficer",
};

// FIX 1 — sign-off vs review CTA (settlement / sign-off requires sign-off; rest is review)
function alertCta(a: PayrollAlert): "signOff" | "review" {
  const t = `${a.title} ${a.detail}`.toLowerCase();
  if (t.includes("settlement") || t.includes("sign-off") || t.includes("sign off") || t.includes("e-signature") || t.includes("اعتماد") || t.includes("توقيع")) {
    return "signOff";
  }
  return "review";
}

// FIX 2 — confidence threshold tone
function confidenceTone(conf: number) {
  if (conf >= 95) return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", tooltipKey: "confidenceTooltipHigh" };
  if (conf >= 80) return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", tooltipKey: "confidenceTooltipMid" };
  return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", tooltipKey: "confidenceTooltipLow" };
}

// FIX 5 — pipeline state (per-client current step in 5-stage rail)
const PIPELINE_CURRENT: Record<string, number> = {
  "client-alnakhla": 0, // Ingest
  "client-luma": 1,     // Calculate
  "client-vertex": 2,   // Approve
};

// FIX 5 — status chip per pipeline step
const STATUS_BY_STEP: { labelKey: string; bg: string; text: string; ring: string }[] = [
  { labelKey: "statusAwaitingData", bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
  { labelKey: "statusCalculating", bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-200" },
  { labelKey: "statusAwaitingApproval", bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
  { labelKey: "statusFiling", bg: "bg-violet-50", text: "text-violet-700", ring: "ring-violet-200" },
  { labelKey: "statusSettling", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
];

// FIX 9 — calendar event emoji prefixes (per spec: 📋 filings, ✅ confirmations, 📅 default)
function calendarEmoji(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("gosi") || c.includes("mudad") || c.includes("wps") || c.includes("filing") || c.includes("bank")) return "📋";
  if (c.includes("saudization") || c.includes("nitaqat") || c.includes("confirm") || c.includes("review")) return "✅";
  if (c.includes("leave") || c.includes("maternity")) return "📅";
  return "📅";
}

// FIX 9 — explicit "27 Apr 2026" formatting (en-GB style for EN, ar-SA for AR)
function formatCalendarDate(iso: string, isAr: boolean): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  if (isAr) {
    return d.toLocaleDateString("ar-SA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  // en-GB → "27 Apr 2026"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// FIX 9 / FIX 12 — calendar urgency border (RTL-aware via border-s-*)
function calendarUrgencyClasses(daysToDue: number) {
  const base = "border-s-4";
  if (daysToDue < 0) return `${base} border-s-red-500 bg-red-50/30`;
  if (daysToDue <= 7) return `${base} border-s-amber-500 bg-amber-50/30`;
  if (daysToDue <= 30) return `${base} border-s-yellow-400 bg-yellow-50/20`;
  return `${base} border-s-gray-200`;
}

// FIX 3 — status dot color from subtitle keywords
function activityDotTone(text: string): string {
  const t = text.toLowerCase();
  if (/(awaiting|pending|review|required|needed|بانتظار|مطلوب|مراجعة)/.test(t)) return "bg-red-500";
  if (/(completed|approved|filed|settled|submitted|transferred|done|success|مكتمل|اعتُمد|قُدّم|تم)/.test(t)) return "bg-emerald-500";
  return "bg-blue-400";
}

// FIX 3 — does the entry need an inline "Review →" link?
function activityNeedsReview(text: string): boolean {
  const t = text.toLowerCase();
  return /(awaiting|pending|بانتظار)/.test(t);
}

export default function OperationsDashboardView({ onOpenView }: { onOpenView?: (view: string, opts?: { clientId?: string }) => void }) {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const data = useTasamaData();
  const { filters } = useManagerFilters();

  // FIX 1 — per-row dismissal + whole-banner dismissal
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const stats = generateQuickStats(lang);
  const digest = generateOperationsDigest();
  const analytics = generateDecisionAnalytics();
  const activityAll = useMemo(() => generateActivityLog(), []);
  const allAlerts = useMemo(() => generatePayrollAlerts(), []);
  const recsAll = useMemo(() => generatePayrollRecommendations().filter((r) => r.status === "pending"), []);

  // FIX 7 — apply role filter to alerts
  const alerts = useMemo(() => {
    return allAlerts.filter((a) => {
      if (a.severity !== "critical" && a.severity !== "high") return false;
      if (filters.role !== "all") {
        const role = ALERT_ROLE[a.id];
        if (role !== filters.role) return false;
      }
      return true;
    });
  }, [allAlerts, filters.role]);

  // FIX 2 / FIX 7 — apply view-layer role override, then filter by role
  const recs = useMemo(() => {
    return recsAll
      .map((r) => ({ ...r, targetRole: REC_ROLE_OVERRIDE[r.id] ?? r.targetRole }))
      .filter((r) => filters.role === "all" || r.targetRole === filters.role);
  }, [recsAll, filters.role]);

  // FIX 1 — banner alerts (4 most urgent, minus per-row dismissed)
  const bannerAlerts = useMemo(
    () => alerts.filter((a) => !dismissedAlertIds.has(a.id)).slice(0, 4),
    [alerts, dismissedAlertIds],
  );

  const upcoming = useMemo(() => {
    return [...data.regulatoryCalendar]
      .filter((c) => c.type === "upcoming" && (filters.clientId === "all" || !c.clientId || c.clientId === filters.clientId))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6);
  }, [data.regulatoryCalendar, filters.clientId]);

  const saudiSplit = useMemo(() => {
    const saudi = data.employees.filter((e) => e.isSaudi).length;
    const expat = data.employees.length - saudi;
    return { saudi, expat, ratio: data.employees.length ? (saudi / data.employees.length) * 100 : 0 };
  }, [data.employees]);

  // Per-client May 2026 in-preparation cycle status
  const cycleStatus = useMemo(() => {
    const NOW = new Date("2026-05-05T00:00:00Z");
    return data.clients.map((c) => {
      const inPrep = data.payrollRuns.find((r) => r.clientId === c.id && r.status === "in-preparation");
      const cutoff = inPrep ? new Date(Date.UTC(inPrep.periodYear, inPrep.periodMonth - 1, c.payrollCutoffDay)) : null;
      const days = cutoff ? Math.max(0, Math.ceil((cutoff.getTime() - NOW.getTime()) / 86_400_000)) : null;
      const settle = inPrep ? new Date(Date.UTC(inPrep.periodYear, inPrep.periodMonth - 1, 27)) : null;
      return {
        client: c,
        inPrep,
        cutoff,
        settle,
        days,
        urgent: days !== null && days <= 7,
        currentStep: PIPELINE_CURRENT[c.id] ?? 0,
      };
    }).filter((row) => filters.clientId === "all" || row.client.id === filters.clientId);
  }, [data.clients, data.payrollRuns, filters.clientId]);

  // FIX 8 — operations digest with bullets cleaned + 2 narrative bullets prepended
  const cleanedBullets = useMemo(() => {
    const filtered = digest.bullets.filter((b) => {
      const lower = b.toLowerCase();
      return !lower.includes("extraction confidence") && !lower.includes("gosi contribution") && !lower.includes("total gosi");
    });
    return [
      t("digestBulletStaged", operations),
      t("digestBulletNextAction", operations),
      ...filtered,
    ];
  }, [digest.bullets, t]);

  // FIX 3 — group activity into time buckets and slice 8 by default
  const activityBuckets = useMemo(() => {
    const NOW = new Date("2026-05-05T12:00:00Z").getTime();
    const buckets: { key: string; labelKey: string; items: PayrollActivityEntry[] }[] = [
      { key: "lastHour", labelKey: "activityBucketLastHour", items: [] },
      { key: "today", labelKey: "activityBucketToday", items: [] },
      { key: "yesterday", labelKey: "activityBucketYesterday", items: [] },
      { key: "earlier", labelKey: "activityBucketEarlier", items: [] },
    ];
    activityAll.forEach((a) => {
      const ageH = (NOW - new Date(a.timestamp).getTime()) / 3_600_000;
      if (ageH < 1) buckets[0].items.push(a);
      else if (ageH < 12) buckets[1].items.push(a);
      else if (ageH < 36) buckets[2].items.push(a);
      else buckets[3].items.push(a);
    });
    return buckets.filter((b) => b.items.length > 0);
  }, [activityAll]);

  const visibleActivity = useMemo(() => {
    if (activityExpanded) return activityBuckets;
    let count = 0;
    const out: typeof activityBuckets = [];
    for (const b of activityBuckets) {
      if (count >= 8) break;
      const remaining = 8 - count;
      out.push({ ...b, items: b.items.slice(0, remaining) });
      count += Math.min(b.items.length, remaining);
    }
    return out;
  }, [activityBuckets, activityExpanded]);
  const activityTotal = activityAll.length;
  const activityVisibleCount = visibleActivity.reduce((s, b) => s + b.items.length, 0);

  const dueLabel = (iso: string) => {
    const due = new Date(iso).getTime();
    const now = new Date("2026-05-05T00:00:00Z").getTime();
    const days = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    if (days < 0) return { text: t("overdue", operations), tone: "text-red-600", days };
    if (days === 0) return { text: t("today", operations), tone: "text-red-600", days };
    if (days === 1) return { text: t("tomorrow", operations), tone: "text-orange-600", days };
    if (days <= 7) return { text: `${days} ${t("daysAway", operations)}`, tone: "text-amber-600", days };
    if (days <= 30) return { text: `${days} ${t("daysAway", operations)}`, tone: "text-yellow-700", days };
    return { text: `${days} ${t("daysAway", operations)}`, tone: "text-gray-500", days };
  };

  // Stat helpers
  const overdueCount = 2; // demo constant — paired with stats.openRequests for "X open · 2 overdue"
  const upcoming90 = stats.upcomingEvents;

  return (
    <div className="space-y-6">
      {/* FIX 1 — Critical alerts banner with per-row dismiss + sign-off CTA */}
      <AnimatePresence>
        {!bannerDismissed && bannerAlerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
            className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-orange-500 text-white flex items-center justify-center">
                  <AlertTriangle size={14} />
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-900">{t("criticalAlertsBanner", operations)}</p>
                  <p className="text-[11px]" style={{ color: SUBTITLE_COLOR }}>
                    {bannerAlerts.length} {bannerAlerts.length === 1 ? t("alertCountSingular", operations) : t("alertCountPlural", operations)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBannerDismissed(true)}
                className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/50"
              >
                <X size={12} />
                {t("dismiss", operations)}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <AnimatePresence initial={false}>
                {bannerAlerts.map((a) => {
                  const role = ALERT_ROLE[a.id];
                  const cta = alertCta(a);
                  const ctaKey = cta === "signOff" ? "signOffArrow" : "reviewArrow";
                  const ctaTone = cta === "signOff" ? "text-indigo-700" : "text-orange-600";
                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95, height: 0, marginTop: 0 }}
                      className="bg-white rounded-xl border border-orange-100 p-3 flex items-start gap-2.5 group hover:shadow-md transition-shadow"
                    >
                      <button
                        onClick={() => onOpenView?.("approvals")}
                        className="text-start flex items-start gap-2.5 min-w-0 flex-1"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                          a.severity === "critical" ? "bg-red-500" : "bg-orange-500"
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-900 line-clamp-2">{a.title}</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            {role && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                {ROLE_ICON[role]}
                                {t(ROLE_LABEL_KEY[role], shell)}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold ${ctaTone} group-hover:underline flex-shrink-0`}>
                              {t(ctaKey, operations)}
                            </span>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDismissedAlertIds((s) => new Set(s).add(a.id)); }}
                        className="p-1 -m-1 text-gray-300 hover:text-gray-600 rounded flex-shrink-0"
                        aria-label={t("dismiss", operations)}
                        title={t("dismiss", operations)}
                      >
                        <X size={11} />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title + subtitle (FIX 13) */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t("title", operations)}</h2>
        <p className="text-sm mt-1" style={{ color: SUBTITLE_COLOR }}>{t("subtitle", operations)}</p>
      </div>

      {/* Operations digest hero (FIX 8 — narrative bullets + brand-blue) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="text-white rounded-2xl p-6 shadow-lg"
        style={{ background: `linear-gradient(135deg, ${BRAND_NAVY} 0%, ${BRAND_BLUE} 50%, #3B82F6 100%)` }}
      >
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-blue-100 font-bold">{t("digest", operations)}</div>
          <div className="text-[10px] text-blue-100">{t("digestSubtitle", operations)}</div>
        </div>
        <h3 className="text-lg font-bold mt-2 leading-snug">{digest.headline}</h3>
        <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-blue-50">
          {cleanedBullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-blue-200" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </motion.div>

      {/* FIX 4 — KPI section: 6 cards (2x3 grid) */}
      <SectionHeader title={t("kpiSectionThisMonth", operations)} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Kpi
          icon={<Users size={16} />}
          label={t("kpiClients", operations)}
          value={`${stats.clientCount}`}
          sub={`${stats.employeeCount} ${t("kpiClientsSubEmployees", operations)}`}
          trend={{ direction: "flat", value: t("trendUnchanged", operations), suffix: t("trendVsMar", operations) }}
        />
        <Kpi
          icon={<Wallet size={16} />}
          label={t("kpiMonthlyGross", operations)}
          value={formatSAR(stats.monthlyGross)}
          sub={`${formatSAR(stats.monthlyGosi)} ${t("kpiMonthlyGosi", operations)}`}
          trend={{ direction: "up", value: "+2.4%", suffix: t("trendVsMar", operations) }}
        />
        <Kpi
          icon={<ClipboardList size={16} />}
          label={t("kpiOpenRequests", operations)}
          value={`${stats.openRequests}`}
          subRich={(
            <span>
              <span className="text-gray-700 font-semibold">{stats.openRequests} {t("kpiOpenOpenWord", operations)}</span>
              <span className="text-gray-400 mx-1">·</span>
              <span className="text-red-600 font-bold">{overdueCount} {t("kpiOpenOverdueWord", operations)}</span>
            </span>
          )}
          trend={{ direction: "down", value: "−2", suffix: t("trendVsLastWeek", operations), positiveDown: true }}
        />
        <Kpi
          icon={<CalendarClock size={16} />}
          label={t("kpiUpcomingDeadlinesCard", operations)}
          value={`${upcoming90}`}
          sub={t("kpiUpcomingDeadlinesSub", operations)}
          trend={{ direction: "flat", value: t("trendUnchanged", operations), suffix: t("trendVsLastWeek", operations) }}
        />
        <Kpi
          icon={<ShieldCheck size={16} />}
          label={t("kpiDocAccuracyLabel", operations)}
          value={`${(stats.avgConfidence * 100).toFixed(1)}%`}
          sub={t("kpiDocAccuracySub", operations)}
          trend={{ direction: "up", value: "+0.3%", suffix: t("trendVsMar", operations) }}
        />
        <Kpi
          icon={<Sparkles size={16} />}
          label={t("kpiAutomationLabel", operations)}
          value={`${analytics.automationRate}%`}
          sub={t("kpiAutomationSub", operations)}
          trend={{ direction: "up", value: "+1.4%", suffix: t("trendVsMar", operations) }}
        />
      </div>

      {/* FIX 13 — divider */}
      <div className="border-t border-gray-200" />

      {/* FIX 5 — Per-client May 2026 cycle pipeline rail */}
      {cycleStatus.length > 0 && cycleStatus.some((r) => r.inPrep) && (
        <>
          <SectionHeader
            icon={<CalendarClock size={14} className="text-[#2E4DA7]" />}
            title={t("cyclesTitle", operations)}
            rightSlot={<span className="text-[10px] text-gray-400">{t("cyclesAsOf", operations)}</span>}
          />
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {cycleStatus.filter((r) => r.inPrep).map(({ client, inPrep, cutoff, settle, days, urgent, currentStep }) => (
              <PipelineRow
                key={client.id}
                clientName={isAr ? client.legalNameAr : client.legalNameEn}
                empCount={inPrep!.employeeCount}
                gross={inPrep!.totalGross}
                cutoff={cutoff}
                settle={settle}
                days={days!}
                urgent={urgent}
                currentStep={currentStep}
                isAr={isAr}
                t={t}
                onClick={() => onOpenView?.("portfolio", { clientId: client.id })}
              />
            ))}
          </motion.div>

          <div className="border-t border-gray-200" />
        </>
      )}

      {/* FIX 6 — Process efficiency: this month */}
      <SectionHeader title={t("processEffTitle", operations)} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SaudiSplit saudi={saudiSplit.saudi} expat={saudiSplit.expat} ratio={saudiSplit.ratio} t={t} isAr={isAr} />

        {/* Approval Rate with 3-row breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(46,77,167,0.08)", color: BRAND_BLUE }}><TrendingUp size={16} /></span>
            <span className="text-[10px] uppercase tracking-wider font-semibold">{t("processApprovalRate", operations)}</span>
          </div>
          <div className="text-xl font-extrabold text-gray-900 mt-2">{analytics.overallApprovalRate}%</div>
          <div className="mt-2 space-y-1 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t("approvalBreakdownAuto", operations)}
              </span>
              <span className="font-bold text-gray-900">{Math.max(0, Math.round((analytics.overallApprovalRate - analytics.overallModificationRate) * 10) / 10)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {t("approvalBreakdownModified", operations)}
              </span>
              <span className="font-bold text-gray-900">{analytics.overallModificationRate}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {t("approvalBreakdownRejected", operations)}
              </span>
              <span className="font-bold text-gray-900">{analytics.overallRejectionRate ?? Math.max(0, 100 - analytics.overallApprovalRate)}%</span>
            </div>
          </div>
        </div>

        <Kpi
          icon={<FileText size={16} />}
          label={t("processHumanTouch", operations)}
          value={`${analytics.humanTouchPointsPerCycle}`}
          sub={t("processSubAvgCycle", operations)}
          trend={{ direction: "down", value: "−1", suffix: t("trendVsMar", operations), positiveDown: true }}
          footer={<span className="text-emerald-600 font-bold">{t("targetHumanTouch", operations)}</span>}
        />
        <Kpi
          icon={<Clock size={16} />}
          label={t("processAvgDecision", operations)}
          value={`${analytics.byRole[0].avgDecisionTimeMinutes}m`}
          sub={t("processSubManager", operations)}
          trend={{ direction: "down", value: "−3m", suffix: t("trendVsMar", operations), positiveDown: true }}
          footer={<span className="text-emerald-600 font-bold">{t("targetDecisionTime", operations)}</span>}
        />
      </div>

      <div className="border-t border-gray-200" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FIX 3 — Activity feed (no inner scroll) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Activity size={16} style={{ color: BRAND_BLUE }} />
                {t("activityTitle", operations)}
              </h3>
              <p className="text-[11px] mt-0.5" style={{ color: SUBTITLE_COLOR }}>{t("activitySubtitle", operations)}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 tasama-live-pulse" />
              LIVE
            </div>
          </div>
          {/* Body — no scroll, natural flow */}
          <div>
            {visibleActivity.map((bucket) => (
              <div key={bucket.key}>
                <div className="px-5 py-2 bg-gray-50/60 border-b border-gray-100">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">
                    {t(bucket.labelKey, operations)}
                  </p>
                </div>
                <div className="divide-y divide-gray-50">
                  {bucket.items.map((a) => {
                    const ts = new Date(a.timestamp);
                    const minsAgo = Math.round((new Date("2026-05-05T12:00:00Z").getTime() - ts.getTime()) / 60000);
                    const ageLabel = minsAgo < 60 ? `${minsAgo}m` : `${Math.round(minsAgo / 60)}h`;
                    const absLabel = ts.toLocaleString(isAr ? "ar-SA" : "en-US", {
                      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    });
                    const dotColor = activityDotTone(`${a.action} ${a.detail}`);
                    const needsReview = activityNeedsReview(`${a.action} ${a.detail}`);
                    const entryRole = AGENT_ROLE[a.agent];
                    const roleMatch = filters.role !== "all" && entryRole === filters.role;
                    return (
                      <div
                        key={a.id}
                        className={`px-5 py-3 flex items-start gap-3 transition-colors ${
                          roleMatch ? "bg-blue-50/50 border-s-2 border-s-[#2E4DA7]" : "hover:bg-gray-50/50"
                        }`}
                      >
                        <div className="relative flex-shrink-0">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${TYPE_BG[a.type] ?? "bg-gray-50 text-gray-700"}`}>
                            {TYPE_ICON[a.type] ?? <Activity size={11} />}
                          </span>
                          {/* status dot */}
                          <span className={`absolute -bottom-0.5 -end-0.5 w-2 h-2 rounded-full ring-2 ring-white ${dotColor}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs truncate ${roleMatch ? "font-extrabold text-gray-900" : "font-semibold text-gray-900"}`}>
                              {getAgentName(a.agent, lang)}
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[10px] text-gray-400 flex-shrink-0 cursor-help">{ageLabel}</span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-[11px]">{absLabel}</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className={`text-xs mt-0.5 ${roleMatch ? "text-gray-900 font-semibold" : "text-gray-700"}`}>{a.action}</div>
                          <div className="text-[11px] mt-0.5 flex items-center justify-between gap-2" style={{ color: SUBTITLE_COLOR }}>
                            <span className="min-w-0 flex-1">{a.detail}</span>
                            {needsReview && (
                              <button
                                onClick={() => onOpenView?.("approvals")}
                                className="text-[10px] font-bold text-[#2E4DA7] hover:underline inline-flex items-center gap-0.5 flex-shrink-0"
                              >
                                {t("activityReview", operations)}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {activityTotal > 8 && (
            <div className="px-5 py-3 border-t border-gray-100">
              <button
                onClick={() => setActivityExpanded((v) => !v)}
                className="w-full text-[11px] font-bold text-[#2E4DA7] hover:underline flex items-center justify-center gap-1"
              >
                {activityExpanded ? (
                  <><ChevronUp size={12} />{t("activityShowLess", operations)}</>
                ) : (
                  <><ChevronDown size={12} />{t("activityShowEarlier", operations)} ({activityTotal - activityVisibleCount})</>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {/* Pending decisions (FIX 2) */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-gray-900">{t("pendingDecisionsTitle", operations)}</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-gray-300 hover:text-gray-500" aria-label="info">
                      <Brain size={11} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px] text-[11px]">
                    {t("pendingDecisionsHint", operations)}
                  </TooltipContent>
                </Tooltip>
              </div>
              <button onClick={() => onOpenView?.("approvals")} className="text-[10px] font-bold hover:underline flex items-center gap-1" style={{ color: BRAND_BLUE }}>
                {t("reviewAll", operations)}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {recs.slice(0, 4).map((r) => {
                const tone = confidenceTone(r.confidence);
                const role = r.targetRole;
                return (
                  <button
                    key={r.id} onClick={() => onOpenView?.("approvals")}
                    className="px-4 py-3 w-full text-start hover:bg-gray-50 block"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-900 line-clamp-2 flex-1">{r.title}</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold inline-flex items-center gap-0.5 cursor-help border ${tone.bg} ${tone.border} ${tone.text}`}>
                            <Brain size={9} />
                            {r.confidence}%
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[220px] text-[11px]">
                          {t(tone.tooltipKey, operations)}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {role && (
                      <div className="mt-1.5">
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {ROLE_ICON[role]}
                          {t(ROLE_LABEL_KEY[role], shell)}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
              {recs.length === 0 && (
                <div className="px-4 py-6 text-xs text-center text-gray-400">{t("emptyRecs", operations)}</div>
              )}
            </div>
          </div>

          {/* FIX 1 — De-emphasized full alerts list (sidebar) */}
          <div className="bg-gray-50/60 rounded-2xl border border-dashed border-gray-200">
            <div className="px-4 py-3 border-b border-dashed border-gray-200">
              <h3 className="text-xs font-bold text-gray-600 flex items-center gap-1.5">
                <AlertTriangle size={11} className="text-gray-400" />
                {t("sidebarAlertsTitle", operations)}
              </h3>
              <p className="text-[10px] mt-0.5 text-gray-500">{t("sidebarAlertsHint", operations)}</p>
            </div>
            <div className="divide-y divide-dashed divide-gray-200">
              {alerts.length === 0 ? (
                <div className="px-4 py-5 text-[11px] text-center text-gray-400">{t("emptyAlertsList", operations)}</div>
              ) : alerts.slice(0, 6).map((a) => {
                const role = ALERT_ROLE[a.id];
                return (
                  <div key={a.id} className="px-4 py-2.5 flex items-start gap-2 opacity-80">
                    <span className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${a.severity === "critical" ? "bg-red-400" : "bg-orange-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-gray-700 line-clamp-2">{a.title}</p>
                      {role && (
                        <p className="text-[9px] mt-0.5 text-gray-400 uppercase tracking-wider font-semibold">{t(ROLE_LABEL_KEY[role], shell)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FIX 9 — Calendar with relative-primary + formatDate */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <CalendarClock size={14} style={{ color: BRAND_BLUE }} />
                {t("calendarTitle", operations)}
              </h3>
              <p className="text-[10px] mt-0.5" style={{ color: SUBTITLE_COLOR }}>{t("calendarHint", operations)}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {upcoming.map((c) => {
                const due = dueLabel(c.dueDate);
                return (
                  <div key={c.id} className={`px-4 py-3 ${calendarUrgencyClasses(due.days)}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none mt-0.5" aria-hidden>{calendarEmoji(c.eventType ?? c.nameEn)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-900 leading-snug">{getCalendarEventName(c, lang)}</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {/* Relative label is PRIMARY */}
                          <span className={`text-xs font-bold ${due.tone}`}>{due.text}</span>
                          {/* Absolute date is SECONDARY (DD MMM YYYY) */}
                          <span className="text-[10px] text-gray-400">{formatCalendarDate(c.dueDate, isAr)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {upcoming.length === 0 && (
                <div className="px-4 py-6 text-xs text-center text-gray-400">{t("emptyCalendar", operations)}</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────
function SectionHeader({ icon, title, rightSlot }: { icon?: React.ReactNode; title: string; rightSlot?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-[11px] uppercase tracking-widest font-bold text-gray-700">{title}</h3>
      {rightSlot && <div className="ms-auto">{rightSlot}</div>}
    </div>
  );
}

// ─── KPI ──────────────────────────────────────────────────────────────────
function Kpi({
  icon, label, value, sub, subRich, trend, footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  subRich?: React.ReactNode;
  trend?: { direction: "up" | "down" | "flat"; value: string; suffix: string; positiveDown?: boolean };
  footer?: React.ReactNode;
}) {
  const trendTone = (() => {
    if (!trend) return "";
    if (trend.direction === "flat") return "text-gray-500";
    const positive = trend.positiveDown ? trend.direction === "down" : trend.direction === "up";
    return positive ? "text-emerald-600" : "text-red-600";
  })();
  const TrendIcon = trend?.direction === "up" ? TrendingUp : trend?.direction === "down" ? ChevronDown : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-gray-500">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(46,77,167,0.08)", color: BRAND_BLUE }}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-xl font-extrabold text-gray-900 mt-2">{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: SUBTITLE_COLOR }}>
        {subRich ?? sub}
      </div>
      {trend && (
        <div className={`mt-2 flex items-center gap-1 text-[10px] font-bold ${trendTone}`}>
          {TrendIcon && <TrendIcon size={10} />}
          <span>{trend.value}</span>
          <span className="text-gray-400 font-medium">{trend.suffix}</span>
        </div>
      )}
      {footer && <div className="mt-1.5 text-[10px]">{footer}</div>}
    </motion.div>
  );
}

// ─── Saudi/Expat split (FIX 6 + FIX 12 RTL) ──────────────────────────────
function SaudiSplit({ saudi, expat, ratio, t, isAr }: { saudi: number; expat: number; ratio: number; t: ReturnType<typeof useTasamaDemoT>; isAr: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-gray-500">
        <span>{t("saudiSplit", operations)} / {t("expatSplit", operations)}</span>
        <span className="font-extrabold" style={{ color: BRAND_BLUE }}>{ratio.toFixed(1)}%</span>
      </div>
      {/* Two-tone stacked bar — flex-row in LTR, flex-row-reverse in RTL */}
      <div className={`mt-3 h-2 bg-gray-100 rounded-full overflow-hidden flex ${isAr ? "flex-row-reverse" : ""}`}>
        <div className="h-full" style={{ width: `${ratio}%`, background: BRAND_BLUE }} />
        <div className="bg-amber-400 h-full" style={{ width: `${100 - ratio}%` }} />
      </div>
      {/* Two labelled chips below */}
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px]">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-[#2E4DA7] font-bold">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: BRAND_BLUE }} />
          {saudi} {t("saudiSplit", operations)} ({ratio.toFixed(1)}%)
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {expat} {t("expatSplit", operations)} ({(100 - ratio).toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

// ─── Pipeline row (FIX 5) ─────────────────────────────────────────────────
function PipelineRow({
  clientName, empCount, gross, cutoff, settle, days, urgent, currentStep, isAr, t, onClick,
}: {
  clientName: string;
  empCount: number;
  gross: number;
  cutoff: Date | null;
  settle: Date | null;
  days: number;
  urgent: boolean;
  currentStep: number;
  isAr: boolean;
  t: ReturnType<typeof useTasamaDemoT>;
  onClick?: () => void;
}) {
  const STEPS = [
    { key: "pipelineIngest", icon: <ClipboardList size={11} /> },
    { key: "pipelineCalculate", icon: <Calculator size={11} /> },
    { key: "pipelineApprove", icon: <BadgeCheck size={11} /> },
    { key: "pipelineFile", icon: <FileSignature size={11} /> },
    { key: "pipelineSettle", icon: <Banknote size={11} /> },
  ];
  const dateFmt = (d: Date | null) => d ? d.toLocaleString(isAr ? "ar-SA" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";
  const status = STATUS_BY_STEP[currentStep] ?? STATUS_BY_STEP[0];
  const ChevronArrow = isAr ? ChevronRight : ArrowRight;

  return (
    <button
      onClick={onClick}
      className="w-full text-start rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md hover:border-[#2E4DA7]/30 transition-all cursor-pointer group block"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">{clientName}</p>
            {/* FIX 5 — explicit status chip */}
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text} ring-1 ${status.ring}`}>
              <span className={`w-1.5 h-1.5 rounded-full bg-current tasama-live-pulse`} />
              {t(status.labelKey, operations)}
            </span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: SUBTITLE_COLOR }}>
            {empCount} {t("kpiClientsSubEmployees", operations)} · {formatSAR(gross)}
          </p>
        </div>
        <div className={`text-end flex-shrink-0 ${urgent ? "text-orange-700" : "text-[#2E4DA7]"}`}>
          <p className="text-[9px] font-bold uppercase tracking-wider">{t("pipelineDaysLeft", operations)}</p>
          <p className="text-xl font-extrabold leading-none">T-{days}d</p>
          <p className="text-[9px] mt-0.5 text-gray-500">
            {t("pipelineCutoff", operations)} {dateFmt(cutoff)} · {t("pipelineSettleDate", operations)} {dateFmt(settle)}
          </p>
        </div>
      </div>

      {/* Pipeline rail */}
      <div className={`flex items-center gap-0 ${isAr ? "flex-row-reverse" : ""}`}>
        {STEPS.map((step, i) => {
          const isCompleted = i < currentStep;
          const isCurrent = i === currentStep;
          const dotBg = isCompleted ? "bg-[#2E4DA7] text-white" : isCurrent ? "bg-amber-500 text-white" : "bg-gray-200 text-gray-400";
          const labelTone = isCompleted ? "text-[#2E4DA7]" : isCurrent ? "text-amber-700 font-bold" : "text-gray-400";
          const railTone = isCompleted ? "bg-[#2E4DA7]" : "bg-gray-200";
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center min-w-0">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${dotBg} ${isCurrent ? "ring-2 ring-amber-200" : ""}`}>
                  {isCompleted ? <CheckCircle2 size={12} /> : step.icon}
                </span>
                <span className={`text-[9px] mt-1 ${labelTone} truncate max-w-[60px] text-center`}>{t(step.key, operations)}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${railTone}`} style={{ minWidth: 12 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Open client CTA */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-end gap-1 text-[10px] font-bold text-[#2E4DA7] group-hover:underline">
        {t("openClientCta", operations)}
        <ChevronArrow size={10} />
      </div>
    </button>
  );
}
