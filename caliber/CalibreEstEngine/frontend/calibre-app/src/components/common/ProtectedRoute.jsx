import { Navigate } from 'react-router-dom';
import { useRoleContext } from '../../contexts/RoleContext';

/** Wraps a route element — redirects to /login if there's no authenticated
 * session. Renders nothing while the initial getMe() check is in flight
 * (RoleContext.isLoading) so a page reload doesn't flash a login redirect
 * before we actually know whether the session cookie is still valid.
 */
export function ProtectedRoute({ children, requires }) {
  const { isAuthenticated, isLoading, can } = useRoleContext();

  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // A role without the capability is sent home rather than shown a workspace
  // whose actions the server will refuse anyway (e.g. senior_mgmt opening the
  // estimator, where /api/score returns 403). This is honest UX, not the
  // security boundary — that stays server-side.
  if (requires && !can(requires)) return <Navigate to="/home" replace />;
  return children;
}
