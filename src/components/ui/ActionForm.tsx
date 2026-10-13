"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/Toast";
import { useCloseSheet } from "@/components/ui/Sheet";

const FieldErrors = createContext<Record<string, string>>({});
const Pending = createContext(false);
export const useFieldError = (name: string) => useContext(FieldErrors)[name];

/**
 * Wraps a server action so every submit ends in a visible result: a toast
 * on success (and the sheet closes), the error inline and as a toast on
 * failure. Values the person typed are kept on failure.
 */
export default function ActionForm({
  action,
  children,
  className = "space-y-4",
  resetOnSuccess = true,
  closeOnSuccess = true,
  redirectTo,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  closeOnSuccess?: boolean;
  /** Navigate after success; `{id}` is replaced with the id the action returned. */
  redirectTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const toast = useToast();
  const close = useCloseSheet();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  // On a weak signal a save can stall. After 20 s, say so and offer a reload
  // (which shows whether it went through) rather than a resend that could duplicate it.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(id);
  }, [pending]);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast("success", state.message);
      if (resetOnSuccess) ref.current?.reset();
      if (closeOnSuccess) close();
      if (redirectTo) router.push(redirectTo.replace("{id}", state.id ?? ""));
    } else {
      toast("error", state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    // Submitted by hand (not via the form's `action` prop) so React doesn't
    // clear what the person typed when the save fails.
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <Pending.Provider value={pending}>
      <FieldErrors.Provider value={state && !state.ok ? state.fieldErrors ?? {} : {}}>
        {state && !state.ok && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}
        {children}
        {slow && (
          <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This is taking longer than usual. Check your signal.{" "}
            <button type="button" className="font-medium underline" onClick={() => window.location.reload()}>
              Reload to see if it saved
            </button>
          </div>
        )}
      </FieldErrors.Provider>
      </Pending.Provider>
    </form>
  );
}

export function Submit({ children, className = "btn-primary w-full", pendingText = "Saving…" }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const pending = useContext(Pending);
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />}
      {pending ? pendingText : children}
    </button>
  );
}

/** A labelled input/select/textarea with its inline error. */
export function Field({
  label,
  name,
  hint,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const error = useFieldError(name);
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
