import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, AlertTriangle, X } from "lucide-react";

export type ToastType = "success" | "info" | "warning" | "error";
interface Toast { id: number; type: ToastType; message: string }

const Ctx = createContext<{ toast: (m: string, t?: ToastType) => void }>({ toast: () => {} });

const COLOR: Record<ToastType, { border: string; icon: string }> = {
  success: { border: "border-l-emerald-500", icon: "text-emerald-500" },
  info:    { border: "border-l-[#5BA98A]",   icon: "text-[#5BA98A]" },
  warning: { border: "border-l-amber-500",   icon: "text-amber-500" },
  error:   { border: "border-l-red-500",     icon: "text-red-500" },
};
const ICONS: Record<ToastType, typeof Check> = { success: Check, info: Info, warning: AlertTriangle, error: AlertTriangle };

export function CscToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setList((p) => [...p, { id, type, message }]);
    setTimeout(() => setList((p) => p.filter((t) => t.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 end-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {list.map((t) => {
            const c = COLOR[t.type];
            const I = ICONS[t.type];
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                className={`pointer-events-auto bg-white shadow-lg border border-gray-100 border-l-4 ${c.border} px-4 py-3 rounded-lg flex items-start gap-3 min-w-[260px] max-w-sm`}>
                <I size={16} className={`${c.icon} mt-0.5 flex-shrink-0`} />
                <p className="text-xs text-gray-700 flex-1 leading-relaxed">{t.message}</p>
                <button onClick={() => setList((p) => p.filter((x) => x.id !== t.id))} className="text-gray-300 hover:text-gray-500"><X size={12} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useCscToast = () => useContext(Ctx);
