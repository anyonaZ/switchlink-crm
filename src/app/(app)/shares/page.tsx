import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Empty, PageHeader, Section } from "@/components/ui/Page";
import ShareCard from "@/components/ShareCard";
import { sharesFor } from "@/lib/shares";

export const metadata = { title: "Shared corporates" };

export default async function SharesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const me = await requireRole(["BDO", "TEAM_LEADER", "ADMIN"]);
  const showAll = (await searchParams).all === "1";
  const shares = await sharesFor(me, undefined, showAll ? 300 : 100);
  const isAdmin = me.role === "ADMIN";
  const waiting = shares.filter((s) => s.status === "PENDING" && s.approvals.some((a) => a.mine));
  const pending = shares.filter((s) => s.status === "PENDING" && !waiting.includes(s));
  const active = shares.filter((s) => s.status === "APPROVED");
  const closed = shares.filter((s) => s.status !== "PENDING" && s.status !== "APPROVED");
  const list = (rows: typeof shares) => (
    <div className="space-y-2">
      {rows.map((s) => (
        <ShareCard key={s.id} share={s} meId={me.id} isAdmin={isAdmin} showAccount />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shared corporates"
        subtitle={
          me.role === "BDO"
            ? "Corporates you've closed with other BDOs. To start one, open the corporate and tap Share with other BDOs."
            : "BDOs who close a corporate together ask to split its disbursements. Each request needs the Team Leader of every team involved and an Admin."
        }
      />
      {me.role !== "BDO" && (
        <Section title={`Waiting for you (${waiting.length})`}>{waiting.length ? list(waiting) : <Empty>Nothing needs your approval.</Empty>}</Section>
      )}
      <Section title={`${me.role === "BDO" ? "Your requests waiting" : "Waiting for someone else"} (${pending.length})`}>
        {pending.length ? list(pending) : <Empty>No other requests waiting.</Empty>}
      </Section>
      <Section title={`Active (${active.length})`} subtitle="Disbursements on these corporates are split automatically.">
        {active.length ? list(active) : <Empty>No corporates are shared right now.</Empty>}
      </Section>
      {closed.length > 0 && (
        <Section title="Decided earlier">
          {list(showAll ? closed : closed.slice(0, 10))}
          {!showAll && closed.length > 10 && (
            <Link href="/shares?all=1" className="btn-secondary w-full">
              Show all
            </Link>
          )}
        </Section>
      )}
    </div>
  );
}
