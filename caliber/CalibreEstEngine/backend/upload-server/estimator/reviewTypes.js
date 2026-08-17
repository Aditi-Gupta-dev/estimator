/**
 * Small enums for the review/approval lifecycle (Phase 3) — mirrors
 * estimateStatus.js's pattern (plain string constants, no framework).
 */

export const AssignmentStatus = {
  ASSIGNED: 'assigned',
  IN_REVIEW: 'in_review',
  COMPLETED: 'completed',
};

export const ReviewDecision = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CHANGES_REQUESTED: 'changes_requested',
};

export const ALL_REVIEW_DECISIONS = Object.values(ReviewDecision);

// Decisions that require the reviewer to explain themselves — approval
// needs no justification, but the estimator must never be left guessing
// why something was rejected or what to change.
export const DECISIONS_REQUIRING_COMMENTS = new Set([
  ReviewDecision.REJECTED,
  ReviewDecision.CHANGES_REQUESTED,
]);

export const NotificationType = {
  REVIEWER_ASSIGNED: 'reviewer_assigned',
  REVIEW_STARTED: 'review_started',
  ESTIMATE_APPROVED: 'estimate_approved',
  ESTIMATE_REJECTED: 'estimate_rejected',
  CHANGES_REQUESTED: 'changes_requested',
  ESTIMATE_RESUBMITTED: 'estimate_resubmitted',
  REVIEWER_PINGED: 'reviewer_pinged',
};

// Audit action names (Phase 3 Part 14) — written via estimatesService.js's
// existing writeAudit() helper, the same table/function used since Phase 1
// for create/save_version/status_change/clone. No second audit system.
export const AuditAction = {
  ESTIMATE_SUBMITTED: 'ESTIMATE_SUBMITTED',
  REVIEWER_ASSIGNED: 'REVIEWER_ASSIGNED',
  REVIEW_STARTED: 'REVIEW_STARTED',
  ESTIMATE_APPROVED: 'ESTIMATE_APPROVED',
  ESTIMATE_REJECTED: 'ESTIMATE_REJECTED',
  ESTIMATE_CHANGES_REQUESTED: 'ESTIMATE_CHANGES_REQUESTED',
  ESTIMATE_RESUBMITTED: 'ESTIMATE_RESUBMITTED',
  REVIEWER_PINGED: 'REVIEWER_PINGED',
};
