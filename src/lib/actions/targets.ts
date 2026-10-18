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
  const [existing] = await db
    .select()
    .from(t.weeklyTargets)
    .where(and(eq(t.weeklyTargets.userId, me.id), eq(t.weeklyTargets.weekStart, monday)));
  if (existing && !canEditTarget(existing.createdAt)) return fail("This week's targets are locked. They can only be changed on the day they were set.");
  const row = { ...values, disbursement: values.disbursement.toFixed(2) };
  if (existing) {
    await db.update(t.weeklyTargets).set({ ...row, updatedAt: new Date() }).where(eq(t.weeklyTargets.id, existing.id));
  } else {
    await db.insert(t.weeklyTargets).values({ userId: me.id, weekStart: monday, ...row });
  }
  await audit(me.id, existing ? "target.update" : "target.set", "user", me.id, { week: monday, ...values });
  revalidatePath("/", "layout");
  return ok(existing ? "Targets updated." : "Targets set. Have a great week!");
}
