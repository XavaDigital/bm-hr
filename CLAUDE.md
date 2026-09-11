# bm-hr

BeastMode's team/HR platform: who is on the team, what they are paid (history),
how and when they are paid, leave, onboarding, and the weekly Wise batch-payment
CSV for the Philippines team. Plan and confirmed decisions: `PLAN.md`.
Express 5 + Drizzle (Postgres) in `src/`, Vite + React (antd) in `client/`,
one Cloud Run container. Fleet tenant of bm-identity — see below.

## Model (schema `hr`, Phase 1)

- `team_members` — directory. Soft-deleted via `deleted_at`; status is
  `onboarding | active | offboarded`. Email unique (case-insensitive) among
  live rows.
- `compensation` — APPEND-ONLY pay history. Current pay = latest row whose
  `effective_from` ≤ today; last pay rise = latest `reason = 'pay_rise'`.
  Never update amounts in place; add a row.
- `pay_schedules` — one per member: frequency, pay day, payout method
  (`wise | xero_bank | other`), Wise recipient id/name/kind
  (`gcash | wise_account`), invoice-reference sequence, 13th-month flag.
  **No bank or wallet numbers are stored here, ever** — Wise holds them.
- `audit_log` — every write, with the identity user who did it.

Later phases add leave, pay runs (+ Wise export), onboarding, member events.
Salaries are USD everywhere; Filipino GCash recipients are paid by grossing up
the USD source amount (PLAN.md §5).

## Auth — bm-identity, no local policy

bm-hr follows `bm-identity/docs/app-access-contract.md` exactly:

- Google button (client id from `GOOGLE_LOGIN_CLIENT_ID`) → `POST /api/auth/google`
  → relayed to identity `/v1/google-login` with OUR bearer
  (`IDENTITY_API_SECRET`). 403 `NO_APP_ACCESS` / `NOT_AUTHORISED` are relayed
  verbatim; a session cookie is minted only on `access.granted` with a role in
  `SESSION_ROLES` (`src/identity/client.ts`; currently just `admin`).
- Every authed request re-derives the role from identity `GET /v1/users/:id`
  (≤60s cache). Identity wins: revoke/disable ends the session. Identity
  unreachable with nothing cached → the login-time role in the token is used
  (stale-while-error); identity unconfigured → 503.
- **No env-var admin, no email allowlist, no fallback role, no dev bypass.**
  Local dev needs the real identity URL + this app's secret in `.env`.
- Adding a role = add it to `SESSION_ROLES` AND tell the identity owner to
  update the `hr` registry row in the same change.

## Conventions

- `npm run typecheck && npm test` before commits (vitest + PGlite; identity is
  mocked per test file, never called). Client: `npm --prefix client run build`.
- Migrations: `npm run db:generate` after schema edits, then apply out-of-band
  with `npm run db:migrate` (journal `hr.__migrations`). `0000_init.sql` uses
  `CREATE SCHEMA IF NOT EXISTS` because `scripts/create-role.sql` creates the
  schema owned by the scoped role first.
- Deploy: `npm run deploy` (Cloud Run `bm-hr`, project beastmode-pm,
  asia-southeast1, min-instances 0). Secrets: `bm-hr-database-url`,
  `bm-hr-jwt-secret`, `bm-identity-secret-hr`. See `DEPLOY.md`.
- `docs/wise-template.csv` is git-ignored (recipient PII); the committed
  header is `docs/wise-template-header.csv`.
