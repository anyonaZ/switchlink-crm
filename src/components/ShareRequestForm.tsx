"use client";

import { useState } from "react";
import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action-result";

/** Same rule as equalPercents() in permissions.ts (kept here so the browser doesn't load server code). */
const equal = (n: number) => {
  const base = Math.floor(10000 / n);
  return Array.from({ length: n }, (_, i) => (base + (i < 10000 - base * n ? 1 : 0)) / 100);
};

/** Pick the BDOs a corporate was closed with and how each disbursement is split. */
export default function ShareRequestForm({
  action,
  me,
  bdos,
}: {
  /** requestShare bound to the account (bound on the server). */
  action: (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;
  me: { id: string; name: string };
  bdos: { id: string; name: string; teamName: string | null }[];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [percent, setPercent] = useState<Record<string, string>>({ [me.id]: "100" });
  const people = [me, ...bdos.filter((b) => picked.includes(b.id))];
  const total = people.reduce((s, p) => s + Math.round(Number(percent[p.id] || 0) * 100), 0) / 100;

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    const ids = [me.id, ...next];
    const shares = equal(ids.length);
    setPercent(Object.fromEntries(ids.map((x, i) => [x, String(shares[i])])));
  };

  return (
    <ActionForm action={action}>
      <p className="text-sm text-slate-600">
        Closed this corporate with other BDOs? Once your Team Leader and an Admin approve, every disbursement on it is split between you automatically.
      </p>
      <fieldset>
        <legend className="label">BDOs you closed it with</legend>
        {bdos.length === 0 ? (
          <p className="text-sm text-slate-500">There are no other active BDOs.</p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {bdos.map((b) => (
              <label key={b.id} className="flex min-h-[44px] items-center gap-3 rounded-md px-2 text-sm active:bg-slate-50">
                <input type="checkbox" name="member" value={b.id} checked={picked.includes(b.id)} onChange={() => toggle(b.id)} className="h-5 w-5 rounded border-slate-300" />
                <span className="flex-1">
                  {b.name}
                  {b.teamName && <span className="ml-1 text-xs text-slate-500">· {b.teamName}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {picked.length > 0 && (
        <fieldset>
          <legend className="label">Split of each disbursement</legend>
          <div className="space-y-2">
            {people.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <label htmlFor={`percent_${p.id}`} className="flex-1 truncate text-sm">
                  {p.id === me.id ? `${p.name} (you)` : p.name}
                </label>
                <div className="relative w-28">
                  <input
                    id={`percent_${p.id}`}
                    name={`percent_${p.id}`}
                    inputMode="decimal"
                    value={percent[p.id] ?? ""}
                    onChange={(e) => setPercent({ ...percent, [p.id]: e.target.value })}
                    className="input pr-8 text-right tabular-nums"
                    required
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
                </div>
              </div>
            ))}
          </div>
          <p className={`mt-2 text-xs ${Math.abs(total - 100) < 0.001 ? "text-slate-500" : "font-medium text-red-600"}`}>Total {total.toFixed(2)}% (must be 100%)</p>
        </fieldset>
      )}

      <Field label="Note for the approvers (optional)" name="note">
        <input id="note" name="note" maxLength={500} className="input" placeholder="e.g. Lindsey brought the HR contact, I closed the MOU" />
      </Field>
      <Submit>Send for approval</Submit>
    </ActionForm>
  );
}
