/**
 * Creates the first Admin login, and nothing else (no demo data).
 *   npm run db:seed                                  -> "Administrator", admin@test.com
 *   npm run db:seed -- "Your Name"                   -> your name, admin@test.com
 *   npm run db:seed -- "Your Name" you@example.com   -> your name and email
 * Password: Switchlink2026! (must be changed at first sign-in).
 * The name can be changed later from Profile in the app.
 * Safe to run twice: it does nothing if that email already exists.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import { sql } from "drizzle-orm";
import * as t from "../src/lib/db/schema";
import { loadEnv } from "./env";

loadEnv();
const name = (process.argv[2] ?? "").trim() || "Administrator";
const email = ((process.argv[3] ?? "").trim() || "admin@test.com").toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run db:seed -- "Full Name" [email]');
  process.exit(1);
}
const PASSWORD = "Switchlink2026!";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: t });
const [taken] = await db.select({ id: t.users.id }).from(t.users).where(sql`lower(${t.users.email}) = ${email}`);
if (taken) {
  console.log(`${email} already exists. Nothing to do.`);
} else {
  await db.insert(t.users).values({
    name,
    email,
    passwordHash: await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    role: "ADMIN",
    mustChangePassword: true,
  });
  console.log(`Admin created: ${name} <${email}>, password ${PASSWORD}. You'll be asked to set your own password at first sign-in.`);
}
await client.end();
