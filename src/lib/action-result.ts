/**
 * Something the person must write down before it's gone, e.g. a temporary
 * password. Shown in a dialog that stays open until they close it, with a
 * copy button, instead of a toast that disappears after a few seconds.
 */
export type Secret = {
  title: string;
  /** What the person is reading out, e.g. "Temporary password". */
  label: string;
  value: string;
  /** Extra lines under the value, e.g. the sign-in email. */
  details?: { label: string; value: string }[];
  note?: string;
  /** The full message for "Share" / "Copy sign-in details". */
  shareText?: string;
};

/** Every server action returns this, so every form can show success or the exact error. */
export type ActionResult =
  | { ok: true; message?: string; id?: string; secret?: Secret }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const ok = (message?: string, id?: string): ActionResult => ({ ok: true, message, id });
export const okSecret = (secret: Secret, id?: string): ActionResult => ({ ok: true, secret, id });
export const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, error, fieldErrors });
export const INITIAL: ActionResult | null = null;
