import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Send, X, RotateCcw, RefreshCw, Sparkles } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import { useChatStream } from "@/hooks/useChatStream";

const MAX_INPUT_CHARS = 1000;

/**
 * Minimal inline formatter — turns **bold** into <strong>. Keeps everything
 * else as plain text so we don't accidentally render any HTML the model emits.
 */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<strong key={`b-${key++}`} className="font-semibold text-[#0E2841]">{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const T = {
  open: { en: "Ask Maven AI", ar: "اسأل Maven AI" },
  title: { en: "Ask Maven", ar: "اسأل Maven" },
  subtitle: {
    en: "About our services, assessments, or how we work.",
    ar: "عن خدماتنا، تشخيصاتنا، أو طريقة عملنا.",
  },
  placeholder: {
    en: "What would you like to know?",
    ar: "ما الذي تودّون معرفته؟",
  },
  send: { en: "Send", ar: "إرسال" },
  reset: { en: "New chat", ar: "محادثة جديدة" },
  close: { en: "Close", ar: "إغلاق" },
  thinking: { en: "Thinking…", ar: "يفكر…" },
  starters: { en: "Try asking…", ar: "جرّب أن تسأل…" },
  disclaimer: {
    en: "AI assistant — answers grounded in Maven AI's published material. For specifics, book a 30-minute readout.",
    ar: "مساعد ذكاء اصطناعي — إجاباته مستندة إلى محتوى Maven AI المنشور. للتفاصيل احجز قراءة 30 دقيقة.",
  },
  retry: { en: "Try again", ar: "حاول مرة أخرى" },
  charLimitHint: {
    en: `Please keep messages under ${MAX_INPUT_CHARS} characters.`,
    ar: `يرجى إبقاء الرسالة أقل من ${MAX_INPUT_CHARS} حرفًا.`,
  },
  charLimitNear: {
    en: "Approaching the message length limit.",
    ar: "اقتربت من حد طول الرسالة.",
  },
} as const;

const STARTERS_EN = [
  "What does Maven AI actually do?",
  "Which assessment fits a CIO modernizing legacy systems?",
  "How is Maven AI different from a Tier-1 consultancy?",
  "What's your approach to sovereign on-prem AI?",
];
const STARTERS_AR = [
  "ما الذي تقوم به Maven AI تحديداً؟",
  "أي تشخيص يناسب CIO يحدّث أنظمة قديمة؟",
  "كيف تختلف Maven AI عن استشارية من الفئة الأولى؟",
  "ما منهجكم في الذكاء الاصطناعي السيادي على الأماكن؟",
];

const SESSION_KEY = "maven-ai-chat-open";

export default function ChatWidget() {
  const { lang, dir } = useLang();
  const t = (s: { en: string; ar: string }) => tStr(s, lang);
  // The chat backend's intent matcher only knows EN/AR — fall TR users back
  // to EN so the chat works correctly while the rest of the chrome stays in TR.
  const chatLang: "en" | "ar" = lang === "ar" ? "ar" : "en";
  const { messages, status, send, reset, abort, retry, canRetry } = useChatStream(chatLang);
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_KEY, open ? "1" : "0");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Abort any in-flight stream when the panel is closed (the widget stays
  // mounted to preserve session state, so we can't rely on unmount cleanup).
  useEffect(() => {
    if (!open) abort();
  }, [open, abort]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "streaming") return;
    if (input.length > MAX_INPUT_CHARS) return;
    const text = input;
    setInput("");
    void send(text);
  };

  const inputOverLimit = input.length > MAX_INPUT_CHARS;
  const inputNearLimit = !inputOverLimit && input.length >= Math.floor(MAX_INPUT_CHARS * 0.9);

  const starters = lang === "ar" ? STARTERS_AR : STARTERS_EN;

  return (
    <>
      {/* Floating action button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(true)}
            className={`fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#e69a1f] text-[#0E2841] font-bold px-5 py-3.5 rounded-full shadow-2xl shadow-amber-500/20 transition-colors`}
            aria-label={t(T.open)}
            data-testid="button-open-chat"
          >
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[#F5A623]"
              animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            />
            <span
              aria-hidden
              className="relative inline-flex items-center justify-center w-5 h-5 font-black text-[15px] leading-none tracking-tight"
            >
              M
            </span>
            <span className="relative hidden sm:inline text-sm">{t(T.open)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            dir={dir}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={`fixed z-50 bg-white shadow-2xl border border-gray-200 flex flex-col
              inset-0 sm:inset-auto sm:bottom-6 sm:right-6
              sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:h-[600px] sm:max-h-[calc(100vh-3rem)]
              sm:rounded-2xl overflow-hidden`}
            data-testid="chat-panel"
          >
            {/* Header */}
            <div className="bg-[#0E2841] text-white px-5 py-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#F5A623]/15 border border-[#F5A623]/30 flex items-center justify-center">
                  <Sparkles size={16} className="text-[#F5A623]" />
                </div>
                <div>
                  <div className="font-bold text-sm leading-tight">{t(T.title)}</div>
                  <div className="text-[11px] text-gray-300 leading-tight">{t(T.subtitle)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="p-1.5 rounded hover:bg-white/10 transition-colors"
                    aria-label={t(T.reset)}
                    title={t(T.reset)}
                    data-testid="button-reset-chat"
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded hover:bg-white/10 transition-colors"
                  aria-label={t(T.close)}
                  title={t(T.close)}
                  data-testid="button-close-chat"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-[#F8F9FA]">
              {messages.length === 0 && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {lang === "ar"
                      ? "اسألني عن خدمات Maven AI، التشخيصات، الصناعات التي نخدمها، أو كيف نعمل. سأجيب بناءً على ما نشرته الشركة."
                      : "Ask me about Maven AI's services, assessments, the industries we serve, or how we work. I'll answer from what the firm has published."}
                  </p>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                      {t(T.starters)}
                    </div>
                    <div className="flex flex-col gap-2">
                      {starters.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void send(s)}
                          disabled={status === "streaming"}
                          className="text-left text-sm bg-white border border-gray-200 hover:border-[#156082] hover:text-[#156082] text-gray-700 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:text-gray-700"
                          data-testid="button-chat-starter"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                return (
                <div key={i} className="mb-4">
                  {m.role === "user" ? (
                    <div className={`flex ${dir === "rtl" ? "justify-start" : "justify-end"}`}>
                      <div className="max-w-[85%] bg-[#0E2841] text-white text-sm rounded-2xl px-4 py-2.5 leading-relaxed">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div className={`flex ${dir === "rtl" ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[90%]">
                        <div
                          className={`text-sm rounded-2xl px-4 py-3 leading-relaxed whitespace-pre-wrap ${
                            m.error
                              ? "bg-red-50 text-red-700 border border-red-100"
                              : "bg-white text-gray-800 border border-gray-200"
                          }`}
                        >
                          {m.content ? (
                            renderInline(m.content)
                          ) : (
                            <span className="text-gray-400 inline-flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#F5A623] animate-pulse" />
                              {t(T.thinking)}
                            </span>
                          )}
                        </div>
                        {m.suggestions && m.suggestions.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {m.suggestions.map((s) => (
                              <Link
                                key={`${s.kind}-${s.href}`}
                                href={s.href}
                                onClick={() => setOpen(false)}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#F5A623]/10 hover:bg-[#F5A623] text-[#0E2841] hover:text-white border border-[#F5A623]/30 hover:border-[#F5A623] px-3 py-1.5 rounded-full transition-colors"
                                data-testid="link-chat-suggestion"
                              >
                                {s.label}
                              </Link>
                            ))}
                          </div>
                        )}
                        {isLast && m.error && canRetry && (
                          <div className="mt-2.5">
                            <button
                              type="button"
                              onClick={() => void retry()}
                              className="inline-flex items-center gap-1.5 text-xs font-bold bg-[#0E2841] hover:bg-[#156082] text-white px-3 py-1.5 rounded-full transition-colors"
                              data-testid="button-chat-retry"
                            >
                              <RefreshCw size={12} />
                              {t(T.retry)}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="border-t border-gray-200 bg-white px-3 py-3 flex-shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  // Allow small overflow so the over-limit warning is reachable.
                  onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS + 200))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  rows={1}
                  placeholder={t(T.placeholder)}
                  disabled={status === "streaming"}
                  aria-invalid={inputOverLimit || undefined}
                  className={`flex-1 resize-none text-sm border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-400 max-h-32 ${
                    inputOverLimit
                      ? "border-red-300 focus:border-red-400 focus:ring-red-300"
                      : "border-gray-200 focus:border-[#156082] focus:ring-[#156082]"
                  }`}
                  data-testid="input-chat"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || status === "streaming" || inputOverLimit}
                  className="flex-shrink-0 w-10 h-10 inline-flex items-center justify-center bg-[#0E2841] hover:bg-[#156082] disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-lg transition-colors"
                  aria-label={t(T.send)}
                  data-testid="button-send-chat"
                >
                  <Send size={16} />
                </button>
              </div>
              {(inputNearLimit || inputOverLimit) && (
                <div className={`mt-1.5 flex items-center justify-between text-[10px] ${inputOverLimit ? "text-red-600" : "text-gray-500"}`}>
                  <span>{inputOverLimit ? t(T.charLimitHint) : t(T.charLimitNear)}</span>
                  <span data-testid="text-chat-char-count">{input.length}/{MAX_INPUT_CHARS}</span>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-2 leading-snug">{t(T.disclaimer)}</p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
