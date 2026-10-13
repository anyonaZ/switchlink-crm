"use client";

import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { changePassword } from "@/lib/actions/auth";

export default function ChangePasswordForm() {
  return (
    <ActionForm action={changePassword} redirectTo="/dashboard">
      <Field label="Current password" name="current">
        <input id="current" name="current" type="password" autoComplete="current-password" required className="input" />
      </Field>
      <Field label="New password" name="next" hint="At least 10 characters, with letters and numbers.">
        <input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} className="input" />
      </Field>
      <Field label="Repeat new password" name="confirm">
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" />
      </Field>
      <Submit>Save password</Submit>
    </ActionForm>
  );
}
