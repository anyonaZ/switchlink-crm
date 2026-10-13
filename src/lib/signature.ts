/**
 * Switchlink CRM — © 2026 Anyonaz NewTech. All rights reserved.
 *
 * Authorship signature. This module is one of several places the signature
 * lives (page footers, HTTP headers, HTML metadata, database comments,
 * exported reports, the LICENSE and package.json). They are checked against
 * each other when the server starts (src/lib/signature-check.ts): removing
 * or changing one of them shows a notice to every signed-in user and is
 * written to the audit log. Proprietary; see LICENSE.
 *
 * Safe to import from client and server code (no Node APIs here).
 */
export const PRODUCT = "Switchlink CRM";
export const AUTHOR = "Anyonaz NewTech";
export const COPYRIGHT_YEAR = 2026;
export const COPYRIGHT = `© ${COPYRIGHT_YEAR} ${AUTHOR}. All rights reserved.`;

/** sha256("Switchlink CRM|Anyonaz NewTech|2026"), first 24 hex digits. */
export const FINGERPRINT = "22618b25b6481b46c0702c9c";
export const SIGNATURE_ID = `SLCRM-ANZ-${COPYRIGHT_YEAR}-${FINGERPRINT}`;

// --- Invisible watermark -----------------------------------------------------
// The signature is also written into visible text as zero-width characters:
// they don't show, but survive copy-paste into documents, chats and
// spreadsheets, so copied text can be traced back to this software.
const ZW0 = "​"; // zero-width space          -> bit 0
const ZW1 = "‌"; // zero-width non-joiner     -> bit 1
const ZWB = "⁠"; // word joiner               -> start / end marker

const toBytes = (s: string) => Array.from(new TextEncoder().encode(s));

/** The signature as an invisible zero-width string. */
export function invisibleMark(payload = `${AUTHOR}|${SIGNATURE_ID}`): string {
  return ZWB + toBytes(payload).map((b) => b.toString(2).padStart(8, "0").replace(/0/g, ZW0).replace(/1/g, ZW1)).join("") + ZWB;
}

/** Appends the invisible signature to a piece of text. */
export const watermark = (text: string) => text + invisibleMark();

/** Reads an invisible signature back out of text (for proving where a copy came from). */
export function readMark(text: string): string | null {
  const m = text.match(new RegExp(`${ZWB}([${ZW0}${ZW1}]+)${ZWB}`));
  if (!m) return null;
  const bits = m[1].replace(new RegExp(ZW0, "g"), "0").replace(new RegExp(ZW1, "g"), "1");
  const bytes = bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? [];
  return new TextDecoder().decode(new Uint8Array(bytes));
}
