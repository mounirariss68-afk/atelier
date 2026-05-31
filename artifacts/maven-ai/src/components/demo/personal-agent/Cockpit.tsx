/**
 * Cognirise Personal Agent — Cockpit demo.
 *
 * Three-pane layout:
 *   - Left: chat against /api/chat/personal-agent (PCG-grounded system prompt
 *           built from the active persona's seed + the user's question).
 *   - Centre: workspace (Learnings · Pending approvals · In-progress · Personal nudge).
 *   - Right: glass-box rail (receipts as you approve actions, plus currently-cited PCG nodes).
 *
 * The chat hook is local to this file (deliberately not the website's
 * `useChatStream`, which is hard-coded to `/api/chat` and the EN/AR-only
 * marketing system prompt). All sample data comes from `personal-agent-seed.ts`.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Brain, Check, Edit3, FileText, History, Lightbulb, ListChecks, MessageSquare, Pencil, RotateCcw, Send, Shield, Sparkles, X } from "lucide-react";
import { Link } from "wouter";
import { useLang, tStr } from "@/lib/lang";
import { PERSONAS, getPersona, retrieveContext, buildSystemPrompt, type Persona, type PCGNode, type PendingCard, type LearningItem } from "@/data/personal-agent-seed";
import PersonaSwitcher from "./PersonaSwitcher";

interface Receipt {
  id: string;
  title: string;
  body: string;
  citedNodes: PCGNode[];
  autonomyLevel: "L1" | "L2" | "L3";
  estTimeSavedMin: number;
  sentAt: string;
  source: string;
}

interface PeopleSnippet {
  /** PCG node the user asked about (its label + category badge are rendered as the centre). */
  center: PCGNode;
  /** Up to 4 directly connected nodes — rendered as a tiny inline radial subgraph. */
  neighbors: { node: PCGNode; kind: string }[];
}

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  /** PCG nodes used as the grounding bundle for this turn (assistant only). */
  citedNodes?: PCGNode[];
  /**
   * Inline mini-graph snippet, rendered inside the assistant bubble when the
   * user asks a "who/what/anyone at <person|company|project>" question. This
   * is the third bidirectional Cockpit behavior the reviewer required: chat
   * surfaces the matching slice of the PCG before any prose is streamed.
   */
  peopleSnippet?: PeopleSnippet;
  error?: boolean;
}

const COPY = {
  title: { en: "Cockpit", ar: "القمرة", tr: "Kokpit" },
  copresence: { en: "Atlas is observing your day", ar: "أطلس يراقب يومك", tr: "Atlas gününüzü izliyor" },
  reset: { en: "Reset demo", ar: "إعادة العرض", tr: "Demoyu sıfırla" },
  workspace: { en: "Workspace", ar: "مساحة العمل", tr: "Çalışma alanı" },
  chat: { en: "Chat with your agent", ar: "تحدّث مع مساعدك", tr: "Ajanınızla sohbet edin" },
  glassbox: { en: "Glass-box rail", ar: "الشريط الزجاجي", tr: "Cam-kutu şeridi" },
  learnings: { en: "Learnings (just now)", ar: "تعلّمات (الآن)", tr: "Öğrenmeler (şimdi)" },
  pending: { en: "Pending your approval", ar: "بانتظار موافقتك", tr: "Onayınızı bekliyor" },
  inProgress: { en: "In progress", ar: "قيد التنفيذ", tr: "Sürmekte" },
  nudge: { en: "Personal nudge", ar: "تنبيه شخصي", tr: "Kişisel hatırlatma" },
  approve: { en: "Approve & send", ar: "موافقة وإرسال", tr: "Onayla ve gönder" },
  edit: { en: "Edit", ar: "تعديل", tr: "Düzenle" },
  reject: { en: "Reject", ar: "رفض", tr: "Reddet" },
  saveChanges: { en: "Save", ar: "حفظ", tr: "Kaydet" },
  cancel: { en: "Cancel", ar: "إلغاء", tr: "İptal" },
  why: { en: "Why this draft?", ar: "لماذا هذه المسودة؟", tr: "Neden bu taslak?" },
  citedNodes: { en: "Cited PCG nodes", ar: "عقد الرسم المستشهَد بها", tr: "Atıfta bulunulan PCG düğümleri" },
  source: { en: "Source", ar: "المصدر", tr: "Kaynak" },
  noReceiptsYet: { en: "No receipts yet — approve a draft to see the glass-box trail.", ar: "لا إيصالات بعد — وافق على مسودة لتراها في الشريط الزجاجي.", tr: "Henüz makbuz yok — taslağı onaylayarak cam-kutu izini görün." },
  receiptHeader: { en: "Glass-box receipts", ar: "إيصالات شفّافة", tr: "Cam-kutu makbuzları" },
  contextUsed: { en: "Context used in this answer", ar: "السياق المستخدم في هذه الإجابة", tr: "Bu cevapta kullanılan bağlam" },
  startersTitle: { en: "Try asking", ar: "جرّب أن تسأل", tr: "Şunu sormayı dene" },
  thinking: { en: "Atlas is thinking…", ar: "أطلس يفكر…", tr: "Atlas düşünüyor…" },
  send: { en: "Send", ar: "إرسال", tr: "Gönder" },
  inputPh: { en: "Ask your agent…", ar: "اسأل مساعدك…", tr: "Ajanına sor…" },
  receiptCited: { en: "Cited nodes", ar: "العقد المستخدمة", tr: "Atıflanan düğümler" },
  receiptSaved: { en: "Saved", ar: "وفّر", tr: "Kazandırdı" },
  undo: { en: "Undo", ar: "تراجع", tr: "Geri al" },
  proactiveBadge: { en: "Atlas spotted something", ar: "لاحظ أطلس شيئاً", tr: "Atlas bir şey fark etti" },
  acceptProactive: { en: "Yes, draft it", ar: "نعم، اكتبها", tr: "Evet, taslakla" },
  back: { en: "Back to detail page", ar: "العودة لصفحة الأداة", tr: "Detay sayfasına dön" },
  autonomy: { en: "Autonomy", ar: "الاستقلالية", tr: "Özerklik" },
  estSaved: { en: "Est. time saved", ar: "الوقت الموفّر التقديري", tr: "Tah. kazanılan süre" },
  scope: { en: "Scope", ar: "النطاق", tr: "Kapsam" },
  scopeWork: { en: "Work", ar: "عمل", tr: "İş" },
  scopePersonal: { en: "Personal", ar: "شخصي", tr: "Kişisel" },
  emptyChat: { en: "Ask your agent anything about your day, your accounts or your people. Every answer is grounded in your Personal Context Graph and lists exactly which nodes were used.", ar: "اسأل مساعدك أي شيء عن يومك أو حساباتك أو فريقك. كل إجابة مؤصّلة في رسم سياقك الشخصي وتسرد العقد المستخدمة.", tr: "Ajanına günün, hesapların veya insanların hakkında istediğini sor. Her cevap Kişisel Bağlam Grafiği'ne dayalıdır ve kullanılan düğümleri listeler." },
  errorReach: { en: "Could not reach the personal agent.", ar: "تعذّر الوصول إلى المساعد الشخصي.", tr: "Kişisel ajana ulaşılamadı." },
  errorNetwork: { en: "Network error talking to the personal agent.", ar: "خطأ شبكة عند التحدث إلى المساعد الشخصي.", tr: "Kişisel ajanla konuşurken ağ hatası." },
  allClear: { en: "All clear — every draft has been actioned. Switch persona or reset to see more.", ar: "تمام — تمّ التعامل مع كل مسودة. بدّل الشخصية أو أعد التعيين لمزيد.", tr: "Tertemiz — her taslak işlendi. Daha fazlası için kişiyi değiştir veya sıfırla." },
  ackPrefix: { en: "Done — sent", ar: "تمّ — أرسلت", tr: "Tamam — gönderildi" },
  ackReceiptDropped: { en: "Glass-box receipt dropped on the right.", ar: "إيصال شفّاف أُسقط على اليمين.", tr: "Cam-kutu makbuzu sağda bırakıldı." },
  ackTimeSaved: { en: "minutes saved", ar: "دقائق وفّرت", tr: "dakika kazandırdı" },
  peopleSnippetTitle: { en: "From your graph", ar: "من رسمك", tr: "Grafiğinden" },
  highlightLabel: { en: "Mentioned in your last question", ar: "مذكور في سؤالك الأخير", tr: "Son sorunuzda bahsedildi" },
};

function timeNowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// People-question detector. We deliberately keep this client-side and
// deterministic — the demo's whole point is that the agent's *answer text*
// is grounded in the PCG, but the *snippet that floats up next to it* should
// be visible the instant the user hits Enter, before any token has streamed.
// Returns the matched centre node (a relationship/project/domain) plus up to
// 4 directly connected neighbours, or null if no clear match.
function detectPeopleSnippet(persona: Persona, userText: string): PeopleSnippet | null {
  const q = userText.toLowerCase();
  // Cheap intent gate — only fire on questions that are clearly about a
  // person, account or project. This avoids snippets popping up on generic
  // "what's on my plate today" prompts.
  const intent = /(do i know|tell me about|what do i know about|brief me on|prep for|anyone at|who(\s+is|'s)|where are we on|what did .+ say)/i.test(userText);
  if (!intent) return null;
  // Score nodes by longest label-token overlap. Restrict to relationship /
  // project / domain so we don't snippet a pure preference like "no Friday
  // meetings". Two-letter tokens are dropped to avoid false positives like
  // matching "of" or "to".
  let best: { node: PCGNode; score: number } | null = null;
  for (const node of persona.pcg.nodes) {
    if (node.category !== "relationship" && node.category !== "project" && node.category !== "domain") continue;
    const label = node.label.en.toLowerCase();
    const tokens = label.split(/[^a-zA-Z]+/).filter((t) => t.length > 2);
    let score = 0;
    for (const tok of tokens) if (q.includes(tok)) score += tok.length;
    if (score > 0 && (!best || score > best.score)) best = { node, score };
  }
  if (!best) return null;
  // Pull up to 4 neighbours from the persona's edges, in either direction.
  const id = best.node.id;
  const byId = new Map(persona.pcg.nodes.map((n) => [n.id, n]));
  const nb: { node: PCGNode; kind: string }[] = [];
  const seen = new Set<string>();
  for (const e of persona.pcg.edges) {
    let other: PCGNode | undefined;
    if (e.from === id) other = byId.get(e.to);
    else if (e.to === id) other = byId.get(e.from);
    if (!other || seen.has(other.id)) continue;
    seen.add(other.id);
    nb.push({ node: other, kind: e.kind });
    if (nb.length >= 4) break;
  }
  return { center: best.node, neighbors: nb };
}

// Match a free-form chat message to one of the pending workspace cards. Used
// for the "chat → workspace card highlight" interaction: when the user (or the
// agent's reply) names a card by topic, we briefly ring that card. We derive
// the matchable keyword bag from the card's English title plus the EN labels
// of the PCG nodes it cites — this stays in lockstep with the seed without an
// extra hand-maintained mapping.
function matchCardId(persona: Persona, pending: PendingCard[], text: string): string | null {
  const q = text.toLowerCase();
  if (q.length < 3) return null;
  const byId = new Map(persona.pcg.nodes.map((n) => [n.id, n]));
  let best: { id: string; score: number } | null = null;
  for (const card of pending) {
    const tokens = new Set<string>();
    for (const word of card.title.en.toLowerCase().split(/[^a-zA-Z]+/)) {
      if (word.length > 3) tokens.add(word);
    }
    for (const nid of card.citedNodeIds) {
      const lbl = byId.get(nid)?.label.en.toLowerCase() ?? "";
      for (const word of lbl.split(/[^a-zA-Z]+/)) if (word.length > 3) tokens.add(word);
    }
    let score = 0;
    for (const tok of tokens) if (q.includes(tok)) score += tok.length;
    if (score > 0 && (!best || score > best.score)) best = { id: card.id, score };
  }
  // Require a non-trivial score so a single 4-letter coincidence doesn't fire.
  return best && best.score >= 5 ? best.id : null;
}

// ---- Local streaming chat hook ------------------------------------------------
function usePersonalAgentChat(persona: Persona) {
  const { lang } = useLang();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setStatus("idle");
  };

  const send = async (userText: string, onAssistantSettled?: (text: string) => void) => {
    if (status === "streaming") return;
    const grounding = retrieveContext(persona, userText, 8);
    const systemPrompt = buildSystemPrompt(persona, grounding, lang);
    const peopleSnippet = detectPeopleSnippet(persona, userText) ?? undefined;
    const outgoing: ChatMsg[] = [...messages, { role: "user", content: userText }];
    setMessages([...outgoing, { role: "assistant", content: "", citedNodes: grounding, peopleSnippet }]);
    setStatus("streaming");

    const controller = new AbortController();
    abortRef.current = controller;
    const apiPath = `${import.meta.env.BASE_URL}api/chat/personal-agent`;
    try {
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
          language: lang,
          systemPrompt,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: tStr(COPY.errorReach, lang), error: true };
          return next;
        });
        setStatus("error");
        return;
      }

      const reader = response.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let dataLines: string[] = [];
      let done = false;

      const dispatch = () => {
        if (dataLines.length === 0) return;
        const dataStr = dataLines.join("\n");
        dataLines = [];
        try {
          const evt = JSON.parse(dataStr);
          if (evt.type === "token") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role !== "assistant") return prev;
              next[next.length - 1] = { ...last, content: last.content + evt.token };
              return next;
            });
          } else if (evt.type === "done") {
            done = true;
          } else if (evt.type === "error") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: evt.message ?? "Error", error: true };
              return next;
            });
            setStatus("error");
          }
        } catch {
          // ignore parse error
        }
      };

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line === "") {
            dispatch();
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            const v = line.slice(5);
            dataLines.push(v.startsWith(" ") ? v.slice(1) : v);
          }
        }
      }
      // Strip the SUGGESTIONS marker tail if any leaked into the final buffer,
      // then notify the caller of the final assistant text so it can scan for
      // workspace-card mentions and pulse the matching card.
      let settledText = "";
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last.role !== "assistant") return prev;
        settledText = last.content.replace(/<<<SUGGESTIONS>>>[\s\S]*?<<<END>>>/g, "").trim();
        next[next.length - 1] = { ...last, content: settledText };
        return next;
      });
      setStatus("idle");
      abortRef.current = null;
      onAssistantSettled?.(settledText);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: tStr(COPY.errorNetwork, lang), error: true };
        return next;
      });
      setStatus("error");
    }
  };

  /** Insert a proactive assistant message without a streaming round-trip. */
  const inject = (msg: ChatMsg) => {
    setMessages((prev) => [...prev, msg]);
  };

  return { messages, status, send, reset, inject };
}

// ---------------------------------------------------------------------------
export default function Cockpit() {
  const { lang } = useLang();
  const [personaId, setPersonaId] = useState<Persona["id"]>("sales");
  const persona = useMemo(() => getPersona(personaId), [personaId]);
  const accent = persona.accent;

  const [pending, setPending] = useState<PendingCard[]>(persona.cockpit.pending);
  const [learnings, setLearnings] = useState<LearningItem[]>(persona.cockpit.learnings);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [proactiveFired, setProactiveFired] = useState(false);
  // Bidirectional chat <-> workspace highlight: the id of the pending card to
  // pulse-ring for ~3.5s when either the user or the agent names it. Cleared
  // on a timer so the demo doesn't get permanently stuck on one card.
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chat = usePersonalAgentChat(persona);

  // The highlight stays on long enough to survive a slow streaming round-trip
  // (so the user can finish reading the agent's answer and still see the card
  // it was about lit up), then auto-clears so the demo doesn't drift into a
  // permanent "everything looks important" state. Approving / rejecting the
  // card clears the highlight immediately via dropping the card from `pending`.
  const HIGHLIGHT_MS = 12000;
  const pulseCard = (id: string | null) => {
    if (!id) return;
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedCardId(id);
    highlightTimerRef.current = setTimeout(() => setHighlightedCardId(null), HIGHLIGHT_MS);
  };

  // Reset all per-persona state when the persona changes.
  useEffect(() => {
    setPending(persona.cockpit.pending);
    setLearnings(persona.cockpit.learnings);
    setReceipts([]);
    setEditing(null);
    setProactiveFired(false);
    setHighlightedCardId(null);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    chat.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  // Wrap chat.send so we can wire the two chat-side bidirectional behaviors:
  //   1. on user submit → look for a pending card the question is about and ring it.
  //   2. on assistant settle → ditto for the assistant's final reply text.
  const sendChat = (text: string) => {
    pulseCard(matchCardId(persona, pending, text));
    chat.send(text, (assistantText) => {
      pulseCard(matchCardId(persona, pending, assistantText));
    });
  };

  const nodeById = useMemo(() => {
    const m = new Map<string, PCGNode>();
    for (const n of persona.pcg.nodes) m.set(n.id, n);
    return m;
  }, [persona]);

  const fireProactiveIfNeeded = () => {
    if (proactiveFired) return;
    setProactiveFired(true);
    setTimeout(() => {
      chat.inject({
        role: "assistant",
        content: tStr(persona.cockpit.proactive.message, lang),
        citedNodes: persona.cockpit.proactive.citedNodeIds.map((id) => nodeById.get(id)).filter(Boolean) as PCGNode[],
      });
    }, 1200);
  };

  const approve = (card: PendingCard) => {
    const cited = card.citedNodeIds.map((id) => nodeById.get(id)).filter(Boolean) as PCGNode[];
    const receipt: Receipt = {
      id: `r-${card.id}-${Date.now()}`,
      title: tStr(card.title, lang),
      body: editing?.id === card.id ? editing.body : tStr(card.body, lang),
      citedNodes: cited,
      autonomyLevel: card.autonomyLevel,
      estTimeSavedMin: card.estTimeSavedMin,
      sentAt: timeNowHHMM(),
      source: tStr(card.source, lang),
    };
    setReceipts((r) => [receipt, ...r]);
    setPending((p) => p.filter((x) => x.id !== card.id));
    setEditing(null);
    // Bidirectional: drop a deterministic acknowledgment into the chat thread
    // so the user sees the agent close the loop in the same surface they
    // started in. The ack names the approved card, points to the receipt rail
    // and surfaces the time saved — three things the glass-box rail alone
    // doesn't put in front of the user's eye.
    chat.inject({
      role: "assistant",
      content: `${tStr(COPY.ackPrefix, lang)} "${tStr(card.title, lang)}". ${tStr(COPY.ackReceiptDropped, lang)} ${card.estTimeSavedMin} ${tStr(COPY.ackTimeSaved, lang)}.`,
      citedNodes: cited,
    });
    pulseCard(card.id);
    fireProactiveIfNeeded();
  };

  const reject = (card: PendingCard) => {
    setPending((p) => p.filter((x) => x.id !== card.id));
  };

  const undo = (id: string) => setReceipts((r) => r.filter((x) => x.id !== id));

  const resetDemo = () => {
    setPending(persona.cockpit.pending);
    setLearnings(persona.cockpit.learnings);
    setReceipts([]);
    setEditing(null);
    setProactiveFired(false);
    setHighlightedCardId(null);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    chat.reset();
  };

  // Most recent assistant message's grounding bundle drives the Glass-box "context used" row.
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
  const liveGrounding = lastAssistant?.citedNodes ?? [];

  return (
    <div className="min-h-screen bg-[#0A1230] text-white flex flex-col" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* Header */}
      <header className="border-b border-white/10 bg-[#091828]">
        <div className="max-w-[1500px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <Link href="/marketplace/cognirise-personal-agent" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white/70 hover:text-white text-xs">
            <ArrowLeft size={12} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: accent }}>
              <Brain size={14} className="text-[#0A1230]" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
                {persona.agentName} · {tStr(COPY.title, lang)}
              </p>
              <p className="text-sm font-bold">{tStr(persona.personName, lang)} — {tStr(persona.role, lang)}</p>
            </div>
          </div>
          <div className="ml-auto rtl:ml-0 rtl:mr-auto flex items-center gap-3">
            <div className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-xs text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {tStr(persona.copresence, lang)}
            </div>
            <PersonaSwitcher
              personaId={personaId}
              onPersona={setPersonaId}
              accent={accent}
              otherVariant={{ route: "mind", label: { en: "Open the Mind", ar: "افتح العقل", tr: "Zihni aç" } }}
            />
            <button
              onClick={resetDemo}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-white/80 text-xs font-bold"
              title={tStr(COPY.reset, lang)}
            >
              <RotateCcw size={12} />
              {tStr(COPY.reset, lang)}
            </button>
          </div>
        </div>
      </header>

      {/* Three columns */}
      <main className="flex-1 max-w-[1500px] mx-auto w-full px-3 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Workspace (centre) — first on mobile so it leads above the fold */}
        <section className="lg:col-span-5 lg:order-2 space-y-3">
          <SectionLabel icon={<ListChecks size={12} />} accent={accent}>{tStr(COPY.workspace, lang)}</SectionLabel>

          {/* Learnings */}
          <Card>
            <CardHeader icon={<Lightbulb size={14} className="text-amber-400" />} title={tStr(COPY.learnings, lang)} />
            <ul className="px-4 pb-4 space-y-2.5">
              {learnings.map((l) => (
                <li key={l.id} className="text-xs text-white/85 leading-relaxed">
                  <span className="text-white/95">{tStr(l.text, lang)}</span>
                  <span className="block mt-0.5 text-[10px] text-white/50">{tStr(l.source, lang)} · {l.citedNodeIds.length} {tStr(COPY.receiptCited, lang)}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Pending */}
          <Card>
            <CardHeader icon={<Pencil size={14} style={{ color: accent }} />} title={tStr(COPY.pending, lang)} />
            <div className="px-4 pb-4 space-y-3">
              {pending.length === 0 && (
                <p className="text-xs text-white/50 italic">{tStr(COPY.allClear, lang)}</p>
              )}
              {pending.map((card) => {
                const cited = card.citedNodeIds.map((id) => nodeById.get(id)).filter(Boolean) as PCGNode[];
                const isEditing = editing?.id === card.id;
                const isHighlighted = highlightedCardId === card.id;
                return (
                  <div
                    key={card.id}
                    data-testid={`pending-card-${card.id}`}
                    data-highlighted={isHighlighted ? "true" : "false"}
                    className={`rounded-xl bg-[#0A1230]/60 border p-3 transition-all duration-300 ${isHighlighted ? "border-amber-300 ring-2 ring-amber-300/40 shadow-[0_0_24px_rgba(252,211,77,0.25)]" : "border-white/10"}`}
                  >
                    {isHighlighted && (
                      <div className="mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-300/15 text-amber-200 text-[10px] font-bold uppercase tracking-widest">
                        <MessageSquare size={9} />
                        {tStr(COPY.highlightLabel, lang)}
                      </div>
                    )}
                    <div className="flex items-start gap-2 mb-2">
                      <p className="text-sm font-bold text-white flex-1">{tStr(card.title, lang)}</p>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">{card.autonomyLevel}</span>
                    </div>
                    <p className="text-xs text-white/70 mb-2">{tStr(card.preview, lang)}</p>
                    {isEditing ? (
                      <textarea
                        value={editing.body}
                        onChange={(e) => setEditing({ id: card.id, body: e.target.value })}
                        className="w-full h-40 rounded-lg bg-[#091828] border border-white/15 p-2 text-xs text-white/90 font-mono"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap text-xs text-white/85 font-sans bg-black/20 rounded-lg p-2.5 max-h-44 overflow-y-auto">{tStr(card.body, lang)}</pre>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-white/60">
                      <span className="font-bold uppercase tracking-widest" style={{ color: accent }}>
                        {tStr(COPY.why, lang)}
                      </span>
                      {cited.map((n) => (
                        <span key={n.id} className="px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10">{tStr(n.label, lang)}</span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-white/50 italic">{tStr(COPY.source, lang)}: {tStr(card.source, lang)} · {tStr(COPY.estSaved, lang)}: {card.estTimeSavedMin} min</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {!isEditing && (
                        <>
                          <button onClick={() => approve(card)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400 text-[#0A1230] text-xs font-bold hover:bg-emerald-300">
                            <Check size={12} />
                            {tStr(COPY.approve, lang)}
                          </button>
                          <button onClick={() => setEditing({ id: card.id, body: tStr(card.body, lang) })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20">
                            <Edit3 size={12} />
                            {tStr(COPY.edit, lang)}
                          </button>
                          <button onClick={() => reject(card)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-white/70 text-xs font-bold hover:bg-white/10">
                            <X size={12} />
                            {tStr(COPY.reject, lang)}
                          </button>
                        </>
                      )}
                      {isEditing && (
                        <>
                          <button onClick={() => approve(card)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400 text-[#0A1230] text-xs font-bold hover:bg-emerald-300">
                            <Check size={12} />
                            {tStr(COPY.saveChanges, lang)} & {tStr(COPY.approve, lang)}
                          </button>
                          <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-white/70 text-xs font-bold hover:bg-white/10">
                            <X size={12} />
                            {tStr(COPY.cancel, lang)}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* In progress */}
          <Card>
            <CardHeader icon={<History size={14} className="text-sky-400" />} title={tStr(COPY.inProgress, lang)} />
            <div className="px-4 pb-4 space-y-2.5">
              {persona.cockpit.inProgress.map((task) => (
                <div key={task.id} className="text-xs">
                  <p className="text-white font-bold mb-1">{tStr(task.title, lang)}</p>
                  <ol className="space-y-0.5">
                    {task.steps.map((s, i) => {
                      const done = i < task.currentStep;
                      const here = i === task.currentStep;
                      return (
                        <li key={i} className={`flex items-start gap-1.5 ${done ? "text-white/40 line-through" : here ? "text-white" : "text-white/50"}`}>
                          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${done ? "bg-emerald-400" : here ? "animate-pulse" : "bg-white/20"}`} style={here ? { background: accent } : undefined} />
                          <span>{tStr(s, lang)}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </Card>

          {/* Personal nudge */}
          <Card>
            <CardHeader icon={<Sparkles size={14} className="text-pink-400" />} title={tStr(COPY.nudge, lang)} accent="#f472b6" />
            <div className="px-4 pb-4">
              <p className="text-sm font-bold text-white mb-1">{tStr(persona.cockpit.nudge.title, lang)}</p>
              <p className="text-xs text-white/85 leading-relaxed">{tStr(persona.cockpit.nudge.body, lang)}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-white/55">
                <Shield size={10} />
                {tStr(COPY.scope, lang)}: {tStr(COPY.scopePersonal, lang)} · {persona.cockpit.nudge.citedNodeIds.length} {tStr(COPY.receiptCited, lang)}
              </div>
            </div>
          </Card>
        </section>

        {/* Chat (right on lg, second on mobile) */}
        <section className="lg:col-span-4 lg:order-1 flex flex-col rounded-2xl bg-[#091828] border border-white/10 min-h-[560px] max-h-[calc(100vh-120px)]">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <MessageSquare size={14} style={{ color: accent }} />
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: accent }}>{tStr(COPY.chat, lang)}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chat.messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-white/55 italic leading-relaxed">{tStr(COPY.emptyChat, lang)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{tStr(COPY.startersTitle, lang)}</p>
                <div className="flex flex-col gap-1.5">
                  {persona.starterPrompts.slice(0, 5).map((p) => (
                    <button key={p.en} onClick={() => sendChat(tStr(p, lang))} className="text-left text-xs text-white/85 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10">
                      {tStr(p, lang)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((m, i) => (
              <ChatBubble key={i} msg={m} accent={accent} snippetTitle={tStr(COPY.peopleSnippetTitle, lang)} />
            ))}
            {chat.status === "streaming" && (
              <p className="text-[11px] text-white/50 italic">{tStr(COPY.thinking, lang)}</p>
            )}
          </div>

          <ChatInput
            disabled={chat.status === "streaming"}
            onSend={sendChat}
            placeholder={tStr(COPY.inputPh, lang)}
            sendLabel={tStr(COPY.send, lang)}
            accent={accent}
          />
        </section>

        {/* Glass-box rail */}
        <aside className="lg:col-span-3 lg:order-3 space-y-3">
          <SectionLabel icon={<Shield size={12} />} accent="#22d3ee">{tStr(COPY.glassbox, lang)}</SectionLabel>

          {liveGrounding.length > 0 && (
            <Card>
              <CardHeader icon={<MessageSquare size={14} className="text-cyan-400" />} title={tStr(COPY.contextUsed, lang)} accent="#22d3ee" />
              <ul className="px-4 pb-4 space-y-1">
                {liveGrounding.map((n) => (
                  <li key={n.id} className="text-[11px] text-white/85 flex items-start gap-1.5">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                    <span>
                      <span className="text-white">{tStr(n.label, lang)}</span>
                      <span className="text-white/50"> · {n.category} · conf {n.confidence.toFixed(2)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader icon={<FileText size={14} className="text-cyan-400" />} title={tStr(COPY.receiptHeader, lang)} accent="#22d3ee" />
            <div className="px-4 pb-4 space-y-2.5 max-h-[460px] overflow-y-auto">
              {receipts.length === 0 && <p className="text-xs text-white/45 italic">{tStr(COPY.noReceiptsYet, lang)}</p>}
              {receipts.map((r) => (
                <div key={r.id} className="rounded-xl bg-[#0A1230]/60 border border-cyan-400/20 p-2.5">
                  <p className="text-xs font-bold text-white mb-1">✓ {r.title}</p>
                  <p className="text-[10px] text-white/55 mb-1.5">{r.sentAt} · {r.autonomyLevel} · {tStr(COPY.receiptSaved, lang)} {r.estTimeSavedMin} min</p>
                  <p className="text-[10px] text-white/60 mb-1">{tStr(COPY.receiptCited, lang)}:</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {r.citedNodes.map((n) => (
                      <span key={n.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-400/10 text-cyan-200 border border-cyan-400/20">{tStr(n.label, lang)}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/45 italic mb-1.5">{r.source}</p>
                  <button onClick={() => undo(r.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[10px] text-white/80 font-bold">
                    <RotateCcw size={9} />
                    {tStr(COPY.undo, lang)}
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </main>
    </div>
  );
}

// ---- Small visual components -------------------------------------------------
function SectionLabel({ icon, children, accent }: { icon: React.ReactNode; children: React.ReactNode; accent: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span style={{ color: accent }}>{icon}</span>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{children}</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-[#091828] border border-white/10 overflow-hidden">{children}</div>;
}

function CardHeader({ icon, title, accent }: { icon: React.ReactNode; title: string; accent?: string }) {
  return (
    <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
      {icon}
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: accent ?? "#f5f5f5" }}>{title}</p>
    </div>
  );
}

function ChatBubble({ msg, accent, snippetTitle }: { msg: ChatMsg; accent: string; snippetTitle: string }) {
  const { lang } = useLang();
  if (msg.role === "user") {
    return (
      <div className="flex justify-end rtl:justify-start">
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-white text-[#0A1230] text-sm">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start rtl:justify-end">
      <div className="max-w-[90%] w-full">
        {/* People-question snippet (bidirectional behavior #3): when the user
            asked about a person/account/project, surface a small radial graph
            of that node + its closest neighbours, embedded inline with the
            assistant's prose. Renders even before any token has streamed so
            the user sees the agent has located the right corner of the PCG. */}
        {msg.peopleSnippet && <PeopleSnippetCard snippet={msg.peopleSnippet} accent={accent} title={snippetTitle} />}
        <div className={`px-3 py-2 rounded-2xl rounded-bl-sm text-sm whitespace-pre-wrap ${msg.error ? "bg-rose-500/15 text-rose-200 border border-rose-500/30" : "bg-white/5 text-white border border-white/10"}`}>
          {msg.content || <span className="text-white/40 italic">…</span>}
        </div>
        {msg.citedNodes && msg.citedNodes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {msg.citedNodes.map((n) => (
              <span key={n.id} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${accent}20`, color: accent }}>
                {tStr(n.label, lang)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline mini-graph snippet rendered inside the assistant chat bubble. Pure
 * SVG, no external graph library — keeps bundle small and stays consistent
 * with the Mind demo's inline-SVG approach.
 */
function PeopleSnippetCard({ snippet, accent, title }: { snippet: PeopleSnippet; accent: string; title: string }) {
  const { lang } = useLang();
  const W = 240;
  const H = 140;
  const cx = W / 2;
  const cy = H / 2;
  const r = 48;
  const neighbors = snippet.neighbors.slice(0, 4);
  // Distribute neighbours evenly around the centre, starting from the top.
  const placements = neighbors.map((nb, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(neighbors.length, 1)) * Math.PI * 2;
    return { ...nb, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
  return (
    <div className="mb-1.5 rounded-xl bg-[#0A1230]/70 border border-white/10 p-2.5" data-testid="people-snippet">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: accent }}>{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={tStr(snippet.center.label, lang)}>
        {placements.map((p, i) => (
          <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={accent} strokeOpacity={0.45} strokeWidth={1} />
        ))}
        {placements.map((p, i) => (
          <g key={`n${i}`}>
            <circle cx={p.x} cy={p.y} r={5} fill="#0A1230" stroke={accent} strokeWidth={1.5} />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={9}>
              {tStr(p.node.label, lang).slice(0, 18)}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r={11} fill={accent} />
        <text x={cx} y={cy + 22} textAnchor="middle" fill="white" fontSize={10} fontWeight={700}>
          {tStr(snippet.center.label, lang).slice(0, 22)}
        </text>
      </svg>
    </div>
  );
}

function ChatInput({ disabled, onSend, placeholder, sendLabel, accent }: { disabled: boolean; onSend: (t: string) => void; placeholder: string; sendLabel: string; accent: string }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  };
  return (
    <form onSubmit={submit} className="border-t border-white/10 px-3 py-3 flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 bg-white/5 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
      />
      <button type="submit" disabled={disabled || !value.trim()} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[#0A1230] text-xs font-bold disabled:opacity-40" style={{ background: accent }} aria-label={sendLabel}>
        <Send size={12} />
        <span className="hidden sm:inline">{sendLabel}</span>
      </button>
    </form>
  );
}
