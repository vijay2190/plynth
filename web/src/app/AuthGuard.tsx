import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './useSession';
import { Loader } from '@/components/ui/Loader';
import type { ReactNode } from 'react';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loader fullscreen label="Loading session…" />;
  if (!session) return <Navigate to="/auth/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
