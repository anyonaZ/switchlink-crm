import { requireUser } from "@/lib/auth/session";
import { BottomNav, Sidebar } from "@/components/Nav";
import { ROLE_LABELS } from "@/lib/labels";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return (
    <div className="flex min-h-dvh">
      <Sidebar role={me.role} name={me.name} roleLabel={ROLE_LABELS[me.role]} />
      <main className="min-w-0 flex-1 pb-nav md:pb-10">
        <div className="mx-auto w-full max-w-5xl px-4 pt-4 md:px-8 md:pt-8">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
