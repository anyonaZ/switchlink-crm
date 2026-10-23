import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Sign-in throttle kept in the database, so it survives restarts and holds
 * across app processes. Each hit is one atomic upsert, so parallel attempts
 * can't slip past the count.
 *
 * Two limits, so one person mistyping on shared office Wi-Fi or a mobile
 * carrier's shared IP doesn't block everyone else:
 *  - per email + IP: stops guessing one person's password;
 *  - per IP (much higher): stops one network spraying many accounts.
 * The per-user lockout (5 wrong passwords → 15 minutes) sits on top.
 */
export const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_PER_EMAIL_IP = 10;
export const MAX_PER_IP = 100;

/** Counts one attempt against `key`; returns the attempts in the current window. */
async function hit(key: string, windowMs = THROTTLE_WINDOW_MS) {
  const rows = await db.execute<{ count: number }>(sql`
    insert into login_throttle (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when login_throttle.window_start < now() - make_interval(secs => ${windowMs / 1000}) then 1 else login_throttle.count + 1 end,
      window_start = case when login_throttle.window_start < now() - make_interval(secs => ${windowMs / 1000}) then now() else login_throttle.window_start end
    returning count`);
  return Number(rows[0]?.count ?? 1);
}

export async function checkSignInThrottle(ip: string, email: string): Promise<null | string> {
  const [pair, net] = await Promise.all([hit(`ue:${ip}|${email}`), hit(`ip:${ip}`)]);
  if (pair > MAX_PER_EMAIL_IP) return "Too many sign-in attempts for this account. Wait 10 minutes and try again.";
  if (net > MAX_PER_IP) return "Too many sign-in attempts from this network. Wait 10 minutes and try again.";
  return null;
}

/** After a successful sign-in, that person's counter starts again. */
export async function clearSignInThrottle(ip: string, email: string) {
  await db.execute(sql`delete from login_throttle where key = ${`ue:${ip}|${email}`}`);
}

/** Old windows are deleted by the hourly maintenance sweep. */
export async function pruneSignInThrottle() {
  await db.execute(sql`delete from login_throttle where window_start < now() - interval '1 day'`);
}

/**
 * The client's address as Caddy reports it. Caddy sets X-Forwarded-For itself
 * (it doesn't pass on a client-supplied one), so the last entry is the one it added.
 */
export function clientIp(forwardedFor: string | null) {
  const parts = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.at(-1)?.slice(0, 64) ?? "local";
}
