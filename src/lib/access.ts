import "server-only";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, t } from "@/lib/db";
import { canViewAccount, type Actor, type PersonRef } from "@/lib/permissions";

export type Person = PersonRef & { name: string; status: "ACTIVE" | "INACTIVE" };

export async function loadPerson(id: string | null): Promise<Person | null> {
  if (!id) return null;
  const [u] = await db
    .select({ id: t.users.id, name: t.users.name, role: t.users.role, teamId: t.users.teamId, status: t.users.status, reportsTo: t.users.reportsTo })
    .from(t.users)
    .where(eq(t.users.id, id));
  return u ?? null;
}

/** The account with its owner's reporting line attached (for BDO visibility checks). */
async function accountWithLine(id: string) {
  const owner = alias(t.users, "owner");
  const [row] = await db
    .select({ acc: t.accounts, ownerReportsTo: owner.reportsTo })
    .from(t.accounts)
    .leftJoin(owner, eq(owner.id, t.accounts.ownerId))
    .where(eq(t.accounts.id, id));
  if (!row) return null;
  // BDOs on an approved corporate share can see and work the account too.
  const shared =
    row.acc.kind === "CORPORATE"
      ? await db
          .select({ userId: t.accountShareMembers.userId })
          .from(t.accountShareMembers)
          .innerJoin(t.accountShares, eq(t.accountShares.id, t.accountShareMembers.shareId))
          .where(and(eq(t.accountShares.accountId, id), eq(t.accountShares.status, "APPROVED")))
      : [];
  return { ...row.acc, ownerReportsTo: row.ownerReportsTo, sharedWith: shared.map((s) => s.userId) };
}

/** The account if this person may see it; otherwise a 404 (never reveals that it exists). */
export async function loadAccountFor(me: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const acc = await accountWithLine(id);
  if (!acc || !canViewAccount(me, acc)) notFound();
  return acc;
}

/** Same as loadAccountFor but for server actions: returns null instead of throwing a 404. */
export async function findAccountFor(me: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const acc = await accountWithLine(id);
  return acc && canViewAccount(me, acc) ? acc : null;
}
