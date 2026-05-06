import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Calendar, ChevronRight, Sparkles, Map, Diff, Archive, FileSignature } from "lucide-react";
import { useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import { ragBg, DOMAIN_LABEL } from "@/data/sama-compliance-seed";
import { useSamaDemoLang } from "../DemoLangContext";
import { circular, useTrFactory } from "../sama-i18n";
import { BRAND, BRAND_INK } from "../tokens";

export default function CircularDetailView({ circularId, onNavigate }: { circularId?: string; onNavigate?: (page: string, id?: string) => void }) {
  const { circulars, paragraphTraces, obligations, controls } = useSamaComplianceData();
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";

  const initial = circularId && circulars.some((c) => c.id === circularId) ? circularId : circulars[0]?.id;
  const [selected, setSelected] = useState<string>(initial);
  const [tab, setTab] = useState<"obligations" | "controls" | "evidence">("obligations");
  const [paraIdx, setParaIdx] = useState(0);

  const c = circulars.find((x) => x.id === selected) ?? circulars[0];
  const traces = useMemo(() => paragraphTraces.filter((p) => p.circularId === c?.id), [paragraphTraces, c]);
  const trace = traces[paraIdx];

  const linkedObligations = useMemo(() => obligations.filter((o) => o.introducedBy === c?.id), [obligations, c]);
  const linkedControls = useMemo(() => {
    const ids = new Set<string>();
    linkedObligations.forEach((o) => o.controlIds.forEach((cid) => ids.add(cid)));
    return controls.filter((ct) => ids.has(ct.id));
  }, [controls, linkedObligations]);

  if (!c) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: BRAND_INK }}>
            <FileText size={18} style={{ color: BRAND }} />
            {t("title", circular)}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{lang === "ar" ? c.titleAr : c.titleEn}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-gray-500">{t("selectCircular", circular)}</span>
          <select value={selected} onChange={(e) => { setSelected(e.target.value); setParaIdx(0); }} className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
            {circulars.map((cc) => <option key={cc.id} value={cc.id}>{cc.id}</option>)}
          </select>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 lg:col-span-2">
          <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-3">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{c.regulator}</span>
            <span><Calendar size={10} className="inline mr-1" />{t("published", circular)}: {c.publishedAt}</span>
            <span>{t("effective", circular)}: {c.effectiveFrom}</span>
            <span>{c.paragraphCount} {isAr ? "فقرة" : "paragraphs"}</span>
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold">{c.status.toUpperCase()}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{lang === "ar" ? c.summaryAr : c.summaryEn}</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="text-sm font-bold mb-2" style={{ color: BRAND_INK }}>{t("whatChanged", circular)}</h3>
          <ul className="space-y-1.5 text-xs">
            <li><strong>{c.obligationCount}</strong> {isAr ? "التزام جديد" : "new obligations"}</li>
            <li><strong>{c.controlChanges}</strong> {isAr ? "تغيير ضوابط" : "control changes"}</li>
            <li><strong>{c.paragraphCount}</strong> {isAr ? "فقرات" : "paragraphs parsed"}</li>
            <li><strong>47</strong> {isAr ? "قطعة دليل جاهزة" : "evidence artefacts staged"}</li>
          </ul>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Paragraph viewer */}
        <div className="bg-white border border-gray-200 rounded-2xl">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("paragraphs", circular)}</h3>
            <div className="flex gap-1">
              {traces.map((tr, i) => (
                <button
                  key={tr.paragraph}
                  onClick={() => setParaIdx(i)}
                  className={`px-2 py-1 rounded text-[10px] font-bold ${i === paraIdx ? "text-white" : "text-gray-500 hover:bg-gray-100"}`}
                  style={i === paraIdx ? { background: BRAND } : undefined}
                >
                  {tr.paragraph}
                </button>
              ))}
            </div>
          </div>
          {!trace && (
            <div className="px-4 py-12 text-center text-xs text-gray-400">
              {isAr ? "لا توجد فقرات مفصّلة لهذا التعميم بعد." : "No paragraph traces for this circular yet."}
            </div>
          )}
          {trace && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold text-gray-500">{t("paragraph", circular)} {trace.paragraph}</span>
                {trace.isNew && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold text-[9px]">{t("newPara", circular)}</span>}
              </div>
              <p className="text-sm text-gray-800 leading-relaxed mb-4 whitespace-pre-line" dir={isAr ? "rtl" : "ltr"}>
                {isAr ? trace.textAr : trace.textEn}
              </p>
              <div className="flex border-b border-gray-100 mb-3">
                {(["obligations", "controls", "evidence"] as const).map((tb) => (
                  <button
                    key={tb}
                    onClick={() => setTab(tb)}
                    className={`px-3 py-1.5 text-xs font-semibold border-b-2 ${tab === tb ? "border-amber-500" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                    style={tab === tb ? { color: BRAND } : undefined}
                  >
                    {tb === "obligations" ? t("obligationsTab", circular) : tb === "controls" ? t("controlsTab", circular) : t("evidenceTab", circular)}
                  </button>
                ))}
              </div>
              {tab === "obligations" && (
                <ul className="space-y-1.5 text-xs">
                  {trace.obligationIds.map((id) => {
                    const o = obligations.find((x) => x.id === id);
                    if (!o) return <li key={id} className="font-mono text-gray-500">{id}</li>;
                    return (
                      <li key={id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50">
                        <div>
                          <p className="font-semibold" style={{ color: BRAND_INK }}>{isAr ? o.titleAr : o.titleEn}</p>
                          <p className="text-[10px] text-gray-500">{o.id} · {DOMAIN_LABEL[o.domain][lang] ?? DOMAIN_LABEL[o.domain].en}</p>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${ragBg(o.rag)}`}>{o.rag.toUpperCase()}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {tab === "controls" && (
                <ul className="space-y-1.5 text-xs">
                  {trace.controlIds.map((id) => {
                    const ct = controls.find((x) => x.id === id);
                    if (!ct) return <li key={id} className="font-mono text-gray-500">{id}</li>;
                    return (
                      <li key={id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50">
                        <div>
                          <p className="font-semibold" style={{ color: BRAND_INK }}>{isAr ? ct.titleAr : ct.titleEn}</p>
                          <p className="text-[10px] text-gray-500">{ct.id} · {ct.ownerName}</p>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${ragBg(ct.rag)}`}>{ct.lastTestResult}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {tab === "evidence" && (
                <ul className="space-y-1.5 text-xs">
                  {(isAr ? trace.evidenceLabelsAr : trace.evidenceLabelsEn).map((e, i) => (
                    <li key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
                      <Archive size={12} className="text-gray-500" />
                      <span className="text-gray-700">{e}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Cockpit workspace (read-only) */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} style={{ color: BRAND }} />
            <h3 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("cockpitWidgets", circular)}</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CockpitTile icon={<Map size={14} />} title={t("impactMap", circular)} sub={`${linkedObligations.length} ${isAr ? "التزام" : "obligations"}`} />
            <CockpitTile icon={<Diff size={14} />} title={t("controlChanges", circular)} sub={`${c.controlChanges} ${isAr ? "تغيير" : "diffs"}`} />
            <CockpitTile icon={<Archive size={14} />} title={t("evidencePack", circular)} sub={`47 ${isAr ? "قطعة" : "artefacts"}`} />
            <CockpitTile icon={<FileSignature size={14} />} title={t("returnSection", circular)} sub={isAr ? "جاهزة للتوقيع" : "ready to sign"} />
          </div>
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2">{isAr ? "ضوابط متأثرة" : "Controls touched"}</p>
            <div className="flex flex-wrap gap-1.5">
              {linkedControls.slice(0, 6).map((ct) => (
                <button
                  key={ct.id}
                  onClick={() => onNavigate?.("controls")}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold ${ragBg(ct.rag)} hover:opacity-80`}
                >
                  {ct.id}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => onNavigate?.("approvals")}
            className="w-full mt-4 py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1"
            style={{ background: BRAND }}
          >
            {isAr ? "افتح الاعتمادات" : "Open approvals"} <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CockpitTile({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="border border-gray-100 rounded-xl p-2.5">
      <div className="flex items-center gap-1.5 text-gray-500">{icon}<span className="text-[10px] font-bold uppercase tracking-wider">{title}</span></div>
      <p className="text-sm font-bold mt-1" style={{ color: BRAND_INK }}>{sub}</p>
    </div>
  );
}
