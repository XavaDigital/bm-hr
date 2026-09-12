import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { mailConfigured } from './mail.js';
import { previewDigest, runDigest } from './service.js';

export const digestRouter = Router();
digestRouter.use(requireAuth, requireRole('admin'));

digestRouter.get('/preview', async (req, res) => {
  const asOf = typeof req.query['asOf'] === 'string' ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query['asOf']) : undefined;
  res.json({ ...(await previewDigest(asOf)), mailConfigured: mailConfigured() });
});

/** Send now to the configured recipients, or to `to` (e.g. a test send to yourself). */
digestRouter.post('/send', async (req, res) => {
  const { to } = z.object({ to: z.array(z.string().email()).max(20).optional() }).parse(req.body ?? {});
  if (!mailConfigured()) {
    res.status(501).json({ message: 'Email is not configured on this deployment (MAILGUN_API_KEY / MAILGUN_DOMAIN)', code: 'MAIL_UNCONFIGURED' });
    return;
  }
  const result = await runDigest({ force: true, to, actorEmail: req.user?.email });
  res.status(result.sent ? 200 : 502).json(result);
});
