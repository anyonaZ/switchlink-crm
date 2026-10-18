import Link from "next/link";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ChevronRight } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { accountScope, isSupervisor } from "@/lib/permissions";
import { Empty, PageHeader, Section } from "@/components/ui/Page";
import { ACTIVITY_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { getCalendarPeriodRange } from "@/lib/timezone";
import { APP_TIMEZONE } from "@/lib/config";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage() {
  const me = await requireUser();
  const { start: todayStart, end: todayEnd } = getCalendarPeriodRange("daily", APP_TIMEZONE);
  const creator = alias(t.users, "creator");
  const base = { id: t.activities.id, type: t.activities.type, description: t.activities.description, when: t.activities.scheduledAt, accountId: t.accounts.id, accountName: t.accounts.name, agent: creator.name };
  const open = await db
    .select(base)
    .from(t.activities)
    .innerJoin(t.accounts, eq(t.accounts.id, t.activities.accountId))
    .leftJoin(creator, eq(creator.id, t.activities.createdBy))
    .where(and(accountScope(me), eq(t.activities.status, "SCHEDULED")))
    .orderBy(asc(t.activities.scheduledAt))
    .limit(200);
  const done = await db
    .select({ ...base, when: t.activities.completedAt })
    .from(t.activities)
    .innerJoin(t.accounts, eq(t.accounts.id, t.activities.accountId))
    .leftJoin(creator, eq(creator.id, t.activities.completedBy))
    .where(and(accountScope(me), eq(t.activities.status, "COMPLETED"), gte(t.activities.completedAt, new Date(Date.now() - 7 * 86400000))))
    .orderBy(desc(t.activities.completedAt))
    .limit(40);

  const overdue = open.filter((a) => a.when && a.when < todayStart);
  const today = open.filter((a) => a.when && a.when >= todayStart && a.when < todayEnd);
  const later = open.filter((a) => a.when && a.when >= todayEnd);
  const showAgent = isSupervisor(me);

  const List = ({ rows, tone }: { rows: typeof open; tone?: "danger" | "warn" }) =>
    rows.length === 0 ? (
      <Empty>Nothing here.</Empty>
    ) : (
      <ul className="card divide-y divide-slate-100 overflow-hidden">
        {rows.map((a) => (
          <li key={a.id}>
            <Link href={`/accounts/${a.accountId}?tab=activity`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone === "danger" ? "bg-red-500" : tone === "warn" ? "bg-amber-400" : "bg-slate-300"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{a.accountName}</span>
                <span className="block truncate text-xs text-slate-500">
                  {ACTIVITY_LABELS[a.type]}
                  {a.description ? ` · ${a.description}` : ""} · {formatDateTime(a.when)}
                  {showAgent && a.agent ? ` · ${a.agent}` : ""}
                </span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Follow-ups" subtitle="Tap one to open the account and mark it done." />
      <Section title={`Overdue (${overdue.length})`}>
        <List rows={overdue} tone="danger" />
      </Section>
      <Section title={`Today (${today.length})`}>
        <List rows={today} tone="warn" />
      </Section>
      <Section title={`Coming up (${later.length})`}>
        <List rows={later} />
      </Section>
      <Section title="Done in the last 7 days">
        <List rows={done} />
      </Section>
    </div>
  );
}
