import { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { recordAudit } from '../../audit.js';
import { backupConfigured, dumpAll, uploadBackup } from './service.js';

export const backupRouter = Router();
backupRouter.use(requireAuth, requireRole('admin'));

backupRouter.get('/status', (_req, res) => {
  res.json({ bucket: process.env.BACKUP_BUCKET ?? null, configured: backupConfigured() });
});

/** Download everything as one JSON file. */
backupRouter.get('/download', async (req, res) => {
  const dump = await dumpAll();
  await recordAudit(req.user, 'backup', dump.takenAt, 'create', { via: 'download', counts: dump.counts });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bm-hr-backup-${dump.takenAt.slice(0, 10)}.json"`);
  res.send(JSON.stringify(dump, null, 2));
});

/** Push a snapshot to the bucket now. */
backupRouter.post('/upload', async (req, res) => {
  if (!backupConfigured()) {
    res.status(501).json({ message: 'BACKUP_BUCKET is not set on this deployment', code: 'BACKUP_UNCONFIGURED' });
    return;
  }
  const r = await uploadBackup();
  await recordAudit(req.user, 'backup', r.object, 'create', { via: 'manual', bytes: r.bytes, counts: r.counts });
  res.json(r);
});
