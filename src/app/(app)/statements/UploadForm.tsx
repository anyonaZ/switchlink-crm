"use client";

import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { uploadStatement } from "@/lib/actions/statements";

export default function UploadForm({ merchants }: { merchants: { id: string; name: string; pesi: string | null }[] }) {
  return (
    <ActionForm action={uploadStatement} closeOnSuccess={false}>
      <Field label="Statement file (.xls from Pesi)" name="file">
        <input id="file" name="file" type="file" accept=".xls,application/vnd.ms-excel" required className="input py-2" />
      </Field>
      <Field label="Account" name="account_id" hint="Leave on automatic: the account is matched from the statement's account number or Paybill lines.">
        <select id="account_id" name="account_id" className="input" defaultValue="">
          <option value="">Match automatically</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.pesi ? ` (${m.pesi})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Submit pendingText="Reading statement…">Upload statement</Submit>
    </ActionForm>
  );
}
