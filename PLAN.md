# Team HR Platform — Plan

Internal tool for managing the team: who is on it, what they are paid and when,
leave balances, key dates, onboarding, and a weekly Wise batch-payment CSV export
for the Philippines-based team.

## 1. Decisions to confirm

Status as of 2026-09-11.

| # | Question | Decision |
|---|----------|----------|
| 1 | Source currency of the Wise business account | **USD** (confirmed). All salaries, including the Filipino team, are denominated in USD. |
| 2 | Fee handling | **Recipients receive the full amount; the company pays the Wise fee** (confirmed). GCash recipients: **gross up the USD amount** (confirmed). Wise-account recipients: fixed USD target. See section 5. |
| 3 | Non-Filipino team members | **Paid directly to bank accounts and managed in Xero** (confirmed). They are tracked in the platform for HR data only; no Wise export for them. |
| 4 | Hosting | **Cloud Run + Postgres, matching the fleet** (confirmed 2026-09-11). Own Cloud Run service scaled to zero; own `hr` schema and scoped role on the existing Supabase, as bm-identity does; not merged into the bm-identity service. See section 3b. |
| 5 | Who needs access | **bm-identity from day one** (checked 2026-09-11: it is a Google-login delegation service with a per-app API, not an OIDC or SAML provider, so Cloudflare Access cannot use it). Owner gets the bootstrap `admin` grant when the app is onboarded. See section 3a. |
| 6 | Leave rule for the Filipino team | **Fixed annual entitlement, accrued 1/12 per month, unused days carry over up to a cap** (confirmed). Entitlement and cap are set per person with a default in settings. |

## 2. Software vs Google Sheet

A Sheet covers the directory and a one-off export in an afternoon. It falls
down on the parts that matter over time:

- **Compensation history.** "Last pay rise" needs a dated list per person, not a cell.
- **Leave balances.** Entitlement, accrual, taken, carry-over, and upcoming leave need rows and rules.
- **Pay-run audit trail.** Each weekly export should be a frozen record of who was paid what, not an overwritten tab.
- **Access control.** Salary data in a Sheet is one share-link away from everyone.

Recommendation: build the software, but collect the initial data in a
spreadsheet and import it (Phase 1 includes CSV import).

## 3. Architecture

Small, single-deployable app.

**Recommended: match the fleet.** bm-identity and the other BeastMode apps
are Express 5 + Drizzle + Postgres (Supabase) on Cloud Run (GCP project
`beastmode-pm`, region asia-southeast1), secrets in Secret Manager, one
`npm run deploy` script. Each app owns its own database. Building bm-hr the
same way means the same deploy path and the same operating habits.

- **Runtime:** Node + Express 5 on Cloud Run, Vite + React front end served as static assets from the same service. `--min-instances 0` like bm-sales.
- **Database:** Postgres on Supabase, Drizzle ORM, own migration journal at `hr.__migrations`. Where it lives is the question in section 3b.
- **Auth:** bm-identity, section 3a.
- **Email reminders:** whatever the fleet already uses (bm-email is a sibling repo; reuse it if it exposes a send API). Phase 4.
- **Backups:** Supabase's backup policy for whichever project hosts the data.

**Alternative: Cloudflare Workers + D1.** Works technically, since the
identity calls are plain server-to-server HTTPS. Costs: a second hosting
platform, a second database with its own backups, and Hono instead of the
Express patterns the fleet already has. Only worth it if there is a reason
to keep HR data off the shared database.

The data model and Wise export logic are identical either way.

### 3a. Authentication via bm-identity

What bm-identity provides (from its CLAUDE.md and `docs/app-access-contract.md`):

- Apps register with an id, display name, role vocabulary, a Google OAuth client id, and a bearer secret (hashed in the registry). Onboarding is one script run: `node scripts/onboard-app.mjs --id hr --name "HR" --roles admin --admin-email david@xavadigital.com --google-client-id <id>` in the bm-identity repo. It creates the registry row, stores the secret in Secret Manager as `bm-identity-secret-hr`, and grants the owner the first role. Nothing to deploy on the identity side.
- **Login:** the HR front end shows Google's sign-in button using the app's own Google client id. The credential is posted to the HR API, which calls `POST https://identity.beastmode.co.nz/v1/google-login` with `Authorization: Bearer <hr secret>`. Response is either `{ user, access: { granted: true, role } }` or a 403 with code `NO_APP_ACCESS` (known person, no HR role) or `NOT_AUTHORISED` (not a BeastMode person). The HR API then issues its own session cookie (short-lived signed JWT, as bm-identity's admin console does).
- **Live re-check:** every request re-reads `GET /v1/users/:id` at most once per 60 seconds, ends the session if `disabled` is true or the `hr` key is missing from `grants`, and keeps the last known role if identity is unreachable.
- **Rules the contract imposes:** no default or fallback role, no env-var admin, no email allowlist, no local copy of the role as a source of truth, downgrades apply within 60 seconds. The contract ends with a compliance questionnaire to send back to the identity owner once implemented.

Role vocabulary for HR, registered at onboarding: `admin` (everything,
including compensation and pay runs). A second role such as `viewer`
(directory and leave, no pay data) can be added later by telling the
identity owner, since roles are validated against the registry on write.

This replaces the earlier Cloudflare Access idea entirely. There is no
interim allowlist phase: the contract forbids it, and onboarding takes
minutes.

**Reference implementation to copy:** bm-team-engage (sibling repo, updated
2026-09-10) has `src/server/identity/identityClient.ts` and
`src/server/auth/googleLogin.ts` with tests. bm-sales has the older
equivalent in `src/identity/client.ts` and `src/auth/middleware.ts`. Phase 1
lifts the team-engage versions rather than writing new ones.

### 3b. Sharing infrastructure with bm-identity

The question raised on 2026-09-11: could bm-hr share a database and API with
bm-identity to save on instances? Two separate questions.

**Database: yes, share the physical Supabase, in the way bm-identity already does.**
bm-identity's own config says it runs on "the same physical Supabase as the
business apps for now" under a scoped role (`bm_identity_svc`) that can only
reach the `identity` schema, with its own migration journal so it never
collides with bm-sales'. bm-hr copies that exactly: schema `hr`, role
`bm_hr_svc` with grants on `hr` only, journal `hr.__migrations`. This is
where the real saving is, since a new Supabase project has a monthly compute
cost and a schema does not. The scoped role also means no other app's
credentials can read salary data, and moving to a dedicated project later is
one connection-string change, which is the same escape hatch bm-identity
documents for itself.

**API: no, keep bm-hr as its own Cloud Run service.**
- bm-identity's CLAUDE.md is explicit: "deliberately small and boring, resist adding anything that isn't strictly identity", and it is the trust root for every app's login. Adding HR screens, pay runs, and CSV export to it means every HR deploy is an identity deploy, and an HR bug can break sign-in for the whole fleet.
- The instance saving is close to nothing. bm-identity keeps `min-instances 1` because it must answer login calls fast. bm-hr is an admin tool used a few times a week, so it runs at `min-instances 0` like bm-sales and costs only per request. Cloud Run bills nothing for a service scaled to zero. A cold start of a second or two on first open is acceptable for this tool.
- Secrets stay separate: bm-hr gets `bm-hr-database-url` (the scoped role) and `bm-hr-jwt-secret`, plus its identity bearer `bm-identity-secret-hr`.

Net: one extra Cloud Run service at effectively zero idle cost, zero extra
database cost.

### Security notes

- Do **not** store bank account numbers. Wise stores recipient bank details; the platform stores only the Wise recipient ID.
- Every write is logged to an audit table (who, when, what changed).
- Compensation fields are hidden from any future non-admin role by default.

## 4. Data model

Tables and the questions they answer.

**team_members** — who is on the team
`id, first_name, last_name, preferred_name, email, phone, country, timezone, job_title, employment_type (employee|contractor), status (onboarding|active|offboarded), start_date, end_date, date_of_birth (optional), notes`

Derived: anniversary (start_date), tenure, days until anniversary.

**compensation** — pay and pay-rise history (append-only)
`id, member_id, amount, currency, period (weekly|fortnightly|monthly|annual), effective_from, reason (initial|pay_rise|adjustment), notes, created_by`

Derived: current pay = latest row by effective_from; last pay rise = latest row with reason pay_rise; "pay rise due" = months since last rise over a threshold.

**pay_schedules** — when and how each person is paid
`member_id, frequency (weekly|fortnightly|monthly), pay_day (weekday 1-7 or day-of-month), payout_method (wise|xero_bank|other), wise_recipient_id, wise_recipient_name (as saved in Wise), wise_recipient_kind (gcash|wise_account), wise_recipient_detail, target_currency, invoice_prefix, next_invoice_number, thirteenth_month (bool), thirteenth_month_pay_month (default December)`

Non-Filipino staff use `payout_method` = `xero_bank` and are excluded from pay runs.

**leave_policies** — entitlement rules per person
`member_id, leave_year_start (MM-DD), annual_entitlement_days, accrual (front_loaded|monthly), carry_over_max_days, sick_days (optional)`

**leave_requests** — holidays and other absences
`id, member_id, type (annual|sick|unpaid|public_holiday|other), start_date, end_date, days, status (requested|approved|taken|cancelled), paid (bool), notes`

**leave_adjustments** — manual balance corrections
`id, member_id, date, days (+/-), reason`

Derived: balance = entitlement accrued to date + carry-over + adjustments − approved/taken days.

**pay_runs** — one per pay date
`id, pay_date, period_start, period_end, source_currency, status (draft|exported|paid), exported_at, paid_at, created_by`

**pay_run_lines** — one per person per run
`id, pay_run_id, member_id, base_amount_usd, adjustments_amount_usd, adjustments_note, net_amount_usd, fee_fixed_usd, fee_pct, gross_up_usd, export_amount, export_currency, amount_mode (source|target), payment_reference, included (bool), wise_recipient_id (snapshot), recipient_name (snapshot)`

Snapshot fields mean a run stays correct even if the person's details change later.

**onboarding_templates / onboarding_tasks** — checklists
`template: id, name, items[]` and `task: id, member_id, title, due_date, done_at, assigned_to`

**member_events** — timeline of notes
`id, member_id, date, type (note|review|warning|milestone), text, created_by`

**audit_log**
`id, actor_email, at, table, row_id, action, diff_json`

## 5. Weekly Wise export

### The actual template (downloaded from the account, 2026-09-11)

Full file (with recipient data, git-ignored): `docs/wise-template.csv`.
Committed header: `docs/wise-template-header.csv`.

```
recipientId,name,recipientEmail,recipientDetail,sourceCurrency,targetCurrency,amountCurrency,amount,paymentReference,referenceNumber,receiverType
```

What the file tells us:

- **Two recipient kinds.** GCash recipients have `recipientDetail` = `GCash · <number>` and `targetCurrency` = `PHP`. Wise-account recipients have `recipientDetail` = `Wise account` and a blank `targetCurrency`. The app records the kind per person because it changes the amount mode (below).
- **`paymentReference` is used as an invoice number** (`INV 104`, `INV-0176`, `INV0008`). The app keeps a per-member invoice prefix and next number, pre-fills the reference each run, and lets it be edited.
- **`referenceNumber` is unused** and stays blank. `receiverType` is always `PERSON`.
- **Every row currently uses `amountCurrency` = `source`**, which is the mode where Wise deducts its fee from the recipient's money. That is what has to change.

### Fee handling: making recipients receive the full amount

Wise's rule (help centre, verified 2026-09-11): `source` means the amount is in the sending currency and fees come out of it, so the recipient gets less. `target` means the amount is in the recipient's currency, fees are charged to the sender, and the recipient gets exactly the stated amount.

- **Wise-account recipients (USD to USD):** set `targetCurrency` = `USD`, `amountCurrency` = `target`, `amount` = USD salary. Recipient receives the exact USD figure. No open question.
- **GCash recipients (USD to PHP):** `target` would need a PHP amount, but salaries are in USD. **Decision: gross up the USD amount** and keep `amountCurrency` = `source`. The row's `amount` is the salary plus the estimated Wise fee, so after Wise deducts its fee the recipient receives the salary's full USD value converted to PHP.

  Gross-up calculation. Wise fees are a fixed part plus a percentage of the amount, so for a net salary `S`:

  ```
  amount = (S + fee_fixed) / (1 - fee_pct)
  ```

  rounded up to the cent. `fee_fixed` and `fee_pct` live in settings per recipient kind and are calibrated from the fee Wise shows on the batch review screen. The pay-run line stores the salary, the fee model used, and the grossed-up amount, so a later fee change never alters history. If the estimate drifts, editing the two settings fixes the next run.

  Later refinement (Phase 2b, to be verified against Wise API docs): Wise offers an unauthenticated quote endpoint that returns the exact fee for a given amount and currency pair. Calling it per line would replace the estimate with the real fee.

- **Mode is a per-recipient-kind setting** in the exporter, so either kind can be switched between `source` gross-up and `target` without code changes. The first real upload should confirm Wise accepts `targetCurrency` = `USD` with `target` for Wise-account recipients; if not, they fall back to the same gross-up model.

### General Wise batch facts

- Three template types: *send by email*, *send to saved recipients*, *send to bank accounts*. This account uses **send to saved recipients**, so bank and wallet details never leave Wise.
- Limits: 1,000 transfers per file (100 if the sender needs approval). GCash and other PHP mobile wallets are capped at 50,000 PHP per transfer, well above current weekly amounts but checked at export anyway.
- The header row above is stored in app settings; the exporter emits columns in exactly that order so a template change in Wise is a settings edit.

### Flow in the app

1. **Create pay run** for a pay date. The app pre-fills lines from every active member whose schedule matches (weekly + Wise), using current compensation converted to a per-period amount.
2. **Adjust** any line: unpaid-leave deduction, bonus, 13th-month payment (auto-suggested in the configured month as 1/12 of basic annual pay for eligible people), or exclude someone.
3. **Export** produces `wise-batch-YYYY-MM-DD.csv` with one row per included line, `paymentReference` like `Salary w/e 2026-09-11`. Run status becomes *exported*; lines are frozen.
4. **Upload** the file in Wise, review, fund, send.
5. **Mark paid** in the app. Pay history per person is the set of paid run lines.

Validation before export: recipient ID present, amount > 0, name matches Wise
recipient name snapshot, wallet recipients under 50,000 PHP, no duplicate
member in a run.

## 6. Screens

- **Dashboard:** upcoming leave (next 30 days), anniversaries and birthdays (next 30 days), pay rises overdue, 13th-month due, onboarding in progress, next pay run due.
- **Team list:** filterable table; status, role, country, pay, next pay date, leave balance.
- **Member profile:** tabs for Details, Compensation (history + "add pay rise"), Pay schedule, Leave (balance + requests + calendar), Onboarding, Notes/timeline.
- **Pay runs:** list, run detail with editable lines, Export CSV button, Mark paid.
- **Leave calendar:** month view across the team.
- **Settings:** Wise template header, source currency, default leave policy, onboarding templates, admin allowlist.

## 7. Phases

**Phase 0 — setup (no code)**
Confirm the decisions in section 1. Download the Wise saved-recipients
template. Collect current team data in a spreadsheet matching the import
format.

**Phase 1 — directory and compensation**
Project scaffold matching the fleet layout, `hr` schema + migrations,
bm-identity login and the 60-second grant re-check, team CRUD, compensation
history, pay schedules, CSV import, member profile page, first Cloud Run
deploy. Also: mint the Google OAuth client for HR and run the identity
onboarding script.
Outcome: the platform replaces wherever this lives today.

**Phase 2 — pay runs and Wise export**
Pay run creation, line adjustments, CSV exporter with configurable header,
validation, mark-paid, pay history per member.
Outcome: weekly Philippines payroll goes through the app.

**Phase 3 — leave and dashboard**
Leave policies, requests, balances, calendar, dashboard widgets for upcoming
leave, anniversaries, pay-rise-due, 13th month.

**Phase 4 — onboarding, notes, reminders**
Onboarding templates and per-member checklists, member timeline, weekly
email digest (upcoming leave, pay run due, anniversaries), nightly backups.

Each phase ends with a deploy and a short walkthrough.

## 8. Next action

**Phase 1 code is built (2026-09-11):** scaffold, `hr` schema + migration,
bm-identity login and 60-second re-check, team CRUD, compensation history,
pay schedules, CSV import, team list and member profile pages.

**Phase 2 code is built (2026-09-12):** pay runs (draft → exported → paid,
reopen), lines with 13th month and adjustments, per-kind fee model and
gross-up, invoice reference sequences, validation, Wise CSV in the
template's column order, pay history per member, settings page. Server
tests pass; client builds. Not yet deployed. The gross-up fee numbers start
at zero and must be calibrated in Settings from a real Wise review screen.

**Phase 3 code is built (2026-09-12):** leave policies (defaults in Settings,
per-person override), leave requests with approval status and half days,
balance adjustments, balances with monthly or front-loaded accrual and
capped carry-over, team leave calendar, Leave tab on each profile, leave
column on the team list, and the dashboard (upcoming leave, pending
requests, anniversaries and birthdays, pay rises due, 13th month due,
onboarding, pay-run status). No public-holiday calendar yet: working days
are Mon–Fri and holidays are recorded as leave of type public_holiday if
wanted.

To deploy Phase 1 the owner does the one-time steps in `DEPLOY.md`:
1. Run `scripts/create-role.sql` on Supabase and store the URL as
   `bm-hr-database-url`; create `bm-hr-jwt-secret`.
2. Mint the Google OAuth client id for HR and put it in the deploy script.
3. Run the bm-identity onboarding script for app id `hr`.
4. `npm run db:migrate`, then `npm run deploy`.

Then: import the team, enter Wise recipient ids from the downloaded
template, create the first pay run alongside the current manual process,
compare the CSV against the manual one, and set the fee model from the
Wise review screen. Enter each person's opening leave balance as an
adjustment. Phase 4 (onboarding checklists, notes timeline, email digest,
backups) follows.

Before the first Phase 2 export, note the fee Wise shows for one GCash and
one Wise-account transfer so the gross-up settings can be calibrated.
