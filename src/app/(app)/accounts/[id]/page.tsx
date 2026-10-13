import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Mail, MessageCircle, Navigation, Phone } from "lucide-react";
import { db, t } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { loadAccountFor, loadPerson } from "@/lib/access";
import { canEditAccount, canManageQf, canReassignAccount, canRequestShare, canViewFullIdNumber, canViewLocation, isSupervisor, STATUS_FLOW, userScope } from "@/lib/permissions";
import { activeShare, sharesFor } from "@/lib/shares";
import { creditOptions } from "@/lib/actions/money";
import { PageHeader } from "@/components/ui/Page";
import TabStrip from "@/components/TabStrip";
import { KindBadge, StatusBadge } from "@/components/ui/Badges";
import { shortAddress } from "@/lib/geo/geocode";
import { OverviewTab, PipelineTab, ActivityTab, ContactsTab, NotesTab, MoneyTab, DocumentsTab, LocationTab, type SharingInfo } from "./tabs";

type Tab = "overview" | "pipeline" | "activity" | "contacts" | "notes" | "money" | "documents" | "location";

/** WhatsApp needs 2547XXXXXXXX; agents usually type 07XX or 01XX. */
const waLink = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("0") ? `254${digits.slice(1)}` : digits}`;
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select({ name: t.accounts.name }).from(t.accounts).where(eq(t.accounts.id, id)) : [];
  return { title: a?.name ?? "Account" };
}

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const acc = await loadAccountFor(me, id);
  const owner = await loadPerson(acc.ownerId);
  const editable = canEditAccount(me, acc);
  const isMoneyKind = acc.kind === "MERCHANT" || acc.kind === "INDIVIDUAL";
  const showLocation = canViewLocation(me, acc);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "pipeline", label: "Pipeline" },
    { key: "activity", label: "Activity" },
    ...(isMoneyKind || isSupervisor(me) ? [{ key: "money" as Tab, label: isMoneyKind ? "QF & money" : "Disbursements" }] : []),
    ...(acc.kind === "MERCHANT" ? [{ key: "documents" as Tab, label: "Documents" }] : []),
    { key: "contacts", label: "Contacts" },
    { key: "notes", label: "Notes" },
    ...(showLocation ? [{ key: "location" as Tab, label: "Location" }] : []),
  ];
  const tab: Tab = tabs.some((x) => x.key === tabParam) ? (tabParam as Tab) : "overview";

  const [location] = showLocation
    ? await db.select().from(t.locationCaptures).where(eq(t.locationCaptures.accountId, id)).orderBy(desc(t.locationCaptures.capturedAt)).limit(1)
    : [];

  let body: React.ReactNode = null;
  if (tab === "overview") {
    const [merchant] = acc.kind === "MERCHANT" ? await db.select().from(t.merchantProfiles).where(eq(t.merchantProfiles.accountId, id)) : [];
    const [individual] =
      acc.kind === "INDIVIDUAL"
        ? await db
            .select({ idLast4: t.individualProfiles.idLast4, dateOfBirth: t.individualProfiles.dateOfBirth })
            .from(t.individualProfiles)
            .where(eq(t.individualProfiles.accountId, id))
        : [];
    const changer = alias(t.users, "changer");
    const history = await db
      .select({ id: t.accountStatusHistory.id, from: t.accountStatusHistory.fromStatus, to: t.accountStatusHistory.toStatus, at: t.accountStatusHistory.changedAt, note: t.accountStatusHistory.note, by: changer.name })
      .from(t.accountStatusHistory)
      .leftJoin(changer, eq(changer.id, t.accountStatusHistory.changedBy))
      .where(eq(t.accountStatusHistory.accountId, id))
      .orderBy(desc(t.accountStatusHistory.changedAt))
      .limit(20);
    const reassignTo =
      (me.role === "BDO"
        ? // Owner or the owner's BDO; a BDO who only shares the corporate can't move it.
          canReassignAccount(me, acc, { id: me.id, role: "BDO", teamId: me.teamId })
        : isSupervisor(me) && canReassignAccount(me, acc, null))
        ? await db
            .select({ id: t.users.id, name: t.users.name, role: t.users.role })
            .from(t.users)
            .where(and(userScope(me), eq(t.users.status, "ACTIVE")))
            .orderBy(t.users.name)
        : [];
    let sharing: SharingInfo | null = null;
    if (acc.kind === "CORPORATE") {
      const shares = me.role === "AGENT" ? [await activeShare(id)].filter((x) => x !== null) : await sharesFor(me, eq(t.accountShares.accountId, id), 10);
      const hasOpen = shares.some((s) => s.status === "PENDING" || s.status === "APPROVED");
      const team = alias(t.teams, "team");
      const requestTo =
        canRequestShare(me, acc)
          ? (
              await db
                .select({ id: t.users.id, name: t.users.name, teamName: team.name })
                .from(t.users)
                .leftJoin(team, eq(team.id, t.users.teamId))
                .where(and(eq(t.users.role, "BDO"), eq(t.users.status, "ACTIVE")))
                .orderBy(t.users.name)
            ).filter((u) => u.id !== me.id)
          : null;
      sharing = { me: { id: me.id, name: me.name, isAdmin: me.role === "ADMIN" }, shares, requestTo, canRequestNow: !hasOpen };
    }
    body = (
      <OverviewTab
        sharing={sharing}
        acc={acc}
        ownerName={owner?.name ?? null}
        editable={editable}
        merchant={merchant ?? null}
        individual={individual ?? null}
        canRevealId={canViewFullIdNumber(me)}
        history={history}
        statusOptions={STATUS_FLOW[acc.kind].filter((s) => s !== acc.status)}
        reassignTo={reassignTo}
      />
    );
  } else if (tab === "pipeline") {
    const opps = await db.select().from(t.opportunities).where(eq(t.opportunities.accountId, id)).orderBy(t.opportunities.createdAt);
    const changer = alias(t.users, "changer");
    const hist = opps.length
      ? await db
          .select({ oppId: t.opportunityStageHistory.opportunityId, from: t.opportunityStageHistory.fromStage, to: t.opportunityStageHistory.toStage, at: t.opportunityStageHistory.changedAt, by: changer.name })
          .from(t.opportunityStageHistory)
          .leftJoin(changer, eq(changer.id, t.opportunityStageHistory.changedBy))
          .where(inArray(t.opportunityStageHistory.opportunityId, opps.map((o) => o.id)))
          .orderBy(desc(t.opportunityStageHistory.changedAt))
      : [];
    body = <PipelineTab acc={acc} opps={opps} history={hist} editable={editable} />;
  } else if (tab === "activity") {
    const creator = alias(t.users, "creator");
    const acts = await db
      .select({ a: t.activities, by: creator.name })
      .from(t.activities)
      .leftJoin(creator, eq(creator.id, t.activities.createdBy))
      .where(eq(t.activities.accountId, id))
      .orderBy(desc(t.activities.createdAt))
      .limit(60);
    const opps = await db.select({ id: t.opportunities.id, product: t.opportunities.product }).from(t.opportunities).where(eq(t.opportunities.accountId, id));
    body = <ActivityTab accountId={id} rows={acts} opps={opps} editable={editable} />;
  } else if (tab === "contacts") {
    const rows = await db.select().from(t.contacts).where(eq(t.contacts.accountId, id)).orderBy(t.contacts.createdAt);
    body = <ContactsTab accountId={id} rows={rows} editable={editable} />;
  } else if (tab === "notes") {
    const author = alias(t.users, "author");
    const rows = await db
      .select({ c: t.comments, by: author.name })
      .from(t.comments)
      .leftJoin(author, eq(author.id, t.comments.authorId))
      .where(eq(t.comments.accountId, id))
      .orderBy(desc(t.comments.createdAt))
      .limit(100);
    body = <NotesTab accountId={id} rows={rows} />;
  } else if (tab === "money") {
    const credited = alias(t.users, "credited");
    const setter = alias(t.users, "setter");
    const [disb, limits, uploads, credit, share] = await Promise.all([
      db
        .select({ d: t.disbursements, creditedName: credited.name })
        .from(t.disbursements)
        .leftJoin(credited, eq(credited.id, t.disbursements.creditedTo))
        .where(eq(t.disbursements.accountId, id))
        .orderBy(desc(t.disbursements.disbursedAt), desc(t.disbursements.createdAt))
        .limit(200),
      db
        .select({ l: t.qfLimits, by: setter.name })
        .from(t.qfLimits)
        .leftJoin(setter, eq(setter.id, t.qfLimits.setBy))
        .where(eq(t.qfLimits.accountId, id))
        .orderBy(desc(t.qfLimits.effectiveFrom)),
      db.select().from(t.statementUploads).where(eq(t.statementUploads.accountId, id)).orderBy(desc(t.statementUploads.createdAt)).limit(5),
      creditOptions(id),
      acc.kind === "CORPORATE" ? activeShare(id) : Promise.resolve(null),
    ]);
    const [currentLimit] = await db
      .select({ amount: t.qfLimits.amount })
      .from(t.qfLimits)
      .where(and(eq(t.qfLimits.accountId, id), lte(t.qfLimits.effectiveFrom, new Date())))
      .orderBy(desc(t.qfLimits.effectiveFrom))
      .limit(1);
    body = (
      <MoneyTab
        acc={acc}
        disbursements={disb}
        limits={limits}
        currentLimit={currentLimit ? Number(currentLimit.amount) : null}
        uploads={uploads}
        creditOptions={credit}
        canSetLimit={canManageQf(me)}
        isAdmin={me.role === "ADMIN"}
        share={share}
      />
    );
  } else if (tab === "documents") {
    const uploader = alias(t.users, "uploader");
    const docs = await db
      .select({ d: t.kycDocuments, by: uploader.name })
      .from(t.kycDocuments)
      .leftJoin(uploader, eq(uploader.id, t.kycDocuments.uploadedBy))
      .where(eq(t.kycDocuments.accountId, id))
      .orderBy(desc(t.kycDocuments.createdAt));
    body = <DocumentsTab accountId={id} docs={docs} editable={editable} />;
  } else if (tab === "location") {
    const [agent] = location?.agentId ? await db.select({ name: t.users.name }).from(t.users).where(eq(t.users.id, location.agentId)) : [];
    body = <LocationTab capture={location ?? null} agentName={agent?.name ?? null} />;
  }

  const address = location ? shortAddress(location) : null;
  return (
    <div>
      <PageHeader
        title={acc.name}
        back={{ href: "/accounts", label: "Accounts" }}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={acc.kind} />
            <StatusBadge status={acc.status} />
            {acc.pesiAccountNo && <span className="text-xs">Pesi {acc.pesiAccountNo}</span>}
            <span className="text-xs">· {owner?.name ?? "Unassigned"}</span>
          </span>
        }
      />

      {(acc.phone || acc.email || location) && (
      <div className="mb-4 grid grid-cols-3 gap-2 md:flex md:flex-wrap">
        {acc.phone ? (
          <a href={`tel:${acc.phone}`} className="btn-secondary flex-col gap-0.5 py-2 text-xs md:flex-row md:text-sm">
            <Phone size={18} /> Call
          </a>
        ) : null}
        {acc.phone ? (
          <a href={waLink(acc.phone)} target="_blank" rel="noopener noreferrer" className="btn-secondary flex-col gap-0.5 py-2 text-xs md:flex-row md:text-sm">
            <MessageCircle size={18} /> WhatsApp
          </a>
        ) : null}
        {location ? (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex-col gap-0.5 py-2 text-xs md:flex-row md:text-sm"
          >
            <Navigation size={18} /> Directions
          </a>
        ) : acc.email ? (
          <a href={`mailto:${acc.email}`} className="btn-secondary flex-col gap-0.5 py-2 text-xs md:flex-row md:text-sm">
            <Mail size={18} /> Email
          </a>
        ) : null}
      </div>
      )}
      {address && <p className="-mt-2 mb-4 text-sm text-slate-500">{address}</p>}

      <TabStrip tabs={tabs} active={tab} base={`/accounts/${id}`} />
      {body}
    </div>
  );
}
