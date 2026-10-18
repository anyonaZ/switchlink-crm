import { pct, type TargetValues } from "@/lib/targets";
import { formatMoney } from "@/lib/format";

const ROWS: { key: keyof TargetValues; label: string; money?: boolean }[] = [
  { key: "individuals", label: "Individuals" },
  { key: "merchants", label: "Merchants" },
  { key: "corporates", label: "Corporates" },
  { key: "disbursement", label: "Disbursed", money: true },
];

/** Target vs achieved for the week, one bar per measure. */
export default function TargetProgress({ target, actual, compact = false }: { target: TargetValues | null; actual: TargetValues; compact?: boolean }) {
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2.5"}>
      {ROWS.map((r) => {
        const t = target?.[r.key] ?? 0;
        const a = actual[r.key];
        const p = pct(a, t);
        const fmt = (v: number) => (r.money ? formatMoney(v, { dash: false }) : String(v));
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={compact ? "text-xs text-slate-600" : "text-slate-700"}>{r.label}</span>
              <span className={`tabular-nums ${compact ? "text-xs" : ""}`}>
                <span className="font-semibold text-ink">{fmt(a)}</span>
                <span className="text-slate-500"> / {target ? fmt(t) : "—"}</span>
                {p !== null && " "}
                {p !== null && <span className={`ml-1 text-xs font-medium ${p >= 100 ? "text-green-700" : p >= 50 ? "text-amber-700" : "text-red-600"}`}>{p}%</span>}
              </span>
            </div>
            <div className={`mt-1 overflow-hidden rounded-full bg-slate-100 ${compact ? "h-1.5" : "h-2"}`} role="progressbar" aria-label={r.label} aria-valuenow={p ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full rounded-full ${p === null ? "bg-slate-200" : p >= 100 ? "bg-green-600" : p >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, p ?? 0)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
