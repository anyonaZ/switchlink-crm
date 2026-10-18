import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addTargets,
  canEditTarget,
  conversionRate,
  deletionDate,
  isMonday,
  mustSetTargets,
  pct,
  shiftWeek,
  targetProblem,
  weekRange,
  weekStartOf,
  ZERO,
} from "../src/lib/targets";

test("weeks start on Monday, Nairobi time", () => {
  // Sun 18 Oct 2026 23:30 Nairobi (20:30 UTC) is still the week of Mon 12 Oct.
  assert.equal(weekStartOf(new Date("2026-10-18T20:30:00Z")), "2026-10-12");
  // Mon 19 Oct 00:30 Nairobi (Sun 21:30 UTC) is the new week.
  assert.equal(weekStartOf(new Date("2026-10-18T21:30:00Z")), "2026-10-19");
  assert.equal(weekStartOf(new Date("2026-10-21T09:00:00Z")), "2026-10-19");
  const { start, end } = weekRange("2026-10-19");
  assert.equal(start.toISOString(), "2026-10-18T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-25T21:00:00.000Z");
  assert.equal(shiftWeek("2026-10-19", -1), "2026-10-12");
  assert.equal(shiftWeek("2026-12-28", 1), "2027-01-04");
  assert.ok(isMonday("2026-10-19") && !isMonday("2026-10-20") && !isMonday("junk"));
});

test("only BDOs and Agents must set targets", () => {
  assert.ok(mustSetTargets("BDO") && mustSetTargets("AGENT"));
  assert.ok(!mustSetTargets("TEAM_LEADER") && !mustSetTargets("ADMIN"));
});

test("targets can be changed only on the day they were set (Nairobi)", () => {
  const set = new Date("2026-10-19T06:00:00Z"); // Mon 09:00 Nairobi
  assert.ok(canEditTarget(set, new Date("2026-10-19T20:59:00Z"))); // Mon 23:59
  assert.ok(!canEditTarget(set, new Date("2026-10-19T21:01:00Z"))); // Tue 00:01
});

test("target form checks", () => {
  assert.equal(targetProblem({ individuals: 5, merchants: 2, corporates: 0, disbursement: 50000 }), null);
  assert.match(targetProblem(ZERO)!, /at least one/);
  assert.match(targetProblem({ ...ZERO, individuals: 1.5 })!, /whole numbers/);
  assert.match(targetProblem({ ...ZERO, merchants: -1 })!, /whole numbers/);
  assert.match(targetProblem({ ...ZERO, disbursement: Number.NaN })!, /KES/);
});

test("targets add up (agents into BDO, BDOs into team)", () => {
  const a = { individuals: 3, merchants: 1, corporates: 0, disbursement: 10000.1 };
  const b = { individuals: 2, merchants: 0, corporates: 1, disbursement: 20000.2 };
  assert.deepEqual(addTargets(a, b), { individuals: 5, merchants: 1, corporates: 1, disbursement: 30000.3 });
  assert.equal(pct(3, 4), 75);
  assert.equal(pct(6, 4), 150, "over-achievement isn't capped");
  assert.equal(pct(1, 0), null);
});

test("individuals are deleted 30 days after being added; conversion rate", () => {
  assert.equal(deletionDate(new Date("2026-10-01T09:00:00Z")).toISOString(), "2026-10-31T09:00:00.000Z");
  assert.equal(conversionRate(8, 2), 25);
  assert.equal(conversionRate(3, 1), 33.3);
  assert.equal(conversionRate(0, 0), null);
});
