/**
 * Estimate lifecycle — ports the same explicit-transition-table design
 * already used for Knowledge Hub document governance
 * (eva_service/src/storage/document_status.py's can_transition) rather than
 * allowing "any status to any status". Terminal states (APPROVED, REJECTED,
 * ARCHIVED) can only return to DRAFT for rework, never skip straight back
 * into the workflow.
 */
export const EstimateStatus = {
  DRAFT: 'draft',
  REVIEW: 'review',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
};

export const ALL_STATUSES = Object.values(EstimateStatus);

const ALLOWED_TRANSITIONS = {
  [EstimateStatus.DRAFT]: new Set([EstimateStatus.REVIEW, EstimateStatus.ARCHIVED]),
  [EstimateStatus.REVIEW]: new Set([EstimateStatus.SUBMITTED, EstimateStatus.DRAFT]),
  [EstimateStatus.SUBMITTED]: new Set([EstimateStatus.APPROVED, EstimateStatus.REJECTED, EstimateStatus.DRAFT]),
  [EstimateStatus.APPROVED]: new Set([EstimateStatus.ARCHIVED]),
  [EstimateStatus.REJECTED]: new Set([EstimateStatus.DRAFT, EstimateStatus.ARCHIVED]),
  [EstimateStatus.ARCHIVED]: new Set([EstimateStatus.DRAFT]),
};

export function canTransition(current, target) {
  if (!ALL_STATUSES.includes(target)) return false;
  if (current === target) return true; // setting the same status is a no-op, not an error
  return ALLOWED_TRANSITIONS[current]?.has(target) ?? false;
}
