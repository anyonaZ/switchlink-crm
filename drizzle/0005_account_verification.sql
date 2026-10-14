ALTER TYPE "public"."account_status" ADD VALUE 'PENDING_VERIFICATION' BEFORE 'ACTIVE';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "pending_from_status" "account_status";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "verification_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "verification_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_verification_requested_by_users_id_fk" FOREIGN KEY ("verification_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "individual_profiles" DROP COLUMN "id_number_enc";--> statement-breakpoint
ALTER TABLE "individual_profiles" DROP COLUMN "id_last4";