import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { accountScope } from "@/lib/permissions";
import { Empty, PageHeader } from "@/components/ui/Page";
import { KindBadge } from "@/components/ui/Badges";
import { KIND_LABELS } from "@/lib/labels";
import { shortAddress } from "@/lib/geo/geocode";
import { formatDate } from "@/lib/format";
import MapView from "./MapView";

export const metadata = { title: "Locations" };
type Kind = keyof typeof KIND_LABELS;

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ kind?: string; agent?: string }> }) {
  const me = await requireRole(["TEAM_LEADER", "ADMIN"]);
  const sp = await searchParams;
  const kinds: Kind[] = sp.kind && sp.kind in KIND_LABELS ? [sp.kind as Kind] : ["CORPORATE", "SCHOOL", "MERCHANT", "INDIVIDUAL"];
  // Latest capture per account.
  const rows = await db
    .selectDistinctOn([t.locationCaptures.accountId], {
      accountId: t.accounts.id,
      name: t.accounts.name,
      kind: t.accounts.kind,
      owner: t.users.name,
      lat: t.locationCaptures.latitude,
      lng: t.locationCaptures.longitude,
      road: t.locationCaptures.road,
      landmark: t.locationCaptures.landmark,
      area: t.locationCaptures.area,
      town: t.locationCaptures.town,
      county: t.locationCaptures.county,
      capturedAt: t.locationCaptures.capturedAt,
    })
    .from(t.locationCaptures)
    .innerJoin(t.accounts, eq(t.accounts.id, t.locationCaptures.accountId))
    .leftJoin(t.users, eq(t.users.id, t.accounts.ownerId))
    .where(and(accountScope(me), inArray(t.accounts.kind, kinds), sp.agent ? eq(t.accounts.ownerId, sp.agent) : sql`true`))
    .orderBy(t.locationCaptures.accountId, desc(t.locationCaptures.capturedAt))
    .limit(1000);

  const points = rows.map((r) => ({ id: r.accountId, name: r.name, kind: r.kind, lat: r.lat, lng: r.lng, address: shortAddress(r) ?? "", owner: r.owner ?? "" }));
  const byCounty = new Map<string, number>();
  for (const r of rows) byCounty.set(r.county ?? "Unknown county", (byCounty.get(r.county ?? "Unknown county") ?? 0) + 1);

  return (
    <div className="space-y-4">
      <PageHeader title="Locations" subtitle={`${rows.length} accounts with a captured location`} />
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link href="/locations" className={!sp.kind ? "chip-on" : "chip-off"}>
          All
        </Link>
        {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
          <Link key={k} href={`/locations?kind=${k}`} className={sp.kind === k ? "chip-on" : "chip-off"}>
            {KIND_LABELS[k]}s
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>No locations captured yet.</Empty>
      ) : (
        <>
          <MapView points={points} />
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            {[...byCounty.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([c, n]) => (
                <span key={c} className="badge bg-white ring-1 ring-slate-200">
                  {c}: {n}
                </span>
              ))}
          </div>
          <ul className="card divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.accountId}>
                <Link href={`/accounts/${r.accountId}?tab=location`} className="block px-4 py-3 active:bg-slate-50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{r.name}</span>
                    <KindBadge kind={r.kind} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {shortAddress(r) ?? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`} · {r.owner ?? "Unassigned"} · {formatDate(r.capturedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
