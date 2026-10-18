import "server-only";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AUTHOR, COPYRIGHT_YEAR, FINGERPRINT, PRODUCT, SIGNATURE_ID } from "@/lib/signature";
import { BUILD_MARK } from "@/lib/config";

/**
 * Cross-checks the authorship signature's copies against each other.
 * Runs once per server process. A failed check never stops the CRM: it
 * shows a notice to signed-in users and writes an audit entry, so
 * Switchlink's work is never interrupted by it.
 */
export interface SignatureStatus {
  ok: boolean;
  problems: string[];
  signature: string;
}

let cached: SignatureStatus | null = null;

const read = (rel: string) => {
  const p = path.join(process.cwd(), rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

export function signatureStatus(): SignatureStatus {
  if (cached) return cached;
  const problems: string[] = [];
  const expected = createHash("sha256").update(`${PRODUCT}|${AUTHOR}|${COPYRIGHT_YEAR}`).digest("hex").slice(0, 24);
  if (expected !== FINGERPRINT || !SIGNATURE_ID.endsWith(FINGERPRINT)) problems.push("signature fingerprint");
  if (Buffer.from(BUILD_MARK, "base64").toString("utf8") !== AUTHOR) problems.push("build mark");
  const license = read("LICENSE");
  if (license === null || !license.includes(AUTHOR)) problems.push("LICENSE");
  const pkg = read("package.json");
  if (pkg !== null) {
    try {
      const j = JSON.parse(pkg) as { name?: string; author?: string };
      // The production bundle ships a trimmed package.json; only check the author when it's there.
      if (j.author !== undefined && j.author !== AUTHOR) problems.push("package.json author");
    } catch {
      problems.push("package.json");
    }
  }
  cached = { ok: problems.length === 0, problems, signature: SIGNATURE_ID };
  return cached;
}
