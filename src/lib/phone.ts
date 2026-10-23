/**
 * Kenyan mobile numbers in one canonical form. Pure; used by forms, the bulk
 * upload and tests. The database computes the same thing in kenya_phone()
 * (migration 0008) for its uniqueness rule, so the two must stay in step.
 *
 * Accepted: 07XX XXX XXX, 01XX XXX XXX, +254 7XX…, 2547XX…, and 7XX… / 1XX…
 * (Excel drops the leading 0), with any spaces, dashes or brackets.
 */
export type KenyanMobile = { e164: string; local: string };

export function kenyanMobile(raw: string | null | undefined): KenyanMobile | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let national: string | null = null;
  if (/^254[17]\d{8}$/.test(digits)) national = digits.slice(3);
  else if (/^0[17]\d{8}$/.test(digits)) national = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) national = digits;
  return national ? { e164: `+254${national}`, local: `0${national}` } : null;
}
