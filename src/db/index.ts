/**
 * Production database client. The hr schema lives on a physical Postgres it
 * may share with other fleet apps, but under a DEDICATED role scoped to the
 * `hr` schema only (scripts/create-role.sql). Moving to a separate instance
 * later is a one-URL config change. Tests swap this module for PGlite via
 * vi.mock (bm-identity / bm-sales pattern).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
const needsSsl = !!url && (/supabase\.(com|co)/.test(url) || /sslmode=require/.test(url));
const client = url ? postgres(url, { max: 5, ...(needsSsl ? { ssl: 'require' as const } : {}) }) : null;

export const db = client ? drizzle(client, { schema }) : (null as never);

export async function dbReady(): Promise<'connected' | 'not_configured' | 'error'> {
  if (!client) return 'not_configured';
  try {
    await db.execute(sql`select 1`);
    return 'connected';
  } catch {
    return 'error';
  }
}

export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
}
