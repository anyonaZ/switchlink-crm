import "server-only";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { STORAGE_DIR } from "@/lib/config";
import { lastMaintenance } from "@/lib/maintenance";
import { COMMIT, VERSION } from "@/lib/version";
import journal from "../../drizzle/meta/_journal.json";

export type Check = { ok: boolean; detail?: string; ms?: number };
export type Health = {
  status: "ok" | "degraded" | "down";
  version: string;
  commit: string;
  time: string;
  checks?: Record<string, Check>;
};

/** Backups older than this make the CRM "degraded" (nightly backup + a margin). */
export const BACKUP_MAX_AGE_H = 36;
/** A restore drill should pass at least monthly. */
export const DRILL_MAX_AGE_D = 40;

async function timed(fn: () => Promise<string | void>): Promise<Check> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message.slice(0, 200) : "failed" };
  }
}

export async function healthReport(detailed: boolean): Promise<Health> {
  const database = await timed(async () => {
    await db.execute(sql`select 1`);
  });
  const base = { version: VERSION, commit: COMMIT, time: new Date().toISOString() };
  if (!detailed) return { status: database.ok ? "ok" : "down", ...base };

  const migrations = await timed(async () => {
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const applied = Number(rows[0]?.n ?? 0);
    const expected = journal.entries.length;
    if (applied < expected) throw new Error(`${applied} of ${expected} migrations applied`);
    return `${applied} applied`;
  });
  const storage = await timed(async () => {
    const probe = path.join(STORAGE_DIR, `.health-${process.pid}`);
    await writeFile(probe, "ok", { mode: 0o600 });
    await unlink(probe);
  });
  const maintenance: Check = lastMaintenance.at
    ? {
        ok: Object.values(lastMaintenance.jobs).every((j) => j.ok) && Date.now() - lastMaintenance.at.getTime() < 2 * 3600_000,
        detail: `last run ${lastMaintenance.at.toISOString()}${Object.entries(lastMaintenance.jobs)
          .filter(([, j]) => !j.ok)
          .map(([k]) => `; ${k} failed`)
          .join("")}`,
      }
    : { ok: true, detail: "not run yet (starts 90 s after the server)" };
  const backup = await timed(async () => {
    const dir = process.env.BACKUP_DIR;
    if (!dir) return "not monitored (BACKUP_DIR not set)";
    const status = JSON.parse(await readFile(path.join(dir, "last-success.json"), "utf8")) as { at: string; offsite?: boolean; encrypted?: boolean };
    const ageH = (Date.now() - Date.parse(status.at)) / 3600_000;
    if (!(ageH <= BACKUP_MAX_AGE_H)) throw new Error(`last good backup ${Math.round(ageH)} h ago (${status.at})`);
    return `last good backup ${status.at}${status.encrypted ? ", encrypted" : ""}${status.offsite ? ", copied off-site" : ", NOT copied off-site"}`;
  });
  const restoreDrill = await timed(async () => {
    const dir = process.env.BACKUP_DIR;
    if (!dir) return "not monitored (BACKUP_DIR not set)";
    const raw = await readFile(path.join(dir, "last-drill.json"), "utf8").catch(() => null);
    if (!raw) throw new Error("no restore drill recorded yet: run scripts/restore-drill.sh");
    const d = JSON.parse(raw) as { at: string; ok: boolean; backup: string };
    const ageD = (Date.now() - Date.parse(d.at)) / 86400_000;
    if (!d.ok) throw new Error(`last restore drill FAILED (${d.at})`);
    if (!(ageD <= DRILL_MAX_AGE_D)) throw new Error(`last restore drill was ${Math.round(ageD)} days ago`);
    return `passed ${d.at} on backup ${d.backup}`;
  });
  const checks = { database, migrations, storage, maintenance, backup, restoreDrill };
  const status = !database.ok ? "down" : Object.values(checks).every((c) => c.ok) ? "ok" : "degraded";
  return { status, ...base, checks };
}
