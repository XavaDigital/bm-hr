/**
 * Google sign-in, DELEGATED to bm-identity. This module never verifies a
 * Google credential and never decides who may sign in: the credential is
 * relayed verbatim, identity runs the fleet policy and the `hr` grant, and we
 * act on its verdict. What stays local is minting our own session cookie.
 */
import { Router } from 'express';
import { APP_ID, SESSION_ROLES, identityConfigured, identityGoogleLogin } from '../identity/client.js';
import { requireAuth } from './middleware.js';
import { clearSessionCookie, setSessionCookie, signSession } from './session.js';

export const authRouter = Router();

/** Public runtime config — the SPA shows the Google button only when set. */
authRouter.get('/config', (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_LOGIN_CLIENT_ID || null,
    identityConfigured: identityConfigured(),
  });
});

authRouter.post('/google', async (req, res) => {
  if (!identityConfigured()) {
    res.status(501).json({ message: 'Sign-in is not configured yet', code: 'IDENTITY_UNCONFIGURED' });
    return;
  }
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || !credential) {
    res.status(400).json({ message: 'credential is required' });
    return;
  }
  let result: Awaited<ReturnType<typeof identityGoogleLogin>>;
  try {
    result = await identityGoogleLogin(credential);
  } catch {
    res.status(503).json({ message: 'Sign-in is temporarily unavailable — please try again shortly' });
    return;
  }
  if (result.status !== 200) {
    // Relay the fleet verdict verbatim (403 NO_APP_ACCESS / NOT_AUTHORISED included).
    res.status(result.status).json(result.body);
    return;
  }
  const access = result.body['access'] as { granted?: boolean; role?: string } | undefined;
  const user = result.body['user'] as { id?: string; email?: string; name?: string } | undefined;
  if (!access?.granted || !access.role || !user?.id || !user.email) {
    // Contract-anomalous shape: never mint a session from it.
    res.status(403).json({ message: `No access to ${APP_ID}`, code: 'NO_APP_ACCESS' });
    return;
  }
  if (!SESSION_ROLES.has(access.role)) {
    console.error(`[auth] identity returned unknown hr role "${access.role}" at login — failing closed`);
    res.status(403).json({ message: 'Your account role is not recognised', code: 'NO_APP_ACCESS' });
    return;
  }
  const session = { userId: user.id, email: user.email, name: user.name || user.email, role: access.role };
  setSessionCookie(res, signSession(session));
  res.json({ user: { id: session.userId, email: session.email, name: session.name, role: session.role } });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
