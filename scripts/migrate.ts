/** Applies every pending migration in ./drizzle. Safe to run on every deploy. */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "./env";

loadEnv();
const client = postgres(process.env.DATABASE_URL!, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();
console.log("Migrations applied.");
