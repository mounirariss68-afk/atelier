import { useState } from "react";
import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { useCscLang } from "../DemoLangContext";
import { workspace, tDict } from "../citizen-i18n";
import { tt, getCitizen, getService, getMinistry, getCscAgent, getRegion, formatRelative } from "@/data/citizen-services-seed";
import { BRAND, BRAND_MUTED, NAVY, SEVERITY } from "../tokens";
import { CheckCircle2, Edit3, X, Calendar, FileText, Sparkles, ArrowRight, ChevronDown } from "lucide-react";
import { useCscToast } from "../ToastContext";

export default function CaseWorkspaceView({ caseId, onChangeCase }: { caseId: string | null; onChangeCase: (id: string) => void }) {
  const { lang } = useCscLang();
  const t = tDict(workspace, lang);
  const { cases } = useCitizenServicesData();
  const { toast } = useCscToast();
  const [openSelector, setOpenSelector] = useState(false);

  const c = cases.find((x) => x.id === caseId) ?? cases[0];
  const cit = getCitizen(c.citizenId);
  const svc = getService(c.serviceId);
  const region = cit ? getRegion(cit.regionId) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
          <div className="relative inline-block mt-1">
            <button onClick={() => setOpenSelector((v) => !v)} className="text-sm text-gray-600 flex items-center gap-1 hover:text-gray-900">
              <span className="font-semibold" style={{ color: BRAND }}>{c.id}</span>
              <span>·</span>
              <span>{cit ? tt(cit.name, lang) : ""}</span>
              <ChevronDown size={14} />
            </button>
            {openSelector && (
              <div className="absolute z-20 mt-1 bg-white rounded-lg border border-gray-100 shadow-lg max-h-60 overflow-y-auto min-w-[280px]">
                {cases.map((cc) => (
                  <button key={cc.id} onClick={() => { onChangeCase(cc.id); setOpenSelector(false); }}
                    className={`w-full text-start px-3 py-1.5 text-[12px] hover:bg-emerald-50 ${cc.id === c.id ? "bg-emerald-50 font-semibold" : ""}`}>
                    <span style={{ color: BRAND }}>{cc.id}</span> · {getCitizen(cc.citizenId) ? tt(getCitizen(cc.citizenId)!.name, lang) : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => toast(t.bookedToast, "success")} className="text-[12px] px-3 py-2 rounded-md font-semibold text-white flex items-center gap-1.5" style={{ background: BRAND }}>
            <Calendar size={13} /> {t.bookInspection}
          </button>
          <button onClick={() => toast(t.resolvedToast, "info")} className="text-[12px] px-3 py-2 rounded-md font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> {t.resolve}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Citizen 360 */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{t.citizen360}</p>
          <p className="text-base font-bold text-gray-900">{cit ? tt(cit.name, lang) : ""}</p>
          <div className="space-y-1.5 mt-3 text-[12px]">
            <Row k={t.nationalId}        v={cit?.nationalId ?? "—"} />
            <Row k={t.channel}           v={cit ? `${cit.channelPref} · ${cit.phone}` : "—"} />
            <Row k={t.region}            v={region ? tt(region.name, lang) : "—"} />
            <Row k={t.pastInteractions}  v={String(cit?.pastInteractions ?? 0)} />
            <Row k={lang === "en" ? "Service" : "الخدمة"} v={svc ? tt(svc.name, lang) : ""} />
            <Row k={lang === "en" ? "Charter" : "ميثاق الخدمة"} v={svc ? `${svc.charterHours}h` : "—"} />
          </div>
        </div>

        {/* Cross-agency timeline */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 lg:col-span-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">{t.timeline}</p>
          <div className="space-y-2.5">
            {c.ministryTouchpoints.map((tp, i) => {
              const m = getMinistry(tp.ministryId);
              const sColor = tp.status === "complete" ? SEVERITY.ok : tp.status === "blocked" ? SEVERITY.critical : tp.status === "scheduled" ? SEVERITY.high : SEVERITY.medium;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full mt-1.5" style={{ background: sColor }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-white px-1.5 py-0.5 rounded" style={{ background: m?.color ?? "#999" }}>{m ? tt(m.short, lang) : tp.ministryId}</span>
                      <span className="text-[10px] text-gray-400 uppercase font-semibold">{tp.status}</span>
                    </div>
                    <p className="text-[12.5px] text-gray-700 mt-0.5">{tt(tp.label, lang)}</p>
                    <p className="text-[10px] text-gray-400">{tp.at}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 p-3 rounded-lg" style={{ background: BRAND_MUTED }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles size={11} style={{ color: BRAND }} />
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: BRAND }}>{t.nextStep}</p>
            </div>
            <p className="text-[12.5px] text-gray-700 leading-relaxed">{tt(c.agentNextStep, lang)}</p>
          </div>
        </div>
      </div>

      {/* Agent drafts */}
      {c.agentDrafts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">{t.agentDrafts}</p>
          <div className="grid md:grid-cols-2 gap-3">
            {c.agentDrafts.map((d) => {
              const agent = getCscAgent(d.authorAgentId);
              return (
                <div key={d.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase" style={{ color: agent?.color ?? BRAND }}>{agent ? tt(agent.name, lang) : d.authorAgentId}</span>
                    <span className="text-[10px] font-semibold" style={{ color: BRAND }}>{d.confidence}%</span>
                  </div>
                  <p className="text-[12.5px] font-semibold text-gray-800 mb-1.5">{tt(d.title, lang)}</p>
                  <div className="text-[11.5px] text-gray-700 whitespace-pre-line bg-white border border-gray-100 rounded p-2 mb-2 leading-relaxed" dir={d.kind === "sms" ? "rtl" : undefined}>
                    {lang === "en" ? d.bodyEn : d.bodyAr}
                  </div>
                  {lang === "en" && d.kind === "sms" && (
                    <div className="text-[11.5px] text-gray-700 whitespace-pre-line bg-white border border-gray-100 rounded p-2 mb-2 leading-relaxed" dir="rtl">{d.bodyAr}</div>
                  )}
                  <div className="flex gap-1.5">
                    <button onClick={() => toast(t.sentToast, "success")} className="text-[11px] px-3 py-1.5 rounded-md text-white font-semibold flex items-center gap-1" style={{ background: BRAND }}>
                      <CheckCircle2 size={11} /> {t.approveSend}
                    </button>
                    <button onClick={() => toast(lang === "en" ? "Edit mode opened." : "وضع التعديل مفتوح.", "info")} className="text-[11px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-white flex items-center gap-1">
                      <Edit3 size={11} /> {t.edit}
                    </button>
                    <button onClick={() => toast(lang === "en" ? "Dismissed." : "تم التجاهل.", "warning")} className="text-[11px] px-3 py-1.5 rounded-md text-gray-500 hover:bg-white flex items-center gap-1">
                      <X size={11} /> {t.dismiss}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">{t.documents}</p>
        <div className="space-y-2">
          {c.history.map((h, i) => (
            <div key={i} className="flex items-start gap-3 text-[12px]">
              <FileText size={12} className="text-gray-300 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-gray-700">{tt(h.event, lang)}</p>
                <p className="text-[10px] text-gray-400">{tt(h.actor, lang)} · {formatRelative(h.at, undefined, lang)}</p>
              </div>
              <ArrowRight size={12} className="text-gray-300 mt-1" style={{ color: NAVY }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-gray-500">{k}</span>
      <span className="font-semibold text-gray-800 text-end">{v}</span>
    </div>
  );
}
