import { useEffect, useRef, useState } from 'react';
import { Alert, Typography } from 'antd';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, describeError } from '../api';
import { useAuth } from '../context/AuthContext';
import type { SessionUser } from '../types';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

export function Login() {
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const target = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ googleClientId: string | null }>('/api/auth/config')
      .then((c) => setClientId(c.googleClientId))
      .catch(() => setClientId(null));
  }, []);

  useEffect(() => {
    if (!clientId || !target.current) return;
    const render = () => {
      const g = window.google?.accounts.id;
      if (!g || !target.current) return;
      g.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          setError(null);
          try {
            const r = await api<{ user: SessionUser }>('/api/auth/google', { method: 'POST', json: { credential } });
            setUser(r.user);
            const from = (location.state as { from?: string } | null)?.from;
            navigate(from && from !== '/login' ? from : '/', { replace: true });
          } catch (err) {
            setError(describeError(err));
          }
        },
      });
      g.renderButton(target.current, { theme: 'outline', size: 'large', width: 280, text: 'signin_with' });
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (window.google?.accounts?.id) render();
    else if (existing) existing.addEventListener('load', render);
    else {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [clientId, location.state, navigate, setUser]);

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <div className="login-shell">
      <div className="login-card">
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          BeastMode HR
        </Typography.Title>
        <Typography.Paragraph className="muted">Sign in with your BeastMode Google account.</Typography.Paragraph>
        {clientId === null && <Alert type="warning" showIcon message="Sign-in is not configured on this deployment yet." />}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16, textAlign: 'left' }} />}
        <div ref={target} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      </div>
    </div>
  );
}
