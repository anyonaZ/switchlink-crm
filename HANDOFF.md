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
      `data/corporates-lindsey-sharon.json` (80 corporates; later moved out of the repository, see item 37).
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

### Session of 23 October 2026: integrity fixes

18. **Moving people keeps team scope consistent.** `src/lib/people-data.ts` →
    `followTeam()`: an account's team follows its owner, and a BDO's Agents
    (and their accounts) follow the BDO. Used by `moveAgent` (Team Leaders)
    and `updateUser` (Admins; the old "move their accounts too" checkbox is
    gone, it's always done). Disbursements keep `credited_team_id`.
19. **New-account drafts.** `src/lib/drafts.ts`: sessionStorage (not
    localStorage), key `sl-draft:new-account:<userId>`, 4-hour expiry, KRA PIN,
    registration no and date of birth never stored. `ClearDrafts` on the
    sign-in page wipes every draft (and the old shared `sl-new-account-draft`
    key) after sign-out or session expiry.
20. **One reversal per ledger entry.** Unique index
    `disbursements_reverses_idx` plus a self-referencing FK on `reverses_id`.
    `src/lib/ledger.ts` → `reverseEntry()` locks the originals
    (`SELECT … FOR UPDATE`), skips slices already reversed, and maps a unique
    violation to "already reversed".
21. **Statement uploads are all-or-nothing.** The `statement.upload` audit
    entry is written inside the ingest transaction. In the action, only an
    error from `ingestStatement` reports "nothing was saved" or deletes the file.
22. **Statement reversals.**
    - **Linking:** `priorDraws()` returns the standing (unreversed) draw for
      each serial, so a reversal in a later upload gets `reverses_id`.
    - **Counts:** `drawsNew` counts positive draws only; uploads have
      `reversals_new` / `reversed_amount_new`.
    - **QF opportunity:** marked Active only when the upload has net new
      lending.
    - **Reports:** the QF draw count excludes reversed draws.
    - **Safety:** an upload that would record a reversal with nothing to link
      to is rejected.
23. **Migration `0007_ledger_integrity`** repairs existing data before adding
    the constraints:
    - Agents are put on their BDO's team.
    - Accounts are put on their owner's team (audit `account.team_repaired`).
    - Unlinked statement reversals are linked.
    - Duplicate reversals are removed (audit
      `disbursement.duplicate_reversal_removed`).
    - Upload counts are recomputed.

    Gotcha: on a fresh database every migration runs in one transaction, so
    compare enum values added by an earlier migration as text
    (`role::text = 'AGENT'`).
24. **Tests:** `npm run test:db` (`tests/db/integrity.db.test.ts`, 13 tests) runs
    on a throwaway `<db>_itest` database, with statements generated in Pesi's
    `.xls` layout by `tests/fixtures/make_statement.py` and read by the real
    parser. The two real client statements are still not in the repo; the
    `STATEMENT_DIR` tests in `tests/statements.test.ts` use them when present.

### Session of 23 October 2026 (later): technical-review fixes

Zacc shared an external technical review of v5.9. Items P1.1–P1.5 were already
fixed above; everything else that is code or operations was done here.

25. **API gate** (`src/lib/auth/api.ts` → `apiUser()`): session + active user +
    forced password change done + optional roles, for every API route. Unit test
    fails if a route under `src/app/api` doesn't use it (only `/api/signature` and
    `/api/health` are public). Middleware answers unauthenticated `/api/*` with a
    401 JSON instead of a redirect.
26. **CSV** (`src/lib/csv.ts`): any text starting (after spaces) with = + - @ tab
    CR or their full-width forms is prefixed with `'`; only real numbers and
    strings that are entirely a number are left alone. Used by both exports.
27. **CSP and headers** (`next.config.mjs`): strict CSP ('unsafe-inline' scripts
    are needed by Next without nonces), COOP/CORP; `/api/files/*` gets a
    `sandbox` CSP (listed after the site-wide rule, which would otherwise win).
28. **Sign-in throttle** in the database (`login_throttle`, `src/lib/auth/throttle.ts`):
    atomic upsert per `ue:<ip>|<email>` (10/10 min) and `ip:<ip>` (100/10 min);
    failed-login counter is now one atomic UPDATE. Client IP = last
    X-Forwarded-For entry (Caddy sets it).
29. **Phones** (`src/lib/phone.ts`, SQL `kenya_phone()`): generated column
    `accounts.phone_canonical` (+2547…), partial unique index
    `accounts_individual_phone_idx` for individuals. Migration 0008 stores
    individuals' phones as 07…, and FLAGS (never deletes) later duplicates with
    `phone_conflict` (audit `account.phone_conflict`); the Admin dashboard lists
    them; saving the account with a fixed number clears the flag. Forms require a
    Kenyan mobile for individuals; unique clashes become field errors.
30. **Bulk-upload previews** (`src/lib/import/previews.ts`): 0600 files, 30-min TTL
    checked at commit, deleted on commit/expiry, swept hourly. Commit re-checks the
    owner (still active, still assignable), phone, Pesi and name, each row in its own
    savepoint; skipped rows are listed with their reason.
31. **Atomic audits + idempotency.** Every state-changing action writes its audit
    inside the same transaction (unit test enforces this; standalone events
    allowed: `login`, `login.locked`, `kyc.rejected_infected`). Money forms send a
    hidden `request_key` (`<RequestKey/>`); `runOnce()` (`src/lib/idempotency.ts`,
    table `idempotency_keys`) claims it in the write's transaction and replays the
    first result. Weekly targets use SELECT … FOR UPDATE + ON CONFLICT.
32. **Activity ↔ opportunity:** checked in `crm.ts` and enforced by a composite FK
    `activities(opportunity_id, account_id) → opportunities(id, account_id)`
    (hand-written in 0008, not in the Drizzle schema; the single-column FK still
    does ON DELETE SET NULL).
33. **KYC files** (`src/lib/files.ts`, `src/lib/av.ts`, `src/lib/storage.ts`): magic
    bytes decide the type; PDFs with /JavaScript, /JS, /Launch, /EmbeddedFile,
    /RichMedia or without %%EOF are refused; SHA-256 stored and checked on every
    download (409 + audit `kyc.integrity_failed` on mismatch); files 0600, folders
    0700; optional ClamAV (`CLAMAV_HOST`, compose profile `antivirus`), uploads
    refused if the scanner is configured but unreachable.
34. **Limit warnings** use the QF limit in force on each line's date
    (`limitWarnings()` in `analyze.ts`).
35. **Reversal dating** is unchanged but now labelled in the ledger: manual
    reversals count in the original entry's month; statement reversals on Pesi's
    posting date. NEEDS A FINANCE DECISION (see section 7).
36. **Timezone:** fixed to `BUSINESS_TZ` in `src/lib/timezone.ts`; `APP_TIMEZONE`
    removed from `.env.example` (a different value only logs a warning).
37. **Lead list out of the repo:** `data/` is git- and docker-ignored, the file was
    removed (and purged from this repo's history); `import:corporates` needs
    `--file`. Zacc has the JSON separately.
38. **Operations:** `/api/health` (`src/lib/health.ts`): public `{status, version,
    commit}`; detailed checks for Admins or `HEALTH_TOKEN` (database, migrations,
    storage, maintenance, backup age ≤36 h, restore drill ≤40 days). Docker health
    checks; Caddy waits for a healthy app; log size caps. `backup` service
    (`scripts/backup-run.sh`, `backup-loop.sh`): nightly 01:30, verified,
    AES-256 with `BACKUP_PASSPHRASE`, rclone off-site, webhook on failure.
    `scripts/restore-drill.sh` and `scripts/restore.sh`. Hourly
    `src/lib/maintenance.ts`. Admin **Audit log** page + masked CSV export.
    Version 6.1.0 from package.json + `GIT_COMMIT` (`scripts/release.sh`).
    `db` connection is lazy, so `next build` works without `DATABASE_URL`
    (Docker build stage).
39. **Tests:** unit 46 (`tests/security.test.ts` new), database 30
    (`tests/db/hardening.db.test.ts` new). The backup/drill scripts were run for real
    against PostgreSQL here (encrypted backup, drill pass, drill fails on a tampered
    file and on a wrong passphrase, webhook on failure). Docker images could NOT be
    built here (Docker Hub is blocked from this workspace): build them on the server.

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

Done since the review: backups (scheduled, encrypted, off-site option, drill),
monitoring (/api/health), audit log viewer, bulk import, sign-in throttle,
version/commit display. Still open, roughly in priority order:

1. **Build and start on the server** (`scripts/release.sh`), then check
   `/api/health` as an Admin. Docker images weren't buildable in the dev workspace.
2. **Set `BACKUP_PASSPHRASE` and `RCLONE_REMOTE`**, store the passphrase off the
   server, run `scripts/backup.sh` then `scripts/restore-drill.sh` once. Set
   `ALERT_WEBHOOK_URL` and point an uptime monitor at `/api/health` with `HEALTH_TOKEN`.
3. **Don't ship the known admin password.** Use `user:create-admin` (random
   password) on the server.
4. **Finance decision: reversal dating.** Manual reversals restate the original
   month; statement reversals post on Pesi's date. If Finance wants "post in the
   month the correction was made" (or both views), change `reverseEntry()` in
   `src/lib/ledger.ts` (it copies `disbursedAt` from the original) and reports.
5. **Server hardening.** Only 80/443 open (SSH by key), automatic security
   updates, UPS, **full-disk encryption**, dynamic DNS if the office IP changes.
6. **Decide on virus scanning** (ClamAV needs ~1.5 GB RAM): `docker compose
   --profile antivirus up -d` and `CLAMAV_HOST=clamav`.
7. **Office internet is a single point of failure.** Consider a VPS or a backup line.
8. **Notifications** (follow-ups due, share approvals, verification queue,
   missing targets): email/SMS/web push. Not built.
9. **Kenya Data Protection Act 2019.** ODPC registration, privacy notice (mention
   GPS, KYC, and that deletion records keep name + phone), consent wording,
   retention schedule. Not legal advice; confirm with their legal/compliance person.
10. **Stronger CSP:** nonce-based scripts would let us drop 'unsafe-inline'; needs
    every page dynamic (they mostly are) and middleware to set the nonce.
11. **Pilot** with 2–3 BDOs on their phones and real Pesi statements for a week
    (run `STATEMENT_DIR=… npm test` with the real statements first).
12. **`GEOCODER_CONTACT_EMAIL`** set to a real Switchlink address.
13. **User guide / training** per role.

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
- Unit tests: 46 (`npm test`); database tests: 30 (`npm run test:db`). All passing.
- Don't run Prettier over existing files: the code isn't Prettier-formatted, and a
  reformat buries real changes in the diff.
- `kenya_phone()` (SQL, migration 0008) and `kenyanMobile()` (TS) must stay identical;
  a database test compares them.
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
