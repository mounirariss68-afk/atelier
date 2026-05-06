import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  MessageCircle, Mail, Phone, Headphones, Send, Edit3, Search, BookOpen, ShieldCheck,
  TrendingUp, Sparkles, Check, AlertTriangle, ChevronRight, FileText, Banknote, Bot,
} from "lucide-react";
import { useCustomerCareData } from "@/hooks/useCustomerCareData";
import { useCareLang } from "../DemoLangContext";
import { desk, tDict } from "../care-i18n";
import { useCareToast } from "../ToastContext";
import { BRAND, BRAND_MUTED, ACCENT_AI, CHANNEL_COLOR } from "../tokens";
import {
  FOCUS_CONV_ID, AISHA_ID, getCustomer, getKb, getCareAgentBadge,
  CHANNEL_LABEL, INTENT_LABEL, SENTIMENT_LABEL, PRIORITY_LABEL, tBi,
  type Channel, type Sentiment, type CareConversation,
} from "@/data/customer-care-seed";

const CHANNEL_ICONS: Record<Channel, typeof MessageCircle> = {
  whatsapp: MessageCircle, webchat: MessageCircle, email: Mail, voice: Phone,
};

const SENTIMENT_DOT: Record<Sentiment, string> = {
  happy: "bg-emerald-500", neutral: "bg-gray-400", frustrated: "bg-amber-500", angry: "bg-red-500",
};

export default function DeskView() {
  const { lang } = useCareLang();
  const t = tDict(desk, lang);
  const data = useCustomerCareData();
  const { toast } = useCareToast();

  const myConvs = data.conversations.filter((c) => c.assignedAgentId === AISHA_ID);
  const [activeId, setActiveId] = useState(FOCUS_CONV_ID);
  const active = data.conversations.find((c) => c.id === activeId) ?? myConvs[0];
  const [draftText, setDraftText] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [refundApproved, setRefundApproved] = useState(false);
  const [macroSearch, setMacroSearch] = useState("");

  const customer = active ? getCustomer(active.customerId) : undefined;
  const drafterBadge = useMemo(() => getCareAgentBadge("drafter", lang), [lang]);

  const aiDraft = active?.thread?.find((m) => m.isDraft);
  const currentDraft = draftText ?? (aiDraft ? (lang === "en" ? aiDraft.textEn : aiDraft.textAr) : "");

  const filteredMacros = data.macros.filter((m) => {
    const q = macroSearch.toLowerCase();
    if (!q) return true;
    return (lang === "en" ? m.titleEn : m.titleAr).toLowerCase().includes(q);
  });

  const send = () => {
    setSent(true);
    toast(t.sentToast, "success");
  };

  const insertCitation = (kbId: string) => {
    const kb = getKb(kbId);
    if (!kb) return;
    const cite = lang === "en" ? `\n\n[See: ${kb.titleEn}]` : `\n\n[راجع: ${kb.titleAr}]`;
    setDraftText((currentDraft ?? "") + cite);
    toast(t.insertedToast, "info");
  };

  const insertMacro = (id: string) => {
    const m = data.macros.find((x) => x.id === id);
    if (!m) return;
    const body = lang === "en" ? m.bodyEn : m.bodyAr;
    setDraftText((currentDraft ?? "") + "\n\n" + body);
  };

  const approveRefund = () => {
    setRefundApproved(true);
    toast(t.refundApproved, "success");
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_320px] gap-3 h-[calc(100vh-128px)]">
      {/* LEFT — conversation list */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-bold">{t.convListTitle}</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">{t.convListSub}</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {myConvs.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} onClick={() => { setActiveId(c.id); setSent(false); setDraftText(null); }} lang={lang} />)}
        </div>
      </div>

      {/* CENTER — thread + draft */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col min-h-0 overflow-hidden">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">{t.threadEmpty}</div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-100 flex items-start gap-3 flex-wrap">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: CHANNEL_COLOR[active.channel] + "18" }}>
                {(() => { const I = CHANNEL_ICONS[active.channel]; return <I size={16} style={{ color: CHANNEL_COLOR[active.channel] }} />; })()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold truncate">{lang === "en" ? active.subjectEn : active.subjectAr}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Tag>{customer ? (lang === "en" ? customer.nameEn : customer.nameAr) : "—"}</Tag>
                  <Tag>{tBi(CHANNEL_LABEL[active.channel], lang)}</Tag>
                  <Tag>{tBi(INTENT_LABEL[active.intent], lang)}</Tag>
                  <Tag><span className={`inline-block w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[active.sentiment]} me-1`} />{tBi(SENTIMENT_LABEL[active.sentiment], lang)}</Tag>
                  <Tag tone={active.slaRemainMins <= 15 ? "bad" : active.slaRemainMins <= 60 ? "warn" : "ok"}>SLA {active.slaRemainMins}m</Tag>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50/40">
              {(active.thread ?? []).filter((m) => !m.isDraft).map((m) => (
                <div key={m.id} className={`flex ${m.from === "customer" ? "" : "justify-end"}`}>
                  <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${m.from === "customer" ? "bg-white border border-gray-100" : m.from === "system" ? "bg-emerald-50 text-emerald-800 text-[11px] italic" : "text-white"}`} style={m.from === "agent" ? { background: BRAND } : {}}>
                    <p className="whitespace-pre-wrap">{lang === "en" ? m.textEn : m.textAr}</p>
                    <p className={`text-[10px] mt-1.5 ${m.from === "agent" ? "text-white/70" : "text-gray-400"}`}>{m.ts}</p>
                  </div>
                </div>
              ))}

              {/* AI draft card */}
              {aiDraft && !sent && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border-2 border-dashed shadow-sm overflow-hidden" style={{ borderColor: ACCENT_AI + "60" }}>
                  <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap" style={{ background: ACCENT_AI + "10" }}>
                    <Sparkles size={14} style={{ color: ACCENT_AI }} />
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: ACCENT_AI }}>{t.aiDraftLabel}</span>
                    <span className="text-[10px] text-gray-500">{t.aiDraftBy} <span className="font-semibold" style={{ color: drafterBadge.color }}>{drafterBadge.name}</span></span>
                    <span className="ms-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{aiDraft.confidence}% {t.aiConfidence}</span>
                  </div>
                  <textarea
                    value={currentDraft}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-3 text-[13px] leading-relaxed resize-none focus:outline-none whitespace-pre-wrap"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                  />
                  <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                    <button onClick={send} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold" style={{ background: BRAND }}>
                      <Send size={12} /> {t.sendBtn}
                    </button>
                    <button onClick={() => setDraftText(currentDraft)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                      <Edit3 size={12} /> {t.editBtn}
                    </button>
                  </div>
                </motion.div>
              )}

              {sent && (
                <div className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl px-4 py-2.5 text-[13px] text-white whitespace-pre-wrap" style={{ background: BRAND }}>
                    {currentDraft}
                    <p className="text-[10px] mt-1.5 text-white/70">09:31 · {lang === "en" ? "Sent" : "تم الإرسال"}</p>
                  </div>
                </div>
              )}

              {/* Refund card */}
              {active.hasRefundCard && !refundApproved && (
                <div className="bg-white rounded-2xl border border-amber-200 shadow-sm">
                  <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                    <Banknote size={14} className="text-amber-700" />
                    <span className="text-xs font-bold text-amber-900">{t.refundCardTitle}</span>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[12px] text-gray-700">{t.refundCardSub}</p>
                    <button onClick={approveRefund} className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold" style={{ background: BRAND }}>
                      <Check size={12} /> {t.approveRefund}
                    </button>
                  </div>
                </div>
              )}
              {refundApproved && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 text-[12px] text-emerald-800 flex items-center gap-2">
                  <Check size={14} /> {t.refundApproved}
                </div>
              )}
            </div>

            {/* Macros bar */}
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                <FileText size={11} /> {t.macros}
              </div>
              <div className="relative flex-1 min-w-[160px] max-w-[220px]">
                <Search size={11} className="absolute top-1/2 -translate-y-1/2 start-2 text-gray-300" />
                <input value={macroSearch} onChange={(e) => setMacroSearch(e.target.value)} placeholder={t.macroSearch} className="w-full text-[11px] ps-6 pe-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:border-emerald-400" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {filteredMacros.slice(0, 4).map((m) => (
                  <button key={m.id} onClick={() => insertMacro(m.id)} className="text-[10px] px-2 py-1 rounded-md border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 text-gray-600">{lang === "en" ? m.titleEn : m.titleAr}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* RIGHT — Customer 360 + KB + investigator + QA */}
      <div className="space-y-3 overflow-y-auto pe-1">
        {customer && (
          <Card title={t.customer360} icon={Headphones}>
            <div className="space-y-2 text-[12px]">
              <p className="font-bold text-sm">{lang === "en" ? customer.nameEn : customer.nameAr}</p>
              <p className="text-gray-500">{lang === "en" ? customer.segmentEn : customer.segmentAr}</p>
              <Stat label={t.clvLabel} value={`SAR ${customer.clvSAR.toLocaleString()}`} />
              <Stat label={t.tenureLabel} value={`${customer.tenureYears}y`} />
              <Stat label={t.lastTouchLabel} value={lang === "en" ? customer.lastTouchEn : customer.lastTouchAr} />
              <Stat label={t.productsLabel} value={lang === "en" ? customer.productsEn : customer.productsAr} />
              <Stat label={t.ordersLabel} value={String(customer.activeOrders)} />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{t.sentimentTrend}</p>
                <SentimentSpark trend={customer.sentimentTrend} />
              </div>
            </div>
          </Card>
        )}

        {active && active.id === FOCUS_CONV_ID && (
          <Card title={t.investigatorTitle} icon={TrendingUp} accent="#8B5CF6">
            <p className="text-[10px] text-gray-400 mb-2">{t.investigatorSub}</p>
            <ul className="space-y-1.5 text-[12px] text-gray-700 list-disc list-inside">
              <li>{lang === "en" ? "OMS · ORD-44218 · color delivered: white (expected: black)" : "OMS · ORD-44218 · لون مُسلَّم: أبيض (المتوقع: أسود)"}</li>
              <li>{lang === "en" ? "Payments · INV-2026-05-A & -B · same amount, 14s apart (system retry)" : "المدفوعات · INV-2026-05-A و -B · نفس المبلغ بفارق 14 ثانية (إعادة محاولة)"}</li>
              <li>{lang === "en" ? "Known issue · INC-2026-04-117 · patch 2026-05-04" : "مشكلة معروفة · INC-2026-04-117 · تصحيح 2026-05-04"}</li>
            </ul>
          </Card>
        )}

        {active && active.id === FOCUS_CONV_ID && active.goodwillSAR && (
          <Card title={t.goodwillTitle} icon={Banknote} accent="#E91E63">
            <p className="text-[10px] text-gray-400 mb-1.5">{t.goodwillSub}</p>
            <p className="text-base font-bold text-gray-800">{t.goodwillAmount}</p>
            <p className="text-[11px] text-gray-500 mt-1">{lang === "en" ? "Per KB-002 · 4-year tenure threshold" : "وفق KB-002 · عتبة 4 سنوات"}</p>
          </Card>
        )}

        {active && (
          <Card title={t.kbHits} icon={BookOpen}>
            <ul className="space-y-2">
              {active.kbHits.map((kbId) => {
                const kb = getKb(kbId);
                if (!kb) return null;
                return (
                  <li key={kbId} className="border border-gray-100 rounded-lg p-2.5">
                    <p className="text-[12px] font-semibold text-gray-800">{lang === "en" ? kb.titleEn : kb.titleAr}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{lang === "en" ? kb.excerptEn : kb.excerptAr}</p>
                    <button onClick={() => insertCitation(kbId)} className="mt-1.5 text-[10px] font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1">
                      <ChevronRight size={10} className="rtl:rotate-180" /> {t.insertBtn}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {active && active.id === FOCUS_CONV_ID && (
          <Card title={t.qaTitle} icon={ShieldCheck} accent="#196B24">
            <div className="space-y-1.5 text-[12px]">
              <Stat label={t.qaScore} value="94/100" highlight />
              <Stat label={t.qaTone} value="98" />
              <Stat label={t.qaAccuracy} value="96" />
              <Stat label={t.qaPolicy} value="94" />
              <p className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold mt-1.5"><Check size={10} /> {t.qaPass}</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ConvRow({ c, active, onClick, lang }: { c: CareConversation; active: boolean; onClick: () => void; lang: "en" | "ar" }) {
  const Icon = CHANNEL_ICONS[c.channel];
  const customer = getCustomer(c.customerId);
  const slaTone = c.slaRemainMins <= 15 ? "text-red-600" : c.slaRemainMins <= 60 ? "text-amber-600" : "text-gray-400";
  return (
    <button onClick={onClick} className={`w-full text-start px-3.5 py-3 hover:bg-gray-50 transition-colors ${active ? "bg-emerald-50/60 border-l-4 border-l-[#5BA98A]" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: CHANNEL_COLOR[c.channel] + "15" }}>
          <Icon size={12} style={{ color: CHANNEL_COLOR[c.channel] }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[c.sentiment]}`} />
            <p className="text-[12px] font-semibold truncate">{customer ? (lang === "en" ? customer.nameEn : customer.nameAr) : "—"}</p>
            {c.priority === "critical" && <AlertTriangle size={10} className="text-red-500" />}
          </div>
          <p className="text-[11px] text-gray-500 truncate mt-0.5">{lang === "en" ? c.subjectEn : c.subjectAr}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-semibold ${slaTone}`}>SLA {c.slaRemainMins}m</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-400">{c.lastTouchAgo}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function Card({ title, icon: Icon, accent, children }: { title: string; icon: typeof Headphones; accent?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <Icon size={13} style={{ color: accent ?? BRAND }} />
        <h3 className="text-xs font-bold">{title}</h3>
      </div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] text-gray-500 flex-shrink-0">{label}</span>
      <span className={`text-[11px] text-end ${highlight ? "font-bold text-emerald-700" : "font-semibold text-gray-700"}`}>{value}</span>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const cls = tone === "bad" ? "bg-red-50 text-red-700" : tone === "warn" ? "bg-amber-50 text-amber-700" : tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600";
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

function SentimentSpark({ trend }: { trend: number[] }) {
  const max = 5;
  const w = 200, h = 28;
  const step = w / (trend.length - 1);
  const pts = trend.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {trend.map((v, i) => <circle key={i} cx={i * step} cy={h - (v / max) * h} r="2.5" fill={BRAND} />)}
    </svg>
  );
}

void BRAND_MUTED; void Bot;
