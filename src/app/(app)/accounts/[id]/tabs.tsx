import { CalendarClock, FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { Account, LocationCapture, StatementUpload } from "@/lib/db/schema";
import Sheet from "@/components/ui/Sheet";
import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { Empty, Section } from "@/components/ui/Page";
import { ProductBadge, StageBadge, StatusBadge } from "@/components/ui/Badges";
import { ActionButton, QuickDates, StageSelect } from "@/components/Interactive";
import { changeAccountStatus, declineVerification, reassignAccount, updateAccount, verifyAccount } from "@/lib/actions/accounts";
import { addComment, addContact, cancelFollowUp, completeFollowUp, createOpportunity, deleteContact, logActivity, scheduleFollowUp, updateOpportunity } from "@/lib/actions/crm";
import { recordDisbursement, reverseDisbursement, setQfLimit, uploadKycDocument } from "@/lib/actions/money";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, PRODUCTS_FOR_KIND, PRODUCT_LABELS, ROLE_LABELS, STAGE_LABELS, STATUS_LABELS, type Stage } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatShortDate, todayYmd } from "@/lib/format";
import { shortAddress } from "@/lib/geo/geocode";
import ShareCard from "@/components/ShareCard";
import ShareRequestForm from "@/components/ShareRequestForm";
import { requestShare } from "@/lib/actions/shares";
import type { ShareView } from "@/lib/shares";

type Product = keyof typeof PRODUCT_LABELS;
type Status = keyof typeof STATUS_LABELS;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-ink">{children ?? "—"}</dd>
    </div>
  );
}

// --- Overview ---------------------------------------------------------------
/** Short names for the status tracker, so four steps fit on a phone. */
const STEP_LABELS: Record<Status, string> = {
  ONGOING_ENGAGEMENT: "Engagement",
  DOCUMENT_COLLECTION: "Documents",
  PENDING_VERIFICATION: "Verification",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};
export function OverviewTab({
  acc,
  ownerName,
  editable,
  merchant,
  individual,
  canVerify,
  history,
  statusOptions,
  reassignTo,
  sharing,
}: {
  acc: Account;
  ownerName: string | null;
  editable: boolean;
  merchant: { businessType: string | null; registrationNo: string | null; kraPin: string | null; ownerName: string | null } | null;
  individual: { dateOfBirth: string | null } | null;
  canVerify: boolean;
  history: { id: string; from: Status | null; to: Status; at: Date; note: string | null; by: string | null }[];
  statusOptions: Status[];
  reassignTo: { id: string; name: string; role: keyof typeof ROLE_LABELS }[];
  sharing: SharingInfo | null;
}) {
  const verified = acc.kind === "MERCHANT" || acc.kind === "INDIVIDUAL";
  const flow = (
    acc.kind === "MERCHANT"
      ? ["ONGOING_ENGAGEMENT", "DOCUMENT_COLLECTION", "PENDING_VERIFICATION", "ACTIVE"]
      : verified
        ? ["ONGOING_ENGAGEMENT", "PENDING_VERIFICATION", "ACTIVE"]
        : ["ONGOING_ENGAGEMENT", "ACTIVE"]
  ) as Status[];
  const pending = acc.status === "PENDING_VERIFICATION";
  const step = flow.indexOf(acc.status);
  return (
    <div className="space-y-5">
      <Section title="Status">
        <div className="card p-4">
          <ol className="flex items-start gap-1.5">
            {flow.map((s, i) => (
              <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    acc.status === "INACTIVE" ? "bg-slate-200 text-slate-500" : i <= step ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`text-[11px] leading-tight ${i === step ? "font-semibold text-ink" : "text-slate-500"}`}>{STEP_LABELS[s]}</span>
              </li>
            ))}
          </ol>
          {acc.kind === "MERCHANT" && !acc.pesiAccountNo && acc.status === "ONGOING_ENGAGEMENT" && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Add the 4-digit Pesi account number once the merchant signs up, to move to Document collection.</p>
          )}
          {pending && (
            <div className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
              <p className="font-medium">Waiting for an Admin to verify this account.</p>
              {acc.verificationRequestedAt && <p className="text-xs">Sent {formatDateTime(acc.verificationRequestedAt, true)}</p>}
              {canVerify && (
                <div className="mt-2 flex gap-2">
                  <ActionButton run={verifyAccount.bind(null, acc.id)} confirmText={`Verify ${acc.name} and make it active?`} className="btn-primary btn-sm">
                    Verify
                  </ActionButton>
                  <ActionButton run={declineVerification.bind(null, acc.id)} prompt="What needs fixing before it can be verified?" className="btn-ghost btn-sm text-red-600">
                    Decline
                  </ActionButton>
                </div>
              )}
            </div>
          )}
          {/* Stays mounted while pending (button hidden) so the form can still confirm the change. */}
          {editable && statusOptions.length > 0 && (
            <div className={pending ? "hidden" : "mt-3"}>
              <Sheet title="Change status" trigger="Change status" triggerClassName="btn-secondary w-full">
                <ActionForm action={changeAccountStatus.bind(null, acc.id)}>
                  <Field
                  label="New status"
                  name="status"
                  hint={verified && !canVerify ? "Choosing Active sends the account to an Admin to verify first." : undefined}
                >
                    <select id="status" name="status" className="input" defaultValue={statusOptions[0]}>
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Note (optional)" name="note">
                    <input id="note" name="note" className="input" placeholder="e.g. Documents received" />
                  </Field>
                  <Submit>Update status</Submit>
                </ActionForm>
              </Sheet>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Details"
        action={
          editable ? (
            <Sheet title="Edit details" trigger={<><Pencil size={16} /> Edit</>} triggerClassName="btn-ghost btn-sm">
              <ActionForm action={updateAccount.bind(null, acc.id)} resetOnSuccess={false}>
                <Field label={acc.kind === "INDIVIDUAL" ? "Full name" : "Name"} name="name">
                  <input id="name" name="name" defaultValue={acc.name} required className="input" />
                </Field>
                <Field label="Phone" name="phone">
                  <input id="phone" name="phone" type="tel" defaultValue={acc.phone ?? ""} required={acc.kind === "INDIVIDUAL"} className="input" />
                </Field>
                <Field label="Email" name="email">
                  <input id="email" name="email" type="email" defaultValue={acc.email ?? ""} className="input" />
                </Field>
                {(acc.kind === "SCHOOL" || acc.kind === "CORPORATE") && (
                  <Field label="Industry" name="industry">
                    <input id="industry" name="industry" defaultValue={acc.industry ?? ""} className="input" />
                  </Field>
                )}
                {acc.kind === "MERCHANT" && (
                  <>
                    <Field label="Type of business" name="business_type">
                      <input id="business_type" name="business_type" defaultValue={merchant?.businessType ?? ""} className="input" />
                    </Field>
                    <Field label="Owner's name" name="owner_name">
                      <input id="owner_name" name="owner_name" defaultValue={merchant?.ownerName ?? ""} className="input" />
                    </Field>
                    <Field label="KRA PIN" name="kra_pin">
                      <input id="kra_pin" name="kra_pin" defaultValue={merchant?.kraPin ?? ""} className="input uppercase" />
                    </Field>
                    <Field label="Registration no." name="registration_no">
                      <input id="registration_no" name="registration_no" defaultValue={merchant?.registrationNo ?? ""} className="input" />
                    </Field>
                  </>
                )}
                {acc.kind === "INDIVIDUAL" && (
                  <>
                    <Field label="Date of birth" name="date_of_birth">
                      <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={individual?.dateOfBirth ?? ""} className="input" />
                    </Field>
                  </>
                )}
                {(acc.kind === "MERCHANT" || acc.kind === "INDIVIDUAL") && (
                  <>
                    <Field label="Pesi account number" name="pesi_account_no" hint="4 digits">
                      <input id="pesi_account_no" name="pesi_account_no" inputMode="numeric" maxLength={4} defaultValue={acc.pesiAccountNo ?? ""} className="input" />
                    </Field>
                    <Field label="Statement account number" name="statement_account_no" hint="As printed on Pesi statements, e.g. MCA00010880001. Filled in automatically by the first upload.">
                      <input id="statement_account_no" name="statement_account_no" defaultValue={acc.statementAccountNo ?? ""} className="input uppercase" />
                    </Field>
                  </>
                )}
                <Field label="Where is it?" name="location_text">
                  <input id="location_text" name="location_text" defaultValue={acc.locationText ?? ""} className="input" />
                </Field>
                <Submit>Save</Submit>
              </ActionForm>
            </Sheet>
          ) : null
        }
      >
        <dl className="card divide-y divide-slate-100">
          <Row label="Phone">{acc.phone}</Row>
          <Row label="Email">{acc.email}</Row>
          {acc.industry && <Row label="Industry">{acc.industry}</Row>}
          {merchant && (
            <>
              <Row label="Business type">{merchant.businessType}</Row>
              <Row label="Owner">{merchant.ownerName}</Row>
              <Row label="KRA PIN">{merchant.kraPin}</Row>
              <Row label="Registration no.">{merchant.registrationNo}</Row>
            </>
          )}
          {individual && (
            <>
              <Row label="Date of birth">{individual.dateOfBirth ? formatDate(individual.dateOfBirth) : null}</Row>
            </>
          )}
          {(acc.kind === "MERCHANT" || acc.kind === "INDIVIDUAL") && (
            <>
              <Row label="Pesi account no.">{acc.pesiAccountNo}</Row>
              <Row label="Statement account no.">{acc.statementAccountNo}</Row>
            </>
          )}
          <Row label="Where">{acc.locationText}</Row>
          <Row label="Agent">{ownerName ?? "Unassigned"}</Row>
          <Row label="Registered">{formatDate(acc.createdAt)}</Row>
          {verified && acc.verifiedAt && <Row label="Verified">{formatDate(acc.verifiedAt)}</Row>}
        </dl>
      </Section>

      {reassignTo.length > 0 && (
        <Sheet title="Reassign account" trigger="Reassign to another agent" triggerClassName="btn-secondary w-full">
          <ActionForm action={reassignAccount.bind(null, acc.id)}>
            <Field label="New agent" name="owner_id" hint="Open pipeline items move with the account. Past disbursements stay credited to whoever earned them, and to their BDO at the time.">
              <select id="owner_id" name="owner_id" defaultValue={acc.ownerId ?? ""} className="input">
                <option value="">Unassigned</option>
                {reassignTo.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({ROLE_LABELS[u.role]})
                  </option>
                ))}
              </select>
            </Field>
            <Submit>Reassign</Submit>
          </ActionForm>
        </Sheet>
      )}

      {sharing && <SharingSection info={sharing} accountId={acc.id} />}

      <Section title="Status history">
        {history.length === 0 ? (
          <Empty>No changes yet.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  {h.from && (
                    <>
                      <StatusBadge status={h.from} /> →
                    </>
                  )}
                  <StatusBadge status={h.to} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(h.at, true)} · {h.by ?? "System"}
                  {h.note ? ` · ${h.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// --- Corporate sharing ------------------------------------------------------
export interface SharingInfo {
  me: { id: string; name: string; isAdmin: boolean };
  shares: ShareView[];
  /** BDOs this person can ask to share with (null if they can't ask at all). */
  requestTo: { id: string; name: string; teamName: string | null }[] | null;
  /** False while a request is open or the corporate is already shared. */
  canRequestNow: boolean;
}
function SharingSection({ info, accountId }: { info: SharingInfo; accountId: string }) {
  const open = info.shares.filter((s) => s.status === "PENDING" || s.status === "APPROVED");
  const past = info.shares.filter((s) => s.status !== "PENDING" && s.status !== "APPROVED").slice(0, 3);
  if (!open.length && !past.length && !info.requestTo) return null;
  return (
    <Section title="Shared corporate" subtitle="BDOs who closed this corporate together split its disbursements.">
      {open.map((s) => (
        <ShareCard key={s.id} share={s} meId={info.me.id} isAdmin={info.me.isAdmin} />
      ))}
      {!open.length && !info.requestTo && <Empty>This corporate isn&apos;t shared.</Empty>}
      {/* Stays mounted after sending (button hidden) so the form can still show its result. */}
      {info.requestTo && (
        <Sheet title="Share this corporate" trigger="Share with other BDOs" triggerClassName={info.canRequestNow ? "btn-secondary w-full" : "hidden"}>
          <ShareRequestForm action={requestShare.bind(null, accountId)} me={info.me} bdos={info.requestTo} />
        </Sheet>
      )}
      {past.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Earlier requests ({past.length})</summary>
          <div className="mt-2 space-y-2">
            {past.map((s) => (
              <ShareCard key={s.id} share={s} meId={info.me.id} isAdmin={info.me.isAdmin} />
            ))}
          </div>
        </details>
      )}
    </Section>
  );
}

// --- Pipeline ---------------------------------------------------------------
type Opp = {
  id: string;
  product: Product;
  stage: Stage;
  estimatedValue: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  notes: string | null;
  applicationsCount: number;
  approvedCount: number;
};
export function PipelineTab({
  acc,
  opps,
  history,
  editable,
}: {
  acc: Account;
  opps: Opp[];
  history: { oppId: string; from: Stage | null; to: Stage; at: Date; by: string | null }[];
  editable: boolean;
}) {
  const available = (PRODUCTS_FOR_KIND[acc.kind] as readonly Product[]).filter((p) => !opps.some((o) => o.product === p));
  return (
    <div className="space-y-3">
      {opps.length === 0 && <Empty>Nothing in the pipeline yet.</Empty>}
      {opps.map((o) => {
        const hist = history.filter((h) => h.oppId === o.id);
        return (
          <div key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ProductBadge product={o.product} />
              {editable ? <StageSelect opportunityId={o.id} stage={o.stage} /> : <StageBadge stage={o.stage} />}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Estimated value</dt>
                <dd>{formatMoney(o.estimatedValue)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Next action due</dt>
                <dd>{o.nextActionDate ? formatShortDate(o.nextActionDate) : "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">Next action</dt>
                <dd>{o.nextAction ?? "—"}</dd>
              </div>
              {o.product !== "QUICK_FINANCE" && (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Applications</dt>
                  <dd>
                    {o.applicationsCount} received · {o.approvedCount} approved
                  </dd>
                </div>
              )}
            </dl>
            {o.notes && <p className="mt-2 text-sm text-slate-600">{o.notes}</p>}
            <div className="mt-3 flex gap-2">
              {editable && (
                <Sheet title={`${PRODUCT_LABELS[o.product]}: details`} trigger={<><Pencil size={16} /> Edit</>} triggerClassName="btn-secondary btn-sm">
                  <ActionForm action={updateOpportunity.bind(null, o.id)} resetOnSuccess={false}>
                    <Field label="Estimated value (KES)" name="estimated_value">
                      <input id="estimated_value" name="estimated_value" inputMode="decimal" defaultValue={o.estimatedValue ?? ""} className="input" />
                    </Field>
                    <Field label="Next action" name="next_action">
                      <input id="next_action" name="next_action" defaultValue={o.nextAction ?? ""} className="input" />
                    </Field>
                    <Field label="Next action date" name="next_action_date">
                      <input id={`nad-${o.id}`} name="next_action_date" type="date" defaultValue={o.nextActionDate ?? ""} className="input" />
                      <QuickDates targetId={`nad-${o.id}`} />
                    </Field>
                    {o.product !== "QUICK_FINANCE" && (
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Applications" name="applications_count">
                          <input id="applications_count" name="applications_count" inputMode="numeric" defaultValue={o.applicationsCount} className="input" />
                        </Field>
                        <Field label="Approved" name="approved_count">
                          <input id="approved_count" name="approved_count" inputMode="numeric" defaultValue={o.approvedCount} className="input" />
                        </Field>
                      </div>
                    )}
                    <Field label="Notes" name="notes">
                      <textarea id="notes" name="notes" rows={3} defaultValue={o.notes ?? ""} className="input" />
                    </Field>
                    <Submit>Save</Submit>
                  </ActionForm>
                </Sheet>
              )}
            </div>
            {hist.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-500">Stage history ({hist.length})</summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {hist.map((h, i) => (
                    <li key={i}>
                      {h.from ? `${STAGE_LABELS[h.from]} → ` : "Started at "}
                      {STAGE_LABELS[h.to]} · {h.by ?? "System"} · {formatDateTime(h.at, true)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
      {editable && available.length > 0 && (
        <Sheet title="Add to pipeline" trigger={<><Plus size={18} /> Add product</>} triggerClassName="btn-secondary w-full">
          <ActionForm action={createOpportunity.bind(null, acc.id)}>
            <Field label="Product" name="product">
              <select id="product" name="product" className="input">
                {available.map((p) => (
                  <option key={p} value={p}>
                    {PRODUCT_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estimated value (KES)" name="estimated_value">
              <input id="estimated_value" name="estimated_value" inputMode="decimal" className="input" />
            </Field>
            <Field label="Next action" name="next_action">
              <input id="next_action" name="next_action" placeholder="e.g. Book intro meeting" className="input" />
            </Field>
            <Field label="Next action date" name="next_action_date">
              <input id="new-nad" name="next_action_date" type="date" className="input" />
              <QuickDates targetId="new-nad" />
            </Field>
            <Submit>Add</Submit>
          </ActionForm>
        </Sheet>
      )}
    </div>
  );
}

// --- Activity -----------------------------------------------------------------
type ActRow = {
  a: {
    id: string;
    type: keyof typeof ACTIVITY_LABELS;
    description: string | null;
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
    scheduledAt: Date | null;
    completedAt: Date | null;
    nextAction: string | null;
    createdAt: Date;
  };
  by: string | null;
};
function TypeAndProduct({ opps }: { opps: { id: string; product: Product }[] }) {
  return (
    <>
      <Field label="Type" name="type">
        <select id="type" name="type" className="input" defaultValue="CALL">
          {ACTIVITY_TYPES.map((x) => (
            <option key={x} value={x}>
              {ACTIVITY_LABELS[x]}
            </option>
          ))}
        </select>
      </Field>
      {opps.length > 0 && (
        <Field label="About" name="opportunity_id">
          <select id="opportunity_id" name="opportunity_id" className="input" defaultValue="">
            <option value="">General</option>
            {opps.map((o) => (
              <option key={o.id} value={o.id}>
                {PRODUCT_LABELS[o.product]}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
export function ActivityTab({ accountId, rows, opps, editable }: { accountId: string; rows: ActRow[]; opps: { id: string; product: Product }[]; editable: boolean }) {
  const now = Date.now();
  const open = rows.filter((r) => r.a.status === "SCHEDULED").sort((x, y) => (x.a.scheduledAt?.getTime() ?? 0) - (y.a.scheduledAt?.getTime() ?? 0));
  const done = rows.filter((r) => r.a.status !== "SCHEDULED");
  return (
    <div className="space-y-5">
      {editable && (
        <div className="grid grid-cols-2 gap-2">
          <Sheet title="Log what happened" trigger={<><Plus size={18} /> Log activity</>} triggerClassName="btn-primary">
            <ActionForm action={logActivity.bind(null, accountId)}>
              <TypeAndProduct opps={opps} />
              <Field label="What happened?" name="description">
                <textarea id="description" name="description" rows={3} required className="input" />
              </Field>
              <Field label="Next action (optional)" name="next_action">
                <input id="next_action" name="next_action" className="input" />
              </Field>
              <Submit>Save</Submit>
            </ActionForm>
          </Sheet>
          <Sheet title="Schedule a follow-up" trigger={<><CalendarClock size={18} /> Follow-up</>} triggerClassName="btn-secondary">
            <ActionForm action={scheduleFollowUp.bind(null, accountId)}>
              <TypeAndProduct opps={opps} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" name="date">
                  <input id="fu-date" name="date" type="date" required defaultValue={todayYmd(1)} className="input" />
                </Field>
                <Field label="Time" name="time">
                  <input id="time" name="time" type="time" defaultValue="09:00" className="input" />
                </Field>
              </div>
              <QuickDates targetId="fu-date" />
              <Field label="What needs doing? (optional)" name="description">
                <textarea id="description" name="description" rows={2} className="input" />
              </Field>
              <Submit>Schedule</Submit>
            </ActionForm>
          </Sheet>
        </div>
      )}

      <Section title={`Open follow-ups (${open.length})`}>
        {open.length === 0 ? (
          <Empty>Nothing scheduled.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {open.map(({ a, by }) => {
              const overdue = a.scheduledAt && a.scheduledAt.getTime() < now;
              return (
                <li key={a.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {ACTIVITY_LABELS[a.type]}
                        {a.description ? ` — ${a.description}` : ""}
                      </p>
                      <p className={`text-xs ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
                        {overdue ? "Overdue · " : "Due "}
                        {formatDateTime(a.scheduledAt)} · {by ?? "—"}
                      </p>
                    </div>
                  </div>
                  {editable && (
                    <div className="flex gap-2">
                      <Sheet title="Mark follow-up done" trigger="Done" triggerClassName="btn-primary btn-sm flex-1">
                        <ActionForm action={completeFollowUp.bind(null, a.id)}>
                          <Field label="How did it go?" name="outcome">
                            <textarea id="outcome" name="outcome" rows={3} required className="input" />
                          </Field>
                          <Field label="Next action (optional)" name="next_action">
                            <input id="next_action" name="next_action" className="input" />
                          </Field>
                          <Submit>Mark done</Submit>
                        </ActionForm>
                      </Sheet>
                      <ActionButton run={cancelFollowUp.bind(null, a.id)} confirmText="Cancel this follow-up?" className="btn-ghost btn-sm text-red-600">
                        Cancel
                      </ActionButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="History">
        {done.length === 0 ? (
          <Empty>No activity logged yet.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {done.map(({ a, by }) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <p className={a.status === "CANCELLED" ? "text-slate-400 line-through" : "text-ink"}>
                  <span className="font-medium">{ACTIVITY_LABELS[a.type]}</span>
                  {a.description ? ` — ${a.description}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatDateTime(a.completedAt ?? a.createdAt)} · {by ?? "—"}
                  {a.status === "CANCELLED" ? " · cancelled" : ""}
                </p>
                {a.nextAction && <p className="mt-1 text-xs text-slate-600">Next: {a.nextAction}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// --- Contacts and notes ------------------------------------------------------
export function ContactsTab({
  accountId,
  rows,
  editable,
}: {
  accountId: string;
  rows: { id: string; name: string; jobTitle: string | null; phone: string | null; email: string | null; isDecisionMaker: boolean }[];
  editable: boolean;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <Empty>No contacts yet.</Empty>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-ink">
                  {c.name} {c.isDecisionMaker && <span className="badge ml-1 bg-brand-100 text-brand-700">Decision maker</span>}
                </p>
                {c.jobTitle && <p className="text-slate-500">{c.jobTitle}</p>}
                <p className="mt-1 flex flex-wrap gap-3">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="font-medium text-brand-700">
                      {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="text-brand-700">
                      {c.email}
                    </a>
                  )}
                </p>
              </div>
              {editable && (
                <ActionButton run={deleteContact.bind(null, c.id)} confirmText={`Remove ${c.name}?`} className="btn-ghost btn-sm px-2 text-slate-400">
                  <Trash2 size={16} aria-label="Remove" />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Sheet title="Add contact" trigger={<><Plus size={18} /> Add contact</>} triggerClassName="btn-secondary w-full">
          <ActionForm action={addContact.bind(null, accountId)}>
            <Field label="Name" name="name">
              <input id="name" name="name" required className="input" />
            </Field>
            <Field label="Job title" name="job_title">
              <input id="job_title" name="job_title" className="input" />
            </Field>
            <Field label="Phone" name="phone">
              <input id="phone" name="phone" type="tel" className="input" />
            </Field>
            <Field label="Email" name="email">
              <input id="email" name="email" type="email" className="input" />
            </Field>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input type="checkbox" name="is_decision_maker" className="h-5 w-5 rounded border-slate-300" /> Decision maker
            </label>
            <Submit>Add contact</Submit>
          </ActionForm>
        </Sheet>
      )}
    </div>
  );
}

export function NotesTab({ accountId, rows }: { accountId: string; rows: { c: { id: string; body: string; createdAt: Date }; by: string | null }[] }) {
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <ActionForm action={addComment.bind(null, accountId)} closeOnSuccess={false} className="space-y-2">
          <Field label="Add a note for whoever picks this up next" name="body">
            <textarea id="body" name="body" rows={3} required className="input" />
          </Field>
          <Submit className="btn-primary">Post note</Submit>
        </ActionForm>
      </div>
      {rows.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {rows.map(({ c, by }) => (
            <li key={c.id} className="px-4 py-3 text-sm">
              <p className="whitespace-pre-wrap text-ink">{c.body}</p>
              <p className="mt-1 text-xs text-slate-500">
                {by ?? "Unknown"} · {formatDateTime(c.createdAt, true)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Money ----------------------------------------------------------------------
export function MoneyTab({
  acc,
  disbursements,
  limits,
  currentLimit,
  uploads,
  creditOptions,
  canSetLimit,
  isAdmin,
  share,
}: {
  acc: Account;
  disbursements: {
    d: { id: string; product: Product; amount: string; disbursedAt: Date; source: "MANUAL" | "STATEMENT"; notes: string | null; reversesId: string | null; splitGroupId: string | null };
    creditedName: string | null;
  }[];
  limits: { l: { id: string; amount: string; effectiveFrom: Date; note: string | null }; by: string | null }[];
  currentLimit: number | null;
  uploads: StatementUpload[];
  creditOptions: { id: string; name: string; role: string }[];
  canSetLimit: boolean;
  isAdmin: boolean;
  share: ShareView | null;
}) {
  const isQf = acc.kind === "MERCHANT" || acc.kind === "INDIVIDUAL";
  const reversed = new Set(disbursements.map((x) => x.d.reversesId).filter(Boolean));
  // A split disbursement shows one row per BDO but one Reverse button for the whole split.
  const firstOfGroup = new Set<string>();
  const seenGroups = new Set<string>();
  for (const { d } of disbursements) {
    if (!d.splitGroupId || Number(d.amount) <= 0 || seenGroups.has(d.splitGroupId)) continue;
    seenGroups.add(d.splitGroupId);
    firstOfGroup.add(d.id);
  }
  const monthStart = todayYmd().slice(0, 7);
  const thisMonth = disbursements.filter((x) => formatYm(x.d.disbursedAt) === monthStart);
  const qfMonth = thisMonth.filter((x) => x.d.product === "QUICK_FINANCE").reduce((s, x) => s + Number(x.d.amount), 0);
  const lifetime = disbursements.reduce((s, x) => s + Number(x.d.amount), 0);
  const lastUpload = uploads.find((u) => u.accepted);
  const products = PRODUCTS_FOR_KIND[acc.kind] as readonly Product[];

  return (
    <div className="space-y-5">
      {isQf && (
        <div className="grid grid-cols-2 gap-2">
          <div className="card p-3.5">
            <p className="text-xs text-slate-500">QF limit</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{currentLimit ? formatMoney(currentLimit) : "Not set"}</p>
          </div>
          <div className="card p-3.5">
            <p className="text-xs text-slate-500">Drawn this month</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(qfMonth, { dash: false })}</p>
            {currentLimit ? <p className="text-xs text-slate-500">{(qfMonth / currentLimit).toFixed(2)} cycles</p> : null}
          </div>
          <div className="card p-3.5">
            <p className="text-xs text-slate-500">Overdraft now</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {lastUpload?.closingBalance ? formatMoney(Math.max(0, -Number(lastUpload.closingBalance)), { dash: false }) : "—"}
            </p>
            {lastUpload?.periodTo && <p className="text-xs text-slate-500">as of {formatShortDate(lastUpload.periodTo)}</p>}
          </div>
          <div className="card p-3.5">
            <p className="text-xs text-slate-500">Lifetime disbursed</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(lifetime, { dash: false })}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {isQf && canSetLimit && (
          <Sheet title="Set QF limit" trigger="Set QF limit" triggerClassName="btn-secondary flex-1">
            <ActionForm action={setQfLimit.bind(null, acc.id)}>
              <Field label="Limit (KES)" name="amount">
                <input id="amount" name="amount" inputMode="decimal" required defaultValue={currentLimit ?? ""} className="input" />
              </Field>
              <Field label="Takes effect on" name="effective_from" hint="Draws are measured against the limit in force on the day they happen.">
                <input id="effective_from" name="effective_from" type="date" required defaultValue={todayYmd()} className="input" />
              </Field>
              <Field label="Note (optional)" name="note">
                <input id="note" name="note" className="input" placeholder="e.g. Increased after 3 months' good use" />
              </Field>
              <Submit>Save limit</Submit>
            </ActionForm>
          </Sheet>
        )}
        {creditOptions.length > 0 && (
          <Sheet title="Record a disbursement" trigger="Record disbursement" triggerClassName="btn-secondary flex-1">
            <ActionForm action={recordDisbursement.bind(null, acc.id)}>
              <Field label="Product" name="product">
                <select id="product" name="product" className="input">
                  {products.map((p) => (
                    <option key={p} value={p}>
                      {PRODUCT_LABELS[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount (KES)" name="amount">
                <input id="amount" name="amount" inputMode="decimal" required className="input" />
              </Field>
              <Field label="Date disbursed" name="disbursed_on">
                <input id="disbursed_on" name="disbursed_on" type="date" required defaultValue={todayYmd()} className="input" />
              </Field>
              {share ? (
                <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
                  <p className="font-medium">Split automatically (shared corporate)</p>
                  <ul className="mt-1 space-y-0.5">
                    {share.members.map((m) => (
                      <li key={m.userId} className="flex justify-between gap-2">
                        <span>{m.name}</span>
                        <span className="tabular-nums">{m.percent}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Field label="Credit to" name="credited_to">
                  <select id="credited_to" name="credited_to" className="input" defaultValue={acc.ownerId && creditOptions.some((o) => o.id === acc.ownerId) ? acc.ownerId : creditOptions[0].id}>
                    {creditOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({ROLE_LABELS[o.role as keyof typeof ROLE_LABELS]})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Note (optional)" name="notes">
                <input id="notes" name="notes" className="input" />
              </Field>
              {isQf && <p className="text-xs text-slate-500">QF draws are recorded automatically from uploaded statements. Use this only for amounts not on a statement.</p>}
              <Submit>Record</Submit>
            </ActionForm>
          </Sheet>
        )}
      </div>
      {!isAdmin && <p className="text-xs text-slate-500">QF limits, statements and disbursements are recorded by an Admin.</p>}

      {isQf && limits.length > 0 && (
        <Section title="Limit history">
          <ul className="card divide-y divide-slate-100 text-sm">
            {limits.map(({ l, by }) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="tabular-nums">{formatMoney(l.amount)}</span>
                <span className="text-right text-xs text-slate-500">
                  from {formatDate(l.effectiveFrom)} · {by ?? "—"}
                  {l.note ? ` · ${l.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isQf && uploads.length > 0 && (
        <Section title="Recent statements">
          <ul className="card divide-y divide-slate-100 text-sm">
            {uploads.map((u) => (
              <li key={u.id} className="px-4 py-2.5">
                <p className={u.accepted ? "text-ink" : "text-red-700"}>
                  {u.accepted ? `${u.linesNew} new lines, ${u.drawsNew} draws (${formatMoney(u.drawsAmountNew, { dash: false })})` : `Rejected: ${u.message}`}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(u.createdAt)} · {u.fileName}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Ledger" subtitle="Entries are never edited. Corrections appear as reversals.">
        {disbursements.length === 0 ? (
          <Empty>No disbursements yet.</Empty>
        ) : (
          <ul className="card divide-y divide-slate-100 text-sm">
            {disbursements.map(({ d, creditedName }) => {
              const amt = Number(d.amount);
              return (
                <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <ProductBadge product={d.product} />
                      <span className={`font-medium tabular-nums ${amt < 0 ? "text-red-700" : "text-ink"}`}>{formatMoney(amt, { dash: false })}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {formatDate(d.disbursedAt)} · {creditedName ?? "No one"}
                      {d.splitGroupId ? "" : d.source === "STATEMENT" ? " · statement" : " · manual"}
                      {d.notes ? ` · ${d.notes}` : ""}
                    </p>
                  </div>
                  {d.source === "MANUAL" && amt > 0 && !reversed.has(d.id) && creditOptions.length > 0 && (!d.splitGroupId || firstOfGroup.has(d.id)) && (
                    <ActionButton
                      run={reverseDisbursement.bind(null, d.id)}
                      prompt={d.splitGroupId ? "This reverses the whole split, for every BDO. Why is it being reversed?" : "Why is this being reversed?"}
                      className="btn-ghost btn-sm px-2 text-xs text-slate-500"
                    >
                      {d.splitGroupId ? "Reverse split" : "Reverse"}
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
const formatYm = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit" }).format(d);

// --- Documents --------------------------------------------------------------
export function DocumentsTab({
  accountId,
  docs,
  editable,
}: {
  accountId: string;
  docs: { d: { id: string; docType: string; originalName: string; sizeBytes: number; createdAt: Date; mimeType: string }; by: string | null }[];
  editable: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">KYC needs vary by type of business. Upload whatever this merchant has provided.</p>
      {editable && (
        <Sheet title="Upload a document" trigger={<><Upload size={18} /> Upload document</>} triggerClassName="btn-primary w-full">
          <ActionForm action={uploadKycDocument.bind(null, accountId)}>
            <Field label="What is it?" name="doc_type">
              <input id="doc_type" name="doc_type" list="doc-types" required className="input" placeholder="e.g. Business permit" />
              <datalist id="doc-types">
                <option value="Certificate of registration" />
                <option value="Business permit" />
                <option value="KRA PIN certificate" />
                <option value="Owner's national ID" />
                <option value="M-Pesa / bank statement" />
              </datalist>
            </Field>
            <Field label="Photo or PDF (max 10 MB)" name="file">
              <input id="file" name="file" type="file" required accept="image/*,application/pdf" capture="environment" className="input py-2" />
            </Field>
            <Submit pendingText="Uploading…">Upload</Submit>
          </ActionForm>
        </Sheet>
      )}
      {docs.length === 0 ? (
        <Empty>No documents yet.</Empty>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {docs.map(({ d, by }) => (
            <li key={d.id}>
              <a href={`/api/files/kyc/${d.id}`} target="_blank" rel="noopener" className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                <FileText size={20} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{d.docType}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {d.originalName} · {Math.ceil(d.sizeBytes / 1024)} KB · {by ?? "—"} · {formatDate(d.createdAt)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Location ---------------------------------------------------------------
export function LocationTab({ capture, agentName }: { capture: LocationCapture | null; agentName: string | null }) {
  if (!capture) return <Empty>No location was captured for this account.</Empty>;
  const line = shortAddress(capture);
  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        {/* OpenStreetMap's embeddable map: free, no key, no tracking script. */}
        <iframe
          title="Map"
          className="h-64 w-full border-0"
          loading="lazy"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${capture.longitude - 0.004},${capture.latitude - 0.003},${capture.longitude + 0.004},${capture.latitude + 0.003}&layer=mapnik&marker=${capture.latitude},${capture.longitude}`}
        />
        <div className="p-4">
          <p className="font-medium text-ink">
            {line ?? (capture.geocodeStatus === "PENDING" ? "Looking up the street name…" : capture.geocodeStatus === "OFF" ? "Street lookup is switched off" : "Street name not found")}
          </p>
          {capture.formatted && <p className="mt-1 text-xs text-slate-500">{capture.formatted}</p>}
        </div>
      </div>
      <dl className="card divide-y divide-slate-100">
        <Row label="Road / street">{capture.road}</Row>
        <Row label="Building / landmark">{capture.landmark}</Row>
        <Row label="Area">{capture.area}</Row>
        <Row label="Town">{capture.town}</Row>
        <Row label="County">{capture.county}</Row>
        <Row label="Coordinates">
          <span className="font-mono text-xs">
            {capture.latitude.toFixed(6)}, {capture.longitude.toFixed(6)}
          </span>
        </Row>
        <Row label="Accuracy">{capture.accuracyM !== null ? `±${Math.round(capture.accuracyM)} m` : null}</Row>
        <Row label="Captured">
          {formatDateTime(capture.capturedAt, true)} by {agentName ?? "—"}
        </Row>
        <Row label="Address source">{capture.geocodeProvider === "nominatim" ? "OpenStreetMap" : capture.geocodeProvider === "google" ? "Google" : "—"}</Row>
      </dl>
      <p className="text-xs text-slate-500">A device-reported reading taken at registration, not proof that someone was physically present.</p>
      <p className="text-xs text-slate-400">Map data © OpenStreetMap contributors.</p>
    </div>
  );
}
