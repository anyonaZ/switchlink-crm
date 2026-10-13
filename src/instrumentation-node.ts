import { geocodePending } from "@/lib/geo/worker";
import { signatureStatus } from "@/lib/signature-check";
import { AUTHOR, SIGNATURE_ID } from "@/lib/signature";

// Retry street-address lookups every 5 minutes. No external queue: one office server, one process.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  const tick = () => geocodePending().catch((e) => console.error("[geocode] retry failed", e));
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000).unref?.();
}

// Authorship signature check (see src/lib/signature.ts). Never stops the server.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  const sig = signatureStatus();
  if (sig.ok) console.log(`[signature] Switchlink CRM by ${AUTHOR} · ${SIGNATURE_ID} · verified`);
  else {
    console.error(`[signature] AUTHORSHIP SIGNATURE ALTERED (${sig.problems.join(", ")}). Software by ${AUTHOR}.`);
    import("@/lib/audit")
      .then(({ audit }) => audit(null, "signature.mismatch", "system", SIGNATURE_ID, { problems: sig.problems }))
      .catch(() => undefined);
  }
}
