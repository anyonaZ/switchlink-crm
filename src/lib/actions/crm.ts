"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { findAccountFor } from "@/lib/access";
import { canEditAccount } from "@/lib/permissions";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ACTIVITY_TYPES, PRODUCTS_FOR_KIND, STAGES, STAGE_LABELS, type Stage } from "@/lib/labels";
import { nairobiToInstant } from "@/lib/format";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

async function editableAccount(accountId: string) {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc || !canEditAccount(me, acc)) return { me, acc: null };
  return { me, acc };
}

function touch(accountId: string) {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/pipeline");
  revalidatePath("/follow-ups");
  revalidatePath("/dashboard");
}

/** A note on the activity feed when a leader acts on someone else's account. */
async function noteOnBehalf(me: { id: string; name: string; role: string }, accountId: string, ownerId: string | null, opportunityId: string | null, summary: string) {
  if (me.role === "AGENT" || me.id === ownerId) return;
  const now = new Date();
  await db.insert(t.activities).values({
    accountId,
    opportunityId,
    type: "NOTE",
    description: `${summary} (by ${me.name} on behalf of the assigned agent)`,
    status: "COMPLETED",
    completedAt: now,
    completedBy: me.id,
    createdBy: me.id,
  });
}

// --- Opportunities -----------------------------------------------------------
export async function createOpportunity(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { me, acc } = await editableAccount(accountId);
  if (!acc) return fail("You can't add to this account.");
  const productValue = String(f.get("product") ?? "");
  const allowed = PRODUCTS_FOR_KIND[acc.kind] as readonly string[];
  if (!allowed.includes(productValue)) return fail("That product isn't offered to this kind of account.");
  const product = productValue as (typeof PRODUCTS_FOR_KIND)[keyof typeof PRODUCTS_FOR_KIND][number];
  const value = num(f, "estimated_value");
  if (Number.isNaN(value) || (value !== null && value < 0)) return fail("Check the estimated value.", { estimated_value: "Enter a number" });
  const [exists] = await db
    .select({ id: t.opportunities.id })
    .from(t.opportunities)
    .where(and(eq(t.opportunities.accountId, accountId), eq(t.opportunities.product, product)));
  if (exists) return fail("This account already has that product in the pipeline.");
  await db.transaction(async (tx) => {
    const [opp] = await tx
      .insert(t.opportunities)
      .values({
        accountId,
        product,
        ownerId: acc.ownerId ?? me.id,
        estimatedValue: value === null ? null : String(value),
        nextAction: str(f, "next_action"),
        nextActionDate: str(f, "next_action_date"),
      })
      .returning({ id: t.opportunities.id });
    await tx.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, toStage: "NEW", changedBy: me.id });
  });
  touch(accountId);
  return ok("Added to the pipeline.");
}

export async function changeStage(opportunityId: string, stage: string): Promise<ActionResult> {
  const me = await requireUser();
  if (!(STAGES as readonly string[]).includes(stage)) return fail("Unknown stage.");
  const [opp] = await db.select().from(t.opportunities).where(eq(t.opportunities.id, opportunityId));
  if (!opp) return fail("Not found.");
  const acc = await findAccountFor(me, opp.accountId);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't change this opportunity.");
  if (opp.stage === stage) return ok();
  await db.transaction(async (tx) => {
    await tx.update(t.opportunities).set({ stage: stage as Stage }).where(eq(t.opportunities.id, opportunityId));
    await tx.insert(t.opportunityStageHistory).values({ opportunityId, fromStage: opp.stage, toStage: stage as Stage, changedBy: me.id });
  });
  await noteOnBehalf(me, acc.id, opp.ownerId, opp.id, `Stage moved to ${STAGE_LABELS[stage as Stage]}`);
  touch(acc.id);
  return ok(`Moved to ${STAGE_LABELS[stage as Stage]}.`);
}

export async function updateOpportunity(opportunityId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const [opp] = await db.select().from(t.opportunities).where(eq(t.opportunities.id, opportunityId));
  if (!opp) return fail("Not found.");
  const acc = await findAccountFor(me, opp.accountId);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't change this opportunity.");
  const value = num(f, "estimated_value");
  const apps = num(f, "applications_count");
  const approved = num(f, "approved_count");
  const errs: Record<string, string> = {};
  if (Number.isNaN(value) || (value ?? 0) < 0) errs.estimated_value = "Enter a number";
  if (Number.isNaN(apps) || (apps ?? 0) < 0) errs.applications_count = "Enter a whole number";
  if (Number.isNaN(approved) || (approved ?? 0) < 0) errs.approved_count = "Enter a whole number";
  if (Object.keys(errs).length) return fail("Some numbers need fixing.", errs);
  const nextAction = str(f, "next_action");
  await db
    .update(t.opportunities)
    .set({
      estimatedValue: value === null ? null : String(value),
      nextAction,
      nextActionDate: str(f, "next_action_date"),
      notes: str(f, "notes"),
      applicationsCount: Math.trunc(apps ?? 0),
      approvedCount: Math.trunc(approved ?? 0),
    })
    .where(eq(t.opportunities.id, opportunityId));
  await noteOnBehalf(me, acc.id, opp.ownerId, opp.id, `Follow-up details updated (next: ${nextAction ?? "none"})`);
  touch(acc.id);
  return ok("Saved.");
}

// --- Activities ----------------------------------------------------------------
/**
 * The opportunity an activity is about, if any: it must be one of this account's
 * (the database enforces this too, with a foreign key on account + opportunity).
 */
async function opportunityOn(accountId: string, f: FormData): Promise<{ ok: true; id: string | null } | { ok: false }> {
  const id = str(f, "opportunity_id");
  if (!id) return { ok: true, id: null };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false };
  const [opp] = await db
    .select({ id: t.opportunities.id })
    .from(t.opportunities)
    .where(and(eq(t.opportunities.id, id), eq(t.opportunities.accountId, accountId)));
  return opp ? { ok: true, id: opp.id } : { ok: false };
}

export async function logActivity(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { me, acc } = await editableAccount(accountId);
  if (!acc) return fail("You can't log activity on this account.");
  const type = String(f.get("type") ?? "");
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) return fail("Choose an activity type.");
  const description = str(f, "description");
  if (!description) return fail("Say what happened.", { description: "Required" });
  const opp = await opportunityOn(accountId, f);
  if (!opp.ok) return fail("That opportunity isn't on this account. Reload the page and try again.", { opportunity_id: "Not on this account" });
  const now = new Date();
  await db.insert(t.activities).values({
    accountId,
    opportunityId: opp.id,
    type: type as (typeof ACTIVITY_TYPES)[number],
    description,
    status: "COMPLETED",
    completedAt: now,
    completedBy: me.id,
    nextAction: str(f, "next_action"),
    createdBy: me.id,
  });
  touch(accountId);
  return ok("Activity logged.");
}

export async function scheduleFollowUp(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { me, acc } = await editableAccount(accountId);
  if (!acc) return fail("You can't schedule on this account.");
  const type = String(f.get("type") ?? "CALL");
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) return fail("Choose an activity type.");
  const when = nairobiToInstant(String(f.get("date") ?? ""), String(f.get("time") || "09:00"));
  if (!when) return fail("Pick a date for the follow-up.", { date: "Required" });
  const opp = await opportunityOn(accountId, f);
  if (!opp.ok) return fail("That opportunity isn't on this account. Reload the page and try again.", { opportunity_id: "Not on this account" });
  await db.insert(t.activities).values({
    accountId,
    opportunityId: opp.id,
    type: type as (typeof ACTIVITY_TYPES)[number],
    description: str(f, "description"),
    status: "SCHEDULED",
    scheduledAt: when,
    createdBy: me.id,
  });
  touch(accountId);
  return ok("Follow-up scheduled.");
}

async function editableActivity(activityId: string) {
  const me = await requireUser();
  const [a] = await db.select().from(t.activities).where(eq(t.activities.id, activityId));
  if (!a) return { me, a: null };
  const acc = await findAccountFor(me, a.accountId);
  return { me, a: acc && canEditAccount(me, acc) ? a : null };
}

export async function completeFollowUp(activityId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { me, a } = await editableActivity(activityId);
  if (!a || a.status !== "SCHEDULED") return fail("This follow-up is no longer open.");
  const outcome = str(f, "outcome");
  if (!outcome) return fail("Say how it went.", { outcome: "Required" });
  await db
    .update(t.activities)
    .set({
      status: "COMPLETED",
      completedAt: new Date(),
      completedBy: me.id,
      description: [a.description, outcome].filter(Boolean).join(" — "),
      nextAction: str(f, "next_action"),
    })
    .where(eq(t.activities.id, activityId));
  touch(a.accountId);
  return ok("Marked done.");
}

export async function cancelFollowUp(activityId: string): Promise<ActionResult> {
  const { a } = await editableActivity(activityId);
  if (!a || a.status !== "SCHEDULED") return fail("This follow-up is no longer open.");
  await db.update(t.activities).set({ status: "CANCELLED" }).where(eq(t.activities.id, activityId));
  touch(a.accountId);
  return ok("Follow-up cancelled.");
}

// --- Contacts and notes ---------------------------------------------------------
export async function addContact(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { acc } = await editableAccount(accountId);
  if (!acc) return fail("You can't add contacts here.");
  const name = str(f, "name");
  if (!name) return fail("Enter the contact's name.", { name: "Required" });
  await db.insert(t.contacts).values({
    accountId,
    name,
    jobTitle: str(f, "job_title"),
    phone: str(f, "phone"),
    email: str(f, "email"),
    isDecisionMaker: f.get("is_decision_maker") === "on",
  });
  touch(accountId);
  return ok("Contact added.");
}

export async function deleteContact(contactId: string): Promise<ActionResult> {
  const me = await requireUser();
  const [c] = await db.select().from(t.contacts).where(eq(t.contacts.id, contactId));
  if (!c) return fail("Not found.");
  const acc = await findAccountFor(me, c.accountId);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't remove this contact.");
  await db.delete(t.contacts).where(eq(t.contacts.id, contactId));
  touch(c.accountId);
  return ok("Contact removed.");
}

export async function addComment(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc) return fail("Account not found.");
  const body = str(f, "body");
  if (!body) return fail("Write something first.", { body: "Required" });
  if (body.length > 4000) return fail("Keep notes under 4,000 characters.");
  await db.insert(t.comments).values({ accountId, authorId: me.id, body });
  touch(accountId);
  return ok("Note posted.");
}
