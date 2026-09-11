/**
 * Session = short-lived signed JWT in an HttpOnly cookie, minted only after
 * bm-identity has granted access. The `role` claim is the last verdict
 * identity gave at login; auth/middleware.ts re-derives the live role from
 * identity on every request and only falls back to this claim when identity
 * is unreachable with nothing cached (stale-while-error, contract rule 8).
 */
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

export const COOKIE_NAME = 'hr_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign({ ...payload, scope: 'hr-session' }, secret(), { expiresIn: MAX_AGE_SECONDS });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret());
    if (typeof decoded !== 'object' || decoded === null) return null;
    const d = decoded as Record<string, unknown>;
    if (d['scope'] !== 'hr-session' || typeof d['userId'] !== 'string') return null;
    return {
      userId: d['userId'],
      email: typeof d['email'] === 'string' ? d['email'] : '',
      name: typeof d['name'] === 'string' ? d['name'] : '',
      role: typeof d['role'] === 'string' ? d['role'] : '',
    };
  } catch {
    return null;
  }
}

/** Bearer header first; HttpOnly cookie fallback. No cookie-parser dep. */
export function tokenFromRequest(req: Request): string | undefined {
  const header = req.header('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookies = req.headers.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}
