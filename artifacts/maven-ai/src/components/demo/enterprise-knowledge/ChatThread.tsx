import { useEffect, useRef, useState } from "react";
import { Send, Bot, User, Sparkles, ShieldAlert, ShieldCheck, ArrowUpRight } from "lucide-react";
import { matchEkcIntent, type ChatResponse, type CitedClaim } from "./chatIntents";
import { useEkcLang, useEkcT } from "./DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { chat } from "./knowledge-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import { agentById, type AgentId, withheldFor } from "@/data/enterprise-knowledge-agent";
import { sourceById, type PersonaId } from "@/data/enterprise-knowledge-seed";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  timestamp: Date;
  /** Persona at the time the question was asked (for audit). */
  personaAtAsk?: PersonaId;
}

interface Props {
  onConsideredChange: (considered: string[], cited: string[]) => void;
  onNavigate?: (view: string) => void;
}

export default function ChatThread({ onConsideredChange, onNavigate }: Props) {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const isAr = lang === "ar";
  const { personaId, setPersonaId, setOpenSourceId, appendAudit } = useEkcData();

  const QUICK_PROMPTS = [
    t("prompt1", chat), t("prompt2", chat), t("prompt3", chat), t("prompt4", chat),
    t("prompt5", chat), t("prompt6", chat), t("prompt7", chat), t("prompt8", chat),
  ];

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "welcome", role: "assistant",
      text: t("welcome", chat),
      response: { agent: "orch", type: "text", text: "" },
      timestamp: new Date("2026-05-05T11:08:00Z"),
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    const askedAs = personaId;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: msg, timestamp: new Date(), personaAtAsk: askedAs }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const response = matchEkcIntent(msg, lang, askedAs);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: response.text, response, timestamp: new Date(), personaAtAsk: askedAs }]);
      setTyping(false);

      // Update right-rail considered/cited
      const considered = response.data?.consideredSourceIds ?? [];
      const cited = response.data?.citedSourceIds ?? [];
      onConsideredChange(considered, cited);

      // Audit log entry
      if (response.type === "answer" || response.type === "refusal" || response.type === "escalation") {
        appendAudit({
          id: `Q-${Date.now()}`,
          ts: new Date().toISOString(),
          personaId: askedAs,
          question: { en: msg, ar: msg },
          visibleCount: considered.filter((id) => {
            const s = sourceById(id);
            return s ? !response.data?.withheldSourceIds?.includes(id) : false;
          }).length || (response.data?.citedSourceIds?.length ?? 0),
          citedCount: cited.length,
          withheldCount: response.data?.withheldSourceIds?.length ?? 0,
          confidence: response.data?.confidence ?? null,
          action: response.type === "answer" ? "answered" : response.type === "refusal" ? "refused" : "escalated",
        });
      }

      // Side-effects
      if (response.type === "personaSwitch" && response.data?.switchPersonaTo) {
        setTimeout(() => setPersonaId(response.data!.switchPersonaTo!), 300);
      }
      if (response.type === "navigate" && response.data?.navigateTo && onNavigate) {
        setTimeout(() => onNavigate(response.data!.navigateTo!), 300);
      }
    }, 480);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  function agentLabel(id: AgentId): string {
    return agentById(id)?.name[lang] ?? id;
  }
  function agentColor(id: AgentId): string {
    return agentById(id)?.color ?? BRAND;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 h-14 border-b border-gray-200 bg-white flex items-center px-4 gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}>
          <Sparkles size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold truncate" style={{ color: BRAND_INK }}>{t("title", chat)}</p>
          <p className="text-[11px] text-gray-500 truncate">{t("subtitle", chat)}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5">
        {messages.map((msg) => {
          const r = msg.response;
          const a = r?.agent;
          const bylineAgents = r?.bylineAgents ?? [];
          return (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && a && (
                <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-white" style={{ background: agentColor(a) }}>
                  <Bot size={15} />
                </div>
              )}
              <div className={`max-w-[640px] ${msg.role === "user" ? "order-first" : ""}`}>
                {msg.role === "assistant" && a && (
                  <p className="text-[10px] text-gray-500 mb-1 font-semibold flex flex-wrap gap-x-1.5">
                    <span>
                      {t("authoredBy", chat)} <span style={{ color: agentColor(a) }}>{agentLabel(a)}</span>
                    </span>
                    {bylineAgents.includes("audit") && (
                      <span>· {t("auditedBy", chat)} <span style={{ color: agentColor("audit") }}>{agentLabel("audit")}</span></span>
                    )}
                    {bylineAgents.includes("conf") && r?.data?.confidence != null && (
                      <span>· {t("scoredBy", chat)} <span style={{ color: agentColor("conf") }}>{agentLabel("conf")}</span> ({r.data.confidence}% {t("confidenceLabel", chat)})</span>
                    )}
                    {bylineAgents.includes("perm") && r?.type === "refusal" && (
                      <span>· <span style={{ color: agentColor("perm") }}>{agentLabel("perm")}</span></span>
                    )}
                  </p>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user" ? "text-white rounded-br-md" : "bg-white text-gray-800 rounded-bl-md border border-gray-200"
                  }`}
                  style={msg.role === "user" ? { background: BRAND_INK } : undefined}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>
                </div>

                {/* answer with cited claims */}
                {r?.type === "answer" && Array.isArray(r.data?.claims) && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3 space-y-2.5">
                    {(r.data!.claims as CitedClaim[]).map((c, i) => {
                      const cited = r.data?.citedSourceIds ?? [];
                      return (
                        <div key={i} className="text-[12.5px] text-gray-800 leading-relaxed">
                          {renderWithCitations(c.text[lang], c.sourceIds, cited, setOpenSourceId)}
                        </div>
                      );
                    })}
                    {/* Confidence + withhold badges */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                      {r.data?.confidence != null && (
                        <ConfidenceChip value={r.data.confidence} lang={lang} />
                      )}
                      {(r.data?.withheldSourceIds?.length ?? 0) > 0 && (
                        <WithholdChip count={r.data!.withheldSourceIds!.length} lang={lang} />
                      )}
                    </div>
                    {(r.data?.withheldSourceIds?.length ?? 0) > 0 && (
                      <WithholdDisclosure
                        sourceIds={r.data!.withheldSourceIds!}
                        lang={lang}
                      />
                    )}
                  </div>
                )}

                {/* refusal */}
                {r?.type === "refusal" && (
                  <div className="mt-2 bg-[#FFF7F7] border border-[#FECACA] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <ShieldAlert size={14} style={{ color: "#E30613" }} />
                      <p className="text-[11px] font-extrabold uppercase" style={{ color: "#E30613" }}>{t("refusal", chat)}</p>
                    </div>
                    {r.data?.refusalReason && (
                      <p className="text-[12px] text-gray-700 mb-2">{r.data.refusalReason[lang]}</p>
                    )}
                    {r.data?.escalationTo && (
                      <button
                        onClick={() => handleSend(t("prompt7", chat))}
                        className="text-[11px] font-bold inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-white"
                        style={{ background: BRAND_INK }}
                      >
                        {t("escalateCta", chat)} → {r.data.escalationTo[lang]} <ArrowUpRight size={11} />
                      </button>
                    )}
                  </div>
                )}

                {/* escalation */}
                {r?.type === "escalation" && r.data?.escalationTo && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <ShieldCheck size={14} style={{ color: BRAND }} />
                      <p className="text-[11px] font-extrabold uppercase" style={{ color: BRAND }}>
                        {lang === "en" ? "Escalation sent" : "تمّ التصعيد"}
                      </p>
                    </div>
                    <p className="text-[12px] text-gray-700">
                      → {r.data.escalationTo[lang]}
                    </p>
                  </div>
                )}

                {/* navigate / persona switch — pure side-effect, no extra widget */}
                {r?.type === "list" && Array.isArray(r.data?.items) && (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3 space-y-1.5">
                    {(r.data!.items as string[]).map((item, i) => (
                      <div key={i} className="text-[12px] text-gray-700 flex gap-2">
                        <span className="font-bold" style={{ color: BRAND }}>{i + 1}.</span>
                        <span className="flex-1">{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-1">
                  {msg.timestamp.toLocaleTimeString(isAr ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-xl bg-gray-200 flex-shrink-0 flex items-center justify-center">
                  <User size={14} className="text-gray-600" />
                </div>
              )}
            </div>
          );
        })}

        {typing && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: BRAND }}>
              <Bot size={15} className="text-white" />
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

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-gray-200 p-3 bg-white">
        <div className="flex gap-1.5 flex-wrap mb-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSend(prompt)}
              className="text-[10.5px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
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
            placeholder={t("placeholder", chat)}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-[var(--brand)]"
            style={{ ["--brand" as never]: BRAND }}
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
    </div>
  );
}

function renderWithCitations(
  text: string,
  claimSourceIds: string[],
  citedSourceIds: string[],
  onClickSource: (id: string) => void,
) {
  // Replace [n] tokens with clickable badges. Each [n] resolves to claimSourceIds[n-1].
  const parts: (string | { idx: number; sourceId: string })[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    const n = parseInt(m[1], 10);
    const sid = claimSourceIds[n - 1];
    if (sid) parts.push({ idx: citedSourceIds.indexOf(sid) + 1 || n, sourceId: sid });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <button
            key={i}
            onClick={() => onClickSource(p.sourceId)}
            className="inline-flex items-center justify-center align-middle ms-0.5 me-0.5 px-1.5 py-0 min-w-[18px] h-[18px] rounded text-[10px] font-bold text-white hover:scale-110 transition-transform"
            style={{ background: BRAND }}
            title={p.sourceId}
          >
            {p.idx}
          </button>
        ),
      )}
    </>
  );
}

function ConfidenceChip({ value, lang }: { value: number; lang: "en" | "ar" }) {
  const color = value >= 85 ? "#10B981" : value >= 75 ? "#F59E0B" : "#E30613";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: `${color}1A`, color }}
    >
      <ShieldCheck size={10} />
      {value}% {lang === "en" ? "confidence" : "ثقة"}
    </span>
  );
}

function WithholdChip({ count, lang }: { count: number; lang: "en" | "ar" }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: "#FEE2E2", color: "#E30613" }}
    >
      <ShieldAlert size={10} />
      {count} {lang === "en" ? "sources withheld" : "مصادر محجوبة"}
    </span>
  );
}

function WithholdDisclosure({ sourceIds, lang }: { sourceIds: string[]; lang: "en" | "ar" }) {
  return (
    <div className="bg-[#FFF7F7] border border-[#FECACA] rounded-lg p-2.5">
      <p className="text-[11px] font-extrabold mb-1" style={{ color: "#E30613" }}>
        {lang === "en" ? `${sourceIds.length} sources withheld` : `${sourceIds.length} مصادر محجوبة`}
      </p>
      <p className="text-[11px] text-gray-700 leading-relaxed">
        {lang === "en"
          ? "Hidden by Permission Filter (legal-privileged). They may materially change the answer. The Concierge has flagged a Compliance review."
          : "حجبها فلتر الصلاحيات (سرّ قانوني). قد تغيّر الإجابة جوهرياً. أشار الكونسيرج إلى مراجعة الامتثال."}
      </p>
    </div>
  );
}
