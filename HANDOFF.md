# Switchlink CRM — handoff

Use this to continue work in a new chat. Attach this file **and** the latest
project zip, then paste the prompt in section 9.

Last updated: 14 October 2026.

---

## 1. What this is

A self-hosted, phone-first CRM for **Switchlink Africa**'s field sales team,
built by **Anyonaz NewTech** (proprietary; see `LICENSE`). It tracks clients
(schools, corporates, merchants, individuals), the sales pipeline, follow-ups,
captured GPS locations, and money: Quick Finance (QF) overdraft draws read from
Pesi statements, plus SNPL and Salary Advance disbursements.

**Status:** feature-complete for a first release and **not deployed yet**. It
will run on a server in the Switchlink office (Docker + Caddy for HTTPS).

**The owner's wishes:**
- Everything free and open source for now; premium features later.
- Plain-language UI for field staff on phones.

## 2. Stack

Next.js 15 (App Router, server actions) · React 19 · PostgreSQL 16 · Drizzle
ORM · Tailwind 3 · Argon2id passwords · Python 3 + `xlrd` for reading `.xls`
statements · Leaflet + OpenStreetMap maps · Nominatim reverse geocoding ·
Docker Compose + Caddy. No Supabase and no third-party backend.

## 3. People and permissions

The reporting line is **Admin → Team Leader (one team) → BDO → Agent**.

- Each Agent reports to one BDO (`users.reports_to`).
- An Agent's work rolls up into their BDO's figures, then into the team's.
- QF limits, statement uploads and disbursements are **Admin only**.

Every access rule is in `src/lib/permissions.ts`, written as pure functions and
unit-tested. List queries go through `accountScope()`, `userScope()` and
`disbursementScope()`. The README has the full "who may do what" table.

## 4. Map of the code

| Area | Files |
|---|---|
| Schema / migrations | `src/lib/db/schema.ts`, `drizzle/0000`–`0004` (never edit an old migration; generate with `npm run db:generate -- --name x`) |
| Rules | `src/lib/permissions.ts` |
| Auth & sessions | `src/lib/auth/*`, `src/lib/actions/auth.ts`, `src/middleware.ts` |
| Accounts | `src/lib/actions/accounts.ts`, `src/app/(app)/accounts/**` (account page tabs live in `[id]/tabs.tsx`) |
| Pipeline / activity / contacts / notes | `src/lib/actions/crm.ts` |
| Money: QF limits, disbursements, KYC uploads | `src/lib/actions/money.ts` |
| Statements | `tools/parse_statement.py`, `src/lib/statements/analyze.ts` (pure, tested), `src/lib/statements/ingest.ts` |
| Reports | `src/lib/reports.ts` (SQL sums), `src/app/(app)/reports`, `src/app/api/reports/csv` |
| Corporate sharing | `src/lib/actions/shares.ts`, `src/lib/shares.ts`, `src/components/ShareCard.tsx`, `ShareRequestForm.tsx`, `src/app/(app)/shares` |
| Signature | `src/lib/signature.ts`, `src/lib/signature-check.ts`, `src/components/Signature*.tsx`, `drizzle/0004_authorship_signature.sql` |
| People / teams | `src/lib/actions/people.ts`, `src/app/(app)/users`, `teams` |
| Profile (own name) | `src/app/(app)/profile`, `updateMyName` in `actions/auth.ts` |
| Scripts | `scripts/seed.ts` (Admin only), `scripts/create-admin.ts` (random password), `scripts/migrate.ts`, `scripts/backup.sh` |
| Tests | `tests/permissions.test.ts`, `tests/sharing.test.ts`, `tests/signature.test.ts`, `tests/statements.test.ts` (21 pass; 2 statement tests skip without the real `.xls` files in `STATEMENT_DIR`) |

## 5. What was done in the last two sessions

### Session of 13 October 2026

1. **Corporate sharing.** BDOs who close a corporate together can split its
   disbursements.
   - **Requesting:** the corporate's BDO (its owner, or the BDO of the Agent who
     owns it) requests the share and sets the percentages. These must total
     100%, with up to 2 decimals and 2–6 BDOs.
   - **Approving:** the request needs an Admin plus the Team Leader of every
     team involved. Any one of them can reject it. An Admin stands in for a team
     that has no active Team Leader.
   - **Splitting:** while a share is APPROVED, each disbursement recorded on the
     corporate becomes one ledger row per BDO, split to the cent (leftover cents
     go to the largest remainders). The rows share a `split_group_id`, and
     reversing one reverses them all.
   - **Agent-owned corporates:** the owning BDO's slice is credited to the Agent.
   - **Access:** partner BDOs can see and edit the account but can't reassign it.
   - **Ending:** an Admin can end a share. Splitting is not retroactive.
   - **Where it shows:** the Shared corporates page and a dashboard banner for
     approvers. There are no email/SMS notifications.
   - **Tables:** `account_shares`, `account_share_members` and
     `account_share_approvals`; new columns `disbursements.share_id` and
     `disbursements.split_group_id`.
   - **Design choice:** partner BDOs don't have to co-sign. One BDO requests for
     the group, and all members can see and withdraw the request.
2. **Admin login renamed to `admin@test.com`.** Migration 0003 renames an old
   `daniel@test.com` admin.
3. **Authorship signature "Anyonaz NewTech"** (`SLCRM-ANZ-2026-22618b25b6481b46c0702c9c`).
   - **Where it lives:** visible footers, an invisible zero-width watermark in
     footer text and CSV titles (`readMark()` decodes it), HTTP headers, HTML
     meta, `/humans.txt`, `/api/signature`, a browser console banner, a comment
     on every DB table, a `switchlink_crm_signature()` SQL function, and the
     LICENSE, `package.json`, the parser, the service worker and the Dockerfile.
   - **Tamper check:** on server start the copies are cross-checked. On a
     mismatch, users see a red banner and an audit row `signature.mismatch` is
     written. It deliberately **never** stops the app.
   - **Limits:** it can't be made impossible to remove for someone with the
     source; it makes removal tedious and leaves traces.

### Session of 14 October 2026

4. **Demo data removed.**
   - `npm run db:seed` now creates only the Admin. The defaults are name
     "Administrator", email `admin@test.com` and password `Switchlink2026!`.
     The password must be changed at first sign-in.
   - Optional arguments: `npm run db:seed -- "Name" email`. The script does
     nothing if that email already exists.
   - The old phone end-to-end test (`tests/e2e/`) depended on the demo data and
     was removed.
5. **Name is editable.**
   - A new **Profile** page lets anyone change their own name. It's linked from
     the sidebar and the More page.
   - Admins can still rename others under People → Role & team.

All checks pass: typecheck, unit tests and production build. I also checked in a
browser that every page loads on an empty database with only the Admin, and
that the forced password change and rename work.

## 6. How to run

**Laptop:** Node 22, Postgres 16, `pip install xlrd`.

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and DATA_ENCRYPTION_KEY (openssl rand -base64 32)
npm run db:migrate
npm run db:seed -- "Your Name"
npm run dev
```

**Office server:** fill in `.env`, then run `docker compose up -d --build`
(migrations run automatically). Then create the real admin with
`docker compose run --rm tools npm run user:create-admin -- "Name" email`,
which prints a random temporary password. See README → Deployment.

## 7. Suggested before deployment

These are not done yet, roughly in priority order.

1. **Don't ship the known admin password.** On the server, use
   `user:create-admin` (random password) instead of `db:seed`, or seed and sign
   in right away to change it. Use a real email as the login.
2. **Keep `DATA_ENCRYPTION_KEY` safe.** Store it off the server (password
   manager plus a printed copy). If it's lost, stored national ID numbers can
   never be read again.
3. **Backups off the machine.** Schedule `scripts/backup.sh` nightly, copy
   `./backups` to another disk or cloud storage, and **test a restore once**.
4. **Server hardening.**
   - Open only ports 80/443 (and SSH by key only).
   - Turn on automatic security updates and put the server on a UPS.
   - Set Docker log size limits (`logging: max-size`) so logs can't fill the disk.
   - If the office IP changes, set up dynamic DNS.
5. **Office internet is a single point of failure.** Field staff can't reach
   the CRM if the office line or power goes down. Consider a cheap VPS, or at
   least a backup internet line.
6. **Login throttle and shared IPs.** The per-IP sign-in limit (30 attempts per
   10 min) is kept in memory. Staff on the same office Wi-Fi or mobile-carrier
   NAT share one IP, so one person mistyping could slow down sign-in for
   others. Consider keying the limit on email + IP.
7. **Notifications.** Nothing tells a Team Leader or Admin that a sharing
   request is waiting, or an agent that a follow-up is due, unless they open
   the app. Options: email via SMTP, SMS/WhatsApp (e.g. Africa's Talking —
   paid), or web push (free).
8. **Bulk import of existing clients** from spreadsheets (CSV import), so day 1
   doesn't mean re-typing everything. Remember that new accounts need GPS at
   registration, so imported ones need a rule.
9. **Kenya Data Protection Act 2019.** The CRM stores ID numbers, phone numbers
   and GPS. Check whether Switchlink must register with the ODPC, and add a
   privacy notice, consent wording and a retention/deletion policy. (This is
   not legal advice; confirm with their legal or compliance person.)
10. **Audit log viewer.** Everything is logged in `audit_log`, but there's no
    screen to read it yet. A simple Admin page would help (also for
    `signature.mismatch`).
11. **Monitoring.** Add a `/api/health` endpoint plus a free uptime checker
    (e.g. Uptime Kuma on another machine) that alerts when the CRM is down.
12. **Real-world test run.** Pilot with 2–3 BDOs on their own phones and real
    Pesi statements for a week. Rebuild an end-to-end test with its own test
    data (the old one used the demo seed).
13. **Set `GEOCODER_CONTACT_EMAIL`** to a real Switchlink address. This is a
    Nominatim usage-policy requirement.
14. **Short user guide or training session** for each role (Agent, BDO, Team
    Leader, Admin).

## 8. Things to know / gotchas

- `next start` warns because the build uses `output: "standalone"`. Docker runs
  `node server.js`, which is correct. The warning only matters locally.
- Server actions passed into client components must be bound **on the
  server**. Binding in the client broke the success toast; see how
  `ShareRequestForm` receives `action`.
- `TRUNCATE account_shares CASCADE` also wipes `disbursements` (foreign key).
  Use `DELETE` instead.
- Africa/Nairobi time everywhere (`src/lib/format.ts`, `timezone.ts`).
- Money is `numeric(14,2)`, summed in SQL, never in the browser.
- The README is the professional, client-facing document. It deliberately
  doesn't mention the authorship signature; that is documented only here.

## 9. Prompt to start the next chat

> I'm continuing work on the Switchlink CRM (Next.js + PostgreSQL, built by
> Anyonaz NewTech for Switchlink Africa). The attached HANDOFF.md explains the
> project, what's done and what's left; the attached zip is the latest code.
> Read HANDOFF.md first, then inspect the code before changing anything.
> Today I want to: <what you want next, e.g. "add an audit log viewer" or
> "prepare it for deployment on the office server">.
