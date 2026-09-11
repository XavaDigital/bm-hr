import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL ?? 'postgres://localhost:5432/bm_hr';
const needsSsl = /supabase\.(com|co)/.test(url) || /sslmode=require/.test(url);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // The hr schema may share a physical Postgres with other fleet apps, so the
  // migration journal lives inside our own schema and never collides with
  // theirs (bm-identity precedent: identity.__migrations).
  migrations: { schema: 'hr', table: '__migrations' },
  dbCredentials: needsSsl ? { url, ssl: 'require' } : { url },
});
