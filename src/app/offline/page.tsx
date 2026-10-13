export const metadata = { title: "Offline" };
export const dynamic = "force-static";

export default function Offline() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/switchlink-logo.png" alt="" className="w-40" />
      <h1 className="text-lg font-semibold text-ink">No connection</h1>
      <p className="max-w-xs text-sm text-slate-500">
        The CRM needs a signal to load. Anything you were typing on a new account is saved on this phone and will be there when you reopen the form.
      </p>
      <a href="/dashboard" className="btn-primary mt-2">
        Try again
      </a>
    </div>
  );
}
