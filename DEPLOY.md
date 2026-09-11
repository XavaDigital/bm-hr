# Deploying bm-hr

One-time setup, then `npm run deploy` for every release.

## 1. Database role and schema (once)

As the Supabase admin, run `scripts/create-role.sql` with a real password.
Store the connection string in Secret Manager:

```
printf 'postgres://bm_hr_svc:<url-encoded-password>@<host>:5432/postgres' \
  | gcloud secrets create bm-hr-database-url --project beastmode-pm --data-file=-
```

## 2. Session secret (once)

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" \
  | gcloud secrets create bm-hr-jwt-secret --project beastmode-pm --data-file=-
```

## 3. Google OAuth client (once)

In the beastmode-pm Google Cloud console, create an OAuth client id of type
Web application for "BeastMode HR". Authorised JavaScript origins: the Cloud
Run URL (and later the custom domain). No redirect URIs are needed for the
GIS button flow. Put the id into the `deploy` script in `package.json` in
place of `REPLACE_WITH_HR_GOOGLE_CLIENT_ID`. It is public by nature.

## 4. Onboard the app in bm-identity (once)

From the bm-identity repo, in a gcloud-authenticated shell:

```
node scripts/onboard-app.mjs \
  --id hr --name "HR" \
  --roles admin \
  --admin-email david@xavadigital.com \
  --google-client-id <the id from step 3>
```

This creates the registry row, stores the bearer at Secret Manager
`bm-identity-secret-hr`, and grants the admin email the `admin` role. Nothing
to deploy on the identity side.

## 5. Migrate

```
DATABASE_URL='<the url from step 1>' npm run db:migrate
```

Re-run after every new migration file in `drizzle/`.

## 6. Deploy

```
npm run deploy
```

Cloud Run builds the Dockerfile from source, runs at min-instances 0 (scale
to zero; the app is used a few times a week) and reads `PORT`, the three
secrets, `IDENTITY_API_URL` and `GOOGLE_LOGIN_CLIENT_ID` from the service
config. Check `https://<service-url>/api/health` afterwards.

## Local development

Copy `.env.example` to `.env`. You need the real identity URL and this app's
bearer secret (`gcloud secrets versions access latest --secret bm-identity-secret-hr --project beastmode-pm`),
plus a Postgres (`DATABASE_URL`) with the migrations applied. Then:

```
npm run dev                     # API on :8080
npm --prefix client run dev     # Vite on :5173, proxies /api to :8080
```

Add `http://localhost:5173` as an authorised JavaScript origin on the Google
client for the sign-in button to render locally.
