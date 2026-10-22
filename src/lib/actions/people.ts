"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireRole, destroyUserSessions } from "@/lib/auth/session";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { loadPerson } from "@/lib/access";
import { canManageUser, canResetPassword, creatableRoles, type Role } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { fail, ok, okSecret, type ActionResult } from "@/lib/action-result";
import { randomToken } from "@/lib/crypto";

const ROLES: Role[] = ["AGENT", "BDO", "TEAM_LEADER", "ADMIN"];
const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
/** Temporary password shown once to whoever created or reset the account, e.g. "Sl-k3Rt9xQa-4821". */
const tempPassword = () => `Sl-${randomToken(6)}-${Math.floor(1000 + Math.random() * 9000)}`;

/** The dialog shown after creating a user or resetting a password. */
function signInDetails(title: string, name: string, email: string, password: string, id?: string) {
  const url = process.env.APP_URL && !/localhost/.test(process.env.APP_URL) ? process.env.APP_URL : null;
  return okSecret({
    title,
    label: "Temporary password",
    value: password,
    details: [
      { label: "Name", value: name },
      { label: "Sign-in email", value: email },
    ],
    note: `Give this to ${name} now. It won't be shown again. They'll set their own password when they sign in.`,
    shareText: [
      `Hi ${name}, here are your Switchlink CRM sign-in details:`,
      ...(url ? [url] : []),
      `Email: ${email}`,
      `Temporary password: ${password}`,
      "You'll be asked to set your own password when you sign in.",
    ].join("\n"),
  }, id);
}

function touch() {
  revalidatePath("/users");
  revalidatePath("/teams");
  revalidatePath("/dashboard");
}

/**
 * Checks a reporting line and works out the team that goes with it.
 * Agents must report to an active BDO (and join that BDO's team); BDOs may
 * report to a Team Leader; Team Leaders and Admins report to no one.
 */
async function resolveLine(role: Role, reportsToId: string | null, teamId: string | null) {
  if (role === "AGENT") {
    const boss = await loadPerson(reportsToId);
    if (!boss || boss.role !== "BDO" || boss.status !== "ACTIVE") return { error: "Choose the BDO this agent reports to." } as const;
    return { reportsTo: boss.id, teamId: boss.teamId } as const;
  }
  if (role === "BDO" && reportsToId) {
    const boss = await loadPerson(reportsToId);
    if (!boss || boss.role !== "TEAM_LEADER") return { error: "A BDO reports to a Team Leader." } as const;
    return { reportsTo: boss.id, teamId: teamId ?? boss.teamId } as const;
  }
  return { reportsTo: null, teamId } as const;
}

export async function createUser(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireRole(["ADMIN", "TEAM_LEADER", "BDO"]);
  const name = str(f, "name");
  const email = str(f, "email")?.toLowerCase() ?? null;
  const errs: Record<string, string> = {};
  if (!name) errs.name = "Required";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email";

  let role = (str(f, "role") ?? "AGENT") as Role;
  if (!creatableRoles(me).includes(role)) role = "AGENT";
  let reportsToId = str(f, "reports_to");
  let teamId = str(f, "team_id");
  if (me.role === "BDO") {
    // BDOs only add Agents, always under themselves.
    role = "AGENT";
    reportsToId = me.id;
  } else if (me.role === "TEAM_LEADER") {
    teamId = me.teamId;
    if (role === "BDO") reportsToId = me.id;
  } else if (teamId) {
    const [team] = await db.select({ id: t.teams.id }).from(t.teams).where(eq(t.teams.id, teamId));
    if (!team) errs.team_id = "Team not found";
  }
  const line = await resolveLine(role, reportsToId, teamId);
  if ("error" in line) errs.reports_to = line.error!;
  else if (me.role === "TEAM_LEADER" && line.teamId !== me.teamId) errs.reports_to = "Choose a BDO on your team.";

  let password = str(f, "password");
  if (password) {
    const p = passwordProblem(password);
    if (p) errs.password = p;
  } else password = tempPassword();
  if (Object.keys(errs).length) return fail("Some details need fixing.", errs);
  const [taken] = await db.select({ id: t.users.id }).from(t.users).where(sql`lower(${t.users.email}) = ${email}`);
  if (taken) return fail("Someone already uses that email.", { email: "Already in use" });
  if ("error" in line) return fail("Some details need fixing.");

  const [u] = await db
    .insert(t.users)
    .values({ name: name!, email: email!, passwordHash: await hashPassword(password), role, teamId: line.teamId, reportsTo: line.reportsTo, mustChangePassword: true })
    .returning({ id: t.users.id });
  await audit(me.id, "user.create", "user", u.id, { role, teamId: line.teamId, reportsTo: line.reportsTo });
  touch();
  return signInDetails(`${name} added`, name!, email!, password, u.id);
}

export async function resetPassword(userId: string): Promise<ActionResult> {
  const me = await requireRole(["ADMIN", "TEAM_LEADER"]);
  const target = await loadPerson(userId);
  if (!target || !canResetPassword(me, target)) return fail("You can't reset this person's password.");
  const password = tempPassword();
  await db
    .update(t.users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
    .where(eq(t.users.id, userId));
  await destroyUserSessions(userId);
  await audit(me.id, "user.reset_password", "user", userId);
  const [{ email }] = await db.select({ email: t.users.email }).from(t.users).where(eq(t.users.id, userId));
  return signInDetails(`New password for ${target.name}`, target.name, email, password);
}

/** Team Leaders and Admins move an Agent to another BDO. Past figures stay with the BDO at the time. */
export async function moveAgent(agentId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireRole(["ADMIN", "TEAM_LEADER"]);
  const agent = await loadPerson(agentId);
  if (!agent || agent.role !== "AGENT" || !canManageUser(me, agent)) return fail("You can't move this person.");
  const line = await resolveLine("AGENT", str(f, "reports_to"), null);
  if ("error" in line) return fail(line.error!);
  if (me.role === "TEAM_LEADER" && line.teamId !== me.teamId) return fail("Choose a BDO on your team.");
  await db.update(t.users).set({ reportsTo: line.reportsTo, teamId: line.teamId }).where(eq(t.users.id, agentId));
  await audit(me.id, "user.move_agent", "user", agentId, { reportsTo: line.reportsTo });
  touch();
  revalidatePath("/accounts");
  return ok(`${agent.name} moved.`);
}

export async function setUserStatus(userId: string, status: "ACTIVE" | "INACTIVE"): Promise<ActionResult> {
  const me = await requireRole(["ADMIN", "TEAM_LEADER", "BDO"]);
  const target = await loadPerson(userId);
  if (!target || !canManageUser(me, target)) return fail("You can't change this person.");
  await db.update(t.users).set({ status }).where(eq(t.users.id, userId));
  if (status === "INACTIVE") await destroyUserSessions(userId);
  await audit(me.id, status === "INACTIVE" ? "user.deactivate" : "user.reactivate", "user", userId);
  touch();
  return ok(status === "INACTIVE" ? `${target.name} deactivated and signed out. Their accounts and history stay as they are.` : `${target.name} reactivated.`);
}

export async function updateUser(userId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireRole(["ADMIN"]);
  const target = await loadPerson(userId);
  if (!target) return fail("Not found.");
  const role = str(f, "role") as Role | null;
  if (!role || !ROLES.includes(role)) return fail("Choose a role.");
  if (userId === me.id && role !== "ADMIN") return fail("You can't remove your own Admin role.");
  const requestedTeam = str(f, "team_id");
  if (requestedTeam) {
    const [team] = await db.select({ id: t.teams.id }).from(t.teams).where(eq(t.teams.id, requestedTeam));
    if (!team) return fail("Team not found.");
  }
  const line = await resolveLine(role, str(f, "reports_to"), requestedTeam);
  if ("error" in line) return fail(line.error!);
  const teamId = line.teamId;
  const moveAccounts = f.get("move_accounts") === "on";
  await db.transaction(async (tx) => {
    await tx.update(t.users).set({ role, teamId, reportsTo: line.reportsTo, name: str(f, "name") ?? target.name }).where(eq(t.users.id, userId));
    if (moveAccounts && teamId !== target.teamId) await tx.update(t.accounts).set({ teamId }).where(eq(t.accounts.ownerId, userId));
  });
  if (role !== target.role) await destroyUserSessions(userId);
  await audit(me.id, "user.update", "user", userId, { role, teamId, moveAccounts });
  touch();
  revalidatePath("/accounts");
  return ok("Saved.");
}

export async function createTeam(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireRole(["ADMIN"]);
  const name = str(f, "name");
  if (!name) return fail("Name the team.", { name: "Required" });
  const [team] = await db.insert(t.teams).values({ name }).returning({ id: t.teams.id });
  await audit(me.id, "team.create", "team", team.id, { name });
  touch();
  return ok(`Team "${name}" created.`);
}

export async function renameTeam(teamId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireRole(["ADMIN"]);
  const name = str(f, "name");
  if (!name) return fail("Name the team.", { name: "Required" });
  await db.update(t.teams).set({ name }).where(eq(t.teams.id, teamId));
  await audit(me.id, "team.rename", "team", teamId, { name });
  touch();
  return ok("Team renamed.");
}
