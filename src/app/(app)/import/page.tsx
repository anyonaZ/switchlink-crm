import { asc, eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { canAssignNewAccount } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/Page";
import { IMPORT_COLUMNS } from "@/lib/import/accounts";
import ImportForm from "./ImportForm";

export const metadata = { title: "Bulk upload" };

export default async function ImportPage() {
  const me = await requireRole(["ADMIN", "TEAM_LEADER", "BDO"]);
  // Only people this user may assign new accounts to.
  const people = (
    await db
      .select({ id: t.users.id, name: t.users.name, role: t.users.role, teamId: t.users.teamId, reportsTo: t.users.reportsTo, status: t.users.status })
      .from(t.users)
      .where(eq(t.users.status, "ACTIVE"))
      .orderBy(asc(t.users.name))
  )
    .filter((p) => p.id !== me.id && canAssignNewAccount(me, p))
    .map(({ id, name, role }) => ({ id, name, role }));
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
              {c.key === "assignTo" &&
                (me.role === "ADMIN"
                  ? " (email or full name of an active user; blank uses the default below)"
                  : me.role === "TEAM_LEADER"
                    ? " (email or full name of yourself or a BDO or Agent on your team; blank uses the default below)"
                    : " (email or full name of yourself or one of your agents; blank uses the default below)")}
              <span className="text-slate-400"> · also read from: {c.aliases.slice(1, 4).join(", ")}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-slate-500">
          Rows already in the CRM (same name, Pesi number, or an individual&apos;s phone) are skipped, so uploading the same file twice is safe. No GPS location is recorded for uploaded accounts.
          {me.role === "ADMIN"
            ? "Individuals you upload are Active straight away (you are verifying them); merchants start in Ongoing engagement."
            : "Individuals you upload wait for an Admin to verify them (Pending verification); merchants start in Ongoing engagement."}{" "}
          Individual accounts that aren&apos;t activated within 30 days are deleted automatically.
        </p>
      </details>
    </div>
  );
}
