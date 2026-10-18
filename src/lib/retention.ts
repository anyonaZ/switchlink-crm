import "server-only";
import { sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { accountScope, type Actor } from "@/lib/permissions";
import { INDIVIDUAL_ACTIVATION_DAYS, deletionDate } from "@/lib/targets";

/**
 * An individual account that never became Active within
 * INDIVIDUAL_ACTIVATION_DAYS of being added is deleted. Accounts with any
 * money on record (a disbursement or statement line) are always kept.
 */
const NEVER_ACTIVE = sql`a.kind = 'INDIVIDUAL' and a.status <> 'ACTIVE'
  and not exists (select 1 from account_status_history h where h.account_id = a.id and h.to_status = 'ACTIVE')
  and not exists (select 1 from disbursements d where d.account_id = a.id)
  and not exists (select 1 from statement_lines s where s.account_id = a.id)`;

/** Deletes expired individual accounts. Returns how many were removed. */
export async function deleteExpiredIndividuals(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INDIVIDUAL_ACTIVATION_DAYS * 86400000);
  const due = await db.execute<{ id: string; name: string; phone: string | null; owner_id: string | null; team_id: string | null; created_at: string; status: string }>(sql`
    select a.id, a.name, a.phone, a.owner_id, a.team_id, a.created_at, a.status from accounts a
     where ${NEVER_ACTIVE} and a.created_at < ${cutoff.toISOString()}::timestamptz
     limit 500`);
  for (const a of due) {
    await db.transaction(async (tx) => {
      await tx.insert(t.accountDeletions).values({
        accountId: a.id,
        kind: "INDIVIDUAL",
        name: a.name,
        phone: a.phone,
        ownerId: a.owner_id,
        teamId: a.team_id,
        accountCreatedAt: new Date(a.created_at),
        reason: `Not activated within ${INDIVIDUAL_ACTIVATION_DAYS} days (was ${a.status.replace(/_/g, " ").toLowerCase()})`,
      });
      await tx.delete(t.accounts).where(sql`${t.accounts.id} = ${a.id}`);
      await tx.insert(t.auditLog).values({
        actorId: null,
        action: "account.expired",
        entity: "account",
        entityId: a.id,
        detail: { name: a.name, ownerId: a.owner_id, createdAt: a.created_at },
      });
    });
  }
  if (due.length) console.log(`[retention] deleted ${due.length} individual account(s) not activated within ${INDIVIDUAL_ACTIVATION_DAYS} days`);
  return due.length;
}

/** For one account page: when it will be deleted, or null if it won't be. */
export async function deletionDateFor(accountId: string): Promise<Date | null> {
  const [row] = await db.execute<{ created_at: string }>(sql`select a.created_at from accounts a where a.id = ${accountId} and ${NEVER_ACTIVE}`);
  return row ? deletionDate(new Date(row.created_at)) : null;
}

/** Individual accounts this person can see that will be deleted within `days`. */
export async function expiringSoon(me: Actor, days = 7) {
  const from = new Date(Date.now() - INDIVIDUAL_ACTIVATION_DAYS * 86400000);
  const to = new Date(from.getTime() + days * 86400000);
  const rows = await db.execute<{ id: string; name: string; status: string; created_at: string; owner: string | null }>(sql`
    select a.id, a.name, a.status, a.created_at, u.name as owner
      from accounts a left join users u on u.id = a.owner_id
     where ${NEVER_ACTIVE} and a.id in (select accounts.id from accounts where ${accountScope(me)})
       and a.created_at >= ${from.toISOString()}::timestamptz and a.created_at < ${to.toISOString()}::timestamptz
     order by a.created_at limit 50`);
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, owner: r.owner, deletesOn: deletionDate(new Date(r.created_at)) }));
}
