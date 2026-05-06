import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Sparkles, Bot, User as UserIcon } from "lucide-react";
import { useCareLang } from "./DemoLangContext";
import { aiChat, tDict } from "./care-i18n";
import { CHAT_INTENTS, matchIntent, type ChatBlock } from "./chatIntents";
import { BRAND, ACCENT_AI } from "./tokens";

interface ChatMsg {
  id: number;
  role: "user" | "ai";
  text?: string;
  blocks?: ChatBlock[];
}

const TONE_BG: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
};

export function AiChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useCareLang();
  const t = tDict(aiChat, lang);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ id: 1, role: "ai", text: t.welcome }]);
    }
  }, [open, t.welcome, messages.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const userMsg: ChatMsg = { id: Date.now(), role: "user", text };
    const intent = matchIntent(text, lang);
    const blocks = intent?.respond() ?? [{ kind: "text" as const, en: "I can help with queue priorities, SLA, occupancy, deflection, refund eligibility, drafting and QA. Try a suggestion below.", ar: "أستطيع المساعدة بأولويات الطابور وSLA والانشغال والانحراف وأهلية الاسترداد والصياغة والجودة. جرّبي اقتراحاً أدناه." }];
    const aiMsg: ChatMsg = { id: Date.now() + 1, role: "ai", blocks };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setDraft("");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: lang === "ar" ? -480 : 480, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: lang === "ar" ? -480 : 480, opacity: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 24 }}
          className={`fixed top-0 ${lang === "ar" ? "left-0" : "right-0"} h-full w-full sm:w-[420px] bg-white shadow-2xl border-s border-gray-200 z-[80] flex flex-col`}
        >
          <header className="px-5 py-3 border-b border-gray-100 flex items-center gap-3" style={{ background: `linear-gradient(90deg, ${BRAND}10, transparent)` }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: ACCENT_AI + "15" }}>
              <Sparkles size={16} style={{ color: ACCENT_AI }} />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-bold">{t.headerTitle}</h2>
              <p className="text-[11px] text-gray-500">{t.headerSubtitle}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400" aria-label="Close">
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50/50">
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "ai" && (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: ACCENT_AI + "15" }}>
                    <Bot size={14} style={{ color: ACCENT_AI }} />
                  </div>
                )}
                <div className={`max-w-[80%] ${m.role === "user" ? "order-2" : ""}`}>
                  {m.text && (
                    <div className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "text-white" : "bg-white border border-gray-100 text-gray-700"}`} style={m.role === "user" ? { background: BRAND } : {}}>
                      {m.text}
                    </div>
                  )}
                  {m.blocks?.map((b, i) => <BlockRenderer key={i} block={b} lang={lang} />)}
                </div>
                {m.role === "user" && (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 order-3 bg-gray-200">
                    <UserIcon size={14} className="text-gray-600" />
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="px-4 py-2 border-t border-gray-100 bg-white">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1.5">Suggestions</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {CHAT_INTENTS.map((it) => (
                <button
                  key={it.id}
                  onClick={() => send(lang === "en" ? it.labelEn : it.labelAr)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 text-gray-600 transition-colors"
                >
                  {lang === "en" ? it.labelEn : it.labelAr}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={onSubmit} className="px-4 py-3 border-t border-gray-100 bg-white flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.placeholder}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-400"
            />
            <button
              type="submit"
              className="w-9 h-9 rounded-lg text-white flex items-center justify-center disabled:opacity-50"
              style={{ background: BRAND }}
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <Send size={14} />
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BlockRenderer({ block, lang }: { block: ChatBlock; lang: "en" | "ar" }) {
  if (block.kind === "text") {
    return <div className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed bg-white border border-gray-100 text-gray-700 mt-1">{lang === "en" ? block.en : block.ar}</div>;
  }
  if (block.kind === "kpi") {
    return (
      <div className="mt-1.5 bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {block.rows.map((r, i) => (
          <div key={i} className="px-3 py-2 flex items-center justify-between border-b border-gray-50 last:border-0">
            <span className="text-[11px] text-gray-600">{lang === "en" ? r.labelEn : r.labelAr}</span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_BG[r.tone ?? "ok"]}`}>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="mt-1.5 bg-white rounded-2xl border border-gray-100 px-4 py-2.5 space-y-1.5">
        {block.items.map((it, i) => (
          <li key={i} className="text-[12px] text-gray-700 leading-relaxed list-disc list-inside">{lang === "en" ? it.en : it.ar}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === "actions") {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {block.actions.map((a) => (
          <button key={a.id} className="text-[11px] px-3 py-1.5 rounded-full text-white font-semibold" style={{ background: BRAND }}>
            {lang === "en" ? a.labelEn : a.labelAr}
          </button>
        ))}
      </div>
    );
  }
  return null;
}
