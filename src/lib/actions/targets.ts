"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { canEditTarget, mustSetTargets, targetProblem, weekStartOf } from "@/lib/targets";

const int = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? 0 : Number(v);
};

/** A BDO or Agent sets (or, on the same day, corrects) this week's targets. */
export async function setWeeklyTarget(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser({ skipTargets: true });
  if (!mustSetTargets(me.role)) return fail("Weekly targets are set by BDOs and Agents.");
  const values = {
    individuals: int(f, "individuals"),
    merchants: int(f, "merchants"),
    corporates: int(f, "corporates"),
    disbursement: Math.round(Number(String(f.get("disbursement") ?? "0").replace(/[, ]/g, "") || 0) * 100) / 100,
  };
  const problem = targetProblem(values);
  if (problem) return fail(problem);
  const monday = weekStartOf();
  const row = { ...values, disbursement: values.disbursement.toFixed(2) };
  // One transaction, row locked: a double tap can't set the week twice or slip past the lock.
  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(t.weeklyTargets)
      .where(and(eq(t.weeklyTargets.userId, me.id), eq(t.weeklyTargets.weekStart, monday)))
      .for("update");
    if (existing && !canEditTarget(existing.createdAt)) return "locked" as const;
    if (existing) {
      await tx.update(t.weeklyTargets).set({ ...row, updatedAt: new Date() }).where(eq(t.weeklyTargets.id, existing.id));
    } else {
      const inserted = await tx.insert(t.weeklyTargets).values({ userId: me.id, weekStart: monday, ...row }).onConflictDoNothing().returning({ id: t.weeklyTargets.id });
      if (!inserted.length) return "raced" as const;
    }
    await audit(me.id, existing ? "target.update" : "target.set", "user", me.id, { week: monday, ...values }, tx);
    return existing ? ("updated" as const) : ("set" as const);
  });
  if (outcome === "locked") return fail("This week's targets are locked. They can only be changed on the day they were set.");
  if (outcome === "raced") return ok("Targets set. Have a great week!");
  revalidatePath("/", "layout");
  return ok(outcome === "updated" ? "Targets updated." : "Targets set. Have a great week!");
}
