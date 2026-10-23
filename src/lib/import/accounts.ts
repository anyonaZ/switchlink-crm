/**
 * Rules for the bulk upload of merchant and individual accounts. Pure
 * functions (no database), unit-tested in tests/import.test.ts. The upload
 * action adds the database checks (numbers already in use, accounts that
 * already exist, who to assign each account to).
 */
import { kenyanMobile } from "@/lib/phone";

export type ImportKind = "MERCHANT" | "INDIVIDUAL";
export type ColumnKey =
  | "type"
  | "name"
  | "phone"
  | "email"
  | "businessType"
  | "ownerName"
  | "pesi"
  | "kraPin"
  | "registrationNo"
  | "location"
  | "assignTo";

/** Column headings the upload understands (any of the aliases, any case). */
export const IMPORT_COLUMNS: { key: ColumnKey; label: string; aliases: string[]; example: string }[] = [
  { key: "type", label: "Type", aliases: ["type", "kind", "account type", "category"], example: "Merchant" },
  { key: "name", label: "Name", aliases: ["name", "business name", "merchant name", "full name", "client name", "customer name"], example: "Baraka Butchery" },
  { key: "phone", label: "Phone", aliases: ["phone", "phone number", "phone numbers", "mobile", "mobile number", "telephone", "tel"], example: "0712345678" },
  { key: "email", label: "Email", aliases: ["email", "email address", "e-mail"], example: "" },
  { key: "businessType", label: "Business type", aliases: ["business type", "type of business", "sector", "industry", "business"], example: "Butchery" },
  { key: "ownerName", label: "Owner name", aliases: ["owner name", "owner", "owner's name", "proprietor", "contact person", "contact"], example: "John Mwangi" },
  { key: "pesi", label: "Pesi account no", aliases: ["pesi account no", "pesi account number", "pesi no", "pesi", "pesi account", "account no", "account number"], example: "2101" },
  { key: "kraPin", label: "KRA PIN", aliases: ["kra pin", "kra", "pin"], example: "" },
  { key: "registrationNo", label: "Registration no", aliases: ["registration no", "registration number", "reg no", "business registration"], example: "" },
  { key: "location", label: "Location", aliases: ["location", "area", "where", "address", "town", "market"], example: "Gikomba Market" },
  { key: "assignTo", label: "Assign to", aliases: ["assign to", "assigned to", "agent", "bdo", "agent email", "bdo email", "officer"], example: "agent@switchlinkafrica.com" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();

/** Which column holds which field. Unknown headings are reported, not fatal. */
export function mapHeaders(headers: string[]) {
  const map: Partial<Record<ColumnKey, number>> = {};
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const n = norm(h ?? "");
    if (!n) return;
    const col = IMPORT_COLUMNS.find((c) => c.aliases.includes(n));
    if (col && map[col.key] === undefined) map[col.key] = i;
    else if (!col) unknown.push(h);
  });
  return { map, unknown };
}

/** Kenyan numbers in the CRM's usual 07…/01… form. Excel often drops the leading 0. */
export function normalizePhone(raw: string): { phone: string | null; problem: string | null } {
  const v = raw.trim();
  if (!v) return { phone: null, problem: null };
  const m = kenyanMobile(v);
  return m ? { phone: m.local, problem: null } : { phone: null, problem: `"${v}" isn't a Kenyan phone number` };
}

/** Same comparison the database uses to stop two individuals sharing a number. */
export const phoneKey = (phone: string) => kenyanMobile(phone)?.e164 ?? phone.replace(/\D/g, "");
export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function parseKind(raw: string): ImportKind | null {
  const v = norm(raw);
  if (["merchant", "merchants", "m", "business", "shop"].includes(v)) return "MERCHANT";
  if (["individual", "individuals", "i", "person", "customer", "client"].includes(v)) return "INDIVIDUAL";
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportRow {
  row: number;
  kind: ImportKind;
  name: string;
  phone: string | null;
  email: string | null;
  businessType: string | null;
  ownerName: string | null;
  pesi: string | null;
  kraPin: string | null;
  registrationNo: string | null;
  location: string | null;
  assignTo: string | null;
  /** Kept on the account as a note (e.g. an email that wasn't valid). */
  warnings: string[];
}
export type RowResult = { ok: true; data: ImportRow } | { ok: false; row: number; name: string; error: string };

/**
 * Checks one row. Problems that make the account unusable skip the row;
 * smaller ones (a bad email) drop that field and become a note.
 * `fixedKind` is set when the uploader said every row is the same type.
 */
export function parseRow(row: number, values: string[], map: Partial<Record<ColumnKey, number>>, fixedKind: ImportKind | null): RowResult {
  const get = (k: ColumnKey) => (map[k] === undefined ? "" : String(values[map[k]!] ?? "").trim().replace(/\s+/g, " "));
  const name = get("name");
  if (!name) return { ok: false, row, name: "", error: "No name" };
  const kind = fixedKind ?? parseKind(get("type"));
  if (!kind) return { ok: false, row, name, error: get("type") ? `Type "${get("type")}" isn't Merchant or Individual` : "No type (Merchant or Individual)" };
  const warnings: string[] = [];

  const { phone, problem } = normalizePhone(get("phone"));
  if (kind === "INDIVIDUAL" && !phone) return { ok: false, row, name, error: problem ? `Phone: ${problem}` : "Individuals need a phone number" };
  if (problem) warnings.push(`Phone from the upload: ${get("phone")} (not a valid Kenyan number)`);

  let email: string | null = get("email") || null;
  if (email && !EMAIL_RE.test(email)) {
    warnings.push(`Email from the upload: ${email} (not a valid address)`);
    email = null;
  }
  const pesiRaw = get("pesi").replace(/\s/g, "");
  let pesi: string | null = null;
  if (pesiRaw) {
    const padded = /^\d{1,4}$/.test(pesiRaw) ? pesiRaw.padStart(4, "0") : pesiRaw;
    if (!/^\d{4}$/.test(padded)) return { ok: false, row, name, error: `Pesi account number "${pesiRaw}" must be 4 digits` };
    pesi = padded;
  }
  return {
    ok: true,
    data: {
      row,
      kind,
      name: name.slice(0, 200),
      phone,
      email,
      businessType: kind === "MERCHANT" ? get("businessType") || null : null,
      ownerName: kind === "MERCHANT" ? get("ownerName") || null : null,
      pesi,
      kraPin: kind === "MERCHANT" ? get("kraPin").toUpperCase() || null : null,
      registrationNo: kind === "MERCHANT" ? get("registrationNo") || null : null,
      location: get("location") || null,
      assignTo: get("assignTo") || null,
      warnings,
    },
  };
}

/** Rows that repeat an earlier row in the same file (same Pesi number, individual phone, or name). */
export function duplicateInFile(rows: ImportRow[]): Map<number, string> {
  const out = new Map<number, string>();
  const pesi = new Map<string, number>();
  const phones = new Map<string, number>();
  const names = new Map<string, number>();
  for (const r of rows) {
    const nk = `${r.kind}:${nameKey(r.name)}`;
    if (r.pesi && pesi.has(r.pesi)) out.set(r.row, `Same Pesi number as row ${pesi.get(r.pesi)}`);
    else if (r.kind === "INDIVIDUAL" && r.phone && phones.has(phoneKey(r.phone))) out.set(r.row, `Same phone as row ${phones.get(phoneKey(r.phone!))}`);
    else if (names.has(nk)) out.set(r.row, `Same name as row ${names.get(nk)}`);
    if (out.has(r.row)) continue;
    if (r.pesi) pesi.set(r.pesi, r.row);
    if (r.kind === "INDIVIDUAL" && r.phone) phones.set(phoneKey(r.phone), r.row);
    names.set(nk, r.row);
  }
  return out;
}

/** The downloadable template (CSV). */
export function templateCsv() {
  const head = IMPORT_COLUMNS.map((c) => c.label).join(",");
  const merchant = IMPORT_COLUMNS.map((c) => c.example).join(",");
  const individual = IMPORT_COLUMNS.map((c) =>
    c.key === "type" ? "Individual" : c.key === "name" ? "Grace Wambui" : c.key === "phone" ? "0711998877" : c.key === "location" ? "Kasarani" : c.key === "assignTo" ? c.example : ""
  ).join(",");
  return `${head}\n${merchant}\n${individual}\n`;
}
