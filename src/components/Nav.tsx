"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  FileSpreadsheet,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Network,
  Plus,
  UserCog,
  KeyRound,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { NAV, type Role } from "@/lib/nav";
import Signature from "@/components/Signature";

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Sidebar({ role, name, roleLabel }: { role: Role; name: string; roleLabel: string }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="border-b border-slate-200 px-5 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/switchlink-logo.png" alt="Switchlink Africa" className="h-auto w-full max-w-[168px]" />
      </div>
      <Link href="/accounts/new" className="btn-primary mx-4 mt-4">
        <Plus size={18} /> New account
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV.filter((i) => !i.roles || i.roles.includes(role)).map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
              isActive(path, i.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
            }`}
          >
            <i.icon size={18} aria-hidden />
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        <p className="truncate text-xs text-slate-500">{roleLabel}</p>
        <div className="mt-2 flex gap-1">
          <Link href="/profile" className="btn-ghost btn-sm px-2 text-slate-500">
            <UserRound size={16} /> Profile
          </Link>
          <form action={logout}>
            <button className="btn-ghost btn-sm px-2 text-slate-500">
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
        <Signature className="mt-3 text-[11px] leading-tight text-slate-400" />
      </div>
    </aside>
  );
}

/** Phone navigation: five fixed slots, the middle one creates an account. */
export function BottomNav() {
  const path = usePathname();
  const slot = (href: string, label: string, Icon: LucideIcon, activeHrefs: string[] = [href]) => {
    const active = activeHrefs.some((h) => isActive(path, h)) && !(href === "/accounts" && path === "/accounts/new");
    return (
      <Link
        href={href}
        className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-700" : "text-slate-500"}`}
        aria-current={active ? "page" : undefined}
      >
        <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
        {label}
      </Link>
    );
  };
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom md:hidden" aria-label="Main">
      <div className="mx-auto flex h-16 max-w-md items-stretch">
        {slot("/dashboard", "Home", LayoutDashboard)}
        {slot("/accounts", "Accounts", Building2)}
        <div className="flex flex-1 items-center justify-center">
          <Link href="/accounts/new" aria-label="New account" className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white active:bg-brand-800">
            <Plus size={28} />
          </Link>
        </div>
        {slot("/follow-ups", "Follow-ups", CalendarCheck)}
        {slot("/more", "More", Menu, ["/more", "/pipeline", "/leaderboard", "/import", "/shares", "/statements", "/locations", "/reports", "/users", "/teams", "/profile", "/change-password"])}
      </div>
    </nav>
  );
}
