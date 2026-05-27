import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Sparkles } from "lucide-react";
import { matchSdsIntent, type ChatResponse } from "./chatIntents";
import { useSdsLang, useSdsT } from "./DemoLangContext";
import { aiChat } from "./sovereign-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import { CONSOLE_AGENTS } from "@/data/sovereign-data-agent";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

export default function AiChat({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate?: (view: string, opts?: { productId?: string }) => void;
}) {
  const { lang } = useSdsLang();
  const t = useSdsT();
  const isAr = lang === "ar";
  const QUICK_PROMPTS = [
    t("prompt1", aiChat), t("prompt2", aiChat), t("prompt3", aiChat), t("prompt4", aiChat),
    t("prompt5", aiChat), t("prompt6", aiChat), t("prompt7", aiChat), t("prompt8", aiChat),
  ];

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "welcome", role: "assistant",
      text: t("welcome", aiChat),
      response: { agent: "orch", type: "text", text: "" },
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

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: msg, timestamp: new Date() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const response = matchSdsIntent(msg, lang);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: response.text, response, timestamp: new Date() }]);
      setTyping(false);
      if (response.type === "navigate" && response.data && onNavigate) {
        const v = String(response.data.view ?? "");
        const focus = response.data.focus ? String(response.data.focus) : undefined;
        setTimeout(() => onNavigate(v, focus ? { productId: focus } : undefined), 400);
      }
    }, 450);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  function agentLabel(agentId: ChatResponse["agent"]): string {
    const a = CONSOLE_AGENTS.find((x) => x.id === agentId);
    return a ? a.name[lang] : agentId;
  }
  function agentColor(agentId: ChatResponse["agent"]): string {
    const a = CONSOLE_AGENTS.find((x) => x.id === agentId);
    return a?.color ?? BRAND;
  }

  return (
    <motion.div
      initial={{ x: isAr ? -420 : 420 }}
      animate={{ x: 0 }}
      exit={{ x: isAr ? -420 : 420 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      dir={isAr ? "rtl" : "ltr"}
      className={`fixed top-0 bottom-0 w-[420px] bg-white shadow-2xl border-gray-200 z-50 flex flex-col ${isAr ? "left-0 border-r" : "right-0 border-l"}`}
    >
      <div className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3" style={{ background: BRAND_INK }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#5B7CFF" }}>
          <Sparkles size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{t("title", aiChat)}</p>
          <p className="text-[10px] text-white/70">{t("subtitle", aiChat)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="Close"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg) => {
          const a = msg.response?.agent;
          return (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && a && (
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: agentColor(a) }}>
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[320px] ${msg.role === "user" ? "order-first" : ""}`}>
                {msg.role === "assistant" && a && (
                  <p className="text-[10px] text-gray-500 mb-1 font-semibold">{agentLabel(a)}</p>
                )}
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user" ? "text-white rounded-br-md" : "bg-white text-gray-800 rounded-bl-md border border-gray-200"
                }`} style={msg.role === "user" ? { background: BRAND_INK } : undefined}>
                  <p className="whitespace-pre-line">{msg.text}</p>
                </div>

                {msg.response?.type === "list" && Array.isArray(msg.response.data?.items) && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3 space-y-1.5">
                    {(msg.response.data!.items as string[]).map((item, i) => (
                      <div key={i} className="text-[12px] text-gray-700 flex gap-2">
                        <span className="text-gray-400 font-bold">{i + 1}.</span>
                        <span className="flex-1">{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.response?.type === "table" && Array.isArray(msg.response.data?.rows) && (() => {
                  const headers = msg.response.data.headers as string[];
                  const rows = msg.response.data.rows as string[][];
                  return (
                    <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-gray-50">
                            {headers.map((h, i) => (
                              <th key={i} className="px-2 py-1.5 text-start font-semibold text-gray-600">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, ri) => (
                            <tr key={ri} className="border-t border-gray-50">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-2 py-1 text-gray-700 align-top">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {msg.response?.type === "memo" && msg.response.data && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                    <p className="text-[12px] font-bold text-gray-900 mb-2">{String(msg.response.data.title)}</p>
                    <div className="space-y-1.5">
                      {(msg.response.data.paragraphs as string[]).map((p, i) => (
                        <p key={i} className="text-[11px] text-gray-700 leading-relaxed">{p}</p>
                      ))}
                    </div>
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
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSend(prompt)}
              className="text-[10px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
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
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center disabled:opacity-40"
            style={{ background: BRAND_INK }}
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
