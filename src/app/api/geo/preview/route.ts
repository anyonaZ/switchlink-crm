import { NextResponse, type NextRequest } from "next/server";
import { apiUser } from "@/lib/auth/api";
import { reverseGeocode, shortAddress } from "@/lib/geo/geocode";

/**
 * Street-name preview shown right after the phone gets a GPS fix.
 * A plain GET (not a server action) so it runs alongside, and never
 * delays, the agent saving the account.
 */
export async function GET(req: NextRequest) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return NextResponse.json({ line: null }, { status: 400 });
  try {
    const a = await reverseGeocode(lat, lng);
    return NextResponse.json({ line: a ? shortAddress(a) ?? a.formatted : null });
  } catch {
    return NextResponse.json({ line: null });
  }
}
