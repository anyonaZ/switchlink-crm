-- Authorship signature in the database itself (see src/lib/signature.ts).
-- Table comments and this function are kept by pg_dump, so backups and restored copies carry it too.
COMMENT ON TABLE "teams" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "users" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "sessions" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "accounts" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "merchant_profiles" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "individual_profiles" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "account_status_history" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "kyc_documents" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "contacts" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "opportunities" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "opportunity_stage_history" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "activities" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "comments" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "location_captures" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "qf_limits" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "statement_uploads" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "statement_lines" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "account_shares" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "account_share_members" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "account_share_approvals" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "disbursements" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
COMMENT ON TABLE "audit_log" IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "switchlink_crm_signature"() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c'::text $$;--> statement-breakpoint
COMMENT ON FUNCTION "switchlink_crm_signature"() IS 'Switchlink CRM - (c) 2026 Anyonaz NewTech. All rights reserved. SLCRM-ANZ-2026-22618b25b6481b46c0702c9c';
