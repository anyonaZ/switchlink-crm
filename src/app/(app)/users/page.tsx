import { asc, eq } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { canManageUser, canResetPassword, creatableRoles, userScope } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/Page";
import Sheet from "@/components/ui/Sheet";
import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { ActionButton } from "@/components/Interactive";
import { createUser, moveAgent, resetPassword, setUserStatus, updateUser } from "@/lib/actions/people";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDateTime, initials } from "@/lib/format";
import type { User } from "@/lib/db/schema";

export const metadata = { title: "People" };
const RANK = { ADMIN: 0, TEAM_LEADER: 1, BDO: 2, AGENT: 3 } as const;

export default async function UsersPage() {
  const me = await requireRole(["BDO", "TEAM_LEADER", "ADMIN"]);
  const [rows, teams] = await Promise.all([
    db
      .select({ u: t.users, teamName: t.teams.name })
      .from(t.users)
      .leftJoin(t.teams, eq(t.teams.id, t.users.teamId))
      .where(userScope(me))
      .orderBy(asc(t.users.name)),
    db.select().from(t.teams).orderBy(t.teams.name),
  ]);
  const isAdmin = me.role === "ADMIN";
  const people = rows.map((r) => ({ ...r.u, teamName: r.teamName }));
  const byId = new Map(people.map((p) => [p.id, p]));
  const bdos = people.filter((p) => p.role === "BDO" && p.status === "ACTIVE");
  const leaders = people.filter((p) => p.role === "TEAM_LEADER" && p.status === "ACTIVE");
  const roles = creatableRoles(me);

  // Order the list as a tree: each person followed by the people who report to them.
  const ordered: { p: (typeof people)[number]; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (p: (typeof people)[number], depth: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    ordered.push({ p, depth });
    people.filter((c) => c.reportsTo === p.id).sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name)).forEach((c) => visit(c, depth + 1));
  };
  people
    .filter((p) => !p.reportsTo || !byId.has(p.reportsTo))
    .sort((a, b) => RANK[a.role] - RANK[b.role] || (a.teamName ?? "").localeCompare(b.teamName ?? "") || a.name.localeCompare(b.name))
    .forEach((p) => visit(p, 0));

  const lineOptions = (p?: Pick<User, "reportsTo">) => (
    <select id="reports_to" name="reports_to" className="input" defaultValue={p?.reportsTo ?? ""}>
      <option value="">No one</option>
      {bdos.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} (BDO{b.teamName ? `, ${b.teamName}` : ""})
        </option>
      ))}
      {isAdmin &&
        leaders.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} (Team Leader{l.teamName ? `, ${l.teamName}` : ""})
          </option>
        ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="People"
        subtitle={me.role === "BDO" ? "You and the agents who report to you." : me.role === "TEAM_LEADER" ? "Your team: BDOs and their agents." : "Everyone, by who they report to."}
        actions={
          <Sheet title={me.role === "BDO" ? "Add an agent" : "Add a person"} trigger={<><UserPlus size={18} /> Add</>} triggerClassName="btn-primary btn-sm">
            <ActionForm action={createUser}>
              <Field label="Full name" name="name">
                <input id="name" name="name" required className="input" />
              </Field>
              <Field label="Email" name="email" hint="They sign in with this.">
                <input id="email" name="email" type="email" required className="input" />
              </Field>
              {roles.length > 1 && (
                <Field label="Role" name="role">
                  <select id="role" name="role" className="input" defaultValue="AGENT">
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {me.role !== "BDO" && (
                <Field label="Reports to" name="reports_to" hint="Agents report to a BDO. A Team Leader's new BDOs report to them automatically.">
                  {lineOptions()}
                </Field>
              )}
              {isAdmin && (
                <Field label="Team" name="team_id" hint="Agents join their BDO's team automatically.">
                  <select id="team_id" name="team_id" className="input" defaultValue="">
                    <option value="">No team</option>
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {me.role === "BDO" && <p className="text-sm text-slate-500">They&apos;ll join as an Agent reporting to you. Their work counts towards your figures.</p>}
              <Field label="Temporary password (optional)" name="password" hint="Leave blank to generate one. They must change it at first sign-in.">
                <input id="password" name="password" type="text" autoComplete="off" className="input" />
              </Field>
              <Submit>Add</Submit>
            </ActionForm>
          </Sheet>
        }
      />
      <ul className="card divide-y divide-slate-100">
        {ordered.map(({ p: u, depth }) => {
          const manageable = canManageUser(me, u);
          const boss = u.reportsTo ? byId.get(u.reportsTo) : null;
          return (
            <li key={u.id} className="py-3 pr-4" style={{ paddingLeft: `${16 + Math.min(depth, 3) * 20}px` }}>
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    u.status !== "ACTIVE" ? "bg-slate-100 text-slate-400" : u.role === "AGENT" ? "bg-emerald-100 text-emerald-800" : "bg-brand-100 text-brand-700"
                  }`}
                >
                  {initials(u.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {u.name}
                    {u.id === me.id && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {ROLE_LABELS[u.role]}
                    {boss ? ` · reports to ${boss.name}` : ""}
                    {isAdmin && u.teamName ? ` · ${u.teamName}` : ""}
                    {u.status === "ACTIVE" ? "" : " · Inactive"}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {u.email} · {u.lastLoginAt ? `last in ${formatDateTime(u.lastLoginAt)}` : "never signed in"}
                  </p>
                </div>
              </div>
              {manageable && (
                <div className="mt-2 flex flex-wrap gap-2 pl-[52px]">
                  {canResetPassword(me, u) && (
                    <ActionButton run={resetPassword.bind(null, u.id)} confirmText={`Give ${u.name} a new temporary password? They'll be signed out.`}>
                      Reset password
                    </ActionButton>
                  )}
                  {u.status === "ACTIVE" ? (
                    <ActionButton
                      run={setUserStatus.bind(null, u.id, "INACTIVE")}
                      confirmText={`Deactivate ${u.name}? They'll be signed out. Their accounts and history stay.`}
                      className="btn-ghost btn-sm text-amber-700"
                    >
                      Deactivate
                    </ActionButton>
                  ) : (
                    <ActionButton run={setUserStatus.bind(null, u.id, "ACTIVE")} className="btn-ghost btn-sm text-green-700">
                      Reactivate
                    </ActionButton>
                  )}
                  {u.role === "AGENT" && me.role === "TEAM_LEADER" && (
                    <Sheet title={`Move ${u.name}`} trigger="Change BDO" triggerClassName="btn-ghost btn-sm">
                      <ActionForm action={moveAgent.bind(null, u.id)} resetOnSuccess={false}>
                        <Field label="Reports to" name="reports_to" hint="Past figures stay with the BDO they were earned under.">
                          {lineOptions(u)}
                        </Field>
                        <Submit>Move</Submit>
                      </ActionForm>
                    </Sheet>
                  )}
                  {isAdmin && (
                    <Sheet title={`Edit ${u.name}`} trigger="Role & team" triggerClassName="btn-ghost btn-sm">
                      <ActionForm action={updateUser.bind(null, u.id)} resetOnSuccess={false}>
                        <Field label="Name" name="name">
                          <input id="name" name="name" defaultValue={u.name} className="input" />
                        </Field>
                        <Field label="Role" name="role">
                          <select id="role" name="role" defaultValue={u.role} className="input">
                            {(["AGENT", "BDO", "TEAM_LEADER", "ADMIN"] as const).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Reports to" name="reports_to" hint="Agents: their BDO. BDOs: their Team Leader.">
                          {lineOptions(u)}
                        </Field>
                        <Field label="Team" name="team_id" hint="Agents always join their BDO's team.">
                          <select id="team_id" name="team_id" defaultValue={u.teamId ?? ""} className="input">
                            <option value="">No team</option>
                            {teams.map((tm) => (
                              <option key={tm.id} value={tm.id}>
                                {tm.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <label className="flex min-h-[44px] items-center gap-3 text-sm">
                          <input type="checkbox" name="move_accounts" className="h-5 w-5 rounded border-slate-300" /> Move their accounts to the new team too
                        </label>
                        <Submit>Save</Submit>
                      </ActionForm>
                    </Sheet>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
