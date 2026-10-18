import "server-only";
import { db, t, type Tx } from "@/lib/db";

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail?: Record<string, unknown>,
  tx?: Tx
) {
  await (tx ?? db).insert(t.auditLog).values({ actorId, action, entity, entityId, detail: detail ?? null });
}
