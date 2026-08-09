import { Navigate } from 'react-router-dom';
import { useRoleContext } from '../../contexts/RoleContext';

/** Wraps a route element — redirects to /login if there's no authenticated
 * session. Renders nothing while the initial getMe() check is in flight
 * (RoleContext.isLoading) so a page reload doesn't flash a login redirect
 * before we actually know whether the session cookie is still valid.
 */
export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useRoleContext();

  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
