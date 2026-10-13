/**
 * Pure statement analysis, no database. Tested in tests/statements.test.ts
 * against the two real Pesi statements reviewed in October 2026.
 *
 * Rules agreed with Switchlink:
 *  - Every payment that takes the balance below zero is a QF disbursement of
 *    the part that went below zero ("a draw"). Partial use counts.
 *  - Charges (daily overdraft charges, processing fees, switch fees) push the
 *    balance down too but are never disbursements.
 *  - A reversed payment cancels its draw.
 *  - Cycles used = total drawn / QF limit (computed in reports).
 */
export type LineKind =
  | "COLLECTION"
  | "PAYBILL"
  | "DISBURSEMENT"
  | "SWITCH_CHARGE"
  | "OD_PROCESSING_FEE"
  | "OD_DAILY_CHARGE"
  | "REVERSAL_DISBURSEMENT"
  | "REVERSAL_CHARGE"
  | "OTHER";

export interface ParsedRow {
  row: number;
  serial: string;
  date: string;
  particulars: string;
  money_in: number;
  money_out: number;
  balance: number;
}
export interface ParsedStatement {
  header: { owner: string | null; account_no: string | null; from: string | null; to: string | null; opening: number | null; closing: number | null };
  opening: number;
  rows: ParsedRow[];
  problems: string[];
}

export interface Line extends ParsedRow {
  kind: LineKind;
  odBefore: number;
  odAfter: number;
  /** Positive for a draw, negative for a reversal of one, else 0. */
  draw: number;
}

export interface Analysis {
  lines: Line[];
  errors: string[];
  warnings: string[];
  paybillAccountNo: string | null;
  totals: { drawn: number; reversed: number; charges: number; repaid: number; peakOd: number; closingOd: number };
  feeMismatch: { count: number; extra: number; since: string | null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const od = (balance: number) => (balance < 0 ? r2(-balance) : 0);

export function classify(particulars: string): LineKind {
  const p = particulars.trim();
  if (/^reversal\s*:?-?\s*pesi pay disbursement/i.test(p)) return "REVERSAL_DISBURSEMENT";
  if (/^reversal/i.test(p)) return "REVERSAL_CHARGE";
  if (/^pesi pay disbursement/i.test(p)) return "DISBURSEMENT";
  if (/^pesi pay collection/i.test(p)) return "COLLECTION";
  if (/pay\s*bill/i.test(p)) return "PAYBILL";
  if (/^switch\s*link\s*charge/i.test(p)) return "SWITCH_CHARGE";
  if (/^overdraft processing fee/i.test(p)) return "OD_PROCESSING_FEE";
  if (/^daily overdraft charge/i.test(p)) return "OD_DAILY_CHARGE";
  return "OTHER";
}

const CHARGE_KINDS: LineKind[] = ["SWITCH_CHARGE", "OD_PROCESSING_FEE", "OD_DAILY_CHARGE"];

export function analyzeStatement(s: ParsedStatement, priorDrawsBySerial: Map<string, number> = new Map()): Analysis {
  const errors: string[] = [...s.problems];
  const warnings: string[] = [];
  const lines: Line[] = [];
  let prev = s.opening;
  const drawBySerial = new Map(priorDrawsBySerial);
  const disbursementBySerial = new Map<string, number>();
  let drawn = 0,
    reversed = 0,
    charges = 0,
    repaid = 0,
    peakOd = 0;
  const fee = { count: 0, extra: 0, since: null as string | null };
  const paybillNos = new Map<string, number>();

  for (const row of s.rows) {
    const expected = r2(prev + row.money_in - row.money_out);
    if (Math.abs(expected - row.balance) > 0.01) {
      errors.push(
        `Line ${row.row} (serial ${row.serial}): balance should be ${expected.toFixed(2)} but the statement shows ${row.balance.toFixed(2)}.`
      );
    }
    const kind = classify(row.particulars);
    const odBefore = od(prev);
    const odAfter = od(row.balance);
    let draw = 0;

    if (kind === "DISBURSEMENT") {
      draw = r2(Math.max(0, odAfter - odBefore));
      disbursementBySerial.set(row.serial, row.money_out);
      if (draw > 0) drawBySerial.set(row.serial, draw);
    } else if (kind === "REVERSAL_DISBURSEMENT") {
      const original = drawBySerial.get(row.serial) ?? 0;
      draw = -r2(Math.min(original, row.money_in));
      if (original > 0) drawBySerial.set(row.serial, 0);
    } else if (CHARGE_KINDS.includes(kind)) {
      charges += row.money_out;
      if (kind === "OD_PROCESSING_FEE") {
        const paid = disbursementBySerial.get(row.serial);
        if (paid !== undefined && Math.abs(row.money_out - paid * 0.01) > 0.02) {
          fee.count += 1;
          fee.extra += row.money_out - paid * 0.01;
          fee.since ??= row.date;
        }
      }
    } else if (kind === "OTHER" && row.money_out > 0 && odAfter > odBefore) {
      warnings.push(`Line ${row.row}: "${row.particulars}" took the account further into overdraft but isn't a recognised payment, so it wasn't counted.`);
    }
    if (kind === "PAYBILL") {
      const m = row.particulars.match(/ACC\.?\s*(\d{4})\b/i);
      if (m) paybillNos.set(m[1], (paybillNos.get(m[1]) ?? 0) + 1);
    }
    if (odAfter < odBefore && row.money_in > 0) repaid += odBefore - odAfter;
    if (draw > 0) drawn += draw;
    if (draw < 0) reversed += -draw;
    peakOd = Math.max(peakOd, odAfter);
    lines.push({ ...row, kind, odBefore, odAfter, draw });
    prev = row.balance;
  }

  if (s.header.closing !== null && lines.length && Math.abs(s.header.closing - lines[lines.length - 1].balance) > 0.01) {
    errors.push(`The closing balance in the header (${s.header.closing}) doesn't match the last line (${lines[lines.length - 1].balance}).`);
  }
  if (!lines.length) errors.push("The statement has no transaction lines.");

  if (fee.count) {
    warnings.push(
      `${fee.count} overdraft processing fee${fee.count === 1 ? "" : "s"} didn't equal 1% of the payment (first on ${fee.since}); about KES ${Math.round(fee.extra).toLocaleString("en-KE")} more than 1% in total.`
    );
  }
  const closingOd = lines.length ? od(lines[lines.length - 1].balance) : 0;
  const lastReal = [...lines].reverse().find((l) => !CHARGE_KINDS.includes(l.kind));
  const lastDate = lines.length ? lines[lines.length - 1].date : null;
  if (closingOd > 0 && lastReal && lastDate && (Date.parse(lastDate) - Date.parse(lastReal.date)) / 86400000 > 30) {
    warnings.push(
      `No payments or collections since ${lastReal.date}; the overdraft of KES ${closingOd.toLocaleString("en-KE")} is growing only from charges.`
    );
  }

  const paybillAccountNo = [...paybillNos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    lines,
    errors,
    warnings,
    paybillAccountNo,
    totals: { drawn: r2(drawn), reversed: r2(reversed), charges: r2(charges), repaid: r2(repaid), peakOd: r2(peakOd), closingOd },
    feeMismatch: { ...fee, extra: r2(fee.extra) },
  };
}
