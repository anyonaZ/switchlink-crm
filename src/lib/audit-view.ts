import "server-only";
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, t } from "@/lib/db";
import { nairobiToInstant } from "@/lib/format";

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = { action?: string; actor?: string; entity?: string; from?: string; to?: string; page?: number };

export function parseAuditFilters(sp: Record<string, string | undefined>): AuditFilters {
  const clean = (v?: string) => (v ?? "").trim().slice(0, 100) || undefined;
  const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return { action: clean(sp.action), actor: uuid(sp.actor), entity: clean(sp.entity), from: ymd(sp.from), to: ymd(sp.to), page: Math.max(1, Math.min(1000, Number(sp.page) || 1)) };
}

function where(f: AuditFilters): SQL | undefined {
  const parts: SQL[] = [];
  if (f.action) parts.push(ilike(t.auditLog.action, `${f.action.replace(/[%_\\]/g, "\\$&")}%`));
  if (f.actor) parts.push(eq(t.auditLog.actorId, f.actor));
  if (f.entity) parts.push(or(eq(t.auditLog.entityId, f.entity), eq(t.auditLog.entity, f.entity))!);
  const from = f.from ? nairobiToInstant(f.from, "00:00") : null;
  const to = f.to ? nairobiToInstant(f.to, "00:00") : null;
  if (from) parts.push(gte(t.auditLog.createdAt, from));
  if (to) parts.push(lt(t.auditLog.createdAt, new Date(to.getTime() + 86400000)));
  return parts.length ? and(...parts) : undefined;
}

const actor = alias(t.users, "actor");

/** Newest first. `limit` + 1 rows are read to know whether there's a next page. */
export async function auditPage(f: AuditFilters, limit = AUDIT_PAGE_SIZE) {
  const rows = await db
    .select({
      id: t.auditLog.id,
      at: t.auditLog.createdAt,
      action: t.auditLog.action,
      entity: t.auditLog.entity,
      entityId: t.auditLog.entityId,
      detail: t.auditLog.detail,
      actorId: t.auditLog.actorId,
      actorName: actor.name,
    })
    .from(t.auditLog)
    .leftJoin(actor, eq(actor.id, t.auditLog.actorId))
    .where(where(f))
    .orderBy(desc(t.auditLog.createdAt), desc(t.auditLog.id))
    .limit(limit + 1)
    .offset(((f.page ?? 1) - 1) * limit);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function auditActions() {
  const rows = await db.execute<{ action: string; n: number }>(sql`select action, count(*)::int as n from audit_log group by action order by action`);
  return rows.map((r) => ({ action: r.action, n: Number(r.n) }));
}
