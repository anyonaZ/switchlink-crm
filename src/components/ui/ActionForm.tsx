"use client";

import { createContext, startTransition, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/Toast";
import { useShowSecret } from "@/components/ui/SecretDialog";
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
  // The save is called directly and its result handled the moment the server
  // answers. (With useActionState the result waited for React to finish
  // re-rendering the refreshed page, which now and then never happened and
  // left the form stuck on "Saving…" even though the save had gone through.)
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const toast = useToast();
  const showSecret = useShowSecret();
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

  async function submit(data: FormData) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    let res: ActionResult | undefined;
    try {
      res = await action(state, data);
    } catch (e) {
      // A redirect (e.g. after signing in) is handled by Next; anything else is a real failure.
      if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
      res = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    } finally {
      busy.current = false;
      setPending(false);
    }
    if (!res) return; // the action navigated away
    setState(res);
    if (res.ok) {
      if (res.secret) showSecret(res.secret);
      else if (res.message) toast("success", res.message);
      if (resetOnSuccess) ref.current?.reset();
      if (closeOnSuccess) close();
      if (redirectTo) router.push(redirectTo.replace("{id}", res.id ?? ""));
      else startTransition(() => router.refresh());
    } else {
      toast("error", res.error);
    }
  }

  return (
    // Submitted by hand (not via the form's `action` prop) so React doesn't
    // clear what the person typed when the save fails.
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
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
