#!/usr/bin/env python3
"""
Reads the first sheet of a .csv or .xlsx file and prints JSON on stdout:
  {"ok": true, "headers": [...], "rows": [{"row": 2, "values": [...]}, ...]}
Used by the bulk account upload. It only extracts cells; the rules live in
src/lib/import/accounts.ts.

Usage: parse_sheet.py <file>
Needs: openpyxl for .xlsx (pip install openpyxl). Open source, MIT licence.
Part of Switchlink CRM, (c) 2026 Anyonaz NewTech. All rights reserved.
"""
import csv
import datetime as dt
import json
import sys

MAX_ROWS = 5000


def cell(v):
    if v is None:
        return ""
    if isinstance(v, float):
        # Excel stores phone numbers as numbers: 712345678.0 -> "712345678"
        return str(int(v)) if v.is_integer() else str(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        return [[cell(c) for c in r] for r in csv.reader(f, dialect)]


def read_xlsx(path):
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    return [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]


def main(path):
    lower = path.lower()
    if lower.endswith(".csv"):
        table = read_csv(path)
    elif lower.endswith(".xlsx"):
        table = read_xlsx(path)
    else:
        print(json.dumps({"ok": False, "error": "Use a .csv or .xlsx file."}))
        return
    # The header row is the first row with at least two filled cells.
    start = next((i for i, r in enumerate(table) if sum(1 for c in r if c) >= 2), None)
    if start is None:
        print(json.dumps({"ok": False, "error": "The file is empty."}))
        return
    headers = table[start]
    rows = []
    for i, r in enumerate(table[start + 1 :], start=start + 2):
        if not any(r):
            continue
        rows.append({"row": i, "values": r})
        if len(rows) > MAX_ROWS:
            print(json.dumps({"ok": False, "error": f"The file has more than {MAX_ROWS} rows. Split it into smaller files."}))
            return
    print(json.dumps({"ok": True, "headers": headers, "rows": rows}))


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as e:  # noqa: BLE001 - report any read failure as JSON
        print(json.dumps({"ok": False, "error": f"The file couldn't be read ({type(e).__name__})."}))
