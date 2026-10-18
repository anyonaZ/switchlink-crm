/**
 * First-run setup: creates an Admin account.
 *   npm run user:create-admin -- "Full Name" email@example.com
 * Prints a temporary password; the Admin must change it at first sign-in.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import * as t from "../src/lib/db/schema";
import { loadEnv } from "./env";

loadEnv();
const [name, email] = process.argv.slice(2);
if (!name || !email || !email.includes("@")) {
  console.error('Usage: npm run user:create-admin -- "Full Name" email@example.com');
  process.exit(1);
}
const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: t });
const exists = await db.select({ id: t.users.id }).from(t.users).where(sql`lower(${t.users.email}) = ${email.toLowerCase()}`);
if (exists.length) {
  console.error("A user with that email already exists.");
  process.exit(1);
}
const password = `Sl-${randomBytes(6).toString("base64url")}-${Math.floor(1000 + Math.random() * 9000)}`;
await db.insert(t.users).values({
  name,
  email: email.toLowerCase(),
  passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  role: "ADMIN",
  mustChangePassword: true,
});
await client.end();
console.log(`Admin created: ${email}\nTemporary password: ${password}\nSign in and set your own password.`);
