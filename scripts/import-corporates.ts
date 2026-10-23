/**
 * Loads a list of corporate leads into the CRM.
 *
 *   npm run import:corporates -- --file /path/to/leads.json
 *   npm run import:corporates -- --file /path/to/leads.json --owner "Sharon Achola" --leader "Lindsey Erodanga"
 *   npm run import:corporates -- --file /path/to/leads.json --dry-run   (shows what would happen, saves nothing)
 *
 * The lead list is client data: it is not kept in the repository or the Docker
 * image. Keep it on the server (e.g. in /opt/switchlink-private/) and pass its path;
 * see README → Importing a lead list.
 *
 * --owner and --leader take a full name or an email. Both people must already
 * exist (add them from People first): the owner as a BDO, the leader as a Team
 * Leader. Every corporate is owned by the BDO and sits on the leader's team,
 * so the Team Leader sees and manages all of them.
 *
 * Each corporate gets its contact person, a Salary Advance opportunity at the
 * stage from the list, and a note with anything that couldn't go in a field.
 * No GPS location is recorded (these weren't registered in the field).
 * Safe to run twice: corporates whose name already exists are skipped.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { loadEnv } from "./env";

loadEnv();
type Row = {
  name: string;
  industry: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  contact: string | null;
  stage: "NEW" | "CONTACTED" | "QUALIFIED" | "INTERESTED" | "PROPOSAL";
  listStatus: string | null;
  notes: string | null;
};

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dryRun = args.includes("--dry-run");
const file = opt("file", "");
if (!file) {
  console.error('Pass the lead list with --file, e.g. npm run import:corporates -- --file /opt/switchlink-private/corporates.json');
  process.exit(1);
}
const ownerKey = opt("owner", "Sharon Achola");
const leaderKey = opt("leader", "Lindsey Erodanga");
const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const fail = async (msg: string) => {
  console.error(msg);
  await sql.end();
  process.exit(1);
};

type U = { id: string; name: string; email: string; role: string; team_id: string | null; reports_to: string | null; status: string };
async function findUser(key: string) {
  const k = key.trim().toLowerCase();
  return sql<U[]>`select id, name, email, role, team_id, reports_to, status from users
                   where lower(email) = ${k} or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ${k.replace(/\s+/g, " ")}`;
}

const [owners, leaders, admins] = await Promise.all([
  findUser(ownerKey),
  findUser(leaderKey),
  sql<{ id: string }[]>`select id from users where role = 'ADMIN' and status = 'ACTIVE' order by created_at limit 1`,
]);
if (owners.length !== 1)
  await fail(`${owners.length ? "More than one" : "No"} user matches "${ownerKey}". Add them in People as a BDO first, or pass --owner with their email.`);
if (leaders.length !== 1)
  await fail(`${leaders.length ? "More than one" : "No"} user matches "${leaderKey}". Add them in People as a Team Leader first, or pass --leader with their email.`);
const owner = owners[0];
const leader = leaders[0];
if (owner.status !== "ACTIVE") await fail(`${owner.name} is inactive. Reactivate them first.`);
if (leader.role !== "TEAM_LEADER") await fail(`${leader.name} is a ${leader.role}, not a Team Leader. Change their role in People first.`);
if (!leader.team_id) await fail(`${leader.name} isn't on a team. Put them on a team in People first.`);
if (owner.role !== "BDO" && owner.role !== "TEAM_LEADER" && owner.role !== "AGENT")
  console.warn(`Note: ${owner.name} is a ${owner.role}. The corporates will still be assigned to them.`);
const teamId = leader.team_id!;
const createdBy = admins[0]?.id ?? owner.id;

// The owner should be on the leader's team, reporting to them, or the leader won't see the work roll up.
const fixLine = owner.role === "BDO" && (owner.team_id !== teamId || owner.reports_to !== leader.id);
if (fixLine) {
  if (owner.reports_to && owner.reports_to !== leader.id)
    console.warn(`Note: ${owner.name} reports to someone else. Moving them to report to ${leader.name}, on ${leader.name}'s team.`);
  else console.log(`${owner.name} will be put on ${leader.name}'s team, reporting to ${leader.name}.`);
}

const existing = new Set(
  (await sql<{ n: string }[]>`select lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) as n from accounts where kind = 'CORPORATE'`).map((r) => r.n)
);
const todo = rows.filter((r) => !existing.has(r.name.trim().toLowerCase().replace(/\s+/g, " ")));
console.log(`${rows.length} corporates in ${file}; ${rows.length - todo.length} already in the CRM; ${todo.length} to add for ${owner.name} (${leader.name}'s team).`);
if (dryRun) {
  for (const r of todo) console.log(`  + ${r.name}  [${r.stage}]  ${r.phone ?? ""} ${r.email ?? ""}`);
  console.log("Dry run: nothing saved.");
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  if (fixLine) await tx`update users set team_id = ${teamId}, reports_to = ${leader.id} where id = ${owner.id}`;
  for (const r of todo) {
    const [acc] = await tx<{ id: string }[]>`
      insert into accounts (kind, name, industry, phone, email, location_text, owner_id, team_id, status, created_by)
      values ('CORPORATE', ${r.name}, ${r.industry}, ${r.phone}, ${r.email}, ${r.location}, ${owner.id}, ${teamId}, 'ONGOING_ENGAGEMENT', ${createdBy})
      returning id`;
    await tx`insert into account_status_history (account_id, to_status, changed_by, note)
             values (${acc.id}, 'ONGOING_ENGAGEMENT', ${createdBy}, 'Imported from the lead list')`;
    if (r.contact) {
      const reception = /^receptionist$/i.test(r.contact);
      await tx`insert into contacts (account_id, name, job_title, phone, email)
               values (${acc.id}, ${reception ? "Reception" : r.contact}, ${reception ? "Receptionist" : null}, ${r.phone}, ${r.email})`;
    }
    const oppNotes = r.listStatus ? `Lead list status: ${r.listStatus}` : null;
    const [opp] = await tx<{ id: string }[]>`
      insert into opportunities (account_id, product, stage, owner_id, notes)
      values (${acc.id}, 'SALARY_ADVANCE', ${r.stage}, ${owner.id}, ${oppNotes}) returning id`;
    await tx`insert into opportunity_stage_history (opportunity_id, to_stage, changed_by) values (${opp.id}, 'NEW', ${createdBy})`;
    if (r.stage !== "NEW")
      await tx`insert into opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by) values (${opp.id}, 'NEW', ${r.stage}, ${createdBy})`;
    if (r.notes) await tx`insert into comments (account_id, author_id, body) values (${acc.id}, ${createdBy}, ${r.notes})`;
    await tx`insert into audit_log (actor_id, action, entity, entity_id, detail)
             values (${createdBy}, 'account.import', 'account', ${acc.id}, ${sql.json({ source: file, owner: owner.id })})`;
  }
});
console.log(`Done: ${todo.length} corporates added for ${owner.name}.`);
await sql.end();
