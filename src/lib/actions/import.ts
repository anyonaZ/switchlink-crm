"use server";

import { revalidatePath } from "next/cache";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { canAssignNewAccount, canBulkUpload, initialStatus } from "@/lib/permissions";
import { deletePreview, loadPreview, previewDir as DIR, savePreview, PREVIEW_TTL_MS } from "@/lib/import/previews";
import { kenyanMobile } from "@/lib/phone";
import { isUniqueViolation } from "@/lib/ledger";
import { duplicateInFile, mapHeaders, nameKey, parseRow, phoneKey, type ImportKind, type ImportRow } from "@/lib/import/accounts";

const run = promisify(execFile);
const PARSER = path.join(process.cwd(), "tools", "parse_sheet.py");
const MAX_BYTES = 10 * 1024 * 1024;

export interface PreviewResult {
  ok: boolean;
  error?: string;
  token?: string;
  fileName?: string;
  total?: number;
  ready?: { row: number; kind: ImportKind; name: string; phone: string | null; pesi: string | null; owner: string; warnings: string[] }[];
  skipped?: { row: number; name: string; reason: string }[];
  unknownColumns?: string[];
}
export interface CommitResult {
  ok: boolean;
  error?: string;
  added?: number;
  merchants?: number;
  individuals?: number;
  skipped?: { row: number; name: string; reason: string }[];
}

type Pending = { by: string; fileName: string; createdAt: string; rows: (ImportRow & { ownerId: string; teamId: string | null })[] };

/** Step 1: read the file, check every row, and save nothing yet. */
export async function previewImport(f: FormData): Promise<PreviewResult> {
  const me = await requireUser();
  if (!canBulkUpload(me)) return { ok: false, error: "Only Admins, Team Leaders and BDOs can upload accounts in bulk." };
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a .csv or .xlsx file." };
  const ext = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : file.name.toLowerCase().endsWith(".csv") ? "csv" : null;
  if (!ext) return { ok: false, error: "Use a .csv or .xlsx file (in Excel: File → Save As → CSV or Excel Workbook)." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That file is over 10 MB. Split it into smaller files." };
  const fixed = String(f.get("fixed_kind") ?? "");
  const fixedKind: ImportKind | null = fixed === "MERCHANT" || fixed === "INDIVIDUAL" ? fixed : null;

  // Default owner for rows without an "Assign to" value.
  const defaultOwnerId = String(f.get("owner_id") ?? "") || me.id;

  await mkdir(DIR, { recursive: true, mode: 0o700 });
  const tmp = path.join(DIR, `${randomUUID()}.${ext}`);
  await writeFile(tmp, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  let parsed: { ok: boolean; error?: string; headers?: string[]; rows?: { row: number; values: string[] }[] };
  try {
    const { stdout } = await run(process.env.PYTHON_BIN || "python3", ["-I", PARSER, tmp], { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
    parsed = JSON.parse(stdout);
  } catch (e) {
    parsed = { ok: false, error: e instanceof Error && /ENOENT/.test(e.message) ? "The file reader isn't installed on the server (python3 + openpyxl)." : "The file couldn't be read." };
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { map, unknown } = mapHeaders(parsed.headers!);
  if (map.name === undefined) return { ok: false, error: 'No "Name" column found. Download the template to see the column headings.' };
  if (map.type === undefined && !fixedKind) return { ok: false, error: 'No "Type" column. Add one (Merchant or Individual), or choose the type for the whole file.' };

  const skipped: { row: number; name: string; reason: string }[] = [];
  const rows: ImportRow[] = [];
  for (const r of parsed.rows!) {
    const res = parseRow(r.row, r.values, map, fixedKind);
    if (res.ok) rows.push(res.data);
    else skipped.push({ row: res.row, name: res.name, reason: res.error });
  }
  const dups = duplicateInFile(rows);

  // Who each account goes to: "Assign to" (email or full name), else the default owner.
  const people = await db
    .select({ id: t.users.id, name: t.users.name, email: t.users.email, teamId: t.users.teamId, role: t.users.role, reportsTo: t.users.reportsTo })
    .from(t.users)
    .where(eq(t.users.status, "ACTIVE"));
  const byKey = new Map<string, (typeof people)[number][]>();
  for (const p of people) for (const k of [p.email.toLowerCase(), nameKey(p.name)]) byKey.set(k, [...(byKey.get(k) ?? []), p]);
  const defaultOwner = people.find((p) => p.id === defaultOwnerId);
  if (!defaultOwner) return { ok: false, error: "The default person to assign accounts to wasn't found or is inactive." };
  if (!canAssignNewAccount(me, defaultOwner)) return { ok: false, error: `You can't assign accounts to ${defaultOwner.name}.` };

  // What's already in the CRM.
  const pesis = rows.map((r) => r.pesi).filter((x): x is string => !!x);
  const takenPesi = new Set(
    pesis.length ? (await db.select({ p: t.accounts.pesiAccountNo }).from(t.accounts).where(inArray(t.accounts.pesiAccountNo, pesis))).map((x) => x.p!) : []
  );
  const existing = await db
    .select({ kind: t.accounts.kind, name: t.accounts.name, phone: t.accounts.phone })
    .from(t.accounts)
    .where(inArray(t.accounts.kind, ["MERCHANT", "INDIVIDUAL"]));
  const takenNames = new Set(existing.map((a) => `${a.kind}:${nameKey(a.name)}`));
  const takenPhones = new Set(existing.filter((a) => a.kind === "INDIVIDUAL" && a.phone).map((a) => phoneKey(a.phone!)));

  const ready: Pending["rows"] = [];
  for (const r of rows) {
    let reason = dups.get(r.row) ?? null;
    if (!reason && takenNames.has(`${r.kind}:${nameKey(r.name)}`)) reason = "Already in the CRM (same name)";
    if (!reason && r.pesi && takenPesi.has(r.pesi)) reason = `Pesi number ${r.pesi} is already used by another account`;
    if (!reason && r.kind === "INDIVIDUAL" && r.phone && takenPhones.has(phoneKey(r.phone))) reason = "An individual with this phone number is already in the CRM";
    let owner = defaultOwner;
    if (!reason && r.assignTo) {
      const hits = byKey.get(r.assignTo.includes("@") ? r.assignTo.toLowerCase() : nameKey(r.assignTo)) ?? [];
      if (hits.length === 1) {
        owner = hits[0];
        if (!canAssignNewAccount(me, owner))
          reason = me.role === "BDO" ? `${owner.name} isn't one of your agents` : `You can't assign accounts to ${owner.name}`;
      } else reason = hits.length ? `More than one person is called "${r.assignTo}"; use their email` : `No active user "${r.assignTo}" to assign to`;
    }
    if (reason) skipped.push({ row: r.row, name: r.name, reason });
    else ready.push({ ...r, ownerId: owner.id, teamId: owner.teamId });
  }
  skipped.sort((a, b) => a.row - b.row);

  const token = randomUUID();
  const pending: Pending = { by: me.id, fileName: file.name.slice(0, 200), createdAt: new Date().toISOString(), rows: ready };
  await savePreview(token, pending);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return {
    ok: true,
    token,
    fileName: pending.fileName,
    total: parsed.rows!.length,
    ready: ready.map((r) => ({ row: r.row, kind: r.kind, name: r.name, phone: r.phone, pesi: r.pesi, owner: nameOf.get(r.ownerId) ?? "", warnings: r.warnings })),
    skipped,
    unknownColumns: unknown,
  };
}

/** Step 2: add the checked rows. All-or-nothing; rows that became duplicates meanwhile are skipped. */
export async function commitImport(token: string): Promise<CommitResult> {
  const me = await requireUser();
  if (!canBulkUpload(me)) return { ok: false, error: "Only Admins, Team Leaders and BDOs can upload accounts in bulk." };
  const loaded = await loadPreview<Pending>(token, me.id);
  if (!loaded.ok)
    return {
      ok: false,
      error: loaded.reason === "expired" ? `That check is more than ${PREVIEW_TTL_MS / 60000} minutes old. Upload the file again.` : "That upload has expired. Upload the file again.",
    };
  const pending = loaded.data;

  // The people the rows are assigned to, as they are now (not as they were at the preview).
  const ownerIds = [...new Set(pending.rows.map((r) => r.ownerId))];
  const owners = new Map(
    (ownerIds.length
      ? await db
          .select({ id: t.users.id, name: t.users.name, role: t.users.role, teamId: t.users.teamId, reportsTo: t.users.reportsTo, status: t.users.status })
          .from(t.users)
          .where(inArray(t.users.id, ownerIds))
      : []
    ).map((u) => [u.id, u])
  );

  const skipped: CommitResult["skipped"] = [];
  let merchants = 0,
    individuals = 0;
  await db.transaction(async (tx) => {
    for (const r of pending.rows) {
      // Re-check everything, in case people or accounts changed since the preview.
      const owner = owners.get(r.ownerId);
      if (!owner || owner.status !== "ACTIVE") {
        skipped.push({ row: r.row, name: r.name, reason: `${owner?.name ?? "The person it was assigned to"} is no longer active` });
        continue;
      }
      if (!canAssignNewAccount(me, owner)) {
        skipped.push({ row: r.row, name: r.name, reason: `You can no longer assign accounts to ${owner.name}` });
        continue;
      }
      const e164 = r.kind === "INDIVIDUAL" ? (kenyanMobile(r.phone)?.e164 ?? null) : null;
      if (e164) {
        const [hit] = await tx.select({ id: t.accounts.id }).from(t.accounts).where(and(eq(t.accounts.kind, "INDIVIDUAL"), eq(t.accounts.phoneCanonical, e164)));
        if (hit) {
          skipped.push({ row: r.row, name: r.name, reason: "An individual with this phone number was added meanwhile" });
          continue;
        }
      }
      if (r.pesi) {
        const [hit] = await tx.select({ id: t.accounts.id }).from(t.accounts).where(eq(t.accounts.pesiAccountNo, r.pesi));
        if (hit) {
          skipped.push({ row: r.row, name: r.name, reason: `Pesi number ${r.pesi} was used meanwhile` });
          continue;
        }
      }
      const [same] = await tx
        .select({ id: t.accounts.id })
        .from(t.accounts)
        .where(and(eq(t.accounts.kind, r.kind), sql`lower(regexp_replace(trim(${t.accounts.name}), '[[:space:]]+', ' ', 'g')) = ${nameKey(r.name)}`));
      if (same) {
        skipped.push({ row: r.row, name: r.name, reason: "Added meanwhile" });
        continue;
      }
      const status = initialStatus(me, r.kind);
      const now = new Date();
      // Each row in its own savepoint: if the database's uniqueness rules catch a clash the
      // checks above missed (someone saving at this very moment), only that row is skipped.
      try {
        await tx.transaction(async (tx) => {
      const [acc] = await tx
        .insert(t.accounts)
        .values({
          kind: r.kind,
          name: r.name,
          phone: r.phone,
          email: r.email,
          locationText: r.location,
          pesiAccountNo: r.pesi,
          ownerId: owner.id,
          teamId: owner.teamId,
          status,
          createdBy: me.id,
          ...(status === "ACTIVE" ? { verifiedAt: now, verifiedBy: me.id } : {}),
          ...(status === "PENDING_VERIFICATION" ? { pendingFromStatus: "ONGOING_ENGAGEMENT" as const, verificationRequestedAt: now, verificationRequestedBy: me.id } : {}),
        })
        .returning({ id: t.accounts.id });
      if (r.kind === "MERCHANT") {
        await tx.insert(t.merchantProfiles).values({ accountId: acc.id, businessType: r.businessType, ownerName: r.ownerName, kraPin: r.kraPin, registrationNo: r.registrationNo });
      } else {
        await tx.insert(t.individualProfiles).values({ accountId: acc.id });
      }
      await tx.insert(t.accountStatusHistory).values({ accountId: acc.id, toStatus: status, changedBy: me.id, note: `Uploaded from ${pending.fileName}` });
      const [opp] = await tx.insert(t.opportunities).values({ accountId: acc.id, product: "QUICK_FINANCE", ownerId: r.ownerId, stage: "NEW" }).returning({ id: t.opportunities.id });
      await tx.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, toStage: "NEW", changedBy: me.id });
      if (r.ownerName && r.kind === "MERCHANT") await tx.insert(t.contacts).values({ accountId: acc.id, name: r.ownerName, jobTitle: "Owner", phone: r.phone, email: r.email, isDecisionMaker: true });
      if (r.warnings.length) await tx.insert(t.comments).values({ accountId: acc.id, authorId: me.id, body: r.warnings.join("\n") });
      await tx.insert(t.auditLog).values({ actorId: me.id, action: "account.import", entity: "account", entityId: acc.id, detail: { file: pending.fileName, row: r.row } });
        });
        if (r.kind === "MERCHANT") merchants++;
        else individuals++;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        skipped.push({ row: r.row, name: r.name, reason: "Added by someone else at the same moment" });
      }
    }
  });
  await deletePreview(token);
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { ok: true, added: merchants + individuals, merchants, individuals, skipped };
}
