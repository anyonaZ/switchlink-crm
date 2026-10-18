import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { templateCsv } from "@/lib/import/accounts";
import { canBulkUpload } from "@/lib/permissions";

/** The CSV template for the bulk account upload (opens in Excel). */
export async function GET() {
  const me = await getSessionUser();
  if (!me || !canBulkUpload(me)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  return new NextResponse("﻿" + templateCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="switchlink-accounts-template.csv"' },
  });
}
