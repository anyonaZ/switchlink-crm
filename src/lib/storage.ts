import "server-only";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { STORAGE_DIR } from "@/lib/config";

/**
 * Uploaded files live under STORAGE_DIR (never under /public), with random names.
 * Folders are 0700 and files 0600: readable only by the app's own user.
 */
async function folderFor(folder: string) {
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "");
  const dir = path.join(STORAGE_DIR, safeFolder);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return { safeFolder, dir };
}

/** Saves an upload with a random name; returns the relative path. */
export async function saveUpload(folder: string, file: File, ext: string): Promise<string> {
  return (await saveUploadBytes(folder, Buffer.from(await file.arrayBuffer()), ext)).rel;
}

/** Same, from bytes already read; also returns the file's SHA-256. */
export async function saveUploadBytes(folder: string, bytes: Buffer, ext: string): Promise<{ rel: string; sha256: string }> {
  const { safeFolder, dir } = await folderFor(folder);
  const name = `${randomUUID()}.${ext.replace(/[^a-z0-9]/g, "")}`;
  const full = path.join(dir, name);
  await writeFile(full, bytes, { mode: 0o600 });
  await chmod(full, 0o600).catch(() => undefined);
  return { rel: path.join(safeFolder, name), sha256: sha256Of(bytes) };
}

export const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function absolutePath(relative: string) {
  const full = path.resolve(STORAGE_DIR, relative);
  if (!full.startsWith(STORAGE_DIR + path.sep)) throw new Error("Bad storage path");
  return full;
}

export const readUpload = (relative: string) => readFile(absolutePath(relative));
export const removeUpload = (relative: string) => unlink(absolutePath(relative)).catch(() => undefined);
