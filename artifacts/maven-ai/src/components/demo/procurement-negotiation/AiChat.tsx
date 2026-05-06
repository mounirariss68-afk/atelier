import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Sparkles } from "lucide-react";
import { matchIntent, type ChatResponse } from "./chatIntents";
import { useProcurementDemoLang } from "./DemoLangContext";
import { aiChat } from "./procurement-i18n";
import { getAgent } from "@/data/procurement-negotiation-agent";
import { BRAND, NAVY } from "./tokens";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  ts: Date;
}

export default function AiChat({ onClose }: { onClose: () => void }) {
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const t = (k: keyof typeof aiChat) => aiChat[k][lang];
  const QUICK = [
    aiChat.prompt1[lang], aiChat.prompt2[lang], aiChat.prompt3[lang], aiChat.prompt4[lang],
    aiChat.prompt5[lang], aiChat.prompt6[lang], aiChat.prompt7[lang], aiChat.prompt8[lang],
  ];

  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    role: "assistant",
    text: t("welcome"),
    response: { agent: "orch", type: "text", text: t("welcome") },
    ts: new Date(),
  }]);
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
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", text: msg, ts: new Date() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const response = matchIntent(msg, lang);
      setMessages((p) => [...p, {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: response.text,
        response,
        ts: new Date(),
      }]);
      // Side-effect: surface intents that should drive workspace state
      // (e.g. "Switch to TCO view" flips the bid matrix; "Draft counter"
      // jumps to the composer) via window events the shell+workspace
      // already listen for.
      if (response.effect?.kind === "set-cost-view") {
        window.dispatchEvent(new CustomEvent("procurement:set-cost-view", { detail: { view: response.effect.view } }));
        if (response.effect.navigateTo) {
          window.dispatchEvent(new CustomEvent("procurement:navigate", { detail: { view: response.effect.navigateTo } }));
        }
      } else if (response.effect?.kind === "navigate") {
        window.dispatchEvent(new CustomEvent("procurement:navigate", { detail: { view: response.effect.navigateTo } }));
      }
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
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3" style={{ background: NAVY }}>
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><Bot size={18} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{t("headerTitle")}</p>
          <p className="text-[10px] text-white/60">{t("headerSubtitle")}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label={t("headerTitle")}><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => {
          const agent = m.response ? getAgent(m.response.agent) : null;
          return (
            <div key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: agent?.color ?? BRAND }}>
                  <Sparkles size={14} />
                </div>
              )}
              <div className={`max-w-[300px] ${m.role === "user" ? "order-first" : ""}`}>
                {m.role === "assistant" && agent && (
                  <p className="text-[10px] text-gray-400 mb-1 font-semibold">{isAr ? agent.nameAr : agent.nameEn}</p>
                )}
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? `text-white ${isAr ? "rounded-bl-md" : "rounded-br-md"}` : `bg-gray-100 text-gray-800 ${isAr ? "rounded-br-md" : "rounded-bl-md"}`}`} style={m.role === "user" ? { background: BRAND } : undefined}>
                  <p className="whitespace-pre-line">{m.text}</p>
                </div>

                {m.response?.type === "metric" && m.response.data && (
                  <div className="mt-2 rounded-xl p-3 text-white" style={{ background: NAVY }}>
                    <div className="text-lg font-extrabold">{String(m.response.data.value ?? "")}</div>
                    {m.response.data.label != null && <p className="text-[10px] text-white/60 mt-1">{String(m.response.data.label)}</p>}
                  </div>
                )}

                {m.response?.type === "metric-grid" && m.response.data && (
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {(m.response.data.rows as [string, string][]).map(([k, v], i) => (
                      <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 p-2">
                        <div className="text-[10px] text-gray-400">{k}</div>
                        <div className="text-sm font-bold text-[#0E2841]">{v}</div>
                      </div>
                    ))}
                  </div>
                )}

                {m.response?.type === "table" && m.response.data && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead><tr className="bg-gray-50">
                        {(m.response.data.headers as string[]).map((h, i) => (
                          <th key={i} className={`px-2 py-1.5 ${isAr ? "text-right" : "text-left"} font-semibold text-gray-600`}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {(m.response.data.rows as string[][]).slice(0, 8).map((row, ri) => (
                          <tr key={ri} className="border-t border-gray-50">
                            {row.map((cell, ci) => <td key={ci} className="px-2 py-1 text-gray-700">{cell}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {m.response?.type === "chart" && m.response.data && Array.isArray(m.response.data.bars) && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                    {Boolean(m.response.data.headline) && (
                      <div className="mb-2">
                        <div className="text-base font-extrabold text-[#0E2841]">{String(m.response.data.headline)}</div>
                        {Boolean(m.response.data.headlineLabel) && (
                          <div className="text-[10px] text-gray-400">{String(m.response.data.headlineLabel)}</div>
                        )}
                      </div>
                    )}
                    {(() => {
                      const bars = m.response.data.bars as Array<{ label: string; value: number }>;
                      const max = bars.reduce((mx, b) => Math.max(mx, b.value), 0) || 1;
                      return (
                        <div className="space-y-1.5">
                          {bars.map((b, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-12 text-[10px] font-mono text-gray-500 flex-shrink-0">{b.label}</div>
                              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${(b.value / max) * 100}%`, background: BRAND }} />
                              </div>
                              <div className="text-[10px] font-semibold text-[#0E2841] w-12 text-right">{b.value}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {Boolean(m.response.data.unit) && (
                      <div className="mt-2 text-[9px] text-gray-400 text-right">{String(m.response.data.unit)}</div>
                    )}
                  </div>
                )}

                {m.response?.type === "list" && m.response.data && (
                  <ul className="mt-2 bg-white border border-gray-200 rounded-xl p-3 text-[12px] space-y-1.5 list-disc list-inside text-gray-700">
                    {(m.response.data.items as string[]).map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                )}

                {(m.response?.type === "recommendation" || m.response?.type === "memo") && m.response.data && (
                  <div className="mt-2 bg-white border-2 rounded-xl p-3" style={{ borderColor: BRAND }}>
                    {Boolean(m.response.data.subject) && <p className="text-[11px] font-bold text-[#0E2841] mb-1.5">{String(m.response.data.subject)}</p>}
                    {Boolean(m.response.data.rationale) && <p className="text-[11px] text-gray-600 mb-2">{String(m.response.data.rationale)}</p>}
                    {Array.isArray(m.response.data.bullets) && (
                      <ul className="text-[11px] text-gray-700 list-disc list-inside space-y-1">
                        {(m.response.data.bullets as string[]).map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    )}
                    {m.response.data.confidence != null && (
                      <div className="mt-2 text-[10px] font-semibold" style={{ color: BRAND }}>{isAr ? "ثقة" : "Confidence"}: {String(m.response.data.confidence)}%</div>
                    )}
                    {Boolean(m.response.data.action) && (
                      <div className="mt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: BRAND }}>{isAr ? "الإجراء الموصى" : "Recommended action"}: <span className="font-medium normal-case text-[#0E2841]">{String(m.response.data.action)}</span></div>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-1">{m.ts.toLocaleTimeString(isAr ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              {m.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-gray-200 flex-shrink-0 flex items-center justify-center"><User size={14} className="text-gray-600" /></div>
              )}
            </div>
          );
        })}
        {typing && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: BRAND }}><Bot size={14} /></div>
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
          {QUICK.map((p) => (
            <button key={p} onClick={() => handleSend(p)} className="text-[10px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors">{p}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={t("placeholder")} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={{ ['--tw-ring-color' as never]: `${BRAND}33` }} />
          <button onClick={() => handleSend()} disabled={!input.trim()} className="w-10 h-10 rounded-xl text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40" style={{ background: BRAND }}><Send size={16} /></button>
        </div>
      </div>
    </motion.div>
  );
}
