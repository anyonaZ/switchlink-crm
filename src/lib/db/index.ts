import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __crmSql: ReturnType<typeof postgres> | undefined;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

// One pool per process; reused across hot reloads in development.
const client = globalThis.__crmSql ?? postgres(url, { max: 10, idle_timeout: 30 });
if (process.env.NODE_ENV !== "production") globalThis.__crmSql = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export * as t from "./schema";
