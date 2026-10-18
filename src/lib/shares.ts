import "server-only";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, t } from "@/lib/db";
import { canDecideSlot, canSeeShare, type Actor, type ApprovalRole, type Decision } from "@/lib/permissions";

export type ShareStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "ENDED";

export interface ShareView {
  id: string;
  accountId: string;
  accountName: string;
  accountTeamId: string | null;
  status: ShareStatus;
  note: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  endedAt: Date | null;
  members: { userId: string; name: string; percent: number; teamId: string | null; teamName: string | null }[];
  approvals: {
    id: string;
    role: ApprovalRole;
    teamId: string | null;
    teamName: string | null;
    decision: Decision;
    decidedByName: string | null;
    decidedAt: Date | null;
    reason: string | null;
    /** Filled by sharesFor(): whether the viewer may decide this slot now. */
    mine: boolean;
  }[];
}

/** Teams that have at least one active Team Leader (an Admin stands in for the others). */
export async function teamsWithLeaders(teamIds: string[]): Promise<Set<string>> {
  if (!teamIds.length) return new Set();
  const rows = await db
    .selectDistinct({ teamId: t.users.teamId })
    .from(t.users)
    .where(and(eq(t.users.role, "TEAM_LEADER"), eq(t.users.status, "ACTIVE"), inArray(t.users.teamId, teamIds)));
  return new Set(rows.map((r) => r.teamId!).filter(Boolean));
}

/** Loads shares (newest first) with their members and approvals. */
export async function loadShares(where: SQL, limit = 100): Promise<ShareView[]> {
  const requester = alias(t.users, "requester");
  const base = await db
    .select({ s: t.accountShares, accountName: t.accounts.name, accountTeamId: t.accounts.teamId, requestedByName: requester.name })
    .from(t.accountShares)
    .innerJoin(t.accounts, eq(t.accounts.id, t.accountShares.accountId))
    .leftJoin(requester, eq(requester.id, t.accountShares.requestedBy))
    .where(where)
    .orderBy(desc(t.accountShares.createdAt))
    .limit(limit);
  if (!base.length) return [];
  const ids = base.map((b) => b.s.id);
  const memberTeam = alias(t.teams, "member_team");
  const slotTeam = alias(t.teams, "slot_team");
  const decider = alias(t.users, "decider");
  const [members, approvals] = await Promise.all([
    db
      .select({ shareId: t.accountShareMembers.shareId, userId: t.accountShareMembers.userId, name: t.users.name, percent: t.accountShareMembers.percent, teamId: t.accountShareMembers.teamId, teamName: memberTeam.name })
      .from(t.accountShareMembers)
      .innerJoin(t.users, eq(t.users.id, t.accountShareMembers.userId))
      .leftJoin(memberTeam, eq(memberTeam.id, t.accountShareMembers.teamId))
      .where(inArray(t.accountShareMembers.shareId, ids)),
    db
      .select({ a: t.accountShareApprovals, teamName: slotTeam.name, decidedByName: decider.name })
      .from(t.accountShareApprovals)
      .leftJoin(slotTeam, eq(slotTeam.id, t.accountShareApprovals.teamId))
      .leftJoin(decider, eq(decider.id, t.accountShareApprovals.decidedBy))
      .where(inArray(t.accountShareApprovals.shareId, ids)),
  ]);
  return base.map(({ s, accountName, accountTeamId, requestedByName }) => ({
    id: s.id,
    accountId: s.accountId,
    accountName,
    accountTeamId,
    status: s.status,
    note: s.note,
    requestedBy: s.requestedBy,
    requestedByName,
    createdAt: s.createdAt,
    decidedAt: s.decidedAt,
    endedAt: s.endedAt,
    members: members
      .filter((m) => m.shareId === s.id)
      .map((m) => ({ userId: m.userId, name: m.name, percent: Number(m.percent), teamId: m.teamId, teamName: m.teamName }))
      .sort((x, y) => y.percent - x.percent || x.name.localeCompare(y.name)),
    approvals: approvals
      .filter((x) => x.a.shareId === s.id)
      .map((x) => ({ id: x.a.id, role: x.a.role as ApprovalRole, teamId: x.a.teamId, teamName: x.teamName, decision: x.a.decision, decidedByName: x.decidedByName, decidedAt: x.a.decidedAt, reason: x.a.reason, mine: false }))
      .sort((x, y) => (x.role === y.role ? (x.teamName ?? "").localeCompare(y.teamName ?? "") : x.role === "TEAM_LEADER" ? -1 : 1)),
  }));
}

/** Shares this person may see, with `mine` set on the slots they can decide. */
export async function sharesFor(me: Actor, extra?: SQL, limit = 100): Promise<ShareView[]> {
  if (me.role === "AGENT") return [];
  // Narrow in SQL first (same rule as canSeeShare), then double-check in code.
  let scope: SQL = sql`true`;
  if (me.role === "TEAM_LEADER")
    scope = me.teamId
      ? sql`(${t.accounts.teamId} = ${me.teamId} or exists (select 1 from account_share_members m where m.share_id = ${t.accountShares.id} and m.team_id = ${me.teamId}))`
      : sql`false`;
  if (me.role === "BDO")
    scope = sql`(${t.accountShares.requestedBy} = ${me.id} or exists (select 1 from account_share_members m where m.share_id = ${t.accountShares.id} and m.user_id = ${me.id}))`;
  const rows = (await loadShares(extra ? and(scope, extra)! : scope, limit)).filter((s) =>
    canSeeShare(me, { memberIds: s.members.map((m) => m.userId), memberTeamIds: s.members.map((m) => m.teamId), requestedBy: s.requestedBy, accountTeamId: s.accountTeamId })
  );
  const led = await teamsWithLeaders([...new Set(rows.flatMap((s) => s.approvals.map((a) => a.teamId)).filter((x): x is string => !!x))]);
  for (const s of rows)
    for (const a of s.approvals) a.mine = s.status === "PENDING" && a.decision === "PENDING" && canDecideSlot(me, a, a.teamId ? led.has(a.teamId) : false);
  return rows;
}

/** The approved share on an account right now, if any. */
export async function activeShare(accountId: string): Promise<ShareView | null> {
  const [s] = await loadShares(and(eq(t.accountShares.accountId, accountId), eq(t.accountShares.status, "APPROVED"))!, 1);
  return s ?? null;
}

/** How many requests are waiting on this person (for the dashboard and menu). */
export async function waitingOnMe(me: Actor): Promise<number> {
  if (me.role !== "ADMIN" && me.role !== "TEAM_LEADER") return 0;
  const pending = await sharesFor(me, eq(t.accountShares.status, "PENDING"), 200);
  return pending.filter((s) => s.approvals.some((a) => a.mine)).length;
}
