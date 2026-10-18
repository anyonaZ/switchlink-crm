/** Every server action returns this, so every form can show success or the exact error. */
export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const ok = (message?: string, id?: string): ActionResult => ({ ok: true, message, id });
export const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, error, fieldErrors });
export const INITIAL: ActionResult | null = null;
