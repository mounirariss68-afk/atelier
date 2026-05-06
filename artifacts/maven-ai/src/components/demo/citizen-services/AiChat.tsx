import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { matchIntent, type ChatResponse } from "./chatIntents";
import { useCscLang } from "./DemoLangContext";
import { chatI, tDict } from "./citizen-i18n";
import { getCscAgent } from "@/data/citizen-services-seed";
import { BRAND, NAVY } from "./tokens";

interface Msg { id: number; role: "user" | "agent"; text: string; res?: ChatResponse }

export default function AiChat({ onClose }: { onClose: () => void }) {
  const { lang } = useCscLang();
  const t = tDict(chatI, lang);
  const isRtl = lang === "ar";
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, role: "agent", text: t.welcome, res: { agent: "orch", type: "text", text: t.welcome } }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  const send = (text: string) => {
    const v = text.trim();
    if (!v) return;
    setMessages((p) => [...p, { id: idRef.current++, role: "user", text: v }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const r = matchIntent(v, lang);
      setMessages((p) => [...p, { id: idRef.current++, role: "agent", text: r.text, res: r }]);
      setTyping(false);
    }, 420);
  };

  const PROMPTS = [t.p1, t.p2, t.p3, t.p4, t.p5, t.p6];

  return (
    <motion.div
      initial={{ x: isRtl ? "-100%" : "100%" }}
      animate={{ x: 0 }}
      exit={{ x: isRtl ? "-100%" : "100%" }}
      transition={{ type: "spring", damping: 26, stiffness: 260 }}
      className={`fixed top-0 ${isRtl ? "left-0 border-r" : "right-0 border-l"} h-full w-[420px] max-w-full bg-white shadow-2xl z-50 flex flex-col border-gray-200`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex-shrink-0 h-14 flex items-center px-4 gap-3 text-white" style={{ background: NAVY }}>
        <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center"><Bot size={18} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{t.headerTitle}</p>
          <p className="text-[10px] text-white/70">{t.headerSubtitle}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/15 rounded-lg"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((m) => {
          const agent = m.res ? getCscAgent(m.res.agent) : undefined;
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white`}
                style={{ background: m.role === "user" ? "#9CA3AF" : (agent?.color ?? BRAND) }}>
                {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </div>
              <div className="max-w-[78%]">
                {m.role === "agent" && agent && (
                  <p className="text-[10px] font-semibold mb-1" style={{ color: agent.color }}>
                    {lang === "en" ? agent.name.en : agent.name.ar}
                  </p>
                )}
                <div className={`rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line ${
                  m.role === "user" ? "bg-[#5BA98A] text-white rounded-tr-sm" : "bg-white border border-gray-100 text-gray-700 rounded-tl-sm shadow-sm"
                }`}>
                  {m.text}
                </div>
                {m.res?.type === "table" && m.res.data && (
                  <div className="mt-2 bg-white rounded-xl border border-gray-100 overflow-x-auto">
                    <table className="text-[11px] w-full">
                      <thead className="bg-gray-50">
                        <tr>{((m.res.data.headers as string[]) || []).map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-start font-semibold text-gray-600">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {(((m.res.data.rows as string[][]) || []).slice(0, 8)).map((r, ri) => (
                          <tr key={ri} className="border-t border-gray-50">{r.map((c, ci) => (
                            <td key={ci} className="px-2 py-1 text-gray-700">{c}</td>
                          ))}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {m.res?.type === "chart" && m.res.data && (() => {
                  const d = (m.res.data.chartData as { name: string; value: number; color?: string }[]) || [];
                  return (
                    <div className="mt-2 bg-white border border-gray-100 rounded-xl p-2 h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={d} margin={{ left: 0, right: 5, top: 5, bottom: 5 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                          <YAxis tick={{ fontSize: 9 }} width={28} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20}>
                            {d.map((c, i) => <Cell key={i} fill={c.color ?? BRAND} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
                {m.res?.type === "list" && m.res.data && (
                  <div className="mt-2 bg-white border border-gray-100 rounded-xl p-3 space-y-1.5">
                    {((m.res.data.items as { k: string; v: string }[]) || []).map((it, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] gap-3">
                        <span className="text-gray-500">{it.k}</span>
                        <span className="font-semibold text-gray-800">{it.v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {m.res?.type === "metric" && m.res.data && (
                  <div className="mt-2 rounded-xl px-4 py-3 text-white" style={{ background: NAVY }}>
                    <p className="text-base font-extrabold">{String(m.res.data.value)}</p>
                    <p className="text-[10px] text-white/70">{String(m.res.data.target ?? "")} · {String(m.res.data.delta ?? "")}</p>
                  </div>
                )}
                {m.res?.type === "sms-card" && m.res.data && (
                  <div className="mt-2 space-y-2">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-[11px] text-gray-700" dir="rtl">{String((m.res.data as Record<string, string>).ar)}</div>
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-gray-700" dir="ltr">{String((m.res.data as Record<string, string>).en)}</div>
                  </div>
                )}
                {m.res?.type === "case-card" && m.res.data && (
                  <div className="mt-2 bg-white border border-gray-100 rounded-xl p-2 text-[10px] text-gray-500">
                    <span className="font-semibold" style={{ color: BRAND }}>{String((m.res.data as Record<string, string>).caseId)}</span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
        {typing && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full text-white flex items-center justify-center" style={{ background: BRAND }}><Bot size={14} /></div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {messages.length <= 1 && (
        <div className="px-4 py-2 border-t border-gray-100 flex flex-wrap gap-1.5 bg-white">
          {PROMPTS.map((p) => (
            <button key={p} onClick={() => send(p)} className="text-[11px] px-2.5 py-1.5 rounded-full border border-emerald-100 bg-emerald-50 text-[#1F4F3F] hover:bg-emerald-100 transition-colors">{p}</button>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-gray-100 bg-white">
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={t.placeholder} rows={1}
            className="flex-1 resize-none text-[13px] border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#5BA98A]/20 focus:border-[#5BA98A] max-h-24" />
          <button onClick={() => send(input)} disabled={!input.trim()} style={{ background: BRAND }}
            className="w-9 h-9 rounded-xl text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
