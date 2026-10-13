-- Two merchants the phone test uploads statements to. Run after npm run db:seed.
insert into accounts (kind, name, owner_id, team_id, status, pesi_account_no, created_by)
select 'MERCHANT', 'Test Merchant Paybill 3887', u.id, u.team_id, 'ACTIVE', '3887', u.id from users u where u.email='zaddock@test.com';
insert into accounts (kind, name, owner_id, team_id, status, pesi_account_no, created_by)
select 'MERCHANT', 'Test Merchant Header', u.id, u.team_id, 'ACTIVE', '1088', u.id from users u where u.email='lindsey@test.com';
insert into qf_limits (account_id, amount, effective_from, set_by)
select a.id, 30000, now() - interval '200 days', (select id from users where email='admin@test.com') from accounts a where a.name='Test Merchant Paybill 3887';
insert into opportunities (account_id, product, stage, owner_id) select id, 'QUICK_FINANCE', 'MOU', owner_id from accounts where name like 'Test Merchant%';
