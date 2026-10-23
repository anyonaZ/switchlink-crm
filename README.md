# Switchlink CRM

Customer relationship management for Switchlink Africa's field sales teams.

© Anyonaz NewTech. All rights reserved. Proprietary software; see `LICENSE`.

---

## Overview

Switchlink CRM manages the full client lifecycle for four kinds of account:
schools, corporates, merchants and individuals. It is designed for use on
mobile phones in the field and is self-hosted on Switchlink's own server.

**Key capabilities**

- Account registration with GPS capture and automatic street-address lookup (Admins may add corporates and merchants from the office without a location)
- Sales pipeline per product: School Now Pay Later (SNPL), Salary Advance and Quick Finance (QF)
- Activity logging and scheduled follow-ups
- KYC document storage for merchants
- Admin verification of merchants and individuals before they become active
- Quick Finance tracking from Pesi account statements, including limits, draws and cycles
- A single disbursement ledger for all products, with full reversal history
- Shared corporates, where approved disbursements are split between BDOs
- Role-based reporting by person, BDO and team, with CSV export
- A leaderboard separating new business (newly closed accounts) from existing accounts, with conversion rates
- Weekly targets for BDOs and Agents, rolled up by BDO and team, with progress on every dashboard
- Automatic removal of individual accounts not activated within 30 days
- Bulk upload of merchant and individual accounts from Excel or CSV
- Installable as an app on phones (PWA), with an offline notice

**Technology**

Next.js 15, React 19, PostgreSQL 16, Drizzle ORM, Tailwind CSS, Argon2id,
Python 3 (`xlrd`), Leaflet and OpenStreetMap, Docker Compose and Caddy. All
components are free and open source, and no third-party backend services are
used.

---

## Roles and permissions

The reporting structure is **Admin → Team Leader → BDO → Agent**.

- Each Agent reports to one BDO.
- An Agent's work counts towards their BDO's figures, and a BDO's towards the team's.

| Capability | Agent | BDO | Team Leader | Admin |
|---|---|---|---|---|
| View and work on accounts | Own | Own and their Agents' | Team | All |
| View captured locations | — | — | Team | All |
| Verify merchants and individuals | — | — | — | ✓ |
| Bulk upload merchant and individual accounts | — | Assigned to themselves or their Agents | Assigned to their team's BDOs and Agents, or themselves | Assigned to anyone |
| Leaderboard | Their team | Their team | Their team | Everyone, plus a Teams board |
| Conversion rate | Own | Own and their Agents' | Team | All, by person and team |
| Weekly targets | Set own (required every week) | Set own (required every week); see their Agents' | See the team's, by BDO | See everyone's, by team |
| Add corporates and merchants without a GPS location, assigned to anyone (including themselves) | — | — | — | ✓ |
| Set QF limits | — | — | — | ✓ |
| Upload Pesi statements | — | — | — | ✓ |
| Record or reverse disbursements | — | — | — | ✓ |
| Reports | — | Own and their Agents' | Team, by BDO | All, by team and BDO |
| Add users | — | Agents under themselves | BDOs and Agents in their team | Anyone |
| Deactivate or reactivate users | — | Their Agents | BDOs and Agents in their team | Anyone except themselves |
| Reset passwords | — | — | BDOs and Agents in their team | Anyone |
| Move an Agent to another BDO | — | — | Within their team | ✓ |
| Change roles and teams | — | — | — | ✓ |
| Request a corporate share | — | Their own corporates | — | — |
| Approve a corporate share | — | — | For BDOs in their team | ✓ (always required) |
| End a corporate share | — | — | — | ✓ |

Every user can change their own name and password from **Profile**.

**Team changes:** when someone moves to another team (or an Agent to a BDO on
another team), their accounts move with them, and a BDO's Agents and their
accounts follow the BDO. Money already credited stays with the team it was
earned in.

All access rules are defined in `src/lib/permissions.ts` and covered by unit
tests.

---

## Business rules

### Account status

| Account type | Status flow | Requirement |
|---|---|---|
| Merchant | Ongoing engagement → Document collection → Pending verification → Active | The 4-digit Pesi account number before Document collection |
| Individual | Pending verification → Active | A phone number at registration |
| School, Corporate | Ongoing engagement → Active | — |

Any account can be marked Inactive.

### Verification of merchants and individuals

- **Merchants:** when an Agent, BDO or Team Leader sets a merchant to Active, it moves to **Pending verification** instead.
- **Individuals:** only a name and phone number are needed. A new individual registered by anyone other than an Admin starts in **Pending verification**.
- **The Admin's queue:** pending accounts are listed under **Accounts to verify** on the Admin dashboard, and on each account's page.
- **Verify:** the account becomes Active, with who verified it and when recorded.
- **Decline:** the account returns to its previous status. The reason is shown in its history and activity feed, so the agent can fix it and resubmit.
- **Admins** who set an account to Active, or who register an individual themselves, activate it directly.
- **Duplicate phones:** a phone number can belong to only one individual account.

### Pesi statements and Quick Finance

**Accepting a statement**
- The running balance of every line must reconcile; otherwise the whole statement is rejected.
- Lines already recorded are skipped, so overlapping statements can be uploaded safely.

**Counting draws**
- Each payment that takes the balance below zero is recorded as a QF draw for the amount below zero.
- Charges and fees are never counted as draws.
- A reversed payment cancels its draw, including when the reversal appears in a later statement than the payment. It is linked to that draw and never counted as a draw.
- Upload results list new draws and reversals separately. Only new lending that isn't reversed marks the Quick Finance opportunity Active.
- An upload is saved completely (lines, draws and its audit entry) or not at all.

**Cycles**
- QF cycles are each draw divided by the QF limit in force on the day of the draw.

### Disbursements

- **No edits:** ledger entries are never edited. A correction is recorded as a reversal entry.
- **Credit is fixed on the day:** each entry records the credited person, their BDO and their team at the time. Later reassignments don't change historical figures.
- **One reversal per entry:** enforced by the database, so a double tap or two Admins reversing at once can't reverse an entry twice.
- **Reversed entries don't count:** a reversed draw is excluded from draw counts and isn't an account's first disbursement.

### Shared corporates

BDOs who close a corporate together can share its disbursements.

1. **Request:** the BDO responsible for the corporate selects the other BDOs
   and sets each one's percentage. The percentages must total 100%.
2. **Approve:** the request must be approved by an Admin and by the Team
   Leader of each team involved. A single rejection declines the request.
   Pending requests appear under **Shared corporates** and on approvers'
   dashboards.
3. **Split:** once the share is approved, every disbursement recorded on the
   corporate is split automatically between the BDOs, to the cent. Each
   portion counts towards that BDO's figures and their team's.
4. **Reverse:** reversing a split disbursement reverses every portion.
5. **End:** an Admin can end a share. Disbursements recorded earlier are
   unaffected; later ones are credited to the account's own agent.

### New business and existing accounts

Disbursements are split into two groups, both on the **Leaderboard** and in **Reports**:

- **New business:** money disbursed to accounts whose first disbursement falls in the selected period, i.e. newly closed accounts.
- **Existing accounts:** money disbursed to accounts that were first disbursed before the period.

Each group is shown separately for **organisations** (schools and corporates:
SNPL and Salary Advance) and **merchants and individuals** (Quick Finance). A
reversed disbursement doesn't count as an account's first one.

**Leaderboard boards:**
- **BDOs:** each BDO's figures include their Agents' work.
- **Agents.**
- **Teams:** Admins only.

- **Team Leaders:** their own accounts.

**Ranking:** by new business, existing accounts, total, the number of
accounts closed, or conversion rate.

**Who sees what:** Admins see everyone; all other roles see their own team.

### Conversion rate

The conversion rate is the percentage of accounts **added in a period** that
have become **Active**. It is shown on every dashboard (this month) and on the
Leaderboard for each person and team (for the selected period), with the counts
behind it, e.g. `37.5% (3/8)`.

- An Agent's rate covers their own accounts; a BDO's includes their Agents'; a team's covers everyone on it.
- Individuals deleted for not being activated count as added but not converted.

### Individuals not activated within 30 days

An individual account that hasn't become Active within **30 days** of being
added is deleted automatically. This applies to every user's accounts.

- Anyone adding an individual (one at a time or by bulk upload) is told the deletion date, and the account's page shows it until the account is activated.
- Dashboards list individuals due to be deleted within the next 7 days.
- Accounts with any disbursement or Pesi statement line are never deleted.
- A record of each deletion is kept, so conversion rates still count it.
- The check runs shortly after the server starts and then every hour.

### Weekly targets

BDOs and Agents set targets for the week (Monday to Sunday, Nairobi time):
the number of **individuals**, **merchants** and **corporates** to close, and
the **disbursement value**.

- **Required:** until the week's targets are set, a BDO or Agent is taken to the Targets page whenever they open any other page.
- **Editing:** targets can be changed on the day they were set, and are locked after that.
- **Progress:** dashboards show progress against each target. An account counts as closed in the week it first became Active, for its current owner. Disbursed is the amount credited to the person that week.
- **Roll-up:** an Agent's targets and results add up into their BDO's, and every BDO's and Agent's into the team's.
- **Visibility:** BDOs see their Agents' targets; Team Leaders see each BDO (with their Agents) and the team total; Admins see every team. Anyone who hasn't set targets is flagged **Not set**. Previous weeks can be browsed.

### Bulk upload of merchants and individuals

Admins, Team Leaders and BDOs can add many accounts at once under **Bulk
upload**, from an Excel
(`.xlsx`) or CSV file. The **Template** button downloads the expected columns.
The file's column headings are recognised in common wordings.

**Columns:**
- **Required:** Type (Merchant or Individual), Name, and Phone for individuals.
- **Optional:** Email, Owner name, Business type, Pesi account no, KRA PIN, Registration no, Location and Assign to (an active user's email or full name).

**How the upload works:**
1. **Check file:** every row is validated and shown before anything is saved. Rows with problems are listed with the reason.
2. **Skipped rows:** a row is skipped if an individual has no phone, a Pesi number isn't 4 digits, the type is unknown, the person to assign to isn't found, or the account is already in the CRM (same name, Pesi number, or an individual's phone).
3. **Notes:** smaller problems, such as an invalid email, drop that field and add a note on the account.
4. **Confirm:** the checked rows are added together.

**What uploaded accounts look like:**
- Merchants start in Ongoing engagement.
- Individuals are Active if an Admin uploaded them. If a Team Leader or BDO uploaded them, they are Pending verification and appear in the Admin's queue, and are deleted if not activated within 30 days.
- "Assign to" follows the same rules as adding a single account: a BDO can assign to themselves or their Agents; a Team Leader to themselves or the BDOs and Agents on their team; an Admin to anyone. Rows assigned to someone else are skipped with the reason.
- Each account gets a Quick Finance opportunity.
- No GPS location is recorded.
- Uploading the same file again adds nothing new.

### Security

- **Passwords:** hashed with Argon2id. Users must change their password at first sign-in.
- **Lockout:** an account is locked for 15 minutes after 5 failed sign-in attempts.
- **Sessions:** stored server-side. Users are signed out after 60 minutes of inactivity, or after 7 days at most.
- **Unsaved forms:** a half-filled new-account form is kept only in the current browser tab, for the signed-in user, for up to 4 hours, and is wiped at sign-out. KRA PIN, registration number and date of birth are never kept.
- **Audit log:** sensitive actions (sign-ins, money, status changes, verifications and approvals) are recorded in `audit_log`.

---

## Deployment

### Requirements

- A Linux server with Docker and Docker Compose
- A domain name (for example `crm.switchlinkafrica.com`) pointing to the server's public IP address
- Ports 80 and 443 forwarded to the server

### Installation

```bash
git clone <repository> /opt/switchlink-crm
cd /opt/switchlink-crm
cp .env.example .env        # complete the settings below
docker compose up -d --build
docker compose run --rm tools npm run user:create-admin -- "Full Name" admin@switchlinkafrica.com
```

The final command prints a temporary password. Sign in at
`https://<CRM_DOMAIN>`, set a new password, then create teams and users
from **Teams** and **People**.

- **HTTPS:** certificates are issued and renewed automatically by Caddy.
- **Migrations:** database migrations run on every start.

### Configuration (`.env`)

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Database password. Use a long random value. |
| `CRM_DOMAIN` | Public domain name, e.g. `crm.switchlinkafrica.com`. |
| `APP_URL` | Public address, e.g. `https://crm.switchlinkafrica.com`. |
| `APP_TIMEZONE` | Business timezone for dates and reporting periods. Default `Africa/Nairobi`. |
| `GEOCODER` | `nominatim` (free, default), `google` (requires `GOOGLE_MAPS_API_KEY`) or `off`. |
| `GEOCODER_CONTACT_EMAIL` | Contact address sent to OpenStreetMap, as its usage policy requires. |
| `STORAGE_DIR` | Location of uploaded files. Set automatically in Docker. |
| `SECURE_COOKIES` | `true` behind HTTPS. Set automatically in Docker. |

### Importing a lead list

A corporate lead list can be loaded in one step. The list supplied by Lindsey
Erodanga's team is included as `data/corporates-lindsey-sharon.json` (80
corporates).

**Before you run it,** create both people in **People**:
- Lindsey Erodanga as a Team Leader on her team;
- Sharon Achola as a BDO.

**Then run:**

```bash
npm run import:corporates -- --dry-run     # preview, saves nothing
npm run import:corporates                  # add the corporates
# on the server: docker compose run --rm tools npm run import:corporates
```

**What it does:**
- **Ownership:** every corporate is owned by Sharon Achola. Sharon is placed on Lindsey Erodanga's team, reporting to her, so Lindsey sees and manages all of them.
- **Contact:** each corporate gets its contact person.
- **Pipeline:** each corporate gets a Salary Advance opportunity at the stage from the list. Hot lead → Interested, warm lead → Qualified, follow-up → Contacted, proposal sent → Proposal, blank → Prospect.
- **Notes:** anything that didn't fit a field, such as an incomplete email address or a phone number to check, is added as a note on the corporate.

Corporates that already exist (same name) are skipped, so running it twice is
safe. Use `--owner` and `--leader` (name or email) and `--file` to import
other lists in the same format.

### Operations

**Backups.** `scripts/backup.sh` saves the database and uploaded files to
`./backups` and keeps 30 days of history.
- Schedule it nightly with cron; the script header contains the cron line.
- Copy the backups to separate storage.
- Test a restore periodically.

**Updates.**

```bash
git pull
docker compose up -d --build
```

**Restore.**

```bash
docker compose exec -T db pg_restore -U crm -d crm --clean < backups/crm-<date>.dump
```

---

## Development

### Prerequisites

Node.js 22, PostgreSQL 16, Python 3 with `xlrd` (`pip install xlrd`).

### Setup

```bash
# One-time database setup
sudo -u postgres psql -c "CREATE ROLE crm LOGIN PASSWORD 'crm';" -c "CREATE DATABASE crm OWNER crm;"

npm install
cp .env.example .env              # set DATABASE_URL
npm run db:migrate
npm run db:seed -- "Full Name"    # creates the initial Admin account
npm run dev                       # http://localhost:3000
```

`npm run db:seed` creates a single Admin account:

- **Login:** email `admin@test.com`, password `Switchlink2026!`. The password must be changed at first sign-in.
- **Different email:** pass it as the second argument: `npm run db:seed -- "Full Name" you@example.com`.
- **Running it again:** if the account already exists, the command makes no changes.
- **Production:** use `user:create-admin`, which issues a random temporary password.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests |
| `npm run test:db` | Database tests (ledger, statements, team moves, migrations) on a temporary database; needs PostgreSQL and `pip install xlrd xlwt` |
| `npm run typecheck` | TypeScript checks |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:generate -- --name <change>` | Generate a migration after editing the schema |
| `npm run db:seed` | Create the initial Admin account |
| `npm run user:create-admin -- "Name" email` | Create an Admin with a random temporary password |
| `npm run import:corporates` | Import a corporate lead list (see Importing a lead list) |

### Database changes

1. Edit `src/lib/db/schema.ts`.
2. Generate a migration with `npm run db:generate -- --name <change>`.
3. Commit the generated SQL in `drizzle/`.

Existing migrations must never be edited.

### Project structure

| Path | Contents |
|---|---|
| `src/app/` | Pages and API routes |
| `src/components/` | Shared interface components |
| `src/lib/permissions.ts` | Access rules |
| `src/lib/actions/` | Server actions (accounts, CRM, money, statements, people, sharing, authentication) |
| `src/lib/db/schema.ts` | Database schema |
| `src/lib/reports.ts` | Reporting queries |
| `src/lib/targets.ts`, `src/lib/targets-data.ts` | Weekly target rules and progress queries |
| `src/lib/retention.ts` | Automatic removal of individuals not activated in time |
| `src/lib/statements/` | Statement analysis and import |
| `tools/parse_statement.py` | Pesi statement reader |
| `drizzle/` | Database migrations |
| `scripts/` | Migration, seeding, admin creation and backup scripts |
| `tests/` | Unit tests |

### Tests

```bash
npm test
```

Two statement tests use real Pesi statements, which are client data and
therefore not stored in the repository. To run them, set `STATEMENT_DIR` to a
folder containing the statement files. Without it, those two tests are
skipped.
