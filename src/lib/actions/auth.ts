"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { LOCKOUT_AFTER_FAILURES, LOCKOUT_MS } from "@/lib/config";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyCurrentSession, destroyUserSessions, requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";

// Per-IP throttle for the login form (single-server deployment, so memory is fine).
const attemptsByIp = new Map<string, { count: number; resetAt: number }>();
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_ATTEMPTS = 30;

// A real hash, so unknown emails take as long to reject as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function login(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return fail("Enter your email and password.");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const bucket = attemptsByIp.get(ip);
  if (bucket && bucket.resetAt > now && bucket.count >= IP_MAX_ATTEMPTS) {
    return fail("Too many sign-in attempts from this network. Wait 10 minutes and try again.");
  }
  attemptsByIp.set(ip, bucket && bucket.resetAt > now ? { ...bucket, count: bucket.count + 1 } : { count: 1, resetAt: now + IP_WINDOW_MS });

  const [user] = await db.select().from(t.users).where(sql`lower(${t.users.email}) = ${email}`).limit(1);
  const generic = "That email and password don't match. Check them and try again.";

  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password-1");
    await verifyPassword(await dummyHash, password);
    return fail(generic);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    return fail("This account is locked for 15 minutes after too many wrong passwords. Ask your Team Leader or Admin if you're stuck.");
  }

  const good = await verifyPassword(user.passwordHash, password);
  if (!good) {
    const failures = user.failedLogins + 1;
    await db
      .update(t.users)
      .set({
        failedLogins: failures >= LOCKOUT_AFTER_FAILURES ? 0 : failures,
        lockedUntil: failures >= LOCKOUT_AFTER_FAILURES ? new Date(now + LOCKOUT_MS) : null,
      })
      .where(eq(t.users.id, user.id));
    if (failures >= LOCKOUT_AFTER_FAILURES) await audit(user.id, "login.locked", "user", user.id, { ip });
    return fail(generic);
  }
  if (user.status !== "ACTIVE") return fail("This account has been deactivated. Contact your Team Leader or Admin.");

  await db.update(t.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(t.users.id, user.id));
  await createSession(user.id);
  await audit(user.id, "login", "user", user.id, { ip });
  attemptsByIp.delete(ip);
  redirect(user.mustChangePassword ? "/change-password" : "/dashboard");
}

export async function logout() {
  await destroyCurrentSession();
  redirect("/login");
}

export async function changePassword(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser({ allowPasswordChange: true });
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const [row] = await db.select({ hash: t.users.passwordHash }).from(t.users).where(eq(t.users.id, me.id));
  if (!row || !(await verifyPassword(row.hash, current))) return fail("Your current password isn't right.", { current: "Wrong password" });
  const problem = passwordProblem(next);
  if (problem) return fail(problem, { next: problem });
  if (next !== confirm) return fail("The two new passwords don't match.", { confirm: "Doesn't match" });
  if (next === current) return fail("Choose a password different from the current one.", { next: "Same as current" });

  await db.update(t.users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(t.users.id, me.id));
  await destroyUserSessions(me.id, true);
  await audit(me.id, "password.change", "user", me.id);
  return ok("Password changed.");
}

/** Anyone can change the name shown for them (their email and role are managed by an Admin). */
export async function updateMyName(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) return fail("Enter your full name.", { name: "Required" });
  if (name.length > 120) return fail("That name is too long.", { name: "Too long" });
  if (name === me.name) return ok("No change.");
  await db.update(t.users).set({ name }).where(eq(t.users.id, me.id));
  await audit(me.id, "user.rename_self", "user", me.id, { from: me.name, to: name });
  revalidatePath("/", "layout");
  return ok("Name updated.");
}
