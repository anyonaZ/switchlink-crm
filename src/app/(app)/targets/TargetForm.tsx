"use client";

import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { setWeeklyTarget } from "@/lib/actions/targets";
import type { TargetValues } from "@/lib/targets";

/** This week's targets. After a first, required entry it goes on to the dashboard. */
export default function TargetForm({ initial, redirectTo }: { initial: TargetValues | null; redirectTo?: string }) {
  const v = (k: keyof TargetValues) => (initial ? String(initial[k]) : "");
  return (
    <ActionForm action={setWeeklyTarget} resetOnSuccess={false} redirectTo={redirectTo}>
      <p className="text-sm text-slate-600">How many accounts will you close this week, and how much will you disburse?</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Individuals" name="individuals">
          <input id="individuals" name="individuals" inputMode="numeric" pattern="\d*" defaultValue={v("individuals")} placeholder="0" className="input" />
        </Field>
        <Field label="Merchants" name="merchants">
          <input id="merchants" name="merchants" inputMode="numeric" pattern="\d*" defaultValue={v("merchants")} placeholder="0" className="input" />
        </Field>
        <Field label="Corporates" name="corporates">
          <input id="corporates" name="corporates" inputMode="numeric" pattern="\d*" defaultValue={v("corporates")} placeholder="0" className="input" />
        </Field>
      </div>
      <Field label="Disbursement target (KES)" name="disbursement" hint="All products together: Quick Finance, SNPL and Salary Advance.">
        <input id="disbursement" name="disbursement" inputMode="decimal" defaultValue={v("disbursement")} placeholder="0" className="input" />
      </Field>
      <p className="text-xs text-slate-500">You can change these today only. After that they&apos;re locked for the week.</p>
      <Submit>Save my targets</Submit>
    </ActionForm>
  );
}
