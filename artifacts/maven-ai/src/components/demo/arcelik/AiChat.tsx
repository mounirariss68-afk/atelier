import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Sparkles } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, LineChart, Line, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { matchIntent, type ChatResponse } from "./chatIntents";
import { useDemoLang } from "./DemoLangContext";
import { aiChat } from "./demo-i18n";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

export default function AiChat({ onClose }: { onClose: () => void }) {
  const { lang } = useDemoLang();
  const t = aiChat[lang];
  const QUICK_PROMPTS = [t.prompt1, t.prompt2, t.prompt3, t.prompt4];
  const WELCOME: Message = {
    id: "welcome",
    role: "assistant",
    text: t.welcome,
    response: { agent: "analyst", type: "text", text: "" },
    timestamp: new Date(),
  };
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
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
    const msg = text || input.trim();
    if (!msg) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: msg,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    setTimeout(() => {
      const response = matchIntent(msg, lang);
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: response.text,
        response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setTyping(false);
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ x: 420 }}
      animate={{ x: 0 }}
      exit={{ x: 420 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed right-0 top-0 bottom-0 w-[400px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col"
    >
      <div className="flex-shrink-0 h-14 bg-[#0E2841] text-white flex items-center px-4 gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <Bot size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{t.headerTitle}</p>
          <p className="text-[10px] text-gray-400">{t.headerSubtitle}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label={t.headerTitle}><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white ${
                msg.response?.agent === "campaign-mgr" ? "bg-[#F5A623]" : "bg-[#0E2841]"
              }`}>
                {msg.response?.agent === "campaign-mgr" ? <Sparkles size={14} /> : <Bot size={14} />}
              </div>
            )}
            <div className={`max-w-[300px] ${msg.role === "user" ? "order-first" : ""}`}>
              {msg.role === "assistant" && msg.response?.agent && (
                <p className="text-[10px] text-gray-400 mb-1 font-semibold">
                  {msg.response.agent === "campaign-mgr" ? t.roleCampaignMgr : t.roleAnalyst}
                </p>
              )}
              <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#E30613] text-white rounded-br-md"
                  : "bg-gray-100 text-gray-800 rounded-bl-md"
              }`}>
                <p className="whitespace-pre-line">{msg.text}</p>
              </div>

              {msg.response?.type === "metric" && msg.response.data && (
                <div className="mt-2 bg-gradient-to-r from-[#0E2841] to-[#1a3a5c] rounded-xl p-3 text-white">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-extrabold">{String(msg.response.data.value)}</span>
                    {msg.response.data.trend === "up" ? (
                      <span className="text-green-400 text-xs font-bold">▲ {String(msg.response.data.delta)}</span>
                    ) : msg.response.data.trend === "down" ? (
                      <span className="text-red-400 text-xs font-bold">▼ {String(msg.response.data.delta)}</span>
                    ) : null}
                  </div>
                  {msg.response.data.target != null && (
                    <p className="text-[10px] text-gray-400 mt-1">{t.targetLabel} {String(msg.response.data.target as string)}</p>
                  )}
                </div>
              )}

              {msg.response?.type === "table" && msg.response.data && (
                <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-gray-50">
                        {(msg.response.data.headers as string[]).map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-semibold text-gray-600">{h}</th>
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

              {msg.response?.type === "campaign-card" && (
                <div className="mt-2 bg-purple-50 border border-purple-100 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles size={12} className="text-purple-600" />
                    <span className="text-[10px] font-bold text-purple-700">{t.aiCampaignSuggestion}</span>
                  </div>
                </div>
              )}

              {msg.response?.type === "chart" && msg.response.data && (() => {
                const CHART_COLORS = ["#E30613", "#0E2841", "#F5A623", "#16a34a", "#7c3aed", "#0891b2", "#db2777", "#d97706"];
                const cData = msg.response.data.chartData as { name: string; value: number }[];
                const cType = msg.response.data.chartType as string;
                return (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-gray-500 mb-2">{String(msg.response.data.label || "")}</p>
                    <div className="h-[160px]">
                      <ResponsiveContainer width="100%" height="100%">
                        {cType === "pie" ? (
                          <PieChart>
                            <Pie data={cData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                              {cData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                          </PieChart>
                        ) : cType === "line" ? (
                          <LineChart data={cData} margin={{ left: 0, right: 5 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                            <YAxis tick={{ fontSize: 9 }} width={35} />
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                            <Line type="monotone" dataKey="value" stroke="#E30613" strokeWidth={2} dot={{ r: 3, fill: "#E30613" }} />
                          </LineChart>
                        ) : (
                          <BarChart data={cData} margin={{ left: 0, right: 5 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={40} />
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
                {msg.timestamp.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-lg bg-gray-200 flex-shrink-0 flex items-center justify-center">
                <User size={14} className="text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {typing && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0E2841] flex-shrink-0 flex items-center justify-center">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-gray-100 p-3">
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
            placeholder={t.placeholder}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 focus:border-[#E30613]"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl bg-[#E30613] text-white flex items-center justify-center hover:bg-[#c00510] transition-colors disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
