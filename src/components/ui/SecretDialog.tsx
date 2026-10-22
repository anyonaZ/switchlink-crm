"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Share2 } from "lucide-react";
import type { Secret } from "@/lib/action-result";

const Ctx = createContext<(s: Secret) => void>(() => {});
export const useShowSecret = () => useContext(Ctx);

/** Copies text, with a fallback for browsers that block the clipboard API (e.g. plain http). */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {}
    ta.remove();
    return done;
  }
}

/**
 * Shows a temporary password (or similar) until the person closes it.
 * Tapping the backdrop does nothing, so it can't be lost by accident.
 */
export function SecretProvider({ children }: { children: React.ReactNode }) {
  const [secret, setSecret] = useState<Secret | null>(null);
  const show = useCallback((s: Secret) => setSecret(s), []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </Ctx.Provider>
  );
}

function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  const [copied, setCopied] = useState<"value" | "all" | null>(null);
  const [failed, setFailed] = useState(false);
  const valueRef = useRef<HTMLDivElement>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async (what: "value" | "all") => {
    const ok = await copyText(what === "value" ? secret.value : secret.shareText ?? secret.value);
    setFailed(!ok);
    if (ok) setCopied(what);
    else {
      // Couldn't copy: select the password so a long-press / Ctrl+C works.
      const sel = window.getSelection();
      const range = document.createRange();
      if (valueRef.current && sel) {
        range.selectNodeContents(valueRef.current);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };
  const share = async () => {
    try {
      await navigator.share({ text: secret.shareText ?? secret.value });
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="secret-title">
      <div className="w-full max-w-md animate-fade-in rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <KeyRound size={18} />
          </span>
          <h2 id="secret-title" className="text-lg font-semibold text-ink">
            {secret.title}
          </h2>
        </div>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">{secret.label}</p>
        <div className="mt-1 flex items-center gap-2 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 p-3">
          <div ref={valueRef} className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-lg font-semibold text-ink sm:text-xl" data-testid="secret-value">
            {secret.value}
          </div>
          <button type="button" onClick={() => copy("value")} className="btn-primary btn-sm shrink-0" aria-label={`Copy ${secret.label.toLowerCase()}`}>
            {copied === "value" ? <Check size={16} /> : <Copy size={16} />}
            {copied === "value" ? "Copied" : "Copy"}
          </button>
        </div>
        {failed && <p className="mt-1 text-xs text-amber-700">Couldn&apos;t copy automatically. The password is selected: long-press or press Ctrl+C to copy it.</p>}

        {secret.details && (
          <dl className="mt-3 space-y-1 text-sm">
            {secret.details.map((d) => (
              <div key={d.label} className="flex justify-between gap-3">
                <dt className="text-slate-500">{d.label}</dt>
                <dd className="select-all break-all text-right font-medium text-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {secret.note && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{secret.note}</p>}

        <div className="mt-4 grid gap-2">
          {secret.shareText &&
            (canShare ? (
              <button type="button" onClick={share} className="btn-secondary w-full">
                <Share2 size={16} /> Share sign-in details
              </button>
            ) : (
              <button type="button" onClick={() => copy("all")} className="btn-secondary w-full">
                {copied === "all" ? <Check size={16} /> : <Copy size={16} />}
                {copied === "all" ? "Copied sign-in details" : "Copy sign-in details"}
              </button>
            ))}
          <button type="button" onClick={onClose} className="btn-primary w-full">
            I&apos;ve saved it
          </button>
        </div>
      </div>
    </div>
  );
}
