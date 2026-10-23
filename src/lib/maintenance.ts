import "server-only";

/**
 * Hourly housekeeping, run in the app process (one office server, no queue):
 *  - delete individuals not activated within 30 days (src/lib/retention.ts);
 *  - delete expired bulk-upload previews, which hold customer details;
 *  - delete expired sessions, old sign-in throttle windows and week-old request keys.
 * Each job runs on its own, so one failing doesn't stop the rest. The last run
 * is reported by /api/health.
 */
type JobResult = { ok: boolean; detail?: string };
export const lastMaintenance: { at: Date | null; jobs: Record<string, JobResult> } = { at: null, jobs: {} };

export async function runMaintenance() {
  const jobs: Record<string, () => Promise<unknown>> = {
    retention: async () => (await import("@/lib/retention")).deleteExpiredIndividuals(),
    importPreviews: async () => (await import("@/lib/import/previews")).purgeExpiredPreviews(),
    sessions: async () => {
      const { db } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`delete from sessions where expires_at < now() or last_seen_at < now() - interval '1 hour'`);
    },
    signInThrottle: async () => (await import("@/lib/auth/throttle")).pruneSignInThrottle(),
    requestKeys: async () => (await import("@/lib/idempotency")).pruneRequestKeys(),
  };
  const results: Record<string, JobResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    try {
      const r = await job();
      results[name] = { ok: true, detail: r === undefined ? undefined : JSON.stringify(r).slice(0, 200) };
    } catch (e) {
      results[name] = { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "failed" };
      console.error(`[maintenance] ${name} failed`, e);
    }
  }
  lastMaintenance.at = new Date();
  lastMaintenance.jobs = results;
  return results;
}
