import { useLang, tStr, type T } from "@/lib/lang";
import {
  VOC_THEMES, VOC_SNIPPETS, ETHNO_NOTES, BENCH_GRID, PERSONA_CARDS, JOURNEY,
  BLUEPRINT, MOMENTS, CONCEPT_BOARD, CHANNEL_MATRIX, PILOT_PLAN, COACH_BOARD,
  KPI_TREE, COST_WATERFALL, CSAT_FORECAST,
  COMPLIANCE_MAP, BIAS_LOG, CHANGE_PLAN,
  SCENARIO_VOC, SCENARIO_JOURNEY,
} from "./data";
import type { Agent, ScenarioId } from "./data";

const ACCENT = "#0E7C7B";
const CORAL = "#F5715A";
const INK = "#0E2841";

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function Workbench({ agent, scenarioId = "falcon-sme" }: { agent: Agent; scenarioId?: ScenarioId }) {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);
  const vocThemes = SCENARIO_VOC[scenarioId] ?? VOC_THEMES;
  const journey = SCENARIO_JOURNEY[scenarioId] ?? JOURNEY;

  switch (agent.workbench) {
    case "voc-themes":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            {vocThemes.map((th) => (
              <div key={th.rank} className="border border-slate-200 rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: ACCENT }}>#{th.rank}</span>
                    <span className="font-bold text-sm truncate">{t(th.theme)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] shrink-0">
                    <span className="text-slate-500">n={th.volume}</span>
                    <span className="font-bold" style={{ color: CORAL }}>NPS Δ {th.npsImpact}</span>
                  </div>
                </div>
                <p className="mt-1.5 text-[12px] text-slate-600 italic">"{t(th.quote)}"</p>
                <Bar value={th.volume} max={Math.max(...vocThemes.map((v) => v.volume))} color={ACCENT} />
              </div>
            ))}
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">
              {tStr({ en: `Evidence — ${VOC_SNIPPETS.length} VoC verbatims`, ar: `الأدلة — ${VOC_SNIPPETS.length} اقتباس`, tr: `Kanıt — ${VOC_SNIPPETS.length} VoC alıntı` }, lang)}
            </div>
            <div className="border border-slate-200 rounded-lg bg-white max-h-48 overflow-y-auto divide-y divide-slate-100 text-[11px]">
              {VOC_SNIPPETS.map((s) => (
                <div key={s.id} className="px-2.5 py-1.5 flex items-center gap-2">
                  <span className="font-mono text-slate-400 w-10 shrink-0">{s.id}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">T{s.theme}</span>
                  <span className="truncate flex-1">"{t(s.quote)}"</span>
                  <span className="font-bold shrink-0" style={{ color: CORAL }}>{s.nps}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "ethno-notes":
      return (
        <div className="space-y-1.5">
          {ETHNO_NOTES.map((n) => (
            <div key={n.id} className="border border-slate-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-slate-400">{n.id}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${n.severity === "high" ? "bg-rose-100 text-rose-600" : n.severity === "med" ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"}`}>{n.severity.toUpperCase()}</span>
                </div>
                <span className="text-[11px] font-bold" style={{ color: ACCENT }}>{t(n.behaviour)}</span>
              </div>
              <p className="text-[12px] text-slate-700">{t(n.observation)}</p>
            </div>
          ))}
        </div>
      );

    case "bench-grid":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr><th className="text-start py-1.5 ps-2">{tStr({ en: "Peer", ar: "منافس", tr: "Rakip" }, lang)}</th>
                {BENCH_GRID.stages.map((s, i) => (<th key={i} className="text-center py-1.5">{t(s)}</th>))}
              </tr>
            </thead>
            <tbody>
              {BENCH_GRID.peers.map((p, pi) => (
                <tr key={pi} className={`border-t border-slate-200 ${pi === 0 ? "bg-rose-50/40 font-bold" : ""}`}>
                  <td className="py-1.5 ps-2">{t(p.name)}</td>
                  {p.scores.map((s, si) => (
                    <td key={si} className="py-1.5 text-center">
                      <span className="inline-flex items-center justify-center w-9 h-6 rounded text-white text-[10px] font-bold" style={{ background: s >= 75 ? "#16A34A" : s >= 60 ? "#F5A623" : CORAL }}>{s}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "personas":
      return (
        <div className="grid sm:grid-cols-3 gap-3">
          {PERSONA_CARDS.map((p) => (
            <div key={p.id} className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
              <div className="font-bold text-sm" style={{ color: ACCENT }}>{t(p.name)}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">{t(p.segment)}</div>
              <div><div className="text-[10px] font-bold uppercase text-slate-400">{tStr({ en: "Job", ar: "المهمّة", tr: "İş" }, lang)}</div><div className="text-[12px]">{t(p.jobs)}</div></div>
              <div><div className="text-[10px] font-bold uppercase text-slate-400">{tStr({ en: "Pain", ar: "الألم", tr: "Acı" }, lang)}</div><div className="text-[12px]">{t(p.pains)}</div></div>
              <div><div className="text-[10px] font-bold uppercase text-slate-400">{tStr({ en: "Gain", ar: "المكسب", tr: "Kazanım" }, lang)}</div><div className="text-[12px]">{t(p.gains)}</div></div>
            </div>
          ))}
        </div>
      );

    case "journey":
      return (
        <div className="space-y-1.5">
          {journey.map((s, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center text-[12px] border border-slate-200 rounded-lg p-2 bg-white">
              <div className="col-span-3 font-bold">{t(s.stage)}</div>
              <div className="col-span-3 text-slate-500">{t(s.channel)}</div>
              <div className="col-span-4">
                <Bar value={s.friction} max={100} color={s.friction > 60 ? CORAL : s.friction > 35 ? "#F5A623" : ACCENT} />
              </div>
              <div className="col-span-2 text-end font-bold" style={{ color: s.nps < 0 ? CORAL : ACCENT }}>NPS {s.nps > 0 ? `+${s.nps}` : s.nps}</div>
            </div>
          ))}
        </div>
      );

    case "blueprint":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="text-start py-2 ps-2">{tStr({ en: "Stage", ar: "المرحلة", tr: "Aşama" }, lang)}</th>
                <th className="text-start py-2">{tStr({ en: "Front-stage", ar: "الواجهة", tr: "Ön-sahne" }, lang)}</th>
                <th className="text-start py-2">{tStr({ en: "Back-stage", ar: "الخلفية", tr: "Arka-sahne" }, lang)}</th>
                <th className="text-start py-2">{tStr({ en: "System", ar: "النظام", tr: "Sistem" }, lang)}</th>
              </tr>
            </thead>
            <tbody>
              {BLUEPRINT.map((row, i) => (
                <tr key={i} className="border-t border-slate-200">
                  <td className="py-2 ps-2 font-bold" style={{ color: ACCENT }}>{t(row.stage)}</td>
                  <td className="py-2">{t(row.frontstage)}</td>
                  <td className="py-2 text-slate-500">{t(row.backstage)}</td>
                  <td className="py-2 text-slate-500">{t(row.system)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "moments":
      return (
        <div className="space-y-2">
          {MOMENTS.map((m) => (
            <div key={m.rank} className="border border-slate-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: CORAL }}>MoT #{m.rank}</span><span className="font-bold text-sm">{t(m.name)}</span></div>
                <span className="text-[11px] font-bold" style={{ color: ACCENT }}>+{m.lift} NPS</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-2 text-[12px]">
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] font-bold uppercase text-slate-400">{tStr({ en: "Today", ar: "اليوم", tr: "Bugün" }, lang)}</div>{t(m.current)}</div>
                <div className="rounded p-2 text-white" style={{ background: ACCENT }}><div className="text-[10px] font-bold uppercase opacity-80">{tStr({ en: "Redesigned", ar: "بعد التصميم", tr: "Yeniden tasarım" }, lang)}</div>{t(m.redesigned)}</div>
              </div>
            </div>
          ))}
        </div>
      );

    case "concept-board":
      return (
        <div className="space-y-3">
          {CONCEPT_BOARD.map((m, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-3 bg-white">
              <div className="text-[12px] font-bold mb-2">{t(m.moment)}</div>
              <div className="grid sm:grid-cols-3 gap-2">
                {m.concepts.map((c, j) => (
                  <div key={j} className={`rounded-lg p-2.5 border ${c.chosen ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                    <div className="text-[12px] font-bold flex items-center justify-between">
                      <span>{t(c.name)}</span>
                      {c.chosen && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">{tStr({ en: "PICKED", ar: "مختار", tr: "SEÇİLDİ" }, lang)}</span>}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px]">
                      <div><div className="text-slate-400 uppercase font-bold">{tStr({ en: "Feasible", ar: "ممكن", tr: "Uygulanabilir" }, lang)}</div><div className="font-bold">{c.feasibility}</div></div>
                      <div><div className="text-slate-400 uppercase font-bold">{tStr({ en: "NPS lift", ar: "تحسّن NPS", tr: "NPS artış" }, lang)}</div><div className="font-bold" style={{ color: ACCENT }}>+{c.lift}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );

    case "channel-matrix":
      return (
        <table className="w-full text-[12px]">
          <thead className="text-[10px] uppercase text-slate-400"><tr><th className="text-start py-2">{tStr({ en: "Moment", ar: "اللحظة", tr: "An" }, lang)}</th><th className="text-start py-2">{tStr({ en: "Channel of record", ar: "قناة السجل", tr: "Ana kanal" }, lang)}</th><th className="text-start py-2">{tStr({ en: "Secondary", ar: "ثانوية", tr: "İkincil" }, lang)}</th></tr></thead>
          <tbody>{CHANNEL_MATRIX.map((r, i) => (<tr key={i} className="border-t border-slate-200"><td className="py-2 font-bold">{t(r.moment)}</td><td className="py-2"><span className="px-2 py-0.5 rounded-full text-white text-[11px]" style={{ background: ACCENT }}>{t(r.channel)}</span></td><td className="py-2 text-slate-500">{t(r.secondary)}</td></tr>))}</tbody>
        </table>
      );

    case "pilot-plan":
      return (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-2 text-[11px]">
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white"><div className="text-[10px] uppercase font-bold text-slate-400">{tStr({ en: "Duration", ar: "المدّة", tr: "Süre" }, lang)}</div><div className="font-bold text-base">{PILOT_PLAN.weeks} {tStr({ en: "weeks", ar: "أسابيع", tr: "hafta" }, lang)}</div></div>
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white"><div className="text-[10px] uppercase font-bold text-slate-400">{tStr({ en: "Power", ar: "القوة", tr: "Güç" }, lang)}</div><div className="font-bold text-[11px]">{t(PILOT_PLAN.mde)}</div></div>
            <div className="border rounded-lg p-2.5" style={{ borderColor: CORAL, background: "#FFF5F2" }}><div className="text-[10px] uppercase font-bold" style={{ color: CORAL }}>{tStr({ en: "Stop condition", ar: "شرط الإيقاف", tr: "Durdurma" }, lang)}</div><div className="font-bold text-[11px]">{t(PILOT_PLAN.stop)}</div></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {PILOT_PLAN.branches.map((b, i) => (
              <div key={i} className={`border rounded-lg p-2.5 flex items-center justify-between ${b.arm === "treatment" ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-50"}`}>
                <div>
                  <div className="text-[12px] font-bold">{t(b.name)}</div>
                  <div className="text-[10px] text-slate-500">{b.region}</div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${b.arm === "treatment" ? "bg-emerald-500 text-white" : "bg-slate-400 text-white"}`}>{b.arm === "treatment" ? tStr({ en: "TREATMENT", ar: "علاج", tr: "TEDAVİ" }, lang) : tStr({ en: "HOLDOUT", ar: "مقارنة", tr: "KONTROL" }, lang)}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "coach-board":
      return (
        <div className="space-y-1.5">{COACH_BOARD.map((b, i) => (<div key={i} className="border border-slate-200 rounded-lg p-2.5 bg-white"><div className="flex items-center justify-between text-[12px] mb-1"><span className="font-bold">{t(b.branch)}</span><span className="text-slate-500">{b.adoption}% / {b.target}%</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden relative"><div className="h-full" style={{ width: `${b.adoption}%`, background: b.adoption >= b.target ? ACCENT : CORAL }} /><div className="absolute top-0 bottom-0 w-0.5 bg-slate-700" style={{ insetInlineStart: `${b.target}%` }} /></div></div>))}</div>
      );

    case "kpi-tree":
      return (
        <div className="space-y-2">
          <div className="rounded-lg p-3 text-white" style={{ background: ACCENT }}><div className="text-[10px] uppercase font-bold opacity-80">{tStr({ en: "North star", ar: "نجم الشمال", tr: "Kuzey yıldız" }, lang)}</div><div className="text-sm font-bold">{t(KPI_TREE.northStar.name)}</div><div className="mt-1 text-[12px]">{KPI_TREE.northStar.current} → <b>{KPI_TREE.northStar.target}</b></div></div>
          <div className="grid sm:grid-cols-2 gap-2">{KPI_TREE.drivers.map((d, i) => (<div key={i} className="border border-slate-200 rounded-lg p-2.5 bg-white"><div className="text-[12px] font-bold">{t(d.name)}</div><div className="text-[11px] text-slate-500 mt-0.5">{d.current} → <b style={{ color: ACCENT }}>{d.target}</b> {d.dir === "down" ? "↓" : "↑"}</div><div className="mt-1.5"><Bar value={d.dir === "down" ? Math.max(0, 100 - (d.current / Math.max(d.current, d.target * 4)) * 100) : (d.current / d.target) * 100} max={100} color={ACCENT} /></div></div>))}</div>
        </div>
      );

    case "cost-waterfall": {
      const max = Math.max(...COST_WATERFALL.map((c) => Math.abs(c.value)));
      return (
        <div className="space-y-1.5">{COST_WATERFALL.map((c, i) => { const pct = (Math.abs(c.value) / max) * 100; const color = c.type === "base" ? "#0E2841" : c.type === "down" ? ACCENT : CORAL; return (<div key={i} className="grid grid-cols-12 items-center gap-2 text-[12px]"><div className="col-span-5 font-bold">{t(c.label)}</div><div className="col-span-5 h-3 bg-slate-100 rounded"><div className="h-full rounded" style={{ width: `${pct}%`, background: color }} /></div><div className="col-span-2 text-end font-mono">{c.value > 0 && c.type !== "base" ? "+" : ""}{c.value.toLocaleString()}</div></div>); })}<div className="text-[11px] text-slate-500 text-end mt-2">{tStr({ en: "AED per onboarded SME", ar: "درهم لكل شركة صغيرة", tr: "Onboarded KOBİ başına AED" }, lang)}</div></div>
      );
    }

    case "csat-forecast": {
      const max = 40;
      return (
        <div className="space-y-2">
          <div className="flex items-end gap-1.5 h-32">{CSAT_FORECAST.map((p, i) => (<div key={i} className="flex-1 flex flex-col items-center gap-1"><div className="w-full relative h-full"><div className="absolute bottom-0 inset-x-0 rounded-t" style={{ height: `${(p.high / max) * 100}%`, background: ACCENT, opacity: 0.2 }} /><div className="absolute bottom-0 inset-x-1 rounded-t" style={{ height: `${(p.mid / max) * 100}%`, background: ACCENT, opacity: 0.7 }} />{p.actual !== null && (<div className="absolute bottom-0 inset-x-2 rounded-t" style={{ height: `${(p.actual / max) * 100}%`, background: CORAL }} />)}</div><div className="text-[10px] text-slate-500">{p.month}</div><div className="text-[10px] font-bold">{p.mid}</div></div>))}</div>
          <div className="text-[11px] text-slate-500 flex gap-3 items-center"><span className="inline-block w-3 h-3 rounded" style={{ background: CORAL }} /> {tStr({ en: "Actual", ar: "فعلي", tr: "Gerçek" }, lang)} <span className="inline-block w-3 h-3 rounded" style={{ background: ACCENT }} /> {tStr({ en: "Forecast (mid / band)", ar: "توقّع", tr: "Tahmin" }, lang)}</div>
        </div>
      );
    }

    case "compliance-map":
      return (
        <div className="space-y-1.5">{COMPLIANCE_MAP.map((c, i) => (<div key={i} className="border border-slate-200 rounded-lg p-2.5 bg-white"><div className="flex items-center justify-between gap-2"><div className="font-bold text-[12px]">{t(c.change)}</div><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-400">{c.clause}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.status === "ok" ? "bg-emerald-100 text-emerald-700" : c.status === "open" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"}`}>{c.status.toUpperCase()}</span></div></div><div className="mt-1 text-[11px] text-slate-500">{t(c.note)}</div></div>))}</div>
      );

    case "bias-log":
      return (
        <div className="space-y-1.5">{BIAS_LOG.map((b) => (<div key={b.id} className="border border-slate-200 rounded-lg p-2.5 bg-white"><div className="flex items-center justify-between"><div className="text-[12px] font-bold">{t(b.type)}</div><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${b.status === "open" ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-700"}`}>{b.status.toUpperCase()}</span></div><div className="text-[11px] text-slate-500 mt-0.5"><span className="font-mono">{b.id}</span> · {t(b.note)}</div></div>))}</div>
      );

    case "change-plan":
      return (
        <div className="space-y-3">{CHANGE_PLAN.map((h, i) => (<div key={i}><div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: ACCENT }}>{h.horizon}</div><div className="space-y-1">{h.items.map((it, j) => (<div key={j} className="flex items-center justify-between border border-slate-200 rounded p-2 bg-white text-[12px]"><span className="font-bold">{t(it.name)}</span><span className="text-[11px] text-slate-500">{t(it.owner)}</span></div>))}</div></div>))}</div>
      );

    default:
      return null;
  }
}
