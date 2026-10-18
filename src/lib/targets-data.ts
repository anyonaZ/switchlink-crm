import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import type { Actor } from "@/lib/permissions";
import { addTargets, weekRange, ZERO, type TargetValues } from "@/lib/targets";

export interface PersonWeek {
  id: string;
  name: string;
  role: "AGENT" | "BDO";
  teamId: string | null;
  reportsTo: string | null;
  /** Null when they haven't set targets for the week. */
  target: TargetValues | null;
  actual: TargetValues;
}
export interface BdoWeek {
  bdo: PersonWeek;
  agents: PersonWeek[];
  /** BDO's own targets plus every Agent's. */
  target: TargetValues;
  actual: TargetValues;
  missing: number;
}
export interface TeamWeek {
  teamId: string | null;
  teamName: string;
  leader: string | null;
  bdos: BdoWeek[];
  /** Agents whose BDO isn't on the board (e.g. no BDO). */
  others: PersonWeek[];
  target: TargetValues;
  actual: TargetValues;
  missing: number;
}

export async function myTarget(userId: string, monday: string) {
  const [row] = await db
    .select()
    .from(t.weeklyTargets)
    .where(and(eq(t.weeklyTargets.userId, userId), eq(t.weeklyTargets.weekStart, monday)));
  return row ?? null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Targets and results for the week, grouped team → BDO → Agents.
 * Admins see every team; Team Leaders their team; BDOs themselves and their
 * Agents; Agents themselves.
 *
 * Results: an account counts as closed in the week it first became Active
 * (credited to its current owner). Disbursement is what was credited to the
 * person that week.
 */
export async function weekOverview(me: Actor, monday: string): Promise<TeamWeek[]> {
  const { start, end } = weekRange(monday);
  const scope =
    me.role === "ADMIN"
      ? sql`true`
      : me.role === "TEAM_LEADER"
        ? me.teamId
          ? sql`u.team_id = ${me.teamId}`
          : sql`false`
        : me.role === "BDO"
          ? sql`(u.id = ${me.id} or u.reports_to = ${me.id})`
          : sql`u.id = ${me.id}`;
  const people = await db.execute<{ id: string; name: string; role: "AGENT" | "BDO"; team_id: string | null; reports_to: string | null }>(sql`
    select u.id, u.name, u.role, u.team_id, u.reports_to from users u
     where u.role in ('BDO', 'AGENT') and u.status = 'ACTIVE' and ${scope}
     order by u.name`);
  if (!people.length) return [];
  const ids = people.map((p) => p.id);
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

  const [targets, closed, money, teams] = await Promise.all([
    db.execute<{ user_id: string; individuals: number; merchants: number; corporates: number; disbursement: string }>(sql`
      select user_id, individuals, merchants, corporates, disbursement from weekly_targets
       where week_start = ${monday}::date and user_id in (${idList})`),
    db.execute<{ uid: string; kind: string; n: string }>(sql`
      select a.owner_id as uid, a.kind, count(distinct a.id) as n
        from account_status_history h join accounts a on a.id = h.account_id
       where h.to_status = 'ACTIVE'
         and h.changed_at >= ${start.toISOString()}::timestamptz and h.changed_at < ${end.toISOString()}::timestamptz
         and a.kind in ('INDIVIDUAL', 'MERCHANT', 'CORPORATE')
         and a.owner_id in (${idList})
         and not exists (select 1 from account_status_history h2
                          where h2.account_id = a.id and h2.to_status = 'ACTIVE' and h2.changed_at < ${start.toISOString()}::timestamptz)
       group by 1, 2`),
    db.execute<{ uid: string; total: string }>(sql`
      select d.credited_to as uid, sum(d.amount) as total from disbursements d
       where d.credited_to in (${idList})
         and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz
       group by 1`),
    db.execute<{ id: string; name: string; leader: string | null }>(sql`
      select tm.id, tm.name, (select string_agg(x.name, ', ') from users x where x.team_id = tm.id and x.role = 'TEAM_LEADER' and x.status = 'ACTIVE') as leader
        from teams tm`),
  ]);
  const targetBy = new Map(targets.map((r) => [r.user_id, { individuals: n(r.individuals), merchants: n(r.merchants), corporates: n(r.corporates), disbursement: n(r.disbursement) }]));
  const actualBy = new Map<string, TargetValues>();
  const actual = (id: string) => actualBy.get(id) ?? { ...ZERO };
  for (const c of closed) {
    const a = actual(c.uid);
    if (c.kind === "INDIVIDUAL") a.individuals += n(c.n);
    if (c.kind === "MERCHANT") a.merchants += n(c.n);
    if (c.kind === "CORPORATE") a.corporates += n(c.n);
    actualBy.set(c.uid, a);
  }
  for (const m of money) actualBy.set(m.uid, { ...actual(m.uid), disbursement: n(m.total) });

  const rows: PersonWeek[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    teamId: p.team_id,
    reportsTo: p.reports_to,
    target: targetBy.get(p.id) ?? null,
    actual: actual(p.id),
  }));
  const teamMeta = new Map(teams.map((tm) => [tm.id, tm]));
  const teamIds = [...new Set(rows.map((r) => r.teamId))];
  return teamIds
    .map((teamId) => {
      const inTeam = rows.filter((r) => r.teamId === teamId);
      const bdos: BdoWeek[] = inTeam
        .filter((r) => r.role === "BDO")
        .map((bdo) => {
          const agents = inTeam.filter((r) => r.role === "AGENT" && r.reportsTo === bdo.id);
          const all = [bdo, ...agents];
          return {
            bdo,
            agents,
            target: all.reduce((s, r) => addTargets(s, r.target ?? ZERO), ZERO),
            actual: all.reduce((s, r) => addTargets(s, r.actual), ZERO),
            missing: all.filter((r) => !r.target).length,
          };
        });
      const grouped = new Set(bdos.flatMap((b) => [b.bdo.id, ...b.agents.map((a) => a.id)]));
      const others = inTeam.filter((r) => !grouped.has(r.id));
      const everyone = [...bdos.flatMap((b) => [b.bdo, ...b.agents]), ...others];
      const meta = teamId ? teamMeta.get(teamId) : undefined;
      return {
        teamId,
        teamName: meta?.name ?? "No team",
        leader: meta?.leader ?? null,
        bdos,
        others,
        target: everyone.reduce((s, r) => addTargets(s, r.target ?? ZERO), ZERO),
        actual: everyone.reduce((s, r) => addTargets(s, r.actual), ZERO),
        missing: everyone.filter((r) => !r.target).length,
      };
    })
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}
