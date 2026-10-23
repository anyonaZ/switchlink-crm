import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSessionUser } from "@/lib/auth/session";
import { healthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for Docker, uptime monitors and support.
 * Anyone: { status, version, commit }; 503 when the database is unreachable.
 * Detailed checks (migrations, storage, housekeeping, backups) only for an
 * Admin session or `Authorization: Bearer <HEALTH_TOKEN>`. No secrets either way.
 */
export async function GET(req: NextRequest) {
  const report = await healthReport(await maySeeDetail(req));
  return NextResponse.json(report, { status: report.status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}

async function maySeeDetail(req: NextRequest) {
  const token = process.env.HEALTH_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token && token.length >= 16 && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))) return true;
  const me = await getSessionUser().catch(() => null);
  return me?.role === "ADMIN" && !me.mustChangePassword;
}
