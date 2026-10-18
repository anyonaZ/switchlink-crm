import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { geocoderName, reverseGeocode } from "./geocode";

const MAX_ATTEMPTS = 6;

/** Looks up one capture's address and stores it. Never throws. */
export async function geocodeCapture(captureId: string) {
  const [c] = await db.select().from(t.locationCaptures).where(eq(t.locationCaptures.id, captureId));
  if (!c || c.geocodeStatus === "DONE") return;
  if (geocoderName() === "off") {
    await db.update(t.locationCaptures).set({ geocodeStatus: "OFF" }).where(eq(t.locationCaptures.id, captureId));
    return;
  }
  try {
    const a = await reverseGeocode(c.latitude, c.longitude);
    if (!a) return;
    await db
      .update(t.locationCaptures)
      .set({
        road: a.road,
        landmark: a.landmark,
        area: a.area,
        town: a.town,
        county: a.county,
        country: a.country,
        formatted: a.formatted,
        geocodeProvider: a.provider,
        geocodeStatus: "DONE",
        geocodedAt: new Date(),
        geocodeAttempts: c.geocodeAttempts + 1,
        raw: a.raw as object,
      })
      .where(eq(t.locationCaptures.id, captureId));
  } catch {
    await db
      .update(t.locationCaptures)
      .set({
        geocodeAttempts: c.geocodeAttempts + 1,
        geocodeStatus: c.geocodeAttempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
      })
      .where(eq(t.locationCaptures.id, captureId));
  }
}

/** Retries addresses that failed or were never looked up (runs every few minutes). */
export async function geocodePending(limit = 20) {
  if (geocoderName() === "off") return 0;
  const rows = await db
    .select({ id: t.locationCaptures.id })
    .from(t.locationCaptures)
    .where(
      and(
        inArray(t.locationCaptures.geocodeStatus, ["PENDING"]),
        lt(t.locationCaptures.geocodeAttempts, MAX_ATTEMPTS),
        lt(t.locationCaptures.createdAt, sql`now() - interval '1 minute'`)
      )
    )
    .limit(limit);
  for (const r of rows) await geocodeCapture(r.id);
  return rows.length;
}
