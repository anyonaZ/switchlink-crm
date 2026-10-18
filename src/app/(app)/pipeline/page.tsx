import Link from "next/link";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { accountScope, isSupervisor } from "@/lib/permissions";
import { Empty, PageHeader } from "@/components/ui/Page";
import { KindBadge, ProductBadge } from "@/components/ui/Badges";
import { StageSelect } from "@/components/Interactive";
import { PRODUCT_LABELS, STAGES, STAGE_LABELS, type Stage } from "@/lib/labels";
import { formatMoney, formatShortDate } from "@/lib/format";

export const metadata = { title: "Pipeline" };
type Product = keyof typeof PRODUCT_LABELS;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ stage?: string; product?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const product = sp.product && sp.product in PRODUCT_LABELS ? (sp.product as Product) : undefined;
  const filters: SQL[] = [accountScope(me)];
  if (product) filters.push(eq(t.opportunities.product, product));

  const counts = await db
    .select({ stage: t.opportunities.stage, n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${t.opportunities.estimatedValue}), 0)` })
    .from(t.opportunities)
    .innerJoin(t.accounts, eq(t.accounts.id, t.opportunities.accountId))
    .where(and(...filters))
    .groupBy(t.opportunities.stage);
  const countBy = new Map(counts.map((c) => [c.stage, c]));
  // Default to the earliest stage that has something in it.
  const stage: Stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : STAGES.find((s) => (countBy.get(s)?.n ?? 0) > 0) ?? "NEW";

  const rows = await db
    .select({ o: t.opportunities, accountName: t.accounts.name, kind: t.accounts.kind, owner: t.users.name })
    .from(t.opportunities)
    .innerJoin(t.accounts, eq(t.accounts.id, t.opportunities.accountId))
    .leftJoin(t.users, eq(t.users.id, t.opportunities.ownerId))
    .where(and(...filters, eq(t.opportunities.stage, stage)))
    .orderBy(desc(t.opportunities.createdAt))
    .limit(200);

  const href = (patch: { stage?: string; product?: string | null }) => {
    const p = new URLSearchParams();
    const s = patch.stage ?? stage;
    const pr = patch.product === null ? undefined : patch.product ?? product;
    if (s) p.set("stage", s);
    if (pr) p.set("product", pr);
    return `/pipeline?${p.toString()}`;
  };
  const total = counts.reduce((s, c) => s + c.n, 0);

  return (
    <div>
      <PageHeader title="Pipeline" subtitle={`${total} opportunities${product ? ` · ${PRODUCT_LABELS[product]}` : ""}`} />
      <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link href={href({ product: null })} className={!product ? "chip-on" : "chip-off"}>
          All products
        </Link>
        {(Object.keys(PRODUCT_LABELS) as Product[]).map((p) => (
          <Link key={p} href={href({ product: p })} className={product === p ? "chip-on" : "chip-off"}>
            {PRODUCT_LABELS[p]}
          </Link>
        ))}
      </div>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {STAGES.map((s) => (
          <Link key={s} href={href({ stage: s })} className={s === stage ? "chip-on" : "chip-off"} scroll={false}>
            {STAGE_LABELS[s]}
            <span className={`ml-1.5 rounded-full px-1.5 text-xs ${s === stage ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{countBy.get(s)?.n ?? 0}</span>
          </Link>
        ))}
      </div>
      <p className="mb-2 text-sm text-slate-500">
        {STAGE_LABELS[stage]}: {countBy.get(stage)?.n ?? 0} · est. {formatMoney(countBy.get(stage)?.value ?? 0, { dash: false })}
      </p>
      {rows.length === 0 ? (
        <Empty>Nothing at this stage.</Empty>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {rows.map(({ o, accountName, kind, owner }) => (
            <li key={o.id} className="card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/accounts/${o.accountId}?tab=pipeline`} className="min-w-0 font-medium text-ink">
                  <span className="block truncate">{accountName}</span>
                </Link>
                <ProductBadge product={o.product} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <KindBadge kind={kind} />
                {isSupervisor(me) && <span>{owner ?? "Unassigned"}</span>}
                {o.estimatedValue && <span>· {formatMoney(o.estimatedValue)}</span>}
              </p>
              {o.nextAction && (
                <p className="mt-2 text-sm text-slate-700">
                  {o.nextAction}
                  {o.nextActionDate && <span className="text-slate-500"> · {formatShortDate(o.nextActionDate)}</span>}
                </p>
              )}
              <div className="mt-2">
                <StageSelect opportunityId={o.id} stage={o.stage} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
