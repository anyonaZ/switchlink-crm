"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { findAccountFor, loadPerson } from "@/lib/access";
import { bdoFor, canEditAccount, canManageQf, canRecordDisbursement } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PRODUCTS_FOR_KIND, PRODUCT_LABELS } from "@/lib/labels";
import { nairobiToInstant } from "@/lib/format";
import { saveUpload } from "@/lib/storage";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const amountOf = (f: FormData, k: string) => {
  const n = Number(String(f.get(k) ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : null;
};

function touch(accountId: string) {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

export async function setQfLimit(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc) return fail("Account not found.");
  if (acc.kind !== "MERCHANT" && acc.kind !== "INDIVIDUAL") return fail("Quick Finance limits apply to merchants and individuals only.");
  if (!canManageQf(me)) return fail("Only Admins set QF limits.");
  const amount = amountOf(f, "amount");
  if (amount === null) return fail("Enter the limit in KES.", { amount: "Enter an amount above 0" });
  const effective = nairobiToInstant(String(f.get("effective_from") ?? ""), "00:00");
  if (!effective) return fail("Pick the date the limit takes effect.", { effective_from: "Required" });
  await db.insert(t.qfLimits).values({ accountId, amount: amount.toFixed(2), effectiveFrom: effective, setBy: me.id, note: str(f, "note") });
  await audit(me.id, "qf_limit.set", "account", accountId, { amount });
  touch(accountId);
  return ok(`QF limit set to KES ${amount.toLocaleString("en-KE")}.`);
}

/** Who a disbursement on this account may be credited to, for this person. */
export async function creditOptions(accountId: string) {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc) return [];
  if (!canRecordDisbursement(me)) return [];
  const people = await db
    .select({ id: t.users.id, name: t.users.name, role: t.users.role, teamId: t.users.teamId })
    .from(t.users)
    .where(eq(t.users.status, "ACTIVE"));
  return people.filter((p) => p.role !== "ADMIN").map((p) => ({ id: p.id, name: p.name, role: p.role }));
}

export async function recordDisbursement(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc) return fail("Account not found.");
  const product = String(f.get("product") ?? "");
  if (!(PRODUCTS_FOR_KIND[acc.kind] as readonly string[]).includes(product)) return fail("That product isn't offered to this account.");
  const amount = amountOf(f, "amount");
  if (amount === null) return fail("Enter the amount disbursed.", { amount: "Enter an amount above 0" });
  const when = nairobiToInstant(String(f.get("disbursed_on") ?? ""), "12:00");
  if (!when || when.getTime() > Date.now() + 86400000) return fail("Pick the disbursement date (not in the future).", { disbursed_on: "Required" });

  const creditedTo = await loadPerson(str(f, "credited_to") ?? acc.ownerId);
  if (!creditedTo) return fail("Choose who this disbursement is credited to.", { credited_to: "Required" });
  if (!canRecordDisbursement(me)) return fail("Only Admins record disbursements.");
  const [opp] = await db
    .select({ id: t.opportunities.id })
    .from(t.opportunities)
    .where(and(eq(t.opportunities.accountId, accountId), eq(t.opportunities.product, product as "SNPL")));

  const [row] = await db
    .insert(t.disbursements)
    .values({
      accountId,
      opportunityId: opp?.id ?? null,
      product: product as "SNPL",
      amount: amount.toFixed(2),
      disbursedAt: when,
      creditedTo: creditedTo.id,
      creditedBdoId: bdoFor(creditedTo),
      creditedTeamId: creditedTo.teamId,
      createdBy: me.id,
      source: "MANUAL",
      notes: str(f, "notes"),
    })
    .returning({ id: t.disbursements.id });
  await audit(me.id, "disbursement.record", "disbursement", row.id, { accountId, amount, product, creditedTo: creditedTo.id });
  touch(accountId);
  return ok(`${PRODUCT_LABELS[product as "SNPL"]} disbursement of KES ${amount.toLocaleString("en-KE")} recorded for ${creditedTo.name}.`);
}

/** Corrections never edit the ledger: they add an equal negative row. */
export async function reverseDisbursement(disbursementId: string, reason = ""): Promise<ActionResult> {
  const me = await requireUser();
  const [d] = await db.select().from(t.disbursements).where(eq(t.disbursements.id, disbursementId));
  if (!d || Number(d.amount) <= 0) return fail("That entry can't be reversed.");
  if (d.source === "STATEMENT") return fail("Statement entries are corrected by the statement itself, not by hand.");
  const acc = await findAccountFor(me, d.accountId);
  if (!acc || !canRecordDisbursement(me)) return fail("Only Admins reverse ledger entries.");
  const [already] = await db.select({ id: t.disbursements.id }).from(t.disbursements).where(eq(t.disbursements.reversesId, d.id));
  if (already) return fail("This entry has already been reversed.");
  if (!reason.trim()) return fail("Give a reason for the reversal.");
  await db.insert(t.disbursements).values({
    accountId: d.accountId,
    opportunityId: d.opportunityId,
    product: d.product,
    amount: (-Number(d.amount)).toFixed(2),
    disbursedAt: d.disbursedAt,
    creditedTo: d.creditedTo,
    creditedBdoId: d.creditedBdoId,
    creditedTeamId: d.creditedTeamId,
    createdBy: me.id,
    source: "MANUAL",
    reversesId: d.id,
    notes: `Reversal: ${reason.trim().slice(0, 300)}`,
  });
  await audit(me.id, "disbursement.reverse", "disbursement", d.id, { reason });
  touch(d.accountId);
  return ok("Entry reversed.");
}

const KYC_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_KYC_BYTES = 10 * 1024 * 1024;

export async function uploadKycDocument(accountId: string, _prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const acc = await findAccountFor(me, accountId);
  if (!acc || !canEditAccount(me, acc)) return fail("You can't add documents to this account.");
  const docType = str(f, "doc_type");
  if (!docType) return fail("Say what the document is.", { doc_type: "Required" });
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a photo or PDF.", { file: "Required" });
  const ext = KYC_TYPES[file.type];
  if (!ext) return fail("Use a photo (JPG, PNG, WebP) or a PDF.");
  if (file.size > MAX_KYC_BYTES) return fail("That file is over 10 MB.");
  const rel = await saveUpload(`kyc/${accountId}`, file, ext);
  await db.insert(t.kycDocuments).values({
    accountId,
    docType: docType.slice(0, 120),
    filePath: rel,
    originalName: file.name.slice(0, 200) || `document.${ext}`,
    mimeType: file.type,
    sizeBytes: file.size,
    uploadedBy: me.id,
  });
  await audit(me.id, "kyc.upload", "account", accountId, { docType });
  revalidatePath(`/accounts/${accountId}`);
  return ok("Document uploaded.");
}
