/**
 * Backups: a JSON dump of every hr table. Downloadable by an admin, and
 * uploadable to a Cloud Storage bucket by the nightly job. The upload uses
 * the Cloud Run service account's token from the metadata server and the
 * GCS JSON API — no SDK. Env-gated on BACKUP_BUCKET.
 */
import { db } from '../../db/index.js';
import {
  auditLog,
  checklistTasks,
  checklistTemplates,
  compensation,
  leaveAdjustments,
  leavePolicies,
  leaveRequests,
  memberEvents,
  payRunLines,
  payRuns,
  paySchedules,
  settings,
  teamMembers,
} from '../../db/schema.js';

const TABLES = {
  team_members: teamMembers,
  compensation,
  pay_schedules: paySchedules,
  settings,
  pay_runs: payRuns,
  pay_run_lines: payRunLines,
  leave_policies: leavePolicies,
  leave_requests: leaveRequests,
  leave_adjustments: leaveAdjustments,
  checklist_templates: checklistTemplates,
  checklist_tasks: checklistTasks,
  member_events: memberEvents,
  audit_log: auditLog,
} as const;

export interface BackupDump {
  service: 'bm-hr';
  version: 1;
  takenAt: string;
  tables: Record<keyof typeof TABLES, unknown[]>;
  counts: Record<keyof typeof TABLES, number>;
}

export async function dumpAll(): Promise<BackupDump> {
  const tables = {} as BackupDump['tables'];
  const counts = {} as BackupDump['counts'];
  for (const [name, table] of Object.entries(TABLES) as [keyof typeof TABLES, (typeof TABLES)[keyof typeof TABLES]][]) {
    const rows = await db.select().from(table);
    tables[name] = rows;
    counts[name] = rows.length;
  }
  return { service: 'bm-hr', version: 1, takenAt: new Date().toISOString(), tables, counts };
}

export function backupConfigured(): boolean {
  return !!process.env.BACKUP_BUCKET;
}

let fetchOverride: typeof fetch | null = null;
export function setBackupFetchForTests(fn: typeof fetch | null): void {
  fetchOverride = fn;
}

/** Access token: GOOGLE_ACCESS_TOKEN for local runs, else the Cloud Run metadata server. */
async function accessToken(doFetch: typeof fetch): Promise<string> {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  const res = await doFetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`metadata server answered ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('metadata server returned no token');
  return body.access_token;
}

export interface UploadResult {
  bucket: string;
  object: string;
  bytes: number;
  counts: BackupDump['counts'];
}

export async function uploadBackup(): Promise<UploadResult> {
  const bucket = process.env.BACKUP_BUCKET;
  if (!bucket) throw new Error('BACKUP_BUCKET is not set');
  const doFetch = fetchOverride ?? fetch;
  const dump = await dumpAll();
  const object = `bm-hr/${dump.takenAt.slice(0, 10)}/hr-${dump.takenAt.replace(/[:.]/g, '-')}.json`;
  const body = JSON.stringify(dump);
  const token = await accessToken(doFetch);
  const res = await doFetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GCS upload failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return { bucket, object, bytes: Buffer.byteLength(body), counts: dump.counts };
}
