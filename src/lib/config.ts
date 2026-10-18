import "server-only";
import path from "node:path";

/** Part of the authorship signature (see src/lib/signature.ts). */
export const BUILD_MARK = "QW55b25heiBOZXdUZWNo";

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Africa/Nairobi";
export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");
export const SECURE_COOKIES = process.env.SECURE_COOKIES === "true";

/** Sign out after this much inactivity. */
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
/** Hard cap on any session, however active. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lock an account for this long after too many wrong passwords. */
export const LOCKOUT_AFTER_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
