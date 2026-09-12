/**
 * Cloud Scheduler entry points (bm-sales pattern). Cloud Run scales to zero,
 * so nothing runs on a timer inside the process; the scheduler POSTs here
 * with the shared X-Job-Secret header. See DEPLOY.md §7.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { recordAudit } from '../../audit.js';
import { backupConfigured, uploadBackup } from '../backup/service.js';
import { runDigest } from '../digest/service.js';

export const internalRouter = Router();

internalRouter.use((req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret) {
    res.status(501).json({ message: 'INTERNAL_JOB_SECRET is not set' });
    return;
  }
  if (req.header('X-Job-Secret') !== secret) {
    res.status(401).json({ message: 'unauthorized' });
    return;
  }
  next();
});

/** Weekly digest (honours the enabled flag in settings). */
internalRouter.post('/digest', async (_req, res) => {
  res.json(await runDigest());
});

/** Nightly snapshot to the backup bucket. */
internalRouter.post('/backup', async (_req, res) => {
  if (!backupConfigured()) {
    res.json({ uploaded: false, reason: 'BACKUP_BUCKET not set' });
    return;
  }
  try {
    const r = await uploadBackup();
    await recordAudit(undefined, 'backup', r.object, 'create', { via: 'scheduler', bytes: r.bytes, counts: r.counts });
    res.json({ uploaded: true, ...r });
  } catch (err) {
    console.error('[backup] nightly upload failed', err);
    res.status(502).json({ uploaded: false, reason: err instanceof Error ? err.message : 'failed' });
  }
});
