import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, MapPin, Users, ListChecks, Inbox, CheckCircle2, Loader2, Circle, PlayCircle, MessageSquare, Truck, Sparkles, Radio } from "lucide-react";
import { useNocDemoLang, useNocDemoT } from "../DemoLangContext";
import { incidentWs, shell } from "../noc-i18n";
import { INCIDENTS, CREWS, siteById, serviceById, type Incident, type RunbookStep, type IncidentTimelineEntry, type TimelinePhase } from "@/data/network-ops-seed";
import { BRAND, SEV_BG } from "../tokens";

const PHASE_ORDER: TimelinePhase[] = ["detection", "correlation", "root-cause", "dispatch", "comms", "resolution"];
const PHASE_KEY: Record<TimelinePhase, string> = {
  detection: "timelineDetection",
  correlation: "timelineCorrelation",
  "root-cause": "timelineRootCause",
  dispatch: "timelineDispatch",
  comms: "timelineComms",
  resolution: "timelineResolution",
};

export default function IncidentWorkspaceView({ initialIncidentId, onOpenApprovals }: { initialIncidentId?: string; onOpenApprovals?: () => void }) {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";
  const open = useMemo(() => INCIDENTS.filter((i) => i.status !== "resolved"), []);
  const [selId, setSelId] = useState(initialIncidentId ?? open[0]?.id);
  const sel = INCIDENTS.find((i) => i.id === selId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Activity size={20} style={{ color: BRAND }} />
          {t("title", incidentWs)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", incidentWs)}</p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        {/* Incident list */}
        <div className="space-y-2">
          {open.map((inc) => {
            const isSel = inc.id === selId;
            return (
              <button
                key={inc.id}
                onClick={() => setSelId(inc.id)}
                className={`w-full text-start p-3 rounded-xl border transition-colors ${isSel ? "border-[#5B7CFF] bg-[#5B7CFF]/5" : "border-gray-100 hover:border-gray-300 bg-white"}`}
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${SEV_BG[inc.severity]}`}>
                    {t(`sev${inc.severity.toUpperCase()}`, shell)}
                  </span>
                  <span className="text-[9px] text-gray-400 ms-auto">{inc.id}</span>
                </div>
                <p className="text-xs font-bold text-gray-900 leading-snug">{isAr ? inc.title.ar : inc.title.en}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {inc.affectedCustomers.toLocaleString(isAr ? "ar-SA" : "en-US")} {isAr ? "عميل" : "customers"}
                </p>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        {!sel ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-500">
            {t("select", incidentWs)}
          </div>
        ) : (
          <div className="space-y-4">
            <DetailHeader sel={sel} isAr={isAr} t={t} onOpenApprovals={onOpenApprovals} />

            {sel.customerImpact && (
              <CustomerImpactCard text={isAr ? sel.customerImpact.ar : sel.customerImpact.en} t={t} />
            )}

            {sel.timeline && <TimelineRow timeline={sel.timeline} isAr={isAr} t={t} />}

            <CorrelatedAlarms incident={sel} isAr={isAr} t={t} />

            {sel.id === "INC-2026-3041" && (
              <div className="grid lg:grid-cols-2 gap-4">
                <DispatchDraftCard isAr={isAr} t={t} onOpenApprovals={onOpenApprovals} />
                <CommsDraftCard isAr={isAr} t={t} onOpenApprovals={onOpenApprovals} />
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                <Field label={t("rootCause", incidentWs)} value={isAr ? sel.rootCauseHypothesis.ar : sel.rootCauseHypothesis.en} accent="#D9534F" />
                <Field label={t("recommendedAction", incidentWs)} value={isAr ? sel.recommendedAction.ar : sel.recommendedAction.en} accent={BRAND} />
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2 flex items-center gap-1.5">
                    <ListChecks size={11} />
                    {t("evidence", incidentWs)}
                  </p>
                  <div className="space-y-2">
                    {sel.evidence.map((e, i) => (
                      <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: BRAND }}>{i + 1}</span>
                        <p className="text-xs text-gray-800">{isAr ? e.ar : e.en}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {sel.runbook && <RunbookPlayer steps={sel.runbook} isAr={isAr} t={t} onOpenApprovals={onOpenApprovals} />}

                <div className="grid grid-cols-3 gap-2">
                  <SmallStat icon={<MapPin size={12} />} label={t("affectedSites", incidentWs)} value={String(sel.affectedSiteIds.length)} sub={sel.affectedSiteIds.map((id) => siteById(id)?.name[isAr ? "ar" : "en"]).filter(Boolean).join(" · ")} />
                  <SmallStat icon={<Users size={12} />} label={t("affectedCustomers", incidentWs)} value={sel.affectedCustomers.toLocaleString(isAr ? "ar-SA" : "en-US")} />
                  <SmallStat icon={<AlertTriangle size={12} />} label={t("services", incidentWs)} value={sel.serviceIds.length === 0 ? t("none", incidentWs) : String(sel.serviceIds.length)} sub={sel.serviceIds.map((id) => serviceById(id)?.name[isAr ? "ar" : "en"]).filter(Boolean).join(" · ")} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailHeader({ sel, isAr, t, onOpenApprovals }: { sel: Incident; isAr: boolean; t: ReturnType<typeof useNocDemoT>; onOpenApprovals?: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEV_BG[sel.severity]}`}>
              {t(`sev${sel.severity.toUpperCase()}`, shell)}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              {t(`status${sel.status.charAt(0).toUpperCase() + sel.status.slice(1)}`, shell)}
            </span>
            <span className="text-[10px] text-gray-400">{sel.id}</span>
          </div>
          <h3 className="text-lg font-extrabold text-gray-900">{isAr ? sel.title.ar : sel.title.en}</h3>
          <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{isAr ? sel.description.ar : sel.description.en}</p>
        </div>
      </div>

      {sel.regulatorClock && (
        <RegulatorClock clock={sel.regulatorClock} awaiting={!!sel.awaitingApproval} isAr={isAr} t={t} onOpenApprovals={onOpenApprovals} />
      )}
    </div>
  );
}

function RegulatorClock({ clock, awaiting, isAr, t, onOpenApprovals }: { clock: { startedAt: string; budgetMin: number; bufferMin: number }; awaiting: boolean; isAr: boolean; t: ReturnType<typeof useNocDemoT>; onOpenApprovals?: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(clock.bufferMin * 60);
  useEffect(() => {
    setSecondsLeft(clock.bufferMin * 60);
    const id = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [clock.bufferMin]);

  const min = Math.floor(secondsLeft / 60);
  const sec = secondsLeft % 60;
  const pct = Math.max(0, Math.min(100, (secondsLeft / (clock.budgetMin * 60)) * 100));
  const critical = pct < 30;

  return (
    <div className={`rounded-xl border p-4 ${critical ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="flex items-center gap-3">
        <Clock size={20} className={critical ? "text-red-700" : "text-amber-700"} />
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] uppercase tracking-widest font-bold ${critical ? "text-red-800" : "text-amber-800"}`}>
            {t("regulatorClock", incidentWs)}
          </p>
          <p className={`text-base font-bold tabular-nums mt-0.5 ${critical ? "text-red-900" : "text-amber-900"}`}>
            {String(min).padStart(2, "0")}:{String(sec).padStart(2, "0")}{" "}
            <span className="text-xs font-medium opacity-75">
              · {isAr ? "ميزانية" : "budget"} {clock.budgetMin}m
            </span>
          </p>
        </div>
        {awaiting && (
          <button
            onClick={onOpenApprovals}
            className="text-xs font-bold text-white px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{ background: critical ? "#D9534F" : BRAND }}
          >
            <Inbox size={12} className="inline-block me-1" />
            {t("openApprovals", incidentWs)}
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-white/60 overflow-hidden">
        <div
          className={`h-full transition-all ${critical ? "bg-red-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CustomerImpactCard({ text, t }: { text: string; t: ReturnType<typeof useNocDemoT> }) {
  return (
    <div className="rounded-2xl p-5 border" style={{ background: `${BRAND}08`, borderColor: `${BRAND}30` }}>
      <p className="text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5" style={{ color: BRAND }}>
        <Sparkles size={11} />
        {t("customerImpact", incidentWs)}
      </p>
      <p className="text-[10px] text-gray-500 mt-0.5">{t("customerImpactSub", incidentWs)}</p>
      <p className="text-sm font-semibold text-gray-900 mt-2.5 leading-relaxed">{text}</p>
    </div>
  );
}

function TimelineRow({ timeline, isAr, t }: { timeline: IncidentTimelineEntry[]; isAr: boolean; t: ReturnType<typeof useNocDemoT> }) {
  const byPhase = new Map(timeline.map((e) => [e.phase, e]));
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3 flex items-center gap-1.5">
        <Activity size={11} style={{ color: BRAND }} />
        {t("timeline", incidentWs)}
      </p>
      <div className="flex items-start gap-1 overflow-x-auto pb-1">
        {PHASE_ORDER.map((p, i) => {
          const e = byPhase.get(p);
          const done = !!e?.done;
          const active = !done && (i === 0 || byPhase.get(PHASE_ORDER[i - 1])?.done);
          return (
            <div key={p} className="flex items-start gap-1 flex-1 min-w-[120px]">
              <div className="flex flex-col items-center" style={{ minWidth: 32 }}>
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                    done ? "" : active ? "ring-2 ring-amber-300" : "bg-gray-200 text-gray-400"
                  }`}
                  style={{ background: done ? BRAND : active ? "#C45BB8" : undefined }}
                >
                  {done ? <CheckCircle2 size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : i + 1}
                </div>
                {i < PHASE_ORDER.length - 1 && (
                  <div className={`w-px h-1 ${done ? "bg-[#5B7CFF]" : "bg-gray-200"} mt-0.5`} />
                )}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p className={`text-[10px] uppercase tracking-widest font-bold ${done ? "text-gray-700" : active ? "text-amber-700" : "text-gray-400"}`}>
                  {t(PHASE_KEY[p], incidentWs)}
                </p>
                {e && (
                  <>
                    <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
                      {new Date(e.ts).toLocaleTimeString(isAr ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-[11px] text-gray-700 leading-snug mt-0.5">{isAr ? e.label.ar : e.label.en}</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RUNBOOK_ICON = {
  done: <CheckCircle2 size={14} className="text-emerald-600" />,
  active: <Loader2 size={14} className="animate-spin text-amber-600" />,
  pending: <Circle size={14} className="text-gray-400" />,
  blocked: <AlertTriangle size={14} className="text-red-600" />,
};

function RunbookPlayer({ steps, isAr, t, onOpenApprovals }: { steps: RunbookStep[]; isAr: boolean; t: ReturnType<typeof useNocDemoT>; onOpenApprovals?: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3 flex items-center gap-1.5">
        <PlayCircle size={11} style={{ color: BRAND }} />
        {t("runbook", incidentWs)}
      </p>
      <ol className="space-y-2">
        {steps.map((step, i) => {
          const decisionIcon =
            step.id === "rb-3" ? <Truck size={11} className="opacity-70" /> :
            step.id === "rb-4" ? <MessageSquare size={11} className="opacity-70" /> :
            null;
          const isPendingDecision = step.status === "pending" && (step.id === "rb-3" || step.id === "rb-4");
          return (
            <li key={step.id} className={`rounded-xl border p-3 ${
              step.status === "active" ? "border-amber-200 bg-amber-50/40" :
              step.status === "done" ? "border-emerald-100 bg-emerald-50/30" :
              "border-gray-100 bg-gray-50/40"
            }`}>
              <div className="flex items-start gap-2.5">
                <div className="flex-shrink-0 mt-0.5">{RUNBOOK_ICON[step.status]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      {t("runbookStep", incidentWs)} {i + 1}
                    </span>
                    {decisionIcon}
                  </div>
                  <p className="text-xs font-bold text-gray-900 mt-0.5 leading-snug">{isAr ? step.title.ar : step.title.en}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{isAr ? step.detail.ar : step.detail.en}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {t("runbookOwner", incidentWs)}: <span className="font-semibold text-gray-700">{isAr ? step.owner.ar : step.owner.en}</span>
                  </p>
                </div>
                {isPendingDecision && (
                  <button onClick={onOpenApprovals} className="text-[10px] font-bold text-white px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0" style={{ background: BRAND }}>
                    {step.id === "rb-3" ? t("decisionDispatch", incidentWs) : t("decisionComms", incidentWs)}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CorrelatedAlarms({ incident, isAr, t }: { incident: Incident; isAr: boolean; t: ReturnType<typeof useNocDemoT> }) {
  const sites = incident.affectedSiteIds.map((id) => siteById(id)).filter(Boolean);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3 flex items-center gap-1.5">
        <Radio size={11} className="text-red-600" />
        {isAr ? "إنذارات مترابطة" : "Correlated alarms"}
        <span className="ms-auto text-[10px] text-gray-400 font-normal">
          {isAr ? "من مُترابط الإنذارات" : "from Alarm Correlator"}
        </span>
      </p>
      <ul className="space-y-1.5">
        {incident.evidence.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-gray-800 leading-snug">{isAr ? e.ar : e.en}</p>
              {sites[i] && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {isAr ? sites[i]!.name.ar : sites[i]!.name.en} · {sites[i]!.id}
                </p>
              )}
            </div>
            <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
              {String(14).padStart(2, "0")}:{String(1 + i).padStart(2, "0")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DispatchDraftCard({ isAr, t, onOpenApprovals }: { isAr: boolean; t: ReturnType<typeof useNocDemoT>; onOpenApprovals?: () => void }) {
  const crew = CREWS.find((c) => c.assignedIncidentId === "INC-2026-3041") ?? CREWS.find((c) => c.id === "crew-shj-01") ?? CREWS[0];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2 flex items-center gap-1.5">
        <Truck size={11} className="text-emerald-700" />
        {isAr ? "مسوّدة الإرسال الميداني" : "Field-dispatch draft"}
        <span className="ms-auto text-[10px] text-gray-400 font-normal">
          {isAr ? "من مشغّل الإجراءات" : "from Runbook Player"}
        </span>
      </p>
      <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3 space-y-1.5">
        <p className="text-xs font-bold text-gray-900">
          {isAr ? crew.name.ar : crew.name.en} · {isAr ? crew.lead.ar : crew.lead.en}
        </p>
        <p className="text-[11px] text-gray-700">
          {isAr ? "إلى" : "To"}: <span className="font-semibold">{isAr ? "مغذّي جنوب الشارقة (كم 21)" : "Sharjah-South feeder (km 21)"}</span>
        </p>
        <p className="text-[11px] text-gray-700">
          ETA: <span className="font-semibold tabular-nums">{crew.etaMin} min</span> · {isAr ? "الحالة" : "Status"}: <span className="font-semibold">{crew.status}</span>
        </p>
        <p className="text-[10px] text-gray-500">{isAr ? "أدوات الجمع، خرائط الكابل، وحدات لحام بصري." : "Splice kit, cable map, optical fusion units."}</p>
      </div>
      <button
        onClick={onOpenApprovals}
        className="mt-3 w-full text-xs font-bold text-white px-3 py-2 rounded-lg flex items-center justify-center gap-1.5"
        style={{ background: BRAND }}
      >
        <Inbox size={12} />
        {isAr ? "اعتماد الإرسال (apv-006)" : "Approve dispatch (apv-006)"}
      </button>
    </div>
  );
}

function CommsDraftCard({ isAr, t, onOpenApprovals }: { isAr: boolean; t: ReturnType<typeof useNocDemoT>; onOpenApprovals?: () => void }) {
  const body = isAr
    ? "صحارى تيليكوم: نعلم بوجود خلل في خدمات البيانات والصوت بجنوب الشارقة منذ الساعة 14:01. الفِرق في الطريق، ونتوقع استعادة الخدمة خلال ~32 دقيقة. سيتم احتساب رصيد حسن نية 5% تلقائياً."
    : "Sahara Telecom: We're aware of a service issue affecting mobile data and voice in South Sharjah since 14:01. Crews are on the way; we expect restoration within ~32 minutes. A 5% goodwill credit will be applied automatically.";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2 flex items-center gap-1.5">
        <MessageSquare size={11} className="text-[#8A5BD6]" />
        {isAr ? "مسوّدة تواصل العملاء" : "Customer comms draft"}
        <span className="ms-auto text-[10px] text-gray-400 font-normal">
          {isAr ? "من كاتب التواصل" : "from Comms Drafter"}
        </span>
      </p>
      <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3 space-y-1.5">
        <p className="text-[10px] text-gray-500">
          {isAr ? "القناة" : "Channel"}: <span className="text-gray-700 font-semibold">{isAr ? "SMS + بريد + صفحة الحالة" : "SMS + email + status page"}</span>
        </p>
        <p className="text-[10px] text-gray-500">
          {isAr ? "الجمهور" : "Audience"}: <span className="text-gray-700 font-semibold">{isAr ? "84,310 مشترك متأثّر" : "84,310 affected MSISDNs"}</span>
        </p>
        <p className="text-[11px] text-gray-800 leading-relaxed mt-1">{body}</p>
      </div>
      <button
        onClick={onOpenApprovals}
        className="mt-3 w-full text-xs font-bold text-white px-3 py-2 rounded-lg flex items-center justify-center gap-1.5"
        style={{ background: BRAND }}
      >
        <Inbox size={12} />
        {isAr ? "اعتماد الرسالة (apv-005)" : "Approve message (apv-005)"}
      </button>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-gray-100 p-4 bg-white" style={{ borderInlineStartWidth: 4, borderInlineStartColor: accent }}>
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-1.5 leading-snug">{value}</p>
    </div>
  );
}

function SmallStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-base font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
