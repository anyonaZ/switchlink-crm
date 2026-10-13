import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { STORAGE_DIR } from "@/lib/config";

/** Saves an upload under STORAGE_DIR/<folder>/ with a random name; returns the relative path. */
export async function saveUpload(folder: string, file: File, ext: string): Promise<string> {
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "");
  const dir = path.join(STORAGE_DIR, safeFolder);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext.replace(/[^a-z0-9]/g, "")}`;
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return path.join(safeFolder, name);
}

export function absolutePath(relative: string) {
  const full = path.resolve(STORAGE_DIR, relative);
  if (!full.startsWith(STORAGE_DIR + path.sep)) throw new Error("Bad storage path");
  return full;
}

export const readUpload = (relative: string) => readFile(absolutePath(relative));
