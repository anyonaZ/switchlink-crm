import { STAGE_LABELS as STAGE_NAMES, type Stage } from "@/lib/labels";

export type LeadTemperature = "HOT" | "WARM" | "COLD";
export interface LeadScore {
  score: number;
  temperature: LeadTemperature;
  reasons: string[];
}
/** The opportunity fields the score reads. */
export interface ScorableOpportunity {
  id: string;
  stage: Stage;
  nextAction: string | null;
  nextActionDate: string | null;
  estimatedValue: string | number | null;
}

/**
 * Deterministic 0–100 lead score, replacing the old
 * "Proposal || Negotiation || MOU = hot" heuristic.
 *
 * This is a documented point formula over data the CRM already owns —
 * not machine learning, and not meant to look like it. Every component
 * and threshold below is explicit; nothing is hidden.
 *
 * Components (sum, then clamped to 0–100):
 *   - Stage weight        (0–55)  — largest component; further along the
 *                                    pipeline = hotter.
 *   - Recent activity     (0–20)  — has something happened lately?
 *   - Upcoming next action(0–15)  — a concrete next step, especially a
 *                                    near-term one, is a positive signal.
 *   - Data completeness  (-10–0)  — missing next action / estimated
 *                                    value is a small penalty (the BDO
 *                                    hasn't nailed down the plan yet).
 *   - Staleness          (-20–0)  — no activity in a long time is a
 *                                    penalty, regardless of stage.
 */

const STAGE_WEIGHT: Record<Stage, number> = {
  NEW: 5,
  CONTACTED: 12,
  QUALIFIED: 20,
  MEETING: 28,
  INTERESTED: 34,
  PROPOSAL: 42,
  NEGOTIATION: 50,
  MOU: 55,
  ONBOARDING: 30, // past the "sales" phase — see EXCLUDED_STAGES below
  ACTIVE: 0, // already a live customer, not a lead — see EXCLUDED_STAGES
};

/** Opportunities in these stages are already customers, not leads —
 * excluded from lead ranking entirely regardless of score. */
export const EXCLUDED_LEAD_STAGES: Stage[] = ["ACTIVE"];

export const HOT_THRESHOLD = 70;
export const WARM_THRESHOLD = 40;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / (1000 * 60 * 60 * 24);
}

export interface LeadScoringInput {
  opportunity: ScorableOpportunity;
  /** Most recent activity date (any type) logged against this
   * opportunity's organization/opportunity, if known. */
  lastActivityAt?: string | null;
}

export function scoreOpportunity({ opportunity, lastActivityAt }: LeadScoringInput, now: Date = new Date()): LeadScore {
  const reasons: string[] = [];
  let score = 0;

  // --- Stage (0–55) ---
  const stagePoints = STAGE_WEIGHT[opportunity.stage] ?? 0;
  score += stagePoints;
  if (stagePoints > 0) reasons.push(`Stage: ${STAGE_NAMES[opportunity.stage]}`);

  // --- Recent activity (0–20) ---
  const activityAge = daysSince(lastActivityAt ?? null, now);
  if (activityAge !== null) {
    if (activityAge <= 3) {
      score += 20;
      reasons.push("Active in the last 3 days");
    } else if (activityAge <= 7) {
      score += 12;
      reasons.push("Active in the last week");
    } else if (activityAge <= 21) {
      score += 5;
      reasons.push("Active in the last 3 weeks");
    }
  }

  // --- Upcoming next action (0–15) ---
  if (opportunity.nextActionDate) {
    const dueIn = daysSince(now.toISOString(), new Date(opportunity.nextActionDate)) ?? 0;
    if (dueIn >= 0 && dueIn <= 3) {
      score += 15;
      reasons.push("Follow-up due within 3 days");
    } else if (dueIn > 3 && dueIn <= 14) {
      score += 8;
      reasons.push("Follow-up scheduled within 2 weeks");
    } else if (dueIn < 0) {
      // Overdue follow-up: still a positive signal that there IS a plan,
      // but flag it distinctly rather than silently scoring it the same
      // as "due soon".
      score += 6;
      reasons.push("Follow-up overdue — needs attention");
    }
  }

  // --- Data completeness penalty (-10–0) ---
  let completenessPenalty = 0;
  if (!opportunity.nextAction) completenessPenalty -= 5;
  if (!opportunity.estimatedValue) completenessPenalty -= 5;
  if (completenessPenalty !== 0) {
    score += completenessPenalty;
    reasons.push("Missing next action or estimated value");
  }

  // --- Staleness penalty (-20–0) ---
  if (activityAge !== null && activityAge > 30) {
    score -= 20;
    reasons.push("No activity in over 30 days");
  } else if (activityAge === null) {
    // Never logged any activity at all.
    score -= 10;
    reasons.push("No activity logged yet");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let temperature: LeadTemperature = "COLD";
  if (score >= HOT_THRESHOLD) temperature = "HOT";
  else if (score >= WARM_THRESHOLD) temperature = "WARM";

  return { score, temperature, reasons };
}

/** Convenience for a dashboard: score + sort a set of opportunities,
 * excluding already-active customers, hottest first. */
export function rankLeads<T extends LeadScoringInput>(inputs: T[], now: Date = new Date()): (T & { lead: LeadScore })[] {
  return inputs
    .filter((i) => !EXCLUDED_LEAD_STAGES.includes(i.opportunity.stage))
    .map((i) => ({ ...i, lead: scoreOpportunity(i, now) }))
    .sort((a, b) => b.lead.score - a.lead.score);
}
