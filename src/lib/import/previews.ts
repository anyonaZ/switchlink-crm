import "server-only";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { STORAGE_DIR } from "@/lib/config";

/**
 * Checked-but-not-yet-saved bulk uploads. They hold customer names and phone
 * numbers, so they are private to the uploader (0600 files), expire after
 * PREVIEW_TTL_MS, are deleted when committed or expired, and are swept hourly.
 */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
const DIR = path.join(STORAGE_DIR, "imports");
const TOKEN_RE = /^[0-9a-f-]{36}$/i;

export const previewDir = DIR;
const fileFor = (token: string) => path.join(DIR, `${token}.json`);

export async function savePreview(token: string, data: { by: string; createdAt: string } & Record<string, unknown>) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(fileFor(token), JSON.stringify(data), { mode: 0o600 });
}

export type LoadedPreview<T> = { ok: true; data: T } | { ok: false; reason: "missing" | "expired" | "not_yours" };

export async function loadPreview<T extends { by: string; createdAt: string }>(token: string, userId: string, now = Date.now()): Promise<LoadedPreview<T>> {
  if (!TOKEN_RE.test(token)) return { ok: false, reason: "missing" };
  const raw = await readFile(fileFor(token), "utf8").catch(() => null);
  if (!raw) return { ok: false, reason: "missing" };
  const data = JSON.parse(raw) as T;
  if (data.by !== userId) return { ok: false, reason: "not_yours" };
  const age = now - Date.parse(data.createdAt);
  if (!Number.isFinite(age) || age > PREVIEW_TTL_MS || age < -60_000) {
    await deletePreview(token);
    return { ok: false, reason: "expired" };
  }
  return { ok: true, data };
}

export const deletePreview = (token: string) => (TOKEN_RE.test(token) ? unlink(fileFor(token)).catch(() => undefined) : Promise.resolve());

/** Deletes previews (and any leftover upload temp files) older than the TTL. */
export async function purgeExpiredPreviews(now = Date.now()) {
  const names = await readdir(DIR).catch(() => [] as string[]);
  let removed = 0;
  for (const n of names) {
    const full = path.join(DIR, n);
    const s = await stat(full).catch(() => null);
    if (s?.isFile() && now - s.mtimeMs > PREVIEW_TTL_MS) {
      await unlink(full).catch(() => undefined);
      removed++;
    }
  }
  return { removed };
}
