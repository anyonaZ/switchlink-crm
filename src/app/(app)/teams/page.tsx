import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/Page";
import Sheet from "@/components/ui/Sheet";
import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { createTeam, renameTeam } from "@/lib/actions/people";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  await requireRole(["ADMIN"]);
  const teams = await db.execute<{ id: string; name: string; members: string; accounts: string; leaders: string | null }>(sql`
    select tm.id, tm.name,
           (select count(*) from users u where u.team_id = tm.id and u.status = 'ACTIVE') as members,
           (select count(*) from accounts a where a.team_id = tm.id) as accounts,
           (select string_agg(u.name, ', ') from users u where u.team_id = tm.id and u.role = 'TEAM_LEADER') as leaders
      from teams tm order by tm.name`);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Teams"
        actions={
          <Sheet title="New team" trigger="New team" triggerClassName="btn-primary btn-sm">
            <ActionForm action={createTeam}>
              <Field label="Team name" name="name">
                <input id="name" name="name" required className="input" placeholder="e.g. Nairobi CBD" />
              </Field>
              <Submit>Create team</Submit>
            </ActionForm>
          </Sheet>
        }
      />
      <ul className="card divide-y divide-slate-100">
        {teams.map((tm) => (
          <li key={tm.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{tm.name}</p>
              <p className="truncate text-xs text-slate-500">
                {tm.members} active people · {tm.accounts} accounts · Leader: {tm.leaders ?? "none"}
              </p>
            </div>
            <Sheet title={`Rename ${tm.name}`} trigger="Rename" triggerClassName="btn-ghost btn-sm">
              <ActionForm action={renameTeam.bind(null, tm.id)}>
                <Field label="Team name" name="name">
                  <input id="name" name="name" defaultValue={tm.name} required className="input" />
                </Field>
                <Submit>Save</Submit>
              </ActionForm>
            </Sheet>
          </li>
        ))}
        {teams.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No teams yet.</li>}
      </ul>
      <p className="text-xs text-slate-500">Move people between teams from the People page.</p>
    </div>
  );
}
