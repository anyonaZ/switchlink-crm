"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { commitImport, previewImport, type CommitResult, type PreviewResult } from "@/lib/actions/import";
import { useToast } from "@/components/ui/Toast";
import { KIND_LABELS, ROLE_LABELS } from "@/lib/labels";

export default function ImportForm({ people }: { people: { id: string; name: string; role: keyof typeof ROLE_LABELS }[] }) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const toast = useToast();
  const router = useRouter();

  async function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy("preview");
    setDone(null);
    try {
      const res = await previewImport(new FormData(e.currentTarget));
      setPreview(res);
      if (!res.ok) toast("error", res.error ?? "The file couldn't be checked.");
    } catch {
      toast("error", "Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  async function onCommit() {
    if (!preview?.token || busy) return;
    setBusy("commit");
    try {
      const res = await commitImport(preview.token);
      if (res.ok) {
        setDone(res);
        setPreview(null);
        toast("success", `${res.added} account${res.added === 1 ? "" : "s"} added.`);
        router.refresh();
      } else toast("error", res.error ?? "Nothing was added.");
    } catch {
      toast("error", "Couldn't reach the server. Nothing was added; try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onPreview} className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="file">Spreadsheet (.xlsx or .csv)</label>
          <input id="file" name="file" type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="fixed_kind">Accounts in this file are</label>
            <select id="fixed_kind" name="fixed_kind" className="input" defaultValue="">
              <option value="">Read from the Type column</option>
              <option value="MERCHANT">All merchants</option>
              <option value="INDIVIDUAL">All individuals</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="owner_id">Assign rows without &quot;Assign to&quot; to</label>
            <select id="owner_id" name="owner_id" className="input" defaultValue="">
              <option value="">Me</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({ROLE_LABELS[p.role]})
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" disabled={!!busy} className="btn-primary w-full">
          <Upload size={18} /> {busy === "preview" ? "Checking the file…" : "Check file"}
        </button>
        <p className="text-xs text-slate-500">Nothing is saved until you confirm on the next step.</p>
      </form>

      {preview?.ok && (
        <div className="space-y-3">
          <div className="card p-4 text-sm">
            <p className="font-medium text-ink">{preview.fileName}</p>
            <p className="mt-1 text-slate-600">
              {preview.total} row{preview.total === 1 ? "" : "s"} read · <strong className="text-green-700">{preview.ready!.length} ready</strong> ·{" "}
              <span className={preview.skipped!.length ? "text-amber-800" : ""}>{preview.skipped!.length} will be skipped</span>
            </p>
            {!!preview.unknownColumns?.length && <p className="mt-1 text-xs text-slate-500">Columns ignored: {preview.unknownColumns.join(", ")}</p>}
            <button type="button" onClick={onCommit} disabled={!!busy || !preview.ready!.length} className="btn-primary mt-3 w-full">
              {busy === "commit" ? "Adding accounts…" : `Add ${preview.ready!.length} account${preview.ready!.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {preview.skipped!.length > 0 && (
            <div className="card overflow-hidden text-sm">
              <p className="flex items-center gap-1.5 border-b border-slate-100 bg-amber-50 px-4 py-2 font-medium text-amber-900">
                <AlertTriangle size={16} /> Skipped rows (fix them in the file and upload again)
              </p>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {preview.skipped!.map((s) => (
                  <li key={`${s.row}-${s.name}`} className="px-4 py-2">
                    <span className="text-slate-500">Row {s.row}</span> · <span className="font-medium text-ink">{s.name || "—"}</span> · {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.ready!.length > 0 && (
            <div className="card overflow-hidden text-sm">
              <p className="border-b border-slate-100 px-4 py-2 font-medium text-ink">Ready to add</p>
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                {preview.ready!.map((r) => (
                  <li key={r.row} className="px-4 py-2">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-ink">{r.name}</span>
                      <span className="badge shrink-0 bg-slate-100 text-slate-700">{KIND_LABELS[r.kind]}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      Row {r.row}
                      {r.phone ? ` · ${r.phone}` : ""}
                      {r.pesi ? ` · Pesi ${r.pesi}` : ""} · {r.owner}
                    </span>
                    {r.warnings.map((w) => (
                      <span key={w} className="block text-xs text-amber-800">⚠ {w} (kept as a note)</span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {done && (
        <div className="card p-4 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-green-800">
            <CheckCircle2 size={18} /> {done.added} added: {done.merchants} merchant{done.merchants === 1 ? "" : "s"}, {done.individuals} individual{done.individuals === 1 ? "" : "s"}.
          </p>
          {!!done.skipped?.length && <p className="mt-1 text-amber-800">{done.skipped.length} skipped because they were added by someone else meanwhile.</p>}
          <Link href="/accounts" className="btn-secondary mt-3 w-full">
            View accounts
          </Link>
        </div>
      )}
    </div>
  );
}
