import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Play, Pause, RotateCcw, Globe, ChevronRight, SkipForward,
  Network, Compass, Activity, Target, Shield, Layers, CheckCircle2, User,
  Cpu, X, Pin, Building2,
} from "lucide-react";
import { LangProvider, useLang, tStr, type Lang, type T } from "@/lib/lang";
import {
  AGENTS, SQUADS, SCENARIOS, PERSONAS,
  type Agent, type AgentId, type SquadId, type PersonaId, type ScenarioId,
} from "./data";
import Workbench from "./Workbenches";

const ACCENT = "#0E7C7B";
const CORAL = "#F5715A";
const INK = "#0E2841";

type View =
  | { kind: "mission" }
  | { kind: "graph" }
  | { kind: "squad"; squad: SquadId }
  | { kind: "agent"; id: AgentId }
  | { kind: "outcomes" };

const SQUAD_ICON: Record<SquadId, typeof Compass> = {
  listening: Compass,
  design: Layers,
  operations: Activity,
  outcomes: Target,
  governance: Shield,
};

export default function CxStudio() {
  return (
    <LangProvider>
      <CxStudioInner />
    </LangProvider>
  );
}

function CxStudioInner() {
  const { lang, setLang } = useLang();
  const t = (s: T) => tStr(s, lang);

  const [view, setView] = useState<View>({ kind: "mission" });
  const [scenarioId, setScenarioId] = useState<ScenarioId>("falcon-sme");
  const [persona, setPersona] = useState<PersonaId>("cx-director");
  const [completed, setCompleted] = useState<Set<AgentId>>(new Set());
  const [running, setRunning] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const [narration, setNarration] = useState<T | null>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const personaCfg = PERSONAS.find((p) => p.id === persona)!;

  // Scripted "Run the case" — auto-advances through agents in order, surfaces
  // a narration caption for each, then signs the checkpoint.
  useEffect(() => {
    if (!running) return;
    const remaining = AGENTS.filter((a) => !completed.has(a.id));
    if (remaining.length === 0) {
      setRunning(false); setActiveAgent(null); setNarration(null); return;
    }
    const next = remaining[0];
    setView({ kind: "agent", id: next.id });
    setActiveAgent(next.id);
    setNarration(next.narration);
    // ~10s per agent → 17 agents ≈ 2 min 50 s end-to-end "sales walkthrough".
    const tm = setTimeout(() => {
      setCompleted((prev) => new Set(prev).add(next.id));
    }, 10000);
    return () => clearTimeout(tm);
  }, [running, completed]);

  const reset = () => {
    setCompleted(new Set()); setRunning(false); setActiveAgent(null);
    setNarration(null); setView({ kind: "mission" });
  };

  const skip = () => {
    if (!activeAgent) return;
    setCompleted((p) => new Set(p).add(activeAgent));
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-white border-e border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <Link href="/marketplace" className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-900 mb-3">
            <ArrowLeft size={12} className="rtl:rotate-180" />
            {tStr({ en: "Marketplace", ar: "السوق", tr: "Marketplace" }, lang)}
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: ACCENT }}><Network size={16} /></div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ACCENT }}>Maven AI</div>
              <div className="text-sm font-bold leading-tight">{tStr({ en: "Agentic CX Studio", ar: "استوديو تجربة العميل", tr: "Ajansal CX Stüdyosu" }, lang)}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          <NavItem icon={Compass} label={tStr({ en: "Mission Control", ar: "مركز المهمة", tr: "Görev Kontrol" }, lang)} active={view.kind === "mission"} onClick={() => setView({ kind: "mission" })} />
          <NavItem icon={Network} label={tStr({ en: "Experience Graph", ar: "رسم تجربة العميل", tr: "Deneyim Grafiği" }, lang)} active={view.kind === "graph"} onClick={() => setView({ kind: "graph" })} />
          <NavItem icon={CheckCircle2} label={tStr({ en: "Outcomes Board", ar: "لوحة النتائج", tr: "Sonuçlar Panosu" }, lang)} active={view.kind === "outcomes"} onClick={() => setView({ kind: "outcomes" })} />

          <div className="pt-3 pb-1 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{tStr({ en: "Squads", ar: "الفرق", tr: "Takımlar" }, lang)}</div>
          {SQUADS.map((sq) => {
            const Icon = SQUAD_ICON[sq.id];
            const agentsInSquad = AGENTS.filter((a) => a.squad === sq.id);
            const done = agentsInSquad.filter((a) => completed.has(a.id)).length;
            const isOpen = (view.kind === "squad" && view.squad === sq.id) || (view.kind === "agent" && AGENTS.find((a) => a.id === view.id)?.squad === sq.id);
            return (
              <div key={sq.id}>
                <button onClick={() => setView({ kind: "squad", squad: sq.id })} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-start ${view.kind === "squad" && view.squad === sq.id ? "bg-slate-100 font-bold" : "hover:bg-slate-50"}`}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sq.color }} />
                  <Icon size={13} className="shrink-0 text-slate-400" />
                  <span className="flex-1 truncate">{t(sq.name)}</span>
                  <span className="text-[10px] text-slate-400">{done}/{agentsInSquad.length}</span>
                </button>
                {isOpen && (
                  <div className="ms-5 mt-0.5 space-y-0.5 mb-1.5">
                    {agentsInSquad.map((a) => {
                      const pinned = personaCfg.pinned.includes(a.id);
                      return (
                        <button key={a.id} onClick={() => setView({ kind: "agent", id: a.id })} className={`w-full text-start text-[11px] flex items-center gap-1.5 px-2 py-1 rounded ${view.kind === "agent" && view.id === a.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                          <span className={`w-1 h-1 rounded-full ${completed.has(a.id) ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <span className="truncate flex-1">{t(a.name)}</span>
                          {pinned && <Pin size={9} className="opacity-60 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1"><Building2 size={10} />{tStr({ en: "Scenario", ar: "السيناريو", tr: "Senaryo" }, lang)}</div>
          <select value={scenarioId} onChange={(e) => { setScenarioId(e.target.value as ScenarioId); reset(); }} className="w-full text-[12px] border border-slate-200 rounded px-2 py-1.5 bg-white">
            {SCENARIOS.map((s) => (<option key={s.id} value={s.id}>{t(s.client)}</option>))}
          </select>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pt-1.5">{tStr({ en: "Operator persona", ar: "شخصية المُشغّل", tr: "Operatör persona" }, lang)}</div>
          <select value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)} className="w-full text-[12px] border border-slate-200 rounded px-2 py-1.5 bg-white">
            {PERSONAS.map((p) => (<option key={p.id} value={p.id}>{t(p.name)}</option>))}
          </select>
          <div className="text-[10px] text-slate-500 leading-snug">{t(personaCfg.focus)}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-slate-200 bg-white px-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">{t(scenario.client)} · {t(scenario.industry)} · {t(scenario.contractValue)}</div>
            <div className="text-[13px] font-bold truncate">{t(scenario.scenario)}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setCockpitOpen(true)} className="px-2.5 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1 border border-slate-200 hover:border-slate-400" title={tStr({ en: "Agent Cockpit", ar: "قمرة الوكيل", tr: "Ajan Kokpiti" }, lang)}>
              <Cpu size={12} />
              {tStr({ en: "Cockpit", ar: "القمرة", tr: "Kokpit" }, lang)}
            </button>
            <button
              onClick={() => setRunning((r) => !r)}
              className="px-3 py-1.5 rounded-full text-[12px] font-bold flex items-center gap-1.5 text-white"
              style={{ background: running ? CORAL : ACCENT }}
            >
              {running ? <Pause size={12} /> : <Play size={12} />}
              {running
                ? tStr({ en: "Pause", ar: "إيقاف", tr: "Duraklat" }, lang)
                : completed.size > 0
                  ? tStr({ en: "Resume run", ar: "متابعة", tr: "Devam et" }, lang)
                  : tStr({ en: "Run the case", ar: "تشغيل الحالة", tr: "Vakayı çalıştır" }, lang)}
            </button>
            {running && (
              <button onClick={skip} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500" title={tStr({ en: "Skip agent", ar: "تخطّي", tr: "Atla" }, lang)}><SkipForward size={13} /></button>
            )}
            {completed.size > 0 && (
              <button onClick={reset} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500" title={tStr({ en: "Reset", ar: "إعادة", tr: "Sıfırla" }, lang)}><RotateCcw size={13} /></button>
            )}
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <Globe size={13} className="text-slate-400" />
            <div className="flex rounded-full bg-slate-100 p-0.5 text-[10px] font-bold">
              {(["en", "ar", "tr"] as Lang[]).map((l) => (
                <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 rounded-full uppercase ${lang === l ? "bg-white shadow-sm" : "text-slate-500"}`}>{l}</button>
              ))}
            </div>
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-6 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={JSON.stringify(view) + scenarioId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {view.kind === "mission" && <MissionControl scenarioId={scenarioId} persona={persona} completed={completed} onJump={(id) => setView({ kind: "agent", id })} />}
              {view.kind === "graph" && <ExperienceGraph onAgent={(id) => setView({ kind: "agent", id })} />}
              {view.kind === "outcomes" && <OutcomesBoard scenarioId={scenarioId} />}
              {view.kind === "squad" && <SquadView squad={view.squad} completed={completed} onAgent={(id) => setView({ kind: "agent", id })} />}
              {view.kind === "agent" && (() => {
                const a = AGENTS.find((x) => x.id === view.id)!;
                return <AgentPanel agent={a} scenarioId={scenarioId} done={completed.has(a.id)} active={activeAgent === a.id && running} onComplete={() => setCompleted((p) => new Set(p).add(a.id))} onCockpit={() => setCockpitOpen(true)} />;
              })()}
            </motion.div>
          </AnimatePresence>

          {/* Narrator caption track (sticky bottom) */}
          <AnimatePresence>
            {running && narration && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-6 inset-x-0 z-30 flex justify-center pointer-events-none px-6"
              >
                <div className="max-w-3xl w-full rounded-xl px-5 py-3 text-white shadow-2xl" style={{ background: INK }}>
                  <div className="text-[9px] uppercase font-bold tracking-widest opacity-60 mb-0.5">{tStr({ en: "Narrator", ar: "السارد", tr: "Anlatıcı" }, lang)}</div>
                  <div className="text-[13px] leading-snug">{t(narration)}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Agent Cockpit drawer */}
      <AgentCockpit
        open={cockpitOpen} onClose={() => setCockpitOpen(false)}
        focusAgentId={view.kind === "agent" ? view.id : activeAgent}
        completed={completed}
      />
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: typeof Compass; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-start ${active ? "bg-slate-900 text-white font-bold" : "hover:bg-slate-50"}`}>
      <Icon size={13} />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ─── Mission Control ────────────────────────────────────────────────────
function MissionControl({ scenarioId, persona, completed, onJump }: { scenarioId: ScenarioId; persona: PersonaId; completed: Set<AgentId>; onJump: (id: AgentId) => void }) {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const personaCfg = PERSONAS.find((p) => p.id === persona)!;
  const total = AGENTS.length;
  const done = completed.size;
  const pct = Math.round((done / total) * 100);
  const nextAgent = AGENTS.find((a) => !completed.has(a.id));

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ACCENT }}>{tStr({ en: "Mission Control", ar: "مركز المهمة", tr: "Görev Kontrol" }, lang)} · {t(scenario.client)}</div>
        <h1 className="text-2xl font-extrabold mt-1" style={{ color: INK }}>{t(scenario.scenario)}</h1>
        <div className="text-[12px] text-slate-500 mt-1">{tStr({ en: "Sponsor", ar: "الراعي", tr: "Sponsor" }, lang)}: {t(scenario.sponsor)}</div>
        <p className="mt-3 text-[13px] text-slate-700 max-w-3xl leading-relaxed">{t(scenario.brief)}</p>
      </div>

      {/* Customer personas (named, scenario-specific) */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{tStr({ en: "Customer voice", ar: "صوت العميل", tr: "Müşteri sesi" }, lang)}</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {scenario.customers.map((c) => (
            <div key={c.id} className="border border-slate-200 rounded-xl p-3 bg-white">
              <div className="text-sm font-bold" style={{ color: ACCENT }}>{t(c.name)}</div>
              <div className="text-[10px] uppercase text-slate-400 tracking-wide mt-0.5">{t(c.segment)}</div>
              <div className="text-[12px] italic text-slate-600 mt-2">"{t(c.quote)}"</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <KPI label={tStr({ en: "Agents complete", ar: "وكلاء منجَزون", tr: "Tamamlanan ajan" }, lang)} value={`${done} / ${total}`} sub={`${pct}%`} accent={ACCENT} />
        <KPI label={tStr({ en: "Squads engaged", ar: "فرق فعّالة", tr: "Aktif takım" }, lang)} value={`${new Set(AGENTS.filter((a) => completed.has(a.id)).map((a) => a.squad)).size} / 5`} sub={tStr({ en: "of 5", ar: "من 5", tr: "/ 5" }, lang)} accent={CORAL} />
        <KPI label={tStr({ en: "Forecast NPS", ar: "توقّع NPS", tr: "Tahmini NPS" }, lang)} value="+34" sub={tStr({ en: "from +18 baseline", ar: "من قاعدة +18", tr: "+18 mevcuttan" }, lang)} accent={INK} />
      </div>

      {/* Persona-pinned agents */}
      <div className="border rounded-xl p-4" style={{ background: "#F0F9F8", borderColor: ACCENT }}>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: ACCENT }}>{tStr({ en: "Pinned for", ar: "مثبّت لـ", tr: "Sabitlenmiş" }, lang)} {t(personaCfg.name)}</div>
        <div className="flex flex-wrap gap-2">
          {personaCfg.pinned.map((id) => {
            const a = AGENTS.find((x) => x.id === id)!;
            return (
              <button key={id} onClick={() => onJump(id)} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white border border-slate-200 hover:border-slate-400 flex items-center gap-1.5">
                <Pin size={10} />{t(a.name)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{tStr({ en: "Squad status", ar: "حالة الفرق", tr: "Takım durumu" }, lang)}</div>
          {SQUADS.map((sq) => {
            const Icon = SQUAD_ICON[sq.id];
            const inSquad = AGENTS.filter((a) => a.squad === sq.id);
            const sqDone = inSquad.filter((a) => completed.has(a.id)).length;
            return (
              <div key={sq.id} className="border border-slate-200 rounded-xl p-4 bg-white">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded flex items-center justify-center text-white" style={{ background: sq.color }}><Icon size={13} /></div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{t(sq.name)}</div>
                    <div className="text-[11px] text-slate-500">{t(sq.blurb)}</div>
                  </div>
                  <div className="text-[11px] font-bold text-slate-500">{sqDone}/{inSquad.length}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {inSquad.map((a) => (
                    <button key={a.id} onClick={() => onJump(a.id)} className={`text-[11px] px-2 py-1 rounded-full border ${completed.has(a.id) ? "border-transparent text-white" : "border-slate-200 text-slate-600 hover:border-slate-400"}`} style={completed.has(a.id) ? { background: sq.color } : {}}>
                      {t(a.name)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{tStr({ en: "Next checkpoint", ar: "نقطة الموافقة التالية", tr: "Sonraki kontrol noktası" }, lang)}</div>
          {nextAgent ? (
            <button onClick={() => onJump(nextAgent.id)} className="w-full text-start border border-slate-200 rounded-xl p-4 bg-white hover:shadow-sm transition">
              <div className="text-[10px] uppercase font-bold" style={{ color: ACCENT }}>{t(SQUADS.find((s) => s.id === nextAgent.squad)!.name)}</div>
              <div className="font-bold mt-1">{t(nextAgent.name)}</div>
              <div className="text-[12px] text-slate-500 mt-1">{t(nextAgent.role)}</div>
              <div className="text-[11px] text-slate-700 mt-3 flex items-center gap-1.5"><User size={12} />{t(nextAgent.checkpoint)}</div>
              <div className="mt-3 text-[11px] font-bold flex items-center gap-1" style={{ color: ACCENT }}>{tStr({ en: "Open agent panel", ar: "افتح لوحة الوكيل", tr: "Ajan panelini aç" }, lang)} <ChevronRight size={12} className="rtl:rotate-180" /></div>
            </button>
          ) : (
            <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 text-emerald-800 text-[12px] font-bold">{tStr({ en: "All 17 agents have run. Open the Outcomes Board.", ar: "تشغيل جميع الوكلاء الـ17.", tr: "17 ajan tamamlandı." }, lang)}</div>
          )}

          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 pt-2">{tStr({ en: "Glass-box trace", ar: "السلسلة الزجاجية", tr: "Cam-kutu iz" }, lang)}</div>
          <div className="border border-slate-200 rounded-xl p-3 bg-white text-[11px] space-y-1 max-h-64 overflow-y-auto">
            {AGENTS.filter((a) => completed.has(a.id)).map((a) => (
              <div key={a.id} className="flex items-start gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                <div><b>{t(a.name)}</b> · <span className="text-slate-500">{t(a.output)}</span></div>
              </div>
            ))}
            {completed.size === 0 && <div className="text-slate-400 italic">{tStr({ en: "No agents have run yet. Press Run the case.", ar: "اضغط تشغيل الحالة.", tr: "Vakayı çalıştır'a basın." }, lang)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-white">
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{label}</div>
      <div className="text-2xl font-extrabold mt-1" style={{ color: INK }}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

// ─── Squad view ─────────────────────────────────────────────────────────
function SquadView({ squad, completed, onAgent }: { squad: SquadId; completed: Set<AgentId>; onAgent: (id: AgentId) => void }) {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);
  const sq = SQUADS.find((s) => s.id === squad)!;
  const agents = AGENTS.filter((a) => a.squad === squad);
  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: sq.color }}>{tStr({ en: "Squad", ar: "الفرقة", tr: "Takım" }, lang)}</div>
        <h1 className="text-2xl font-extrabold" style={{ color: INK }}>{t(sq.name)}</h1>
        <p className="text-[13px] text-slate-500 mt-1">{t(sq.blurb)}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {agents.map((a) => (
          <button key={a.id} onClick={() => onAgent(a.id)} className="text-start border border-slate-200 rounded-xl p-4 bg-white hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-bold">{t(a.name)}</div>
              {completed.has(a.id) && <CheckCircle2 size={14} className="text-emerald-500" />}
            </div>
            <div className="text-[12px] text-slate-500">{t(a.role)}</div>
            <div className="mt-3 text-[11px] flex items-center gap-1" style={{ color: sq.color }}>{tStr({ en: "Open panel", ar: "افتح اللوحة", tr: "Paneli aç" }, lang)} <ChevronRight size={12} className="rtl:rotate-180" /></div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Agent panel ────────────────────────────────────────────────────────
function AgentPanel({ agent, scenarioId, done, active, onComplete, onCockpit }: { agent: Agent; scenarioId: ScenarioId; done: boolean; active: boolean; onComplete: () => void; onCockpit: () => void }) {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);
  const sq = SQUADS.find((s) => s.id === agent.squad)!;
  const owner = PERSONAS.find((p) => p.id === agent.ownedBy)!;

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: sq.color }}>{t(sq.name)} · {tStr({ en: "Owned by", ar: "يملكها", tr: "Sahibi" }, lang)} {t(owner.name)}</div>
            <h1 className="text-2xl font-extrabold mt-1" style={{ color: INK }}>{t(agent.name)}</h1>
            <p className="text-[13px] text-slate-500 mt-1">{t(agent.role)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onCockpit} className="text-[10px] font-bold px-2 py-1 rounded-full border border-slate-200 hover:border-slate-400 flex items-center gap-1"><Cpu size={11} />{tStr({ en: "Cockpit", ar: "القمرة", tr: "Kokpit" }, lang)}</button>
            {active && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full text-white animate-pulse" style={{ background: CORAL }}>
                {tStr({ en: "RUNNING", ar: "قيد التشغيل", tr: "ÇALIŞIYOR" }, lang)}
              </span>
            )}
            {done && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1"><CheckCircle2 size={11} /> {tStr({ en: "SIGNED", ar: "موقّع", tr: "İMZALI" }, lang)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <Section title={tStr({ en: "Inputs", ar: "المدخلات", tr: "Girdiler" }, lang)}>
            <ul className="space-y-1.5 text-[12px]">
              {agent.inputs.map((inp, i) => (
                <li key={i} className="flex items-start gap-1.5"><span className="w-1 h-1 rounded-full mt-1.5 shrink-0" style={{ background: sq.color }} />{t(inp)}</li>
              ))}
            </ul>
          </Section>

          <Section title={tStr({ en: "Glass-box trace", ar: "السلسلة الزجاجية", tr: "Cam-kutu iz" }, lang)}>
            <ol className="space-y-1.5 text-[11px] text-slate-600">
              {agent.trace.map((step, i) => (
                <li key={i} className="flex items-start gap-1.5"><span className="font-mono text-slate-400 shrink-0">{i + 1}.</span>{t(step)}</li>
              ))}
            </ol>
          </Section>

          <Section title={tStr({ en: "Human checkpoint", ar: "نقطة الموافقة البشرية", tr: "İnsan kontrol noktası" }, lang)}>
            <div className="flex items-start gap-2">
              <User size={14} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="text-[12px]">{t(agent.checkpoint)}</div>
            </div>
            <button
              onClick={onComplete}
              disabled={done}
              className={`mt-3 w-full px-3 py-2 rounded-lg text-[12px] font-bold ${done ? "bg-emerald-100 text-emerald-700 cursor-default" : "text-white hover:opacity-90"}`}
              style={done ? {} : { background: ACCENT }}
            >
              {done
                ? tStr({ en: "✓ Signed off", ar: "✓ تمت الموافقة", tr: "✓ İmzalandı" }, lang)
                : tStr({ en: "Approve & advance", ar: "اعتمد وتقدّم", tr: "Onayla ve ilerle" }, lang)}
            </button>
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section title={`${tStr({ en: "Workbench", ar: "منصّة العمل", tr: "Çalışma tezgâhı" }, lang)} — ${t(agent.output)}`}>
            <Workbench agent={agent} scenarioId={scenarioId} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-white">
      <div className="px-4 py-2.5 border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Experience Graph ───────────────────────────────────────────────────
function ExperienceGraph({ onAgent }: { onAgent: (id: AgentId) => void }) {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);

  const cols = useMemo(() => SQUADS.map((sq) => ({ sq, agents: AGENTS.filter((a) => a.squad === sq.id) })), []);
  const colW = 220;
  const rowH = 84;
  const padL = 40;
  const padT = 60;
  const positions: Record<AgentId, { x: number; y: number }> = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    cols.forEach((c, ci) => {
      c.agents.forEach((a, ai) => { map[a.id] = { x: padL + ci * colW + colW / 2, y: padT + ai * rowH + rowH / 2 }; });
    });
    return map as Record<AgentId, { x: number; y: number }>;
  }, [cols]);

  // Edges follow the operational substrate.
  const edges: Array<[AgentId, AgentId]> = [
    ["customer-insight", "persona-modeler"], ["ethnographic-researcher", "persona-modeler"],
    ["ecosystem-mapper", "moments-designer"], ["persona-modeler", "journey-mapper"],
    ["customer-insight", "journey-mapper"],
    ["journey-mapper", "service-blueprinter"], ["service-blueprinter", "moments-designer"],
    ["moments-designer", "usability-tester"], ["usability-tester", "channel-orchestrator"],
    ["channel-orchestrator", "touchpoint-designer"], ["touchpoint-designer", "staff-experience"],
    ["moments-designer", "kpi-tree-compiler"], ["kpi-tree-compiler", "cx-strategist"],
    ["kpi-tree-compiler", "csat-forecaster"], ["channel-orchestrator", "compliance-sentinel"],
    ["usability-tester", "emotion-sentiment"],
    ["csat-forecaster", "change-manager"], ["cx-strategist", "change-manager"],
    ["compliance-sentinel", "change-manager"], ["change-manager", "staff-experience"],
  ];

  const width = padL + cols.length * colW;
  const height = padT + Math.max(...cols.map((c) => c.agents.length)) * rowH + 30;

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ACCENT }}>{tStr({ en: "Experience Graph", ar: "رسم تجربة العميل", tr: "Deneyim Grafiği" }, lang)}</div>
        <h1 className="text-2xl font-extrabold" style={{ color: INK }}>{tStr({ en: "VoC → Journey → Moments → Concepts → KPIs → Change", ar: "VoC ← الرحلة ← اللحظات ← النماذج ← المؤشرات ← التغيير", tr: "VoC → Yolculuk → Anlar → Konseptler → KPI → Değişim" }, lang)}</h1>
        <p className="text-[13px] text-slate-500 mt-1">{tStr({ en: "The shared substrate. Every agent reads from and writes to this graph — click any node to open its panel.", ar: "الركيزة المشتركة. اضغط أي عقدة لفتح لوحتها.", tr: "Paylaşılan zemin. Düğüme tıklayın." }, lang)}</p>
      </div>
      <div className="border border-slate-200 rounded-xl bg-white p-2 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: width }}>
          {cols.map((c, ci) => (
            <g key={c.sq.id}>
              <rect x={padL + ci * colW - colW / 2 + 12} y={padT - 30} width={colW - 24} height={height - padT + 10} rx={10} fill={c.sq.color} fillOpacity={0.04} stroke={c.sq.color} strokeOpacity={0.2} />
              <text x={padL + ci * colW} y={padT - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={c.sq.color}>{t(c.sq.name)}</text>
            </g>
          ))}
          {edges.map(([from, to], i) => {
            const a = positions[from], b = positions[to];
            if (!a || !b) return null;
            const midX = (a.x + b.x) / 2;
            return <path key={i} d={`M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`} stroke="#CBD5E1" strokeWidth={1.5} fill="none" />;
          })}
          {AGENTS.map((a) => {
            const p = positions[a.id];
            const sq = SQUADS.find((s) => s.id === a.squad)!;
            return (
              <g key={a.id} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" onClick={() => onAgent(a.id)}>
                <rect x={-90} y={-22} width={180} height={44} rx={8} fill="white" stroke={sq.color} strokeWidth={1.5} />
                <text x={0} y={-2} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{t(a.name).length > 24 ? t(a.name).slice(0, 22) + "…" : t(a.name)}</text>
                <text x={0} y={13} textAnchor="middle" fontSize={9} fill="#64748B">→ {t(a.output).length > 30 ? t(a.output).slice(0, 28) + "…" : t(a.output)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── Outcomes board ─────────────────────────────────────────────────────
function OutcomesBoard({ scenarioId }: { scenarioId: ScenarioId }) {
  const { lang } = useLang();
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ACCENT }}>{tStr({ en: "Outcomes Board", ar: "لوحة النتائج", tr: "Sonuçlar Panosu" }, lang)}</div>
        <h1 className="text-2xl font-extrabold" style={{ color: INK }}>{tStr({ en: "What the studio is forecasting", ar: "ما يتوقّعه الاستوديو", tr: "Stüdyonun öngördüğü" }, lang)}</h1>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Section title={tStr({ en: "KPI tree", ar: "شجرة المؤشرات", tr: "KPI ağacı" }, lang)}>
          <Workbench agent={AGENTS.find((a) => a.id === "kpi-tree-compiler")!} scenarioId={scenarioId} />
        </Section>
        <Section title={tStr({ en: "Cost-to-serve", ar: "تكلفة الخدمة", tr: "Hizmet maliyeti" }, lang)}>
          <Workbench agent={AGENTS.find((a) => a.id === "cx-strategist")!} scenarioId={scenarioId} />
        </Section>
        <Section title={tStr({ en: "NPS forecast", ar: "توقّع NPS", tr: "NPS tahmini" }, lang)}>
          <Workbench agent={AGENTS.find((a) => a.id === "csat-forecaster")!} scenarioId={scenarioId} />
        </Section>
        <div className="lg:col-span-3">
          <Section title={tStr({ en: "Change plan", ar: "خطة التغيير", tr: "Değişim planı" }, lang)}>
            <Workbench agent={AGENTS.find((a) => a.id === "change-manager")!} scenarioId={scenarioId} />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Agent Cockpit drawer ───────────────────────────────────────────────
function AgentCockpit({ open, onClose, focusAgentId, completed }: { open: boolean; onClose: () => void; focusAgentId: AgentId | null; completed: Set<AgentId> }) {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);
  const focus = focusAgentId ? AGENTS.find((a) => a.id === focusAgentId)! : AGENTS[0];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
          <motion.aside
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
            className="fixed top-0 bottom-0 end-0 w-[440px] max-w-full bg-white z-50 border-s border-slate-200 shadow-2xl flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ACCENT }}>{tStr({ en: "Agent Cockpit", ar: "قمرة الوكيل", tr: "Ajan Kokpiti" }, lang)}</div>
                <div className="text-sm font-bold mt-0.5">{t(focus.name)}</div>
              </div>
              <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X size={14} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Topology mini-graph */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{tStr({ en: "Topology", ar: "البنية", tr: "Topoloji" }, lang)}</div>
                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <svg viewBox="0 0 380 180" className="w-full">
                    {SQUADS.map((sq, i) => {
                      const cx = 70 + (i * 240) / 4;
                      return (
                        <g key={sq.id}>
                          <circle cx={cx} cy={90} r={26} fill={sq.color} fillOpacity={0.12} stroke={sq.color} />
                          <text x={cx} y={94} textAnchor="middle" fontSize={9} fontWeight={700} fill={sq.color}>{AGENTS.filter((a) => a.squad === sq.id && completed.has(a.id)).length}/{AGENTS.filter((a) => a.squad === sq.id).length}</text>
                          <text x={cx} y={130} textAnchor="middle" fontSize={8} fill="#64748B">{t(sq.name).split(" ")[0]}</text>
                        </g>
                      );
                    })}
                    {[0, 1, 2, 3].map((i) => (<line key={i} x1={70 + (i * 240) / 4 + 26} y1={90} x2={70 + ((i + 1) * 240) / 4 - 26} y2={90} stroke="#CBD5E1" strokeWidth={1.5} />))}
                  </svg>
                </div>
              </div>

              {/* Live tool calls */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{tStr({ en: "Tool calls", ar: "استدعاءات الأدوات", tr: "Araç çağrıları" }, lang)}</div>
                <div className="border border-slate-200 rounded-lg bg-white divide-y divide-slate-100">
                  {focus.toolCalls.map((tc, i) => (
                    <div key={i} className="px-3 py-2 text-[11px] flex items-start gap-2">
                      <Cpu size={11} className="text-slate-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono font-bold">{tc.tool}</div>
                        <div className="text-slate-500 truncate">{t(tc.arg)}</div>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">{tc.ms}ms</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{tStr({ en: "Total", ar: "إجمالي", tr: "Toplam" }, lang)}: {focus.toolCalls.reduce((s, x) => s + x.ms, 0).toLocaleString()}ms · {focus.toolCalls.length} {tStr({ en: "calls", ar: "استدعاءات", tr: "çağrı" }, lang)}</div>
              </div>

              {/* Owner + checkpoint */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{tStr({ en: "Owner & checkpoint", ar: "المسؤول والموافقة", tr: "Sahip & kontrol noktası" }, lang)}</div>
                <div className="border border-slate-200 rounded-lg p-3 bg-white text-[11px] space-y-1">
                  <div><b>{tStr({ en: "Owned by", ar: "يملكها", tr: "Sahibi" }, lang)}:</b> {t(PERSONAS.find((p) => p.id === focus.ownedBy)!.name)}</div>
                  <div><b>{tStr({ en: "Checkpoint", ar: "الموافقة", tr: "Kontrol" }, lang)}:</b> {t(focus.checkpoint)}</div>
                  <div><b>{tStr({ en: "Status", ar: "الحالة", tr: "Durum" }, lang)}:</b> {completed.has(focus.id) ? <span className="text-emerald-600 font-bold">✓ {tStr({ en: "Signed", ar: "موقّع", tr: "İmzalı" }, lang)}</span> : <span className="text-slate-500">{tStr({ en: "Pending", ar: "بالانتظار", tr: "Beklemede" }, lang)}</span>}</div>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
