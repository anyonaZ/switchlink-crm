# Switchlink CRM

Customer relationship management for Switchlink Africa's field sales teams.

© Anyonaz NewTech. All rights reserved. Proprietary software; see `LICENSE`.

---

## Overview

Switchlink CRM manages the full client lifecycle for four kinds of account:
schools, corporates, merchants and individuals. It is designed for use on
mobile phones in the field and is self-hosted on Switchlink's own server.

**Key capabilities**

- Account registration with mandatory GPS capture and automatic street-address lookup
- Sales pipeline per product: School Now Pay Later (SNPL), Salary Advance and Quick Finance (QF)
- Activity logging and scheduled follow-ups
- KYC document storage and encrypted national ID numbers
- Quick Finance tracking from Pesi account statements, including limits, draws and cycles
- A single disbursement ledger for all products, with full reversal history
- Shared corporates, where approved disbursements are split between BDOs
- Role-based reporting by person, BDO and team, with CSV export
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

All access rules are defined in `src/lib/permissions.ts` and covered by unit
tests.

---

## Business rules

### Account status

| Account type | Status flow | Requirement |
|---|---|---|
| Merchant | Ongoing engagement → Document collection → Active | The 4-digit Pesi account number before Document collection |
| Individual | Ongoing engagement → Active | A national ID number before Active |
| School, Corporate | Ongoing engagement → Active | — |

Any account can be marked Inactive.

### Pesi statements and Quick Finance

**Accepting a statement**
- The running balance of every line must reconcile; otherwise the whole statement is rejected.
- Lines already recorded are skipped, so overlapping statements can be uploaded safely.

**Counting draws**
- Each payment that takes the balance below zero is recorded as a QF draw for the amount below zero.
- Charges and fees are never counted as draws.
- A reversed payment cancels its draw.

**Cycles**
- QF cycles are each draw divided by the QF limit in force on the day of the draw.

### Disbursements

- **No edits:** ledger entries are never edited. A correction is recorded as a reversal entry.
- **Credit is fixed on the day:** each entry records the credited person, their BDO and their team at the time. Later reassignments don't change historical figures.

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

### Security

- **Passwords:** hashed with Argon2id. Users must change their password at first sign-in.
- **Lockout:** an account is locked for 15 minutes after 5 failed sign-in attempts.
- **Sessions:** stored server-side. Users are signed out after 60 minutes of inactivity, or after 7 days at most.
- **National ID numbers:** encrypted with AES-256-GCM. Only Admins can view them in full, and each view is logged.
- **Audit log:** sensitive actions (sign-ins, money, status changes and approvals) are recorded in `audit_log`.

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
| `DATA_ENCRYPTION_KEY` | 32-byte key for encrypting ID numbers. Generate with `openssl rand -base64 32`. **Store a copy securely off the server; if it is lost, encrypted ID numbers can't be recovered.** |
| `CRM_DOMAIN` | Public domain name, e.g. `crm.switchlinkafrica.com`. |
| `APP_URL` | Public address, e.g. `https://crm.switchlinkafrica.com`. |
| `APP_TIMEZONE` | Business timezone for dates and reporting periods. Default `Africa/Nairobi`. |
| `GEOCODER` | `nominatim` (free, default), `google` (requires `GOOGLE_MAPS_API_KEY`) or `off`. |
| `GEOCODER_CONTACT_EMAIL` | Contact address sent to OpenStreetMap, as its usage policy requires. |
| `STORAGE_DIR` | Location of uploaded files. Set automatically in Docker. |
| `SECURE_COOKIES` | `true` behind HTTPS. Set automatically in Docker. |

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
cp .env.example .env              # set DATABASE_URL and DATA_ENCRYPTION_KEY
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
| `npm run typecheck` | TypeScript checks |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:generate -- --name <change>` | Generate a migration after editing the schema |
| `npm run db:seed` | Create the initial Admin account |
| `npm run user:create-admin -- "Name" email` | Create an Admin with a random temporary password |

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
