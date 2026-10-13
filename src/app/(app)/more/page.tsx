import Link from "next/link";
import { ChevronRight, KeyRound, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { NAV } from "@/lib/nav";
import { logout } from "@/lib/actions/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { initials } from "@/lib/format";

export const metadata = { title: "More" };

export default async function MorePage() {
  const me = await requireUser();
  const items = NAV.filter((i) => !["/dashboard", "/accounts", "/follow-ups"].includes(i.href)).filter(
    (i) => !i.roles || i.roles.includes(me.role)
  );
  return (
    <div className="space-y-5">
      <div className="card flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">{initials(me.name)}</div>
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{me.name}</p>
          <p className="truncate text-sm text-slate-500">
            {ROLE_LABELS[me.role]} · {me.email}
          </p>
        </div>
      </div>
      <nav className="card divide-y divide-slate-100">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
            <i.icon size={20} className="text-slate-500" />
            <span className="flex-1 font-medium text-ink">{i.label}</span>
            <ChevronRight size={18} className="text-slate-400" />
          </Link>
        ))}
        <Link href="/change-password" className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
          <KeyRound size={20} className="text-slate-500" />
          <span className="flex-1 font-medium text-ink">Change password</span>
          <ChevronRight size={18} className="text-slate-400" />
        </Link>
      </nav>
      <form action={logout}>
        <button className="btn-danger w-full">
          <LogOut size={18} /> Sign out
        </button>
      </form>
    </div>
  );
}
