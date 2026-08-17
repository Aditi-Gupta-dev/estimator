/**
 * Server-side redaction of rate-card figures from a bottomUp result —
 * the estimate-persistence counterpart to /api/files' rate-card document
 * redaction and eva_service's sanitize_estimator_context(). All three exist
 * for the same reason: the frontend hides these values in the UI, but that
 * is never the authorization boundary — the server must never SEND a
 * restricted figure to a role that isn't allowed to see it, regardless of
 * what the client claims about its own role.
 *
 * computeBottomUp() (frontend/calibre-app/src/lib/estimatorEngine.js)
 * always computes costByRole[role].blendedRate server-side, since only the
 * server has the real rate card (see estimator/rateCard.js) — the browser
 * itself can never compute this figure. Every persisted-estimate response
 * and the direct /api/estimate/calculate response flow through this same
 * costByRole shape, so a single redaction point here covers all of them.
 *
 * Only blendedRate (the actual $/day figure) is restricted. Aggregate
 * effortDays/cost/totalCost stay untouched for every role — the estimator
 * still needs those to understand their own estimate; RATE_CARD_VIEW only
 * gates the underlying rate itself, never the totals derived from it.
 */
import { CAPABILITIES, roleCan } from '../../../frontend/calibre-app/src/constants/capabilities.js';

/** @param {object|null} bottomUp  a computeBottomUp()-shaped result
 *  @param {string} role           the AUTHENTICATED caller's role — never a
 *    role claimed in a request body; every call site below passes
 *    req.user.role or an internal route's server-re-validated actor.role. */
export function redactBottomUpForRole(bottomUp, role) {
  if (!bottomUp || !bottomUp.costByRole) return bottomUp;
  if (roleCan(role, CAPABILITIES.RATE_CARD_VIEW)) return bottomUp;

  const costByRole = {};
  for (const [roleName, entry] of Object.entries(bottomUp.costByRole)) {
    const { blendedRate, ...rest } = entry;
    costByRole[roleName] = rest;
  }
  return { ...bottomUp, costByRole };
}

/** Redacts the bottomUp nested inside a version object (estimatesService.js's
 * versionToPublic() shape: { version, inputs, bottomUp, ml, health, ... }). */
export function redactVersionForRole(version, role) {
  if (!version) return version;
  return { ...version, bottomUp: redactBottomUpForRole(version.bottomUp, role) };
}

/** Redacts the bottomUp nested inside an estimate object's latestVersion
 * (estimatesService.js's estimateToPublic() shape). */
export function redactEstimateForRole(estimate, role) {
  if (!estimate) return estimate;
  return { ...estimate, latestVersion: redactVersionForRole(estimate.latestVersion, role) };
}
