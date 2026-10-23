import { and, eq, inArray, ne } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { isSupervisor, userScope } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/Page";
import NewAccountForm from "./NewAccountForm";

export const metadata = { title: "New account" };

export default async function NewAccountPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const me = await requireUser();
  const { kind } = await searchParams;
  const agents =
    !isSupervisor(me)
      ? []
      : await db
          .select({ id: t.users.id, name: t.users.name, role: t.users.role })
          .from(t.users)
          .where(
            and(
              userScope(me),
              // Admins can give an account to anyone; others to BDOs and Agents below them.
              inArray(t.users.role, me.role === "ADMIN" ? ["AGENT", "BDO", "TEAM_LEADER", "ADMIN"] : ["BDO", "AGENT"]),
              eq(t.users.status, "ACTIVE"),
              ne(t.users.id, me.id)
            )
          )
          .orderBy(t.users.name);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New account" back={{ href: "/accounts", label: "Accounts" }} />
      <NewAccountForm userId={me.id} agents={agents} initialKind={kind} isAdmin={me.role === "ADMIN"} />
    </div>
  );
}
