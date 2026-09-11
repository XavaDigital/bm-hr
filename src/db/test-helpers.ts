/** Test-only PGlite database (bm-identity pattern); never imported by prod code. */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export async function createTestDb(): Promise<{ db: TestDb; client: PGlite }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder, migrationsSchema: 'hr', migrationsTable: '__migrations' });
  return { db, client };
}
