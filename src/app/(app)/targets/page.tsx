import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { Empty, PageHeader, Section } from "@/components/ui/Page";
import Sheet from "@/components/ui/Sheet";
import TargetProgress from "@/components/TargetProgress";
import { canEditTarget, isMonday, mustSetTargets, shiftWeek, weekStartOf, type TargetValues } from "@/lib/targets";
import { myTarget, weekOverview, type PersonWeek } from "@/lib/targets-data";
import { formatDate } from "@/lib/format";
import TargetForm from "./TargetForm";

export const metadata = { title: "Weekly targets" };

const values = (r: { individuals: number; merchants: number; corporates: number; disbursement: string | number }): TargetValues => ({
  individuals: r.individuals,
  merchants: r.merchants,
  corporates: r.corporates,
  disbursement: Number(r.disbursement),
});

function PersonLine({ p, label }: { p: PersonWeek; label?: string }) {
  return (
    <li className="px-4 py-3">
      <p className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium text-ink">{label ?? p.name}</span>
        {!p.target && <span className="badge bg-red-100 text-red-700">Not set</span>}
      </p>
      <TargetProgress target={p.target} actual={p.actual} compact />
    </li>
  );
}

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ week?: string; required?: string }> }) {
  const me = await requireUser({ skipTargets: true });
  const sp = await searchParams;
  const thisWeek = weekStartOf();
  const week = sp.week && isMonday(sp.week) && sp.week <= thisWeek ? sp.week : thisWeek;
  const sets = mustSetTargets(me.role);
  const mine = sets ? await myTarget(me.id, thisWeek) : null;
  const teams = await weekOverview(me, week);
  const isCurrent = week === thisWeek;

  // A BDO or Agent who hasn't set this week's targets sees only the form.
  if (sets && !mine) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <PageHeader title="Set this week's targets" subtitle={`Week of ${formatDate(thisWeek)}`} />
        {sp.required && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Set your targets for the week before you continue. Your {me.role === "AGENT" ? "BDO and Team Leader" : "Team Leader"} will see them.
          </p>
        )}
        <div className="card p-4">
          <TargetForm initial={null} redirectTo="/dashboard" />
        </div>
      </div>
    );
  }

  const nav = (
    <div className="flex items-center justify-between gap-2">
      <Link href={`/targets?week=${shiftWeek(week, -1)}`} className="btn-ghost btn-sm">
        <ChevronLeft size={16} /> Previous
      </Link>
      <span className="text-sm font-medium text-ink">
        {isCurrent ? "This week" : `Week of ${formatDate(week)}`}
      </span>
      {isCurrent ? (
        <span className="w-[88px]" />
      ) : (
        <Link href={`/targets?week=${shiftWeek(week, 1)}`} className="btn-ghost btn-sm">
          Next <ChevronRight size={16} />
        </Link>
      )}
    </div>
  );

  const me_ = teams.flatMap((tm) => [...tm.bdos.flatMap((b) => [b.bdo, ...b.agents]), ...tm.others]).find((p) => p.id === me.id);
  const myBdo = teams.flatMap((tm) => tm.bdos).find((b) => b.bdo.id === me.id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Weekly targets"
        subtitle={me.role === "ADMIN" ? "Every team" : me.role === "TEAM_LEADER" ? "Your team, by BDO" : me.role === "BDO" ? "You and your agents" : "Your week"}
      />
      {nav}

      {sets && me_ && (
        <Section
          title="My targets"
          action={
            isCurrent && mine && canEditTarget(mine.createdAt) ? (
              <Sheet title="Change this week's targets" trigger="Edit" triggerClassName="btn-ghost btn-sm">
                <TargetForm initial={values(mine)} />
              </Sheet>
            ) : isCurrent ? (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Lock size={12} /> Locked for the week
              </span>
            ) : null
          }
        >
          <div className="card p-4">
            <TargetProgress target={me_.target} actual={me_.actual} />
          </div>
        </Section>
      )}

      {myBdo && myBdo.agents.length > 0 && (
        <Section title="With my agents" subtitle="Your targets plus your agents', and what you've achieved together.">
          <div className="card p-4">
            <TargetProgress target={myBdo.target} actual={myBdo.actual} />
            {myBdo.missing > 0 && (
              <p className="mt-2 text-xs text-red-600">
                {myBdo.missing} {myBdo.missing === 1 ? "person hasn't" : "people haven't"} set targets this week.
              </p>
            )}
          </div>
          <ul className="card divide-y divide-slate-100">
            {myBdo.agents.map((a) => (
              <PersonLine key={a.id} p={a} />
            ))}
          </ul>
        </Section>
      )}

      {(me.role === "TEAM_LEADER" || me.role === "ADMIN") &&
        (teams.length === 0 ? (
          <Empty>No BDOs or agents yet.</Empty>
        ) : (
          teams.map((tm) => (
            <Section key={tm.teamId ?? "none"} title={tm.teamName} subtitle={tm.leader ? `Team Leader: ${tm.leader}` : undefined}>
              <div className="card p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Team total</p>
                <TargetProgress target={tm.target} actual={tm.actual} />
                {tm.missing > 0 && (
                  <p className="mt-2 text-xs text-red-600">
                    {tm.missing} {tm.missing === 1 ? "person hasn't" : "people haven't"} set targets this week.
                  </p>
                )}
              </div>
              {tm.bdos.map((b) => (
                <details key={b.bdo.id} className="card overflow-hidden" open={me.role === "TEAM_LEADER"}>
                  <summary className="cursor-pointer list-none px-4 py-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-ink">
                        {b.bdo.name}{" "}
                        <span className="text-xs font-normal text-slate-500">
                          BDO · {b.agents.length} agent{b.agents.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      {b.missing > 0 && <span className="badge bg-red-100 text-red-700">{b.missing} not set</span>}
                    </span>
                    <span className="mt-2 block">
                      <TargetProgress target={b.target} actual={b.actual} compact />
                    </span>
                  </summary>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60">
                    <PersonLine p={b.bdo} label={`${b.bdo.name} (own)`} />
                    {b.agents.map((a) => (
                      <PersonLine key={a.id} p={a} />
                    ))}
                  </ul>
                </details>
              ))}
              {tm.others.length > 0 && (
                <ul className="card divide-y divide-slate-100">
                  {tm.others.map((o) => (
                    <PersonLine key={o.id} p={o} />
                  ))}
                </ul>
              )}
            </Section>
          ))
        ))}
      <p className="text-xs text-slate-500">
        An account counts as closed in the week it first became Active, for its current owner. Disbursed is what was credited to the person that week. BDO and team totals add up
        everyone&apos;s targets and results.
      </p>
    </div>
  );
}
