#!/usr/bin/env python3
"""
Writes a test statement in the layout Pesi exports ("Account Statement
Consolidated", .xls/BIFF8), so tests go through the real parser.

Usage: make_statement.py <spec.json> <out.xls>
spec: {"owner": "...", "account_no": "...", "from": "2026-09-01", "to": "2026-09-30",
       "opening": 2000, "rows": [[serial, "2026-09-02", "Particulars", money_in, money_out], ...]}
Balances are worked out from the opening balance, like the real statement.
Needs xlwt (pip install xlwt). Test tooling only; not used by the app.
"""
import datetime as dt
import json
import sys

import xlwt


def main(spec_path, out):
    spec = json.load(open(spec_path))
    wb = xlwt.Workbook()
    ws = wb.add_sheet("Statement")
    date_style = xlwt.easyxf(num_format_str="YYYY-MM-DD")
    d = lambda s: dt.datetime.strptime(s, "%Y-%m-%d")
    ws.write(0, 3, "Account Statement Consolidated")
    ws.write(2, 0, "Account Owner :"); ws.write(2, 2, spec["owner"])
    ws.write(3, 0, "Account Number :"); ws.write(3, 2, spec["account_no"])
    ws.write(4, 0, "From Date :"); ws.write(4, 2, d(spec["from"]), date_style)
    ws.write(4, 4, "To Date :"); ws.write(4, 6, d(spec["to"]), date_style)
    bal = float(spec["opening"])
    ws.write(5, 0, "Opening Balance :"); ws.write(5, 2, bal)
    lines = []
    for serial, date, particulars, money_in, money_out in spec["rows"]:
        bal = round(bal + money_in - money_out, 2)
        lines.append((serial, date, particulars, money_in, money_out, bal))
    ws.write(6, 0, "Closing Balance :"); ws.write(6, 2, bal)
    for c, h in enumerate(["Serial ID", "Posting Date", "Particulars", "Money In", "Money Out", "Closing"]):
        ws.write(8, c, h)
    ws.write(9, 2, "Opening Balance"); ws.write(9, 3, 0.0); ws.write(9, 4, 0.0); ws.write(9, 5, float(spec["opening"]))
    for i, (serial, date, particulars, money_in, money_out, b) in enumerate(lines):
        r = 10 + i
        ws.write(r, 0, int(serial)); ws.write(r, 1, d(date), date_style); ws.write(r, 2, particulars)
        ws.write(r, 3, float(money_in)); ws.write(r, 4, float(money_out)); ws.write(r, 5, b)
    ws.write(11 + len(lines), 0, "Pesi Africa · 0700 000 000")
    wb.save(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
