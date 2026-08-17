import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { ROLES, isUnitScoped, isSelfScoped } from '../constants/roles';
import { roleCan, capabilitiesFor, denialMessage } from '../constants/capabilities';
import * as authApi from '../services/authApi';

const RoleContext = createContext(null);

export function RoleProvider({ children }) {
  // `user` is the single source of truth for identity now — role and
  // department are DERIVED from it, never independently settable (that's
  // exactly the mechanism that used to let anyone become "Admin" with one
  // click). isLoading covers the initial getMe() check on app mount so
  // ProtectedRoute doesn't flash a redirect-to-login before we know
  // whether a valid session cookie already exists.
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  // Kept for components that already key a CSS transition off it
  // (WorkflowGrid/HomePage); nothing sets this to true anymore now that
  // there's no free role-switching, but removing the field would break
  // those call sites for no benefit.
  const [isTransitioning] = useState(false);
  // Active Business Unit context, shared app-wide so EVA can scope
  // retrieval to whatever BU the user is currently browsing (e.g. in the
  // Knowledge Hub) without needing its own separate unit picker.
  const [activeUnitId, setActiveUnitId] = useState(null);

  useEffect(() => {
    let active = true;
    authApi.getMe()
      .then((u) => { if (active) setUser(u); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  const currentRoleId = user?.role ?? null;
  const currentRole = user ? ROLES[user.role] : null;
  const department = user?.department ?? null;

  const addToast = useCallback((message, color) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  }, []);

  const login = useCallback(async (email, password) => {
    const loggedInUser = await authApi.login(email, password); // throws on failure — LoginPage handles the error
    setUser(loggedInUser);
    addToast(`Welcome back, ${loggedInUser.name}`, ROLES[loggedInUser.role]?.color);
    return loggedInUser;
  }, [addToast]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Does the current role hold this capability? UX only — the server
   *  re-checks the same capability on every sensitive route, so hiding a
   *  control here is a convenience, never the security boundary. */
  const can = useCallback((capability) => roleCan(currentRoleId, capability), [currentRoleId]);

  /** Every capability the current role holds — drives nav/dashboard config. */
  const capabilities = useMemo(() => capabilitiesFor(currentRoleId), [currentRoleId]);

  /** Explain a denial in terms of what the role CAN do. */
  const whyDenied = useCallback((capability) => denialMessage(capability), []);

  return (
    <RoleContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      currentRole,
      currentRoleId,
      department,
      activeUnitId,
      setActiveUnitId,
      isTransitioning,
      toasts,
      dismissToast,
      can,
      capabilities,
      whyDenied,
      isUnitScoped: isUnitScoped(currentRoleId),
      isSelfScoped: isSelfScoped(currentRoleId),
    }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRoleContext() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRoleContext must be used within RoleProvider');
  return ctx;
}
