import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { matchIntent, QUICK_PROMPT_KEYS, type ChatResponse, type NavTarget } from "./chatIntents";
import { useDemoLang } from "./DemoLangContext";
import { aiChat, t as tr } from "./value-realization-i18n";
import { CONDUCTOR_AGENTS } from "@/data/value-realization-agent";
import { BRAND, NAVY, CHART_PALETTE } from "./tokens";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

interface AiChatProps {
  onClose: () => void;
  /** Optional hook so chat responses can deep-link the user into the
   * matching cockpit view (audit log, approvals, what-if, etc.). */
  onNavigate?: (view: NavTarget, initiativeId?: string) => void;
}

export default function AiChat({ onClose, onNavigate }: AiChatProps) {
  const { lang } = useDemoLang();
  const dir = lang === "ar" ? "rtl" : "ltr";
  const QUICK = QUICK_PROMPT_KEYS.map((k) => tr(aiChat, k, lang));
  const WELCOME: Message = {
    id: "welcome",
    role: "assistant",
    text: tr(aiChat, "welcome", lang),
    response: { agentId: "realization-conductor", type: "text", text: "" },
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
    const msg = (text ?? input).trim();
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
    }, 480);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sideClass = lang === "ar"
    ? "fixed left-0 top-0 bottom-0 w-[400px]"
    : "fixed right-0 top-0 bottom-0 w-[400px]";
  const initialOffset = lang === "ar" ? { x: -420 } : { x: 420 };
  const exitOffset = lang === "ar" ? { x: -420 } : { x: 420 };

  return (
    <motion.div
      initial={initialOffset}
      animate={{ x: 0 }}
      exit={exitOffset}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      dir={dir}
      className={`${sideClass} bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col`}
      data-testid="value-realization-ai-chat"
    >
      <div className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3" style={{ background: NAVY }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND }}>
          <Bot size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{tr(aiChat, "headerTitle", lang)}</p>
          <p className="text-[10px] text-gray-300">{tr(aiChat, "headerSubtitle", lang)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="close" data-testid="button-close-chat"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg) => {
          const agentMeta = msg.response ? CONDUCTOR_AGENTS.find((a) => a.id === msg.response!.agentId) : null;
          return (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: agentMeta?.color ?? BRAND }}>
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[300px] ${msg.role === "user" ? (lang === "ar" ? "" : "order-first") : ""}`}>
                {msg.role === "assistant" && agentMeta && (
                  <p className="text-[10px] text-gray-500 mb-1 font-semibold">{lang === "ar" ? agentMeta.name.ar : agentMeta.name.en}</p>
                )}
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "text-white"
                    : "bg-white border border-gray-200 text-gray-800"
                }`} style={msg.role === "user" ? { background: BRAND } : {}}>
                  <p className="whitespace-pre-line">{msg.text}</p>
                </div>

                {msg.response?.type === "metric" && msg.response.data && (
                  <div className="mt-2 rounded-xl p-3 text-white" style={{ background: NAVY }}>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-extrabold">{String(msg.response.data.value)}</span>
                      <span className="text-red-300 text-xs font-bold">▼ {String(msg.response.data.delta)}</span>
                    </div>
                    <p className="text-[10px] text-gray-300 mt-1">vs {String(msg.response.data.target)}</p>
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

                {msg.response?.type === "rec-card" && (
                  <div className="mt-2 rounded-xl p-3 border" style={{ borderColor: BRAND, background: "#E8F2EA" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>Recommendation</p>
                  </div>
                )}

                {msg.response?.navigate && onNavigate && (
                  <button
                    onClick={() => {
                      onNavigate(msg.response!.navigate!.view, msg.response!.navigate!.initiativeId);
                      onClose();
                    }}
                    className="mt-2 inline-flex items-center text-[11px] font-bold px-3 py-1.5 rounded-lg text-white"
                    style={{ background: BRAND }}
                    data-testid={`button-chat-nav-${msg.id}`}
                  >
                    {lang === "ar" ? msg.response.navigate.cta.ar : msg.response.navigate.cta.en}
                  </button>
                )}

                {msg.response?.type === "chart" && msg.response.data && (() => {
                  const cData = msg.response.data.chartData as { name: string; value: number }[];
                  return (
                    <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2">{String(msg.response.data.label || "")}</p>
                      <div className="h-[160px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={cData} margin={{ left: 0, right: 5 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
                            <YAxis tick={{ fontSize: 9 }} width={32} />
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                              {cData.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}

                <p className="text-[10px] text-gray-400 mt-1">
                  {msg.timestamp.toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-AE", { hour: "2-digit", minute: "2-digit" })}
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
            <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: BRAND }}>
              <Bot size={14} />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-gray-100 p-3 bg-white">
        <div className="flex gap-1.5 flex-wrap mb-2">
          {QUICK.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSend(prompt)}
              className="text-[10px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              data-testid="button-quick-prompt"
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
            placeholder={tr(aiChat, "placeholder", lang)}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ outline: "none" }}
            data-testid="input-chat"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center disabled:opacity-40"
            style={{ background: BRAND }}
            data-testid="button-send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
