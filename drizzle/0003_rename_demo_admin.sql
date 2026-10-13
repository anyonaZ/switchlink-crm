-- The demo Admin login is now admin@test.com (was daniel@test.com).
-- Renames it on databases seeded before the change. Does nothing anywhere else.
UPDATE "users" SET "email" = 'admin@test.com'
 WHERE lower("email") = 'daniel@test.com'
   AND "role" = 'ADMIN'
   AND NOT EXISTS (SELECT 1 FROM "users" WHERE lower("email") = 'admin@test.com');
