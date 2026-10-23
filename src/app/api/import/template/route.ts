import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth/api";
import { templateCsv } from "@/lib/import/accounts";
import { canBulkUpload } from "@/lib/permissions";

/** The CSV template for the bulk account upload (opens in Excel). */
export async function GET() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  if (!canBulkUpload(auth.user)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  return new NextResponse("﻿" + templateCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="switchlink-accounts-template.csv"' },
  });
}
