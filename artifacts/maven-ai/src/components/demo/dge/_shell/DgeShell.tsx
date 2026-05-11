/**
 * DGE Effortless 2.0 — shared three-tab shell.
 *
 * Renders the Citizen / Operator / Governance frame with the right-side
 * Agent Activity Stream, HAPA chips, AUTHORIZE card, audit timeline,
 * persona switcher, EN ⇄ عربي toggle, demo-speed slider, reset button,
 * Stack panel, and "Demonstration · Synthetic Data" watermark.
 *
 * Loads the offline canonical trace from /dge-traces/<slug>.json so the
 * demo is meeting-room-safe with no internet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Layers,
  User,
  ClipboardCheck,
  Gauge,
  X,
} from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import {
  type AuditEvent,
  type AgentStepEvent,
  type Hapa,
  type OfflineTrace,
  loadOfflineTrace,
  makeAuditEvent,
  checkContract,
  isOfflineMode,
  traceToEvents,
} from "@/lib/dge/runtime";
import {
  STACK_LINES,
  PERSONAS,
  FACTORIES,
} from "@/data/dge/factories";
import type { DgeDemo, DgeTabContent } from "@/data/dge/demos";
import "./dge-tokens.css";

type Surface = "citizen" | "operator" | "governance";

const HAPA_LABELS: Record<Hapa, { en: string; ar: string; act: string }> = {
  H1: { en: "Honest", ar: "صادق", act: "EU AI Act Art 13 (transparency)" },
  H2: { en: "Helpful", ar: "نافع", act: "EU AI Act Art 14 (oversight)" },
  H3: { en: "Harmless", ar: "غير مؤذٍ", act: "EU AI Act Art 9 (risk mgmt)" },
  H4: { en: "Auditable", ar: "قابل للتدقيق", act: "EU AI Act Art 11 (documentation)" },
  H5: { en: "Bilingual", ar: "ثنائي اللغة", act: "EU AI Act Art 13 (information)" },
  H6: { en: "Human-gated", ar: "بإذن بشري", act: "EU AI Act Art 14 (human oversight)" },
};

interface Props {
  demo: DgeDemo;
}

export default function DgeShell({ demo }: Props) {
  const { lang, dir, setLang } = useLang();
  const [surface, setSurface] = useState<Surface>("citizen");
  const [persona, setPersona] = useState(PERSONAS[0].id);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [streamed, setStreamed] = useState<AgentStepEvent[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(false);
  const [authorised, setAuthorised] = useState(false);
  const [hapaOpen, setHapaOpen] = useState<Hapa | null>(null);
  const stepIdx = useRef(0);
  const timer = useRef<number | null>(null);

  const factory = FACTORIES.find((f) => f.id === demo.factory);
  const offline = useMemo(() => isOfflineMode(), []);
  const [trace, setTrace] = useState<OfflineTrace | null>(null);

  // In-memory script (used when offline=off OR while the trace JSON
  // is in-flight on first paint).
  const inMemorySteps: AgentStepEvent[] = useMemo(() => {
    const base: AgentStepEvent[] = demo.steps.map((s, i) => ({
      id: `step-${i}`,
      agent: s.agent,
      surface: s.surface,
      label: s.label,
      detail: s.detail,
      hapa: s.hapa,
      citations: s.citations,
    }));
    base.push({
      id: "authorise",
      agent: { en: "Orchestrator", ar: "المنسّق" },
      surface: "operator",
      label: demo.authorise.intent,
      detail: demo.authorise.commits,
      hapa: demo.authorise.hapa,
      authorise: { by: demo.authorise.by, intent: demo.authorise.intent, commits: demo.authorise.commits },
    });
    base.push({
      id: "forbidden",
      agent: demo.forbidden.agent,
      surface: "governance",
      label: demo.forbidden.attempt,
      attempt: {
        action: demo.forbidden.contract.mustNever[0] ?? "unknown_action",
        contract: demo.forbidden.contract,
      },
      hapa: ["H3", "H4"],
    });
    return base;
  }, [demo]);

  // Replayed canonical trace from /dge-traces/<slug>.json. When
  // offline=on (default), this drives the runner end-to-end so the
  // demo is faithful with no network. The same trace also produces
  // both success steps and the `outcome: blocked` audit lines.
  const replayedSteps: AgentStepEvent[] | null = useMemo(() => {
    if (!trace) return null;
    return traceToEvents(
      trace,
      { by: demo.authorise.by, intent: demo.authorise.intent, commits: demo.authorise.commits, hapa: demo.authorise.hapa },
      demo.forbidden.contract,
    );
  }, [trace, demo]);

  const allSteps: AgentStepEvent[] = (offline && replayedSteps) ? replayedSteps : inMemorySteps;

  useEffect(() => {
    void loadOfflineTrace(demo.slug).then((t) => {
      setTrace(t);
      const tag = offline ? "offline" : "live";
      if (t) {
        setAudit((a) => [
          makeAuditEvent({
            agent: { en: "Runner", ar: "المحرّك" },
            action: {
              en: `Trace source: ${tag}. ${t.success.length} success + ${t.blocked.length} blocked steps loaded from /dge-traces/${demo.slug}.json.`,
              ar: `مصدر المسار: ${tag === "offline" ? "دون اتصال" : "مباشر"}. ${t.success.length} خطوة نجاح و${t.blocked.length} محظورة من /dge-traces/${demo.slug}.json.`,
            },
            outcome: "ok",
            hapa: ["H4"],
          }),
          ...a,
        ]);
      }
    });
  }, [demo.slug, offline]);

  const stepInterval = 1600 / speed;

  function runOne() {
    const i = stepIdx.current;
    if (i >= allSteps.length) {
      setRunning(false);
      return;
    }
    const step = allSteps[i];
    stepIdx.current = i + 1;
    setStreamed((s) => [...s, step]);
    if (step.surface !== surface) setSurface(step.surface);

    // Audit the step.
    setAudit((a) => [
      makeAuditEvent({
        agent: step.agent,
        action: step.label,
        detail: step.detail,
        hapa: step.hapa,
        citations: step.citations,
        outcome: "ok",
      }),
      ...a,
    ]);

    if (step.authorise) {
      setRunning(false);
      setPendingAuth(true);
      return;
    }
    if (step.attempt) {
      const outcome = checkContract(step.attempt.action, step.attempt.contract);
      setAudit((a) => [
        makeAuditEvent({
          agent: step.agent,
          action: { en: `Contract check on '${step.attempt!.action}'`, ar: `فحص العقد على '${step.attempt!.action}'` },
          outcome: outcome === "ok" ? "ok" : "blocked",
          hapa: ["H3", "H4"],
          detail: outcome === "blocked"
            ? { en: "Action denied — listed under MUST NEVER. Recorded as outcome: blocked.", ar: "إجراء مرفوض — مدرج ضمن 'يجب ألا'. سُجِّل كـ outcome: blocked." }
            : undefined,
        }),
        ...a,
      ]);
      setRunning(false);
      return;
    }
  }

  useEffect(() => {
    if (!running) return;
    timer.current = window.setTimeout(runOne, stepInterval);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, streamed.length, stepInterval]);

  function reset() {
    setRunning(false);
    setPendingAuth(false);
    setAuthorised(false);
    setStreamed([]);
    stepIdx.current = 0;
    setAudit([]);
  }

  function authorise() {
    setAuthorised(true);
    setPendingAuth(false);
    setAudit((a) => [
      makeAuditEvent({
        agent: { en: "Human", ar: "إنسان" },
        human: demo.authorise.by,
        action: demo.authorise.intent,
        detail: demo.authorise.commits,
        outcome: "authorised",
        hapa: demo.authorise.hapa,
      }),
      ...a,
    ]);
    setRunning(true);
  }

  const tabContent: DgeTabContent =
    surface === "citizen" ? demo.citizen :
    surface === "operator" ? demo.operator :
    demo.governance;

  return (
    <div className="dge-theme min-h-screen flex flex-col" dir={dir} data-testid="dge-shell">
      {/* Top bar — TAMM aesthetic */}
      <header
        className="flex-shrink-0 h-14 flex items-center px-4 gap-3 border-b"
        style={{ background: "var(--dge-paper)", borderColor: "var(--dge-line)" }}
      >
        <Link href="/marketplace/dge-effortless" className="flex items-center gap-1 text-xs" style={{ color: "var(--dge-ink-soft)" }}>
          <ArrowLeft size={14} className={lang === "ar" ? "rotate-180" : ""} />
          <span className="hidden md:inline">{tStr({ en: "Back to DGE hub", ar: "العودة إلى مركز DGE" }, lang)}</span>
        </Link>
        <div className="h-5 w-px" style={{ background: "var(--dge-line)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dge-teal)" }}>
            {tStr({ en: "DGE Effortless 2.0", ar: "DGE الجهد المنعدم 2.0" }, lang)} · {demo.number}
          </p>
          <p className="text-sm font-bold truncate" style={{ color: "var(--dge-ink)" }}>{tStr(demo.title, lang)}</p>
        </div>

        {/* Persona switcher */}
        <select
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="text-xs rounded-full px-3 py-1.5 border"
          style={{ borderColor: "var(--dge-line)", background: "var(--dge-sand-soft)" }}
          data-testid="select-persona"
        >
          {PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {tStr(p.name, lang)} — {tStr(p.role, lang)}
            </option>
          ))}
        </select>

        {/* Speed slider */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border" style={{ borderColor: "var(--dge-line)" }}>
          <Gauge size={12} style={{ color: "var(--dge-mute)" }} />
          {([1, 2, 4] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className="text-[11px] font-bold px-1.5 rounded"
              style={{ color: speed === s ? "var(--dge-teal)" : "var(--dge-mute)" }}
              data-testid={`speed-${s}x`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* EN/AR toggle */}
        <button
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          className="text-[11px] font-bold px-2.5 py-1.5 rounded-full border"
          style={{ borderColor: "var(--dge-line)" }}
          data-testid="button-lang"
        >
          {lang === "ar" ? "EN" : "عربي"}
        </button>

        <button
          onClick={reset}
          className="text-xs flex items-center gap-1 rounded-full px-3 py-1.5 border"
          style={{ borderColor: "var(--dge-line)", color: "var(--dge-ink-soft)" }}
          data-testid="button-reset"
        >
          <RotateCcw size={12} />
          {tStr({ en: "Reset demo", ar: "إعادة العرض" }, lang)}
        </button>
      </header>

      {/* HAPA chips H1..H6 */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2 border-b"
        style={{ background: "var(--dge-sand-soft)", borderColor: "var(--dge-line)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dge-mute)" }}>
          {tStr({ en: "HAPA contract", ar: "عقد HAPA" }, lang)}:
        </span>
        {(Object.keys(HAPA_LABELS) as Hapa[]).map((h) => (
          <button
            key={h}
            className="dge-chip"
            onClick={() => setHapaOpen(h)}
            data-testid={`hapa-${h}`}
          >
            <ShieldCheck size={11} />
            {h} · {tStr({ en: HAPA_LABELS[h].en, ar: HAPA_LABELS[h].ar }, lang)}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ background: "var(--dge-paper)", borderColor: "var(--dge-line)" }}>
        {(["citizen", "operator", "governance"] as Surface[]).map((s) => {
          const active = surface === s;
          return (
            <button
              key={s}
              onClick={() => setSurface(s)}
              className="px-5 py-3 text-sm font-semibold border-b-2 transition-colors"
              style={{
                borderColor: active ? "var(--dge-teal)" : "transparent",
                color: active ? "var(--dge-teal-deep)" : "var(--dge-ink-soft)",
                background: active ? "var(--dge-teal-soft)" : "transparent",
              }}
              data-testid={`tab-${s}`}
            >
              {tStr(
                s === "citizen" ? { en: "Citizen", ar: "المواطن" } :
                s === "operator" ? { en: "Operator", ar: "المشغّل" } :
                { en: "Governance", ar: "الحوكمة" },
                lang,
              )}
            </button>
          );
        })}
      </div>

      {/* Main grid: surface + agent stream + governance side */}
      <div className="flex-1 grid gap-4 p-4 min-h-0" style={{ gridTemplateColumns: "1fr 320px" }}>
        {/* Surface panel */}
        <main className="overflow-y-auto pr-2">
          <SurfacePanel surface={surface} content={tabContent} demo={demo} authorised={authorised} />
          {(surface === "operator" || surface === "governance") && (
            <StackPanel />
          )}
          {surface === "governance" && (
            <AuditTimelinePanel audit={audit} />
          )}
        </main>

        {/* Agent activity stream */}
        <aside className="flex flex-col gap-3 min-h-0">
          <div className="dge-card flex-1 min-h-0 flex flex-col">
            <header className="px-4 py-3 border-b" style={{ borderColor: "var(--dge-line)" }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dge-teal)" }}>
                {tStr({ en: "Agent activity stream", ar: "تدفّق نشاط الوكلاء" }, lang)}
              </p>
              <p className="text-[11px]" style={{ color: "var(--dge-mute)" }}>
                {tStr({ en: "Streamed step events", ar: "أحداث متدفّقة" }, lang)} · {streamed.length} / {allSteps.length}
              </p>
            </header>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <AnimatePresence initial={false}>
                {streamed.map((s) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg p-2.5 border text-[11px]"
                    style={{
                      background: s.attempt ? "rgba(178,58,58,0.06)" : "var(--dge-sand-soft)",
                      borderColor: s.attempt ? "var(--dge-danger)" : "var(--dge-line)",
                    }}
                    data-testid="agent-step"
                  >
                    <p className="font-bold flex items-center gap-1.5" style={{ color: "var(--dge-teal-deep)" }}>
                      <Sparkles size={10} />
                      {tStr(s.agent, lang)}
                    </p>
                    <p className="mt-1" style={{ color: "var(--dge-ink)" }}>{tStr(s.label, lang)}</p>
                    {s.hapa && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {s.hapa.map((h) => (
                          <span key={h} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--dge-teal-soft)", color: "var(--dge-teal-deep)" }}>{h}</span>
                        ))}
                      </div>
                    )}
                    {s.citations && (
                      <p className="text-[10px] mt-1 italic" style={{ color: "var(--dge-mute)" }}>
                        {tStr({ en: "Cites: ", ar: "يستشهد بـ: " }, lang)}
                        {s.citations.map((c) => tStr(c, lang)).join(" · ")}
                      </p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {streamed.length === 0 && (
                <p className="text-xs italic text-center py-8" style={{ color: "var(--dge-mute)" }}>
                  {tStr({ en: "Press Play to start the trace.", ar: "اضغط تشغيل لبدء المسار." }, lang)}
                </p>
              )}
            </div>
            <footer className="px-3 py-2 border-t flex items-center gap-2" style={{ borderColor: "var(--dge-line)" }}>
              <button
                className="dge-btn dge-btn-primary"
                onClick={() => setRunning(true)}
                disabled={running || pendingAuth || stepIdx.current >= allSteps.length}
                data-testid="button-play"
              >
                <Play size={12} />
                {tStr({ en: "Play", ar: "تشغيل" }, lang)}
              </button>
              <button
                className="dge-btn dge-btn-ghost"
                onClick={() => setRunning(false)}
                disabled={!running}
                data-testid="button-pause"
              >
                <Pause size={12} />
                {tStr({ en: "Pause", ar: "إيقاف" }, lang)}
              </button>
            </footer>
          </div>
        </aside>
      </div>

      {/* AUTHORIZE card */}
      <AnimatePresence>
        {pendingAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(31,42,46,0.55)" }}
            data-testid="authorise-card"
          >
            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="dge-card max-w-lg w-full p-6"
              dir={dir}
            >
              <div className="flex items-center gap-2 mb-3">
                <ClipboardCheck size={18} style={{ color: "var(--dge-teal)" }} />
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dge-teal)" }}>
                  {tStr({ en: "AUTHORIZE", ar: "اعتماد" }, lang)}
                </p>
              </div>
              <h3 className="text-lg font-bold mb-2" style={{ color: "var(--dge-ink)" }}>
                {tStr(demo.authorise.intent, lang)}
              </h3>
              <p className="text-sm mb-3 font-semibold" style={{ color: "var(--dge-teal-deep)" }}>
                <User size={12} className="inline-block me-1.5" />
                {tStr(demo.authorise.by, lang)}
              </p>
              <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--dge-ink-soft)" }}>
                {tStr(demo.authorise.commits, lang)}
              </p>
              <div className="flex flex-wrap gap-1 mb-4">
                {demo.authorise.hapa.map((h) => (
                  <span key={h} className="dge-chip">{h} · {tStr({ en: HAPA_LABELS[h].en, ar: HAPA_LABELS[h].ar }, lang)}</span>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setPendingAuth(false)} className="dge-btn dge-btn-ghost" data-testid="button-decline">
                  {tStr({ en: "Decline", ar: "رفض" }, lang)}
                </button>
                <button onClick={authorise} className="dge-btn dge-btn-primary" data-testid="button-authorise">
                  <CheckCircle2 size={12} />
                  {tStr({ en: "Authorise", ar: "اعتماد" }, lang)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HAPA side drawer */}
      <AnimatePresence>
        {hapaOpen && (
          <motion.aside
            initial={{ x: dir === "rtl" ? -360 : 360 }}
            animate={{ x: 0 }}
            exit={{ x: dir === "rtl" ? -360 : 360 }}
            className="fixed top-0 bottom-0 w-[340px] shadow-2xl z-40 p-5 overflow-y-auto"
            style={{ background: "var(--dge-paper)", insetInlineEnd: 0, borderInlineStart: "1px solid var(--dge-line)" }}
          >
            <div className="flex justify-between items-start mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dge-teal)" }}>
                {tStr({ en: "HAPA contract", ar: "عقد HAPA" }, lang)}
              </p>
              <button onClick={() => setHapaOpen(null)} aria-label="close"><X size={16} /></button>
            </div>
            <h3 className="text-lg font-bold mb-1">{hapaOpen} · {tStr({ en: HAPA_LABELS[hapaOpen].en, ar: HAPA_LABELS[hapaOpen].ar }, lang)}</h3>
            <p className="text-xs mb-4" style={{ color: "var(--dge-mute)" }}>{HAPA_LABELS[hapaOpen].act}</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--dge-ink-soft)" }}>
              {tStr({
                en: "Maps to the EU AI Act high-risk obligations and the DGE Behavioural Contract. Every agent step that bears this chip was checked against the contract before being committed to the audit log.",
                ar: "يرتبط بقانون الذكاء الاصطناعي الأوروبي وعقد DGE السلوكي. كل خطوة وكيل تحمل هذه الشارة فُحصت قبل التسجيل.",
              }, lang)}
            </p>
            <Link href="/dge/method" className="mt-4 inline-block text-xs font-bold" style={{ color: "var(--dge-teal)" }}>
              {tStr({ en: "Read the full HAPA + Authority method →", ar: "اقرأ منهج HAPA الكامل ←" }, lang)}
            </Link>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Watermark */}
      <div className="dge-watermark">
        {tStr({ en: "Demonstration · Synthetic Data", ar: "عرض توضيحي · بيانات اصطناعية" }, lang)}
      </div>
    </div>
  );
}

function SurfacePanel({
  surface,
  content,
  demo,
  authorised,
}: {
  surface: Surface;
  content: DgeTabContent;
  demo: DgeDemo;
  authorised: boolean;
}) {
  const { lang } = useLang();
  const isCitizen = surface === "citizen";
  return (
    <section className="dge-card p-5 mb-4" data-testid={`surface-${surface}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--dge-teal)" }}>
        {tStr(content.persona, lang)}
      </p>
      <h2 className="text-xl font-bold mb-2" style={{ color: "var(--dge-ink)" }}>
        {tStr(demo.title, lang)} — {tStr(
          surface === "citizen" ? { en: "Citizen", ar: "المواطن" } :
          surface === "operator" ? { en: "Operator", ar: "المشغّل" } :
          { en: "Governance", ar: "الحوكمة" },
          lang,
        )}
      </h2>
      <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--dge-ink-soft)" }}>
        {tStr(content.intro, lang)}
      </p>

      {authorised && surface === "citizen" && (
        <div className="rounded-lg p-3 mb-4 border" style={{ background: "var(--dge-teal-soft)", borderColor: "var(--dge-teal)" }}>
          <p className="text-xs font-bold" style={{ color: "var(--dge-teal-deep)" }}>
            <CheckCircle2 size={12} className="inline-block me-1" />
            {tStr({ en: "Authorised change is now live in this surface.", ar: "التغيير المعتمد منشور الآن في هذه الواجهة." }, lang)}
          </p>
        </div>
      )}

      <div className={`grid gap-3 ${isCitizen ? "max-w-md mx-auto" : "md:grid-cols-2"}`}>
        {content.blocks.map((b, i) => (
          <div key={i} className="rounded-lg p-4 border" style={{ background: "var(--dge-sand-soft)", borderColor: "var(--dge-line)" }}>
            <h4 className="text-sm font-bold mb-1.5" style={{ color: "var(--dge-teal-deep)" }}>{tStr(b.title, lang)}</h4>
            <p className="text-xs leading-relaxed" style={{ color: "var(--dge-ink)" }}>{tStr(b.body, lang)}</p>
            {b.rows && (
              <table className="w-full text-[11px] mt-3">
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-t" style={{ borderColor: "var(--dge-line)" }}>
                      <td className="py-1 pe-2 font-semibold" style={{ color: "var(--dge-mute)" }}>{tStr(r[0], lang)}</td>
                      <td className="py-1" style={{ color: "var(--dge-ink)" }}>{tStr(r[1], lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {b.bullets && (
              <ul className="mt-2 space-y-1 text-[11px]" style={{ color: "var(--dge-ink)" }}>
                {b.bullets.map((bl, j) => (
                  <li key={j} className="flex items-start gap-1.5">
                    <span className="mt-1 inline-block w-1 h-1 rounded-full" style={{ background: "var(--dge-teal)" }} />
                    {tStr(bl, lang)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {(surface === "operator" || surface === "governance") && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          {demo.kpis.map((k, i) => (
            <div key={i} className="rounded-lg p-3 border" style={{ background: "var(--dge-paper)", borderColor: "var(--dge-line)" }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dge-mute)" }}>{tStr(k.label, lang)}</p>
              <p className="text-base font-bold mt-1" style={{ color: "var(--dge-ink)" }}>{k.before} → {k.after}</p>
              <p className="text-[10px] font-bold" style={{ color: "var(--dge-success)" }}>{tStr(k.delta, lang)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StackPanel() {
  const { lang } = useLang();
  return (
    <section className="dge-card p-4 mb-4" data-testid="stack-panel">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "var(--dge-teal)" }}>
        <Layers size={12} />
        {tStr({ en: "Stack", ar: "الحزمة" }, lang)}
      </p>
      <ul className="grid md:grid-cols-2 gap-1.5 text-[11px]" style={{ color: "var(--dge-ink)" }}>
        {STACK_LINES.map((l, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full" style={{ background: "var(--dge-teal)" }} />
            {tStr(l, lang)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditTimelinePanel({ audit }: { audit: AuditEvent[] }) {
  const { lang } = useLang();
  return (
    <section className="dge-card p-4" data-testid="audit-timeline">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--dge-teal)" }}>
        {tStr({ en: "Audit timeline · immutable", ar: "سجل تدقيق · غير قابل للتعديل" }, lang)}
      </p>
      {audit.length === 0 && (
        <p className="text-xs italic" style={{ color: "var(--dge-mute)" }}>
          {tStr({ en: "No events yet. Press Play.", ar: "لا أحداث بعد." }, lang)}
        </p>
      )}
      <ol className="space-y-2">
        {audit.map((a) => (
          <li key={a.id} className="text-[11px] border-s-2 ps-3 py-1" style={{
            borderColor: a.outcome === "blocked" ? "var(--dge-danger)" : a.outcome === "authorised" ? "var(--dge-teal)" : "var(--dge-line)",
          }}>
            <div className="flex justify-between gap-2">
              <span className="font-bold" style={{ color: "var(--dge-teal-deep)" }}>{tStr(a.agent, lang)}</span>
              <span className="font-mono text-[10px]" style={{ color: "var(--dge-mute)" }}>{a.ts}</span>
            </div>
            <p style={{ color: "var(--dge-ink)" }}>{tStr(a.action, lang)}</p>
            {a.detail && <p className="italic mt-0.5" style={{ color: "var(--dge-ink-soft)" }}>{tStr(a.detail, lang)}</p>}
            <div className="flex flex-wrap gap-1 mt-1">
              {a.hapa?.map((h) => (
                <span key={h} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--dge-teal-soft)", color: "var(--dge-teal-deep)" }}>{h}</span>
              ))}
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{
                background: a.outcome === "blocked" ? "rgba(178,58,58,0.12)" : a.outcome === "authorised" ? "var(--dge-teal-soft)" : "var(--dge-sand)",
                color: a.outcome === "blocked" ? "var(--dge-danger)" : a.outcome === "authorised" ? "var(--dge-teal-deep)" : "var(--dge-mute)",
              }} data-testid={`audit-outcome-${a.outcome}`}>
                {a.outcome === "blocked" && <AlertTriangle size={9} className="inline-block me-0.5" />}
                outcome: {a.outcome}
              </span>
              {a.human && <span className="text-[9px]" style={{ color: "var(--dge-mute)" }}>· {tStr(a.human, lang)}</span>}
            </div>
            {a.citations && (
              <p className="text-[10px] mt-0.5 italic" style={{ color: "var(--dge-mute)" }}>
                {tStr({ en: "Cites: ", ar: "يستشهد بـ: " }, lang)}{a.citations.map((c) => tStr(c, lang)).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
