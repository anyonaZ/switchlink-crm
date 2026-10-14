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
docker compose run --rm tools npm run user:create-admin -- "Your Name" you@switchlinkafrica.com
```

The last command prints a random temporary password (safer than the fixed
one `npm run db:seed` uses, so use this on the real server). Sign in at
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
npm run db:seed -- "Your Name"    # creates the Admin login only (no demo data)
npm run dev
npm test                          # unit tests
```

The seed creates one Admin, `admin@test.com`, password `Switchlink2026!`,
and nothing else. You must set your own password at first sign-in. The name
defaults to "Administrator" unless you pass one; anyone can change their own
name later from **Profile**, and Admins can rename others from **People**.
Pass an email as the second argument to use a different login:
`npm run db:seed -- "Your Name" you@example.com`. Running it twice does
nothing. Add teams, Team Leaders, BDOs and Agents from **Teams** and **People**.

To start again from an empty database: `dropdb crm && createdb -O crm crm &&
npm run db:migrate && npm run db:seed` (on the server: `docker compose down -v`,
which also deletes uploaded files).

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
| Shared corporates | `src/lib/actions/shares.ts`, `src/lib/shares.ts` | See "Shared corporates" below. |
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
| Ask to share a corporate | — | own corporates (and their Agents') | — | — |
| Approve a sharing request | — | — | for BDOs on own team | yes (always needed) |
| End an approved share | — | — | — | yes |
| Reports | — | own + their Agents | team, by BDO | all, by team and BDO |
| Add people | — | Agents under themselves | BDOs and Agents on own team | anyone |
| Deactivate / reactivate | — | their own Agents | BDOs and Agents on own team | anyone but themselves |
| Reset passwords | — | — (ask the Team Leader) | BDOs and Agents on own team | anyone |
| Move an Agent to another BDO | — | — | within own team | yes |
| Change roles and teams | — | — | — | yes |

### Shared corporates

BDOs who close a corporate together can split its disbursements.

1. The BDO responsible for the corporate (its owner, or the BDO of the Agent
   who owns it) opens it and taps **Share with other BDOs**, picks the other
   BDOs and sets each one's percentage (equal by default, must total 100%).
2. The request goes to **Shared corporates** in the menu of every Admin and of
   the Team Leader of each team the BDOs are on. Leaders and Admins also see
   a banner on their home page. The request needs **all** of them: one Admin
   plus each team's Team Leader. Any one of them can turn it down. An Admin
   stands in for a team that has no active Team Leader.
3. Once approved, every disbursement an Admin records on that corporate is
   split automatically into one ledger row per BDO, to the cent (leftover
   cents go to the largest remainder). Each row carries the BDO and their team,
   so reports, the BDO roll-up and team totals all pick up each BDO's share.
   If the corporate is owned by an Agent, their BDO's slice is credited to the
   Agent, as with any other account.
4. Partner BDOs can see and work the corporate while it's shared, but can't
   reassign it. Reversing one slice reverses the whole split.
5. An Admin can **End share**. Disbursements recorded earlier stay split; new
   ones go to the account's own agent again.

Every step is in the audit log (`share.request`, `share.approve`,
`share.reject`, `share.cancel`, `share.end`, `disbursement.record_split`).

### Authorship signature

Switchlink CRM carries the signature of Anyonaz NewTech
(`SLCRM-ANZ-2026-22618b25b6481b46c0702c9c`, defined in `src/lib/signature.ts`)
in several independent places:

- the footer of the sign-in page, the sidebar and the More page;
- an invisible zero-width watermark inside that footer text and the CSV
  report title, which survives copy-paste (`readMark()` decodes it);
- HTTP headers (`X-Software-Author`, `X-Software-Signature`), HTML metadata
  (`author`, `generator`, `copyright`), `/humans.txt`, `/api/signature` and
  a console message in the browser;
- the database: a comment on every table and a `switchlink_crm_signature()`
  function, both kept by `pg_dump` backups;
- `LICENSE`, `package.json`, the statement reader, the service worker and the
  Dockerfile.

When the server starts it checks these copies against each other. If one has
been changed or removed, signed-in users see a red notice and the event is
written to the audit log (`signature.mismatch`). The check never stops the
CRM from working.

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
