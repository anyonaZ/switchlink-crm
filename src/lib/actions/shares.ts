"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { findAccountFor } from "@/lib/access";
import { canDecideSlot, canRequestShare, requiredApprovalSlots, shareOutcome, sharePlanProblem, type PlannedMember } from "@/lib/permissions";
import { teamsWithLeaders } from "@/lib/shares";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";

function touch(accountId: string) {
  revalidatePath("/shares");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
}

/**
 * A BDO asks to share a corporate with other BDOs. The request goes to the
 * Admins and to the Team Leader of every team involved.
 * Form: member (repeated, the partner BDOs), percent_<userId> for every BDO including the requester, note.
 */
export async function requestShare(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc) return fail("Account not found.");
  if (!canRequestShare(me, acc)) {
    return fail(acc.kind !== "CORPORATE" ? "Only corporates can be shared." : "Only the BDO responsible for this corporate can ask to share it.");
  }
  const partnerIds = [...new Set(f.getAll("member").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x) && x !== me.id))];
  const ids = [me.id, ...partnerIds];
  const people = await db
    .select({ id: t.users.id, name: t.users.name, role: t.users.role, status: t.users.status, teamId: t.users.teamId })
    .from(t.users)
    .where(inArray(t.users.id, ids));
  if (people.length !== ids.length) return fail("One of the BDOs wasn't found.");
  const percentOf = (id: string) => Number(String(f.get(`percent_${id}`) ?? "").replace(/[%\s]/g, ""));
  const plan: PlannedMember[] = people.map((p) => ({ userId: p.id, role: p.role, status: p.status, percent: percentOf(p.id) }));
  const problem = sharePlanProblem(me.id, plan);
  if (problem) return fail(problem);

  const [open] = await db
    .select({ id: t.accountShares.id, status: t.accountShares.status })
    .from(t.accountShares)
    .where(and(eq(t.accountShares.accountId, accountId), inArray(t.accountShares.status, ["PENDING", "APPROVED"])));
  if (open) return fail(open.status === "PENDING" ? "There's already a sharing request waiting for approval on this corporate." : "This corporate is already shared. Ask an Admin to end the current share first.");

  const note = String(f.get("note") ?? "").trim().slice(0, 500) || null;
  const slots = requiredApprovalSlots(people.map((p) => p.teamId));
  try {
    const shareId = await db.transaction(async (tx) => {
      const [share] = await tx.insert(t.accountShares).values({ accountId, requestedBy: me.id, note }).returning({ id: t.accountShares.id });
      await tx.insert(t.accountShareMembers).values(people.map((p) => ({ shareId: share.id, userId: p.id, teamId: p.teamId, percent: percentOf(p.id).toFixed(2) })));
      await tx.insert(t.accountShareApprovals).values(slots.map((s) => ({ shareId: share.id, role: s.role, teamId: s.teamId })));
      await audit(me.id, "share.request", "account", accountId, { shareId: share.id, members: plan.map((m) => ({ userId: m.userId, percent: m.percent })) }, tx);
      return share.id;
    });
    touch(accountId);
    const others = people.filter((p) => p.id !== me.id).map((p) => p.name).join(", ");
    return ok(`Sharing request sent with ${others}. It needs approval from ${slots.length - 1 ? "the Team Leader" + (slots.length > 2 ? "s" : "") + " and " : ""}an Admin.`, shareId);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") return fail("Someone else just opened a sharing request on this corporate.");
    throw e;
  }
}

async function decide(approvalId: string, decision: "APPROVED" | "REJECTED", reason: string): Promise<ActionResult> {
  const me = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return fail("Not found.");
  if (decision === "REJECTED" && !reason.trim()) return fail("Give a reason for turning the request down.");
  const [slot] = await db.select().from(t.accountShareApprovals).where(eq(t.accountShareApprovals.id, approvalId));
  if (!slot) return fail("Not found.");
  const led = slot.teamId ? await teamsWithLeaders([slot.teamId]) : new Set<string>();
  if (!canDecideSlot(me, slot, slot.teamId ? led.has(slot.teamId) : false)) return fail("You can't decide this approval.");

  const result = await db.transaction(async (tx) => {
    // Lock the share so two approvers finishing at once can't both "complete" it.
    const [share] = await tx.select().from(t.accountShares).where(eq(t.accountShares.id, slot.shareId)).for("update");
    if (!share || share.status !== "PENDING") return { error: "This request has already been decided or withdrawn." } as const;
    const [fresh] = await tx.select().from(t.accountShareApprovals).where(eq(t.accountShareApprovals.id, approvalId));
    if (fresh.decision !== "PENDING") return { error: "This approval has already been given." } as const;
    if (decision === "APPROVED") {
      // Everyone on the share must still be an active BDO.
      const members = await tx
        .select({ name: t.users.name, role: t.users.role, status: t.users.status })
        .from(t.accountShareMembers)
        .innerJoin(t.users, eq(t.users.id, t.accountShareMembers.userId))
        .where(eq(t.accountShareMembers.shareId, share.id));
      const gone = members.find((m) => m.role !== "BDO" || m.status !== "ACTIVE");
      if (gone) return { error: `${gone.name} is no longer an active BDO. Turn this request down and ask for a new one.` } as const;
    }
    await tx
      .update(t.accountShareApprovals)
      .set({ decision, decidedBy: me.id, decidedAt: new Date(), reason: reason.trim().slice(0, 300) || null })
      .where(eq(t.accountShareApprovals.id, approvalId));
    const slots = await tx.select({ decision: t.accountShareApprovals.decision }).from(t.accountShareApprovals).where(eq(t.accountShareApprovals.shareId, share.id));
    const outcome = shareOutcome(slots);
    if (outcome !== "PENDING") await tx.update(t.accountShares).set({ status: outcome, decidedAt: new Date() }).where(eq(t.accountShares.id, share.id));
    await audit(me.id, decision === "APPROVED" ? "share.approve" : "share.reject", "account", share.accountId, { shareId: share.id, slot: slot.role, teamId: slot.teamId, outcome, reason: reason || undefined }, tx);
    return { accountId: share.accountId, outcome } as const;
  });
  if ("error" in result) return fail(result.error!);
  touch(result.accountId);
  if (result.outcome === "APPROVED") return ok("Approved. The corporate is now shared: its disbursements will be split automatically.");
  if (result.outcome === "REJECTED") return ok("Request turned down.");
  return ok("Approved. Still waiting for the other approval.");
}

export async function approveShare(approvalId: string): Promise<ActionResult> {
  return decide(approvalId, "APPROVED", "");
}
export async function rejectShare(approvalId: string, reason = ""): Promise<ActionResult> {
  return decide(approvalId, "REJECTED", reason);
}

/** The BDOs involved (or an Admin) withdraw a request that hasn't been decided. */
export async function cancelShare(shareId: string): Promise<ActionResult> {
  const me = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(shareId)) return fail("Not found.");
  const [share] = await db.select().from(t.accountShares).where(eq(t.accountShares.id, shareId));
  if (!share) return fail("Not found.");
  const members = await db.select({ userId: t.accountShareMembers.userId }).from(t.accountShareMembers).where(eq(t.accountShareMembers.shareId, shareId));
  const involved = share.requestedBy === me.id || members.some((m) => m.userId === me.id);
  if (!(me.role === "ADMIN" || (me.role === "BDO" && involved))) return fail("Only the BDOs on the request or an Admin can withdraw it.");
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(t.accountShares)
      .set({ status: "CANCELLED", decidedAt: new Date() })
      .where(and(eq(t.accountShares.id, shareId), eq(t.accountShares.status, "PENDING")))
      .returning({ id: t.accountShares.id });
    if (rows.length) await audit(me.id, "share.cancel", "account", share.accountId, { shareId }, tx);
    return rows;
  });
  if (!updated.length) return fail("Only a request that's still waiting can be withdrawn.");
  touch(share.accountId);
  return ok("Request withdrawn.");
}

/** Admin ends an approved share. Past split disbursements stay as they are; new ones are no longer split. */
export async function endShare(shareId: string, reason = ""): Promise<ActionResult> {
  const me = await requireUser();
  if (me.role !== "ADMIN") return fail("Only Admins can end a share.");
  if (!reason.trim()) return fail("Give a reason for ending the share.");
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(t.accountShares)
      .set({ status: "ENDED", endedAt: new Date(), endedBy: me.id })
      .where(and(eq(t.accountShares.id, shareId), eq(t.accountShares.status, "APPROVED")))
      .returning({ accountId: t.accountShares.accountId });
    if (rows.length) await audit(me.id, "share.end", "account", rows[0].accountId, { shareId, reason: reason.trim().slice(0, 300) }, tx);
    return rows;
  });
  if (!updated.length) return fail("That share isn't active.");
  touch(updated[0].accountId);
  return ok("Share ended. New disbursements go to the account's own agent again.");
}
