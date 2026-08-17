/**
 * Estimate lifecycle.
 *
 * PHASE 3 AUDIT (documented per the phase's Part 1 requirement — see the
 * phase report for the full mapping): the pre-existing enum was
 * {draft, review, submitted, approved, rejected, archived} with
 * draft->review->submitted->approved/rejected. That `review` status was
 * never actually reachable by any real code path (no route or tool ever
 * set it — confirmed by grep before this change) and, more importantly, it
 * sat BEFORE `submitted` in the old graph, which does not correspond to
 * "a reviewer is actively reviewing" (which must happen AFTER submission).
 * It has been removed and replaced with `under_review` and
 * `changes_requested`, positioned correctly relative to `submitted` per
 * the required business workflow. draft/submitted/approved/rejected are
 * reused unchanged — they already meant exactly what the new workflow
 * needs. `archived` is also reused unchanged as an administrative
 * (non-review-lifecycle) terminal state, gated by the pre-existing
 * ESTIMATE_APPROVE-capability status route (untouched this phase).
 *
 * The 6 core review-lifecycle transitions below are exactly the ones
 * required — nothing else. Each is additionally enforced by a DEDICATED
 * service function (reviewService.js) that checks the specific actor/role
 * allowed to make THAT transition (owner for submit/resubmit, the assigned
 * in-scope reviewer for start/decide) — canTransition() alone is the
 * state-graph guard, not the authorization boundary.
 */
export const EstimateStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
};

export const ALL_STATUSES = Object.values(EstimateStatus);

const ALLOWED_TRANSITIONS = {
  // Estimator submits a draft for review.
  [EstimateStatus.DRAFT]: new Set([EstimateStatus.SUBMITTED, EstimateStatus.ARCHIVED]),
  // Reviewer starts working the submitted version.
  [EstimateStatus.SUBMITTED]: new Set([EstimateStatus.UNDER_REVIEW]),
  // Reviewer's decision — exactly one of three outcomes.
  [EstimateStatus.UNDER_REVIEW]: new Set([
    EstimateStatus.APPROVED, EstimateStatus.REJECTED, EstimateStatus.CHANGES_REQUESTED,
  ]),
  // Estimator resubmits a NEW version in response to feedback.
  [EstimateStatus.CHANGES_REQUESTED]: new Set([EstimateStatus.SUBMITTED]),
  // Terminal outcomes — administrative archive only, no path back into the
  // review lifecycle (a rejected/approved estimate is not reused; a new
  // estimate is created if the work continues).
  [EstimateStatus.APPROVED]: new Set([EstimateStatus.ARCHIVED]),
  [EstimateStatus.REJECTED]: new Set([EstimateStatus.ARCHIVED]),
  [EstimateStatus.ARCHIVED]: new Set([EstimateStatus.DRAFT]),
};

export function canTransition(current, target) {
  if (!ALL_STATUSES.includes(target)) return false;
  if (current === target) return true; // setting the same status is a no-op, not an error
  return ALLOWED_TRANSITIONS[current]?.has(target) ?? false;
}
