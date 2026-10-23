/**
 * Checks what an uploaded file really is from its leading bytes ("magic
 * numbers"), ignoring the name and the type the browser claims. Pure; tested in
 * tests/security.test.ts.
 */
export type KycKind = { ok: true; mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; ext: "jpg" | "png" | "webp" | "pdf" };
export type Sniffed = KycKind | { ok: false; error: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** PDF features that can run code or carry other files. Ordinary scans and iTax certificates don't use them. */
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia)[\s/<>()[\]]/;

export function sniffKyc(bytes: Uint8Array): Sniffed {
  if (bytes.length < 16) return { ok: false, error: "That file is empty or damaged." };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ok: true, mime: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, mime: "image/png", ext: "png" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return { ok: true, mime: "image/webp", ext: "webp" };
  // "%PDF-" must be at the very start (some viewers accept it later, which is how polyglot files work).
  if (startsWith(bytes, ascii("%PDF-"))) {
    const text = Buffer.from(bytes).toString("latin1");
    if (!/%%EOF\s*$/.test(text.slice(-1024))) return { ok: false, error: "That PDF looks incomplete. Save or scan it again and re-upload." };
    if (PDF_ACTIVE.test(text)) return { ok: false, error: "That PDF contains scripts or attachments, which aren't accepted. Print it to PDF or scan it, and upload that." };
    return { ok: true, mime: "application/pdf", ext: "pdf" };
  }
  return { ok: false, error: "Use a photo (JPG, PNG, WebP) or a PDF. That file isn't one of these, whatever its name says." };
}
