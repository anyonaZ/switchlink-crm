"use server";

import { revalidatePath } from "next/cache";
import { unlink } from "node:fs/promises";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { findAccountFor } from "@/lib/access";
import { canUploadStatement } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { absolutePath, saveUpload } from "@/lib/storage";
import { analyzeStatement } from "@/lib/statements/analyze";
import { ingestStatement, matchAccount, parseStatementFile } from "@/lib/statements/ingest";

const MAX_BYTES = 8 * 1024 * 1024;

export async function uploadStatement(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const me = await requireUser();
  if (me.role !== "ADMIN") return fail("Only Admins upload statements.");
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose the statement file (.xls).", { file: "Required" });
  if (!/\.xls$/i.test(file.name)) return fail("Upload the statement exactly as Pesi exports it: an .xls file.");
  if (file.size > MAX_BYTES) return fail("That file is over 8 MB, which is too big for a statement.");

  const rel = await saveUpload("statements", file, "xls");
  const discard = async () => unlink(absolutePath(rel)).catch(() => undefined);
  const parsed = await parseStatementFile(absolutePath(rel));
  if (!parsed.ok) {
    await discard();
    return fail(parsed.error);
  }

  // Which account? The one chosen in the form, else matched from the statement.
  const chosenId = String(f.get("account_id") ?? "").trim();
  const preview = analyzeStatement(parsed.data);
  let account = chosenId ? await findAccountFor(me, chosenId) : await matchAccount(parsed.data, preview);
  if (account && !chosenId) account = await findAccountFor(me, account.id); // apply visibility rules
  if (!account) {
    await discard();
    const hint = parsed.data.header.account_no
      ? `No account you can see has statement number ${parsed.data.header.account_no}.`
      : preview.paybillAccountNo
        ? `No account you can see has Pesi account number ${preview.paybillAccountNo}.`
        : "This statement has no account number in it.";
    return fail(`${hint} Pick the account in the form and upload again.`);
  }
  const headerNo = parsed.data.header.account_no?.trim().toUpperCase();
  if (headerNo && account.statementAccountNo && headerNo !== account.statementAccountNo) {
    await discard();
    return fail(`This statement is for account ${headerNo}, but ${account.name} is linked to ${account.statementAccountNo}. Nothing was saved.`);
  }
  if (account.kind !== "MERCHANT" && account.kind !== "INDIVIDUAL") {
    await discard();
    return fail("Statements are for merchant and individual accounts.");
  }
  if (!canUploadStatement(me)) {
    await discard();
    return fail("Only Admins upload statements.");
  }

  try {
    const res = await ingestStatement({ accountId: account.id, uploadedBy: me.id, fileName: file.name, filePath: rel, parsed: parsed.data });
    await audit(me.id, "statement.upload", "account", account.id, { uploadId: res.uploadId, linesNew: res.linesNew, draws: res.drawsAmountNew });
    revalidatePath("/statements");
    revalidatePath(`/accounts/${account.id}`);
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    const draws = res.drawsNew
      ? `${res.drawsNew} new draw${res.drawsNew === 1 ? "" : "s"} worth KES ${res.drawsAmountNew.toLocaleString("en-KE")}`
      : "no new draws";
    return ok(`${account.name}: ${res.linesNew} new line${res.linesNew === 1 ? "" : "s"} of ${res.linesTotal}, ${draws}.`, res.uploadId);
  } catch (e) {
    await discard();
    await db.insert(t.statementUploads).values({
      accountId: account.id,
      fileName: file.name.slice(0, 200),
      uploadedBy: me.id,
      accepted: false,
      message: e instanceof Error ? e.message.slice(0, 1000) : "Unknown error",
      headerAccountNo: parsed.data.header.account_no,
    });
    revalidatePath("/statements");
    return fail(`Statement rejected, nothing was saved. ${e instanceof Error ? e.message : ""}`.trim());
  }
}
