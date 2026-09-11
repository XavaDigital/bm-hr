import { db } from './db/index.js';
import { auditLog } from './db/schema.js';

export interface Actor {
  id: string;
  email: string;
}

/** Append one audit row. Never throws into the caller's request. */
export async function recordAudit(
  actor: Actor | undefined,
  tableName: string,
  rowId: string,
  action: 'create' | 'update' | 'delete' | 'import',
  diff?: unknown,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      tableName,
      rowId,
      action,
      diff: diff ?? null,
    });
  } catch (err) {
    console.error('[audit] failed to record', tableName, rowId, action, err);
  }
}

/** Fields whose value changed between two records, as { field: [before, after] }. */
export function diffRecords<T extends Record<string, unknown>>(before: T, after: T): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) out[key] = [a, b];
  }
  return out;
}
