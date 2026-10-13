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
export function canViewAccount(a: Actor, acc: AccountRef) {
  if (isAdmin(a)) return true;
  if (isLeader(a)) return sameTeam(a, acc.teamId);
  if (acc.ownerId === a.id) return true;
  return isBdo(a) && !!acc.ownerId && acc.ownerReportsTo === a.id;
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
    if (!canViewAccount(a, acc) || newOwner === null) return false;
    return newOwner.id === a.id || (newOwner.role === "AGENT" && newOwner.reportsTo === a.id);
  }
  return false;
}

/** Captured locations: Team Leaders see their team's, Admins see all. */
export function canViewLocation(a: Actor, acc: AccountRef) {
  if (isAdmin(a)) return true;
  return isLeader(a) && sameTeam(a, acc.teamId);
}

/** Full national ID numbers: Admin only. Everyone else sees the last 4 digits. */
export function canViewFullIdNumber(a: Actor) {
  return isAdmin(a);
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

// --- Account status rules -------------------------------------------------
export type AccountKind = "SCHOOL" | "CORPORATE" | "MERCHANT" | "INDIVIDUAL";
export type AccountStatus = "ONGOING_ENGAGEMENT" | "DOCUMENT_COLLECTION" | "ACTIVE" | "INACTIVE";

export const STATUS_FLOW: Record<AccountKind, AccountStatus[]> = {
  MERCHANT: ["ONGOING_ENGAGEMENT", "DOCUMENT_COLLECTION", "ACTIVE", "INACTIVE"],
  INDIVIDUAL: ["ONGOING_ENGAGEMENT", "ACTIVE", "INACTIVE"],
  SCHOOL: ["ONGOING_ENGAGEMENT", "ACTIVE", "INACTIVE"],
  CORPORATE: ["ONGOING_ENGAGEMENT", "ACTIVE", "INACTIVE"],
};

/** Returns null if the move is allowed, else the reason it isn't. */
export function statusChangeProblem(
  acc: { kind: AccountKind; status: AccountStatus; pesiAccountNo: string | null; hasIdNumber: boolean },
  to: AccountStatus
): string | null {
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
  if (acc.kind === "INDIVIDUAL" && to === "ACTIVE" && !acc.hasIdNumber) {
    return "Record the client's national ID number first.";
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
  if (isBdo(a)) return or(eq(t.accounts.ownerId, a.id), inArray(t.accounts.ownerId, myAgents(a)))!;
  return eq(t.accounts.ownerId, a.id);
}

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
