import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { findAccountFor } from "@/lib/access";
import { readUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Streams a KYC document to someone allowed to see its account. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [doc] = await db.select().from(t.kycDocuments).where(eq(t.kycDocuments.id, id));
  if (!doc || !(await findAccountFor(me, doc.accountId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await readUpload(doc.filePath).catch(() => null);
  if (!body) return NextResponse.json({ error: "The file is missing from storage." }, { status: 410 });
  await audit(me.id, "kyc.view", "account", doc.accountId, { documentId: id });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.originalName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
