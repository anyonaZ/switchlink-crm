import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, t, type Tx } from "@/lib/db";

/**
 * Keeps team scope consistent when someone changes team: Team Leaders see
 * accounts by the account's team, so an account's team always follows its
 * owner, and an Agent's team follows their BDO. Past disbursements keep the
 * team they were credited to (credit is fixed on the day).
 *
 * Moves the person's own accounts and, for a BDO, their Agents and the Agents'
 * accounts. Returns how many accounts changed team.
 */
export async function followTeam(tx: Tx, userId: string, teamId: string | null) {
  const [u] = await tx.select({ role: t.users.role }).from(t.users).where(eq(t.users.id, userId));
  const owners = [userId];
  if (u?.role === "BDO") {
    const agents = await tx
      .update(t.users)
      .set({ teamId })
      .where(and(eq(t.users.reportsTo, userId), eq(t.users.role, "AGENT")))
      .returning({ id: t.users.id });
    owners.push(...agents.map((a) => a.id));
  }
  const rows = await tx
    .update(t.accounts)
    .set({ teamId })
    .where(and(inArray(t.accounts.ownerId, owners), teamId ? sql`${t.accounts.teamId} is distinct from ${teamId}` : sql`${t.accounts.teamId} is not null`))
    .returning({ id: t.accounts.id });
  return rows.length;
}

/** Moves an Agent to another BDO (and that BDO's team), with their accounts, in one transaction. */
export async function moveAgentWithAccounts(
  agentId: string,
  line: { reportsTo: string | null; teamId: string | null },
  /** e.g. the audit entry, saved in the same transaction */
  alsoInTx?: (tx: Tx, accountsMoved: number) => Promise<unknown>
) {
  return db.transaction(async (tx) => {
    await tx.update(t.users).set({ reportsTo: line.reportsTo, teamId: line.teamId }).where(eq(t.users.id, agentId));
    const moved = await followTeam(tx, agentId, line.teamId);
    await alsoInTx?.(tx, moved);
    return moved;
  });
}
