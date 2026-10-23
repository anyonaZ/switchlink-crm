-- Security and data-integrity hardening:
--  * one individual per mobile number, whatever format it was typed in;
--  * an activity can only point at an opportunity on its own account;
--  * KYC file hashes; a database-backed sign-in throttle; idempotency keys for money writes.
-- Existing data is repaired or flagged first so the new rules can be added safely.

-- Kenyan mobile in E.164 (+2547XXXXXXXX / +2541XXXXXXXX), else null.
-- Must match kenyanMobile() in src/lib/phone.ts.
CREATE OR REPLACE FUNCTION kenya_phone(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT CASE
    WHEN d ~ '^254[17][0-9]{8}$' THEN '+' || d
    WHEN d ~ '^0[17][0-9]{8}$' THEN '+254' || substr(d, 2)
    WHEN d ~ '^[17][0-9]{8}$' THEN '+254' || d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(raw, '[^0-9]', '', 'g') AS d) x
$$;--> statement-breakpoint

CREATE TABLE "idempotency_keys" (
	"key" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "phone_canonical" text GENERATED ALWAYS AS (kenya_phone(phone)) STORED;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "phone_conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Store individuals' numbers in the CRM's usual 07…/01… form.
UPDATE "accounts" SET "phone" = '0' || substr("phone_canonical", 5)
 WHERE "kind"::text = 'INDIVIDUAL' AND "phone_canonical" IS NOT NULL AND "phone" <> '0' || substr("phone_canonical", 5);--> statement-breakpoint

-- Individuals that already share a number: the oldest keeps it; the others are flagged
-- for an Admin to resolve (nothing is deleted). Each is recorded in the audit log.
WITH ranked AS (
  SELECT "id", "phone_canonical",
         row_number() OVER (PARTITION BY "phone_canonical" ORDER BY "created_at", "id") AS n,
         first_value("id") OVER (PARTITION BY "phone_canonical" ORDER BY "created_at", "id") AS keeper
    FROM "accounts"
   WHERE "kind"::text = 'INDIVIDUAL' AND "phone_canonical" IS NOT NULL
), flagged AS (
  UPDATE "accounts" a SET "phone_conflict" = true
    FROM ranked r
   WHERE a."id" = r."id" AND r."n" > 1
  RETURNING a."id", r."keeper", r."phone_canonical"
)
INSERT INTO "audit_log" ("actor_id", "action", "entity", "entity_id", "detail")
SELECT NULL, 'account.phone_conflict', 'account', "id"::text,
       jsonb_build_object('sameNumberAs', "keeper", 'phone', "phone_canonical", 'by', 'migration 0008')
  FROM flagged;--> statement-breakpoint

CREATE UNIQUE INDEX "accounts_individual_phone_idx" ON "accounts" USING btree ("phone_canonical") WHERE kind = 'INDIVIDUAL' and phone_canonical is not null and not phone_conflict;--> statement-breakpoint

-- Activities: the opportunity must belong to the same account. Mismatches (from stale or
-- altered forms) lose the opportunity link, and are logged.
WITH bad AS (
  UPDATE "activities" a SET "opportunity_id" = NULL
    FROM "opportunities" o
   WHERE a."opportunity_id" = o."id" AND o."account_id" <> a."account_id"
  RETURNING a."id", a."account_id"
)
INSERT INTO "audit_log" ("actor_id", "action", "entity", "entity_id", "detail")
SELECT NULL, 'activity.opportunity_unlinked', 'activity', "id"::text, jsonb_build_object('accountId', "account_id", 'by', 'migration 0008')
  FROM bad;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_id_account_idx" ON "opportunities" USING btree ("id", "account_id");--> statement-breakpoint
-- Checked at the end of each statement, after the existing single-column key has set
-- opportunity_id to null when an opportunity is deleted.
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_same_account_fk"
  FOREIGN KEY ("opportunity_id", "account_id") REFERENCES "opportunities" ("id", "account_id");
