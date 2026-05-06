import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Sparkles, Activity, Map as MapIcon, MessageSquare, FileText, TrendingDown, AlertTriangle, Truck, Languages } from "lucide-react";
import { matchIntent, type ChatResponse } from "./chatIntents";
import { useNocDemoLang, useNocDemoT } from "./DemoLangContext";
import { aiChat } from "./noc-i18n";
import { BRAND, BRAND_DARK } from "./tokens";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

export default function AiChat({ onClose }: { onClose: () => void }) {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";
  const QUICK = [
    t("prompt1", aiChat), t("prompt2", aiChat), t("prompt3", aiChat), t("prompt4", aiChat),
    t("prompt5", aiChat), t("prompt6", aiChat), t("prompt7", aiChat), t("prompt8", aiChat),
  ];

  const [messages, setMessages] = useState<Message[]>(() => [
    { id: "welcome", role: "assistant", text: t("welcome", aiChat), response: { agent: "conductor", type: "text", text: "" }, timestamp: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", text: msg, timestamp: new Date() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const response = matchIntent(msg, lang);
      setMessages((p) => [...p, { id: `a-${Date.now()}`, role: "assistant", text: response.text, response, timestamp: new Date() }]);
      setTyping(false);
    }, 450);
  };

  const AGENT_META: Record<ChatResponse["agent"], { key: string; icon: React.ReactNode; color: string }> = {
    "conductor":          { key: "roleConductor",        icon: <Bot size={14} />,             color: BRAND },
    "correlator":         { key: "roleCorrelator",       icon: <AlertTriangle size={14} />,   color: "#D9534F" },
    "topology-mapper":    { key: "roleTopologyMapper",   icon: <MapIcon size={14} />,         color: "#F5A623" },
    "impact-translator":  { key: "roleImpactTranslator", icon: <Languages size={14} />,       color: "#5C8CA8" },
    "runbook-player":     { key: "roleRunbookPlayer",    icon: <Truck size={14} />,           color: "#5BA98A" },
    "comms-drafter":      { key: "roleCommsDrafter",     icon: <MessageSquare size={14} />,   color: "#196B24" },
  };
  function agentBadge(agent: ChatResponse["agent"]) {
    const m = AGENT_META[agent] ?? AGENT_META.conductor;
    return { label: t(m.key, aiChat), icon: m.icon, color: m.color };
  }

  return (
    <motion.div
      initial={{ x: isAr ? -420 : 420 }}
      animate={{ x: 0 }}
      exit={{ x: isAr ? -420 : 420 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      dir={isAr ? "rtl" : "ltr"}
      className={`fixed top-0 bottom-0 w-[400px] bg-white shadow-2xl border-gray-200 z-50 flex flex-col ${isAr ? "left-0 border-r" : "right-0 border-l"}`}
    >
      <div className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3" style={{ background: BRAND }}>
        <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
          <Sparkles size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{t("headerTitle", aiChat)}</p>
          <p className="text-[10px] text-blue-100">{t("headerSubtitle", aiChat)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg) => {
          const badge = msg.response ? agentBadge(msg.response.agent) : null;
          return (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && badge && (
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: badge.color }}>
                  {badge.icon}
                </div>
              )}
              <div className={`max-w-[300px] ${msg.role === "user" ? "order-first" : ""}`}>
                {msg.role === "assistant" && badge && (
                  <p className="text-[10px] text-gray-500 mb-1 font-semibold">{badge.label}</p>
                )}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === "user" ? "text-white rounded-br-md" : "bg-white text-gray-800 rounded-bl-md border border-gray-200"}`}
                  style={msg.role === "user" ? { background: BRAND } : undefined}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>
                </div>

                {msg.response?.type === "metric" && msg.response.data && (
                  <div className="mt-2 rounded-xl p-3 text-white" style={{ background: `linear-gradient(90deg, ${BRAND}, ${BRAND_DARK})` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-extrabold">{String(msg.response.data.value)}</span>
                      {msg.response.data.trend === "up" ? (
                        <span className="text-emerald-200 text-xs font-bold">▲ {String(msg.response.data.delta)}</span>
                      ) : msg.response.data.trend === "down" ? (
                        <span className="text-red-200 text-xs font-bold">▼ {String(msg.response.data.delta)}</span>
                      ) : null}
                    </div>
                    {msg.response.data.target != null && (
                      <p className="text-[10px] text-blue-100 mt-1">
                        {t("targetLabel", aiChat)} {String(msg.response.data.target)}
                      </p>
                    )}
                  </div>
                )}

                {msg.response?.type === "list" && msg.response.data && Array.isArray((msg.response.data as { items?: string[] }).items) && (
                  <ul className="mt-2 bg-white border border-gray-200 rounded-xl p-3 space-y-1.5">
                    {((msg.response.data as { items: string[] }).items).map((it, i) => (
                      <li key={i} className="text-[11px] text-gray-700 flex gap-2">
                        <span className="text-gray-400 flex-shrink-0">•</span>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {msg.response?.type === "chart" && msg.response.data && (
                  <Sparkline
                    data={(msg.response.data as { series: number[] }).series}
                    labelY={String((msg.response.data as { labelY?: string }).labelY ?? "")}
                    deltaPct={Number((msg.response.data as { deltaPct?: number }).deltaPct ?? 0)}
                  />
                )}

                {msg.response?.type === "draft" && msg.response.data && (
                  <CommsDraft
                    isAr={isAr}
                    channel={String((msg.response.data as { channel?: string }).channel ?? "")}
                    audience={String((msg.response.data as { audience?: string }).audience ?? "")}
                    body={isAr
                      ? String((msg.response.data as { bodyAr?: string }).bodyAr ?? "")
                      : String((msg.response.data as { bodyEn?: string }).bodyEn ?? "")}
                    approvalId={String((msg.response.data as { approvalId?: string }).approvalId ?? "")}
                  />
                )}

                {msg.response?.type === "document" && msg.response.data && (
                  <PostMortemDoc
                    title={String((msg.response.data as { title?: string }).title ?? "")}
                    sections={(msg.response.data as { sections?: string[] }).sections ?? []}
                  />
                )}

                {msg.response?.type === "table" && msg.response.data && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-gray-50">
                          {(msg.response.data.headersArr as string[]).map((h, i) => (
                            <th key={i} className="px-2 py-1.5 text-start font-semibold text-gray-600">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(msg.response.data.rows as string[][]).slice(0, 6).map((row, ri) => (
                          <tr key={ri} className="border-t border-gray-50">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1 text-gray-700">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-1">
                  {msg.timestamp.toLocaleTimeString(isAr ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-gray-200 flex-shrink-0 flex items-center justify-center">
                  <User size={14} className="text-gray-600" />
                </div>
              )}
            </div>
          );
        })}

        {typing && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: BRAND }}>
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-gray-100 p-3 bg-white">
        <div className="flex gap-1.5 flex-wrap mb-2">
          {QUICK.map((p) => (
            <button
              key={p}
              onClick={() => handleSend(p)}
              className="text-[10px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={t("placeholder", aiChat)}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#156082]/20 focus:border-[#156082]"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center transition-colors disabled:opacity-40"
            style={{ background: BRAND }}
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Sparkline({ data, labelY, deltaPct }: { data: number[]; labelY: string; deltaPct: number }) {
  const w = 240;
  const h = 60;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const step = (w - pad * 2) / Math.max(1, data.length - 1);
  const points = data
    .map((v, i) => `${pad + i * step},${pad + (h - pad * 2) * (1 - (v - min) / range)}`)
    .join(" ");
  const trendDown = deltaPct < 0;
  return (
    <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] text-gray-500 font-semibold">{labelY}</p>
        <span className={`text-[10px] font-bold flex items-center gap-1 ${trendDown ? "text-emerald-700" : "text-red-700"}`}>
          <TrendingDown size={11} className={trendDown ? "" : "rotate-180"} />
          {deltaPct > 0 ? "+" : ""}{deltaPct}%
        </span>
      </div>
      <svg width={w} height={h} className="block">
        <polyline points={points} fill="none" stroke={BRAND} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={pad + (h - pad * 2) * (1 - (v - min) / range)} r={1.5} fill={BRAND} />
        ))}
      </svg>
      <p className="text-[10px] text-gray-400 mt-1 tabular-nums">
        {data[0]} → {data[data.length - 1]} min
      </p>
    </div>
  );
}

function CommsDraft({ isAr, channel, audience, body, approvalId }: { isAr: boolean; channel: string; audience: string; body: string; approvalId: string }) {
  return (
    <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
        <MessageSquare size={12} className="text-gray-500" />
        <p className="text-[10px] font-bold text-gray-700 uppercase tracking-widest">{isAr ? "مسوّدة تواصل العملاء" : "Customer comms draft"}</p>
        <span className="ms-auto text-[9px] text-gray-400">{approvalId}</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-[10px] text-gray-500"><span className="font-semibold text-gray-700">{isAr ? "القناة" : "Channel"}:</span> {channel}</p>
        <p className="text-[10px] text-gray-500"><span className="font-semibold text-gray-700">{isAr ? "الجمهور" : "Audience"}:</span> {audience}</p>
        <div className="rounded-lg bg-gray-50 border border-gray-100 p-2 mt-1">
          <p className="text-[11px] text-gray-800 leading-relaxed whitespace-pre-line">{body}</p>
        </div>
      </div>
    </div>
  );
}

function PostMortemDoc({ title, sections }: { title: string; sections: string[] }) {
  return (
    <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
        <FileText size={12} className="text-gray-500" />
        <p className="text-[10px] font-bold text-gray-700 uppercase tracking-widest truncate">{title}</p>
      </div>
      <ol className="px-3 py-2 space-y-1">
        {sections.map((s, i) => (
          <li key={i} className="text-[11px] text-gray-700 leading-snug">{s}</li>
        ))}
      </ol>
    </div>
  );
}
