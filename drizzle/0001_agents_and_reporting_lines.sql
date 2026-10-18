ALTER TYPE "public"."user_role" ADD VALUE 'AGENT' BEFORE 'BDO';--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "credited_bdo_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reports_to" uuid;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_credited_bdo_id_users_id_fk" FOREIGN KEY ("credited_bdo_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reports_to_users_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disbursements_bdo_idx" ON "disbursements" USING btree ("credited_bdo_id","disbursed_at");--> statement-breakpoint
CREATE INDEX "users_reports_to_idx" ON "users" USING btree ("reports_to");