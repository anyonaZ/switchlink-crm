"use client";

import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { updateMyName } from "@/lib/actions/auth";

export default function NameForm({ name }: { name: string }) {
  return (
    <ActionForm action={updateMyName} resetOnSuccess={false} closeOnSuccess={false}>
      <Field label="Your name" name="name" hint="Shown to your team and on reports.">
        <input id="name" name="name" defaultValue={name} required minLength={2} maxLength={120} autoComplete="name" className="input" />
      </Field>
      <Submit>Save name</Submit>
    </ActionForm>
  );
}
