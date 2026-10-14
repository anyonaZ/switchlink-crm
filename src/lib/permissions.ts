/**
 * Every access rule in the CRM lives in this file.
 *
 * Pure functions: they take the signed-in user and the records involved and
 * answer yes/no. Server actions and pages call them before reading or
 * writing anything; the scoping helpers at the bottom add the matching
 * WHERE clause to list queries so a page can't forget to filter.
 *
 * Hierarchy: ADMIN > TEAM_LEADER (a team) > BDO > AGENT.
 * An Agent reports to one BDO (users.reports_to); a BDO belongs to a team
 * led by a Team Leader. An Agent's work rolls up into their BDO's figures.
 */
import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import * as t from "@/lib/db/schema";

export type Role = "AGENT" | "BDO" | "TEAM_LEADER" | "ADMIN";
export interface Actor {
  id: string;
  role: Role;
  teamId: string | null;
  status: "ACTIVE" | "INACTIVE";
}
/** An account plus who its owner reports to (needed for a BDO's view of their Agents' accounts). */
export interface AccountRef {
  ownerId: string | null;
  teamId: string | null;
  ownerReportsTo?: string | null;
  /** BDOs on an APPROVED corporate share of this account (they see and work it too). */
  sharedWith?: string[];
}
export interface PersonRef {
  id: string;
  role: Role;
  teamId: string | null;
  reportsTo?: string | null;
}

const isAdmin = (a: Actor) => a.role === "ADMIN";
const isLeader = (a: Actor) => a.role === "TEAM_LEADER";
const isBdo = (a: Actor) => a.role === "BDO";
const sameTeam = (a: Actor, teamId: string | null) => a.teamId !== null && teamId === a.teamId;

/** People who see other people's work (used to show "owner" columns, filters and so on). */
export const isSupervisor = (a: Pick<Actor, "role">) => a.role !== "AGENT";

// --- Accounts -------------------------------------------------------------
/** Owner, or the owner's BDO. Sharing doesn't count here. */
function ownsOrManages(a: Actor, acc: AccountRef) {
  if (acc.ownerId === a.id) return true;
  return isBdo(a) && !!acc.ownerId && acc.ownerReportsTo === a.id;
}

export function canViewAccount(a: Actor, acc: AccountRef) {
  if (isAdmin(a)) return true;
  if (isLeader(a)) return sameTeam(a, acc.teamId);
  if (ownsOrManages(a, acc)) return true;
  return isBdo(a) && !!acc.sharedWith?.includes(a.id);
}

export function canEditAccount(a: Actor, acc: AccountRef) {
  if (a.status !== "ACTIVE") return false;
  return canViewAccount(a, acc);
}

/** Team Leaders move accounts within their team; BDOs between themselves and their own Agents. */
export function canReassignAccount(a: Actor, acc: AccountRef, newOwner: PersonRef | null) {
  if (isAdmin(a)) return true;
  if (isLeader(a)) return sameTeam(a, acc.teamId) && (newOwner === null || newOwner.teamId === a.teamId);
  if (isBdo(a)) {
    // A BDO who only shares the corporate can't move it.
    if (!ownsOrManages(a, acc) || newOwner === null) return false;
    return newOwner.id === a.id || (newOwner.role === "AGENT" && newOwner.reportsTo === a.id);
  }
  return false;
}

/** Captured locations: Team Leaders see their team's, Admins see all. */
export function canViewLocation(a: Actor, acc: AccountRef) {
  if (isAdmin(a)) return true;
  return isLeader(a) && sameTeam(a, acc.teamId);
}

/**
 * GPS capture is required at registration, except that an Admin may add
 * corporates and merchants from the office (e.g. leads from a list) without it.
 */
export function canSkipLocation(a: Pick<Actor, "role">, kind: AccountKind) {
  return a.role === "ADMIN" && (kind === "CORPORATE" || kind === "MERCHANT");
}

/** Only Admins verify merchants and individuals before they become Active. */
export function canVerifyAccount(a: Actor) {
  return isAdmin(a) && a.status === "ACTIVE";
}

// --- Money ----------------------------------------------------------------
/** QF limits, statement uploads and disbursements are recorded by Admins only. */
export function canManageQf(a: Actor) {
  return isAdmin(a);
}
export const canUploadStatement = canManageQf;
export function canRecordDisbursement(a: Actor) {
  return isAdmin(a);
}

// --- People -----------------------------------------------------------------
/** Who appears on the People page with an "Add" button. */
export function canManageUsers(a: Actor) {
  return isAdmin(a) || isLeader(a) || isBdo(a);
}

/** Roles this person may create. */
export function creatableRoles(a: Actor): Role[] {
  if (isAdmin(a)) return ["AGENT", "BDO", "TEAM_LEADER", "ADMIN"];
  if (isLeader(a)) return ["AGENT", "BDO"];
  if (isBdo(a)) return ["AGENT"];
  return [];
}

/**
 * Deactivate / reactivate someone. Admins: anyone but themselves. Team
 * Leaders: BDOs and Agents on their team. BDOs: their own Agents.
 */
export function canManageUser(a: Actor, target: PersonRef) {
  if (target.id === a.id) return false;
  if (isAdmin(a)) return true;
  if (isLeader(a)) return (target.role === "BDO" || target.role === "AGENT") && target.teamId === a.teamId;
  if (isBdo(a)) return target.role === "AGENT" && target.reportsTo === a.id;
  return false;
}

/** Password resets: Admins and Team Leaders only (BDOs ask their Team Leader). */
export function canResetPassword(a: Actor, target: PersonRef) {
  return !isBdo(a) && canManageUser(a, target);
}

export function canSeeTeamFigures(a: Actor) {
  return isAdmin(a) || isLeader(a) || isBdo(a);
}

/**
 * The BDO a disbursement or activity rolls up to: an Agent's BDO, a BDO
 * themselves, nobody for Team Leaders and Admins.
 */
export function bdoFor(person: Pick<PersonRef, "id" | "role" | "reportsTo"> | null): string | null {
  if (!person) return null;
  if (person.role === "BDO") return person.id;
  if (person.role === "AGENT") return person.reportsTo ?? null;
  return null;
}

// --- Corporate sharing -------------------------------------------------------
/**
 * BDOs who close a corporate together can ask to share it. The request
 * needs an Admin's approval and the Team Leader's approval for every team
 * the BDOs belong to. Once approved, each disbursement on the account is
 * split between them by percentage (see splitAmount).
 */
export type ApprovalRole = "ADMIN" | "TEAM_LEADER";
export type Decision = "PENDING" | "APPROVED" | "REJECTED";
export interface ApprovalSlot {
  role: ApprovalRole;
  teamId: string | null;
  decision: Decision;
}

/** A BDO may ask to share a corporate they own, or one owned by an Agent who reports to them. */
export function canRequestShare(a: Actor, acc: AccountRef & { kind: AccountKind }) {
  return a.status === "ACTIVE" && isBdo(a) && acc.kind === "CORPORATE" && ownsOrManages(a, acc);
}

export interface PlannedMember {
  userId: string;
  role: Role;
  status: "ACTIVE" | "INACTIVE";
  percent: number;
}
/** Null if the split is acceptable, else what's wrong with it. */
export function sharePlanProblem(requesterId: string, members: PlannedMember[]): string | null {
  if (members.length < 2) return "Choose at least one other BDO to share with.";
  if (members.length > 6) return "A corporate can be shared by at most 6 BDOs.";
  if (new Set(members.map((m) => m.userId)).size !== members.length) return "Each BDO can only appear once.";
  if (!members.some((m) => m.userId === requesterId)) return "You must be one of the BDOs sharing the corporate.";
  if (members.some((m) => m.role !== "BDO" || m.status !== "ACTIVE")) return "Corporates can only be shared between active BDOs.";
  for (const m of members) {
    if (!Number.isFinite(m.percent) || m.percent <= 0 || m.percent >= 100) return "Each BDO's share must be more than 0% and less than 100%.";
    if (Math.abs(m.percent * 100 - Math.round(m.percent * 100)) > 1e-6) return "Use at most two decimal places in the percentages.";
  }
  const total = members.reduce((s, m) => s + Math.round(m.percent * 100), 0);
  if (total !== 10000) return `The shares add up to ${(total / 100).toFixed(2)}%. They must add up to exactly 100%.`;
  return null;
}

/** An Admin always approves; so does the Team Leader of every team the BDOs are on. */
export function requiredApprovalSlots(memberTeamIds: (string | null)[]): { role: ApprovalRole; teamId: string | null }[] {
  const teams = [...new Set(memberTeamIds.filter((x): x is string => !!x))].sort();
  return [{ role: "ADMIN", teamId: null }, ...teams.map((teamId) => ({ role: "TEAM_LEADER" as const, teamId }))];
}

/**
 * Who may decide an approval slot. Team Leader slots belong to that team's
 * leader; an Admin may stand in only when the team has no active leader.
 */
export function canDecideSlot(a: Actor, slot: { role: Role; teamId: string | null }, teamHasLeader: boolean) {
  if (a.status !== "ACTIVE") return false;
  if (slot.role === "ADMIN") return isAdmin(a);
  if (slot.role !== "TEAM_LEADER") return false;
  if (isLeader(a)) return slot.teamId !== null && a.teamId === slot.teamId;
  return isAdmin(a) && !teamHasLeader;
}

/** Any rejection rejects the request; it's approved only when every slot is. */
export function shareOutcome(slots: Pick<ApprovalSlot, "decision">[]): Decision {
  if (slots.some((s) => s.decision === "REJECTED")) return "REJECTED";
  if (slots.length > 0 && slots.every((s) => s.decision === "APPROVED")) return "APPROVED";
  return "PENDING";
}

/** Equal percentages that add up to exactly 100 (e.g. 33.34, 33.33, 33.33). */
export function equalPercents(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(10000 / n);
  return Array.from({ length: n }, (_, i) => (base + (i < 10000 - base * n ? 1 : 0)) / 100);
}

/**
 * Splits an amount by percentage, to the cent, so the slices always add up
 * to exactly the amount. Leftover cents go to the largest remainders.
 */
export function splitAmount(amount: number, members: { userId: string; percent: number }[]): { userId: string; amount: number }[] {
  const cents = Math.round(amount * 100);
  const raw = members.map((m, i) => {
    const exact = (cents * Math.round(m.percent * 100)) / 10000;
    return { i, userId: m.userId, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = cents - raw.reduce((s, r) => s + r.floor, 0);
  for (const r of [...raw].sort((x, y) => y.rem - x.rem || x.i - y.i)) {
    if (left <= 0) break;
    r.floor += 1;
    left -= 1;
  }
  return raw.map((r) => ({ userId: r.userId, amount: r.floor / 100 }));
}

/** Which shares someone sees on the Sharing page. */
export function canSeeShare(a: Actor, s: { memberIds: string[]; memberTeamIds: (string | null)[]; requestedBy: string | null; accountTeamId: string | null }) {
  if (isAdmin(a)) return true;
  if (isLeader(a)) return !!a.teamId && (s.memberTeamIds.includes(a.teamId) || s.accountTeamId === a.teamId);
  if (isBdo(a)) return s.memberIds.includes(a.id) || s.requestedBy === a.id;
  return false;
}

// --- Account status rules -------------------------------------------------
export type AccountKind = "SCHOOL" | "CORPORATE" | "MERCHANT" | "INDIVIDUAL";
export type AccountStatus = "ONGOING_ENGAGEMENT" | "DOCUMENT_COLLECTION" | "PENDING_VERIFICATION" | "ACTIVE" | "INACTIVE";

/**
 * Statuses a person can choose for each kind of account. PENDING_VERIFICATION
 * isn't in these lists: the system sets it (see effectiveStatus).
 */
export const STATUS_FLOW: Record<AccountKind, AccountStatus[]> = {
  MERCHANT: ["ONGOING_ENGAGEMENT", "DOCUMENT_COLLECTION", "ACTIVE", "INACTIVE"],
  INDIVIDUAL: ["ONGOING_ENGAGEMENT", "ACTIVE", "INACTIVE"],
  SCHOOL: ["ONGOING_ENGAGEMENT", "ACTIVE", "INACTIVE"],
  CORPORATE: ["ONGOING_ENGAGEMENT", "ACTIVE", "INACTIVE"],
};

/** Merchants and individuals need an Admin's verification before they're Active. */
export const NEEDS_VERIFICATION: AccountKind[] = ["MERCHANT", "INDIVIDUAL"];

/**
 * The status an account actually gets when someone sets `to`. A non-Admin
 * making a merchant or individual Active sends it for verification instead.
 */
export function effectiveStatus(a: Pick<Actor, "role">, kind: AccountKind, to: AccountStatus): AccountStatus {
  return to === "ACTIVE" && NEEDS_VERIFICATION.includes(kind) && a.role !== "ADMIN" ? "PENDING_VERIFICATION" : to;
}

/**
 * Status of a newly registered account. An individual only needs a phone
 * number, so it goes straight to verification (an Admin's own are Active).
 */
export function initialStatus(a: Pick<Actor, "role">, kind: AccountKind): AccountStatus {
  return kind === "INDIVIDUAL" ? effectiveStatus(a, kind, "ACTIVE") : "ONGOING_ENGAGEMENT";
}

/** Returns null if the move is allowed, else the reason it isn't. */
export function statusChangeProblem(acc: { kind: AccountKind; status: AccountStatus; pesiAccountNo: string | null }, to: AccountStatus): string | null {
  if (acc.status === "PENDING_VERIFICATION") return "This account is waiting for an Admin to verify it.";
  const allowed = STATUS_FLOW[acc.kind];
  if (!allowed.includes(to)) return "That status doesn't apply to this kind of account.";
  if (to === acc.status) return "The account already has that status.";
  if (acc.kind === "MERCHANT") {
    if ((to === "DOCUMENT_COLLECTION" || to === "ACTIVE") && !/^\d{4}$/.test(acc.pesiAccountNo ?? "")) {
      return "Record the merchant's 4-digit Pesi account number first.";
    }
    if (to === "ACTIVE" && acc.status === "ONGOING_ENGAGEMENT") {
      return "Move the merchant to Document collection before making it active.";
    }
  }
  return null;
}

// --- Query scoping ----------------------------------------------------------
/** SQL list of the Agents reporting to this BDO. */
const myAgents = (a: Actor) => sql`(select u2.id from users u2 where u2.reports_to = ${a.id})`;

/** WHERE clause limiting `accounts` to what this person may see. */
export function accountScope(a: Actor): SQL {
  if (isAdmin(a)) return sql`true`;
  if (isLeader(a)) return a.teamId ? eq(t.accounts.teamId, a.teamId) : sql`false`;
  if (isBdo(a)) return or(eq(t.accounts.ownerId, a.id), inArray(t.accounts.ownerId, myAgents(a)), sharedWithMe(a, sql`${t.accounts.id}`))!;
  return eq(t.accounts.ownerId, a.id);
}

/** True for accounts on an APPROVED corporate share that includes this BDO. */
export const sharedWithMe = (a: Actor, accountId: SQL) =>
  sql`exists (select 1 from account_share_members sm join account_shares sh on sh.id = sm.share_id where sh.account_id = ${accountId} and sh.status = 'APPROVED' and sm.user_id = ${a.id})`;

/** WHERE clause limiting `users` to the people this person may see in pickers and rosters. */
export function userScope(a: Actor): SQL {
  if (isAdmin(a)) return sql`true`;
  if (isLeader(a)) return a.teamId ? eq(t.users.teamId, a.teamId) : eq(t.users.id, a.id);
  if (isBdo(a)) return or(eq(t.users.id, a.id), eq(t.users.reportsTo, a.id))!;
  return eq(t.users.id, a.id);
}

/** WHERE clause for the disbursement ledger. */
export function disbursementScope(a: Actor): SQL {
  if (isAdmin(a)) return sql`true`;
  if (isLeader(a)) return a.teamId ? eq(t.disbursements.creditedTeamId, a.teamId) : sql`false`;
  if (isBdo(a)) return or(eq(t.disbursements.creditedTo, a.id), eq(t.disbursements.creditedBdoId, a.id))!;
  return eq(t.disbursements.creditedTo, a.id);
}
