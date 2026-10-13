/**
 * Switchlink CRM database schema (PostgreSQL, via Drizzle ORM).
 *
 * One `accounts` table covers every client kind (school, corporate,
 * merchant, individual). Everything else hangs off an account. Money is
 * stored as numeric(14,2) and read back as strings, then converted with
 * Number() at the edges; amounts never pass through floats in SQL sums.
 *
 * Migrations are generated from this file with `npm run db:generate` and
 * applied with `npm run db:migrate`. Never edit a generated migration.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
/** AGENT reports to a BDO; BDO reports to a TEAM_LEADER. */
export const userRole = pgEnum("user_role", ["AGENT", "BDO", "TEAM_LEADER", "ADMIN"]);
export const userStatus = pgEnum("user_status", ["ACTIVE", "INACTIVE"]);
export const accountKind = pgEnum("account_kind", ["SCHOOL", "CORPORATE", "MERCHANT", "INDIVIDUAL"]);
export const accountStatus = pgEnum("account_status", [
  "ONGOING_ENGAGEMENT",
  "DOCUMENT_COLLECTION",
  "ACTIVE",
  "INACTIVE",
]);
export const product = pgEnum("product", ["SNPL", "SALARY_ADVANCE", "QUICK_FINANCE"]);
export const stage = pgEnum("opportunity_stage", [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "MEETING",
  "INTERESTED",
  "PROPOSAL",
  "NEGOTIATION",
  "MOU",
  "ONBOARDING",
  "ACTIVE",
]);
export const activityType = pgEnum("activity_type", ["CALL", "WHATSAPP", "EMAIL", "MEETING", "SITE_VISIT", "NOTE"]);
export const activityStatus = pgEnum("activity_status", ["SCHEDULED", "COMPLETED", "CANCELLED"]);
export const disbursementSource = pgEnum("disbursement_source", ["MANUAL", "STATEMENT"]);
export const geocodeStatus = pgEnum("geocode_status", ["PENDING", "DONE", "FAILED", "OFF"]);
export const statementLineKind = pgEnum("statement_line_kind", [
  "COLLECTION",
  "PAYBILL",
  "DISBURSEMENT",
  "SWITCH_CHARGE",
  "OD_PROCESSING_FEE",
  "OD_DAILY_CHARGE",
  "REVERSAL_DISBURSEMENT",
  "REVERSAL_CHARGE",
  "OTHER",
]);
/** A corporate shared between BDOs: requested, then approved by Team Leader(s) and an Admin. */
export const shareStatus = pgEnum("share_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ENDED"]);
export const approvalDecision = pgEnum("approval_decision", ["PENDING", "APPROVED", "REJECTED"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("BDO"),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Who this person answers to: an Agent's BDO, or a BDO's Team Leader. */
    reportsTo: uuid("reports_to").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    status: userStatus("status").notNull().default("ACTIVE"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`), index("users_team_idx").on(t.teamId), index("users_reports_to_idx").on(t.reportsTo)]
);

/** Server-side sessions. `id` is the SHA-256 of the cookie token, so a
 * leaked database row can't be replayed as a cookie. */
export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Hard cap regardless of activity. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

// ---------------------------------------------------------------------------
// Accounts (every client)
// ---------------------------------------------------------------------------
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: accountKind("kind").notNull(),
    name: text("name").notNull(),
    industry: text("industry"),
    phone: text("phone"),
    email: text("email"),
    /** Free-text location the agent typed; the captured address lives in location_captures. */
    locationText: text("location_text"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    status: accountStatus("status").notNull().default("ONGOING_ENGAGEMENT"),
    /** Merchant/individual Pesi account number (4 digits). Having one = "signed in". */
    pesiAccountNo: varchar("pesi_account_no", { length: 4 }),
    /** Account number printed on Pesi statements, e.g. MCA00010880001. */
    statementAccountNo: text("statement_account_no"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("accounts_owner_idx").on(t.ownerId),
    index("accounts_team_idx").on(t.teamId),
    index("accounts_kind_idx").on(t.kind),
    uniqueIndex("accounts_pesi_no_idx").on(t.pesiAccountNo),
    uniqueIndex("accounts_statement_no_idx").on(t.statementAccountNo),
  ]
);

export const merchantProfiles = pgTable("merchant_profiles", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  businessType: text("business_type"),
  registrationNo: text("registration_no"),
  kraPin: text("kra_pin"),
  ownerName: text("owner_name"),
});

export const individualProfiles = pgTable("individual_profiles", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  /** AES-256-GCM ciphertext (see src/lib/crypto.ts). Never select into a page for non-admins. */
  idNumberEnc: text("id_number_enc"),
  idLast4: varchar("id_last4", { length: 4 }),
  dateOfBirth: date("date_of_birth"),
});

export const accountStatusHistory = pgTable(
  "account_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    fromStatus: accountStatus("from_status"),
    toStatus: accountStatus("to_status").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_status_history_account_idx").on(t.accountId)]
);

export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(),
    filePath: text("file_path").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("kyc_documents_account_idx").on(t.accountId)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    phone: text("phone"),
    email: text("email"),
    isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_account_idx").on(t.accountId)]
);

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    product: product("product").notNull(),
    stage: stage("stage").notNull().default("NEW"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    estimatedValue: money("estimated_value"),
    nextAction: text("next_action"),
    nextActionDate: date("next_action_date"),
    notes: text("notes"),
    applicationsCount: integer("applications_count").notNull().default(0),
    approvedCount: integer("approved_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("opportunities_account_product_idx").on(t.accountId, t.product),
    index("opportunities_owner_idx").on(t.ownerId),
    index("opportunities_stage_idx").on(t.stage),
  ]
);

export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    fromStage: stage("from_stage"),
    toStage: stage("to_stage").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("osh_opportunity_idx").on(t.opportunityId), index("osh_changed_at_idx").on(t.changedAt)]
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    type: activityType("type").notNull(),
    description: text("description"),
    status: activityStatus("status").notNull().default("COMPLETED"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    nextAction: text("next_action"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("activities_account_idx").on(t.accountId),
    index("activities_status_sched_idx").on(t.status, t.scheduledAt),
    index("activities_created_at_idx").on(t.createdAt),
  ]
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("comments_account_idx").on(t.accountId)]
);

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
export const locationCaptures = pgTable(
  "location_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull().default("REGISTRATION"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    road: text("road"),
    landmark: text("landmark"),
    area: text("area"),
    town: text("town"),
    county: text("county"),
    country: text("country"),
    formatted: text("formatted"),
    geocodeProvider: text("geocode_provider"),
    geocodeStatus: geocodeStatus("geocode_status").notNull().default("PENDING"),
    geocodeAttempts: integer("geocode_attempts").notNull().default(0),
    geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [index("location_captures_account_idx").on(t.accountId), index("location_captures_status_idx").on(t.geocodeStatus)]
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
export const qfLimits = pgTable(
  "qf_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    setBy: uuid("set_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("qf_limits_account_idx").on(t.accountId, t.effectiveFrom)]
);

export const statementUploads = pgTable(
  "statement_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    filePath: text("file_path"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    headerOwner: text("header_owner"),
    headerAccountNo: text("header_account_no"),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    closingBalance: money("closing_balance"),
    linesTotal: integer("lines_total").notNull().default(0),
    linesNew: integer("lines_new").notNull().default(0),
    drawsNew: integer("draws_new").notNull().default(0),
    drawsAmountNew: money("draws_amount_new").notNull().default("0"),
    accepted: boolean("accepted").notNull(),
    message: text("message"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("statement_uploads_account_idx").on(t.accountId)]
);

export const statementLines = pgTable(
  "statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id").references(() => statementUploads.id, { onDelete: "set null" }),
    serialId: text("serial_id").notNull(),
    kind: statementLineKind("kind").notNull(),
    postingDate: date("posting_date").notNull(),
    particulars: text("particulars").notNull(),
    moneyIn: money("money_in").notNull(),
    moneyOut: money("money_out").notNull(),
    balance: money("balance").notNull(),
    /** Overdraft before and after this line (0 when in credit). */
    odBefore: money("od_before").notNull(),
    odAfter: money("od_after").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("statement_lines_dedupe_idx").on(t.accountId, t.serialId, t.kind, t.moneyIn, t.moneyOut),
    index("statement_lines_account_date_idx").on(t.accountId, t.postingDate),
  ]
);

// ---------------------------------------------------------------------------
// Corporate sharing
// ---------------------------------------------------------------------------
/**
 * BDOs who close a corporate together share its disbursements. A request
 * becomes APPROVED only when every approval slot is approved (one Admin slot
 * plus one Team Leader slot per team involved). While APPROVED, each
 * disbursement recorded on the account is split into one ledger row per
 * BDO by their percentage. At most one PENDING or APPROVED share per account.
 */
export const accountShares = pgTable(
  "account_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    status: shareStatus("status").notNull().default("PENDING"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    /** When it became APPROVED, REJECTED or CANCELLED. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("account_shares_account_idx").on(t.accountId),
    index("account_shares_status_idx").on(t.status),
    uniqueIndex("account_shares_one_open_idx").on(t.accountId).where(sql`${t.status} in ('PENDING', 'APPROVED')`),
  ]
);

export const accountShareMembers = pgTable(
  "account_share_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => accountShares.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Share of each disbursement, 0.01–99.99. All members add up to 100. */
    percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
    /** The BDO's team when the request was made (decides which Team Leader approves). */
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("account_share_members_unique_idx").on(t.shareId, t.userId), index("account_share_members_user_idx").on(t.userId)]
);

export const accountShareApprovals = pgTable(
  "account_share_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => accountShares.id, { onDelete: "cascade" }),
    /** ADMIN, or TEAM_LEADER for `teamId`. */
    role: userRole("role").notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    decision: approvalDecision("decision").notNull().default("PENDING"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reason: text("reason"),
  },
  (t) => [index("account_share_approvals_share_idx").on(t.shareId), index("account_share_approvals_pending_idx").on(t.decision, t.role, t.teamId)]
);

/** One ledger for every product. Never edited: corrections are reversal rows. */
export const disbursements = pgTable(
  "disbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    product: product("product").notNull(),
    /** Negative for a reversal. */
    amount: money("amount").notNull(),
    disbursedAt: timestamp("disbursed_at", { withTimezone: true }).notNull(),
    creditedTo: uuid("credited_to").references(() => users.id, { onDelete: "set null" }),
    /** The credited Agent's BDO on the day (or the BDO themselves), for BDO roll-ups. */
    creditedBdoId: uuid("credited_bdo_id").references(() => users.id, { onDelete: "set null" }),
    /** The credited person's team on the day, so team moves don't rewrite history. */
    creditedTeamId: uuid("credited_team_id").references(() => teams.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    source: disbursementSource("source").notNull().default("MANUAL"),
    statementLineId: uuid("statement_line_id").references(() => statementLines.id, { onDelete: "set null" }),
    reversesId: uuid("reverses_id"),
    notes: text("notes"),
    /** Set when this row is one BDO's slice of a shared-corporate disbursement. */
    shareId: uuid("share_id").references(() => accountShares.id, { onDelete: "set null" }),
    /** Every slice of one split disbursement carries the same group id (reversed together). */
    splitGroupId: uuid("split_group_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("disbursements_account_idx").on(t.accountId),
    index("disbursements_split_group_idx").on(t.splitGroupId),
    index("disbursements_credited_idx").on(t.creditedTo, t.disbursedAt),
    index("disbursements_team_idx").on(t.creditedTeamId, t.disbursedAt),
    index("disbursements_bdo_idx").on(t.creditedBdoId, t.disbursedAt),
    uniqueIndex("disbursements_statement_line_idx").on(t.statementLineId),
  ]
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_created_idx").on(t.createdAt)]
);

export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type LocationCapture = typeof locationCaptures.$inferSelect;
export type Disbursement = typeof disbursements.$inferSelect;
export type StatementUpload = typeof statementUploads.$inferSelect;
export type AccountShare = typeof accountShares.$inferSelect;
