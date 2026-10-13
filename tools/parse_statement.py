#!/usr/bin/env python3
"""
Reads a Pesi account statement (.xls, BIFF8 as exported by Crystal Reports)
and prints JSON on stdout. Business rules live in the TypeScript side
(src/lib/statements/ingest.ts); this script only extracts what is printed.

Handles both layouts seen so far:
  * "Account Statement Consolidated": header with Account Owner, Account
    Number, From/To dates, Opening/Closing balance; data in wide, merged
    columns.
  * A bare table: Serial ID | Posting Date | Particulars | Money In |
    Money Out | Closing, with no header block.

Usage: parse_statement.py <file.xls>
Needs: xlrd >= 2.0 (pip install xlrd). Open source, BSD licence.
"""
import datetime as dt
import json
import re
import sys

import xlrd


def cell_str(sheet, r, c):
    v = sheet.cell_value(r, c)
    return v.strip() if isinstance(v, str) else v


def as_date(sheet, book, r, c):
    cell = sheet.cell(r, c)
    if cell.ctype == xlrd.XL_CELL_DATE or (cell.ctype == xlrd.XL_CELL_NUMBER and 20000 < cell.value < 80000):
        return xlrd.xldate_as_datetime(cell.value, book.datemode).date().isoformat()
    if cell.ctype == xlrd.XL_CELL_TEXT:
        s = cell.value.strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y"):
            try:
                return dt.datetime.strptime(s[: len(dt.datetime.now().strftime(fmt))] if "%H" in fmt else s, fmt).date().isoformat()
            except ValueError:
                pass
        m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
        if m:
            return m.group(1)
    return None


def number(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if re.fullmatch(r"-?\d+(\.\d+)?", s):
            return float(s)
    return None


def row_values(sheet, r):
    return [(c, cell_str(sheet, r, c)) for c in range(sheet.ncols) if cell_str(sheet, r, c) not in ("", None)]


def main(path):
    book = xlrd.open_workbook(path)
    sheet = book.sheet_by_index(0)
    header = {"owner": None, "account_no": None, "from": None, "to": None, "opening": None, "closing": None}
    head_row = None
    cols = {}

    for r in range(sheet.nrows):
        vals = row_values(sheet, r)
        texts = {v.lower().rstrip(":- ").strip(): c for c, v in vals if isinstance(v, str)}

        def right_of(label, want="any"):
            c0 = texts.get(label)
            if c0 is None:
                return None
            for c, v in vals:
                if c > c0 and not (isinstance(v, str) and v.lower().rstrip(":- ").strip() in texts and v.lower().rstrip(":- ").strip() != label and want == "any" and False):
                    if want == "date":
                        d = as_date(sheet, book, r, c)
                        if d:
                            return d
                        continue
                    if want == "num":
                        n = number(v)
                        if n is not None:
                            return n
                        continue
                    return v
            return None

        if "account owner" in texts:
            header["owner"] = right_of("account owner")
        if "account number" in texts:
            header["account_no"] = right_of("account number")
        if "from date" in texts:
            header["from"] = right_of("from date", "date")
        if "to date" in texts:
            header["to"] = right_of("to date", "date")
        if "opening balance" in texts:
            header["opening"] = right_of("opening balance", "num")
        if "closing balance" in texts:
            header["closing"] = right_of("closing balance", "num")
        if "serial id" in texts and "particulars" in texts:
            head_row = r
            cols = {"serial": texts["serial id"], "date": texts.get("posting date"), "particulars": texts["particulars"]}
            break

    if head_row is None:
        print(json.dumps({"ok": False, "error": "This doesn't look like a Pesi statement: no 'Serial ID' / 'Particulars' header row was found."}))
        return

    opening = None
    rows = []
    problems = []
    for r in range(head_row + 1, sheet.nrows):
        vals = row_values(sheet, r)
        if not vals:
            continue
        particulars = cell_str(sheet, r, cols["particulars"])
        if not isinstance(particulars, str):
            particulars = str(particulars)
        # Money in, money out and closing balance are the last three numbers right of Particulars.
        nums = [number(v) for c, v in vals if c > cols["particulars"] and number(v) is not None]
        if particulars.lower().startswith("opening balance"):
            if len(nums) >= 3:
                opening = nums[-1]
            continue
        if particulars.lower().startswith("closing balance"):
            if len(nums) >= 1 and header["closing"] is None:
                header["closing"] = nums[-1]
            continue
        # Serial ID and posting date sit left of Particulars, but merged cells can shift
        # them a column away from their headings, so find them by content.
        left = [(c, v) for c, v in vals if c < cols["particulars"]]
        serial, serial_col = None, None
        for c, v in left:
            if sheet.cell(r, c).ctype != xlrd.XL_CELL_DATE and number(v) is not None and float(number(v)).is_integer():
                serial, serial_col = number(v), c
                break
        if serial is None:
            continue  # footer lines (phone numbers, company name)
        date = None
        for c, _ in left:
            if c > serial_col:
                date = as_date(sheet, book, r, c)
                if date:
                    break
        if len(nums) < 3 or date is None:
            problems.append(f"Row {r + 1}: couldn't read the amounts or date.")
            continue
        rows.append(
            {
                "row": r + 1,
                "serial": str(int(serial)),
                "date": date,
                "particulars": particulars,
                "money_in": round(nums[-3], 2),
                "money_out": round(nums[-2], 2),
                "balance": round(nums[-1], 2),
            }
        )

    if opening is None:
        opening = header["opening"] if header["opening"] is not None else 0.0
    print(json.dumps({"ok": True, "header": header, "opening": opening, "rows": rows, "problems": problems}))


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as e:  # noqa: BLE001 - report any read failure as JSON
        print(json.dumps({"ok": False, "error": f"The file couldn't be read as an Excel statement ({type(e).__name__})."}))
