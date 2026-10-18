import { requireUser } from "@/lib/auth/session";
import { BottomNav, Sidebar } from "@/components/Nav";
import { ROLE_LABELS } from "@/lib/labels";
import { signatureStatus } from "@/lib/signature-check";
import { AUTHOR } from "@/lib/signature";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The weekly-targets check runs in each page's requireUser(), not here: a
  // redirect from a shared layout loops on client-side navigation.
  const me = await requireUser({ skipTargets: true });
  const sig = signatureStatus();
  return (
    <div className="flex min-h-dvh">
      <Sidebar role={me.role} name={me.name} roleLabel={ROLE_LABELS[me.role]} />
      <main className="min-w-0 flex-1 pb-nav md:pb-10">
        {!sig.ok && (
          <div role="alert" className="bg-red-700 px-4 py-2 text-center text-xs font-medium text-white">
            This copy of Switchlink CRM has been altered: its authorship signature ({sig.problems.join(", ")}) doesn&apos;t match. Software by {AUTHOR}; contact them to restore a licensed copy.
          </div>
        )}
        <div className="mx-auto w-full max-w-5xl px-4 pt-4 md:px-8 md:pt-8">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
