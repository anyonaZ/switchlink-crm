import Link from "next/link";
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { accountScope, type Actor } from "@/lib/permissions";
import { Empty, Section, Stat } from "@/components/ui/Page";
import { ProductBadge, StageBadge } from "@/components/ui/Badges";
import { ACTIVITY_LABELS, ROLE_LABELS } from "@/lib/labels";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getCalendarPeriodRange } from "@/lib/timezone";
import { APP_TIMEZONE } from "@/lib/config";
import { bdoRollup, productTotals, periodRange } from "@/lib/reports";
import { rankLeads } from "@/lib/lead-scoring";
import { waitingOnMe } from "@/lib/shares";
import { alias } from "drizzle-orm/pg-core";
import { ActionButton } from "@/components/Interactive";
import { declineVerification, verifyAccount } from "@/lib/actions/accounts";
import { KindBadge } from "@/components/ui/Badges";

/** Merchants and individuals waiting for an Admin to verify them (oldest first). */
async function awaitingVerification(me: Actor) {
  const owner = alias(t.users, "owner");
  const requester = alias(t.users, "requester");
  return db
    .select({
      id: t.accounts.id,
      name: t.accounts.name,
      kind: t.accounts.kind,
      phone: t.accounts.phone,
      requestedAt: t.accounts.verificationRequestedAt,
      ownerName: owner.name,
      requestedBy: requester.name,
    })
    .from(t.accounts)
    .leftJoin(owner, eq(owner.id, t.accounts.ownerId))
    .leftJoin(requester, eq(requester.id, t.accounts.verificationRequestedBy))
    .where(and(accountScope(me), eq(t.accounts.status, "PENDING_VERIFICATION")))
    .orderBy(asc(t.accounts.verificationRequestedAt))
    .limit(100);
}

function VerificationQueue({ rows }: { rows: Awaited<ReturnType<typeof awaitingVerification>> }) {
  if (!rows.length) return null;
  return (
    <Section
      title={`Accounts to verify (${rows.length})`}
      subtitle="Merchants and individuals an agent has marked active. They stay pending until you verify them."
      action={<Link href="/accounts?status=PENDING_VERIFICATION" className="text-sm font-medium text-brand-700">All</Link>}
    >
      <ul className="card divide-y divide-slate-100 border-violet-200">
        {rows.slice(0, 8).map((r) => (
          <li key={r.id} className="px-4 py-3">
            <Link href={`/accounts/${r.id}`} className="block active:opacity-70">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{r.name}</span>
                <KindBadge kind={r.kind} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {r.phone ? `${r.phone} · ` : ""}
                {r.ownerName ?? "Unassigned"}
                {r.requestedBy && r.requestedBy !== r.ownerName ? ` · sent by ${r.requestedBy}` : ""}
                {r.requestedAt ? ` · ${formatDateTime(r.requestedAt)}` : ""}
              </span>
            </Link>
            <div className="mt-2 flex gap-2">
              <ActionButton run={verifyAccount.bind(null, r.id)} confirmText={`Verify ${r.name} and make it active?`} className="btn-primary btn-sm">
                Verify
              </ActionButton>
              <ActionButton run={declineVerification.bind(null, r.id)} prompt="What needs fixing before it can be verified?" className="btn-ghost btn-sm text-red-600">
                Decline
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const metadata = { title: "Home" };

async function followUps(me: Actor) {
  const { end: todayEnd } = getCalendarPeriodRange("daily", APP_TIMEZONE);
  return db
    .select({
      id: t.activities.id,
      type: t.activities.type,
      description: t.activities.description,
      scheduledAt: t.activities.scheduledAt,
      accountId: t.accounts.id,
      accountName: t.accounts.name,
      agent: t.users.name,
    })
    .from(t.activities)
    .innerJoin(t.accounts, eq(t.accounts.id, t.activities.accountId))
    .leftJoin(t.users, eq(t.users.id, t.activities.createdBy))
    .where(and(accountScope(me), eq(t.activities.status, "SCHEDULED"), lt(t.activities.scheduledAt, todayEnd)))
    .orderBy(asc(t.activities.scheduledAt))
    .limit(50);
}

function FollowUpList({ rows, showAgent }: { rows: Awaited<ReturnType<typeof followUps>>; showAgent: boolean }) {
  const now = Date.now();
  return rows.length === 0 ? (
    <Empty>Nothing due today. You&apos;re all caught up.</Empty>
  ) : (
    <ul className="card divide-y divide-slate-100 overflow-hidden">
      {rows.slice(0, 8).map((f) => {
        const overdue = (f.scheduledAt?.getTime() ?? 0) < now - 60_000;
        return (
          <li key={f.id}>
            <Link href={`/accounts/${f.accountId}?tab=activity`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${overdue ? "bg-red-500" : "bg-amber-400"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{f.accountName}</span>
                <span className="block truncate text-xs text-slate-500">
                  {ACTIVITY_LABELS[f.type]} · {overdue ? "overdue since " : ""}
                  {formatDateTime(f.scheduledAt)}
                  {showAgent && f.agent ? ` · ${f.agent}` : ""}
                </span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function Dashboard() {
  const me = await requireUser();
  const month = periodRange("monthly");
  const [due, totals] = await Promise.all([followUps(me), productTotals(me, month.start, month.end)]);
  const now = Date.now();
  const overdue = due.filter((f) => (f.scheduledAt?.getTime() ?? 0) < now - 60_000).length;
  const first = me.name.split(" ")[0];

  if (me.role === "AGENT" || me.role === "BDO") {
    const rollup = me.role === "BDO" ? await bdoRollup(me, month.start, month.end) : null;
    const myGroup = rollup?.groups.find((g) => g.bdo.id === me.id) ?? null;
    const [counts, opps, [{ pendingN }]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(t.accounts).where(accountScope(me)),
      db
        .select({ o: t.opportunities, accountName: t.accounts.name })
        .from(t.opportunities)
        .innerJoin(t.accounts, eq(t.accounts.id, t.opportunities.accountId))
        .where(and(accountScope(me), ne(t.opportunities.stage, "ACTIVE")))
        .limit(300),
      db.select({ pendingN: sql<number>`count(*)::int` }).from(t.accounts).where(and(accountScope(me), eq(t.accounts.status, "PENDING_VERIFICATION"))),
    ]);
    const ids = opps.map((x) => x.o.id);
    const last = ids.length
      ? await db
          .select({ id: t.activities.opportunityId, at: sql<string>`max(coalesce(${t.activities.completedAt}, ${t.activities.createdAt}))` })
          .from(t.activities)
          .where(and(inArray(t.activities.opportunityId, ids), eq(t.activities.status, "COMPLETED")))
          .groupBy(t.activities.opportunityId)
      : [];
    const lastBy = new Map(last.map((l) => [l.id!, l.at]));
    const leads = rankLeads(opps.map((x) => ({ opportunity: x.o, accountName: x.accountName, lastActivityAt: lastBy.get(x.o.id) ?? null }))).slice(0, 5);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">Hi {first}</h1>
          <p className="text-sm text-slate-500">Here&apos;s your day.</p>
        </div>
        {pendingN > 0 && (
          <Link href="/accounts?status=PENDING_VERIFICATION" className="card flex items-center justify-between gap-3 border-violet-200 bg-violet-50 p-4 text-sm active:opacity-70">
            <span className="text-violet-900">
              {pendingN} account{pendingN === 1 ? " is" : "s are"} waiting for an Admin to verify
            </span>
            <ChevronRight size={18} className="shrink-0 text-violet-700" />
          </Link>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Due today" value={due.length - overdue} href="/follow-ups" tone={due.length - overdue ? "warn" : undefined} />
          <Stat label="Overdue" value={overdue} href="/follow-ups" tone={overdue ? "danger" : undefined} />
          <Stat label={me.role === "BDO" ? "Accounts (you + agents)" : "My accounts"} value={counts[0]?.n ?? 0} href="/accounts" />
          <Stat label={me.role === "BDO" ? "Disbursed (you + agents)" : "Disbursed this month"} value={formatMoney(totals.total, { dash: false })} />
        </div>
        {myGroup && (
          <Section title="My agents this month" action={<Link href="/users" className="text-sm font-medium text-brand-700">Manage</Link>}>
            {myGroup.agents.length === 0 ? (
              <Empty>No agents report to you yet. Add them from People.</Empty>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {myGroup.agents.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {a.name}
                        {a.status === "INACTIVE" && <span className="ml-1 text-xs font-normal text-slate-400">(inactive)</span>}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(a.snpl + a.salaryAdvance + a.qf, { dash: false })}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.accountsAdded} new account{a.accountsAdded === 1 ? "" : "s"} · {a.activitiesDone} activit{a.activitiesDone === 1 ? "y" : "ies"} · QF {a.qfCycles.toFixed(1)} cycles
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        {totals.QUICK_FINANCE !== 0 && (
          <div className="card flex items-center justify-between p-4 text-sm">
            <span className="text-slate-600">Quick Finance this month</span>
            <span className="font-semibold tabular-nums">
              {formatMoney(totals.QUICK_FINANCE)} · {totals.qfCycles.toFixed(1)} cycles
            </span>
          </div>
        )}
        <Section title="Follow-ups due" action={<Link href="/follow-ups" className="text-sm font-medium text-brand-700">All</Link>}>
          <FollowUpList rows={due} showAgent={me.role === "BDO"} />
        </Section>
        <Section title="Best leads to work on" subtitle="Ranked by stage, recent activity and next steps.">
          {leads.length === 0 ? (
            <Empty>No open leads. Register a new account to get started.</Empty>
          ) : (
            <ul className="card divide-y divide-slate-100 overflow-hidden">
              {leads.map((l) => (
                <li key={l.opportunity.id}>
                  <Link href={`/accounts/${l.opportunity.accountId}?tab=pipeline`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{l.accountName}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <ProductBadge product={l.opportunity.product} />
                        <StageBadge stage={l.opportunity.stage} />
                        <span className="truncate text-xs text-slate-500">{l.lead.reasons[1] ?? l.lead.reasons[0]}</span>
                      </span>
                    </span>
                    <span
                      className={`badge ${l.lead.temperature === "HOT" ? "bg-accent-100 text-accent-700" : l.lead.temperature === "WARM" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                    >
                      {l.lead.score}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    );
  }

  // Team Leader / Admin
  const [{ groups }, staleStatements, shareRequests, toVerify] = await Promise.all([
    bdoRollup(me, month.start, month.end),
    db.execute<{ id: string; name: string; last: string | null }>(sql`
      select accounts.id, accounts.name, max(su.created_at) as last
        from accounts
        join qf_limits l on l.account_id = accounts.id
        left join statement_uploads su on su.account_id = accounts.id and su.accepted
       where ${accountScope(me)} and accounts.kind in ('MERCHANT', 'INDIVIDUAL') and accounts.status <> 'INACTIVE'
       group by accounts.id, accounts.name
      having max(su.created_at) is null or max(su.created_at) < now() - interval '3 days'
       order by max(su.created_at) nulls first limit 6`),
    waitingOnMe(me),
    me.role === "ADMIN" ? awaitingVerification(me) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Hi {first}</h1>
        <p className="text-sm text-slate-500">{me.role === "ADMIN" ? "Every team" : "Your team"}, this month.</p>
      </div>
      <VerificationQueue rows={toVerify} />
      {shareRequests > 0 && (
        <Link href="/shares" className="card flex items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4 text-sm active:opacity-70">
          <span className="font-medium text-amber-900">
            {shareRequests} corporate sharing request{shareRequests === 1 ? "" : "s"} waiting for your approval
          </span>
          <ChevronRight size={18} className="shrink-0 text-amber-700" />
        </Link>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Disbursed this month" value={formatMoney(totals.total, { dash: false })} href="/reports" />
        <Stat label="Quick Finance" value={formatMoney(totals.QUICK_FINANCE, { dash: false })} href="/reports" />
        <Stat label="QF cycles" value={totals.qfCycles.toFixed(1)} href="/reports" />
        <Stat label="Overdue follow-ups" value={overdue} href="/follow-ups" tone={overdue ? "danger" : undefined} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="School Now Pay Later" value={formatMoney(totals.SNPL, { dash: false })} />
        <Stat label="Salary Advance" value={formatMoney(totals.SALARY_ADVANCE, { dash: false })} />
      </div>

      <Section title="BDOs this month" subtitle="Each total includes the BDO's agents." action={<Link href="/reports" className="text-sm font-medium text-brand-700">Report</Link>}>
        {groups.length === 0 ? (
          <Empty>No BDOs yet.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {groups.slice(0, 10).map((g) => (
              <li key={g.bdo.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {g.bdo.name}
                    {g.bdo.status === "INACTIVE" && <span className="ml-1 text-xs font-normal text-slate-400">(inactive)</span>}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(g.total.snpl + g.total.salaryAdvance + g.total.qf, { dash: false })}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {g.agents.length} agent{g.agents.length === 1 ? "" : "s"} · {g.total.accountsAdded} new account{g.total.accountsAdded === 1 ? "" : "s"} · {g.total.activitiesDone} activit
                  {g.total.activitiesDone === 1 ? "y" : "ies"} · QF {g.total.qfCycles.toFixed(1)} cycles
                  {me.role === "ADMIN" && g.bdo.teamName ? ` · ${g.bdo.teamName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Statements due" subtitle="Merchants with a QF limit and no statement in the last 3 days." action={<Link href="/statements" className="text-sm font-medium text-brand-700">Upload</Link>}>
        {staleStatements.length === 0 ? (
          <Empty>All statements are up to date.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {staleStatements.map((s) => (
              <li key={s.id}>
                <Link href={`/accounts/${s.id}?tab=money`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm active:bg-slate-50">
                  <span className="truncate font-medium text-ink">{s.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{s.last ? `last ${formatDateTime(s.last)}` : "never uploaded"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Follow-ups due" action={<Link href="/follow-ups" className="text-sm font-medium text-brand-700">All</Link>}>
        <FollowUpList rows={due} showAgent />
      </Section>
      <p className="text-center text-xs text-slate-400">Signed in as {ROLE_LABELS[me.role]}</p>
    </div>
  );
}
