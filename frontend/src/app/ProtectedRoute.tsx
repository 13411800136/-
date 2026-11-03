import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, homeForRole } from './AuthContext';
import type { Role } from '../lib/types';
import { Loader2 } from 'lucide-react';

export function ProtectedRoute({ roles, children }: { roles?: Role[]; children?: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="app-boot">
        <div className="boot-mark">厂序</div>
        <Loader2 className="spin" size={22} />
        <p>正在恢复会话…</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

export function GuestRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="app-boot">
        <div className="boot-mark">厂序</div>
        <Loader2 className="spin" size={22} />
      </div>
    );
  }
  if (user) return <Navigate to={homeForRole(user.role)} replace />;
  return <Outlet />;
}
