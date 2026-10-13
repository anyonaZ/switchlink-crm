import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AUTHOR, FINGERPRINT, PRODUCT, SIGNATURE_ID, invisibleMark, readMark, watermark } from "../src/lib/signature";

test("fingerprint matches the product and author", () => {
  const h = createHash("sha256").update(`${PRODUCT}|${AUTHOR}|2026`).digest("hex").slice(0, 24);
  assert.equal(h, FINGERPRINT);
  assert.ok(SIGNATURE_ID.endsWith(FINGERPRINT));
});

test("the invisible watermark is invisible and reads back", () => {
  const text = watermark("Switchlink CRM portfolio report");
  assert.ok(text.startsWith("Switchlink CRM portfolio report"));
  assert.equal(invisibleMark().replace(/[​‌⁠]/g, ""), "", "only zero-width characters");
  assert.equal(readMark(text), `${AUTHOR}|${SIGNATURE_ID}`);
  assert.equal(readMark("plain text"), null);
});

test("every copy of the signature agrees", () => {
  const files = ["LICENSE", "next.config.mjs", "public/humans.txt", "drizzle/0004_authorship_signature.sql", "public/sw.js", "tools/parse_statement.py"];
  for (const f of files) assert.ok(readFileSync(f, "utf8").includes("Anyonaz NewTech"), `${f} names the author`);
  for (const f of ["next.config.mjs", "public/humans.txt", "drizzle/0004_authorship_signature.sql", "public/sw.js"]) assert.ok(readFileSync(f, "utf8").includes(SIGNATURE_ID), `${f} carries the signature id`);
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).author, AUTHOR);
});
