import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import ChangePasswordForm from "./form";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const me = await requireUser({ allowPasswordChange: true });
  return (
    <div className="flex min-h-dvh items-start justify-center bg-slate-50 px-4 py-10 md:items-center">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-ink">{me.mustChangePassword ? "Choose your own password" : "Change password"}</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">
          {me.mustChangePassword
            ? "You signed in with a temporary password. Set your own before you continue."
            : "At least 10 characters, with letters and numbers."}
        </p>
        <div className="card p-5">
          <ChangePasswordForm />
        </div>
        {!me.mustChangePassword && (
          <Link href="/dashboard" className="btn-ghost mt-3 w-full">
            Back
          </Link>
        )}
      </div>
    </div>
  );
}
