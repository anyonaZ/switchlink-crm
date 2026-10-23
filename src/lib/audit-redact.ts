/**
 * Masks sensitive values in audit details before they're shown or exported:
 * passwords, tokens, hashes, phone numbers, emails, KRA PINs, registration and
 * ID numbers, dates of birth. Pure; tested in tests/security.test.ts.
 */
const SENSITIVE_KEY = /pass(word)?|token|secret|hash|sha|phone|email|kra|pin|registration|id_?no|national|dob|birth/i;
const MASK = "•••";

export function redactDetail(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactDetail(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) && v !== null && v !== "" ? MASK : redactDetail(v, depth + 1);
    return out;
  }
  return value;
}

/** One line for the list, e.g. `amount: 5000 · product: QUICK_FINANCE`. */
export function detailSummary(detail: unknown) {
  if (!detail || typeof detail !== "object") return "";
  return Object.entries(redactDetail(detail) as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 400);
}
