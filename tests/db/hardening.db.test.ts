/**
 * Database tests for the security/integrity hardening in migration 0008:
 * sign-in throttle, idempotent money writes, one individual per phone number,
 * activity ↔ opportunity consistency, bulk-upload preview expiry, the health
 * report, and the repair of existing data by the migration.
 *   npm run test:db
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "../../scripts/env";

loadEnv();
const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL to run the database tests.");
const testDb = `${new URL(baseUrl).pathname.slice(1) || "crm"}_htest`;
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${testDb}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "crm-htest-storage-"));

let sql: postgres.Sql;
let throttle: typeof import("../../src/lib/auth/throttle");
let once: typeof import("../../src/lib/idempotency");
let previews: typeof import("../../src/lib/import/previews");
let health: typeof import("../../src/lib/health");
let phone: typeof import("../../src/lib/phone");
let dbm: typeof import("../../src/lib/db");
const ids: Record<string, string> = {};

before(async () => {
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${testDb}" with (force)`);
  await admin.unsafe(`create database "${testDb}"`);
  await admin.end();
  sql = postgres(testUrl.toString(), { max: 6, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  dbm = await import("../../src/lib/db");
  throttle = await import("../../src/lib/auth/throttle");
  once = await import("../../src/lib/idempotency");
  previews = await import("../../src/lib/import/previews");
  health = await import("../../src/lib/health");
  phone = await import("../../src/lib/phone");
  const [a] = await sql`insert into users (name, email, password_hash, role) values ('Admin', 'a@t.com', 'x', 'ADMIN') returning id`;
  const [b] = await sql`insert into users (name, email, password_hash, role) values ('Other', 'o@t.com', 'x', 'BDO') returning id`;
  ids.admin = a.id;
  ids.other = b.id;
});

after(async () => {
  await sql?.end();
  await (globalThis as { __crmSql?: postgres.Sql }).__crmSql?.end();
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${testDb}" with (force)`);
  await admin.end();
});

const individual = (name: string, ph: string) =>
  sql`insert into accounts (kind, name, phone, status, created_by) values ('INDIVIDUAL', ${name}, ${ph}, 'PENDING_VERIFICATION', ${ids.admin}) returning id, phone_canonical`;

describe("sign-in throttle", () => {
  test("counts parallel attempts exactly, per email+IP, and resets after success", async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => throttle.checkSignInThrottle("10.0.0.1", "victim@t.com")));
    assert.equal(results.filter((r) => r === null).length, throttle.MAX_PER_EMAIL_IP, "exactly the allowed number got through");
    assert.match(results.find(Boolean)!, /for this account/);
    // Someone else on the same office IP isn't blocked by that.
    assert.equal(await throttle.checkSignInThrottle("10.0.0.1", "colleague@t.com"), null);
    await throttle.clearSignInThrottle("10.0.0.1", "victim@t.com");
    assert.equal(await throttle.checkSignInThrottle("10.0.0.1", "victim@t.com"), null);
  });

  test("one network spraying many accounts hits the per-IP ceiling", async () => {
    let blocked: string | null = null;
    for (let i = 0; i <= throttle.MAX_PER_IP && !blocked; i++) blocked = await throttle.checkSignInThrottle("10.9.9.9", `u${i}@t.com`);
    assert.match(blocked ?? "", /from this network/);
  });

  test("an expired window starts again", async () => {
    await sql`update login_throttle set window_start = now() - interval '11 minutes' where key like 'ue:10.0.0.1|%'`;
    for (let i = 0; i < throttle.MAX_PER_EMAIL_IP; i++) assert.equal(await throttle.checkSignInThrottle("10.0.0.1", "victim@t.com"), null);
  });

  test("client IP is the one Caddy added", () => {
    assert.equal(throttle.clientIp("6.6.6.6, 41.90.1.2"), "41.90.1.2");
    assert.equal(throttle.clientIp(null), "local");
  });
});

describe("idempotent money writes", () => {
  test("the same request key, sent 6 times at once, records one entry", async () => {
    const [acc] = await sql`insert into accounts (kind, name, status, created_by) values ('MERCHANT', 'Idem Shop', 'ACTIVE', ${ids.admin}) returning id`;
    const key = crypto.randomUUID();
    const run = () =>
      once.runOnce(key, ids.admin, "disbursement.record", async (tx) => {
        await tx.insert(dbm.t.disbursements).values({ accountId: acc.id, product: "QUICK_FINANCE", amount: "1000.00", disbursedAt: new Date(), source: "MANUAL" });
        return { message: "Recorded KES 1,000" };
      });
    const res = await Promise.all(Array.from({ length: 6 }, run));
    assert.equal(res.filter((r) => !r.replayed).length, 1);
    assert.ok(res.every((r) => r.value.message === "Recorded KES 1,000"), "replays return the first result");
    const [{ n }] = await sql`select count(*)::int as n from disbursements where account_id = ${acc.id}`;
    assert.equal(n, 1);
  });

  test("a failed write releases its key, so a retry can succeed", async () => {
    const key = crypto.randomUUID();
    await assert.rejects(once.runOnce(key, ids.admin, "disbursement.record", async () => Promise.reject(new Error("boom"))));
    const r = await once.runOnce(key, ids.admin, "disbursement.record", async () => ({ message: "second try" }));
    assert.deepEqual([r.replayed, r.value.message], [false, "second try"]);
  });

  test("a key can't be replayed by another user or for another action", async () => {
    const key = crypto.randomUUID();
    await once.runOnce(key, ids.admin, "qf_limit.set", async () => ({ message: "limit" }));
    await assert.rejects(once.runOnce(key, ids.other, "qf_limit.set", async () => ({ message: "x" })), /different action/);
    await assert.rejects(once.runOnce(key, ids.admin, "disbursement.record", async () => ({ message: "x" })), /different action/);
  });
});

describe("one individual per phone number", () => {
  test("the database's kenya_phone() matches the app's kenyanMobile()", async () => {
    const samples = ["0712345678", "+254 712 345 678", "254112345678", "712345678", "(0712)-345-678", "020 123456", "0812345678", "12", "07123456789", "+1 202 555 0100"];
    for (const s of samples) {
      const [{ v }] = await sql`select kenya_phone(${s}) as v`;
      assert.equal(v, phone.kenyanMobile(s)?.e164 ?? null, s);
    }
  });

  test("the same number in another format is refused by the database", async () => {
    const [first] = await individual("Grace One", "0712000111");
    assert.equal(first.phone_canonical, "+254712000111");
    for (const variant of ["+254712000111", "712 000 111", "254-712-000-111"])
      await assert.rejects(individual("Grace Dup", variant), (e: { code?: string; constraint_name?: string }) => e.code === "23505" && e.constraint_name === "accounts_individual_phone_idx", variant);
  });

  test("two people saving the same new number at the same moment: one wins", async () => {
    const res = await Promise.allSettled([individual("Race A", "0733444555"), individual("Race B", "+254733444555"), individual("Race C", "733444555")]);
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  });

  test("merchants may share a number (only individuals are unique)", async () => {
    await sql`insert into accounts (kind, name, phone, status, created_by) values ('MERCHANT', 'Shop A', '0799000111', 'ACTIVE', ${ids.admin}), ('MERCHANT', 'Shop B', '0799000111', 'ACTIVE', ${ids.admin})`;
  });
});

describe("activities and opportunities", () => {
  test("an activity can't point at another account's opportunity", async () => {
    const [a] = await sql`insert into accounts (kind, name, status, created_by) values ('SCHOOL', 'School A', 'ACTIVE', ${ids.admin}) returning id`;
    const [b] = await sql`insert into accounts (kind, name, status, created_by) values ('SCHOOL', 'School B', 'ACTIVE', ${ids.admin}) returning id`;
    const [oppB] = await sql`insert into opportunities (account_id, product, stage) values (${b.id}, 'SNPL', 'NEW') returning id`;
    await assert.rejects(
      sql`insert into activities (account_id, opportunity_id, type, status, created_by) values (${a.id}, ${oppB.id}, 'CALL', 'COMPLETED', ${ids.admin})`,
      (e: { code?: string }) => e.code === "23503"
    );
    const [ok] = await sql`insert into activities (account_id, opportunity_id, type, status, created_by) values (${b.id}, ${oppB.id}, 'CALL', 'COMPLETED', ${ids.admin}) returning id`;
    // Deleting the opportunity keeps the activity and just drops the link.
    await sql`delete from opportunities where id = ${oppB.id}`;
    const [after] = await sql`select opportunity_id, account_id from activities where id = ${ok.id}`;
    assert.deepEqual([after.opportunity_id, after.account_id], [null, b.id]);
  });
});

describe("bulk-upload previews", () => {
  test("private to the uploader, expire after the TTL, and are swept", async () => {
    const token = crypto.randomUUID();
    await previews.savePreview(token, { by: ids.admin, createdAt: new Date().toISOString(), rows: [{ name: "Grace", phone: "0712000999" }] });
    const file = path.join(previews.previewDir, `${token}.json`);
    assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);
    assert.equal((await previews.loadPreview(token, ids.other)).ok, false);
    assert.equal((await previews.loadPreview(token, ids.admin)).ok, true);
    const later = Date.now() + previews.PREVIEW_TTL_MS + 1000;
    assert.deepEqual(await previews.loadPreview(token, ids.admin, later), { ok: false, reason: "expired" });
    assert.equal(existsSync(file), false, "an expired preview is deleted when it's opened");

    const stale = crypto.randomUUID();
    const staleFile = path.join(previews.previewDir, `${stale}.json`);
    writeFileSync(staleFile, "{}");
    const old = (Date.now() - previews.PREVIEW_TTL_MS - 60_000) / 1000;
    utimesSync(staleFile, old, old);
    const { removed } = await previews.purgeExpiredPreviews();
    assert.ok(removed >= 1);
    assert.equal(existsSync(staleFile), false);
  });

  test("tokens can't be used to reach other files", async () => {
    assert.deepEqual(await previews.loadPreview("../../etc/passwd", ids.admin), { ok: false, reason: "missing" });
  });
});

describe("health report", () => {
  test("public view is minimal; detailed view checks database, migrations and storage", async () => {
    const pub = await health.healthReport(false);
    assert.equal(pub.status, "ok");
    assert.equal(pub.checks, undefined);
    const full = await health.healthReport(true);
    assert.ok(full.checks!.database.ok && full.checks!.migrations.ok && full.checks!.storage.ok, JSON.stringify(full.checks));
  });

  test("a stale or missing backup makes the CRM 'degraded'", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crm-htest-backups-"));
    process.env.BACKUP_DIR = dir;
    assert.equal((await health.healthReport(true)).status, "degraded", "no backup yet");
    writeFileSync(path.join(dir, "last-success.json"), JSON.stringify({ at: new Date(Date.now() - 50 * 3600_000).toISOString() }));
    assert.match((await health.healthReport(true)).checks!.backup.detail!, /50 h ago/);
    writeFileSync(path.join(dir, "last-success.json"), JSON.stringify({ at: new Date().toISOString(), encrypted: true, offsite: true }));
    assert.match((await health.healthReport(true)).checks!.restoreDrill.detail!, /no restore drill recorded/);
    writeFileSync(path.join(dir, "last-drill.json"), JSON.stringify({ at: new Date().toISOString(), ok: false, backup: "x" }));
    assert.equal((await health.healthReport(true)).status, "degraded", "a failed drill");
    writeFileSync(path.join(dir, "last-drill.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, backup: "2026-10-23T0133Z" }));
    const r = await health.healthReport(true);
    assert.equal(r.status, "ok", JSON.stringify(r.checks));
    assert.match(r.checks!.backup.detail!, /encrypted, copied off-site/);
    delete process.env.BACKUP_DIR;
  });
});

describe("migration 0008 on existing data", () => {
  test("flags (doesn't delete) individuals that already share a number, and unlinks cross-account activities", async () => {
    await sql.unsafe(`
      alter table activities drop constraint activities_opportunity_same_account_fk;
      drop index opportunities_id_account_idx;
      drop index accounts_individual_phone_idx;
      alter table accounts drop column phone_canonical, drop column phone_conflict;
      alter table kyc_documents drop column sha256;
      drop table idempotency_keys; drop table login_throttle;
      drop function kenya_phone(text);`);
    const [older] = await sql`insert into accounts (kind, name, phone, status, created_by, created_at) values ('INDIVIDUAL', 'First Wanjiku', '0700111222', 'ACTIVE', ${ids.admin}, now() - interval '2 days') returning id`;
    const [newer] = await sql`insert into accounts (kind, name, phone, status, created_by) values ('INDIVIDUAL', 'Second Wanjiku', '+254 700 111 222', 'PENDING_VERIFICATION', ${ids.admin}) returning id`;
    const [x] = await sql`insert into accounts (kind, name, status, created_by) values ('SCHOOL', 'X School', 'ACTIVE', ${ids.admin}) returning id`;
    const [y] = await sql`insert into accounts (kind, name, status, created_by) values ('SCHOOL', 'Y School', 'ACTIVE', ${ids.admin}) returning id`;
    const [oppY] = await sql`insert into opportunities (account_id, product, stage) values (${y.id}, 'SNPL', 'NEW') returning id`;
    const [act] = await sql`insert into activities (account_id, opportunity_id, type, status, created_by) values (${x.id}, ${oppY.id}, 'CALL', 'COMPLETED', ${ids.admin}) returning id`;

    const file = readFileSync("drizzle/0008_security_hardening.sql", "utf8");
    for (const stmt of file.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await sql.unsafe(stmt);

    const rows = await sql`select id, phone, phone_canonical, phone_conflict from accounts where id in ${sql([older.id, newer.id])}`;
    const o = rows.find((r) => r.id === older.id)!;
    const n = rows.find((r) => r.id === newer.id)!;
    assert.deepEqual([o.phone_conflict, n.phone_conflict], [false, true], "the newer one is flagged, nothing deleted");
    assert.equal(n.phone, "0700111222", "stored in the usual 07… form");
    const [log] = await sql`select detail from audit_log where action = 'account.phone_conflict' and entity_id = ${newer.id}`;
    assert.equal(log.detail.sameNumberAs, older.id);
    const [a2] = await sql`select opportunity_id from activities where id = ${act.id}`;
    assert.equal(a2.opportunity_id, null);
    // And the rule is now enforced.
    await assert.rejects(individual("Third Wanjiku", "0700 111 222"), (e: { code?: string }) => e.code === "23505");
  });
});
