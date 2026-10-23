/**
 * Unsaved form drafts (browser only). A draft:
 * - lives in sessionStorage, so it ends with the browser tab, never on disk for the next person;
 * - is keyed to the signed-in user, so someone else on the same phone never sees it;
 * - expires after DRAFT_TTL_MS;
 * - is wiped on the sign-in page (where every sign-out and expired session ends up).
 */
const PREFIX = "sl-draft:";
/** The old shared key from before drafts were per user; removed wherever drafts are touched. */
const LEGACY_KEYS = ["sl-new-account-draft"];
export const DRAFT_TTL_MS = 4 * 60 * 60 * 1000;

type Stored = { owner: string; savedAt: number; data: Record<string, string> };
const key = (form: string, userId: string) => `${PREFIX}${form}:${userId}`;

function purgeLegacy() {
  for (const k of LEGACY_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {}
    try {
      sessionStorage.removeItem(k);
    } catch {}
  }
}

export function readDraft(form: string, userId: string, now = Date.now()): Record<string, string> | null {
  purgeLegacy();
  try {
    const raw = sessionStorage.getItem(key(form, userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored;
    if (d.owner !== userId || now - d.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(key(form, userId));
      return null;
    }
    return d.data;
  } catch {
    return null;
  }
}

export function writeDraft(form: string, userId: string, data: Record<string, string>) {
  try {
    const stored: Stored = { owner: userId, savedAt: Date.now(), data };
    sessionStorage.setItem(key(form, userId), JSON.stringify(stored));
  } catch {}
}

export function clearDraft(form: string, userId: string) {
  try {
    sessionStorage.removeItem(key(form, userId));
  } catch {}
}

/** Removes every draft for every user, from both storages. */
export function clearAllDrafts() {
  purgeLegacy();
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      const s = store();
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k?.startsWith(PREFIX)) s.removeItem(k);
      }
    } catch {}
  }
}
