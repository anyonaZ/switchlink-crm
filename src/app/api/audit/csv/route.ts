import { NextResponse, type NextRequest } from "next/server";
import { apiUser } from "@/lib/auth/api";
import { audit } from "@/lib/audit";
import { auditPage, parseAuditFilters } from "@/lib/audit-view";
import { redactDetail } from "@/lib/audit-redact";
import { csvLine } from "@/lib/csv";
import { BUSINESS_TZ } from "@/lib/timezone";

/** Admin-only export of the filtered audit log (masked, max 10,000 rows). The export itself is audited. */
export async function GET(req: NextRequest) {
  const auth = await apiUser({ roles: ["ADMIN"] });
  if (!auth.ok) return auth.response;
  const f = parseAuditFilters(Object.fromEntries(req.nextUrl.searchParams));
  const { rows } = await auditPage({ ...f, page: 1 }, 10_000);
  await audit(auth.user.id, "audit.export", "audit_log", null, { filters: f, rows: rows.length });
  const out = [
    csvLine(["Time (UTC)", "Timezone for display", "Action", "By", "Entity", "Entity id", "Detail"]),
    ...rows.map((r) =>
      csvLine([r.at.toISOString(), BUSINESS_TZ, r.action, r.actorName ?? (r.actorId ? "Deleted user" : "System"), r.entity, r.entityId, r.detail == null ? "" : JSON.stringify(redactDetail(r.detail))])
    ),
  ];
  return new NextResponse("﻿" + out.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="switchlink-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
