import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { apiUser } from "@/lib/auth/api";
import { findAccountFor } from "@/lib/access";
import { readUpload, sha256Of } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Streams a KYC document to someone allowed to see its account. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const me = auth.user;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [doc] = await db.select().from(t.kycDocuments).where(eq(t.kycDocuments.id, id));
  if (!doc || !(await findAccountFor(me, doc.accountId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await readUpload(doc.filePath).catch(() => null);
  if (!body) return NextResponse.json({ error: "The file is missing from storage." }, { status: 410 });
  // A file that no longer matches what was uploaded is never served.
  if (doc.sha256 && sha256Of(body) !== doc.sha256) {
    await audit(me.id, "kyc.integrity_failed", "account", doc.accountId, { documentId: id });
    return NextResponse.json({ error: "This file has changed since it was uploaded, so it isn't shown. An Admin has been notified in the audit log." }, { status: 409 });
  }
  await audit(me.id, "kyc.view", "account", doc.accountId, { documentId: id });
  const safeName = doc.originalName.replace(/[^\w.\- ]/g, "_");
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(body.length),
      // Images and PDFs open in the browser, but sandboxed: no scripts, no forms, no requests out.
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
