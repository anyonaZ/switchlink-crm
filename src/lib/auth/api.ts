import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

/**
 * The one gate for API routes (pages and actions use requireUser). A request
 * gets through only with a valid session for an ACTIVE user who has finished
 * the forced first-login password change, and, if `roles` is given, holds one
 * of those roles. Resource-level scope (e.g. "can see this account") is still
 * checked by the route itself.
 *
 *   const auth = await apiUser({ roles: ["ADMIN"] });
 *   if (!auth.ok) return auth.response;
 */
export async function apiUser(
  opts: { roles?: SessionUser["role"][] } = {}
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: deny(401, "Sign in first.") };
  if (user.mustChangePassword) return { ok: false, response: deny(403, "Change your temporary password first.") };
  if (opts.roles && !opts.roles.includes(user.role)) return { ok: false, response: deny(403, "Not allowed.") };
  return { ok: true, user };
}

const deny = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
