CREATE TYPE "public"."approval_decision" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."share_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ENDED');--> statement-breakpoint
CREATE TABLE "account_share_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"team_id" uuid,
	"decision" "approval_decision" DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "account_share_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"team_id" uuid
);
--> statement-breakpoint
CREATE TABLE "account_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "share_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid,
	"note" text,
	"decided_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "share_id" uuid;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "split_group_id" uuid;--> statement-breakpoint
ALTER TABLE "account_share_approvals" ADD CONSTRAINT "account_share_approvals_share_id_account_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."account_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_approvals" ADD CONSTRAINT "account_share_approvals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_approvals" ADD CONSTRAINT "account_share_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_members" ADD CONSTRAINT "account_share_members_share_id_account_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."account_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_members" ADD CONSTRAINT "account_share_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_members" ADD CONSTRAINT "account_share_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_shares" ADD CONSTRAINT "account_shares_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_shares" ADD CONSTRAINT "account_shares_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_shares" ADD CONSTRAINT "account_shares_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_share_approvals_share_idx" ON "account_share_approvals" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "account_share_approvals_pending_idx" ON "account_share_approvals" USING btree ("decision","role","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_share_members_unique_idx" ON "account_share_members" USING btree ("share_id","user_id");--> statement-breakpoint
CREATE INDEX "account_share_members_user_idx" ON "account_share_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_shares_account_idx" ON "account_shares" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_shares_status_idx" ON "account_shares" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "account_shares_one_open_idx" ON "account_shares" USING btree ("account_id") WHERE "account_shares"."status" in ('PENDING', 'APPROVED');--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_share_id_account_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."account_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disbursements_split_group_idx" ON "disbursements" USING btree ("split_group_id");