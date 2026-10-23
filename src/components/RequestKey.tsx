"use client";

import { useEffect, useRef } from "react";

/**
 * A hidden random key for forms that record money. The server records the
 * submission once per key (src/lib/idempotency.ts), so a double tap or a
 * resend after a dropped signal can't save it twice. A fresh key is made after
 * every successful save (when the form resets).
 */
export default function RequestKey({ name = "request_key" }: { name?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const fresh = () => {
      input.value = crypto.randomUUID();
    };
    fresh();
    const form = input.form;
    // Runs after the browser's own reset, which would otherwise restore the empty default.
    const onReset = () => setTimeout(fresh, 0);
    form?.addEventListener("reset", onReset);
    return () => form?.removeEventListener("reset", onReset);
  }, []);
  return <input ref={ref} type="hidden" name={name} defaultValue="" />;
}
