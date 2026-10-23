import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { analyzeStatement, limitWarnings, type Analysis, type ParsedStatement } from "./analyze";
import { bdoFor } from "@/lib/permissions";
import { audit } from "@/lib/audit";

const run = promisify(execFile);
const PARSER = path.join(process.cwd(), "tools", "parse_statement.py");

export async function parseStatementFile(absPath: string): Promise<{ ok: true; data: ParsedStatement } | { ok: false; error: string }> {
  try {
    const { stdout } = await run(process.env.PYTHON_BIN || "python3", ["-I", PARSER, absPath], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as ({ ok: true } & ParsedStatement) | { ok: false; error: string };
    return parsed.ok ? { ok: true, data: parsed } : { ok: false, error: parsed.error };
  } catch (e) {
    const msg = e instanceof Error && /ENOENT/.test(e.message) ? "The statement reader isn't installed on the server (python3 + xlrd)." : "The statement couldn't be read.";
    return { ok: false, error: msg };
  }
}

/** Finds which account a statement belongs to from its header or Paybill lines. */
export async function matchAccount(parsed: ParsedStatement, analysis: Analysis) {
  const no = parsed.header.account_no?.trim().toUpperCase();
  if (no) {
    const [a] = await db.select().from(t.accounts).where(eq(t.accounts.statementAccountNo, no));
    if (a) return a;
  }
  if (analysis.paybillAccountNo) {
    const [a] = await db.select().from(t.accounts).where(eq(t.accounts.pesiAccountNo, analysis.paybillAccountNo));
    if (a) return a;
  }
  return null;
}

/**
 * Draws recorded by earlier uploads, for the serials this statement reverses:
 * `net` (the amount of each draw not yet reversed) so a reversal can only cancel
 * what is still standing, and `openDrawId` (that draw's id) so the
 * reversal is linked to it even though it arrived in a later upload.
 */
export async function priorDraws(accountId: string, serials: string[], q: Pick<typeof db, "select"> = db) {
  const net = new Map<string, number>();
  const openDrawId = new Map<string, string>();
  if (!serials.length) return { net, openDrawId };
  const rows = await q
    .select({ id: t.disbursements.id, serial: t.statementLines.serialId, amount: t.disbursements.amount, reversesId: t.disbursements.reversesId })
    .from(t.disbursements)
    .innerJoin(t.statementLines, eq(t.statementLines.id, t.disbursements.statementLineId))
    .where(and(eq(t.disbursements.accountId, accountId), inArray(t.statementLines.serialId, serials)))
    .orderBy(t.disbursements.disbursedAt, t.disbursements.createdAt);
  // A draw can be reversed once (as within a single statement), so only draws with no
  // reversal yet are still standing.
  const reversed = new Set(rows.map((r) => r.reversesId).filter(Boolean));
  for (const r of rows) {
    if (Number(r.amount) <= 0 || reversed.has(r.id)) continue;
    net.set(r.serial, Number(r.amount));
    openDrawId.set(r.serial, r.id);
  }
  return { net, openDrawId };
}

export interface IngestResult {
  uploadId: string;
  linesTotal: number;
  linesNew: number;
  /** New draws (money lent), not counting reversals. */
  drawsNew: number;
  drawsAmountNew: number;
  reversalsNew: number;
  reversedAmountNew: number;
  warnings: string[];
}

/**
 * Saves a verified statement. All-or-nothing: if anything fails, nothing
 * from this upload is kept. Lines already seen in an earlier upload are
 * skipped, so overlapping uploads only add what's new.
 */
export async function ingestStatement(opts: {
  accountId: string;
  uploadedBy: string;
  fileName: string;
  filePath: string;
  parsed: ParsedStatement;
}): Promise<IngestResult> {
  const { accountId, parsed } = opts;
  const reversalSerials = parsed.rows.filter((r) => /^reversal/i.test(r.particulars)).map((r) => r.serial);
  const prior = await priorDraws(accountId, reversalSerials);
  const analysis = analyzeStatement(parsed, prior.net);
  if (analysis.errors.length) throw new Error(analysis.errors.slice(0, 3).join(" "));

  const [acc] = await db.select().from(t.accounts).where(eq(t.accounts.id, accountId));
  const owner = acc.ownerId ? (await db.select().from(t.users).where(eq(t.users.id, acc.ownerId)))[0] : null;
  const warnings = [...analysis.warnings];
  if (!owner) warnings.push("This account has no assigned agent, so new draws were recorded without credit to anyone.");

  // QF limit checks, against the limit in force on each line's date (not today's limit).
  const limits = await db
    .select({ amount: t.qfLimits.amount, effectiveFrom: t.qfLimits.effectiveFrom })
    .from(t.qfLimits)
    .where(eq(t.qfLimits.accountId, accountId))
    .orderBy(asc(t.qfLimits.effectiveFrom));
  warnings.push(...limitWarnings(analysis.lines, limits.map((l) => ({ amount: Number(l.amount), from: l.effectiveFrom }))));

  return db.transaction(async (tx) => {
    const [up] = await tx
      .insert(t.statementUploads)
      .values({
        accountId,
        fileName: opts.fileName.slice(0, 200),
        filePath: opts.filePath,
        uploadedBy: opts.uploadedBy,
        headerOwner: parsed.header.owner,
        headerAccountNo: parsed.header.account_no,
        periodFrom: parsed.header.from ?? analysis.lines[0]?.date ?? null,
        periodTo: parsed.header.to ?? analysis.lines.at(-1)?.date ?? null,
        closingBalance: analysis.lines.at(-1)?.balance.toFixed(2) ?? null,
        linesTotal: analysis.lines.length,
        accepted: true,
        warnings,
      })
      .returning({ id: t.statementUploads.id });

    let linesNew = 0,
      drawsNew = 0,
      drawsAmountNew = 0,
      reversalsNew = 0,
      reversedAmountNew = 0;
    // Draws not yet reversed, by serial: earlier uploads first, then this one.
    const openDraw = new Map(prior.openDrawId);
    // Net new lending per serial in this upload (a draw reversed in the same upload nets to 0).
    const netBySerial = new Map<string, number>();
    for (const l of analysis.lines) {
      const [ins] = await tx
        .insert(t.statementLines)
        .values({
          accountId,
          uploadId: up.id,
          serialId: l.serial,
          kind: l.kind,
          postingDate: l.date,
          particulars: l.particulars.slice(0, 500),
          moneyIn: l.money_in.toFixed(2),
          moneyOut: l.money_out.toFixed(2),
          balance: l.balance.toFixed(2),
          odBefore: l.odBefore.toFixed(2),
          odAfter: l.odAfter.toFixed(2),
        })
        .onConflictDoNothing()
        .returning({ id: t.statementLines.id });
      if (!ins) continue; // already recorded by an earlier upload
      linesNew++;
      if (l.draw === 0) continue;
      const reverses = l.draw < 0 ? openDraw.get(l.serial) ?? null : null;
      if (l.draw < 0 && !reverses) {
        // The analysis only produces a reversal when there's a standing draw to cancel; if the
        // link can't be found the ledger would drift, so refuse the whole upload instead.
        throw new Error(`Line ${l.row} (serial ${l.serial}) reverses a draw that isn't in the CRM. Upload the earlier statement first.`);
      }
      const [d] = await tx
        .insert(t.disbursements)
        .values({
          accountId,
          opportunityId: null,
          product: "QUICK_FINANCE",
          amount: l.draw.toFixed(2),
          disbursedAt: new Date(`${l.date}T12:00:00+03:00`),
          creditedTo: owner?.id ?? null,
          creditedBdoId: bdoFor(owner ?? null),
          creditedTeamId: owner?.teamId ?? acc.teamId,
          createdBy: opts.uploadedBy,
          source: "STATEMENT",
          statementLineId: ins.id,
          reversesId: reverses,
          notes: l.draw > 0 ? `Overdraft draw: ${l.particulars.slice(0, 120)}` : `Reversed: ${l.particulars.slice(0, 120)}`,
        })
        .returning({ id: t.disbursements.id });
      if (l.draw > 0) {
        openDraw.set(l.serial, d.id);
        drawsNew++;
        drawsAmountNew += l.draw;
      } else {
        openDraw.delete(l.serial);
        reversalsNew++;
        reversedAmountNew += -l.draw;
      }
      netBySerial.set(l.serial, (netBySerial.get(l.serial) ?? 0) + l.draw);
    }

    // Link the statement's account number to the account the first time we see it.
    if (parsed.header.account_no && !acc.statementAccountNo) {
      const no = parsed.header.account_no.trim().toUpperCase();
      const [taken] = await tx.select({ id: t.accounts.id }).from(t.accounts).where(eq(t.accounts.statementAccountNo, no));
      if (!taken) await tx.update(t.accounts).set({ statementAccountNo: no }).where(eq(t.accounts.id, accountId));
    }
    drawsAmountNew = Math.round(drawsAmountNew * 100) / 100;
    reversedAmountNew = Math.round(reversedAmountNew * 100) / 100;
    await tx
      .update(t.statementUploads)
      .set({ linesNew, drawsNew, drawsAmountNew: drawsAmountNew.toFixed(2), reversalsNew, reversedAmountNew: reversedAmountNew.toFixed(2) })
      .where(eq(t.statementUploads.id, up.id));
    // Opportunity follows: a merchant drawing on QF is a won QF opportunity. Only real new
    // lending counts: a reversal, or a draw reversed in this same upload, doesn't.
    const lentNew = [...netBySerial.values()].some((v) => v > 0.004);
    if (lentNew) {
      const [opp] = await tx
        .select()
        .from(t.opportunities)
        .where(and(eq(t.opportunities.accountId, accountId), eq(t.opportunities.product, "QUICK_FINANCE")));
      if (opp && opp.stage !== "ACTIVE") {
        await tx.update(t.opportunities).set({ stage: "ACTIVE" }).where(eq(t.opportunities.id, opp.id));
        await tx.insert(t.opportunityStageHistory).values({ opportunityId: opp.id, fromStage: opp.stage, toStage: "ACTIVE", changedBy: opts.uploadedBy });
      }
    }
    // Recorded in the same transaction: the upload and its audit entry are saved together or not at all.
    await audit(
      opts.uploadedBy,
      "statement.upload",
      "account",
      accountId,
      { uploadId: up.id, linesNew, draws: drawsAmountNew, reversals: reversedAmountNew },
      tx
    );
    return { uploadId: up.id, linesTotal: analysis.lines.length, linesNew, drawsNew, drawsAmountNew, reversalsNew, reversedAmountNew, warnings };
  });
}
