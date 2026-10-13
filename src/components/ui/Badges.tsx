import { PRODUCT_SHORT, STAGE_LABELS, STAGE_STYLES, STATUS_LABELS, STATUS_STYLES, KIND_LABELS, type Stage } from "@/lib/labels";

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}
export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge ${STAGE_STYLES[stage]}`}>{STAGE_LABELS[stage]}</span>;
}
export function ProductBadge({ product }: { product: keyof typeof PRODUCT_SHORT }) {
  const style = product === "QUICK_FINANCE" ? "bg-emerald-100 text-emerald-800" : product === "SNPL" ? "bg-brand-100 text-brand-700" : "bg-accent-100 text-accent-700";
  return <span className={`badge ${style}`}>{PRODUCT_SHORT[product]}</span>;
}
export function KindBadge({ kind }: { kind: keyof typeof KIND_LABELS }) {
  return <span className="badge bg-slate-100 text-slate-700">{KIND_LABELS[kind]}</span>;
}
