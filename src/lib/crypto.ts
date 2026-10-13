import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return k;
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptField(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
