import { verifyToken } from './jwt.js';
import { getUserById, toPublicUser } from './users.js';
// Same capability map the React app uses — imported, not re-declared, so the
// browser's idea of a role's rights and the server's cannot drift apart (the
// drift that previously let roles.js claim all five roles could see rate
// cards). The server remains the authority: the frontend only uses this to
// decide what to render, every sensitive route re-checks here.
import { roleCan, denialMessage } from '../../../frontend/calibre-app/src/constants/capabilities.js';

export const AUTH_COOKIE_NAME = 'calibre_token';

/** Verifies the httpOnly session cookie and attaches req.user — the ONE
 * source of truth for "who is making this request" from here on. Route
 * handlers must never trust a role/identity field from req.body again.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
  }

  const user = getUserById(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ success: false, error: 'Account no longer active.' });
  }

  req.user = toPublicUser(user);
  next();
}

/** Must run after requireAuth. */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

/** Capability-based gate — preferred over requireRole, since the allowed set
 * comes from the shared map rather than being retyped at each route.
 * Must run after requireAuth. Returns a message naming what the role CAN do,
 * so clients can degrade gracefully instead of showing "Access Denied".
 */
export function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated.' });
    }
    if (!roleCan(req.user.role, capability)) {
      return res.status(403).json({
        success: false,
        error: denialMessage(capability),
        capability,
        role: req.user.role,
      });
    }
    next();
  };
}
