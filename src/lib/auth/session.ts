import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, lt, or, ne } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { IDLE_TIMEOUT_MS, SECURE_COOKIES, SESSION_MAX_AGE_MS } from "@/lib/config";
import { randomToken, sha256Hex } from "@/lib/crypto";
import type { User } from "@/lib/db/schema";
import { mustSetTargets, weekStartOf } from "@/lib/targets";

export const SESSION_COOKIE = "sl_session";
/** Only write last_seen_at when it is at least this stale, to spare the database. */
const TOUCH_EVERY_MS = 60 * 1000;

export type SessionUser = Pick<User, "id" | "name" | "email" | "role" | "teamId" | "status" | "mustChangePassword">;

export async function createSession(userId: string) {
  const token = randomToken();
  const h = await headers();
  const now = Date.now();
  await db.insert(t.sessions).values({
    id: sha256Hex(token),
    userId,
    expiresAt: new Date(now + SESSION_MAX_AGE_MS),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIES,
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
  // Opportunistic cleanup of dead sessions.
  await db
    .delete(t.sessions)
    .where(or(lt(t.sessions.expiresAt, new Date()), lt(t.sessions.lastSeenAt, new Date(now - IDLE_TIMEOUT_MS))));
}

/**
 * Resolves the signed-in user for this request (memoised per request).
 * A session is valid only if it exists, is under its hard cap, has been
 * active within the idle window, and belongs to an ACTIVE user. Every
 * check is server-side, so it can't be skipped by bypassing middleware.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256Hex(token);

  const rows = await db
    .select({
      lastSeenAt: t.sessions.lastSeenAt,
      expiresAt: t.sessions.expiresAt,
      user: {
        id: t.users.id,
        name: t.users.name,
        email: t.users.email,
        role: t.users.role,
        teamId: t.users.teamId,
        status: t.users.status,
        mustChangePassword: t.users.mustChangePassword,
      },
    })
    .from(t.sessions)
    .innerJoin(t.users, eq(t.users.id, t.sessions.userId))
    .where(eq(t.sessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now || now - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS || row.user.status !== "ACTIVE") {
    await db.delete(t.sessions).where(eq(t.sessions.id, id));
    return null;
  }
  if (now - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.update(t.sessions).set({ lastSeenAt: new Date(now) }).where(eq(t.sessions.id, id));
  }
  return row.user;
});

export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(t.sessions).where(eq(t.sessions.id, sha256Hex(token)));
  store.delete(SESSION_COOKIE);
}

/** Signs someone out everywhere, e.g. on deactivation or password reset. */
/** Signs a person out everywhere (or everywhere but this browser). Pass `tx` to make it part of a larger change. */
export async function destroyUserSessions(userId: string, exceptCurrent = false, tx: Pick<typeof db, "delete"> = db) {
  if (!exceptCurrent) {
    await tx.delete(t.sessions).where(eq(t.sessions.userId, userId));
    return;
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const keep = token ? sha256Hex(token) : "";
  await tx.delete(t.sessions).where(and(eq(t.sessions.userId, userId), ne(t.sessions.id, keep)));
}

/** Whether this BDO or Agent has set this week's targets (memoised per request). */
const hasWeekTarget = cache(async (userId: string) => {
  const [row] = await db
    .select({ id: t.weeklyTargets.id })
    .from(t.weeklyTargets)
    .where(and(eq(t.weeklyTargets.userId, userId), eq(t.weeklyTargets.weekStart, weekStartOf())));
  return Boolean(row);
});

/**
 * For pages and actions: the signed-in user, or a redirect to /login.
 * BDOs and Agents who haven't set this week's targets are sent to set them
 * first (pages that must stay open pass `skipTargets`).
 */
export async function requireUser(opts: { allowPasswordChange?: boolean; skipTargets?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  if (!opts.skipTargets && !opts.allowPasswordChange && mustSetTargets(user.role) && !(await hasWeekTarget(user.id))) redirect("/targets?required=1");
  return user;
}

export async function requireRole(roles: SessionUser["role"][]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}
