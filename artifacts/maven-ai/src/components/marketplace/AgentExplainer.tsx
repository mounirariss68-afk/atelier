import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowDown,
  Network,
  UserCheck,
  Database,
  FileOutput,
  Bot,
  Sparkles,
} from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import { getAgentCast, type AgentKind } from "@workspace/maven-content";

const KIND_LABEL: Record<AgentKind, { en: string; ar: string }> = {
  planner: { en: "Planner", ar: "مخطّط" },
  retriever: { en: "Retriever", ar: "مسترجع" },
  classifier: { en: "Classifier", ar: "مصنّف" },
  drafter: { en: "Drafter", ar: "كاتب" },
  critic: { en: "Critic", ar: "ناقد" },
  router: { en: "Router", ar: "موجِّه" },
  scorer: { en: "Scorer", ar: "مصنّف نقاط" },
  compiler: { en: "Compiler", ar: "مُجمّع" },
  monitor: { en: "Monitor", ar: "مراقب" },
};

const COPY = {
  modalLabel: { en: "How does this work?", ar: "كيف يعمل؟" },
  agents: { en: "Named cast of agents", ar: "فريق الوكلاء المسمّى" },
  topology: { en: "How they hand off", ar: "كيف يتسلّمون من بعضهم" },
  humans: { en: "Human checkpoints", ar: "نقاط القرار البشرية" },
  rationale: {
    en: "Why agents and not a single model?",
    ar: "لماذا وكلاء وليس نموذجاً واحداً؟",
  },
  reads: { en: "Reads from", ar: "يقرأ من" },
  writes: { en: "Writes", ar: "يكتب" },
  signsHere: { en: "Human signs here", ar: "البشري يوقّع هنا" },
  close: { en: "Close", ar: "إغلاق" },
  noCast: {
    en: "Agent cast is not yet documented for this tool.",
    ar: "لم يُوثَّق فريق الوكلاء لهذه الأداة بعد.",
  },
};

interface AgentExplainerProps {
  slug: string;
  open: boolean;
  onClose: () => void;
}

export default function AgentExplainer({ slug, open, onClose }: AgentExplainerProps) {
  const { lang, dir } = useLang();
  const cast = getAgentCast(slug);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-[#0E2841]/70 backdrop-blur-sm flex items-start justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={onClose}
          dir={dir}
          role="dialog"
          aria-modal="true"
          aria-label={tStr(COPY.modalLabel, lang)}
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="bg-white rounded-3xl w-full max-w-4xl my-4 sm:my-8 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-[#0E2841] text-white px-6 py-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#F5A623]/20 flex items-center justify-center flex-shrink-0">
                  <Network size={20} className="text-[#F5A623]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-0.5">
                    {tStr({ en: "Maven agentic-native", ar: "أصلي الوكلاء" }, lang)}
                  </p>
                  <h2 className="text-xl font-extrabold leading-tight">
                    {tStr(COPY.modalLabel, lang)}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={tStr(COPY.close, lang)}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {!cast ? (
              <div className="p-10 text-center text-gray-500">{tStr(COPY.noCast, lang)}</div>
            ) : (
              <div className="p-6 sm:p-8 space-y-8">
                {/* Cast list */}
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">
                    {tStr(COPY.agents, lang)}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {cast.agents.map((a) => (
                      <div
                        key={a.id}
                        className="border border-gray-200 rounded-2xl p-4 bg-gradient-to-br from-white to-gray-50"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Bot size={14} className="text-[#156082]" />
                          <span className="font-bold text-[#0E2841] text-sm">
                            {tStr(a.name, lang)}
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#156082]/10 text-[#156082] ms-auto">
                            {tStr(KIND_LABEL[a.kind], lang)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed mb-2">
                          {tStr(a.role, lang)}
                        </p>
                        {a.reads && a.reads.length > 0 && (
                          <div className="flex items-start gap-1.5 mb-1">
                            <Database
                              size={11}
                              className="text-gray-400 mt-0.5 flex-shrink-0"
                            />
                            <p className="text-[11px] text-gray-500 leading-snug">
                              <span className="font-semibold">
                                {tStr(COPY.reads, lang)}:{" "}
                              </span>
                              {a.reads.map((r) => tStr(r, lang)).join(" · ")}
                            </p>
                          </div>
                        )}
                        {a.writes && a.writes.length > 0 && (
                          <div className="flex items-start gap-1.5">
                            <FileOutput
                              size={11}
                              className="text-gray-400 mt-0.5 flex-shrink-0"
                            />
                            <p className="text-[11px] text-gray-500 leading-snug">
                              <span className="font-semibold">
                                {tStr(COPY.writes, lang)}:{" "}
                              </span>
                              {a.writes.map((w) => tStr(w, lang)).join(" · ")}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {/* Topology diagram (vertical flow) */}
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">
                    {tStr(COPY.topology, lang)}
                  </p>
                  <div className="flex flex-col items-stretch gap-1">
                    {cast.flowOrder.map((step, i) => {
                      const isLast = i === cast.flowOrder.length - 1;
                      if (step.kind === "agent") {
                        const a = cast.agents.find((x) => x.id === step.id);
                        if (!a) return null;
                        const edge = cast.edges.find((e) => {
                          if (e.from !== step.id) return false;
                          // find next agent step
                          for (let j = i + 1; j < cast.flowOrder.length; j++) {
                            const next = cast.flowOrder[j];
                            if (next && next.kind === "agent" && next.id === e.to) return true;
                            if (next && next.kind === "agent") return false;
                          }
                          return false;
                        });
                        return (
                          <div key={`step-${i}`} className="flex flex-col items-center">
                            <div className="w-full max-w-md border-2 border-[#156082] bg-white rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-sm">
                              <Bot size={14} className="text-[#156082] flex-shrink-0" />
                              <span className="font-bold text-sm text-[#0E2841]">
                                {tStr(a.name, lang)}
                              </span>
                              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#156082]/10 text-[#156082] ms-auto">
                                {tStr(KIND_LABEL[a.kind], lang)}
                              </span>
                            </div>
                            {!isLast && (
                              <div className="flex flex-col items-center py-1">
                                <ArrowDown size={14} className="text-gray-400" />
                                {edge?.label && (
                                  <span className="text-[10px] text-gray-500 italic max-w-xs text-center">
                                    {tStr(edge.label, lang)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        const h = cast.humanCheckpoints.find((x) => x.id === step.id);
                        if (!h) return null;
                        return (
                          <div key={`step-${i}`} className="flex flex-col items-center">
                            <div className="w-full max-w-md border-2 border-[#F5A623] bg-amber-50 rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-sm">
                              <UserCheck size={14} className="text-[#F5A623] flex-shrink-0" />
                              <span className="font-bold text-sm text-[#7C3D02]">
                                {tStr(h.name, lang)}
                              </span>
                              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#F5A623]/20 text-[#7C3D02] ms-auto">
                                {tStr(COPY.signsHere, lang)}
                              </span>
                            </div>
                            {!isLast && (
                              <div className="py-1">
                                <ArrowDown size={14} className="text-gray-400" />
                              </div>
                            )}
                          </div>
                        );
                      }
                    })}
                  </div>
                </section>

                {/* Human checkpoints detail */}
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                    {tStr(COPY.humans, lang)}
                  </p>
                  <div className="space-y-2">
                    {cast.humanCheckpoints.map((h) => (
                      <div
                        key={h.id}
                        className="border border-amber-200 rounded-xl p-3 bg-amber-50/60 flex items-start gap-3"
                      >
                        <UserCheck
                          size={16}
                          className="text-[#F5A623] flex-shrink-0 mt-0.5"
                        />
                        <div>
                          <p className="font-bold text-sm text-[#7C3D02] mb-0.5">
                            {tStr(h.name, lang)}
                          </p>
                          <p className="text-xs text-gray-700 leading-relaxed">
                            {tStr(h.decision, lang)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Rationale */}
                <section className="bg-[#0E2841] rounded-2xl p-5 text-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={14} className="text-[#F5A623]" />
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#F5A623]">
                      {tStr(COPY.rationale, lang)}
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-100">
                    {tStr(cast.rationale, lang)}
                  </p>
                </section>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
