import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, FileText, Users, Upload, Calendar, Shield } from "lucide-react";
import { matchClientIntent, type ChatResponse } from "./clientChatIntents";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientChat, tDict } from "../tasama-i18n";

interface Message {
  id: number;
  role: "user" | "agent";
  text: string;
  type?: ChatResponse["type"];
  data?: Record<string, unknown>;
}

export default function ClientChat({ onClose }: { onClose: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientChat, lang);
  const isRtl = lang === "ar";
  const QUICK_PROMPTS = [
    { label: t.prompt1, icon: FileText },
    { label: t.prompt2, icon: Users },
    { label: t.prompt3, icon: Upload },
    { label: t.prompt4, icon: Calendar },
    { label: t.prompt5, icon: Shield },
  ];
  const WELCOME: Message = { id: 0, role: "agent", text: t.welcome };
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: idRef.current++, role: "user", text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    setTimeout(() => {
      const response = matchClientIntent(text.trim(), lang);
      const agentMsg: Message = {
        id: idRef.current++, role: "agent",
        text: response.text,
        type: response.type,
        data: response.data,
      };
      setMessages((prev) => [...prev, agentMsg]);
      setTyping(false);
    }, 400);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <motion.div
      initial={{ x: isRtl ? "-100%" : "100%" }}
      animate={{ x: 0 }}
      exit={{ x: isRtl ? "-100%" : "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 250 }}
      className={`fixed top-0 ${isRtl ? "left-0 border-r" : "right-0 border-l"} h-full w-[400px] max-w-full bg-white shadow-2xl z-50 flex flex-col border-gray-200`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex-shrink-0 h-14 bg-[#1E3A8A] text-white flex items-center px-4 gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <Bot size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{t.headerTitle}</p>
          <p className="text-[10px] text-white/70">{t.headerSubtitle}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors" aria-label="close">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${m.role === "user" ? "bg-gray-200 text-gray-600" : "bg-[#1E3A8A] text-white"}`}>
              {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line ${m.role === "user" ? "bg-[#1E3A8A] text-white rounded-tr-sm" : "bg-white border border-gray-100 text-gray-700 rounded-tl-sm shadow-sm"}`}>
              {m.text}
              {m.type === "table" && m.data && Array.isArray((m.data as { rows?: unknown[] }).rows) && (
                <div className="mt-2 -mx-1 overflow-x-auto">
                  <table className="text-[11px] w-full">
                    <thead>
                      <tr>
                        {((m.data as { headers: string[] }).headers ?? []).map((h: string, i: number) => (
                          <th key={i} className="text-left font-semibold text-gray-500 px-1.5 py-1 border-b border-gray-100">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {((m.data as { rows: string[][] }).rows ?? []).map((r: string[], i: number) => (
                        <tr key={i}>
                          {r.map((c: string, j: number) => (
                            <td key={j} className="px-1.5 py-1 text-gray-700 border-b border-gray-50">{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {typing && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-[#1E3A8A] text-white flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {messages.length <= 1 && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-gray-100 bg-white">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((p, i) => (
              <button
                key={i}
                onClick={() => send(p.label)}
                className="text-[11px] px-2.5 py-1.5 bg-blue-50 text-[#1E3A8A] rounded-full border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-1"
              >
                <p.icon size={11} />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-shrink-0 p-3 border-t border-gray-100 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t.placeholder}
            rows={1}
            className="flex-1 resize-none text-[13px] border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A] max-h-24"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="w-9 h-9 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center hover:bg-[#2563EB] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
