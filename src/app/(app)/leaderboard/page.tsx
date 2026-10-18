import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Empty, PageHeader, Stat } from "@/components/ui/Page";
import { BOARDS, PERIODS, leaderboard, parsePeriod, periodRange, type Board, type BoardRow, type BoardSort } from "@/lib/reports";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Leaderboard" };

const SORTS: { value: BoardSort; label: string }[] = [
  { value: "new", label: "New business" },
  { value: "existing", label: "Existing accounts" },
  { value: "total", label: "Total" },
  { value: "accounts", label: "Accounts closed" },
  { value: "conversion", label: "Conversion rate" },
];
const rateText = (r: { rate: number | null }) => (r.rate === null ? "—" : `${r.rate}%`);
const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ period?: string; board?: string; sort?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const boards = BOARDS.filter((b) => b.value !== "team" || me.role === "ADMIN");
  const board: Board = boards.some((b) => b.value === sp.board) ? (sp.board as Board) : "bdo";
  const sort: BoardSort = SORTS.some((s) => s.value === sp.sort) ? (sp.sort as BoardSort) : "new";
  const { start, end } = periodRange(period);
  const rows = await leaderboard(me, start, end, board, sort);
  const sum = (k: keyof BoardRow) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const added = sum("added");
  const converted = sum("converted");
  const overallRate = added > 0 ? Math.round((converted / added) * 1000) / 10 : null;
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ period, board, sort, ...patch });
    return `/leaderboard?${p}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leaderboard"
        subtitle={`${me.role === "ADMIN" ? "Everyone" : "Your team"} · ${formatDateTime(start, true)} to ${formatDateTime(new Date(end.getTime() - 60000), true)}`}
      />
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {PERIODS.map((p) => (
          <Link key={p.value} href={href({ period: p.value })} className={p.value === period ? "chip-on" : "chip-off"}>
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="New business" value={formatMoney(sum("newTotal"), { dash: false })} tone="good" />
        <Stat label="Accounts closed" value={sum("newAccounts")} />
        <Stat label="Existing accounts" value={formatMoney(sum("existingTotal"), { dash: false })} />
        <Stat label="Total disbursed" value={formatMoney(sum("total"), { dash: false })} />
      </div>
      <div className="card flex items-center justify-between gap-3 p-4 text-sm">
        <span>
          <span className="block font-medium text-ink">Conversion rate</span>
          <span className="text-xs text-slate-500">
            {converted} of {added} account{added === 1 ? "" : "s"} added in this period became Active
          </span>
        </span>
        <span className="text-2xl font-semibold tabular-nums text-brand-700">{rateText({ rate: overallRate })}</span>
      </div>
      <div className="card grid grid-cols-2 divide-x divide-slate-100 text-sm">
        <div className="p-3">
          <p className="text-xs font-medium text-slate-500">Organisations (schools & corporates)</p>
          <p className="mt-1">
            New <strong className="tabular-nums">{formatMoney(sum("newOrg"), { dash: false })}</strong>
          </p>
          <p className="text-slate-600">
            Existing <span className="tabular-nums">{formatMoney(sum("existingOrg"), { dash: false })}</span>
          </p>
        </div>
        <div className="p-3">
          <p className="text-xs font-medium text-slate-500">Merchants & individuals (QF)</p>
          <p className="mt-1">
            New <strong className="tabular-nums">{formatMoney(sum("newMerchant"), { dash: false })}</strong>
          </p>
          <p className="text-slate-600">
            Existing <span className="tabular-nums">{formatMoney(sum("existingMerchant"), { dash: false })}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
          {boards.map((b) => (
            <Link
              key={b.value}
              href={href({ board: b.value })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${b.value === board ? "bg-brand-600 text-white" : "text-slate-600"}`}
            >
              {b.label}
            </Link>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 flex flex-1 gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {SORTS.map((s) => (
            <Link key={s.value} href={href({ sort: s.value })} className={s.value === sort ? "chip-on !py-1 text-xs" : "chip-off !py-1 text-xs"}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>Nobody to rank yet.</Empty>
      ) : (
        <ol className="card divide-y divide-slate-100">
          {rows.map((r, i) => {
            const mine = r.id === me.id || (board === "team" && r.id === me.teamId);
            return (
              <li key={r.id} className={`px-4 py-3 ${mine ? "bg-brand-50" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className="w-7 shrink-0 text-center text-base font-semibold tabular-nums text-slate-500">{MEDALS[i] ?? i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">
                      {r.name}
                      {mine && <span className="ml-1 text-xs font-normal text-brand-700">(you)</span>}
                      {r.inactive && <span className="ml-1 text-xs font-normal text-slate-400">(inactive)</span>}
                    </span>
                    {r.sub && <span className="block truncate text-xs text-slate-500">{board === "team" ? `Leader: ${r.sub}` : r.sub}</span>}
                  </span>
                  {sort === "conversion" ? (
                    <span className="text-right">
                      <span className="block text-sm font-semibold tabular-nums text-brand-700">{rateText(r)}</span>
                      <span className="block text-[11px] text-slate-500">conversion</span>
                    </span>
                  ) : (
                    <span className="text-right">
                      <span className="block text-sm font-semibold tabular-nums text-green-700">{formatMoney(r.newTotal, { dash: false })}</span>
                      <span className="block text-[11px] text-slate-500">new business</span>
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 pl-10 text-xs text-slate-600 sm:grid-cols-4">
                  <div>
                    <dt className="inline text-slate-500">New orgs </dt>
                    <dd className="inline tabular-nums">{formatMoney(r.newOrg, { dash: false })}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-500">New merchants </dt>
                    <dd className="inline tabular-nums">{formatMoney(r.newMerchant, { dash: false })}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-500">Existing orgs </dt>
                    <dd className="inline tabular-nums">{formatMoney(r.existingOrg, { dash: false })}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-500">Existing merchants </dt>
                    <dd className="inline tabular-nums">{formatMoney(r.existingMerchant, { dash: false })}</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    {r.newAccounts} account{r.newAccounts === 1 ? "" : "s"} closed · total {formatMoney(r.total, { dash: false })} ·{" "}
                    <span className="font-medium text-brand-700">
                      conversion {rateText(r)}
                      {r.added > 0 ? ` (${r.converted}/${r.added})` : ""}
                    </span>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs text-slate-500">
        <strong>New business</strong> is money disbursed to accounts that got their first disbursement in this period (newly closed accounts).{" "}
        <strong>Existing accounts</strong> are those first disbursed before it. <strong>Conversion</strong> is the share of accounts added in this period that have become Active
        (individuals deleted for not being activated count as not converted). BDO figures include their agents; Team Leader figures are their own accounts.
      </p>
    </div>
  );
}
