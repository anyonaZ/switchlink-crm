import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bdoFor,
  canManageQf,
  canManageUser,
  canReassignAccount,
  canRecordDisbursement,
  canResetPassword,
  canAssignNewAccount,
  canBulkUpload,
  canSkipLocation,
  canUploadStatement,
  canViewAccount,
  canVerifyAccount,
  canViewLocation,
  creatableRoles,
  effectiveStatus,
  initialStatus,
  statusChangeProblem,
  type Actor,
} from "../src/lib/permissions";

const A = "team-a", B = "team-b";
const admin: Actor = { id: "admin", role: "ADMIN", teamId: null, status: "ACTIVE" };
const leadA: Actor = { id: "leadA", role: "TEAM_LEADER", teamId: A, status: "ACTIVE" };
const bdoA: Actor & { reportsTo: string } = { id: "bdoA", role: "BDO", teamId: A, status: "ACTIVE", reportsTo: leadA.id };
const bdoA2: Actor = { id: "bdoA2", role: "BDO", teamId: A, status: "ACTIVE" };
const agentA = { id: "agentA", role: "AGENT" as const, teamId: A, status: "ACTIVE" as const, reportsTo: bdoA.id };
const agentA2 = { id: "agentA2", role: "AGENT" as const, teamId: A, status: "ACTIVE" as const, reportsTo: bdoA2.id };
const bdoB = { id: "bdoB", role: "BDO" as const, teamId: B };
const bdoAcc = { ownerId: bdoA.id, teamId: A, ownerReportsTo: leadA.id };
const agentAcc = { ownerId: agentA.id, teamId: A, ownerReportsTo: bdoA.id };
const otherAgentAcc = { ownerId: agentA2.id, teamId: A, ownerReportsTo: bdoA2.id };
const otherTeamAcc = { ownerId: bdoB.id, teamId: B, ownerReportsTo: null };

test("agents see their own accounts; BDOs theirs plus their agents'; leaders their team; admins all", () => {
  assert.ok(canViewAccount(agentA, agentAcc));
  assert.ok(!canViewAccount(agentA, bdoAcc), "an agent can't see the BDO's own accounts");
  assert.ok(canViewAccount(bdoA, bdoAcc));
  assert.ok(canViewAccount(bdoA, agentAcc));
  assert.ok(!canViewAccount(bdoA, otherAgentAcc), "not another BDO's agents");
  assert.ok(canViewAccount(leadA, agentAcc));
  assert.ok(canViewAccount(leadA, otherAgentAcc));
  assert.ok(!canViewAccount(leadA, otherTeamAcc));
  assert.ok(canViewAccount(admin, otherTeamAcc));
});

test("BDOs reassign only between themselves and their own agents", () => {
  assert.ok(canReassignAccount(bdoA, bdoAcc, agentA));
  assert.ok(canReassignAccount(bdoA, agentAcc, { id: bdoA.id, role: "BDO", teamId: A }));
  assert.ok(!canReassignAccount(bdoA, agentAcc, agentA2));
  assert.ok(!canReassignAccount(agentA, agentAcc, agentA));
});

test("locations: leaders for their team, never BDOs or agents", () => {
  assert.ok(canViewLocation(leadA, agentAcc));
  assert.ok(!canViewLocation(leadA, otherTeamAcc));
  assert.ok(!canViewLocation(bdoA, agentAcc));
  assert.ok(!canViewLocation(agentA, agentAcc));
});

test("QF limits, statements and disbursements: Admin only", () => {
  for (const who of [leadA, bdoA, agentA]) {
    assert.ok(!canManageQf(who));
    assert.ok(!canUploadStatement(who));
    assert.ok(!canRecordDisbursement(who));
  }
  assert.ok(canManageQf(admin) && canUploadStatement(admin) && canRecordDisbursement(admin));
});

test("people: leaders manage their team's BDOs and agents; BDOs their own agents", () => {
  assert.ok(canManageUser(leadA, agentA));
  assert.ok(canManageUser(leadA, bdoA));
  assert.ok(!canManageUser(leadA, bdoB));
  assert.ok(!canManageUser(leadA, { id: "leadA2", role: "TEAM_LEADER", teamId: A }));
  assert.ok(canManageUser(bdoA, agentA));
  assert.ok(!canManageUser(bdoA, agentA2), "not another BDO's agent");
  assert.ok(!canManageUser(bdoA, bdoA2));
  assert.ok(!canManageUser(agentA, agentA2));
  assert.ok(!canResetPassword(bdoA, agentA), "BDOs ask their Team Leader for resets");
  assert.ok(canResetPassword(leadA, agentA));
  assert.ok(!canManageUser(admin, { id: "admin", role: "ADMIN", teamId: null }), "nobody manages themselves");
  assert.deepEqual(creatableRoles(bdoA), ["AGENT"]);
  assert.deepEqual(creatableRoles(agentA), []);
});

test("work rolls up: an agent's BDO, a BDO themselves, nobody above", () => {
  assert.equal(bdoFor(agentA), bdoA.id);
  assert.equal(bdoFor(bdoA), bdoA.id);
  assert.equal(bdoFor({ id: leadA.id, role: "TEAM_LEADER" }), null);
  assert.equal(bdoFor(null), null);
});

test("merchant status needs a 4-digit Pesi number; individuals need nothing but a phone", () => {
  const m = { kind: "MERCHANT" as const, status: "ONGOING_ENGAGEMENT" as const, pesiAccountNo: null };
  assert.match(statusChangeProblem(m, "DOCUMENT_COLLECTION")!, /4-digit/);
  assert.equal(statusChangeProblem({ ...m, pesiAccountNo: "3887" }, "DOCUMENT_COLLECTION"), null);
  assert.match(statusChangeProblem({ ...m, pesiAccountNo: "3887" }, "ACTIVE")!, /Document collection/);
  const i = { kind: "INDIVIDUAL" as const, status: "ONGOING_ENGAGEMENT" as const, pesiAccountNo: null };
  assert.equal(statusChangeProblem(i, "ACTIVE"), null, "no ID number needed any more");
  assert.match(statusChangeProblem(i, "DOCUMENT_COLLECTION")!, /doesn't apply/);
  assert.match(statusChangeProblem(i, "PENDING_VERIFICATION")!, /doesn't apply/, "nobody picks Pending by hand");
  assert.match(statusChangeProblem({ ...i, status: "PENDING_VERIFICATION" }, "INACTIVE")!, /waiting for an Admin/);
});

test("activating a merchant or individual needs an Admin's verification", () => {
  for (const who of [agentA, bdoA, leadA]) {
    assert.equal(effectiveStatus(who, "MERCHANT", "ACTIVE"), "PENDING_VERIFICATION");
    assert.equal(effectiveStatus(who, "INDIVIDUAL", "ACTIVE"), "PENDING_VERIFICATION");
    assert.equal(effectiveStatus(who, "SCHOOL", "ACTIVE"), "ACTIVE", "schools and corporates don't need it");
    assert.equal(effectiveStatus(who, "MERCHANT", "INACTIVE"), "INACTIVE");
    assert.ok(!canVerifyAccount(who));
  }
  assert.equal(effectiveStatus(admin, "MERCHANT", "ACTIVE"), "ACTIVE");
  assert.ok(canVerifyAccount(admin));
  assert.ok(!canVerifyAccount({ ...admin, status: "INACTIVE" }));
});

test("new individuals wait for verification; other accounts start in Ongoing engagement", () => {
  assert.equal(initialStatus(agentA, "INDIVIDUAL"), "PENDING_VERIFICATION");
  assert.equal(initialStatus(bdoA, "INDIVIDUAL"), "PENDING_VERIFICATION");
  assert.equal(initialStatus(admin, "INDIVIDUAL"), "ACTIVE");
  assert.equal(initialStatus(agentA, "MERCHANT"), "ONGOING_ENGAGEMENT");
  assert.equal(initialStatus(admin, "CORPORATE"), "ONGOING_ENGAGEMENT");
});

test("only Admins may add corporates and merchants without a GPS location", () => {
  assert.ok(canSkipLocation(admin, "CORPORATE"));
  assert.ok(canSkipLocation(admin, "MERCHANT"));
  assert.ok(!canSkipLocation(admin, "SCHOOL"));
  assert.ok(!canSkipLocation(admin, "INDIVIDUAL"));
  for (const who of [leadA, bdoA, agentA]) assert.ok(!canSkipLocation(who, "CORPORATE"));
});

test("bulk upload: Admins, Team Leaders and BDOs; assignments follow the single-account rules", () => {
  assert.ok(canBulkUpload(admin) && canBulkUpload(leadA) && canBulkUpload(bdoA));
  assert.ok(!canBulkUpload(agentA));
  assert.ok(!canBulkUpload({ ...bdoA, status: "INACTIVE" }));
  // BDO: themselves and their own agents only
  assert.ok(canAssignNewAccount(bdoA, { id: bdoA.id, role: "BDO", teamId: A }));
  assert.ok(canAssignNewAccount(bdoA, agentA));
  assert.ok(!canAssignNewAccount(bdoA, agentA2), "another BDO's agent");
  assert.ok(!canAssignNewAccount(bdoA, bdoA2));
  // Team Leader: BDOs and agents on their team
  assert.ok(canAssignNewAccount(leadA, bdoA2) && canAssignNewAccount(leadA, agentA2));
  assert.ok(!canAssignNewAccount(leadA, bdoB), "another team");
  assert.ok(!canAssignNewAccount(leadA, { id: "lead2", role: "TEAM_LEADER", teamId: A }));
  // Admin: anyone active
  assert.ok(canAssignNewAccount(admin, bdoB));
  assert.ok(!canAssignNewAccount(admin, { ...bdoB, status: "INACTIVE" }));
});
