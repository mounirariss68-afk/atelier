/**
 * Cognirise Personal Agent — Mind demo.
 *
 * Inline-SVG personal context graph with:
 *   - Category-cluster layout (deterministic — no physics deps).
 *   - Time scrubber: Day 1 → Year 1 reveals nodes/edges by `learnedAt`.
 *   - Click a node → side panel (label, scope, source, confidence, recent uses).
 *   - Scope toggle: Work / Personal / Both.
 *   - Search.
 *   - Live workday: replays the persona's day, animating node/edge highlights
 *     and scrolling an event ticker.
 *   - Export modal (employee-owned JSON-LD payload).
 *
 * Visual goal: read as a constellation of categories at first glance, then a
 * navigable knowledge map on hover/click.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Brain, Download, Eye, EyeOff, Pause, Play, RotateCcw, Search, X } from "lucide-react";
import { Link } from "wouter";
import { useLang, tStr } from "@/lib/lang";
import {
  CATEGORY_META,
  MILESTONES,
  MILESTONE_LABEL,
  PERSONAS,
  getPersona,
  pcgAt,
  type PCGCategory,
  type PCGEdge,
  type PCGMilestone,
  type PCGNode,
  type Persona,
} from "@/data/personal-agent-seed";
import PersonaSwitcher from "./PersonaSwitcher";

// ---------------------------------------------------------------------------
// Layout: deterministic category clusters around a central role hub.
// ---------------------------------------------------------------------------
const W = 760;
const H = 540;
const CENTER = { x: W / 2, y: H / 2 };

const CATEGORY_CLUSTERS: Record<PCGCategory, { angle: number; radius: number }> = {
  role: { angle: 0, radius: 0 },
  relationship: { angle: -Math.PI / 2, radius: 175 },
  preference: { angle: -Math.PI / 6, radius: 195 },
  project: { angle: Math.PI / 4, radius: 175 },
  skill: { angle: -3 * Math.PI / 4, radius: 175 },
  tool: { angle: Math.PI / 2, radius: 175 },
  domain: { angle: 5 * Math.PI / 6, radius: 195 },
  communication: { angle: -5 * Math.PI / 6, radius: 175 },
  personal: { angle: Math.PI / 6, radius: 215 },
};

function layoutNodes(nodes: PCGNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  // Group by category so we can fan members out around their cluster centre.
  const byCat = new Map<PCGCategory, PCGNode[]>();
  for (const n of nodes) {
    if (!byCat.has(n.category)) byCat.set(n.category, []);
    byCat.get(n.category)!.push(n);
  }
  for (const [cat, list] of byCat) {
    const cluster = CATEGORY_CLUSTERS[cat];
    const cx = CENTER.x + Math.cos(cluster.angle) * cluster.radius;
    const cy = CENTER.y + Math.sin(cluster.angle) * cluster.radius;
    if (cat === "role") {
      list.forEach((n) => positions.set(n.id, { x: CENTER.x, y: CENTER.y }));
      continue;
    }
    const r = Math.min(38 + list.length * 6, 70);
    list.forEach((n, i) => {
      const t = list.length === 1 ? 0 : (i / list.length) * Math.PI * 2;
      positions.set(n.id, {
        x: cx + Math.cos(t) * r,
        y: cy + Math.sin(t) * r,
      });
    });
  }
  return positions;
}

const COPY = {
  back: { en: "Back to detail page", ar: "العودة لصفحة الأداة", tr: "Detay sayfasına dön" },
  scope: { en: "Scope", ar: "النطاق", tr: "Kapsam" },
  scopeBoth: { en: "Both", ar: "كلاهما", tr: "Her ikisi" },
  scopeWork: { en: "Work", ar: "عمل", tr: "İş" },
  scopePersonal: { en: "Personal", ar: "شخصي", tr: "Kişisel" },
  search: { en: "Search nodes…", ar: "بحث في العقد…", tr: "Düğüm ara…" },
  export: { en: "Export my graph", ar: "تصدير رسمي", tr: "Grafiğimi dışa aktar" },
  exportTitle: { en: "Your Personal Context Graph — JSON-LD", ar: "رسم سياقك الشخصي — JSON-LD", tr: "Kişisel Bağlam Grafiğiniz — JSON-LD" },
  exportNote: {
    en: "This is the employee-owned, portable export. Take it with you when you change jobs. The new employer can import the work-scope subset they sign for; personal-scope nodes never leave your wallet.",
    ar: "هذا هو التصدير المحمول المملوك للموظف. خذه معك عند تغيير الوظيفة. يستطيع صاحب العمل الجديد استيراد شريحة نطاق العمل التي يوقّع عليها؛ عقد النطاق الشخصي لا تغادر محفظتك أبداً.",
    tr: "Bu, çalışana ait taşınabilir dışa aktarımdır. İş değiştirdiğinizde yanınıza alın. Yeni işveren, imzaladığı iş-kapsamı alt kümesini içe aktarabilir; kişisel-kapsam düğümleri cüzdanınızdan asla ayrılmaz.",
  },
  closeExport: { en: "Close", ar: "إغلاق", tr: "Kapat" },
  liveDay: { en: "Play live workday", ar: "تشغيل يوم العمل الحي", tr: "Canlı iş gününü oynat" },
  pauseDay: { en: "Pause", ar: "إيقاف مؤقت", tr: "Duraklat" },
  replayDay: { en: "Replay", ar: "إعادة", tr: "Tekrar oynat" },
  ticker: { en: "Live event stream", ar: "دفق الأحداث الحي", tr: "Canlı olay akışı" },
  empty: { en: "No nodes match this filter at this point in time.", ar: "لا توجد عقد تطابق هذا الفلتر حتى هذه النقطة.", tr: "Bu noktada bu filtreye uyan düğüm yok." },
  panelEmpty: { en: "Click a node to inspect what your agent learned, when, from where, and how it has been used.", ar: "انقر عقدة لتفحص ما تعلّمه مساعدك ومتى ومن أين وكيف استُخدم.", tr: "Ajanınızın ne öğrendiğini, ne zaman, nereden ve nasıl kullandığını incelemek için bir düğüme tıklayın." },
  panelLearnedAt: { en: "Learned", ar: "تعلّم", tr: "Öğrenildi" },
  panelSource: { en: "Source", ar: "المصدر", tr: "Kaynak" },
  panelConfidence: { en: "Confidence", ar: "الثقة", tr: "Güven" },
  panelUseCount: { en: "Used by your agent", ar: "استخدمها مساعدك", tr: "Ajanınız tarafından kullanıldı" },
  panelTimes: { en: "times", ar: "مرات", tr: "kez" },
  panelDecay: { en: "Freshness", ar: "النضارة", tr: "Tazelik" },
  panelRecentUses: { en: "Recent uses", ar: "آخر الاستخدامات", tr: "Son kullanımlar" },
  panelClose: { en: "Close", ar: "إغلاق", tr: "Kapat" },
  scrubber: { en: "Time scrubber", ar: "شريط الزمن", tr: "Zaman kaydırıcı" },
  legendFresh: { en: "fresh", ar: "حديث", tr: "taze" },
  legendRecent: { en: "recent", ar: "متوسط", tr: "son" },
  legendStale: { en: "stale", ar: "قديم", tr: "eski" },
  hint: { en: "Drag the time slider below to watch the graph grow.", ar: "اسحب شريط الزمن أدناه لمشاهدة الرسم ينمو.", tr: "Grafiğin büyümesini izlemek için aşağıdaki kaydırıcıyı sürükleyin." },
};

type Scope = "both" | "work" | "personal";

export default function Mind() {
  const { lang } = useLang();
  const [personaId, setPersonaId] = useState<Persona["id"]>("sales");
  const persona = useMemo(() => getPersona(personaId), [personaId]);
  const accent = persona.accent;

  const [milestoneIdx, setMilestoneIdx] = useState(MILESTONES.length - 1);
  const milestone: PCGMilestone = MILESTONES[milestoneIdx];

  const [scope, setScope] = useState<Scope>("both");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Live workday playback
  const [livePlaying, setLivePlaying] = useState(false);
  const [liveIdx, setLiveIdx] = useState(0);
  const tickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setMilestoneIdx(MILESTONES.length - 1);
    setLivePlaying(false);
    setLiveIdx(0);
  }, [personaId]);

  useEffect(() => {
    if (!livePlaying) return;
    if (liveIdx >= persona.liveWorkday.length) {
      setLivePlaying(false);
      return;
    }
    const t = setTimeout(() => setLiveIdx((i) => i + 1), 2200);
    return () => clearTimeout(t);
  }, [livePlaying, liveIdx, persona.liveWorkday.length]);

  useEffect(() => {
    tickerRef.current?.scrollTo({ top: tickerRef.current.scrollHeight, behavior: "smooth" });
  }, [liveIdx]);

  // Visible graph (milestone + scope + search)
  const { visibleNodes, visibleEdges, positions } = useMemo(() => {
    const slice = pcgAt(persona, milestone);
    const filtered = slice.nodes.filter((n) => {
      if (scope === "work" && n.scope !== "work") return false;
      if (scope === "personal" && n.scope !== "personal") return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!n.label.en.toLowerCase().includes(q) && !n.description.en.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const ids = new Set(filtered.map((n) => n.id));
    const edges = slice.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const pos = layoutNodes(filtered);
    return { visibleNodes: filtered, visibleEdges: edges, positions: pos };
  }, [persona, milestone, scope, search]);

  const selected = useMemo(() => persona.pcg.nodes.find((n) => n.id === selectedId) ?? null, [persona, selectedId]);
  const recentlyTouched = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < liveIdx; i++) {
      const ev = persona.liveWorkday[i];
      if (!ev) break;
      ev.touchedNodeIds.forEach((id) => set.add(id));
    }
    return set;
  }, [persona, liveIdx]);

  const lastTouched = useMemo(() => {
    const ev = persona.liveWorkday[liveIdx - 1];
    return new Set(ev?.touchedNodeIds ?? []);
  }, [persona, liveIdx]);

  return (
    <div className="min-h-screen bg-[#0B1828] text-white flex flex-col" dir={lang === "ar" ? "rtl" : "ltr"}>
      <header className="border-b border-white/10 bg-[#091828]">
        <div className="max-w-[1500px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <Link href="/marketplace/cognirise-personal-agent" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white/70 hover:text-white text-xs">
            <ArrowLeft size={12} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: accent }}>
              <Brain size={14} className="text-[#0A1230]" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
                {persona.agentName} · {tStr({ en: "The Mind", ar: "العقل", tr: "Zihin" }, lang)}
              </p>
              <p className="text-sm font-bold">{tStr(persona.personName, lang)} · {visibleNodes.length} nodes · {visibleEdges.length} edges</p>
            </div>
          </div>
          <div className="ml-auto rtl:ml-0 rtl:mr-auto flex items-center gap-2">
            <PersonaSwitcher
              personaId={personaId}
              onPersona={setPersonaId}
              accent={accent}
              otherVariant={{ route: "cockpit", label: { en: "Open the Cockpit", ar: "افتح القمرة", tr: "Kokpit'i aç" } }}
            />
            <button
              onClick={() => setExportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-emerald-400/90 text-[#0A1230] text-xs font-bold hover:bg-emerald-300"
            >
              <Download size={12} />
              {tStr(COPY.export, lang)}
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="border-b border-white/10 bg-[#0B1828]/80">
        <div className="max-w-[1500px] mx-auto px-4 py-2.5 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-full bg-white/5 p-1 text-xs">
            <span className="px-2 text-white/50">{tStr(COPY.scope, lang)}</span>
            {(["both", "work", "personal"] as Scope[]).map((s) => {
              const labelMap = { both: COPY.scopeBoth, work: COPY.scopeWork, personal: COPY.scopePersonal };
              return (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1 rounded-full font-bold ${scope === s ? "bg-white text-[#0A1230]" : "text-white/70 hover:text-white"}`}
                >
                  {tStr(labelMap[s], lang)}
                </button>
              );
            })}
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs flex-1 max-w-xs">
            <Search size={12} className="text-white/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tStr(COPY.search, lang)}
              className="bg-transparent flex-1 focus:outline-none text-white placeholder:text-white/40"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-white/50 hover:text-white"><X size={12} /></button>
            )}
          </div>

          <div className="ml-auto rtl:ml-0 rtl:mr-auto inline-flex items-center gap-1.5">
            {!livePlaying && liveIdx === 0 && (
              <button onClick={() => setLivePlaying(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20">
                <Play size={12} fill="currentColor" />
                {tStr(COPY.liveDay, lang)}
              </button>
            )}
            {livePlaying && (
              <button onClick={() => setLivePlaying(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20">
                <Pause size={12} fill="currentColor" />
                {tStr(COPY.pauseDay, lang)}
              </button>
            )}
            {!livePlaying && liveIdx > 0 && liveIdx < persona.liveWorkday.length && (
              <button onClick={() => setLivePlaying(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20">
                <Play size={12} fill="currentColor" />
                Resume
              </button>
            )}
            {liveIdx > 0 && (
              <button onClick={() => { setLivePlaying(false); setLiveIdx(0); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/5 text-white/70 text-xs font-bold hover:bg-white/10">
                <RotateCcw size={11} />
                {tStr(COPY.replayDay, lang)}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 max-w-[1500px] mx-auto w-full px-3 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Graph + scrubber */}
        <section className="lg:col-span-8 space-y-3">
          <div className="rounded-2xl bg-[#091828] border border-white/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/50 italic">{tStr(COPY.hint, lang)}</p>
              <div className="flex items-center gap-2 text-[10px] text-white/55">
                <Legend />
              </div>
            </div>
            <div className="relative">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Personal Context Graph">
                <defs>
                  <radialGradient id="hub" cx="50%" cy="50%">
                    <stop offset="0%" stopColor={accent} stopOpacity="0.8" />
                    <stop offset="100%" stopColor={accent} stopOpacity="0.05" />
                  </radialGradient>
                </defs>
                <rect x={0} y={0} width={W} height={H} fill="#0B1828" />
                {/* Subtle hub glow under the role node */}
                <circle cx={CENTER.x} cy={CENTER.y} r={120} fill="url(#hub)" opacity={0.6} />
                {/* Edges */}
                {visibleEdges.map((e, i) => {
                  const a = positions.get(e.from);
                  const b = positions.get(e.to);
                  if (!a || !b) return null;
                  const touched = lastTouched.has(e.from) && lastTouched.has(e.to);
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={touched ? accent : "#ffffff"}
                      strokeOpacity={touched ? 0.85 : 0.12}
                      strokeWidth={touched ? 1.5 : 0.6}
                    />
                  );
                })}
                {/* Nodes */}
                {visibleNodes.map((n) => {
                  const p = positions.get(n.id);
                  if (!p) return null;
                  const cat = CATEGORY_META[n.category];
                  const r = n.category === "role" ? 16 : 8;
                  const recent = recentlyTouched.has(n.id);
                  const last = lastTouched.has(n.id);
                  const decayOpacity = n.decayState === "fresh" ? 1 : n.decayState === "recent" ? 0.85 : 0.6;
                  const isSelected = n.id === selectedId;
                  return (
                    <g key={n.id} onClick={() => setSelectedId(n.id)} style={{ cursor: "pointer" }}>
                      {(last || isSelected) && (
                        <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke={cat.color} strokeOpacity={0.4} strokeWidth={2}>
                          <animate attributeName="r" values={`${r + 4};${r + 10};${r + 4}`} dur="1.6s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={r}
                        fill={cat.color}
                        opacity={decayOpacity}
                        stroke={isSelected ? "#fff" : recent ? accent : "rgba(255,255,255,0.25)"}
                        strokeWidth={isSelected || recent ? 2 : 0.75}
                      />
                      {n.scope === "personal" && (
                        <circle cx={p.x + r * 0.65} cy={p.y - r * 0.65} r={3.5} fill="#f472b6" stroke="#0B1828" strokeWidth={0.75} />
                      )}
                      {(isSelected || n.category === "role") && (
                        <text x={p.x} y={p.y + r + 11} textAnchor="middle" fontSize={9} fill="#fff" opacity={0.95} style={{ pointerEvents: "none" }}>
                          {tStr(n.label, lang).slice(0, 28)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {visibleNodes.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-white/50 italic">{tStr(COPY.empty, lang)}</p>
              )}
            </div>

            {/* Time scrubber */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{tStr(COPY.scrubber, lang)}</p>
                <p className="text-[10px] font-bold text-white/80">{tStr(MILESTONE_LABEL[milestone], lang)}</p>
              </div>
              <input
                type="range"
                min={0}
                max={MILESTONES.length - 1}
                step={1}
                value={milestoneIdx}
                onChange={(e) => setMilestoneIdx(Number(e.target.value))}
                className="w-full accent-[--ml-accent]"
                style={{ accentColor: accent } as React.CSSProperties}
              />
              <div className="flex justify-between mt-1 text-[9px] text-white/45">
                {MILESTONES.map((m) => (
                  <span key={m}>{tStr(MILESTONE_LABEL[m], lang)}</span>
                ))}
              </div>
            </div>

            {/* Category legend */}
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(CATEGORY_META).map(([cat, meta]) => (
                <span key={cat} className="inline-flex items-center gap-1 text-[10px] text-white/70">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  {tStr(meta.label, lang)}
                </span>
              ))}
            </div>
          </div>

          {/* Live event ticker */}
          {liveIdx > 0 && (
            <div className="rounded-2xl bg-[#091828] border border-white/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: accent }}>{tStr(COPY.ticker, lang)}</p>
              <div ref={tickerRef} className="space-y-1.5 max-h-44 overflow-y-auto pr-2">
                {persona.liveWorkday.slice(0, liveIdx).map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-white/45 w-12 flex-shrink-0">{ev.at}</span>
                    <span className="text-white/85">{tStr(ev.text, lang)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Side panel */}
        <aside className="lg:col-span-4 rounded-2xl bg-[#091828] border border-white/10 p-4 min-h-[500px]">
          {!selected && <p className="text-sm text-white/55 italic">{tStr(COPY.panelEmpty, lang)}</p>}
          {selected && (
            <NodePanel node={selected} accent={accent} onClose={() => setSelectedId(null)} />
          )}
        </aside>
      </main>

      {/* Export modal */}
      {exportOpen && (
        <ExportModal persona={persona} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}

function Legend() {
  const { lang } = useLang();
  return (
    <>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/90" /> {tStr(COPY.legendFresh, lang)}</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/60" /> {tStr(COPY.legendRecent, lang)}</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/30" /> {tStr(COPY.legendStale, lang)}</span>
      <span className="inline-flex items-center gap-1 ml-1"><span className="w-2 h-2 rounded-full bg-pink-400" /> {tStr(COPY.scopePersonal, lang)}</span>
    </>
  );
}

function NodePanel({ node, accent, onClose }: { node: PCGNode; accent: string; onClose: () => void }) {
  const { lang } = useLang();
  const meta = CATEGORY_META[node.category];
  return (
    <div>
      <div className="flex items-start gap-2 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: `${meta.color}25`, color: meta.color }}>
              {tStr(meta.label, lang)}
            </span>
            {node.scope === "personal" && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-300 inline-flex items-center gap-1">
                <Eye size={9} /> {tStr(COPY.scopePersonal, lang)}
              </span>
            )}
            {node.scope === "work" && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-white/10 text-white/70 inline-flex items-center gap-1">
                <EyeOff size={9} /> {tStr(COPY.scopeWork, lang)}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold text-white">{tStr(node.label, lang)}</h3>
          <p className="text-xs text-white/70 mt-1 leading-relaxed">{tStr(node.description, lang)}</p>
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white"><X size={14} /></button>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <PanelRow label={tStr(COPY.panelLearnedAt, lang)} value={tStr(MILESTONE_LABEL[node.learnedAt], lang)} />
        <PanelRow label={tStr(COPY.panelConfidence, lang)} value={node.confidence.toFixed(2)} accent={accent} />
        <PanelRow label={tStr(COPY.panelUseCount, lang)} value={`${node.useCount} ${tStr(COPY.panelTimes, lang)}`} />
        <PanelRow label={tStr(COPY.panelDecay, lang)} value={node.decayState} />
      </dl>

      <div className="mt-3 text-[11px] text-white/70">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/45 mb-1">{tStr(COPY.panelSource, lang)}</p>
        <p>{tStr(node.source, lang)}</p>
      </div>

      {node.recentUses && node.recentUses.length > 0 && (
        <div className="mt-3 text-[11px] text-white/75">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/45 mb-1">{tStr(COPY.panelRecentUses, lang)}</p>
          <ul className="space-y-1">
            {node.recentUses.map((u, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-1 w-1 h-1 rounded-full" style={{ background: accent }} />
                <span>{tStr(u, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PanelRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</dt>
      <dd className="text-white" style={accent ? { color: accent } : undefined}>{value}</dd>
    </div>
  );
}

function ExportModal({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  const { lang } = useLang();
  const json = useMemo(() => JSON.stringify(persona.exportPayload, null, 2), [persona]);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#091828] border border-white/15 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: persona.accent }}>{persona.agentName}</p>
            <h3 className="text-base font-bold text-white">{tStr(COPY.exportTitle, lang)}</h3>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1"><X size={16} /></button>
        </div>
        <p className="px-5 py-3 text-xs text-white/70 leading-relaxed border-b border-white/10">{tStr(COPY.exportNote, lang)}</p>
        <pre className="flex-1 overflow-auto bg-[#0B1828] text-[10px] text-white/80 p-4 font-mono">{json}</pre>
        <div className="px-5 py-3 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20">{tStr(COPY.closeExport, lang)}</button>
        </div>
      </div>
    </div>
  );
}
