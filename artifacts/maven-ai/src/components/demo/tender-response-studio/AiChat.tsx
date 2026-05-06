import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Sparkles } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { matchIntent, type ChatResponse } from "./chatIntents";
import { useTenderDemoLang, useTenderDemoT } from "./DemoLangContext";
import { aiChat } from "./tender-i18n";
import { BRAND, BRAND_DARK, NAVY, CHART_COLORS } from "./tokens";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

const AGENT_KEY: Record<string, string> = {
  orch: "roleConductor", qualifier: "roleQualifier", pricing: "rolePricing",
  partner: "rolePartner", legal: "roleLegal", compiler: "roleCompiler",
  drafter: "roleDrafter", ingest: "roleIngest",
};

export default function AiChat({ onClose }: { onClose: () => void }) {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const isAr = lang === "ar";
  const QUICK = [t("prompt1", aiChat), t("prompt2", aiChat), t("prompt3", aiChat), t("prompt4", aiChat)];
  const [messages, setMessages] = useState<Message[]>([
    { id: "w", role: "assistant", text: t("welcome", aiChat), response: { agent: "orch", type: "text", text: "" }, timestamp: new Date() },
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
    const msg = text || input.trim();
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

  return (
    <motion.div
      initial={{ x: isAr ? -440 : 440 }}
      animate={{ x: 0 }}
      exit={{ x: isAr ? -440 : 440 }}
      transition={{ type: "spring", damping: 26, stiffness: 320 }}
      className={`fixed top-0 bottom-0 ${isAr ? "left-0 border-r" : "right-0 border-l"} w-[420px] bg-white shadow-2xl border-gray-200 z-50 flex flex-col`}
    >
      <div className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3" style={{ background: NAVY }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND }}><Bot size={18} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{t("headerTitle", aiChat)}</p>
          <p className="text-[10px] text-gray-300">{t("headerSubtitle", aiChat)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="close"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FAFBFC]">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: BRAND }}>
                <Sparkles size={14} />
              </div>
            )}
            <div className={`max-w-[300px] ${msg.role === "user" ? "order-first" : ""}`}>
              {msg.role === "assistant" && msg.response?.agent && (
                <p className="text-[10px] text-gray-400 mb-1 font-semibold">{t(AGENT_KEY[msg.response.agent] || "roleConductor", aiChat)}</p>
              )}
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user" ? "text-white" : "bg-white border border-gray-100 text-gray-800"
                } ${msg.role === "user" ? (isAr ? "rounded-bl-md" : "rounded-br-md") : (isAr ? "rounded-br-md" : "rounded-bl-md")}`}
                style={msg.role === "user" ? { background: BRAND } : undefined}
              >
                <p className="whitespace-pre-line">{msg.text}</p>
              </div>

              {msg.response?.type === "metric" && msg.response.data && (
                <div className="mt-2 rounded-xl p-3 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-extrabold">{String(msg.response.data.value)}</span>
                    {msg.response.data.trend === "up"
                      ? <span className="text-emerald-300 text-xs font-bold">▲ {String(msg.response.data.delta)}</span>
                      : <span className="text-red-300 text-xs font-bold">▼ {String(msg.response.data.delta)}</span>}
                  </div>
                  {msg.response.data.target != null && (
                    <p className="text-[10px] text-gray-300 mt-1">{t("targetLabel", aiChat)} {String(msg.response.data.target)}</p>
                  )}
                </div>
              )}

              {msg.response?.type === "table" && msg.response.data && (
                <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        {(msg.response.data.headers as string[]).map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-start font-semibold text-gray-600">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(msg.response.data.rows as string[][]).slice(0, 8).map((row, ri) => (
                        <tr key={ri} className="border-t border-gray-50">
                          {row.map((c, ci) => <td key={ci} className="px-2 py-1 text-gray-700">{c}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {msg.response?.type === "chart" && msg.response.data && (() => {
                const cData = msg.response.data.chartData as { name: string; value: number }[];
                return (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                    <div className="h-[160px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={cData} margin={{ left: 0, right: 5 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={40} />
                          <YAxis tick={{ fontSize: 9 }} width={35} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20}>
                            {cData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}

              <p className="text-[10px] text-gray-400 mt-1">
                {msg.timestamp.toLocaleTimeString(isAr ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-lg bg-gray-200 flex-shrink-0 flex items-center justify-center"><User size={14} className="text-gray-600" /></div>
            )}
          </div>
        ))}

        {typing && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: BRAND }}><Bot size={14} /></div>
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "120ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "240ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-gray-100 p-3 bg-white">
        <div className="flex gap-1.5 flex-wrap mb-2">
          {QUICK.map((p) => (
            <button key={p} onClick={() => handleSend(p)} className="text-[10px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300">
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
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center disabled:opacity-40"
            style={{ background: BRAND }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
