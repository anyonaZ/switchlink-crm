import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink">Not found</h1>
      <p className="text-sm text-slate-500">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/dashboard" className="btn-primary">
        Go home
      </Link>
    </div>
  );
}
