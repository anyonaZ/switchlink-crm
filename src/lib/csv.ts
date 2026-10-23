/**
 * CSV cells that are safe to open in Excel, LibreOffice and Google Sheets.
 *
 * Spreadsheet apps run a cell as a formula when it starts with = + - @ (and
 * some treat a leading tab or carriage return the same way, also after
 * leading spaces). Any such text cell is prefixed with an apostrophe so it
 * shows as text. Only real numbers, and text that is *entirely* a plain
 * number (e.g. "-1500.50"), are left as they are, so amounts still sum.
 */
const NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[\s ]*[=+\-@\t\r＝＋－＠]/;

export function csvCell(v: string | number | null | undefined): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v ?? "");
  const safe = !NUMBER.test(s) && FORMULA_START.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");
