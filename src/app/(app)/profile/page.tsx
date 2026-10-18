import Link from "next/link";
import { KeyRound } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/Page";
import { ROLE_LABELS } from "@/lib/labels";
import NameForm from "./NameForm";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const me = await requireUser({ skipTargets: true });
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageHeader title="Profile" subtitle={`${ROLE_LABELS[me.role]} · ${me.email}`} />
      <div className="card p-4">
        <NameForm name={me.name} />
      </div>
      <p className="text-xs text-slate-500">Your email and role are set by an Admin.</p>
      <Link href="/change-password" className="btn-secondary w-full">
        <KeyRound size={18} /> Change password
      </Link>
    </div>
  );
}
