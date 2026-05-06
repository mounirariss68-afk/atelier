import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, Sparkles } from "lucide-react";
import { matchSamaIntent, type ChatResponse } from "./chatIntents";
import { useSamaDemoLang } from "./DemoLangContext";
import { aiChat, useTrFactory } from "./sama-i18n";
import { BRAND, BRAND_INK } from "./tokens";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
}

interface AiChatProps {
  onClose: () => void;
  onNavigate?: (view: string, id?: string) => void;
}

export default function AiChat({ onClose, onNavigate }: AiChatProps) {
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";

  const QUICK = [
    t("prompt1", aiChat),
    t("prompt2", aiChat),
    t("prompt3", aiChat),
    t("prompt4", aiChat),
  ];

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
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

  const send = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", text: msg, timestamp: new Date() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const r = matchSamaIntent(msg, lang);
      setMessages((p) => [...p, { id: `a-${Date.now()}`, role: "assistant", text: r.text, response: r, timestamp: new Date() }]);
      setTyping(false);
    }, 450);
  };

  return (
    <motion.div
      initial={{ x: isAr ? -420 : 420 }}
      animate={{ x: 0 }}
      exit={{ x: isAr ? -420 : 420 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className={`fixed top-0 bottom-0 ${isAr ? "left-0 border-r" : "right-0 border-l"} w-[400px] bg-white shadow-2xl border-gray-200 z-50 flex flex-col`}
      data-testid="sama-ai-chat"
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3" style={{ background: BRAND_INK }}>
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <Bot size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{t("headerTitle", aiChat)}</p>
          <p className="text-[10px] text-gray-300">{t("headerSubtitle", aiChat)}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="close"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: BRAND }}>
                <Sparkles size={14} />
              </div>
            )}
            <div className={`max-w-[300px] ${m.role === "user" ? "order-first" : ""}`}>
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                  m.role === "user"
                    ? "rounded-br-md text-white"
                    : "bg-white text-gray-800 border border-gray-200 rounded-bl-md"
                }`}
                style={m.role === "user" ? { background: BRAND_INK } : undefined}
              >
                {m.text}
              </div>
              {m.response && <ResponsePayload r={m.response} lang={lang} onNavigate={onNavigate} />}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white" style={{ background: BRAND }}>
              <Sparkles size={14} />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-2.5">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "120ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "240ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-200 bg-white">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="text-[10px] px-2 py-1 rounded-full border border-gray-200 hover:border-amber-400 hover:bg-amber-50 text-gray-700"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
            placeholder={t("placeholder", aiChat)}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <button
            onClick={() => send()}
            className="w-9 h-9 rounded-lg text-white flex items-center justify-center"
            style={{ background: BRAND }}
            aria-label="send"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ResponsePayload({ r, lang, onNavigate }: { r: ChatResponse; lang: "en" | "ar"; onNavigate?: (v: string, id?: string) => void }) {
  const isAr = lang === "ar";
  if (!r.data && !r.navigate) return null;
  return (
    <div className="mt-2 space-y-2">
      {r.type === "list" && Array.isArray((r.data as { items?: string[] }).items) && (
        <ul className="bg-white border border-gray-200 rounded-xl p-3 text-xs text-gray-700 space-y-1">
          {(r.data as { items: string[] }).items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-amber-500">•</span><span>{it}</span></li>)}
        </ul>
      )}
      {r.type === "table" && r.data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden text-[11px]">
          <table className="w-full">
            <thead className="bg-gray-50 text-gray-600 font-semibold">
              <tr>{(r.data.headers as string[]).map((h) => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(r.data.rows as string[][]).map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  {row.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.type === "metric" && r.data && (
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <p className="text-lg font-bold" style={{ color: BRAND_INK }}>{String(r.data.value)}</p>
          {r.data.sub ? <p className="text-[11px] text-gray-500">{String(r.data.sub)}</p> : null}
          {r.data.extra ? <p className="text-[11px] text-gray-600 mt-1">{String(r.data.extra)}</p> : null}
        </div>
      )}
      {r.type === "metric-grid" && Array.isArray((r.data as { tiles?: unknown[] }).tiles) && (
        <div className="grid grid-cols-2 gap-2">
          {((r.data as { tiles: { label: string; value: string }[] }).tiles).map((t, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-2.5">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">{t.label}</p>
              <p className="text-base font-bold" style={{ color: BRAND_INK }}>{t.value}</p>
            </div>
          ))}
        </div>
      )}
      {r.type === "doc" && r.data && (
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <p className="text-xs font-bold mb-2" style={{ color: BRAND_INK }}>{String(r.data.title)}</p>
          <div className="space-y-1.5">
            {(r.data.body as string[]).map((p, i) => <p key={i} className="text-[11px] text-gray-700 leading-relaxed">{p}</p>)}
          </div>
        </div>
      )}
      {r.navigate && onNavigate && (
        <button
          onClick={() => onNavigate(r.navigate!.view, r.navigate!.id)}
          className="text-[11px] font-bold text-amber-600 hover:text-amber-700"
        >
          {isAr ? "افتح هذا العرض ←" : "Open this view →"}
        </button>
      )}
    </div>
  );
}
