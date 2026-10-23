/**
 * Database regression tests for ledger and data integrity:
 *  - moving an Agent moves their accounts to the new team;
 *  - a ledger entry can only ever be reversed once, even with concurrent requests;
 *  - statement uploads are all-or-nothing, audit entry included;
 *  - statement reversals link to their draw (even from a later upload) and are
 *    never counted as draws or as a reason to mark Quick Finance Active;
 *  - migration 0007 repairs data saved before these fixes.
 *
 * Needs PostgreSQL. Uses (and drops) a throwaway database named <db>_itest next to
 * DATABASE_URL (or TEST_DATABASE_URL), and python3 with xlrd and xlwt.
 *   npm run test:db
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { loadEnv } from "../../scripts/env";

loadEnv();
const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL to run the database tests.");
const u = new URL(baseUrl);
const testDb = `${u.pathname.slice(1) || "crm"}_itest`;
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${testDb}`;
process.env.DATABASE_URL = testUrl.toString();

const work = mkdtempSync(path.join(tmpdir(), "crm-itest-"));
let sql: postgres.Sql;
// Loaded after DATABASE_URL points at the test database.
let ingest: typeof import("../../src/lib/statements/ingest");
let ledger: typeof import("../../src/lib/ledger");
let people: typeof import("../../src/lib/people-data");
let reports: typeof import("../../src/lib/reports");
let perms: typeof import("../../src/lib/permissions");
let dbm: typeof import("../../src/lib/db");

type Row = [serial: number, date: string, particulars: string, moneyIn: number, moneyOut: number];
/** Writes a statement in Pesi's .xls layout and reads it back with the real parser. */
async function statement(name: string, accountNo: string, from: string, to: string, opening: number, rows: Row[]) {
  const spec = path.join(work, `${name}.json`);
  const xls = path.join(work, `${name}.xls`);
  writeFileSync(spec, JSON.stringify({ owner: "TEST SHOP", account_no: accountNo, from, to, opening, rows }));
  execFileSync("python3", ["-I", "tests/fixtures/make_statement.py", spec, xls]);
  const parsed = await ingest.parseStatementFile(xls);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return { parsed: parsed.data, xls };
}

const ids: Record<string, string> = {};
async function seed() {
  const [admin] = await sql`insert into users (name, email, password_hash, role) values ('Admin', 'a@t.com', 'x', 'ADMIN') returning id`;
  const [ta] = await sql`insert into teams (name) values ('Team A') returning id`;
  const [tb] = await sql`insert into teams (name) values ('Team B') returning id`;
  const [tla] = await sql`insert into users (name, email, password_hash, role, team_id) values ('Leader A', 'tla@t.com', 'x', 'TEAM_LEADER', ${ta.id}) returning id`;
  const [tlb] = await sql`insert into users (name, email, password_hash, role, team_id) values ('Leader B', 'tlb@t.com', 'x', 'TEAM_LEADER', ${tb.id}) returning id`;
  const [ba] = await sql`insert into users (name, email, password_hash, role, team_id, reports_to) values ('BDO A', 'ba@t.com', 'x', 'BDO', ${ta.id}, ${tla.id}) returning id`;
  const [bb] = await sql`insert into users (name, email, password_hash, role, team_id, reports_to) values ('BDO B', 'bb@t.com', 'x', 'BDO', ${tb.id}, ${tlb.id}) returning id`;
  const [ag] = await sql`insert into users (name, email, password_hash, role, team_id, reports_to) values ('Agent', 'ag@t.com', 'x', 'AGENT', ${ta.id}, ${ba.id}) returning id`;
  Object.assign(ids, { admin: admin.id, ta: ta.id, tb: tb.id, tla: tla.id, tlb: tlb.id, ba: ba.id, bb: bb.id, ag: ag.id });
}
async function merchant(name: string, pesi: string, owner = ids.ag, team = ids.ta) {
  const [a] = await sql`insert into accounts (kind, name, pesi_account_no, owner_id, team_id, status, created_by)
                        values ('MERCHANT', ${name}, ${pesi}, ${owner}, ${team}, 'ACTIVE', ${ids.admin}) returning id`;
  const [o] = await sql`insert into opportunities (account_id, product, stage, owner_id) values (${a.id}, 'QUICK_FINANCE', 'INTERESTED', ${owner}) returning id`;
  return { id: a.id as string, opp: o.id as string };
}
const stage = async (opp: string) => (await sql`select stage from opportunities where id = ${opp}`)[0].stage as string;
const ledgerRows = (account: string) =>
  sql<{ id: string; amount: string; reverses_id: string | null; serial: string | null }[]>`
    select d.id, d.amount, d.reverses_id, l.serial_id as serial from disbursements d
      left join statement_lines l on l.id = d.statement_line_id
     where d.account_id = ${account} order by d.disbursed_at, d.created_at`;
const actor = (id: string, role: string, teamId: string | null) => ({ id, role, teamId, reportsTo: null }) as never;

before(async () => {
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${testDb}" with (force)`);
  await admin.unsafe(`create database "${testDb}"`);
  await admin.end();
  sql = postgres(testUrl.toString(), { max: 4, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  dbm = await import("../../src/lib/db");
  ingest = await import("../../src/lib/statements/ingest");
  ledger = await import("../../src/lib/ledger");
  people = await import("../../src/lib/people-data");
  reports = await import("../../src/lib/reports");
  perms = await import("../../src/lib/permissions");
  await seed();
});

after(async () => {
  await sql?.end();
  await (globalThis as { __crmSql?: postgres.Sql }).__crmSql?.end();
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${testDb}" with (force)`);
  await admin.end();
});

// ---------------------------------------------------------------------------
describe("1. moving an Agent", () => {
  test("their accounts move to the new team; Team Leaders see a consistent set; past credit stays", async () => {
    const accs = [await merchant("Move Shop 1", "3001"), await merchant("Move Shop 2", "3002"), await merchant("Move Shop 3", "3003")];
    await sql`insert into disbursements (account_id, product, amount, disbursed_at, credited_to, credited_bdo_id, credited_team_id, source)
              values (${accs[0].id}, 'QUICK_FINANCE', 1000, now(), ${ids.ag}, ${ids.ba}, ${ids.ta}, 'MANUAL')`;
    const visible = async (tl: string, team: string) =>
      (await dbm.db.select({ id: dbm.t.accounts.id }).from(dbm.t.accounts).where(perms.accountScope(actor(tl, "TEAM_LEADER", team)))).filter((r) =>
        accs.some((a) => a.id === r.id)
      ).length;
    assert.equal(await visible(ids.tla, ids.ta), 3);
    assert.equal(await visible(ids.tlb, ids.tb), 0);

    const moved = await people.moveAgentWithAccounts(ids.ag, { reportsTo: ids.bb, teamId: ids.tb });
    assert.ok(moved >= 3, `moved ${moved}`);
    const [agent] = await sql`select team_id, reports_to from users where id = ${ids.ag}`;
    assert.equal(agent.team_id, ids.tb);
    assert.equal(agent.reports_to, ids.bb);
    assert.equal(await visible(ids.tla, ids.ta), 0, "old team no longer sees them");
    assert.equal(await visible(ids.tlb, ids.tb), 3, "new team sees all of them");
    const [d] = await sql`select credited_team_id from disbursements where account_id = ${accs[0].id}`;
    assert.equal(d.credited_team_id, ids.ta, "money already credited stays with the old team");

    // Moving back repairs everything again (and is safe to repeat).
    await people.moveAgentWithAccounts(ids.ag, { reportsTo: ids.ba, teamId: ids.ta });
    assert.equal(await visible(ids.tla, ids.ta), 3);
    assert.equal(await people.moveAgentWithAccounts(ids.ag, { reportsTo: ids.ba, teamId: ids.ta }), 0);
  });

  test("a BDO changing team takes their Agents and everyone's accounts along", async () => {
    const own = await merchant("BDO Own Shop", "3010", ids.ba, ids.ta);
    const agentAcc = await merchant("Agent Shop", "3011", ids.ag, ids.ta);
    const moved = await dbm.db.transaction(async (tx) => {
      await tx.update(dbm.t.users).set({ teamId: ids.tb, reportsTo: ids.tlb }).where(eq(dbm.t.users.id, ids.ba));
      return people.followTeam(tx, ids.ba, ids.tb);
    });
    assert.ok(moved >= 2);
    const [agent] = await sql`select team_id from users where id = ${ids.ag}`;
    assert.equal(agent.team_id, ids.tb, "the Agent follows their BDO");
    const teams = await sql`select team_id from accounts where id in ${sql([own.id, agentAcc.id])}`;
    assert.ok(teams.every((r) => r.team_id === ids.tb));
    // Put things back for the tests below.
    await dbm.db.transaction(async (tx) => {
      await tx.update(dbm.t.users).set({ teamId: ids.ta, reportsTo: ids.tla }).where(eq(dbm.t.users.id, ids.ba));
      await people.followTeam(tx, ids.ba, ids.ta);
    });
  });
});

// ---------------------------------------------------------------------------
describe("3. reversing a ledger entry", () => {
  test("8 simultaneous reversals of one entry create exactly one negative row", async () => {
    const acc = await merchant("Reverse Shop", "3101");
    const [d] = await sql`insert into disbursements (account_id, product, amount, disbursed_at, credited_to, source)
                          values (${acc.id}, 'QUICK_FINANCE', 2500, now(), ${ids.ag}, 'MANUAL') returning id`;
    const results = await Promise.all(Array.from({ length: 8 }, () => ledger.reverseEntry(ids.admin, { id: d.id, splitGroupId: null }, "Reversal: test", "test")));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === "already_reversed").length, 7);
    const rows = await sql`select amount from disbursements where reverses_id = ${d.id}`;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), -2500);
    const [{ net }] = await sql`select sum(amount) as net from disbursements where account_id = ${acc.id}`;
    assert.equal(Number(net), 0);
  });

  test("a split entry reversed from two slices at once is reversed once per slice", async () => {
    const acc = await merchant("Split Corp", "3102");
    const group = crypto.randomUUID();
    const slices = await sql`insert into disbursements (account_id, product, amount, disbursed_at, credited_to, source, split_group_id)
                             values (${acc.id}, 'SALARY_ADVANCE', 6000, now(), ${ids.ba}, 'MANUAL', ${group}),
                                    (${acc.id}, 'SALARY_ADVANCE', 4000, now(), ${ids.bb}, 'MANUAL', ${group}) returning id`;
    const res = await Promise.all([
      ledger.reverseEntry(ids.admin, { id: slices[0].id, splitGroupId: group }, "Reversal: a", "a"),
      ledger.reverseEntry(ids.admin, { id: slices[1].id, splitGroupId: group }, "Reversal: b", "b"),
      ledger.reverseEntry(ids.admin, { id: slices[0].id, splitGroupId: group }, "Reversal: c", "c"),
    ]);
    assert.equal(res.filter((r) => r.ok).length, 1);
    const neg = await sql`select reverses_id from disbursements where account_id = ${acc.id} and amount < 0`;
    assert.equal(neg.length, 2);
    assert.equal(new Set(neg.map((r) => r.reverses_id)).size, 2);
  });

  test("the database itself refuses a second reversal of the same entry", async () => {
    const acc = await merchant("Guard Shop", "3103");
    const [d] = await sql`insert into disbursements (account_id, product, amount, disbursed_at, source) values (${acc.id}, 'QUICK_FINANCE', 100, now(), 'MANUAL') returning id`;
    await sql`insert into disbursements (account_id, product, amount, disbursed_at, source, reverses_id) values (${acc.id}, 'QUICK_FINANCE', -100, now(), 'MANUAL', ${d.id})`;
    await assert.rejects(
      sql`insert into disbursements (account_id, product, amount, disbursed_at, source, reverses_id) values (${acc.id}, 'QUICK_FINANCE', -100, now(), 'MANUAL', ${d.id})`,
      (e: { code?: string }) => e.code === "23505"
    );
    await assert.rejects(
      sql`insert into disbursements (account_id, product, amount, disbursed_at, source, reverses_id) values (${acc.id}, 'QUICK_FINANCE', -1, now(), 'MANUAL', ${crypto.randomUUID()})`,
      (e: { code?: string }) => e.code === "23503",
      "a reversal must point at a real entry"
    );
  });
});

// ---------------------------------------------------------------------------
// Statements modelled on the Pesi statements reviewed in October: a payment
// that goes into overdraft (only the part below zero is a draw), its switch
// charge and 1% processing fee on the same serial, daily overdraft charges,
// Paybill repayments, and a disbursement reversed by Pesi in the next month's
// statement (with its charge reversed too).
const SEPT: Row[] = [
  [101, "2026-09-02", "Pesi Pay Collection Transaction SLA1Q2W3E4R", 5000, 0],
  [102, "2026-09-03", "Pesi Pay Disbursement Transaction SLA42WNT0F808668 :: KAMAU SUPPLIES", 0, 16240],
  [102, "2026-09-03", "Switch Link Charge", 0, 71],
  [102, "2026-09-03", "Overdraft Processing Fee", 0, 162.4],
  [103, "2026-09-04", "Daily Overdraft Charges", 0, 73],
  [104, "2026-09-10", "SMALL BUSINESS PAY BILL FROM 25479****289 - TEST SHOP ACC. 3201", 12000, 0],
  [105, "2026-09-28", "Pesi Pay Disbursement Transaction SLA27MUKI6 :: WHOLESALER", 0, 5000],
  [105, "2026-09-28", "Switch Link Charge", 0, 71],
];
// October: starts by repeating the last two September lines (overlapping exports).
const OCT_OPENING = 2000 + 5000 - 16240 - 71 - 162.4 - 73 + 12000;
const OCT: Row[] = [
  [105, "2026-09-28", "Pesi Pay Disbursement Transaction SLA27MUKI6 :: WHOLESALER", 0, 5000],
  [105, "2026-09-28", "Switch Link Charge", 0, 71],
  [105, "2026-10-01", "Reversal :-Pesi Pay Disbursement Transaction SLA27MUKI6", 5000, 0],
  [105, "2026-10-01", "Reversal :-Switch Link Charge", 71, 0],
  [106, "2026-10-05", "Pesi Pay Collection Transaction SLA9Z8X7C6V", 1000, 0],
];

describe("4 and 5. statement uploads", () => {
  test("September: draws counted from the overdraft part only, QF marked Active", async () => {
    const acc = await merchant("Test Shop", "3201");
    ids.shop = acc.id;
    ids.shopOpp = acc.opp;
    const { parsed } = await statement("sept", "PA3201", "2026-09-01", "2026-09-30", 2000, SEPT);
    const res = await ingest.ingestStatement({ accountId: acc.id, uploadedBy: ids.admin, fileName: "sept.xls", filePath: "x", parsed });
    assert.equal(res.drawsNew, 2);
    assert.equal(res.drawsAmountNew, 9240 + 2546.4);
    assert.equal(res.reversalsNew, 0);
    assert.equal(await stage(acc.opp), "ACTIVE");
    const [a] = await sql`select count(*)::int as n from audit_log where action = 'statement.upload' and entity_id = ${acc.id}`;
    assert.equal(a.n, 1, "audit entry saved with the upload");
  });

  test("October: the reversal links to September's draw and is not counted as a draw", async () => {
    // Put the opportunity back, so we can see the reversal doesn't mark it Active.
    await sql`update opportunities set stage = 'INTERESTED' where id = ${ids.shopOpp}`;
    const { parsed } = await statement("oct", "PA3201", "2026-09-28", "2026-10-31", OCT_OPENING, OCT);
    const res = await ingest.ingestStatement({ accountId: ids.shop, uploadedBy: ids.admin, fileName: "oct.xls", filePath: "x", parsed });
    assert.equal(res.linesNew, 3, "the two overlapping lines are skipped");
    assert.equal(res.drawsNew, 0, "a reversal is not a new draw");
    assert.equal(res.drawsAmountNew, 0);
    assert.equal(res.reversalsNew, 1);
    assert.equal(res.reversedAmountNew, 2546.4);
    assert.equal(await stage(ids.shopOpp), "INTERESTED", "a reversal doesn't mark Quick Finance Active");

    const rows = await ledgerRows(ids.shop);
    const draw105 = rows.find((r) => r.serial === "105" && Number(r.amount) > 0)!;
    const rev = rows.find((r) => Number(r.amount) < 0)!;
    assert.equal(rev.reverses_id, draw105.id, "linked across uploads");
    assert.equal(Number(rev.amount), -2546.4);
    const [up] = await sql`select draws_new, reversals_new, reversed_amount_new from statement_uploads where id = ${res.uploadId}`;
    assert.deepEqual([up.draws_new, up.reversals_new, Number(up.reversed_amount_new)], [0, 1, 2546.4]);
  });

  test("reports: the reversed draw isn't counted as a draw or as the account's first disbursement", async () => {
    const admin = actor(ids.admin, "ADMIN", null);
    const sept = await reports.productTotals(admin, new Date("2026-09-01T00:00:00+03:00"), new Date("2026-10-01T00:00:00+03:00"));
    // Only this shop has statement draws in September in the test data.
    assert.equal(sept.qfDraws, 1, "the September draw that was later reversed isn't a draw");
    const [first] = await sql`
      select min(d0.disbursed_at) as first_at from disbursements d0
       where d0.account_id = ${ids.shop} and d0.amount > 0 and not exists (select 1 from disbursements r0 where r0.reverses_id = d0.id)`;
    assert.equal(new Date(first.first_at).toISOString().slice(0, 10), "2026-09-03");
  });

  test("uploading October again adds nothing", async () => {
    const { parsed } = await statement("oct2", "PA3201", "2026-09-28", "2026-10-31", OCT_OPENING, OCT);
    const res = await ingest.ingestStatement({ accountId: ids.shop, uploadedBy: ids.admin, fileName: "oct.xls", filePath: "x", parsed });
    assert.deepEqual([res.linesNew, res.drawsNew, res.reversalsNew], [0, 0, 0]);
    const negs = (await ledgerRows(ids.shop)).filter((r) => Number(r.amount) < 0);
    assert.equal(negs.length, 1);
  });

  test("a draw reversed in the same statement: counted apart, and QF isn't marked Active", async () => {
    const acc = await merchant("Same Month Shop", "3202");
    const { parsed } = await statement("same", "PA3202", "2026-10-01", "2026-10-31", 0, [
      [201, "2026-10-02", "Pesi Pay Disbursement Transaction SLB1 :: X", 0, 3000],
      [201, "2026-10-03", "Reversal :-Pesi Pay Disbursement Transaction SLB1", 3000, 0],
    ]);
    const res = await ingest.ingestStatement({ accountId: acc.id, uploadedBy: ids.admin, fileName: "s.xls", filePath: "x", parsed });
    assert.deepEqual([res.drawsNew, res.drawsAmountNew, res.reversalsNew, res.reversedAmountNew], [1, 3000, 1, 3000]);
    assert.equal(await stage(acc.opp), "INTERESTED");
    const rows = await ledgerRows(acc.id);
    assert.equal(rows[1].reverses_id, rows[0].id);
  });

  test("a reversal whose draw was never in the CRM records nothing", async () => {
    const acc = await merchant("Partial History Shop", "3203");
    const { parsed } = await statement("orphan", "PA3203", "2026-10-01", "2026-10-31", -4000, [
      [301, "2026-10-02", "Reversal :-Pesi Pay Disbursement Transaction SLC1", 4000, 0],
    ]);
    const res = await ingest.ingestStatement({ accountId: acc.id, uploadedBy: ids.admin, fileName: "s.xls", filePath: "x", parsed });
    assert.deepEqual([res.drawsNew, res.reversalsNew], [0, 0]);
    assert.equal((await ledgerRows(acc.id)).length, 0);
  });

  test("if the audit entry can't be written, nothing from the upload is kept", async () => {
    const acc = await merchant("Audit Fail Shop", "3204");
    const counts = async () =>
      (await sql`select (select count(*) from statement_uploads where account_id = ${acc.id})::int as up,
                        (select count(*) from statement_lines where account_id = ${acc.id})::int as lines,
                        (select count(*) from disbursements where account_id = ${acc.id})::int as disb`)[0];
    await sql.unsafe(`
      create function itest_fail_audit() returns trigger language plpgsql as $$
      begin if new.action = 'statement.upload' then raise exception 'audit store unavailable'; end if; return new; end $$;
      create trigger itest_fail_audit before insert on audit_log for each row execute function itest_fail_audit();`);
    try {
      const { parsed } = await statement("auditfail", "PA3204", "2026-10-01", "2026-10-31", 0, [
        [401, "2026-10-02", "Pesi Pay Disbursement Transaction SLD1 :: X", 0, 1500],
      ]);
      await assert.rejects(ingest.ingestStatement({ accountId: acc.id, uploadedBy: ids.admin, fileName: "s.xls", filePath: "x", parsed }), (e: Error & { cause?: Error }) =>
        /audit store unavailable/.test(`${e.message} ${e.cause?.message ?? ""}`)
      );
      assert.deepEqual(await counts(), { up: 0, lines: 0, disb: 0 });
      assert.equal(await stage(acc.opp), "INTERESTED");
    } finally {
      await sql.unsafe(`drop trigger itest_fail_audit on audit_log; drop function itest_fail_audit();`);
    }
    // With the audit log working again the same file goes in normally.
    const { parsed } = await statement("auditok", "PA3204", "2026-10-01", "2026-10-31", 0, [[401, "2026-10-02", "Pesi Pay Disbursement Transaction SLD1 :: X", 0, 1500]]);
    const res = await ingest.ingestStatement({ accountId: acc.id, uploadedBy: ids.admin, fileName: "s.xls", filePath: "x", parsed });
    assert.equal(res.drawsNew, 1);
  });
});

// ---------------------------------------------------------------------------
describe("migration 0007 repairs older data", () => {
  test("links old unlinked statement reversals, removes duplicate reversals, recounts uploads", async () => {
    // Recreate the pre-fix state: no constraints, old columns, bad rows.
    await sql.unsafe(`
      drop index disbursements_reverses_idx;
      alter table disbursements drop constraint disbursements_reverses_id_disbursements_id_fk;
      alter table statement_uploads drop column reversals_new, drop column reversed_amount_new;`);
    const acc = await merchant("Legacy Shop", "3301");
    const [up1] = await sql`insert into statement_uploads (account_id, file_name, accepted, lines_total) values (${acc.id}, 'a.xls', true, 1) returning id`;
    const [up2] = await sql`insert into statement_uploads (account_id, file_name, accepted, lines_total, draws_new, draws_amount_new) values (${acc.id}, 'b.xls', true, 1, 1, -800) returning id`;
    const line = async (up: string, kind: string, mi: number, mo: number) =>
      (await sql`insert into statement_lines (account_id, upload_id, serial_id, kind, posting_date, particulars, money_in, money_out, balance, od_before, od_after)
                 values (${acc.id}, ${up}, '501', ${kind}, '2026-09-01', 'x', ${mi}, ${mo}, 0, 0, 0) returning id`)[0].id;
    const l1 = await line(up1.id, "DISBURSEMENT", 0, 800);
    const l2 = await line(up2.id, "REVERSAL_DISBURSEMENT", 800, 0);
    const [draw] = await sql`insert into disbursements (account_id, product, amount, disbursed_at, source, statement_line_id) values (${acc.id}, 'QUICK_FINANCE', 800, '2026-09-01', 'STATEMENT', ${l1}) returning id`;
    const [rev] = await sql`insert into disbursements (account_id, product, amount, disbursed_at, source, statement_line_id) values (${acc.id}, 'QUICK_FINANCE', -800, '2026-09-02', 'STATEMENT', ${l2}) returning id`;
    const [manual] = await sql`insert into disbursements (account_id, product, amount, disbursed_at, source) values (${acc.id}, 'QUICK_FINANCE', 300, '2026-09-05', 'MANUAL') returning id`;
    await sql`insert into disbursements (account_id, product, amount, disbursed_at, source, reverses_id, created_at) values (${acc.id}, 'QUICK_FINANCE', -300, '2026-09-05', 'MANUAL', ${manual.id}, now() - interval '1 minute')`;
    const [dup] = await sql`insert into disbursements (account_id, product, amount, disbursed_at, source, reverses_id) values (${acc.id}, 'QUICK_FINANCE', -300, '2026-09-05', 'MANUAL', ${manual.id}) returning id`;

    const stale = await merchant("Stale Team Shop", "3302", ids.ag, ids.tb); // owner is on Team A
    const file = readFileSync("drizzle/0007_ledger_integrity.sql", "utf8");
    for (const stmt of file.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await sql.unsafe(stmt);

    const [st] = await sql`select team_id from accounts where id = ${stale.id}`;
    assert.equal(st.team_id, ids.ta, "account put back on its owner's team");
    assert.ok((await sql`select 1 from audit_log where action = 'account.team_repaired' and entity_id = ${stale.id}`).length);
    const [linked] = await sql`select reverses_id from disbursements where id = ${rev.id}`;
    assert.equal(linked.reverses_id, draw.id);
    const reversalsOfManual = await sql`select id from disbursements where reverses_id = ${manual.id}`;
    assert.equal(reversalsOfManual.length, 1);
    assert.notEqual(reversalsOfManual[0].id, dup.id, "the later duplicate is the one removed");
    const [log] = await sql`select detail from audit_log where action = 'disbursement.duplicate_reversal_removed' and entity_id = ${dup.id}`;
    assert.ok(log, "removal recorded in the audit log");
    const [{ net }] = await sql`select sum(amount) as net from disbursements where account_id = ${acc.id}`;
    assert.equal(Number(net), 0, "the ledger nets to zero again");
    const [u2] = await sql`select draws_new, draws_amount_new, reversals_new, reversed_amount_new from statement_uploads where id = ${up2.id}`;
    assert.deepEqual([u2.draws_new, Number(u2.draws_amount_new), u2.reversals_new, Number(u2.reversed_amount_new)], [0, 0, 1, 800]);
    await assert.rejects(
      sql`insert into disbursements (account_id, product, amount, disbursed_at, source, reverses_id) values (${acc.id}, 'QUICK_FINANCE', -300, now(), 'MANUAL', ${manual.id})`,
      (e: { code?: string }) => e.code === "23505",
      "constraint in place after the migration"
    );
  });
});
