import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { ActionButton } from "@/components/Interactive";
import { approveShare, cancelShare, endShare, rejectShare } from "@/lib/actions/shares";
import type { ShareView } from "@/lib/shares";
import { formatDateTime } from "@/lib/format";

export const SHARE_STATUS_LABELS = {
  PENDING: "Waiting for approval",
  APPROVED: "Shared",
  REJECTED: "Turned down",
  CANCELLED: "Withdrawn",
  ENDED: "Ended",
} as const;
const STATUS_STYLES = {
  PENDING: "bg-amber-100 text-amber-900",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  ENDED: "bg-slate-100 text-slate-600",
} as const;

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;

/** One share: who's on it, the split, and where each approval stands. */
export default function ShareCard({
  share,
  meId,
  isAdmin,
  showAccount = false,
}: {
  share: ShareView;
  meId: string;
  isAdmin: boolean;
  showAccount?: boolean;
}) {
  const involved = share.requestedBy === meId || share.members.some((m) => m.userId === meId);
  return (
    <div className="card p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showAccount ? (
            <Link href={`/accounts/${share.accountId}`} className="block truncate font-semibold text-ink">
              {share.accountName}
            </Link>
          ) : (
            <p className="font-semibold text-ink">Shared between {share.members.length} BDOs</p>
          )}
          <p className="text-xs text-slate-500">
            Asked by {share.requestedByName ?? "—"} · {formatDateTime(share.createdAt, true)}
          </p>
        </div>
        <span className={`badge shrink-0 ${STATUS_STYLES[share.status]}`}>{SHARE_STATUS_LABELS[share.status]}</span>
      </div>

      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
        {share.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate">
              {m.name}
              {m.userId === meId && <span className="ml-1 text-xs text-slate-500">(you)</span>}
              {m.teamName && <span className="ml-1 text-xs text-slate-500">· {m.teamName}</span>}
            </span>
            <span className="font-semibold tabular-nums">{pct(m.percent)}</span>
          </li>
        ))}
      </ul>
      {share.note && <p className="mt-2 text-slate-600">“{share.note}”</p>}

      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Approvals</p>
      <ul className="mt-1 space-y-1.5">
        {share.approvals.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {a.decision === "APPROVED" ? (
              <CheckCircle2 size={16} className="text-green-600" aria-label="Approved" />
            ) : a.decision === "REJECTED" ? (
              <XCircle size={16} className="text-red-600" aria-label="Turned down" />
            ) : (
              <Clock size={16} className="text-amber-500" aria-label="Waiting" />
            )}
            <span className="text-ink">{a.role === "ADMIN" ? "Admin" : `Team Leader${a.teamName ? `, ${a.teamName}` : ""}`}</span>
            <span className="text-xs text-slate-500">
              {a.decision === "PENDING"
                ? "waiting"
                : `${a.decision === "APPROVED" ? "approved" : "turned down"} by ${a.decidedByName ?? "—"}${a.decidedAt ? `, ${formatDateTime(a.decidedAt)}` : ""}`}
              {a.reason ? ` · “${a.reason}”` : ""}
            </span>
            {a.mine && (
              <span className="flex w-full gap-2 pl-6 pt-1">
                <ActionButton run={approveShare.bind(null, a.id)} confirmText={`Approve sharing ${share.accountName}? Its disbursements will be split as shown.`} className="btn-primary btn-sm">
                  Approve
                </ActionButton>
                <ActionButton run={rejectShare.bind(null, a.id)} prompt="Why are you turning this down?" className="btn-ghost btn-sm text-red-600">
                  Turn down
                </ActionButton>
              </span>
            )}
          </li>
        ))}
      </ul>

      {share.status === "APPROVED" && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900">
          Every disbursement recorded on this corporate is split automatically by these percentages. Each BDO&apos;s part counts in their own figures and their team&apos;s.
        </p>
      )}
      {share.status === "ENDED" && share.endedAt && <p className="mt-2 text-xs text-slate-500">Ended {formatDateTime(share.endedAt, true)}. Earlier split disbursements are unchanged.</p>}

      {(share.status === "PENDING" && (involved || isAdmin)) || (share.status === "APPROVED" && isAdmin) ? (
        <div className="mt-3 flex gap-2">
          {share.status === "PENDING" && (involved || isAdmin) && (
            <ActionButton run={cancelShare.bind(null, share.id)} confirmText="Withdraw this sharing request?" className="btn-ghost btn-sm text-slate-600">
              Withdraw request
            </ActionButton>
          )}
          {share.status === "APPROVED" && isAdmin && (
            <ActionButton run={endShare.bind(null, share.id)} prompt="Why is this share ending? New disbursements will no longer be split." className="btn-ghost btn-sm text-red-600">
              End share
            </ActionButton>
          )}
        </div>
      ) : null}
    </div>
  );
}
