import { useState } from "react";
import { Send, Save, Sparkles } from "lucide-react";
import { useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { useProcurementDemoLang } from "../DemoLangContext";
import { counter as t } from "../procurement-i18n";
import { getAgent } from "@/data/procurement-negotiation-agent";
import { BRAND, SEMANTIC } from "../tokens";
import { useToast } from "@/hooks/use-toast";

export default function CounterBidComposerView() {
  const { counterDrafts, suppliers } = useProcurementData();
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const { toast } = useToast();

  const [activeId, setActiveId] = useState<string>(counterDrafts[0]?.id ?? "");
  const active = counterDrafts.find((c) => c.id === activeId);
  const [body, setBody] = useState(active ? (isAr ? active.bodyAr : active.bodyEn) : "");
  const [subject, setSubject] = useState(active ? (isAr ? active.subjectAr : active.subjectEn) : "");
  const [sent, setSent] = useState<Record<string, "sent" | "saved">>({});

  const switchDraft = (id: string) => {
    const d = counterDrafts.find((c) => c.id === id);
    setActiveId(id);
    if (d) {
      setSubject(isAr ? d.subjectAr : d.subjectEn);
      setBody(isAr ? d.bodyAr : d.bodyEn);
    }
  };

  if (!active) {
    return <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-400">{t.empty[lang]}</div>;
  }

  const sup = suppliers.find((s) => s.id === active.supplierId)!;
  const agent = getAgent(active.authorAgentId as Parameters<typeof getAgent>[0]);
  const status = sent[active.id];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-[#0A1230]">{t.title[lang]}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.subtitle[lang]}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        {/* Drafts list */}
        <aside className="space-y-2">
          {counterDrafts.map((d) => {
            const s = suppliers.find((x) => x.id === d.supplierId)!;
            const a = getAgent(d.authorAgentId as Parameters<typeof getAgent>[0]);
            const isActive = d.id === activeId;
            const sStat = sent[d.id];
            return (
              <button key={d.id} onClick={() => switchDraft(d.id)} className={`w-full text-left bg-white border rounded-xl p-3 transition-colors ${isActive ? "border-[#D9534F] shadow-sm" : "border-gray-200 hover:border-gray-300"}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: `${a.color}1A`, color: a.color }}>{isAr ? a.nameAr : a.nameEn}</span>
                  {sStat === "sent" && <span className="text-[10px] font-bold text-emerald-700 ms-auto">✓</span>}
                </div>
                <p className="text-[12px] font-bold text-[#0A1230] line-clamp-2">{isAr ? d.subjectAr : d.subjectEn}</p>
                <p className="text-[11px] text-gray-500 mt-1">{isAr ? s.nameAr : s.nameEn}</p>
              </button>
            );
          })}
        </aside>

        {/* Editor */}
        <section className="bg-white border border-gray-200 rounded-xl">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Sparkles size={14} style={{ color: agent.color }} />
            <span className="text-[11px] text-gray-500">{t.draftedBy[lang]}: <span className="font-semibold text-[#0A1230]">{isAr ? agent.nameAr : agent.nameEn}</span></span>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{t.to[lang]}</label>
              <div className="text-sm text-[#0A1230] font-semibold mt-1">{isAr ? sup.nameAr : sup.nameEn} · {sup.code}</div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{t.subject[lang]}</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#D9534F]" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{t.body[lang]}</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#D9534F] font-mono leading-relaxed" />
            </div>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
            <button
              onClick={() => { setSent((p) => ({ ...p, [active.id]: "sent" })); toast({ title: t.sent[lang] }); }}
              disabled={status === "sent"}
              className="px-4 py-2 rounded-lg text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: status === "sent" ? SEMANTIC.good : BRAND }}
            >
              <Send size={12} /> {status === "sent" ? t.sent[lang] : t.send[lang]}
            </button>
            <button
              onClick={() => { setSent((p) => ({ ...p, [active.id]: "saved" })); toast({ title: t.saved[lang] }); }}
              className="px-3 py-2 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <Save size={12} /> {t.saveDraft[lang]}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
