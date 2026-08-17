import { useRoleContext } from '../../contexts/RoleContext';

/**
 * Renders children only when the current role holds `capability`.
 *
 * This is UX, not security: it decides what to *show*. Every sensitive
 * operation is re-checked server-side by requireCapability(), so a user who
 * edits their session in devtools gains a visible button and nothing more.
 *
 *   <PermissionGate capability={CAPABILITIES.USER_MANAGE}>…</PermissionGate>
 *
 * Pass `fallback` to explain the absence instead of silently hiding — prefer
 * that wherever the missing thing is something the user might look for.
 */
export function PermissionGate({ capability, children, fallback = null }) {
  const { can } = useRoleContext();
  return can(capability) ? children : fallback;
}

/** Inline "why can't I?" note, phrased around what the role CAN do. */
export function PermissionNote({ capability }) {
  const { whyDenied } = useRoleContext();
  return <p className="permission-note">{whyDenied(capability)}</p>;
}
