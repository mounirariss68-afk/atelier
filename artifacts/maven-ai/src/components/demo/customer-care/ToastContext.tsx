import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, AlertTriangle, X } from "lucide-react";

export type ToastType = "success" | "info" | "warning" | "error";

interface Toast { id: number; type: ToastType; message: string }

interface ToastCtxValue { toast: (message: string, type?: ToastType) => void }

const Ctx = createContext<ToastCtxValue>({ toast: () => {} });

const COLORS: Record<ToastType, { border: string; icon: string }> = {
  success: { border: "border-l-emerald-500", icon: "text-emerald-500" },
  info: { border: "border-l-[#5BA98A]", icon: "text-[#5BA98A]" },
  warning: { border: "border-l-amber-500", icon: "text-amber-500" },
  error: { border: "border-l-red-500", icon: "text-red-500" },
};

const ICONS: Record<ToastType, typeof Check> = {
  success: Check, info: Info, warning: AlertTriangle, error: AlertTriangle,
};

export function CareToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, type, message }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 end-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const c = COLORS[t.type];
            const Icon = ICONS[t.type];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className={`pointer-events-auto min-w-[260px] max-w-sm shadow-lg rounded-lg bg-white border border-gray-100 border-l-4 ${c.border} px-4 py-3 flex items-start gap-3`}
              >
                <Icon size={16} className={`${c.icon} flex-shrink-0 mt-0.5`} />
                <p className="text-xs text-gray-700 flex-1 leading-relaxed">{t.message}</p>
                <button onClick={() => dismiss(t.id)} className="text-gray-300 hover:text-gray-500"><X size={12} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useCareToast() { return useContext(Ctx); }
