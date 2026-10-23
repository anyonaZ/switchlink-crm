import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, t } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { accountScope } from "@/lib/permissions";
import { Empty, PageHeader, Section } from "@/components/ui/Page";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import UploadForm from "./UploadForm";

export const metadata = { title: "Statements" };

export default async function StatementsPage() {
  const me = await requireRole(["ADMIN"]);
  const merchants = await db
    .select({ id: t.accounts.id, name: t.accounts.name, pesi: t.accounts.pesiAccountNo })
    .from(t.accounts)
    .where(and(accountScope(me), inArray(t.accounts.kind, ["MERCHANT", "INDIVIDUAL"])))
    .orderBy(t.accounts.name);
  const uploader = alias(t.users, "uploader");
  const uploads = await db
    .select({ u: t.statementUploads, accountName: t.accounts.name, by: uploader.name })
    .from(t.statementUploads)
    .innerJoin(t.accounts, eq(t.accounts.id, t.statementUploads.accountId))
    .leftJoin(uploader, eq(uploader.id, t.statementUploads.uploadedBy))
    .where(and(accountScope(me), or(isNotNull(t.statementUploads.accountId))))
    .orderBy(desc(t.statementUploads.createdAt))
    .limit(40);

  return (
    <div className="space-y-6">
      <PageHeader title="Statements" subtitle="Upload Pesi statements to record Quick Finance draws." />
      <div className="card p-4">
        <UploadForm merchants={merchants} />
      </div>
      <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
        <p className="font-medium">How draws are counted</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Each payment that takes the balance below zero counts as a QF disbursement for the part below zero.</li>
          <li>Charges and fees are never counted. A reversed payment cancels its draw.</li>
          <li>Lines already uploaded are skipped, so overlapping statements are safe.</li>
          <li>If any running balance doesn&apos;t add up, the whole statement is rejected.</li>
        </ul>
      </div>
      <Section title="Recent uploads">
        {uploads.length === 0 ? (
          <Empty>No statements uploaded yet.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {uploads.map(({ u, accountName, by }) => (
              <li key={u.id} className="px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/accounts/${u.accountId}?tab=money`} className="truncate font-medium text-ink">
                    {accountName}
                  </Link>
                  <span className={`badge ${u.accepted ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{u.accepted ? "Saved" : "Rejected"}</span>
                </div>
                {u.accepted ? (
                  <p className="mt-0.5 text-slate-600">
                    {u.linesNew} new of {u.linesTotal} lines · {u.drawsNew} draw{u.drawsNew === 1 ? "" : "s"} · {formatMoney(u.drawsAmountNew, { dash: false })}
                    {u.reversalsNew > 0 && ` · ${u.reversalsNew} reversal${u.reversalsNew === 1 ? "" : "s"} (−${formatMoney(u.reversedAmountNew, { dash: false })})`}
                    {u.periodFrom && u.periodTo ? ` · ${formatDate(u.periodFrom)} to ${formatDate(u.periodTo)}` : ""}
                  </p>
                ) : (
                  <p className="mt-0.5 text-red-700">{u.message}</p>
                )}
                {u.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                    {u.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(u.createdAt)} · {by ?? "—"} · {u.fileName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
