/**
 * Statement analysis against real Pesi statements. The statements are
 * client data, so they are NOT kept in the repo: point STATEMENT_DIR at a
 * folder holding jasuba.xls and second.xls to run these checks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeStatement, classify, type ParsedStatement } from "../src/lib/statements/analyze";

const dir = process.env.STATEMENT_DIR;
const parse = (f: string) => JSON.parse(execFileSync("python3", ["-I", "tools/parse_statement.py", f]).toString()) as ParsedStatement & { ok: boolean };
const sumIn = (a: ReturnType<typeof analyzeStatement>, from: string, to: string) =>
  Math.round(a.lines.filter((l) => l.draw > 0 && l.date >= from && l.date < to).reduce((s, l) => s + l.draw, 0) * 100) / 100;

test("classifies line types", () => {
  assert.equal(classify("Pesi Pay Disbursement Transaction SLA42WNT0F808668 :: X"), "DISBURSEMENT");
  assert.equal(classify("Reversal :-Pesi Pay Disbursement Transaction SLA27MUKI6"), "REVERSAL_DISBURSEMENT");
  assert.equal(classify("Reversal :-Switch Link Charge"), "REVERSAL_CHARGE");
  assert.equal(classify("Daily Overdraft Charges"), "OD_DAILY_CHARGE");
  assert.equal(classify("SMALL BUSINESS PAY BILL FROM 25479****289 - X ACC. 3887"), "PAYBILL");
});

test("a payment from credit into overdraft only counts the part below zero", () => {
  const a = analyzeStatement({
    header: { owner: null, account_no: null, from: null, to: null, opening: null, closing: null },
    opening: 5000,
    problems: [],
    rows: [
      { row: 1, serial: "1", date: "2026-09-01", particulars: "Pesi Pay Disbursement Transaction A", money_in: 0, money_out: 16240, balance: -11240 },
      { row: 2, serial: "1", date: "2026-09-01", particulars: "Switch Link Charge", money_in: 0, money_out: 71, balance: -11311 },
      { row: 3, serial: "2", date: "2026-09-02", particulars: "Daily Overdraft Charges", money_in: 0, money_out: 73, balance: -11384 },
      { row: 4, serial: "3", date: "2026-09-03", particulars: "Pesi Pay Collection Transaction X", money_in: 20000, money_out: 0, balance: 8616 },
      { row: 5, serial: "4", date: "2026-09-04", particulars: "Pesi Pay Disbursement Transaction B", money_in: 0, money_out: 10000, balance: -1384 },
      { row: 6, serial: "4", date: "2026-09-05", particulars: "Reversal :-Pesi Pay Disbursement Transaction B", money_in: 10000, money_out: 0, balance: 8616 },
    ],
  });
  assert.deepEqual(a.errors, []);
  assert.deepEqual(a.lines.map((l) => l.draw), [11240, 0, 0, 0, 1384, -1384]);
  assert.equal(a.totals.drawn, 12624);
  assert.equal(a.totals.reversed, 1384);
});

test("rejects a statement whose running balance doesn't add up", () => {
  const a = analyzeStatement({
    header: { owner: null, account_no: null, from: null, to: null, opening: null, closing: null },
    opening: 0,
    problems: [],
    rows: [{ row: 1, serial: "1", date: "2026-09-01", particulars: "Pesi Pay Collection", money_in: 100, money_out: 0, balance: 90 }],
  });
  assert.equal(a.errors.length, 1);
});

const second = dir && path.join(dir, "second.xls");
test("second statement: September draws match the October review", { skip: !second || !existsSync(second) }, () => {
  const a = analyzeStatement(parse(second!));
  assert.deepEqual(a.errors, []);
  assert.equal(sumIn(a, "2026-09-01", "2026-10-01"), 181404.32);
  assert.equal(sumIn(a, "2026-10-01", "2026-11-01"), 13267);
  assert.equal(a.paybillAccountNo, "3887");
  assert.ok(a.feeMismatch.count > 0);
});

const jasuba = dir && path.join(dir, "jasuba.xls");
test("Jasuba: no draws in September or October, dormant warning", { skip: !jasuba || !existsSync(jasuba) }, () => {
  const a = analyzeStatement(parse(jasuba!));
  assert.deepEqual(a.errors, []);
  assert.equal(sumIn(a, "2026-09-01", "2026-11-01"), 0);
  assert.equal(a.totals.closingOd, 14375.35);
  assert.ok(a.warnings.some((w) => w.includes("growing only from charges")));
});
