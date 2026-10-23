-- Data integrity: accounts on their owner's team, one reversal per ledger entry,
-- statement reversals linked to their draw, and upload statistics that count
-- draws and reversals separately.
-- Existing data is repaired first so the new constraints can be added safely.

ALTER TABLE "statement_uploads" ADD COLUMN "reversals_new" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_uploads" ADD COLUMN "reversed_amount_new" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint

-- 0. Team scope: an Agent belongs to their BDO's team, and an account to its owner's team
--    (earlier, moving someone could leave their accounts on the old team). Admin-owned
--    accounts and owners without a team are left as they are.
UPDATE "users" a SET "team_id" = b."team_id"
  FROM "users" b
 WHERE a."role"::text = 'AGENT' AND a."reports_to" = b."id" AND b."team_id" IS NOT NULL
   AND a."team_id" IS DISTINCT FROM b."team_id";--> statement-breakpoint
WITH moved AS (
  UPDATE "accounts" ac SET "team_id" = u."team_id"
    FROM "users" u, (SELECT "id", "team_id" AS "old_team" FROM "accounts") old
   WHERE ac."owner_id" = u."id" AND old."id" = ac."id"
     AND u."role"::text IN ('AGENT', 'BDO', 'TEAM_LEADER') AND u."team_id" IS NOT NULL
     AND ac."team_id" IS DISTINCT FROM u."team_id"
  RETURNING ac."id", old."old_team", ac."team_id"
)
INSERT INTO "audit_log" ("actor_id", "action", "entity", "entity_id", "detail")
SELECT NULL, 'account.team_repaired', 'account', "id"::text, jsonb_build_object('fromTeam', "old_team", 'toTeam', "team_id", 'by', 'migration 0007')
  FROM moved;--> statement-breakpoint

-- 1. A reversal pointing at an entry that no longer exists can't keep the link.
UPDATE "disbursements" r SET "reverses_id" = NULL
 WHERE r."reverses_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "disbursements" o WHERE o."id" = r."reverses_id");--> statement-breakpoint

-- 2. Link statement reversals that came in a later upload than their draw (same account,
--    same statement serial). Pairs are matched one-to-one in date order.
WITH unlinked AS (
  SELECT r."id", r."account_id", rl."serial_id",
         row_number() OVER (PARTITION BY r."account_id", rl."serial_id" ORDER BY r."disbursed_at", r."created_at", r."id") AS n
    FROM "disbursements" r
    JOIN "statement_lines" rl ON rl."id" = r."statement_line_id"
   WHERE r."source" = 'STATEMENT' AND r."amount" < 0 AND r."reverses_id" IS NULL
), open_draws AS (
  SELECT o."id", o."account_id", ol."serial_id",
         row_number() OVER (PARTITION BY o."account_id", ol."serial_id" ORDER BY o."disbursed_at", o."created_at", o."id") AS n
    FROM "disbursements" o
    JOIN "statement_lines" ol ON ol."id" = o."statement_line_id"
   WHERE o."source" = 'STATEMENT' AND o."amount" > 0
     AND NOT EXISTS (SELECT 1 FROM "disbursements" x WHERE x."reverses_id" = o."id")
)
UPDATE "disbursements" d SET "reverses_id" = od."id"
  FROM unlinked u
  JOIN open_draws od ON od."account_id" = u."account_id" AND od."serial_id" = u."serial_id" AND od."n" = u."n"
 WHERE d."id" = u."id";--> statement-breakpoint

-- 3. If an entry was reversed more than once (two reversals at the same moment), keep the
--    first reversal and remove the extra ones, recording each removal in the audit log.
WITH dupes AS (
  SELECT "id", "reverses_id", "amount", "account_id",
         row_number() OVER (PARTITION BY "reverses_id" ORDER BY "created_at", "id") AS n
    FROM "disbursements"
   WHERE "reverses_id" IS NOT NULL
), logged AS (
  INSERT INTO "audit_log" ("actor_id", "action", "entity", "entity_id", "detail")
  SELECT NULL, 'disbursement.duplicate_reversal_removed', 'disbursement', d."id"::text,
         jsonb_build_object('reverses', d."reverses_id", 'amount', d."amount", 'accountId', d."account_id", 'by', 'migration 0007')
    FROM dupes d WHERE d."n" > 1
  RETURNING "entity_id"
)
DELETE FROM "disbursements" WHERE "id"::text IN (SELECT "entity_id" FROM logged);--> statement-breakpoint

-- 4. Recount each accepted upload's draws and reversals from the ledger (reversals used to be
--    counted as draws).
UPDATE "statement_uploads" u SET
  "draws_new" = s."draws", "draws_amount_new" = s."drawn",
  "reversals_new" = s."reversals", "reversed_amount_new" = s."reversed"
  FROM (
    SELECT l."upload_id",
           count(*) FILTER (WHERE d."amount" > 0) AS "draws",
           coalesce(sum(d."amount") FILTER (WHERE d."amount" > 0), 0) AS "drawn",
           count(*) FILTER (WHERE d."amount" < 0) AS "reversals",
           coalesce(-sum(d."amount") FILTER (WHERE d."amount" < 0), 0) AS "reversed"
      FROM "disbursements" d
      JOIN "statement_lines" l ON l."id" = d."statement_line_id"
     GROUP BY l."upload_id"
  ) s
 WHERE u."id" = s."upload_id";--> statement-breakpoint

ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_reverses_id_disbursements_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."disbursements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disbursements_reverses_idx" ON "disbursements" USING btree ("reverses_id");
