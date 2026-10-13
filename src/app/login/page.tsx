import { redirect } from "next/navigation";
import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { login } from "@/lib/actions/auth";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await getSessionUser()) redirect("/dashboard");
  const { expired } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-brand-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 w-[210px] rounded-xl bg-white p-3 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/switchlink-logo.png" alt="Switchlink Africa" className="w-full" />
          </div>
          <h1 className="text-xl font-semibold text-white">Switchlink CRM</h1>
          <p className="mt-1 text-sm text-brand-100">Sign in with your work email</p>
        </div>
        <div className="card p-5">
          {expired && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">You were signed out after 60 minutes without activity.</p>
          )}
          <ActionForm action={login} resetOnSuccess={false} closeOnSuccess={false}>
            <Field label="Email" name="email">
              <input id="email" name="email" type="email" inputMode="email" autoComplete="username" required className="input" />
            </Field>
            <Field label="Password" name="password">
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
            </Field>
            <Submit pendingText="Signing in…">Sign in</Submit>
          </ActionForm>
        </div>
        <p className="mt-6 text-center text-xs text-brand-200">Forgot your password? Ask your Team Leader or Admin to reset it.</p>
      </div>
    </div>
  );
}
