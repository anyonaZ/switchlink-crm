import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDecideSlot,
  canReassignAccount,
  canRequestShare,
  canViewAccount,
  equalPercents,
  requiredApprovalSlots,
  shareOutcome,
  sharePlanProblem,
  splitAmount,
  type Actor,
} from "../src/lib/permissions";

const A = "team-a", B = "team-b";
const admin: Actor = { id: "admin", role: "ADMIN", teamId: null, status: "ACTIVE" };
const leadA: Actor = { id: "leadA", role: "TEAM_LEADER", teamId: A, status: "ACTIVE" };
const leadB: Actor = { id: "leadB", role: "TEAM_LEADER", teamId: B, status: "ACTIVE" };
const bdoA: Actor = { id: "bdoA", role: "BDO", teamId: A, status: "ACTIVE" };
const bdoA2: Actor = { id: "bdoA2", role: "BDO", teamId: A, status: "ACTIVE" };
const agentA: Actor = { id: "agentA", role: "AGENT", teamId: A, status: "ACTIVE" };
const corp = { kind: "CORPORATE" as const, ownerId: bdoA.id, teamId: A, ownerReportsTo: leadA.id };
const agentCorp = { kind: "CORPORATE" as const, ownerId: agentA.id, teamId: A, ownerReportsTo: bdoA.id };

test("only the corporate's BDO (or their agent's BDO) can ask to share it, and only corporates", () => {
  assert.ok(canRequestShare(bdoA, corp));
  assert.ok(canRequestShare(bdoA, agentCorp), "BDO of the owning agent");
  assert.ok(!canRequestShare(bdoA2, corp), "another BDO");
  assert.ok(!canRequestShare(agentA, agentCorp), "agents don't request");
  assert.ok(!canRequestShare(leadA, corp));
  assert.ok(!canRequestShare(bdoA, { ...corp, kind: "SCHOOL" }));
  assert.ok(!canRequestShare({ ...bdoA, status: "INACTIVE" }, corp));
});

test("a split must include the requester, other active BDOs, and add up to exactly 100%", () => {
  const m = (userId: string, percent: number, role: Actor["role"] = "BDO", status: Actor["status"] = "ACTIVE") => ({ userId, percent, role, status });
  assert.equal(sharePlanProblem("bdoA", [m("bdoA", 50), m("bdoA2", 50)]), null);
  assert.equal(sharePlanProblem("bdoA", [m("bdoA", 33.34), m("bdoA2", 33.33), m("bdoB", 33.33)]), null);
  assert.match(sharePlanProblem("bdoA", [m("bdoA", 100)])!, /at least one other/);
  assert.match(sharePlanProblem("bdoA", [m("bdoA", 60), m("bdoA2", 50)])!, /110\.00%/);
  assert.match(sharePlanProblem("bdoA", [m("bdoA2", 50), m("bdoB", 50)])!, /You must be one/);
  assert.match(sharePlanProblem("bdoA", [m("bdoA", 50), m("agentA", 50, "AGENT")])!, /active BDOs/);
  assert.match(sharePlanProblem("bdoA", [m("bdoA", 50), m("bdoA2", 50, "BDO", "INACTIVE")])!, /active BDOs/);
  assert.match(sharePlanProblem("bdoA", [m("bdoA", 100), m("bdoA2", 0)])!, /more than 0%/);
  assert.match(sharePlanProblem("bdoA", [m("bdoA", 50.005), m("bdoA2", 49.995)])!, /two decimal/);
});

test("approvals: an Admin plus the Team Leader of every team involved", () => {
  assert.deepEqual(requiredApprovalSlots([A, A]), [{ role: "ADMIN", teamId: null }, { role: "TEAM_LEADER", teamId: A }]);
  assert.deepEqual(requiredApprovalSlots([B, A, null]), [
    { role: "ADMIN", teamId: null },
    { role: "TEAM_LEADER", teamId: A },
    { role: "TEAM_LEADER", teamId: B },
  ]);
});

test("who decides a slot: Admin slot = Admin; team slot = that team's leader (Admin only if the team has none)", () => {
  const adminSlot = { role: "ADMIN" as const, teamId: null };
  const slotA = { role: "TEAM_LEADER" as const, teamId: A };
  assert.ok(canDecideSlot(admin, adminSlot, true));
  assert.ok(!canDecideSlot(leadA, adminSlot, true), "a leader can't give the Admin approval");
  assert.ok(canDecideSlot(leadA, slotA, true));
  assert.ok(!canDecideSlot(leadB, slotA, true), "another team's leader");
  assert.ok(!canDecideSlot(admin, slotA, true), "Admin doesn't replace an existing leader");
  assert.ok(canDecideSlot(admin, slotA, false), "Admin stands in when the team has no leader");
  assert.ok(!canDecideSlot(bdoA, slotA, false));
  assert.ok(!canDecideSlot({ ...leadA, status: "INACTIVE" }, slotA, true));
});

test("outcome: any rejection rejects; approved only when every slot approves", () => {
  assert.equal(shareOutcome([{ decision: "APPROVED" }, { decision: "PENDING" }]), "PENDING");
  assert.equal(shareOutcome([{ decision: "APPROVED" }, { decision: "APPROVED" }]), "APPROVED");
  assert.equal(shareOutcome([{ decision: "APPROVED" }, { decision: "REJECTED" }]), "REJECTED");
  assert.equal(shareOutcome([]), "PENDING");
});

test("disbursement split always adds up to the cent", () => {
  assert.deepEqual(splitAmount(420000, [{ userId: "a", percent: 50 }, { userId: "b", percent: 50 }]), [
    { userId: "a", amount: 210000 },
    { userId: "b", amount: 210000 },
  ]);
  const three = splitAmount(100, [{ userId: "a", percent: 33.34 }, { userId: "b", percent: 33.33 }, { userId: "c", percent: 33.33 }]);
  assert.deepEqual(three.map((x) => x.amount), [33.34, 33.33, 33.33]);
  for (const amount of [0.01, 1, 999.99, 1234567.89, 10]) {
    const parts = splitAmount(amount, [{ userId: "a", percent: 33.33 }, { userId: "b", percent: 33.33 }, { userId: "c", percent: 33.34 }]);
    assert.equal(Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100), Math.round(amount * 100), `sum for ${amount}`);
  }
  assert.deepEqual(splitAmount(1000, [{ userId: "a", percent: 70 }, { userId: "b", percent: 30 }]).map((x) => x.amount), [700, 300]);
});

test("equal percentages add up to 100", () => {
  assert.deepEqual(equalPercents(2), [50, 50]);
  assert.deepEqual(equalPercents(3), [33.34, 33.33, 33.33]);
  for (let n = 1; n <= 6; n++) assert.equal(Math.round(equalPercents(n).reduce((s, x) => s + x * 100, 0)), 10000);
});

test("an approved share lets partner BDOs see the corporate, but not move it", () => {
  const shared = { ...corp, sharedWith: [bdoA.id, bdoA2.id] };
  assert.ok(!canViewAccount(bdoA2, corp));
  assert.ok(canViewAccount(bdoA2, shared));
  assert.ok(!canViewAccount(agentA, { ...shared, ownerId: "someone" }), "agents don't get shared access");
  assert.ok(!canReassignAccount(bdoA2, shared, { id: bdoA2.id, role: "BDO", teamId: A }), "a partner can't take the account");
  assert.ok(canReassignAccount(bdoA, shared, { id: bdoA.id, role: "BDO", teamId: A }));
});
