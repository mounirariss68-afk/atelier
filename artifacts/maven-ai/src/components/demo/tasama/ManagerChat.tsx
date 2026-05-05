import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Sparkles, Shield, Wallet } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { matchManagerIntent, type ChatResponse } from "./managerChatIntents";
import { useTasamaDemoLang, useTasamaDemoT } from "./DemoLangContext";
import { aiChat } from "./tasama-i18n";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

const CHART_COLORS = ["#0F0698", "#3B30E0", "#3B82F6", "#60A5FA", "#F59E0B", "#DC2626"];

export default function ManagerChat({ onClose }: { onClose: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const QUICK_PROMPTS = [t("prompt1", aiChat), t("prompt2", aiChat), t("prompt3", aiChat), t("prompt4", aiChat)];

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: t("welcome", aiChat),
      response: { agent: "analyst", type: "text", text: "" },
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text: msg, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const response = matchManagerIntent(msg, lang);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: response.text, response, timestamp: new Date() },
      ]);
      setTyping(false);
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  function agentBadge(agent: ChatResponse["agent"]) {
    if (agent === "compliance") return { label: t("roleCompliance", aiChat), icon: <Shield size={14} />, bg: "bg-emerald-600" };
    if (agent === "payroll") return { label: t("rolePayroll", aiChat), icon: <Wallet size={14} />, bg: "bg-amber-600" };
    return { label: t("roleAnalyst", aiChat), icon: <Bot size={14} />, bg: "bg-[#0F0698]" };
  }

  return (
    <motion.div
      initial={{ x: isAr ? -420 : 420 }}
      animate={{ x: 0 }}
      exit={{ x: isAr ? -420 : 420 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      dir={isAr ? "rtl" : "ltr"}
      className={`fixed top-0 bottom-0 w-[400px] bg-white shadow-2xl border-gray-200 z-50 flex flex-col ${
        isAr ? "left-0 border-r" : "right-0 border-l"
      }`}
    >
      <div className="flex-shrink-0 h-14 bg-[#0F0698] text-white flex items-center px-4 gap-3">
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
                <div className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white ${badge.bg}`}>
                  {badge.icon}
                </div>
              )}
              <div className={`max-w-[300px] ${msg.role === "user" ? "order-first" : ""}`}>
                {msg.role === "assistant" && badge && (
                  <p className="text-[10px] text-gray-500 mb-1 font-semibold">{badge.label}</p>
                )}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#0F0698] text-white rounded-br-md"
                      : "bg-white text-gray-800 rounded-bl-md border border-gray-200"
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>
                </div>

                {msg.response?.type === "metric" && msg.response.data && (
                  <div className="mt-2 bg-gradient-to-r from-[#0F0698] to-[#3B30E0] rounded-xl p-3 text-white">
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

                {msg.response?.type === "chart" && msg.response.data && (() => {
                  const cData = msg.response.data.chartData as { name: string; value: number }[];
                  const cType = msg.response.data.chartType as string;
                  return (
                    <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2">{String(msg.response.data.label || "")}</p>
                      <div className="h-[160px]">
                        <ResponsiveContainer width="100%" height="100%">
                          {cType === "line" ? (
                            <LineChart data={cData} margin={{ left: 0, right: 5 }}>
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                              <YAxis tick={{ fontSize: 9 }} width={35} />
                              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                              <Line type="monotone" dataKey="value" stroke="#0F0698" strokeWidth={2} dot={{ r: 3, fill: "#0F0698" }} />
                            </LineChart>
                          ) : (
                            <BarChart data={cData} margin={{ left: 0, right: 5 }}>
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={50} />
                              <YAxis tick={{ fontSize: 9 }} width={35} />
                              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                              <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20}>
                                {cData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          )}
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
                <div className="w-7 h-7 rounded-lg bg-gray-200 flex-shrink-0 flex items-center justify-center">
                  <User size={14} className="text-gray-600" />
                </div>
              )}
            </div>
          );
        })}

        {typing && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0F0698] flex-shrink-0 flex items-center justify-center">
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
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSend(prompt)}
              className="text-[10px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder", aiChat)}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0F0698]/20 focus:border-[#0F0698]"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl bg-[#0F0698] text-white flex items-center justify-center hover:bg-[#3B30E0] transition-colors disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
