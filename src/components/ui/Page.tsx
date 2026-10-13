import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="-ml-1 mb-1 inline-flex min-h-[36px] items-center gap-0.5 text-sm text-slate-500">
          <ChevronLeft size={18} />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight text-ink md:text-2xl">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Section({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="section-title">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, href, tone }: { label: string; value: React.ReactNode; href?: string; tone?: "warn" | "danger" | "good" }) {
  const toneClass = tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-green-700" : "text-ink";
  const body = (
    <div className="card h-full p-3.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block active:opacity-70">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A row in a tappable list: the mobile replacement for table rows. */
export function ListRow({ href, children }: { href?: string; children: React.ReactNode }) {
  const cls = "flex items-center gap-3 px-4 py-3";
  return href ? (
    <Link href={href} className={`${cls} active:bg-slate-50 md:hover:bg-slate-50`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}
