import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateInFile, mapHeaders, normalizePhone, parseKind, parseRow, templateCsv, type ImportRow } from "../src/lib/import/accounts";

test("headings are matched by name, in any case or wording", () => {
  const { map, unknown } = mapHeaders(["Type", "Business Name", "PHONE NUMBER", "Owner's name", "Pesi Account No", "Notes"]);
  assert.deepEqual(map, { type: 0, name: 1, phone: 2, ownerName: 3, pesi: 4 });
  assert.deepEqual(unknown, ["Notes"]);
});

test("phone numbers: Excel's dropped zero, +254 and spaces all become 07…", () => {
  assert.equal(normalizePhone("712345678").phone, "0712345678");
  assert.equal(normalizePhone("+254 712 345 678").phone, "0712345678");
  assert.equal(normalizePhone("0112345678").phone, "0112345678");
  assert.equal(normalizePhone("").phone, null);
  assert.match(normalizePhone("7207640471").problem!, /isn't a Kenyan/);
});

test("type words", () => {
  assert.equal(parseKind("Merchant"), "MERCHANT");
  assert.equal(parseKind(" individual "), "INDIVIDUAL");
  assert.equal(parseKind("school"), null);
});

const { map } = mapHeaders(["Type", "Name", "Phone", "Email", "Pesi account no", "Business type", "Assign to"]);
test("rows: individuals need a phone; bad email kept as a note; Pesi padded to 4 digits", () => {
  const ind = parseRow(2, ["Individual", "Grace", "", "", "", "", ""], map, null);
  assert.equal(ind.ok, false);
  const m = parseRow(3, ["Merchant", "Baraka Butchery", "712000111", "not-an-email", "21", "Butchery", "a@b.co"], map, null);
  assert.ok(m.ok);
  if (m.ok) {
    assert.equal(m.data.phone, "0712000111");
    assert.equal(m.data.email, null);
    assert.equal(m.data.pesi, "0021");
    assert.equal(m.data.businessType, "Butchery");
    assert.equal(m.data.assignTo, "a@b.co");
    assert.equal(m.data.warnings.length, 1);
  }
  const badPesi = parseRow(4, ["Merchant", "X", "", "", "12345", "", ""], map, null);
  assert.ok(!badPesi.ok && /4 digits/.test(badPesi.error));
  const noType = parseRow(5, ["", "Y", "0712", "", "", "", ""], map, null);
  assert.ok(!noType.ok);
  const fixed = parseRow(6, ["", "Z Shop", "", "", "", "", ""], map, "MERCHANT");
  assert.ok(fixed.ok, "the whole file's type is used when there's no Type value");
});

test("repeats inside the same file are caught", () => {
  const base = { email: null, businessType: null, ownerName: null, kraPin: null, registrationNo: null, location: null, assignTo: null, warnings: [] };
  const rows: ImportRow[] = [
    { ...base, row: 2, kind: "INDIVIDUAL", name: "Grace", phone: "0711998877", pesi: null },
    { ...base, row: 3, kind: "INDIVIDUAL", name: "Grace W", phone: "+254711998877", pesi: null },
    { ...base, row: 4, kind: "MERCHANT", name: "Shop A", phone: null, pesi: "2101" },
    { ...base, row: 5, kind: "MERCHANT", name: "Shop B", phone: null, pesi: "2101" },
    { ...base, row: 6, kind: "MERCHANT", name: "shop  a", phone: null, pesi: null },
  ];
  const d = duplicateInFile(rows);
  assert.deepEqual([...d.keys()], [3, 5, 6]);
});

test("the template's headings are all understood", () => {
  const [head] = templateCsv().split("\n");
  const { unknown } = mapHeaders(head.split(","));
  assert.deepEqual(unknown, []);
});
