import { NextResponse } from "next/server";
import { AUTHOR, COPYRIGHT, PRODUCT, SIGNATURE_ID } from "@/lib/signature";
import { signatureStatus } from "@/lib/signature-check";

/** Public: who made this software, and whether this copy's signature is intact. */
export function GET() {
  const s = signatureStatus();
  return NextResponse.json(
    { product: PRODUCT, author: AUTHOR, copyright: COPYRIGHT, signature: SIGNATURE_ID, intact: s.ok, license: "Proprietary. See LICENSE." },
    { headers: { "Cache-Control": "no-store" } }
  );
}
