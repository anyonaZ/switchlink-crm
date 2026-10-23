import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCalendarPeriodRange, getZonedParts, startOfZonedDay } from "@/lib/timezone";
import { APP_TIMEZONE } from "@/lib/config";
import { sharedWithMe, type Actor } from "@/lib/permissions";

export const PERIODS = [
  { value: "daily", label: "Today" },
  { value: "weekly", label: "This week" },
  { value: "monthly", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "quarterly", label: "This quarter" },
  { value: "annual", label: "This year" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];

export function periodRange(p: Period, now = new Date()) {
  if (p === "lastmonth") {
    const z = getZonedParts(now, APP_TIMEZONE);
    const y = z.month === 1 ? z.year - 1 : z.year;
    const m = z.month === 1 ? 12 : z.month - 1;
    return { start: startOfZonedDay(y, m, 1, APP_TIMEZONE), end: startOfZonedDay(z.year, z.month, 1, APP_TIMEZONE) };
  }
  return getCalendarPeriodRange(p, APP_TIMEZONE, now);
}
export const parsePeriod = (v: string | undefined): Period => (PERIODS.some((p) => p.value === v) ? (v as Period) : "monthly");

/** Scope as raw SQL over alias `d` (disbursements) and `u` (credited user). */
function ledgerScope(me: Actor): SQL {
  if (me.role === "ADMIN") return sql`true`;
  if (me.role === "TEAM_LEADER") return me.teamId ? sql`d.credited_team_id = ${me.teamId}` : sql`false`;
  if (me.role === "BDO") return sql`(d.credited_to = ${me.id} or d.credited_bdo_id = ${me.id})`;
  return sql`d.credited_to = ${me.id}`;
}
function accountScopeSql(me: Actor, alias = "a"): SQL {
  const a = sql.raw(alias);
  if (me.role === "ADMIN") return sql`true`;
  if (me.role === "TEAM_LEADER") return me.teamId ? sql`${a}.team_id = ${me.teamId}` : sql`false`;
  if (me.role === "BDO") return sql`(${a}.owner_id = ${me.id} or ${a}.owner_id in (select u2.id from users u2 where u2.reports_to = ${me.id}) or ${sharedWithMe(me, sql`${a}.id`)})`;
  return sql`${a}.owner_id = ${me.id}`;
}
function peopleScope(me: Actor): SQL {
  if (me.role === "ADMIN") return sql`true`;
  if (me.role === "TEAM_LEADER") return me.teamId ? sql`u.team_id = ${me.teamId}` : sql`u.id = ${me.id}`;
  if (me.role === "BDO") return sql`(u.id = ${me.id} or u.reports_to = ${me.id})`;
  return sql`u.id = ${me.id}`;
}

/** The QF limit in force for an account at the moment of a ledger row (SQL fragment over alias d). */
const LIMIT_AT = sql`(select l.amount from qf_limits l where l.account_id = d.account_id and l.effective_from <= d.disbursed_at order by l.effective_from desc limit 1)`;

export interface ProductTotals {
  SNPL: number;
  SALARY_ADVANCE: number;
  QUICK_FINANCE: number;
  total: number;
  qfDraws: number;
  qfCycles: number;
  qfWithoutLimit: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function productTotals(me: Actor, start: Date, end: Date): Promise<ProductTotals> {
  const rows = await db.execute<{ product: string; total: string; draws: string; cycles: string | null; nolimit: string }>(sql`
    select d.product,
           sum(d.amount) as total,
           count(*) filter (where d.amount > 0 and not exists (select 1 from disbursements rv where rv.reverses_id = d.id)) as draws,
           sum(case when d.product = 'QUICK_FINANCE' then d.amount / nullif(${LIMIT_AT}, 0) end) as cycles,
           sum(case when d.product = 'QUICK_FINANCE' and ${LIMIT_AT} is null then d.amount else 0 end) as nolimit
      from disbursements d
     where ${ledgerScope(me)} and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz
     group by d.product`);
  const out: ProductTotals = { SNPL: 0, SALARY_ADVANCE: 0, QUICK_FINANCE: 0, total: 0, qfDraws: 0, qfCycles: 0, qfWithoutLimit: 0 };
  for (const r of rows) {
    const k = r.product as "SNPL" | "SALARY_ADVANCE" | "QUICK_FINANCE";
    out[k] = n(r.total);
    out.total += n(r.total);
    if (k === "QUICK_FINANCE") {
      out.qfDraws = n(r.draws);
      out.qfCycles = n(r.cycles);
      out.qfWithoutLimit = n(r.nolimit);
    }
  }
  return out;
}

export interface PersonRow {
  id: string;
  name: string;
  role: "AGENT" | "BDO" | "TEAM_LEADER" | "ADMIN";
  status: "ACTIVE" | "INACTIVE";
  teamName: string | null;
  reportsTo: string | null;
  accountsAdded: number;
  activitiesDone: number;
  snpl: number;
  salaryAdvance: number;
  qf: number;
  qfCycles: number;
  limitHits: number;
}

/** Per-person portfolio for the period. Agents only ever see themselves. */
export async function peopleBreakdown(me: Actor, start: Date, end: Date): Promise<PersonRow[]> {
  const rows = await db.execute<Record<string, string | null>>(sql`
    with money as (
      select d.credited_to as uid,
             sum(d.amount) filter (where d.product = 'SNPL') as snpl,
             sum(d.amount) filter (where d.product = 'SALARY_ADVANCE') as sa,
             sum(d.amount) filter (where d.product = 'QUICK_FINANCE') as qf,
             sum(case when d.product = 'QUICK_FINANCE' then d.amount / nullif(${LIMIT_AT}, 0) end) as cycles
        from disbursements d
       where ${ledgerScope(me)} and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz
       group by d.credited_to
    ),
    added as (
      select a.owner_id as uid, count(*) as n from accounts a
       where a.created_at >= ${start.toISOString()}::timestamptz and a.created_at < ${end.toISOString()}::timestamptz group by a.owner_id
    ),
    acts as (
      select coalesce(x.completed_by, x.created_by) as uid, count(*) as n from activities x
       where x.status = 'COMPLETED' and x.completed_at >= ${start.toISOString()}::timestamptz and x.completed_at < ${end.toISOString()}::timestamptz group by 1
    ),
    hits as (
      select a.owner_id as uid, count(*) as n
        from statement_lines s join accounts a on a.id = s.account_id
       where s.posting_date >= (${start.toISOString()}::timestamptz at time zone ${APP_TIMEZONE})::date
         and s.posting_date < (${end.toISOString()}::timestamptz at time zone ${APP_TIMEZONE})::date
         and s.kind = 'DISBURSEMENT'
         and s.od_after >= 0.98 * coalesce((select l.amount from qf_limits l where l.account_id = s.account_id and l.effective_from::date <= s.posting_date order by l.effective_from desc limit 1), 1e15)
       group by a.owner_id
    )
    select u.id, u.name, u.role, u.status, u.reports_to, tm.name as team_name,
           coalesce(added.n, 0) as added, coalesce(acts.n, 0) as acts,
           coalesce(money.snpl, 0) as snpl, coalesce(money.sa, 0) as sa, coalesce(money.qf, 0) as qf,
           coalesce(money.cycles, 0) as cycles, coalesce(hits.n, 0) as hits
      from users u
      left join teams tm on tm.id = u.team_id
      left join money on money.uid = u.id
      left join added on added.uid = u.id
      left join acts on acts.uid = u.id
      left join hits on hits.uid = u.id
     where ${peopleScope(me)} and (u.role <> 'ADMIN' or money.uid is not null)
     order by coalesce(money.snpl, 0) + coalesce(money.sa, 0) + coalesce(money.qf, 0) desc, u.name`);
  return rows.map((r) => ({
    id: r.id!,
    name: r.name!,
    role: r.role as PersonRow["role"],
    status: r.status as PersonRow["status"],
    teamName: r.team_name,
    reportsTo: r.reports_to,
    accountsAdded: n(r.added),
    activitiesDone: n(r.acts),
    snpl: n(r.snpl),
    salaryAdvance: n(r.sa),
    qf: n(r.qf),
    qfCycles: n(r.cycles),
    limitHits: n(r.hits),
  }));
}

export interface BdoGroup {
  bdo: PersonRow;
  agents: PersonRow[];
  /** BDO's own figures plus every Agent's. Money uses the BDO stored on each ledger row. */
  total: Pick<PersonRow, "accountsAdded" | "activitiesDone" | "snpl" | "salaryAdvance" | "qf" | "qfCycles" | "limitHits">;
}

/**
 * Groups people under their BDO: each Agent's work rolls up into the BDO's
 * total. Money is summed by the BDO recorded on each ledger row (so an
 * Agent who later moves keeps their past figures with their old BDO);
 * accounts, activities and limit hits follow today's reporting line.
 */
export async function bdoRollup(me: Actor, start: Date, end: Date, people?: PersonRow[]) {
  const rows = people ?? (await peopleBreakdown(me, start, end));
  const money = await db.execute<Record<string, string | null>>(sql`
    select d.credited_bdo_id as bdo,
           coalesce(sum(d.amount) filter (where d.product = 'SNPL'), 0) as snpl,
           coalesce(sum(d.amount) filter (where d.product = 'SALARY_ADVANCE'), 0) as sa,
           coalesce(sum(d.amount) filter (where d.product = 'QUICK_FINANCE'), 0) as qf,
           coalesce(sum(case when d.product = 'QUICK_FINANCE' then d.amount / nullif(${LIMIT_AT}, 0) end), 0) as cycles
      from disbursements d
     where ${ledgerScope(me)} and d.credited_bdo_id is not null
       and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz
     group by d.credited_bdo_id`);
  const moneyBy = new Map(money.map((m) => [m.bdo!, m]));
  const groups: BdoGroup[] = rows
    .filter((p) => p.role === "BDO")
    .map((bdo) => {
      const agents = rows.filter((a) => a.role === "AGENT" && a.reportsTo === bdo.id);
      const m = moneyBy.get(bdo.id);
      const sum = (k: "accountsAdded" | "activitiesDone" | "limitHits") => bdo[k] + agents.reduce((s, a) => s + a[k], 0);
      return {
        bdo,
        agents,
        total: {
          accountsAdded: sum("accountsAdded"),
          activitiesDone: sum("activitiesDone"),
          limitHits: sum("limitHits"),
          snpl: n(m?.snpl),
          salaryAdvance: n(m?.sa),
          qf: n(m?.qf),
          qfCycles: n(m?.cycles),
        },
      };
    })
    .sort((a, b) => b.total.snpl + b.total.salaryAdvance + b.total.qf - (a.total.snpl + a.total.salaryAdvance + a.total.qf));
  const grouped = new Set(groups.flatMap((g) => [g.bdo.id, ...g.agents.map((a) => a.id)]));
  const others = rows.filter((p) => !grouped.has(p.id));
  return { groups, others };
}

export interface TeamRow {
  teamId: string | null;
  teamName: string;
  snpl: number;
  salaryAdvance: number;
  qf: number;
  qfCycles: number;
}
/** Uses the team stored on each ledger row, so moving people between teams doesn't rewrite history. */
export async function teamBreakdown(me: Actor, start: Date, end: Date): Promise<TeamRow[]> {
  const rows = await db.execute<Record<string, string | null>>(sql`
    select d.credited_team_id as team_id, coalesce(tm.name, 'No team') as team_name,
           coalesce(sum(d.amount) filter (where d.product = 'SNPL'), 0) as snpl,
           coalesce(sum(d.amount) filter (where d.product = 'SALARY_ADVANCE'), 0) as sa,
           coalesce(sum(d.amount) filter (where d.product = 'QUICK_FINANCE'), 0) as qf,
           coalesce(sum(case when d.product = 'QUICK_FINANCE' then d.amount / nullif(${LIMIT_AT}, 0) end), 0) as cycles
      from disbursements d left join teams tm on tm.id = d.credited_team_id
     where ${ledgerScope(me)} and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz
     group by d.credited_team_id, tm.name order by 3 + 4 + 5 desc`);
  return rows.map((r) => ({ teamId: r.team_id, teamName: r.team_name!, snpl: n(r.snpl), salaryAdvance: n(r.sa), qf: n(r.qf), qfCycles: n(r.cycles) }));
}

export async function accountCounts(me: Actor) {
  const rows = await db.execute<{ kind: string; status: string; n: string }>(sql`
    select a.kind, a.status, count(*) as n from accounts a where ${accountScopeSql(me)} group by a.kind, a.status`);
  return rows.map((r) => ({ kind: r.kind, status: r.status, n: n(r.n) }));
}

// ---------------------------------------------------------------------------
// New business vs existing accounts
// ---------------------------------------------------------------------------
/**
 * A disbursement is NEW BUSINESS when its account got its first disbursement
 * in the reporting period (a newly closed account); otherwise it is from an
 * EXISTING account (closed before the period). Reversed entries don't count
 * as an account's first disbursement. Organisations = schools and
 * corporates; merchants = merchants and individuals (Quick Finance).
 */
const FIRSTS = sql`select d0.account_id, min(d0.disbursed_at) as first_at
                     from disbursements d0
                    where d0.amount > 0 and not exists (select 1 from disbursements r0 where r0.reverses_id = d0.id)
                    group by d0.account_id`;

export interface SplitTotals {
  newOrg: number;
  newMerchant: number;
  existingOrg: number;
  existingMerchant: number;
  newAccounts: number;
  newTotal: number;
  existingTotal: number;
  total: number;
}
const splitSelect = (start: Date) => sql`
  coalesce(sum(d.amount) filter (where f.first_at >= ${start.toISOString()}::timestamptz and a.kind in ('SCHOOL', 'CORPORATE')), 0) as new_org,
  coalesce(sum(d.amount) filter (where f.first_at >= ${start.toISOString()}::timestamptz and a.kind in ('MERCHANT', 'INDIVIDUAL')), 0) as new_mer,
  coalesce(sum(d.amount) filter (where (f.first_at is null or f.first_at < ${start.toISOString()}::timestamptz) and a.kind in ('SCHOOL', 'CORPORATE')), 0) as old_org,
  coalesce(sum(d.amount) filter (where (f.first_at is null or f.first_at < ${start.toISOString()}::timestamptz) and a.kind in ('MERCHANT', 'INDIVIDUAL')), 0) as old_mer,
  count(distinct d.account_id) filter (where f.first_at >= ${start.toISOString()}::timestamptz and d.amount > 0) as new_accounts`;
const toSplit = (r: Record<string, string | null> | undefined): SplitTotals => {
  const s = { newOrg: n(r?.new_org), newMerchant: n(r?.new_mer), existingOrg: n(r?.old_org), existingMerchant: n(r?.old_mer), newAccounts: n(r?.new_accounts) };
  return { ...s, newTotal: s.newOrg + s.newMerchant, existingTotal: s.existingOrg + s.existingMerchant, total: s.newOrg + s.newMerchant + s.existingOrg + s.existingMerchant };
};

/** Totals for what this person may see in reports (same scope as the rest of Reports). */
export async function newVsExisting(me: Actor, start: Date, end: Date): Promise<SplitTotals> {
  const [r] = await db.execute<Record<string, string | null>>(sql`
    with f as (${FIRSTS})
    select ${splitSelect(start)}
      from disbursements d join accounts a on a.id = d.account_id left join f on f.account_id = d.account_id
     where ${ledgerScope(me)} and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz`);
  return toSplit(r);
}

export type Board = "bdo" | "agent" | "tl" | "team";
export const BOARDS: { value: Board; label: string }[] = [
  { value: "bdo", label: "BDOs" },
  { value: "agent", label: "Agents" },
  { value: "tl", label: "Team Leaders" },
  { value: "team", label: "Teams" },
];
export type BoardSort = "new" | "existing" | "total" | "accounts" | "conversion";
export interface Conversion {
  /** Accounts added in the period (including individuals later deleted for not being activated). */
  added: number;
  /** Of those, how many have become Active. */
  converted: number;
  /** Percentage, one decimal; null when nothing was added. */
  rate: number | null;
}
export interface BoardRow extends SplitTotals, Conversion {
  id: string;
  name: string;
  sub: string | null;
  inactive: boolean;
}

// ---------------------------------------------------------------------------
// Conversion rates
// ---------------------------------------------------------------------------
/**
 * Conversion = accounts added in the period that went on to become Active,
 * as a share of all accounts added in the period. Accounts are credited to
 * their current owner; individuals deleted for not being activated still
 * count as added (not converted).
 */
const ADDED = (start: Date, end: Date) => sql`
  select a.owner_id as uid, a.team_id,
         exists (select 1 from account_status_history h where h.account_id = a.id and h.to_status = 'ACTIVE') as won
    from accounts a
   where a.created_at >= ${start.toISOString()}::timestamptz and a.created_at < ${end.toISOString()}::timestamptz
  union all
  select x.owner_id, x.team_id, false
    from account_deletions x
   where x.account_created_at >= ${start.toISOString()}::timestamptz and x.account_created_at < ${end.toISOString()}::timestamptz`;
const toConversion = (added: number, converted: number): Conversion => ({ added, converted, rate: added > 0 ? Math.round((converted / added) * 1000) / 10 : null });

async function conversionBy(me: Actor, start: Date, end: Date, board: Board): Promise<Map<string, Conversion>> {
  const scope = me.role === "ADMIN" ? sql`true` : me.teamId ? sql`r.team_id = ${me.teamId}` : sql`r.uid = ${me.id}`;
  const key =
    board === "team" ? sql`r.team_id` : board === "bdo" ? sql`case when u.role = 'BDO' then u.id when u.role = 'AGENT' then u.reports_to end` : sql`r.uid`;
  const rows = await db.execute<{ k: string | null; added: string; converted: string }>(sql`
    select ${key} as k, count(*) as added, count(*) filter (where r.won) as converted
      from (${ADDED(start, end)}) r left join users u on u.id = r.uid
     where ${scope}
     group by 1`);
  return new Map(rows.filter((r) => r.k).map((r) => [r.k!, toConversion(n(r.added), n(r.converted))]));
}

/**
 * This person's own conversion: an Agent's accounts; a BDO's and their
 * Agents'; a Team Leader's team; for Admins, everyone.
 */
export async function myConversion(me: Actor, start: Date, end: Date): Promise<Conversion & { label: string }> {
  const filter =
    me.role === "ADMIN"
      ? sql`true`
      : me.role === "TEAM_LEADER"
        ? me.teamId
          ? sql`r.team_id = ${me.teamId}`
          : sql`r.uid = ${me.id}`
        : me.role === "BDO"
          ? sql`(r.uid = ${me.id} or u.reports_to = ${me.id})`
          : sql`r.uid = ${me.id}`;
  const [row] = await db.execute<{ added: string; converted: string }>(sql`
    select count(*) as added, count(*) filter (where r.won) as converted
      from (${ADDED(start, end)}) r left join users u on u.id = r.uid
     where ${filter}`);
  const label = me.role === "ADMIN" ? "Conversion (everyone)" : me.role === "TEAM_LEADER" ? "Team conversion" : me.role === "BDO" ? "Conversion (you + agents)" : "My conversion";
  return { ...toConversion(n(row?.added), n(row?.converted)), label };
}

/**
 * Rankings for the leaderboard. Admins see everyone; everyone else sees their
 * own team. BDO figures include their agents (the BDO stored on each ledger
 * row), teams use the team stored on each row.
 */
export async function leaderboard(me: Actor, start: Date, end: Date, board: Board, sort: BoardSort): Promise<BoardRow[]> {
  const scope =
    me.role === "ADMIN" ? sql`true` : me.teamId ? sql`d.credited_team_id = ${me.teamId}` : sql`(d.credited_to = ${me.id} or d.credited_bdo_id = ${me.id})`;
  const key = board === "bdo" ? sql`d.credited_bdo_id` : board === "team" ? sql`d.credited_team_id` : sql`d.credited_to`;
  const money = await db.execute<Record<string, string | null>>(sql`
    with f as (${FIRSTS})
    select ${key} as k, ${splitSelect(start)}
      from disbursements d join accounts a on a.id = d.account_id left join f on f.account_id = d.account_id
     where ${scope} and ${key} is not null
       and d.disbursed_at >= ${start.toISOString()}::timestamptz and d.disbursed_at < ${end.toISOString()}::timestamptz
     group by 1`);
  const byKey = new Map(money.map((m) => [m.k!, toSplit(m)]));
  const conv = await conversionBy(me, start, end, board);

  // Everyone who could be on the board, so people with nothing yet still appear.
  const people =
    board === "team"
      ? await db.execute<{ id: string; name: string; sub: string | null; inactive: boolean }>(sql`
          select tm.id, tm.name, (select string_agg(u.name, ', ') from users u where u.team_id = tm.id and u.role = 'TEAM_LEADER' and u.status = 'ACTIVE') as sub, false as inactive
            from teams tm where ${me.role === "ADMIN" ? sql`true` : me.teamId ? sql`tm.id = ${me.teamId}` : sql`false`}`)
      : await db.execute<{ id: string; name: string; sub: string | null; inactive: boolean }>(sql`
          select u.id, u.name, tm.name as sub, (u.status <> 'ACTIVE') as inactive
            from users u left join teams tm on tm.id = u.team_id
           where u.role = ${board === "bdo" ? "BDO" : board === "tl" ? "TEAM_LEADER" : "AGENT"}
             and ${me.role === "ADMIN" ? sql`true` : me.teamId ? sql`u.team_id = ${me.teamId}` : sql`u.id = ${me.id}`}`);
  const empty = toSplit(undefined);
  const rows: BoardRow[] = people
    .map((p) => ({ id: p.id, name: p.name, sub: p.sub, inactive: Boolean(p.inactive), ...(byKey.get(p.id) ?? empty), ...(conv.get(p.id) ?? toConversion(0, 0)) }))
    // Inactive people only stay on the board if they earned something in the period.
    .filter((r) => !r.inactive || r.total !== 0 || r.added > 0);
  const metric = (r: BoardRow) =>
    sort === "existing" ? r.existingTotal : sort === "total" ? r.total : sort === "accounts" ? r.newAccounts : sort === "conversion" ? (r.rate ?? -1) : r.newTotal;
  return rows.sort((a, b) => metric(b) - metric(a) || b.total - a.total || a.name.localeCompare(b.name));
}
