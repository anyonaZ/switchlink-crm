"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { findAccountFor, loadPerson } from "@/lib/access";
import { canAssignNewAccount, canEditAccount, canReassignAccount, canSkipLocation, canVerifyAccount, effectiveStatus, initialStatus, statusChangeProblem, type AccountKind, type AccountStatus } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { geocodeCapture } from "@/lib/geo/worker";
import { deletionDate } from "@/lib/targets";
import { formatDate } from "@/lib/format";

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
  if (kind === "INDIVIDUAL" && !phone) errors.phone = "Individuals need a phone number.";
  const email = str(f, "email");
  if (email && !EMAIL_RE.test(email)) errors.email = "Check the email address.";
  const pesi = str(f, "pesi_account_no");
  if (pesi && !/^\d{4}$/.test(pesi)) errors.pesi_account_no = "The Pesi account number is 4 digits.";
  const stmtNo = str(f, "statement_account_no");
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
    merchant: {
      businessType: str(f, "business_type"),
      registrationNo: str(f, "registration_no"),
      kraPin: str(f, "kra_pin")?.toUpperCase() ?? null,
      ownerName: str(f, "owner_name"),
    },
    dob: str(f, "date_of_birth"),
  };
}

async function uniqueProblem(pesi: string | null, stmtNo: string | null, exceptId?: string, individualPhone?: string | null): Promise<Record<string, string> | null> {
  if (individualPhone) {
    // Same number written differently (0712…, +254712…, spaces) counts as the same person.
    const digits = individualPhone.replace(/\D/g, "").replace(/^(254|0)/, "");
    const [hit] = await db
      .select({ id: t.accounts.id, name: t.accounts.name })
      .from(t.accounts)
      .where(
        and(
          eq(t.accounts.kind, "INDIVIDUAL"),
          sql`regexp_replace(regexp_replace(coalesce(${t.accounts.phone}, ''), '[^0-9]', '', 'g'), '^(254|0)', '') = ${digits}`,
          exceptId ? ne(t.accounts.id, exceptId) : sql`true`
        )
      );
    if (hit) return { phone: `This number is already registered to ${hit.name}.` };
  }
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
  const noLocationOk = canSkipLocation(me, kind);
  if (loc === null && !noLocationOk) return fail("Location is required to register an account. Allow location access and tap Save again.");
  if (loc === "stale") return fail("The captured location is too old. Tap Save again to capture a fresh one.");

  // Owner and team are decided here, never taken on trust from the form.
  let ownerId = me.id;
  let teamId = me.teamId;
  const requestedOwner = str(f, "owner_id");
  if (requestedOwner && requestedOwner !== me.id) {
    const owner = await loadPerson(requestedOwner);
    if (!owner || owner.status !== "ACTIVE") return fail("That person wasn't found or is inactive.");
    if (!canAssignNewAccount(me, owner)) return fail(me.role === "BDO" ? "You can only assign accounts to your own agents." : "You can't assign accounts to that person.");
    ownerId = owner.id;
    teamId = owner.teamId;
  }

  const dup = await uniqueProblem(v.values.pesiAccountNo, v.values.statementAccountNo, undefined, kind === "INDIVIDUAL" ? v.values.phone : null);
  if (dup) return fail("That number is already in use.", dup);

  const status = initialStatus(me, kind);
  const pending = status === "PENDING_VERIFICATION";
  const { accountId, captureId } = await db.transaction(async (tx) => {
    const [acc] = await tx
      .insert(t.accounts)
      .values({
        ...v.values,
        kind,
        ownerId,
        teamId,
        status,
        createdBy: me.id,
        ...(pending
          ? { pendingFromStatus: "ONGOING_ENGAGEMENT" as const, verificationRequestedAt: new Date(), verificationRequestedBy: me.id }
          : status === "ACTIVE"
            ? { verifiedAt: new Date(), verifiedBy: me.id }
            : {}),
      })
      .returning({ id: t.accounts.id });
    if (kind === "MERCHANT") await tx.insert(t.merchantProfiles).values({ accountId: acc.id, ...v.merchant });
    if (kind === "INDIVIDUAL") {
      await tx.insert(t.individualProfiles).values({ accountId: acc.id, dateOfBirth: v.dob });
    }
    await tx.insert(t.accountStatusHistory).values({
      accountId: acc.id,
      toStatus: status,
      changedBy: me.id,
      note: pending ? "Account registered, sent to an Admin for verification" : "Account registered",
    });
    // Admins adding corporates or merchants from the office may skip the GPS capture.
    const [cap] = loc
      ? await tx
          .insert(t.locationCaptures)
          .values({ accountId: acc.id, agentId: me.id, latitude: loc.lat, longitude: loc.lng, accuracyM: loc.accuracy, capturedAt: loc.capturedAt })
          .returning({ id: t.locationCaptures.id })
      : [];
    // Every merchant and individual starts in the pipeline for Quick Finance.
    if (kind === "MERCHANT" || kind === "INDIVIDUAL") {
      const [opp] = await tx
        .insert(t.opportunities)
        .values({ accountId: acc.id, product: "QUICK_FINANCE", ownerId, stage: "NEW" })
        .returning({ id: t.opportunities.id });
      await tx.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, toStage: "NEW", changedBy: me.id });
    }
    await tx.insert(t.auditLog).values({ actorId: me.id, action: "account.create", entity: "account", entityId: acc.id, detail: { kind, location: Boolean(cap) } });
    return { accountId: acc.id, captureId: cap?.id ?? null };
  });

  // Look up the street name in the background; the agent never waits for it.
  // (Not `after()`: on this setup it held the response until the lookup finished.)
  if (captureId) setTimeout(() => void geocodeCapture(captureId), 0);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  const expiry =
    kind === "INDIVIDUAL" && status !== "ACTIVE"
      ? ` If it isn't active by ${formatDate(deletionDate(new Date()))}, it will be deleted automatically.`
      : "";
  return ok((pending ? "Account created. An Admin will verify it before it's active." : "Account created.") + expiry, accountId);
}

export async function updateAccount(id: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, id);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't edit this account.");
  const v = validateCommon(f, acc.kind);
  if (Object.keys(v.errors).length) return fail("Some details need fixing.", v.errors);
  const dup = await uniqueProblem(v.values.pesiAccountNo, v.values.statementAccountNo, id, acc.kind === "INDIVIDUAL" ? v.values.phone : null);
  if (dup) return fail("That number is already in use.", dup);

  await db.transaction(async (tx) => {
    await tx.update(t.accounts).set(v.values).where(eq(t.accounts.id, id));
    if (acc.kind === "MERCHANT") {
      await tx.insert(t.merchantProfiles).values({ accountId: id, ...v.merchant }).onConflictDoUpdate({ target: t.merchantProfiles.accountId, set: v.merchant });
    }
    if (acc.kind === "INDIVIDUAL") {
      const set = { dateOfBirth: v.dob };
      await tx.insert(t.individualProfiles).values({ accountId: id, ...set }).onConflictDoUpdate({ target: t.individualProfiles.accountId, set });
    }
    await tx.insert(t.auditLog).values({ actorId: me.id, action: "account.update", entity: "account", entityId: id, detail: { kind: acc.kind } });
  });
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return ok("Saved.");
}

export async function changeAccountStatus(id: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, id);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't change this account.");
  const chosen = String(f.get("status") ?? "") as AccountStatus;
  const problem = statusChangeProblem({ kind: acc.kind, status: acc.status, pesiAccountNo: acc.pesiAccountNo }, chosen);
  if (problem) return fail(problem);
  // A non-Admin activating a merchant or individual sends it to an Admin to verify.
  const to = effectiveStatus(me, acc.kind, chosen);
  const pending = to === "PENDING_VERIFICATION";
  const note = str(f, "note");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(t.accounts)
      .set({
        status: to,
        ...(pending ? { pendingFromStatus: acc.status, verificationRequestedAt: now, verificationRequestedBy: me.id } : {}),
        ...(to === "ACTIVE" && me.role === "ADMIN" ? { verifiedAt: now, verifiedBy: me.id } : {}),
      })
      .where(eq(t.accounts.id, id));
    await tx.insert(t.accountStatusHistory).values({
      accountId: id,
      fromStatus: acc.status,
      toStatus: to,
      changedBy: me.id,
      note: pending ? ["Sent to an Admin for verification", note].filter(Boolean).join(" · ") : note,
    });
  });
  await audit(me.id, pending ? "account.verification_request" : "account.status", "account", id, { from: acc.status, to });
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return ok(pending ? "Sent for verification. An Admin will confirm before the account is active." : "Status updated.");
}

/** Admin confirms a merchant or individual: Pending verification → Active. */
export async function verifyAccount(id: string): Promise<ActionResult> {
  const me = await requireUser();
  if (!canVerifyAccount(me)) return fail("Only Admins verify accounts.");
  const acc = await findAccountFor(me, id);
  if (!acc) return fail("Account not found.");
  const now = new Date();
  const done = await db.transaction(async (tx) => {
    const updated = await tx
      .update(t.accounts)
      .set({ status: "ACTIVE", verifiedAt: now, verifiedBy: me.id, pendingFromStatus: null })
      .where(and(eq(t.accounts.id, id), eq(t.accounts.status, "PENDING_VERIFICATION")))
      .returning({ id: t.accounts.id });
    if (!updated.length) return false;
    await tx.insert(t.accountStatusHistory).values({ accountId: id, fromStatus: "PENDING_VERIFICATION", toStatus: "ACTIVE", changedBy: me.id, note: "Verified by Admin" });
    return true;
  });
  if (!done) return fail("This account isn't waiting for verification.");
  await audit(me.id, "account.verify", "account", id);
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return ok(`${acc.name} verified and active.`);
}

/** Admin declines: the account goes back to where it was, with the reason on its record. */
export async function declineVerification(id: string, reason = ""): Promise<ActionResult> {
  const me = await requireUser();
  if (!canVerifyAccount(me)) return fail("Only Admins verify accounts.");
  if (!reason.trim()) return fail("Say why the account can't be verified, so the agent can fix it.");
  const acc = await findAccountFor(me, id);
  if (!acc) return fail("Account not found.");
  if (acc.status !== "PENDING_VERIFICATION") return fail("This account isn't waiting for verification.");
  const back = acc.pendingFromStatus && acc.pendingFromStatus !== "PENDING_VERIFICATION" ? acc.pendingFromStatus : "ONGOING_ENGAGEMENT";
  const why = reason.trim().slice(0, 300);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(t.accounts).set({ status: back, pendingFromStatus: null }).where(eq(t.accounts.id, id));
    await tx.insert(t.accountStatusHistory).values({ accountId: id, fromStatus: "PENDING_VERIFICATION", toStatus: back, changedBy: me.id, note: `Verification declined: ${why}` });
    // On the activity feed too, so the agent sees what to fix.
    await tx.insert(t.activities).values({
      accountId: id,
      type: "NOTE",
      description: `Verification declined by ${me.name}: ${why}`,
      status: "COMPLETED",
      completedAt: now,
      completedBy: me.id,
      createdBy: me.id,
    });
  });
  await audit(me.id, "account.verification_decline", "account", id, { reason: why, backTo: back });
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return ok(`Verification declined. ${acc.name} is back to ${back === "DOCUMENT_COLLECTION" ? "Document collection" : "Ongoing engagement"}.`);
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
