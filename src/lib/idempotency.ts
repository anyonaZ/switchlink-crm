import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, t, type Tx } from "@/lib/db";

/**
 * Runs a write at most once per request key. Forms that record money send a
 * random key (see <RequestKey/>); if the same submission arrives twice (a
 * double tap, or a retry after a dropped signal), the second one gets the
 * first one's result instead of recording again.
 *
 * The key is claimed inside the same transaction as the write, so either both
 * are saved or neither is. A second request with the same key waits for the
 * first to finish, then replays its result.
 */
export const REQUEST_KEY_RE = /^[0-9a-f-]{36}$/i;

export async function runOnce<T extends Record<string, unknown>>(
  key: string | null,
  actorId: string,
  action: string,
  fn: (tx: Tx) => Promise<T>
): Promise<{ replayed: boolean; value: T }> {
  if (!key || !REQUEST_KEY_RE.test(key)) return { replayed: false, value: await db.transaction(fn) };
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(t.idempotencyKeys)
      .values({ key, actorId, action })
      .onConflictDoNothing()
      .returning({ key: t.idempotencyKeys.key });
    if (!claimed.length) {
      const [prev] = await tx
        .select({ result: t.idempotencyKeys.result })
        .from(t.idempotencyKeys)
        .where(and(eq(t.idempotencyKeys.key, key), eq(t.idempotencyKeys.actorId, actorId), eq(t.idempotencyKeys.action, action)));
      if (!prev) throw new Error("That request key belongs to a different action.");
      return { replayed: true, value: (prev.result ?? {}) as T };
    }
    const value = await fn(tx);
    await tx.update(t.idempotencyKeys).set({ result: value }).where(eq(t.idempotencyKeys.key, key));
    return { replayed: false, value };
  });
}

/** Keys are only needed for retries; the hourly maintenance drops them after a week. */
export async function pruneRequestKeys() {
  await db.execute(sql`delete from idempotency_keys where created_at < now() - interval '7 days'`);
}
