import Link from "next/link";
import { Download } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { Empty, PageHeader, Section, Stat } from "@/components/ui/Page";
import { accountCounts, bdoRollup, parsePeriod, peopleBreakdown, PERIODS, periodRange, productTotals, teamBreakdown, type PersonRow } from "@/lib/reports";
import { formatDateTime, formatMoney } from "@/lib/format";
import { KIND_LABELS, ROLE_LABELS, STATUS_LABELS } from "@/lib/labels";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const me = await requireRole(["BDO", "TEAM_LEADER", "ADMIN"]);
  const period = parsePeriod((await searchParams).period);
  const { start, end } = periodRange(period);
  const [totals, people, teams, counts] = await Promise.all([
    productTotals(me, start, end),
    peopleBreakdown(me, start, end),
    me.role === "ADMIN" ? teamBreakdown(me, start, end) : Promise.resolve([]),
    accountCounts(me),
  ]);
  const { groups, others } = await bdoRollup(me, start, end, people);
  const kinds = Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[];
  const statuses = Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle={`${formatDateTime(start, true)} to ${formatDateTime(new Date(end.getTime() - 60000), true)} (Nairobi time)`}
        actions={
          <a href={`/api/reports/csv?period=${period}`} className="btn-secondary btn-sm">
            <Download size={16} /> CSV
          </a>
        }
      />
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {PERIODS.map((p) => (
          <Link key={p.value} href={`/reports?period=${p.value}`} className={p.value === period ? "chip-on" : "chip-off"}>
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Total disbursed" value={formatMoney(totals.total, { dash: false })} />
        <Stat label="Quick Finance" value={formatMoney(totals.QUICK_FINANCE, { dash: false })} />
        <Stat label="School Now Pay Later" value={formatMoney(totals.SNPL, { dash: false })} />
        <Stat label="Salary Advance" value={formatMoney(totals.SALARY_ADVANCE, { dash: false })} />
      </div>
      <div className="card p-4 text-sm">
        <p className="font-medium text-ink">Quick Finance usage</p>
        <p className="mt-1 text-slate-600">
          {totals.qfDraws} draws · <strong>{totals.qfCycles.toFixed(2)} cycles</strong> used (each draw divided by the QF limit in force on its day).
        </p>
        {totals.qfWithoutLimit > 0 && (
          <p className="mt-1 text-amber-800">{formatMoney(totals.qfWithoutLimit)} was drawn on accounts with no limit recorded, so it isn&apos;t in the cycle count.</p>
        )}
      </div>

      {teams.length > 0 && (
        <Section title="By team" subtitle="Credited to the team each person was on when the money went out.">
          <ul className="card divide-y divide-slate-100">
            {teams.map((tm) => (
              <li key={tm.teamId ?? "none"} className="px-4 py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-ink">{tm.teamName}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(tm.snpl + tm.salaryAdvance + tm.qf, { dash: false })}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  QF {formatMoney(tm.qf, { dash: false })} ({tm.qfCycles.toFixed(1)} cycles) · SNPL {formatMoney(tm.snpl, { dash: false })} · Salary Adv. {formatMoney(tm.salaryAdvance, { dash: false })}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="By BDO" subtitle="Each BDO's total includes the agents who report to them.">
        {groups.length === 0 ? (
          <Empty>No BDOs to show.</Empty>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.bdo.id} className="card overflow-hidden">
                <div className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-semibold text-ink">
                      {g.bdo.name}
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        BDO · {g.agents.length} agent{g.agents.length === 1 ? "" : "s"}
                        {me.role === "ADMIN" && g.bdo.teamName ? ` · ${g.bdo.teamName}` : ""}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(g.total.snpl + g.total.salaryAdvance + g.total.qf, { dash: false })}</span>
                  </div>
                  <Figures p={g.total} />
                </div>
                {(g.agents.length > 0 || g.bdo.snpl + g.bdo.salaryAdvance + g.bdo.qf > 0) && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60">
                    <PersonLine p={g.bdo} label="BDO's own" />
                    {g.agents.map((a) => (
                      <PersonLine key={a.id} p={a} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {others.length > 0 && (
        <Section title={groups.length ? "Others" : "By person"}>
          <ul className="card divide-y divide-slate-100">
            {others.map((p) => (
              <PersonLine key={p.id} p={p} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Accounts by status (today)">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Kind</th>
                {statuses.map((s) => (
                  <th key={s} className="px-2 py-2 text-right font-medium">
                    {STATUS_LABELS[s].split(" ")[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {kinds.map((k) => (
                <tr key={k}>
                  <td className="px-3 py-2 font-medium text-ink">{KIND_LABELS[k]}</td>
                  {statuses.map((s) => (
                    <td key={s} className="px-2 py-2 text-right tabular-nums text-slate-600">
                      {counts.find((c) => c.kind === k && c.status === s)?.n ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Figures({ p }: { p: Pick<PersonRow, "accountsAdded" | "activitiesDone" | "snpl" | "salaryAdvance" | "qf" | "qfCycles" | "limitHits"> }) {
  return (
    <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs text-slate-500">
      <div>QF {formatMoney(p.qf, { dash: false })}</div>
      <div>{p.qfCycles.toFixed(1)} cycles</div>
      <div>{p.limitHits}× hit limit</div>
      <div>SNPL {formatMoney(p.snpl, { dash: false })}</div>
      <div>SA {formatMoney(p.salaryAdvance, { dash: false })}</div>
      <div>
        {p.accountsAdded} new · {p.activitiesDone} activit{p.activitiesDone === 1 ? "y" : "ies"}
      </div>
    </dl>
  );
}

function PersonLine({ p, label }: { p: PersonRow; label?: string }) {
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex justify-between gap-2">
        <span className="truncate text-ink">
          {label ? <span className="text-slate-500">{label}</span> : p.name}
          {!label && (
            <span className="ml-1 text-xs text-slate-500">
              {ROLE_LABELS[p.role]}
              {p.status === "INACTIVE" ? ", inactive" : ""}
            </span>
          )}
        </span>
        <span className="tabular-nums">{formatMoney(p.snpl + p.salaryAdvance + p.qf, { dash: false })}</span>
      </div>
      <Figures p={p} />
    </li>
  );
}
