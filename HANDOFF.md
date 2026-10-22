# Switchlink CRM — handoff

Use this to continue work in a new chat. Attach this file **and** the latest
project zip, then paste the prompt in section 9.

Last updated: 14 October 2026 (third session).

---

## 1. What this is

A self-hosted, phone-first CRM for **Switchlink Africa**'s field sales team,
built by **Anyonaz NewTech** (proprietary; see `LICENSE`). It tracks clients
(schools, corporates, merchants, individuals; individuals need only a name and phone), the sales pipeline, follow-ups,
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
| Verification | `effectiveStatus`/`initialStatus`/`canVerifyAccount` in `permissions.ts`; `verifyAccount`/`declineVerification` in `actions/accounts.ts`; queue on the Admin dashboard |
| Tests | `tests/permissions.test.ts`, `tests/sharing.test.ts`, `tests/signature.test.ts`, `tests/statements.test.ts` (31 pass; 2 statement tests skip without the real `.xls` files in `STATEMENT_DIR`) |

## 5. What was done in each session

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

### Session of 14 October 2026 (later)

6. **No ID numbers for individuals.**
   - Individuals now need only a name and a **phone number** (required). The
     date of birth stays optional.
   - Migration 0005 dropped the ID columns. The encryption code and the
     `DATA_ENCRYPTION_KEY` setting were removed, since IDs were their only use.
   - A phone number can belong to only one individual. `0712…`, `+254712…`
     and spaced forms count as the same number.
7. **Admin verification of merchants and individuals.**
   - **New status:** `PENDING_VERIFICATION` (shown as "Pending verification").
     The system sets it; nobody picks it from the status list.
   - **When it applies:** a non-Admin setting a merchant or individual to
     Active gets Pending verification instead. A new individual registered by a
     non-Admin starts as Pending verification.
   - **Admins:** their own changes and registrations are Active directly.
   - **Admin dashboard:** shows **Accounts to verify** with Verify and Decline
     buttons. The same buttons appear on the account page.
   - **Decline:** needs a reason. The account returns to its previous status
     (stored in `accounts.pending_from_status`), and the reason goes into its
     status history and activity feed.
   - **Agents/BDOs:** their dashboard shows how many of their accounts are
     waiting.
   - **While pending:** the status can't be changed except by verify/decline.
   - **New account columns:** `pending_from_status`,
     `verification_requested_at/by`, `verified_at/by`.
   - The status tracker uses short labels (Engagement / Documents /
     Verification / Active), stacked, so four steps fit on a phone.
8. **Fixed a pre-existing bug where forms sometimes stuck on "Saving…".**
   - **The bug:** after a save, React sometimes never finished applying the
     refreshed page, so the form showed "Saving…" forever even though the save
     had worked. This was reproduced in the original v5 code too.
   - **The fix:** `ActionForm` now calls the server action directly, handles
     the result immediately (toast, close sheet, reset), then calls
     `router.refresh()`.
   - **What can still happen:** the page occasionally takes a few seconds to
     show the new data, but always catches up, and navigation is never blocked.
   - **Not done:** the root cause inside Next 15.5 / React 19 was not
     identified. Worth retesting after upgrading Next.

### Session of 14 October 2026 (evening)

9. **Admins can add corporates and merchants without a GPS location.**
   - **The rule:** `canSkipLocation()` in `permissions.ts`. Schools and
     individuals still need a location, and everyone else still needs one for
     every kind of account.
   - **Assigning:** on New account, Admins can assign the account to anyone
     active (Agent, BDO, Team Leader, Admin) or keep it ("Me"). The owner's
     team becomes the account's team.
   - **Without GPS:** no location capture is stored, and the Location tab shows
     "No location was captured".
10. **Imported Lindsey and Sharon's corporate lead list.**
    - **Source:** `DOC-20261003-WA0071.xlsx` was converted to
      `data/corporates-lindsey-sharon.json` (80 corporates).
    - **Loading it:** `npm run import:corporates` (`scripts/import-corporates.ts`).
      Lindsey Erodanga (Team Leader, with a team) and Sharon Achola (BDO) must
      exist first.
    - **Ownership:** all corporates are owned by Sharon on Lindsey's team. The
      script also sets Sharon to report to Lindsey on that team.
    - **What each corporate gets:** a contact, a Salary Advance opportunity
      (stage from the list's status), and a note for anything that didn't fit.
    - **Name fixes:** "Nairobi avulsion" → Nairobi Aviation College,
      "House of leath" → House of Leather, "The monarch group ldt" → The
      Monarch Group Ltd.
    - **Phones:** leading zeros were restored. Penda Health and Q-ways phones
      look wrong (10 digits) and are flagged with notes.
    - **Kept as corporates:** colleges and universities stayed as Corporate, as
      the user called the whole list corporates.
    - **Re-running:** the import is idempotent (skips existing names) and has a
      `--dry-run` mode.

### Session of 17 October 2026

11. **Bulk upload of merchant and individual accounts (Admin only), at
    `/import`.**
    - **Reading the file:** `tools/parse_sheet.py` reads `.xlsx` with openpyxl
      (added to the Dockerfile) or `.csv` (`,` `;` or tab). It finds the header
      row automatically (skipping title rows).
    - **Rules:** in `src/lib/import/accounts.ts` (pure functions, tested in
      `tests/import.test.ts`): heading aliases, phone normalisation (Excel's
      dropped 0, +254), Pesi padded to 4 digits, and duplicates inside the file.
    - **Actions:** `src/lib/actions/import.ts` → `previewImport()` checks
      everything against the database and stores the checked rows in
      `storage/imports/<token>.json`; `commitImport(token)` inserts them in one
      transaction, re-checking for duplicates.
    - **The page:** `src/app/(app)/import/` with `ImportForm.tsx` (it calls the
      actions directly, no `useActionState`).
    - **Template:** `GET /api/import/template` (Admin).
12. **New business vs existing accounts, and a Leaderboard.**
    - **Definition:** a disbursement is "new" when its account's first
      non-reversed positive disbursement is within the period. Organisations =
      SCHOOL+CORPORATE; merchants = MERCHANT+INDIVIDUAL.
    - **Code:** `newVsExisting()` and `leaderboard()` in `src/lib/reports.ts`.
    - **Where it shows:** `/leaderboard` (BDO, Agent, and Teams for Admin;
      sortable), a split table on Reports, and new sections in the CSV export.
    - **Scope:** Admins see everyone; other roles see their own team's
      leaderboard. The CSV's leaderboard section uses the same scope.

13. **Bulk upload opened to Team Leaders and BDOs** (17 October, later).
    - **New rules** in `permissions.ts`: `canBulkUpload()` (Admin, Team
      Leader, BDO) and `canAssignNewAccount()`. The second is now also used
      by single-account creation, so both follow the same assignment rules.
    - **Statuses:** individuals uploaded by Team Leaders or BDOs are
      `PENDING_VERIFICATION` and land in the Admin's queue. Merchants start in
      Ongoing engagement.
    - **No GPS** is recorded for uploaded accounts, whoever uploads them.

### Session of 18 October 2026

14. **Conversion rates.**
    - **Definition:** accounts added in the period that are now Active, as a
      percentage. Individuals deleted for not being activated count as added,
      not converted (they come from `account_deletions`).
    - **Code:** `conversionBy()` / `myConversion()` in `src/lib/reports.ts`
      (an `ADDED` CTE = accounts created in the period UNION deletions).
    - **Where it shows:** a card on every dashboard (this month: own for
      Agents, with Agents for BDOs, team for Team Leaders, all for Admins); on
      the Leaderboard per row as `x% (converted/added)`, a summary card, and a
      "Conversion rate" sort. A new **Team Leaders** board was added (their
      own accounts; money keyed on `credited_to`).
15. **Individuals deleted after 30 days if not activated.**
    - **Code:** `src/lib/retention.ts` → `deleteExpiredIndividuals()`, run by
      `src/instrumentation-node.ts` 90 s after start and then hourly. Only
      individuals that never became Active; anything with a disbursement or
      statement line is kept. Each deletion is written to `account_deletions`
      (migration `0006`) and to the audit log (`account.expired`).
    - **Notices:** the new-account form (non-admins adding an individual), the
      success message (with the date), a banner on the account page, the
      Bulk upload page, and an "Individuals to be deleted soon" list (next 7
      days) on dashboards (`expiringSoon()`).
16. **Weekly targets** (`/targets`, table `weekly_targets`, one row per user
    per Monday, migration `0006`).
    - **Rules:** `src/lib/targets.ts` (pure, tested in `tests/targets.test.ts`):
      week start in Nairobi, edits allowed only on the Nairobi day the target
      was set, roll-ups, percentages.
    - **Data:** `src/lib/targets-data.ts` → `myTarget()`, `weekOverview()`
      (team → BDO → agents). Closed = first ACTIVE status in the week, counted
      for the account's current owner; corporates means CORPORATE only (not
      schools). Disbursed = amounts with `credited_to` = the person.
    - **The gate:** BDOs and Agents without this week's target are redirected
      to `/targets?required=1` by `requireUser()` in
      `src/lib/auth/session.ts` (cached per request). Pages that must stay
      reachable pass `requireUser({ skipTargets: true })`: the app layout,
      `/targets`, the target action, Profile and the name change. The gate
      applies all week until the target is set, not only on Mondays. Team
      Leaders and Admins aren't gated.
    - **Lesson:** a redirect in the shared `(app)/layout.tsx` looped on client
      navigation, so the gate lives in `requireUser()`, not the layout.
    - **Views:** dashboards (own, "With your agents" for BDOs, team totals for
      Team Leaders, all teams for Admins); the Targets page with BDO
      breakdowns, **Not set** badges and previous weeks.

### Session of 22 October 2026

17. **Temporary passwords no longer vanish.** Resetting a password or adding
    a user used to show the password in a toast that closed after 3 seconds.
    It now opens a dialog (`src/components/ui/SecretDialog.tsx`, provider in
    `src/app/layout.tsx`) that stays until **I've saved it** is tapped
    (tapping outside does nothing). It has a **Copy** button (with a fallback
    for plain-http sites), the person's name and sign-in email, and **Share /
    Copy sign-in details** (a ready-to-send message; the link is included
    when `APP_URL` isn't localhost). Actions return it with
    `okSecret()` in `src/lib/action-result.ts`; `ActionForm` and
    `ActionButton` show it automatically.

## 6. How to run

**Laptop:** Node 22, Postgres 16, `pip install xlrd`.

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL
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
2. **Backups off the machine.** Schedule `scripts/backup.sh` nightly, copy
   `./backups` to another disk or cloud storage, and **test a restore once**.
3. **Server hardening.**
   - Open only ports 80/443 (and SSH by key only).
   - Turn on automatic security updates and put the server on a UPS.
   - Set Docker log size limits (`logging: max-size`) so logs can't fill the disk.
   - If the office IP changes, set up dynamic DNS.
4. **Office internet is a single point of failure.** Field staff can't reach
   the CRM if the office line or power goes down. Consider a cheap VPS, or at
   least a backup internet line.
5. **Login throttle and shared IPs.** The per-IP sign-in limit (30 attempts per
   10 min) is kept in memory. Staff on the same office Wi-Fi or mobile-carrier
   NAT share one IP, so one person mistyping could slow down sign-in for
   others. Consider keying the limit on email + IP.
6. **Notifications.** Nothing tells a Team Leader or Admin that a sharing
   request is waiting, or an agent that a follow-up is due, unless they open
   the app. Options: email via SMTP, SMS/WhatsApp (e.g. Africa's Talking —
   paid), or web push (free).
7. **Bulk import of existing schools and corporates.** Merchants and
   individuals have Bulk upload, and corporates have `import:corporates`;
   schools still have no import.
8. **Kenya Data Protection Act 2019.** The CRM stores names, phone numbers and GPS
   locations. Check whether Switchlink must register with the ODPC, and add a
   privacy notice, consent wording and a retention/deletion policy. (This is
   not legal advice; confirm with their legal or compliance person.)
9. **Audit log viewer.** Everything is logged in `audit_log`, but there's no
    screen to read it yet. A simple Admin page would help (also for
    `signature.mismatch`).
10. **Monitoring.** Add a `/api/health` endpoint plus a free uptime checker
    (e.g. Uptime Kuma on another machine) that alerts when the CRM is down.
11. **Real-world test run.** Pilot with 2–3 BDOs on their own phones and real
    Pesi statements for a week. Rebuild an end-to-end test with its own test
    data (the old one used the demo seed).
12. **Set `GEOCODER_CONTACT_EMAIL`** to a real Switchlink address. This is a
    Nominatim usage-policy requirement.
13. **Short user guide or training session** for each role (Agent, BDO, Team
    Leader, Admin).

## 8. Things to know / gotchas

- `next start` warns because the build uses `output: "standalone"`. Docker runs
  `node server.js`, which is correct. The warning only matters locally.
- `ActionForm` does **not** use `useActionState` (see item 8 above); keep it
  that way unless the Saving… hang is confirmed fixed upstream.
- Server actions passed into client components must be bound **on the
  server**. Binding in the client broke the success toast; see how
  `ShareRequestForm` receives `action`.
- `TRUNCATE account_shares CASCADE` also wipes `disbursements` (foreign key).
  Use `DELETE` instead.
- Africa/Nairobi time everywhere (`src/lib/format.ts`, `timezone.ts`).
- Money is `numeric(14,2)`, summed in SQL, never in the browser.
- Unit tests: 37, all passing (`npm test`).
- BDO and Agent test users need a `weekly_targets` row for the current week,
  or every page redirects them to `/targets`.
- The README is the professional, client-facing document. It deliberately
  doesn't mention the authorship signature; that is documented only here.

## 9. Prompt to start the next chat

> I'm continuing work on the Switchlink CRM (Next.js + PostgreSQL, built by
> Anyonaz NewTech for Switchlink Africa). The attached HANDOFF.md explains the
> project, what's done and what's left; the attached zip is the latest code.
> Read HANDOFF.md first, then inspect the code before changing anything.
> Today I want to: <what you want next, e.g. "add an audit log viewer" or
> "prepare it for deployment on the office server">.
