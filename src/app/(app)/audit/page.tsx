import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Empty, PageHeader } from "@/components/ui/Page";
import { formatDateTime } from "@/lib/format";
import { AUDIT_PAGE_SIZE, auditActions, auditPage, parseAuditFilters } from "@/lib/audit-view";
import { detailSummary } from "@/lib/audit-redact";

export const metadata = { title: "Audit log" };

const entityHref = (entity: string, id: string | null) =>
  !id ? null : entity === "account" ? `/accounts/${id}` : entity === "user" ? `/users` : null;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["ADMIN"]);
  const f = parseAuditFilters(await searchParams);
  const [{ rows, hasMore }, actions, people] = await Promise.all([
    auditPage(f),
    auditActions(),
    db.select({ id: t.users.id, name: t.users.name }).from(t.users).orderBy(asc(t.users.name)),
  ]);
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...patch })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const page = f.page ?? 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        subtitle="Who did what, and when. Sensitive values (phones, emails, PINs, hashes) are masked."
        actions={
          <a href={`/api/audit/csv?${qs({ page: undefined })}`} className="btn-secondary btn-sm">
            Export CSV
          </a>
        }
      />
      <form className="card grid grid-cols-2 gap-3 p-4 md:grid-cols-5" method="get">
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="action">Action</label>
          <select id="action" name="action" defaultValue={f.action ?? ""} className="input">
            <option value="">All actions</option>
            {[...new Set(actions.map((a) => a.action.split(".")[0]))].map((g) => (
              <option key={g} value={`${g}.`}>{g}.*</option>
            ))}
            {actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.n})
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="actor">By</label>
          <select id="actor" name="actor" defaultValue={f.actor ?? ""} className="input">
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="entity">Record id</label>
          <input id="entity" name="entity" defaultValue={f.entity ?? ""} placeholder="account / user id" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={f.from ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={f.to ?? ""} className="input" />
        </div>
        <div className="col-span-2 flex gap-2 md:col-span-5">
          <button className="btn-primary btn-sm">Filter</button>
          <Link href="/audit" className="btn-ghost btn-sm">Clear</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty>No audit entries match.</Empty>
      ) : (
        <ul className="card divide-y divide-slate-100 text-sm" data-testid="audit-list">
          {rows.map((r) => {
            const href = entityHref(r.entity, r.entityId);
            return (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-mono text-xs font-semibold text-ink">{r.action}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(r.at, true)}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  {r.actorName ?? (r.actorId ? "Deleted user" : "System")} · {r.entity}
                  {r.entityId && (
                    <>
                      {" "}
                      {href ? (
                        <Link href={href} className="font-mono text-brand-700 underline">{r.entityId.slice(0, 8)}</Link>
                      ) : (
                        <span className="font-mono">{r.entityId.slice(0, 8)}</span>
                      )}
                    </>
                  )}
                </p>
                {r.detail != null && <p className="mt-0.5 break-words text-xs text-slate-500">{detailSummary(r.detail)}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between text-sm">
        {page > 1 ? <Link href={`/audit?${qs({ page: page - 1 })}`} className="btn-ghost btn-sm">← Newer</Link> : <span />}
        <span className="text-xs text-slate-500">
          Page {page} · {AUDIT_PAGE_SIZE} per page
        </span>
        {hasMore ? <Link href={`/audit?${qs({ page: page + 1 })}`} className="btn-ghost btn-sm">Older →</Link> : <span />}
      </div>
    </div>
  );
}
