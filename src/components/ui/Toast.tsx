"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type Toast = { id: number; tone: "success" | "error"; text: string };
const Ctx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    // A success replaces any earlier errors: they no longer apply.
    setToasts((ts) => [...(tone === "success" ? ts.filter((x) => x.tone === "success") : ts).slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6 md:top-auto md:items-end md:px-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "bg-red-700 text-white" : "bg-ink text-white"
            }`}
          >
            {t.tone === "error" ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
