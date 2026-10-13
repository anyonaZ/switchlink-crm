/**
 * Every date and amount shown in the CRM goes through here, so the whole
 * app shows Nairobi time no matter where the server's clock is set.
 * Safe to import from client and server components.
 */
export const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Africa/Nairobi";

const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const fmtDateTime = dtf({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDateTimeYear = dtf({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = dtf({ day: "numeric", month: "short", year: "numeric" });
const fmtShortDate = dtf({ day: "numeric", month: "short" });

type D = Date | string | null | undefined;
const toDate = (v: D) => (v == null ? null : v instanceof Date ? v : new Date(v.length === 10 ? `${v}T12:00:00Z` : v));

export const formatDateTime = (v: D, withYear = false) => {
  const d = toDate(v);
  return d ? (withYear ? fmtDateTimeYear : fmtDateTime).format(d) : "—";
};
export const formatDate = (v: D) => {
  const d = toDate(v);
  return d ? fmtDate.format(d) : "—";
};
export const formatShortDate = (v: D) => {
  const d = toDate(v);
  return d ? fmtShortDate.format(d) : "—";
};

/** Today's calendar date in Nairobi as YYYY-MM-DD (for date inputs). */
export function todayYmd(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}

/** Turns a Nairobi wall-clock date + time (from form inputs) into a real instant. */
export function nairobiToInstant(ymd: string, hm = "09:00"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(hm)) return null;
  // Africa/Nairobi is UTC+3 all year (no daylight saving).
  const d = new Date(`${ymd}T${hm}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatMoney(v: number | string | null | undefined, opts: { dash?: boolean } = {}) {
  const n = Number(v ?? 0);
  if (!n && opts.dash !== false) return "—";
  return "KES " + n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

export function formatMoneyExact(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
