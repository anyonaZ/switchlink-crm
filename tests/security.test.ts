/** Security and data-hygiene rules (pure functions, no database). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { csvCell, csvLine } from "../src/lib/csv";
import { kenyanMobile } from "../src/lib/phone";
import { sniffKyc } from "../src/lib/files";
import { detailSummary, redactDetail } from "../src/lib/audit-redact";
import { limitWarnings } from "../src/lib/statements/analyze";
import { normalizePhone, phoneKey } from "../src/lib/import/accounts";

test("CSV: formulas are neutralised, plain numbers are not", () => {
  for (const evil of ["=1+1", "+cmd|' /C calc'!A0", "-1+2", "-2+3*cmd|'/C calc'!A1", "@SUM(A1)", "\t=1", "\r=1", "  =HYPERLINK(\"x\")", " =1", "＝1", "-1e3", "- 5"]) {
    const out = csvCell(evil).replace(/^"|"$/g, "");
    assert.ok(out.startsWith("'"), `not neutralised: ${JSON.stringify(evil)} → ${out}`);
  }
  for (const [v, want] of [["-1500", "-1500"], ["-1500.50", "-1500.50"], ["2500", "2500"], [42, "42"], [-3.5, "-3.5"], ["Kamau Shop", "Kamau Shop"], ["", ""], [null, ""]] as const)
    assert.equal(csvCell(v), want);
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvLine(["=x", 5, "ok"]), "'=x,5,ok");
});

test("phones: one canonical Kenyan form", () => {
  for (const v of ["0712345678", "0712 345 678", "+254712345678", "254712345678", "712345678", "(+254) 712-345-678"]) assert.equal(kenyanMobile(v)?.e164, "+254712345678", v);
  assert.equal(kenyanMobile("0112345678")?.local, "0112345678");
  for (const v of ["020 123456", "12345", "07123456789", "0812345678", "", null]) assert.equal(kenyanMobile(v), null, String(v));
  assert.equal(normalizePhone("712345678").phone, "0712345678");
  assert.equal(phoneKey("+254 712 345 678"), phoneKey("0712345678"));
});

const pdf = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`, "latin1");
test("KYC: files are recognised by content, not name or claimed type", () => {
  assert.deepEqual(sniffKyc(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)])), { ok: true, mime: "image/jpeg", ext: "jpg" });
  assert.equal((sniffKyc(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(20).fill(0)])) as { mime: string }).mime, "image/png");
  assert.equal((sniffKyc(Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBPVP8 "), Buffer.alloc(16)])) as { mime: string }).mime, "image/webp");
  assert.equal((sniffKyc(pdf("1 0 obj << /Type /Catalog >> endobj")) as { mime: string }).mime, "application/pdf");
  assert.equal(sniffKyc(Buffer.from("<html><script>alert(1)</script></html>")).ok, false, "HTML renamed .jpg");
  assert.equal(sniffKyc(Buffer.from("MZ\x90\0\x03\0\0\0\x04\0\0\0\xff\xff\0\0")).ok, false, "a Windows program");
  assert.equal(sniffKyc(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)])).ok, false, "GIF isn't accepted");
  assert.equal(sniffKyc(pdf("<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>")).ok, false, "PDF with JavaScript");
  assert.equal(sniffKyc(pdf("<< /Type /Filespec /EmbeddedFile 5 0 R >>")).ok, false, "PDF with an attachment");
  assert.equal(sniffKyc(pdf("<< /S /Launch /F (cmd.exe) >>")).ok, false, "PDF that launches a program");
  assert.equal(sniffKyc(Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n")).ok, false, "truncated PDF");
  assert.equal(sniffKyc(Buffer.from("junk junk junk\n%PDF-1.4\n%%EOF\n")).ok, false, "PDF header not at the start (polyglot)");
  assert.equal(sniffKyc(Buffer.alloc(5)).ok, false);
});

test("audit: sensitive values are masked", () => {
  const r = redactDetail({ amount: 5000, phone: "0712345678", nested: { email: "a@b.c", kraPin: "A123", sha256: "abc" }, list: [{ password: "x" }], reason: "ok" }) as Record<string, unknown>;
  assert.equal(r.amount, 5000);
  assert.equal(r.phone, "•••");
  assert.deepEqual(r.nested, { email: "•••", kraPin: "•••", sha256: "•••" });
  assert.deepEqual(r.list, [{ password: "•••" }]);
  assert.equal(r.reason, "ok");
  assert.ok(!detailSummary({ phone: "0712345678" }).includes("0712"));
});

test("statement limit warnings use the limit in force on each day", () => {
  const limits = [
    { amount: 10000, from: new Date("2026-09-01T00:00:00+03:00") },
    { amount: 30000, from: new Date("2026-10-01T00:00:00+03:00") },
  ];
  // 20,000 overdrawn in October is fine under October's 30,000 limit (old code compared with "today's" limit only).
  assert.deepEqual(limitWarnings([{ date: "2026-10-05", odAfter: 20000 }], limits), []);
  // The same 20,000 in September was over September's 10,000 limit.
  const w = limitWarnings([{ date: "2026-09-10", odAfter: 20000 }, { date: "2026-10-05", odAfter: 20000 }], limits);
  assert.equal(w.length, 1);
  assert.match(w[0], /On 2026-09-10 .* limit in force that day of KES 10,000/);
  assert.match(limitWarnings([{ date: "2026-08-20", odAfter: 500 }], limits)[0], /No QF limit was recorded yet on 2026-08-20/);
  assert.match(limitWarnings([{ date: "2026-08-20", odAfter: 0 }], [])[0], /No QF limit is recorded/);
  assert.deepEqual(limitWarnings([{ date: "2026-09-10", odAfter: 10150 }], limits), [], "within the 2% margin");
});

// Every API route must use the shared gate (apiUser), apart from the deliberately public ones.
test("every API route goes through apiUser()", () => {
  const PUBLIC = new Set(["src/app/api/signature/route.ts", "src/app/api/health/route.ts"]);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
  const routes = walk("src/app/api").filter((f) => f.endsWith("route.ts"));
  assert.ok(routes.length >= 6);
  for (const r of routes) {
    const src = readFileSync(r, "utf8");
    if (PUBLIC.has(r)) continue;
    assert.match(src, /await apiUser\(/, `${r} doesn't call apiUser()`);
    assert.doesNotMatch(src, /getSessionUser\(\)/, `${r} reads the session directly`);
  }
});

test("security headers include a Content Security Policy", () => {
  const cfg = readFileSync("next.config.mjs", "utf8");
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'"]) assert.ok(cfg.includes(d), d);
});

test("no client data files in the repository", () => {
  assert.throws(() => statSync("data/corporates-lindsey-sharon.json"));
  assert.match(readFileSync(".gitignore", "utf8"), /^data\/$/m);
  assert.match(readFileSync(".dockerignore", "utf8"), /^data$/m);
});

// State changes and their audit entries are saved together (one transaction). Only
// standalone events (sign-in, lockout, a virus-rejected upload) are written on their own.
test("audit entries are written inside the change's transaction", () => {
  const STANDALONE = ["login", "login.locked", "kyc.rejected_infected"];
  const files = readdirSync("src/lib/actions").map((f) => path.join("src/lib/actions", f));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/await audit\(([\s\S]*?)\);/g)) {
      const call = m[1];
      const action = call.match(/"([a-z_.]+)"/)?.[1] ?? "";
      if (STANDALONE.includes(action)) continue;
      assert.match(call, /,\s*tx\s*$/, `${f}: audit "${action}" isn't inside its transaction`);
    }
  }
});
