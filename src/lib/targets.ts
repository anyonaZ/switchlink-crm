/**
 * Weekly targets and account retention: pure rules (no database), unit-tested
 * in tests/targets.test.ts. Weeks run Monday to Sunday in Nairobi time.
 */
import { BUSINESS_TZ as TZ, getZonedParts, startOfZonedDay } from "@/lib/timezone";
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The Monday (YYYY-MM-DD, Nairobi) of the week containing `now`. */
export function weekStartOf(now: Date = new Date()): string {
  const p = getZonedParts(now, TZ);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() - (p.isoWeekday - 1));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Start and end instants of the week starting on `monday` (YYYY-MM-DD). */
export function weekRange(monday: string): { start: Date; end: Date } {
  const [y, m, d] = monday.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  return { start: startOfZonedDay(y, m, d, TZ), end: startOfZonedDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), TZ) };
}

/** Monday of the week before/after. */
export function shiftWeek(monday: string, weeks: number): string {
  const [y, m, d] = monday.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 7 * weeks));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const isMonday = (ymdStr: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymdStr) && new Date(`${ymdStr}T12:00:00Z`).getUTCDay() === 1;

/** BDOs and Agents must set their week's targets before using the CRM that week. */
export const mustSetTargets = (role: string) => role === "BDO" || role === "AGENT";

/**
 * Targets can be changed only on the (Nairobi) day they were first set,
 * then they're locked so the week can be held to them.
 */
export function canEditTarget(createdAt: Date, now: Date = new Date()) {
  const a = getZonedParts(createdAt, TZ);
  const b = getZonedParts(now, TZ);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export interface TargetValues {
  individuals: number;
  merchants: number;
  corporates: number;
  disbursement: number;
}
export const ZERO: TargetValues = { individuals: 0, merchants: 0, corporates: 0, disbursement: 0 };
export const addTargets = (a: TargetValues, b: TargetValues): TargetValues => ({
  individuals: a.individuals + b.individuals,
  merchants: a.merchants + b.merchants,
  corporates: a.corporates + b.corporates,
  disbursement: Math.round((a.disbursement + b.disbursement) * 100) / 100,
});

/** Checks the target form. Null if fine, else the problem. */
export function targetProblem(v: TargetValues): string | null {
  for (const k of ["individuals", "merchants", "corporates"] as const) {
    if (!Number.isInteger(v[k]) || v[k] < 0 || v[k] > 10000) return "Account targets must be whole numbers from 0 to 10,000.";
  }
  if (!Number.isFinite(v.disbursement) || v.disbursement < 0 || v.disbursement > 1e11) return "Enter the disbursement target in KES (0 or more).";
  if (v.individuals + v.merchants + v.corporates === 0 && v.disbursement === 0) return "Set at least one target for the week.";
  return null;
}

/** Percentage achieved, capped for the bar at 100 (the number itself isn't capped). */
export const pct = (actual: number, target: number) => (target > 0 ? Math.round((actual / target) * 100) : null);

// --- Retention of individual accounts ---------------------------------------
/** Individual accounts not activated within this many days are deleted. */
export const INDIVIDUAL_ACTIVATION_DAYS = 30;
export const deletionDate = (createdAt: Date) => new Date(createdAt.getTime() + INDIVIDUAL_ACTIVATION_DAYS * 86400000);

// --- Conversion ---------------------------------------------------------------
/** Share of accounts added that went on to become Active. Null when nothing was added. */
export const conversionRate = (added: number, converted: number) => (added > 0 ? Math.round((converted / added) * 1000) / 10 : null);
