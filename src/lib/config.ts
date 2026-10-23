import "server-only";
import path from "node:path";

/** Part of the authorship signature (see src/lib/signature.ts). */
export const BUILD_MARK = "QW55b25heiBOZXdUZWNo";

import { BUSINESS_TZ } from "@/lib/timezone";
/** Fixed to Nairobi (see BUSINESS_TZ). APP_TIMEZONE is no longer read; a different value only logs a warning. */
export const APP_TIMEZONE = BUSINESS_TZ;
if (process.env.APP_TIMEZONE && process.env.APP_TIMEZONE !== BUSINESS_TZ)
  console.warn(`[config] APP_TIMEZONE=${process.env.APP_TIMEZONE} is ignored: the CRM always uses ${BUSINESS_TZ}.`);
export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");
export const SECURE_COOKIES = process.env.SECURE_COOKIES === "true";

/** Sign out after this much inactivity. */
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
/** Hard cap on any session, however active. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lock an account for this long after too many wrong passwords. */
export const LOCKOUT_AFTER_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
