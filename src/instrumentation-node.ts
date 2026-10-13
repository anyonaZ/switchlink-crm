import { geocodePending } from "@/lib/geo/worker";

// Retry street-address lookups every 5 minutes. No external queue: one office server, one process.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  const tick = () => geocodePending().catch((e) => console.error("[geocode] retry failed", e));
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000).unref?.();
}
