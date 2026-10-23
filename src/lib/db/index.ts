import "server-only";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __crmSql: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __crmDb: PostgresJsDatabase<typeof schema> | undefined;
}

/**
 * The connection is opened on first use, not when this module is imported, so
 * `next build` (which imports pages but never queries) works without
 * DATABASE_URL, e.g. inside the Docker build stage.
 */
function connect(): PostgresJsDatabase<typeof schema> {
  if (globalThis.__crmDb) return globalThis.__crmDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  // One pool per process; reused across hot reloads in development.
  const client = globalThis.__crmSql ?? postgres(url, { max: 10, idle_timeout: 30 });
  globalThis.__crmSql = client;
  globalThis.__crmDb = drizzle(client, { schema });
  return globalThis.__crmDb;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    const real = connect();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export * as t from "./schema";
