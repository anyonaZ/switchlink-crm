import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap first gate only: sends visitors without a session cookie to /login.
 * The real check (session valid, not idle, user active) runs server-side in
 * every page and action via requireUser(), so this file is not a security
 * boundary on its own.
 */
const PUBLIC = ["/login", "/manifest.webmanifest", "/sw.js", "/offline"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("sl_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
