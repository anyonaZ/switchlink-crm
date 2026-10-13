# Switchlink CRM v4

**© Anyonaz NewTech. All rights reserved.** Proprietary; see `LICENSE`.

Self-hosted CRM for Switchlink Africa field teams: corporates, schools,
merchants and individuals, with Quick Finance (overdraft) tracking from Pesi
statements. Built for phones first.

Everything it runs on is free and open source: Next.js, PostgreSQL, Drizzle
ORM, Caddy, Python `xlrd`, Leaflet and OpenStreetMap. There is no Supabase and
no other third-party backend. Logins, sessions and data all live on Switchlink's
own server.

## 1. Run it on the office server

You need a Linux machine with Docker, a domain name (for example
`crm.switchlinkafrica.com`) pointing at the office's public IP, and ports 80
and 443 forwarded to the machine.

```bash
git clone <repo> /opt/switchlink-crm && cd /opt/switchlink-crm
cp .env.example .env
# Fill in .env:
#   POSTGRES_PASSWORD       a long random password
#   DATA_ENCRYPTION_KEY     openssl rand -base64 32   (keep a copy somewhere safe:
#                           without it, stored ID numbers can't be read)
#   CRM_DOMAIN              crm.switchlinkafrica.com
#   GEOCODER_CONTACT_EMAIL  an address OpenStreetMap can contact
docker compose up -d --build
docker compose run --rm tools npm run user:create-admin -- "Daniel Eshikumo" daniel@switchlinkafrica.com
```

The last command prints a temporary password. Sign in at
`https://<CRM_DOMAIN>`, set your own password, then add teams and people from
**People** and **Teams**.

Caddy fetches and renews the HTTPS certificate on its own. Migrations run
automatically on every `docker compose up`.

**Backups.** `scripts/backup.sh` dumps the database and uploaded files into
`./backups` and keeps 30 days. Schedule it nightly with cron (the script's
header shows the line), and copy `./backups` to a second disk or machine.

**Updating.** Run `git pull && docker compose up -d --build`.

## 2. Develop on a laptop

You need Node 22, PostgreSQL 16 and Python 3 with `xlrd` (`pip install xlrd`).

Create the database login once (this fixes `role "crm" does not exist`):

```bash
sudo -u postgres psql -c "CREATE ROLE crm LOGIN PASSWORD 'crm';" -c "CREATE DATABASE crm OWNER crm;"
```

```bash
npm install
cp .env.example .env              # point DATABASE_URL at your local Postgres
npm run db:migrate
npm run db:seed                   # demo data; password Switchlink2026!
npm run dev
npm test                          # unit tests
```

Demo logins after seeding: `daniel@test.com` (Admin), `joy@test.com` (Team
Leader), `zaddock@test.com` (BDO, Joy's team) and `brian@test.com` (Agent
under Zaddock).

To change the schema, edit `src/lib/db/schema.ts` and run
`npm run db:generate -- --name what_changed`. Commit the generated SQL file in
`drizzle/`, and never edit an old migration.

## 3. How it works

| Area | Where | Notes |
|---|---|---|
| Access rules | `src/lib/permissions.ts` | Every rule is in this one file and unit-tested in `tests/permissions.test.ts`. List queries go through `accountScope()`/`userScope()` so a page can't forget the team filter. |
| Sign-in | `src/lib/auth/` | Argon2id password hashes. Sessions are kept in the database, and the cookie holds a random token whose SHA-256 is the row id. Signs out after 60 idle minutes or 7 days. Locks an account for 15 minutes after 5 wrong passwords. Forces a password change on first sign-in. |
| Accounts | `src/lib/actions/accounts.ts` | Four kinds: School, Corporate, Merchant, Individual. GPS capture is required at registration. National ID numbers are encrypted with AES-256-GCM, and only Admins see them in full; each view is logged. |
| Status rules | `statusChangeProblem()` | Merchant: Ongoing engagement → Document collection (needs the 4-digit Pesi account number) → Active. Individual: Ongoing engagement → Active (needs an ID number). |
| Street addresses | `src/lib/geo/` | OpenStreetMap Nominatim, free, max 1 lookup per second, cached. Set `GEOCODER=google` and `GOOGLE_MAPS_API_KEY` to switch to Google later. Failed lookups retry every 5 minutes. After a failure, lookups pause for 2 minutes so a dead connection never slows the app. |
| Statements | `tools/parse_statement.py`, `src/lib/statements/` | Every line's running balance must add up, or the whole upload is rejected. Lines are matched on serial ID + type + amounts, so re-uploads only add what's new. Every payment that takes the balance below zero is a QF disbursement for the part below zero. Charges never count. Reversals cancel their draw. |
| Disbursements | `disbursements` table | One ledger for SNPL, Salary Advance and QF. Entries are never edited, only reversed. Each entry stores the credited person *and their BDO and team on the day*, so moving an Agent to another BDO later doesn't rewrite past figures. |
| Reports | `src/lib/reports.ts` | Sums are done in SQL. QF cycles = each draw ÷ the QF limit in force on its day. Times in Africa/Nairobi. |

### Who may do what

The reporting line is **Team Leader → BDO → Agent**. Each Agent reports to one
BDO (`users.reports_to`) and joins that BDO's team. An Agent's accounts,
activity and disbursements are credited to the Agent and roll up into their
BDO's figures, then the team's.

| | Agent | BDO | Team Leader | Admin |
|---|---|---|---|---|
| See accounts | own | own + their Agents' | team's | all |
| Register accounts, log activity, pipeline | own | own + their Agents' | team's | all |
| See captured locations | — | — | team's | all |
| Set / change a QF limit | — | — | — | yes |
| Upload statements | — | — | — | yes |
| Record or reverse a disbursement | — | — | — | yes |
| Reports | — | own + their Agents | team, by BDO | all, by team and BDO |
| Add people | — | Agents under themselves | BDOs and Agents on own team | anyone |
| Deactivate / reactivate | — | their own Agents | BDOs and Agents on own team | anyone but themselves |
| Reset passwords | — | — (ask the Team Leader) | BDOs and Agents on own team | anyone |
| Move an Agent to another BDO | — | — | within own team | yes |
| Change roles and teams | — | — | — | yes |

## 4. What changed from v3 (Supabase)

- **Removed Supabase entirely.** This also removes the two v3 holes where any
  user could make themselves Admin (an editable own `role` column, and a
  sign-up trigger that trusted the requested role).
- **The idle timeout now works.** In v3 the activity cookie expired at the same
  moment as the timeout, so nobody was ever signed out.
- **Follow-up times and all dates use Nairobi time.** v3 stored follow-ups 3
  hours late on UTC servers.
- **`next build` passes.** v3 had 14 type errors that stopped the build.
- **Every form shows the result.** v3 silently ignored many save errors.
- **Totals no longer go wrong as data grows.** v3 added them up in the browser
  and hit Supabase's 1,000-row cap.
- **Mobile layout rebuilt.** Card lists instead of wide tables, five-slot
  bottom bar, bottom-sheet forms, 16 px inputs, no splash screen, installable
  app with an offline page.

There was no live v3 data, so there's no migration from Supabase.
