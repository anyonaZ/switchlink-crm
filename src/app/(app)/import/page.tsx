import { and, asc, eq, ne } from "drizzle-orm";
import { Download } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/Page";
import { IMPORT_COLUMNS } from "@/lib/import/accounts";
import ImportForm from "./ImportForm";

export const metadata = { title: "Bulk upload" };

export default async function ImportPage() {
  const me = await requireRole(["ADMIN"]);
  const people = await db
    .select({ id: t.users.id, name: t.users.name, role: t.users.role })
    .from(t.users)
    .where(and(eq(t.users.status, "ACTIVE"), ne(t.users.id, me.id)))
    .orderBy(asc(t.users.name));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Bulk upload"
        subtitle="Add many merchant and individual accounts at once from a spreadsheet."
        actions={
          <a href="/api/import/template" className="btn-secondary btn-sm">
            <Download size={16} /> Template
          </a>
        }
      />
      <ImportForm people={people} />
      <details className="card p-4 text-sm">
        <summary className="cursor-pointer font-medium text-ink">Columns the upload understands</summary>
        <ul className="mt-2 space-y-1 text-slate-600">
          {IMPORT_COLUMNS.map((c) => (
            <li key={c.key}>
              <span className="font-medium text-ink">{c.label}</span>
              {c.key === "type" && " (Merchant or Individual; not needed if you choose the type for the whole file)"}
              {c.key === "name" && " (required)"}
              {c.key === "phone" && " (required for individuals; 0712…, 712…, +254712… all work)"}
              {c.key === "pesi" && " (4 digits, optional)"}
              {c.key === "assignTo" && " (email or full name of an active user; blank uses the default below)"}
              <span className="text-slate-400"> · also read from: {c.aliases.slice(1, 4).join(", ")}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-slate-500">
          Rows already in the CRM (same name, Pesi number, or an individual&apos;s phone) are skipped, so uploading the same file twice is safe. No GPS location is recorded for uploaded accounts.
          Individuals you upload are Active straight away (you are verifying them); merchants start in Ongoing engagement.
        </p>
      </details>
    </div>
  );
}
