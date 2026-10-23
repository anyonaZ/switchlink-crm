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
import { checkSignInThrottle, clearSignInThrottle, clientIp } from "@/lib/auth/throttle";
import { fail, ok, type ActionResult } from "@/lib/action-result";


// A real hash, so unknown emails take as long to reject as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function login(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return fail("Enter your email and password.");

  const ip = clientIp((await headers()).get("x-forwarded-for"));
  const now = Date.now();
  const throttled = await checkSignInThrottle(ip, email);
  if (throttled) return fail(throttled);

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
    // One atomic update, so parallel wrong guesses all count.
    const [r] = await db
      .update(t.users)
      .set({
        failedLogins: sql`case when ${t.users.failedLogins} + 1 >= ${LOCKOUT_AFTER_FAILURES} then 0 else ${t.users.failedLogins} + 1 end`,
        lockedUntil: sql`case when ${t.users.failedLogins} + 1 >= ${LOCKOUT_AFTER_FAILURES} then ${new Date(now + LOCKOUT_MS).toISOString()}::timestamptz else null end`,
      })
      .where(eq(t.users.id, user.id))
      .returning({ lockedUntil: t.users.lockedUntil });
    if (r?.lockedUntil) await audit(user.id, "login.locked", "user", user.id, { ip });
    return fail(generic);
  }
  if (user.status !== "ACTIVE") return fail("This account has been deactivated. Contact your Team Leader or Admin.");

  await db.update(t.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(t.users.id, user.id));
  await createSession(user.id);
  await audit(user.id, "login", "user", user.id, { ip });
  await clearSignInThrottle(ip, email);
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

  const passwordHash = await hashPassword(next);
  // New password, other devices signed out, and the audit entry: all or nothing.
  await db.transaction(async (tx) => {
    await tx.update(t.users).set({ passwordHash, mustChangePassword: false }).where(eq(t.users.id, me.id));
    await destroyUserSessions(me.id, true, tx);
    await audit(me.id, "password.change", "user", me.id, undefined, tx);
  });
  return ok("Password changed.");
}

/** Anyone can change the name shown for them (their email and role are managed by an Admin). */
export async function updateMyName(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser({ skipTargets: true });
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) return fail("Enter your full name.", { name: "Required" });
  if (name.length > 120) return fail("That name is too long.", { name: "Too long" });
  if (name === me.name) return ok("No change.");
  await db.transaction(async (tx) => {
    await tx.update(t.users).set({ name }).where(eq(t.users.id, me.id));
    await audit(me.id, "user.rename_self", "user", me.id, { from: me.name, to: name }, tx);
  });
  revalidatePath("/", "layout");
  return ok("Name updated.");
}
