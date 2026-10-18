"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";
import { X } from "lucide-react";

const CloseCtx = createContext<() => void>(() => {});
/** Lets a form inside a sheet close it after a successful save. */
export const useCloseSheet = () => useContext(CloseCtx);

/**
 * Full-height bottom sheet on phones, centred dialog on larger screens.
 * The trigger is whatever you pass as `trigger` (rendered as a button).
 */
export default function Sheet({
  trigger,
  title,
  children,
  triggerClassName = "btn-secondary",
  defaultOpen = false,
}: {
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
  triggerClassName?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="absolute inset-0 animate-fade-in bg-ink/40" onClick={() => setOpen(false)} />
          <div className="relative flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-2xl bg-white shadow-sheet md:max-h-[85vh] md:max-w-lg md:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 id={titleId} className="text-base font-semibold text-ink">
                {title}
              </h2>
              <button type="button" className="btn-ghost btn-sm -mr-2" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
              <CloseCtx.Provider value={() => setOpen(false)}>{children}</CloseCtx.Provider>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
