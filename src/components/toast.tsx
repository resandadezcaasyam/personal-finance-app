"use client";
import * as React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

type Tone = "ok" | "error";
const Ctx = React.createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => React.useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<{ id: number; message: string; tone: Tone }[]>([]);
  const push = React.useCallback((message: string, tone: Tone = "ok") => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, message, tone }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className="pointer-events-auto flex items-start gap-2 rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-lg">
            {i.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gain" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-loss" aria-hidden />}
            <span>{i.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
