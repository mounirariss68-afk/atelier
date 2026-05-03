import { motion, AnimatePresence } from "framer-motion";
import { UserCheck, Sparkles, X } from "lucide-react";
import type { SimCheckpoint } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

interface CheckpointModalProps {
  checkpoint: SimCheckpoint | null;
  onResolve: (optionId: string) => void;
  onDismiss: () => void;
}

export default function CheckpointModal({
  checkpoint,
  onResolve,
  onDismiss,
}: CheckpointModalProps) {
  const { lang, dir } = useLang();

  return (
    <AnimatePresence>
      {checkpoint && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onDismiss}
        >
          <motion.div
            dir={dir}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", damping: 22, stiffness: 220 }}
            className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-[#0E2841] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#F5A623]/20 flex items-center justify-center">
                  <UserCheck size={18} className="text-[#F5A623]" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                    {tStr({ en: "Human checkpoint", ar: "نقطة موافقة بشرية" }, lang)}
                  </p>
                  <p className="text-sm font-bold text-white">
                    {tStr(checkpoint.human, lang)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="text-white/60 hover:text-white"
                aria-label="Dismiss"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <h3 className="text-lg font-bold text-[#0E2841] leading-snug">
                {tStr(checkpoint.question, lang)}
              </h3>

              <div className="bg-[#F5A623]/10 border border-[#F5A623]/30 rounded-lg p-4 flex gap-3">
                <Sparkles size={16} className="text-[#F5A623] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-[#5A3000] leading-relaxed">
                  <p className="font-bold mb-1">
                    {tStr({ en: "Agent's reasoning", ar: "تفسير الوكيل" }, lang)}
                  </p>
                  <p>{tStr(checkpoint.rationale, lang)}</p>
                </div>
              </div>

              <div className="space-y-2">
                {checkpoint.options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onResolve(opt.id)}
                    className={`w-full text-left rtl:text-right px-4 py-3 rounded-lg border-2 transition-all flex items-center justify-between gap-3 ${
                      opt.recommended
                        ? "border-[#156082] bg-[#156082]/5 hover:bg-[#156082]/10"
                        : "border-gray-200 hover:border-gray-400 hover:bg-gray-50"
                    }`}
                  >
                    <span className="text-sm font-semibold text-[#0E2841]">
                      {tStr(opt.label, lang)}
                    </span>
                    {opt.recommended && (
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#156082] text-white flex-shrink-0">
                        {tStr({ en: "Recommended", ar: "موصى به" }, lang)}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                {tStr(
                  {
                    en: "The agent paused to ask. The action below will only run after you choose — that is the human-in-the-loop guarantee.",
                    ar: "توقف الوكيل ليسأل. لن يُنفَّذ الإجراء أدناه إلا بعد اختيارك — هذا هو ضمان وجود الإنسان في الحلقة.",
                  },
                  lang,
                )}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
