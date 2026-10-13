CREATE TYPE "public"."account_kind" AS ENUM('SCHOOL', 'CORPORATE', 'MERCHANT', 'INDIVIDUAL');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('ONGOING_ENGAGEMENT', 'DOCUMENT_COLLECTION', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'SITE_VISIT', 'NOTE');--> statement-breakpoint
CREATE TYPE "public"."disbursement_source" AS ENUM('MANUAL', 'STATEMENT');--> statement-breakpoint
CREATE TYPE "public"."geocode_status" AS ENUM('PENDING', 'DONE', 'FAILED', 'OFF');--> statement-breakpoint
CREATE TYPE "public"."product" AS ENUM('SNPL', 'SALARY_ADVANCE', 'QUICK_FINANCE');--> statement-breakpoint
CREATE TYPE "public"."opportunity_stage" AS ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'MEETING', 'INTERESTED', 'PROPOSAL', 'NEGOTIATION', 'MOU', 'ONBOARDING', 'ACTIVE');--> statement-breakpoint
CREATE TYPE "public"."statement_line_kind" AS ENUM('COLLECTION', 'PAYBILL', 'DISBURSEMENT', 'SWITCH_CHARGE', 'OD_PROCESSING_FEE', 'OD_DAILY_CHARGE', 'REVERSAL_DISBURSEMENT', 'REVERSAL_CHARGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('BDO', 'TEAM_LEADER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "account_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"from_status" "account_status",
	"to_status" "account_status" NOT NULL,
	"changed_by" uuid,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "account_kind" NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"phone" text,
	"email" text,
	"location_text" text,
	"owner_id" uuid,
	"team_id" uuid,
	"status" "account_status" DEFAULT 'ONGOING_ENGAGEMENT' NOT NULL,
	"pesi_account_no" varchar(4),
	"statement_account_no" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"type" "activity_type" NOT NULL,
	"description" text,
	"status" "activity_status" DEFAULT 'COMPLETED' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"next_action" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_title" text,
	"phone" text,
	"email" text,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"product" "product" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"disbursed_at" timestamp with time zone NOT NULL,
	"credited_to" uuid,
	"credited_team_id" uuid,
	"created_by" uuid,
	"source" "disbursement_source" DEFAULT 'MANUAL' NOT NULL,
	"statement_line_id" uuid,
	"reverses_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "individual_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"id_number_enc" text,
	"id_last4" varchar(4),
	"date_of_birth" date
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"file_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid,
	"purpose" text DEFAULT 'REGISTRATION' NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_m" double precision,
	"captured_at" timestamp with time zone NOT NULL,
	"road" text,
	"landmark" text,
	"area" text,
	"town" text,
	"county" text,
	"country" text,
	"formatted" text,
	"geocode_provider" text,
	"geocode_status" "geocode_status" DEFAULT 'PENDING' NOT NULL,
	"geocode_attempts" integer DEFAULT 0 NOT NULL,
	"geocoded_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"business_type" text,
	"registration_no" text,
	"kra_pin" text,
	"owner_name" text
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"product" "product" NOT NULL,
	"stage" "opportunity_stage" DEFAULT 'NEW' NOT NULL,
	"owner_id" uuid,
	"estimated_value" numeric(14, 2),
	"next_action" text,
	"next_action_date" date,
	"notes" text,
	"applications_count" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage" "opportunity_stage",
	"to_stage" "opportunity_stage" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qf_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"set_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"upload_id" uuid,
	"serial_id" text NOT NULL,
	"kind" "statement_line_kind" NOT NULL,
	"posting_date" date NOT NULL,
	"particulars" text NOT NULL,
	"money_in" numeric(14, 2) NOT NULL,
	"money_out" numeric(14, 2) NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"od_before" numeric(14, 2) NOT NULL,
	"od_after" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"file_name" text NOT NULL,
	"file_path" text,
	"uploaded_by" uuid,
	"header_owner" text,
	"header_account_no" text,
	"period_from" date,
	"period_to" date,
	"closing_balance" numeric(14, 2),
	"lines_total" integer DEFAULT 0 NOT NULL,
	"lines_new" integer DEFAULT 0 NOT NULL,
	"draws_new" integer DEFAULT 0 NOT NULL,
	"draws_amount_new" numeric(14, 2) DEFAULT '0' NOT NULL,
	"accepted" boolean NOT NULL,
	"message" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'BDO' NOT NULL,
	"team_id" uuid,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_status_history" ADD CONSTRAINT "account_status_history_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_status_history" ADD CONSTRAINT "account_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_credited_to_users_id_fk" FOREIGN KEY ("credited_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_credited_team_id_teams_id_fk" FOREIGN KEY ("credited_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_statement_line_id_statement_lines_id_fk" FOREIGN KEY ("statement_line_id") REFERENCES "public"."statement_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_profiles" ADD CONSTRAINT "individual_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_captures" ADD CONSTRAINT "location_captures_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_captures" ADD CONSTRAINT "location_captures_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qf_limits" ADD CONSTRAINT "qf_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qf_limits" ADD CONSTRAINT "qf_limits_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_upload_id_statement_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."statement_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_uploads" ADD CONSTRAINT "statement_uploads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_uploads" ADD CONSTRAINT "statement_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_status_history_account_idx" ON "account_status_history" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "accounts_team_idx" ON "accounts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "accounts_kind_idx" ON "accounts" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_pesi_no_idx" ON "accounts" USING btree ("pesi_account_no");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_statement_no_idx" ON "accounts" USING btree ("statement_account_no");--> statement-breakpoint
CREATE INDEX "activities_account_idx" ON "activities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "activities_status_sched_idx" ON "activities" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "activities_created_at_idx" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comments_account_idx" ON "comments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contacts_account_idx" ON "contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "disbursements_account_idx" ON "disbursements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "disbursements_credited_idx" ON "disbursements" USING btree ("credited_to","disbursed_at");--> statement-breakpoint
CREATE INDEX "disbursements_team_idx" ON "disbursements" USING btree ("credited_team_id","disbursed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disbursements_statement_line_idx" ON "disbursements" USING btree ("statement_line_id");--> statement-breakpoint
CREATE INDEX "kyc_documents_account_idx" ON "kyc_documents" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "location_captures_account_idx" ON "location_captures" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "location_captures_status_idx" ON "location_captures" USING btree ("geocode_status");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_account_product_idx" ON "opportunities" USING btree ("account_id","product");--> statement-breakpoint
CREATE INDEX "opportunities_owner_idx" ON "opportunities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "opportunities_stage_idx" ON "opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "osh_opportunity_idx" ON "opportunity_stage_history" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "osh_changed_at_idx" ON "opportunity_stage_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "qf_limits_account_idx" ON "qf_limits" USING btree ("account_id","effective_from");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_lines_dedupe_idx" ON "statement_lines" USING btree ("account_id","serial_id","kind","money_in","money_out");--> statement-breakpoint
CREATE INDEX "statement_lines_account_date_idx" ON "statement_lines" USING btree ("account_id","posting_date");--> statement-breakpoint
CREATE INDEX "statement_uploads_account_idx" ON "statement_uploads" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_team_idx" ON "users" USING btree ("team_id");