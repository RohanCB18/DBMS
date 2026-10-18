import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, Info } from "lucide-react";

type Tone = "ok" | "bad" | "info";
interface Toast { id: number; tone: Tone; text: ReactNode }

const Ctx = createContext<(tone: Tone, text: ReactNode) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Tone, text: ReactNode) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const icon = { ok: <CheckCircle2 className="h-5 w-5 text-ok" />, bad: <XCircle className="h-5 w-5 text-bad" />, info: <Info className="h-5 w-5 text-sky-300" /> };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-ink-600 bg-ink-850/95 px-4 py-3 text-[15px] shadow-xl backdrop-blur">
              <span className="mt-0.5">{icon[t.tone]}</span>
              <div className="min-w-0 break-words">{t.text}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
