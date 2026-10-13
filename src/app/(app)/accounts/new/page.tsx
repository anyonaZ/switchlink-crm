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
          .select({ id: t.users.id, name: t.users.name })
          .from(t.users)
          .where(and(userScope(me), inArray(t.users.role, ["BDO", "AGENT"]), eq(t.users.status, "ACTIVE"), ne(t.users.id, me.id)))
          .orderBy(t.users.name);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New account" back={{ href: "/accounts", label: "Accounts" }} />
      <NewAccountForm agents={agents} initialKind={kind} />
    </div>
  );
}
