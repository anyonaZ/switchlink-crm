/**
 * Minimal IANA-timezone-aware calendar math, using only `Intl` (no new
 * dependency — date-fns-tz/luxon etc. would be an unrelated dependency
 * upgrade the brief asked to avoid).
 *
 * Used by src/lib/reports.ts to compute calendar-aligned report periods
 * (today / this week / this month / …) in the app's configured business
 * timezone (APP_TIMEZONE, default Africa/Nairobi) rather than whatever
 * timezone the Node server process happens to be running in.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday .. 7 = Sunday (ISO weekday numbering) */
  isoWeekday: number;
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  // Some locales/environments render midnight as "24" with hour12:false;
  // normalize to 0.
  const hour = Number(map.hour) % 24;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    isoWeekday: WEEKDAY_TO_ISO[map.weekday] ?? 1,
  };
}

/**
 * Converts a wall-clock date/time *as observed in `timeZone`* into the
 * correct UTC instant. Uses the standard guess-and-correct technique:
 * treat the wall-clock values as if they were UTC to get a first guess,
 * see what that guess actually reads as in the target timezone, and
 * correct for the difference (handles all fixed and DST offsets without
 * a timezone database of our own).
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const seenAsZoned = getZonedParts(guess, timeZone);
  const seenAsUtcMs = Date.UTC(
    seenAsZoned.year,
    seenAsZoned.month - 1,
    seenAsZoned.day,
    seenAsZoned.hour,
    seenAsZoned.minute,
    seenAsZoned.second
  );
  const desiredAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const diff = seenAsUtcMs - desiredAsUtcMs;
  return new Date(guess.getTime() - diff);
}

/** Start-of-day (00:00:00) for the given Y/M/D, as a UTC instant. */
export function startOfZonedDay(year: number, month: number, day: number, timeZone: string): Date {
  return zonedWallClockToUtc(year, month, day, 0, 0, 0, timeZone);
}

function addDaysToYmd(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  // Use UTC arithmetic on a plain calendar date (no timezone conversion
  // involved here — we're just walking the calendar).
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export type CalendarPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

/**
 * Half-open [start, end) UTC instant range for the given calendar period,
 * as currently observed in `timeZone`. `start <= timestamp < end`.
 */
export function getCalendarPeriodRange(
  period: CalendarPeriod,
  timeZone: string,
  now: Date = new Date()
): { start: Date; end: Date } {
  const p = getZonedParts(now, timeZone);

  switch (period) {
    case "daily": {
      const start = startOfZonedDay(p.year, p.month, p.day, timeZone);
      const next = addDaysToYmd(p.year, p.month, p.day, 1);
      const end = startOfZonedDay(next.year, next.month, next.day, timeZone);
      return { start, end };
    }
    case "weekly": {
      // ISO week: Monday..Sunday.
      const daysSinceMonday = p.isoWeekday - 1;
      const monday = addDaysToYmd(p.year, p.month, p.day, -daysSinceMonday);
      const start = startOfZonedDay(monday.year, monday.month, monday.day, timeZone);
      const nextMonday = addDaysToYmd(monday.year, monday.month, monday.day, 7);
      const end = startOfZonedDay(nextMonday.year, nextMonday.month, nextMonday.day, timeZone);
      return { start, end };
    }
    case "monthly": {
      const start = startOfZonedDay(p.year, p.month, 1, timeZone);
      const nextMonth = p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
      const end = startOfZonedDay(nextMonth.year, nextMonth.month, 1, timeZone);
      return { start, end };
    }
    case "quarterly": {
      const quarterStartMonth = Math.floor((p.month - 1) / 3) * 3 + 1;
      const start = startOfZonedDay(p.year, quarterStartMonth, 1, timeZone);
      const nextQuarterMonth = quarterStartMonth + 3;
      const nextQuarter =
        nextQuarterMonth > 12 ? { year: p.year + 1, month: nextQuarterMonth - 12 } : { year: p.year, month: nextQuarterMonth };
      const end = startOfZonedDay(nextQuarter.year, nextQuarter.month, 1, timeZone);
      return { start, end };
    }
    case "semiannual": {
      const halfStartMonth = p.month <= 6 ? 1 : 7;
      const start = startOfZonedDay(p.year, halfStartMonth, 1, timeZone);
      const nextHalf = halfStartMonth === 1 ? { year: p.year, month: 7 } : { year: p.year + 1, month: 1 };
      const end = startOfZonedDay(nextHalf.year, nextHalf.month, 1, timeZone);
      return { start, end };
    }
    case "annual": {
      const start = startOfZonedDay(p.year, 1, 1, timeZone);
      const end = startOfZonedDay(p.year + 1, 1, 1, timeZone);
      return { start, end };
    }
  }
}
