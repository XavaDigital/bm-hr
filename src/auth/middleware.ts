import type { NextFunction, Request, Response } from 'express';
import {
  SESSION_ROLES,
  identityConfigured,
  identityGetUser,
  resolveSessionGrant,
} from '../identity/client.js';
import { clearSessionCookie, tokenFromRequest, verifySession } from './session.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

/**
 * Requires a valid session AND a live `hr` grant from identity.
 *
 * The ROLE is identity's, re-derived on every request from `grants.hr`
 * (cached ≤60s). Identity wins: a downgrade or revocation lands within the
 * cache window, and a revoked grant or `disabled` ends the session with no
 * fallback. If identity is unreachable with nothing cached, the role from the
 * login-time verdict in the session token is used (stale-while-error), so an
 * outage never locks the owner out of an app that scales to zero and starts
 * with an empty cache. Identity unconfigured = fail closed (no local policy).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = tokenFromRequest(req);
  if (!token) {
    res.status(401).json({ message: 'Not signed in', code: 'NO_SESSION' });
    return;
  }
  const session = verifySession(token);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ message: 'Session expired', code: 'NO_SESSION' });
    return;
  }
  if (!identityConfigured()) {
    res.status(503).json({ message: 'Identity service not configured', code: 'IDENTITY_UNCONFIGURED' });
    return;
  }

  const verdict = resolveSessionGrant(await identityGetUser(session.userId));
  if (verdict.ok) {
    req.user = { id: session.userId, email: session.email, name: session.name, role: verdict.role };
    next();
    return;
  }
  if (verdict.reason === 'unavailable') {
    if (!SESSION_ROLES.has(session.role)) {
      res.status(503).json({ message: 'Identity service unavailable', code: 'IDENTITY_UNAVAILABLE' });
      return;
    }
    console.warn(`[auth] identity unreachable; serving ${session.email} on login-time role "${session.role}"`);
    req.user = { id: session.userId, email: session.email, name: session.name, role: session.role };
    next();
    return;
  }
  if (verdict.reason === 'unknown_role') {
    // Identity validates roles against our registered vocabulary on write, so
    // this is a registry-drift bug signal, not a normal state. Fail closed.
    console.error(
      `[auth] identity returned unrecognised hr role "${verdict.role}" for ${session.userId} — failing closed`,
    );
  }
  clearSessionCookie(res);
  res.status(403).json({
    message: verdict.reason === 'disabled' ? 'Account disabled' : 'You no longer have access to HR',
    code: verdict.reason === 'disabled' ? 'ACCOUNT_DISABLED' : 'NO_APP_ACCESS',
  });
}

/** Requires one of the given roles (run after requireAuth). */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Access denied', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}
