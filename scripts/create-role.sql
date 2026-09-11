-- bm-hr database bootstrap. Run ONCE as the Supabase admin (postgres) role.
--
-- Creates the `hr` schema owned by a dedicated login role that can reach
-- nothing else, mirroring bm-identity's bm_identity_svc / identity schema.
-- Replace the password, then store the resulting URL in Secret Manager as
-- bm-hr-database-url:
--   postgres://bm_hr_svc:<password>@<host>:5432/postgres
-- (URL-encode the password if it contains special characters.)
--
-- Migrations (`npm run db:migrate` with that URL) create the tables inside
-- the schema; the migration journal lives at hr.__migrations.

create role bm_hr_svc login password 'REPLACE_ME';

create schema if not exists hr authorization bm_hr_svc;

-- Belt and braces: the role gets nothing in public and cannot create schemas.
revoke all on schema public from bm_hr_svc;
revoke create on database postgres from bm_hr_svc;

-- Supabase's pooler needs the role to be able to connect to the database.
grant connect on database postgres to bm_hr_svc;
