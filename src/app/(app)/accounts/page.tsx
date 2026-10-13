import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { ChevronRight, Plus, Search } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { accountScope, isSupervisor, userScope } from "@/lib/permissions";
import { PageHeader, Empty } from "@/components/ui/Page";
import { KindBadge, StatusBadge } from "@/components/ui/Badges";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/labels";

export const metadata = { title: "Accounts" };
const PAGE = 30;
type SP = { q?: string; kind?: string; status?: string; agent?: string; n?: string };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const kind = sp.kind && sp.kind in KIND_LABELS ? (sp.kind as keyof typeof KIND_LABELS) : undefined;
  const status = sp.status && sp.status in STATUS_LABELS ? (sp.status as keyof typeof STATUS_LABELS) : undefined;
  const limit = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), 300);

  const where: SQL[] = [accountScope(me)];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(t.accounts.name, like), ilike(t.accounts.phone, like), eq(t.accounts.pesiAccountNo, q))!);
  }
  if (kind) where.push(eq(t.accounts.kind, kind));
  if (status) where.push(eq(t.accounts.status, status));
  if (sp.agent && isSupervisor(me)) where.push(eq(t.accounts.ownerId, sp.agent));

  const [rows, agents] = await Promise.all([
    db
      .select({
        id: t.accounts.id,
        name: t.accounts.name,
        kind: t.accounts.kind,
        status: t.accounts.status,
        pesi: t.accounts.pesiAccountNo,
        ownerName: t.users.name,
        createdAt: t.accounts.createdAt,
      })
      .from(t.accounts)
      .leftJoin(t.users, eq(t.users.id, t.accounts.ownerId))
      .where(and(...where))
      .orderBy(desc(t.accounts.createdAt))
      .limit(limit + 1),
    !isSupervisor(me)
      ? Promise.resolve([])
      : db.select({ id: t.users.id, name: t.users.name }).from(t.users).where(and(userScope(me), sql`${t.users.role} <> 'ADMIN'`)).orderBy(t.users.name),
  ]);
  const more = rows.length > limit;
  const list = rows.slice(0, limit);

  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const next = { q, kind, status, agent: sp.agent, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/accounts${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle={me.role === "AGENT" ? "Your clients" : me.role === "BDO" ? "Yours and your agents' clients" : me.role === "TEAM_LEADER" ? "Your team's clients" : "All clients"}
        actions={
          <Link href="/accounts/new" className="btn-primary hidden md:inline-flex">
            <Plus size={18} /> New
          </Link>
        }
      />

      <form className="mb-3 flex gap-2" role="search">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} type="search" placeholder="Name, phone or Pesi no." className="input pl-10" />
        </div>
        {kind && <input type="hidden" name="kind" value={kind} />}
        {status && <input type="hidden" name="status" value={status} />}
        {sp.agent && <input type="hidden" name="agent" value={sp.agent} />}
        <button className="btn-secondary">Search</button>
      </form>

      <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link href={link({ kind: undefined })} className={!kind ? "chip-on" : "chip-off"}>
          All
        </Link>
        {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => (
          <Link key={k} href={link({ kind: k })} className={kind === k ? "chip-on" : "chip-off"}>
            {KIND_LABELS[k]}s
          </Link>
        ))}
      </div>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link href={link({ status: undefined })} className={!status ? "chip-on" : "chip-off"}>
          Any status
        </Link>
        {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => (
          <Link key={s} href={link({ status: s })} className={status === s ? "chip-on" : "chip-off"}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {agents.length > 0 && (
        <form className="mb-4 flex gap-2">
          {q && <input type="hidden" name="q" value={q} />}
          {kind && <input type="hidden" name="kind" value={kind} />}
          {status && <input type="hidden" name="status" value={status} />}
          <select name="agent" defaultValue={sp.agent ?? ""} className="input flex-1" aria-label="Agent">
            <option value="">Every agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn-secondary">Filter</button>
        </form>
      )}

      {list.length === 0 ? (
        <Empty>
          No accounts{q ? ` match "${q}"` : " yet"}.{" "}
          <Link href="/accounts/new" className="font-medium text-brand-600">
            Register one
          </Link>
        </Empty>
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {list.map((a) => (
            <li key={a.id}>
              <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50 md:hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{a.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <KindBadge kind={a.kind} />
                    <StatusBadge status={a.status} />
                    {a.pesi && <span className="text-xs text-slate-500">Pesi {a.pesi}</span>}
                    {isSupervisor(me) && <span className="text-xs text-slate-500">· {a.ownerName ?? "Unassigned"}</span>}
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <Link href={link({ n: String(limit + PAGE) } as Partial<SP>)} className="btn-secondary mt-3 w-full" scroll={false}>
          Show more
        </Link>
      )}
    </div>
  );
}
