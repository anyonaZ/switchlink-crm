CREATE TABLE "account_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "account_kind" NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"owner_id" uuid,
	"team_id" uuid,
	"account_created_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"individuals" integer DEFAULT 0 NOT NULL,
	"merchants" integer DEFAULT 0 NOT NULL,
	"corporates" integer DEFAULT 0 NOT NULL,
	"disbursement" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_targets" ADD CONSTRAINT "weekly_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletions_created_idx" ON "account_deletions" USING btree ("account_created_at");--> statement-breakpoint
CREATE INDEX "account_deletions_owner_idx" ON "account_deletions" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_targets_user_week_idx" ON "weekly_targets" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "weekly_targets_week_idx" ON "weekly_targets" USING btree ("week_start");