import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './context/AuthContext';
import { Shell } from './components/Shell';
import { Login } from './pages/Login';
import { Team } from './pages/Team';
import { MemberDetailPage } from './pages/MemberDetail';
import { MemberNew } from './pages/MemberNew';
import { Import } from './pages/Import';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="login-shell">
        <Spin size="large" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/team" replace />} />
        <Route path="team" element={<Team />} />
        <Route path="team/new" element={<MemberNew />} />
        <Route path="team/:id" element={<MemberDetailPage />} />
        <Route path="import" element={<Import />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
