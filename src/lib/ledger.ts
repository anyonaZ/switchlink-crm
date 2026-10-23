import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { audit } from "@/lib/audit";

/** Postgres "unique_violation": here, a reversal for that entry already exists. */
export const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
};

export type ReverseOutcome = { ok: true; rows: number } | { ok: false; reason: "already_reversed" };

/**
 * Adds the negative rows that reverse a ledger entry (every slice, for a split
 * shared-corporate entry). Permission checks are the caller's job.
 *
 * Safe against double submits and two Admins at once: the originals are locked
 * while checked, and the unique index on reverses_id makes a second reversal of
 * the same entry impossible at the database level.
 */
export async function reverseEntry(
  actorId: string,
  entry: { id: string; splitGroupId: string | null },
  note: string,
  reason: string
): Promise<ReverseOutcome> {
  try {
    const rows = await db.transaction(async (tx) => {
      const originals = await tx
        .select()
        .from(t.disbursements)
        .where(entry.splitGroupId ? and(eq(t.disbursements.splitGroupId, entry.splitGroupId), gt(t.disbursements.amount, "0")) : eq(t.disbursements.id, entry.id))
        .orderBy(t.disbursements.id)
        .for("update");
      const ids = originals.map((o) => o.id);
      const done = ids.length ? await tx.select({ id: t.disbursements.reversesId }).from(t.disbursements).where(inArray(t.disbursements.reversesId, ids)) : [];
      const reversed = new Set(done.map((r) => r.id));
      const todo = originals.filter((o) => !reversed.has(o.id));
      if (!todo.length) return 0;
      for (const o of todo) {
        await tx.insert(t.disbursements).values({
          accountId: o.accountId,
          opportunityId: o.opportunityId,
          product: o.product,
          amount: (-Number(o.amount)).toFixed(2),
          disbursedAt: o.disbursedAt,
          creditedTo: o.creditedTo,
          creditedBdoId: o.creditedBdoId,
          creditedTeamId: o.creditedTeamId,
          createdBy: actorId,
          source: "MANUAL",
          reversesId: o.id,
          shareId: o.shareId,
          splitGroupId: o.splitGroupId,
          notes: note,
        });
      }
      await audit(actorId, "disbursement.reverse", "disbursement", entry.id, { reason, splitGroupId: entry.splitGroupId ?? undefined, rows: todo.length }, tx);
      return todo.length;
    });
    return rows ? { ok: true, rows } : { ok: false, reason: "already_reversed" };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: "already_reversed" };
    throw e;
  }
}
