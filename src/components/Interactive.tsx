"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/Toast";
import { changeStage } from "@/lib/actions/crm";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/labels";

/** Stage dropdown that saves on change, with an instant (optimistic) update. */
export function StageSelect({ opportunityId, stage }: { opportunityId: string; stage: Stage }) {
  const [value, setValue] = useState(stage);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <select
      aria-label="Stage"
      value={value}
      disabled={pending}
      className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
      onChange={(e) => {
        const next = e.target.value as Stage;
        const prev = value;
        setValue(next);
        start(async () => {
          const res = await changeStage(opportunityId, next);
          if (res.ok) toast("success", res.message ?? "Saved.");
          else {
            setValue(prev);
            toast("error", res.error);
          }
        });
      }}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

/** A button that runs a server action after an optional confirm, then toasts the result. */
export function ActionButton({
  run,
  children,
  confirmText,
  prompt,
  className = "btn-secondary btn-sm",
}: {
  run: (input?: string) => Promise<ActionResult>;
  children: React.ReactNode;
  confirmText?: string;
  /** Ask for a short text (e.g. a reason) and pass it to `run`. */
  prompt?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() => {
        let input: string | undefined;
        if (prompt) {
          const answer = window.prompt(prompt);
          if (answer === null) return;
          input = answer;
        } else if (confirmText && !window.confirm(confirmText)) return;
        start(async () => {
          const res = await run(input);
          if (res.ok) {
            toast("success", res.message ?? "Done.");
            router.refresh();
          } else toast("error", res.error);
        });
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** Pre-fills a date input with today / tomorrow / next week, in Nairobi time. */
export function QuickDates({ targetId }: { targetId: string }) {
  const set = (days: number) => {
    const el = document.getElementById(targetId) as HTMLInputElement | null;
    if (!el) return;
    const d = new Date(Date.now() + days * 86400000);
    el.value = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(d);
  };
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {[
        ["Today", 0],
        ["Tomorrow", 1],
        ["In 3 days", 3],
        ["Next week", 7],
      ].map(([label, days]) => (
        <button key={label} type="button" className="chip-off !py-1 text-xs" onClick={() => set(days as number)}>
          {label}
        </button>
      ))}
    </div>
  );
}
