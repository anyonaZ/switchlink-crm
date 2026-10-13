"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { findAccountFor, loadPerson } from "@/lib/access";
import { canEditAccount, canReassignAccount, canViewFullIdNumber, statusChangeProblem, type AccountKind, type AccountStatus } from "@/lib/permissions";
import { encryptField, decryptField } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { geocodeCapture } from "@/lib/geo/worker";

const KINDS: AccountKind[] = ["SCHOOL", "CORPORATE", "MERCHANT", "INDIVIDUAL"];
const MAX_LOCATION_AGE_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const PHONE_RE = /^[+0-9 ()-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readLocation(f: FormData) {
  const lat = Number(f.get("latitude"));
  const lng = Number(f.get("longitude"));
  const accRaw = str(f, "accuracy");
  const capturedAt = Date.parse(String(f.get("captured_at") ?? ""));
  if (!f.get("latitude") || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!f.get("longitude") || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (Number.isNaN(capturedAt)) return null;
  const age = Date.now() - capturedAt;
  if (age > MAX_LOCATION_AGE_MS || age < -MAX_CLOCK_SKEW_MS) return "stale" as const;
  const accuracy = accRaw === null ? null : Number(accRaw);
  return { lat, lng, accuracy: accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null, capturedAt: new Date(capturedAt) };
}

function validateCommon(f: FormData, kind: AccountKind) {
  const errors: Record<string, string> = {};
  const name = str(f, "name");
  if (!name) errors.name = kind === "INDIVIDUAL" ? "Enter the client's full name." : "Enter the business or organisation name.";
  const phone = str(f, "phone");
  if (phone && !PHONE_RE.test(phone)) errors.phone = "Check the phone number.";
  const email = str(f, "email");
  if (email && !EMAIL_RE.test(email)) errors.email = "Check the email address.";
  const pesi = str(f, "pesi_account_no");
  if (pesi && !/^\d{4}$/.test(pesi)) errors.pesi_account_no = "The Pesi account number is 4 digits.";
  const stmtNo = str(f, "statement_account_no");
  const idNumber = str(f, "id_number")?.replace(/\s/g, "") ?? null;
  if (idNumber && !/^[0-9A-Za-z]{6,12}$/.test(idNumber)) errors.id_number = "Check the ID number (6–12 letters or digits).";
  if (kind === "INDIVIDUAL" && !idNumber && f.get("_mode") === "create") errors.id_number = "Individuals need their national ID number.";
  return {
    errors,
    values: {
      name: name ?? "",
      phone,
      email,
      industry: str(f, "industry"),
      locationText: str(f, "location_text"),
      pesiAccountNo: pesi,
      statementAccountNo: stmtNo ? stmtNo.toUpperCase() : null,
    },
    idNumber,
    merchant: {
      businessType: str(f, "business_type"),
      registrationNo: str(f, "registration_no"),
      kraPin: str(f, "kra_pin")?.toUpperCase() ?? null,
      ownerName: str(f, "owner_name"),
    },
    dob: str(f, "date_of_birth"),
  };
}

async function uniqueProblem(pesi: string | null, stmtNo: string | null, exceptId?: string): Promise<Record<string, string> | null> {
  if (pesi) {
    const [hit] = await db
      .select({ id: t.accounts.id })
      .from(t.accounts)
      .where(exceptId ? and(eq(t.accounts.pesiAccountNo, pesi), ne(t.accounts.id, exceptId)) : eq(t.accounts.pesiAccountNo, pesi));
    if (hit) return { pesi_account_no: "Another account already has this Pesi account number." };
  }
  if (stmtNo) {
    const [hit] = await db
      .select({ id: t.accounts.id })
      .from(t.accounts)
      .where(exceptId ? and(eq(t.accounts.statementAccountNo, stmtNo), ne(t.accounts.id, exceptId)) : eq(t.accounts.statementAccountNo, stmtNo));
    if (hit) return { statement_account_no: "Another account already uses this statement account number." };
  }
  return null;
}

export async function createAccount(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  if (me.status !== "ACTIVE") return fail("Your account is inactive.");
  const kind = String(f.get("kind") ?? "") as AccountKind;
  if (!KINDS.includes(kind)) return fail("Choose what kind of account this is.");
  f.set("_mode", "create");
  const v = validateCommon(f, kind);
  if (Object.keys(v.errors).length) return fail("Some details need fixing.", v.errors);

  const loc = readLocation(f);
  if (loc === null) return fail("Location is required to register an account. Allow location access and tap Save again.");
  if (loc === "stale") return fail("The captured location is too old. Tap Save again to capture a fresh one.");

  // Owner and team are decided here, never taken on trust from the form.
  let ownerId = me.id;
  let teamId = me.teamId;
  const requestedOwner = str(f, "owner_id");
  if (requestedOwner && requestedOwner !== me.id) {
    const owner = await loadPerson(requestedOwner);
    if (!owner || owner.status !== "ACTIVE") return fail("That person wasn't found or is inactive.");
    const allowed =
      me.role === "ADMIN" ||
      (me.role === "TEAM_LEADER" && owner.teamId === me.teamId && (owner.role === "BDO" || owner.role === "AGENT")) ||
      (me.role === "BDO" && owner.role === "AGENT" && owner.reportsTo === me.id);
    if (!allowed) return fail(me.role === "BDO" ? "You can only assign accounts to your own agents." : "You can't assign accounts to that person.");
    ownerId = owner.id;
    teamId = owner.teamId;
  }

  const dup = await uniqueProblem(v.values.pesiAccountNo, v.values.statementAccountNo);
  if (dup) return fail("That number is already in use.", dup);

  const { accountId, captureId } = await db.transaction(async (tx) => {
    const [acc] = await tx
      .insert(t.accounts)
      .values({ ...v.values, kind, ownerId, teamId, status: "ONGOING_ENGAGEMENT", createdBy: me.id })
      .returning({ id: t.accounts.id });
    if (kind === "MERCHANT") await tx.insert(t.merchantProfiles).values({ accountId: acc.id, ...v.merchant });
    if (kind === "INDIVIDUAL") {
      await tx.insert(t.individualProfiles).values({
        accountId: acc.id,
        idNumberEnc: v.idNumber ? encryptField(v.idNumber) : null,
        idLast4: v.idNumber ? v.idNumber.slice(-4) : null,
        dateOfBirth: v.dob,
      });
    }
    await tx.insert(t.accountStatusHistory).values({ accountId: acc.id, toStatus: "ONGOING_ENGAGEMENT", changedBy: me.id, note: "Account registered" });
    const [cap] = await tx
      .insert(t.locationCaptures)
      .values({ accountId: acc.id, agentId: me.id, latitude: loc.lat, longitude: loc.lng, accuracyM: loc.accuracy, capturedAt: loc.capturedAt })
      .returning({ id: t.locationCaptures.id });
    // Every merchant and individual starts in the pipeline for Quick Finance.
    if (kind === "MERCHANT" || kind === "INDIVIDUAL") {
      const [opp] = await tx
        .insert(t.opportunities)
        .values({ accountId: acc.id, product: "QUICK_FINANCE", ownerId, stage: "NEW" })
        .returning({ id: t.opportunities.id });
      await tx.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, toStage: "NEW", changedBy: me.id });
    }
    await tx.insert(t.auditLog).values({ actorId: me.id, action: "account.create", entity: "account", entityId: acc.id, detail: { kind } });
    return { accountId: acc.id, captureId: cap.id };
  });

  // Look up the street name in the background; the agent never waits for it.
  // (Not `after()`: on this setup it held the response until the lookup finished.)
  setTimeout(() => void geocodeCapture(captureId), 0);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return ok("Account created.", accountId);
}

export async function updateAccount(id: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, id);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't edit this account.");
  const v = validateCommon(f, acc.kind);
  if (Object.keys(v.errors).length) return fail("Some details need fixing.", v.errors);
  const dup = await uniqueProblem(v.values.pesiAccountNo, v.values.statementAccountNo, id);
  if (dup) return fail("That number is already in use.", dup);

  await db.transaction(async (tx) => {
    await tx.update(t.accounts).set(v.values).where(eq(t.accounts.id, id));
    if (acc.kind === "MERCHANT") {
      await tx.insert(t.merchantProfiles).values({ accountId: id, ...v.merchant }).onConflictDoUpdate({ target: t.merchantProfiles.accountId, set: v.merchant });
    }
    if (acc.kind === "INDIVIDUAL") {
      const set: Partial<typeof t.individualProfiles.$inferInsert> = { dateOfBirth: v.dob };
      // Blank ID field on edit means "leave it as it is".
      if (v.idNumber) Object.assign(set, { idNumberEnc: encryptField(v.idNumber), idLast4: v.idNumber.slice(-4) });
      await tx.insert(t.individualProfiles).values({ accountId: id, ...set }).onConflictDoUpdate({ target: t.individualProfiles.accountId, set });
    }
    await tx.insert(t.auditLog).values({ actorId: me.id, action: "account.update", entity: "account", entityId: id, detail: { idChanged: Boolean(v.idNumber) } });
  });
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return ok("Saved.");
}

export async function changeAccountStatus(id: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, id);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't change this account.");
  const to = String(f.get("status") ?? "") as AccountStatus;
  let hasId = false;
  if (acc.kind === "INDIVIDUAL") {
    const [p] = await db.select({ enc: t.individualProfiles.idNumberEnc }).from(t.individualProfiles).where(eq(t.individualProfiles.accountId, id));
    hasId = Boolean(p?.enc);
  }
  const problem = statusChangeProblem({ kind: acc.kind, status: acc.status, pesiAccountNo: acc.pesiAccountNo, hasIdNumber: hasId }, to);
  if (problem) return fail(problem);
  const note = str(f, "note");
  await db.transaction(async (tx) => {
    await tx.update(t.accounts).set({ status: to }).where(eq(t.accounts.id, id));
    await tx.insert(t.accountStatusHistory).values({ accountId: id, fromStatus: acc.status, toStatus: to, changedBy: me.id, note });
  });
  await audit(me.id, "account.status", "account", id, { from: acc.status, to });
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return ok("Status updated.");
}

export async function reassignAccount(id: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, id);
  if (!acc) return fail("Account not found.");
  const newOwnerId = str(f, "owner_id");
  const newOwner = await loadPerson(newOwnerId);
  if (newOwnerId && (!newOwner || newOwner.status !== "ACTIVE")) return fail("That person wasn't found or is inactive.");
  if (!canReassignAccount(me, acc, newOwner)) return fail("You can't reassign this account to that person.");
  const moveTeam = me.role === "ADMIN" && newOwner ? newOwner.teamId : acc.teamId;
  await db.transaction(async (tx) => {
    await tx.update(t.accounts).set({ ownerId: newOwner?.id ?? null, teamId: moveTeam }).where(eq(t.accounts.id, id));
    // Open pipeline items follow the account to its new owner.
    await tx.update(t.opportunities).set({ ownerId: newOwner?.id ?? null }).where(and(eq(t.opportunities.accountId, id), ne(t.opportunities.stage, "ACTIVE")));
  });
  await audit(me.id, "account.reassign", "account", id, { from: acc.ownerId, to: newOwner?.id ?? null });
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return ok(newOwner ? `Reassigned to ${newOwner.name}.` : "Account unassigned.");
}

/** Admin only: shows a full national ID number once, and logs who looked. */
export async function revealIdNumber(accountId: string): Promise<{ value: string | null; error?: string }> {
  const me = await requireUser();
  if (!canViewFullIdNumber(me)) return { value: null, error: "Only Admins can view full ID numbers." };
  const acc = await findAccountFor(me, accountId);
  if (!acc) return { value: null, error: "Account not found." };
  const [p] = await db.select({ enc: t.individualProfiles.idNumberEnc }).from(t.individualProfiles).where(eq(t.individualProfiles.accountId, accountId));
  if (!p?.enc) return { value: null, error: "No ID number on file." };
  await audit(me.id, "id_number.view", "account", accountId);
  return { value: decryptField(p.enc) };
}

