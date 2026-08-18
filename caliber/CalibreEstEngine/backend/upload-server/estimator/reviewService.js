/**
 * Estimate review/approval lifecycle (Phase 3) — reviewer assignment,
 * review decisions, resubmission, notifications, and the audit trail
 * entries for all of them. Deliberately a separate module from
 * estimatesService.js (CRUD/persistence) rather than folded into it: this
 * file is orchestration on TOP of that persistence layer, reusing its
 * exported helpers (getEstimateRow, requireEstimate, writeAudit,
 * insertVersion, proposeChanges, estimateToPublic/versionToPublic) rather
 * than re-implementing any of them. Same database (estimatesDb.js), same
 * audit table, same redaction (rateCardRedaction.js) — no second system.
 */
import { randomUUID } from 'crypto';
import db from './estimatesDb.js';
import { getUserById } from '../auth/users.js';
import { CAPABILITIES, roleCan } from '../../../frontend/calibre-app/src/constants/capabilities.js';
import { EstimateStatus, canTransition } from './estimateStatus.js';
import {
  AssignmentStatus, ReviewDecision, ALL_REVIEW_DECISIONS, DECISIONS_REQUIRING_COMMENTS,
  NotificationType, AuditAction,
} from './reviewTypes.js';
import {
  EstimateNotFoundError, EstimateAccessError,
  getEstimateRow, getVersionRow, getVersionRowById, requireEstimate, writeAudit,
  estimateToPublic, insertVersion, proposeChanges, now,
} from './estimatesService.js';
import { redactEstimateForRole } from './rateCardRedaction.js';
import { createNotification, listNotifications, markNotificationRead } from './notifications.js';
import { calculateEstimate } from './authoritativeEstimate.js';

export class ReviewValidationError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'ReviewValidationError';
    this.status = status;
  }
}

// Notifications (Part 12) now live in notifications.js — re-exported here so
// index.js's existing `reviewService.listNotifications(...)` call sites need
// no changes. projectService.js (Phase 4) imports the same module directly.
export { listNotifications, markNotificationRead };

// ── Reviewer assignment (Part 2, 4, 5) ──────────────────────────────────────

function getLatestAssignment(estimateId) {
  return db.prepare(
    'SELECT * FROM reviewer_assignments WHERE estimate_id = ? ORDER BY assigned_at DESC LIMIT 1',
  ).get(estimateId);
}

function assignmentToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    estimateId: row.estimate_id,
    versionId: row.version_id,
    reviewerUserId: row.reviewer_user_id,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
    status: row.status,
    completedAt: row.completed_at,
  };
}

/** Defense-in-depth re-check (Part 6) — even though assignReviewer() below
 * already validates unit match at assignment time, every reviewer-facing
 * action re-verifies it independently here too, so a future bug in the
 * assignment path alone could never silently grant cross-unit access.
 * Admin is exempt — admin remains global. */
function requireReviewerScope(estimateRow, actor) {
  if (actor.role === 'admin') return;
  if (estimateRow.business_unit && actor.unit !== estimateRow.business_unit) {
    throw new EstimateAccessError();
  }
}

function requireAssignedReviewer(estimateId, actor) {
  const assignment = getLatestAssignment(estimateId);
  if (!assignment) throw new ReviewValidationError('No reviewer is assigned to this estimate.', 404);
  if (actor.role !== 'admin' && assignment.reviewer_user_id !== actor.userId) {
    throw new EstimateAccessError();
  }
  return assignment;
}

/** Admin-only (REVIEWER_ASSIGN capability, gated at the route layer — see
 * Part 5: "if uncertain, prefer admin assigns reviewer", no uncontrolled
 * peer assignment). The reviewer must actually hold review authority
 * (ESTIMATE_APPROVE) and — unless they ARE admin — belong to the same
 * business unit as the estimate (Part 6, validated as early as possible,
 * not just at access time). */
export function assignReviewer({ estimateId, reviewerUserId, actor }) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  if (row.status === EstimateStatus.DRAFT || row.status === EstimateStatus.ARCHIVED) {
    throw new ReviewValidationError(`Cannot assign a reviewer while the estimate is ${row.status}.`);
  }

  const reviewer = getUserById(reviewerUserId);
  if (!reviewer || reviewer.status !== 'active') {
    throw new ReviewValidationError('Reviewer not found or not active.', 400);
  }
  if (!roleCan(reviewer.role, CAPABILITIES.ESTIMATE_APPROVE)) {
    throw new ReviewValidationError(`${reviewer.name} (${reviewer.role}) does not hold review authority.`, 400);
  }
  if (reviewer.role !== 'admin' && row.business_unit && reviewer.unit !== row.business_unit) {
    throw new ReviewValidationError(
      `${reviewer.name} belongs to unit "${reviewer.unit || 'unassigned'}", not "${row.business_unit}" — cannot assign across units.`,
      403,
    );
  }

  const versionRow = getVersionRow(estimateId, row.current_version);
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO reviewer_assignments (id, estimate_id, version_id, reviewer_user_id, assigned_by, assigned_at, status)
    VALUES (@id, @estimateId, @versionId, @reviewerUserId, @assignedBy, @assignedAt, @status)
  `).run({
    id,
    estimateId,
    versionId: versionRow.id,
    reviewerUserId,
    assignedBy: actor.userId,
    assignedAt: ts,
    status: AssignmentStatus.ASSIGNED,
  });

  writeAudit({
    estimateId,
    action: AuditAction.REVIEWER_ASSIGNED,
    actor,
    versionId: versionRow.id,
    metadata: { reviewerUserId, reviewerName: reviewer.name },
  });
  createNotification({
    userId: reviewerUserId,
    type: NotificationType.REVIEWER_ASSIGNED,
    estimateId,
    message: `You have been assigned estimate "${row.name}" for review.`,
  });

  return assignmentToPublic(getLatestAssignment(estimateId));
}

/** Owner, the assigned reviewer, or admin may view. */
export function getAssignment(estimateId, actor) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  const assignment = getLatestAssignment(estimateId);
  const isOwner = row.owner_user_id === actor.userId;
  const isAssignedReviewer = !!assignment && assignment.reviewer_user_id === actor.userId;
  if (!isOwner && !isAssignedReviewer && actor.role !== 'admin') {
    throw new EstimateAccessError();
  }
  return assignmentToPublic(assignment);
}

/** The reviewer's queue — assigned-to-me for super, everything for admin.
 * Never filtered client-side: the query itself only ever returns rows the
 * caller is entitled to see. */
export function listReviewQueue(actor) {
  const rows = actor.role === 'admin'
    ? db.prepare('SELECT * FROM reviewer_assignments ORDER BY assigned_at DESC').all()
    : db.prepare('SELECT * FROM reviewer_assignments WHERE reviewer_user_id = ? ORDER BY assigned_at DESC').all(actor.userId);

  return rows.map((a) => {
    const estimateRow = getEstimateRow(a.estimate_id);
    return {
      assignment: assignmentToPublic(a),
      estimate: estimateRow
        ? redactEstimateForRole(
          estimateToPublic(estimateRow, getVersionRow(a.estimate_id, estimateRow.current_version)),
          actor.role,
        )
        : null,
    };
  });
}

// ── Submit / resubmit (Part 1, 11) — owner-triggered transitions ───────────

/** DRAFT -> SUBMITTED. Pure status transition — no version change. */
export function submitEstimate({ estimateId, actor }) {
  const row = requireEstimate(estimateId, actor);
  if (row.status !== EstimateStatus.DRAFT) {
    throw new ReviewValidationError(`Cannot submit from status "${row.status}".`);
  }
  if (!canTransition(row.status, EstimateStatus.SUBMITTED)) {
    throw new ReviewValidationError(`Cannot transition from "${row.status}" to "${EstimateStatus.SUBMITTED}".`);
  }

  const ts = now();
  db.prepare('UPDATE estimates SET status = ?, updated_at = ? WHERE id = ?')
    .run(EstimateStatus.SUBMITTED, ts, estimateId);

  const versionRow = getVersionRow(estimateId, row.current_version);
  writeAudit({
    estimateId,
    action: AuditAction.ESTIMATE_SUBMITTED,
    actor,
    fromStatus: EstimateStatus.DRAFT,
    toStatus: EstimateStatus.SUBMITTED,
    versionId: versionRow.id,
  });

  return redactEstimateForRole(estimateToPublic(getEstimateRow(estimateId), versionRow), actor.role);
}

/** CHANGES_REQUESTED -> SUBMITTED, via a brand-new IMMUTABLE version (Part
 * 11) — reuses the exact same insertVersion() saveEstimate() already uses
 * (estimatesService.js); the version that was reviewed and found wanting is
 * never touched.
 *
 * Phase 4 Part 16/17: accepts EITHER `changes` (the scenario-delta
 * vocabulary, via the existing proposeChanges()/applyChanges() path — kept
 * for API/EVA-tool back-compat) OR a full `inputs` replacement (the real
 * "Revise Estimate" flow: the estimator wizard re-opened with this
 * estimate's current inputs, edited for real, and submitted whole — a
 * delta vocabulary can't represent an arbitrary wizard edit). Whichever
 * path runs, insertVersion() still server-derives previousVersionId from
 * (estimateId, current_version) and the version number is still
 * current_version+1 — never taken from the client (Part 17). */
export async function resubmitEstimate({
  estimateId, changes, inputs, changeReason, actor,
}, estimatorUrl) {
  const row = requireEstimate(estimateId, actor);
  if (row.status !== EstimateStatus.CHANGES_REQUESTED) {
    throw new ReviewValidationError(`Cannot resubmit from status "${row.status}" — changes must be requested first.`);
  }
  if (!changeReason?.trim()) {
    throw new ReviewValidationError('changeReason is required when resubmitting.');
  }

  let nextInputs;
  let scored;
  if (inputs) {
    if (!inputs.sectionA || !inputs.overrides) {
      throw new ReviewValidationError('inputs.sectionA and inputs.overrides are required.');
    }
    nextInputs = inputs;
    scored = await calculateEstimate(inputs, estimatorUrl);
  } else {
    ({ nextInputs, scored } = await proposeChanges(estimateId, changes, actor, estimatorUrl));
  }
  const nextVersion = row.current_version + 1;
  const versionRow = insertVersion({
    estimateId, version: nextVersion, inputs: nextInputs, scored, actor, changeReason,
  });

  const ts = now();
  db.prepare('UPDATE estimates SET current_version = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(nextVersion, EstimateStatus.SUBMITTED, ts, estimateId);

  writeAudit({
    estimateId,
    action: AuditAction.ESTIMATE_RESUBMITTED,
    actor,
    fromStatus: EstimateStatus.CHANGES_REQUESTED,
    toStatus: EstimateStatus.SUBMITTED,
    versionId: versionRow.id,
    reason: changeReason,
  });

  const assignment = getLatestAssignment(estimateId);
  if (assignment) {
    createNotification({
      userId: assignment.reviewer_user_id,
      type: NotificationType.ESTIMATE_RESUBMITTED,
      estimateId,
      message: `Estimate "${row.name}" was resubmitted with changes and is ready for re-review.`,
    });
  }

  return redactEstimateForRole(estimateToPublic(getEstimateRow(estimateId), versionRow), actor.role);
}

// ── Review start / decision (Part 7, 8, 9, 10) — reviewer-triggered ────────

/** SUBMITTED -> UNDER_REVIEW. Does not touch the estimate version. */
export function startReview({ estimateId, actor }) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  requireReviewerScope(row, actor);
  const assignment = requireAssignedReviewer(estimateId, actor);

  if (row.status !== EstimateStatus.SUBMITTED) {
    throw new ReviewValidationError(`Cannot start review from status "${row.status}".`);
  }
  if (!canTransition(row.status, EstimateStatus.UNDER_REVIEW)) {
    throw new ReviewValidationError(`Cannot transition from "${row.status}" to "${EstimateStatus.UNDER_REVIEW}".`);
  }

  const ts = now();
  db.prepare('UPDATE estimates SET status = ?, updated_at = ? WHERE id = ?')
    .run(EstimateStatus.UNDER_REVIEW, ts, estimateId);
  db.prepare('UPDATE reviewer_assignments SET status = ? WHERE id = ?')
    .run(AssignmentStatus.IN_REVIEW, assignment.id);

  const versionRow = getVersionRow(estimateId, row.current_version);
  writeAudit({
    estimateId,
    action: AuditAction.REVIEW_STARTED,
    actor,
    fromStatus: EstimateStatus.SUBMITTED,
    toStatus: EstimateStatus.UNDER_REVIEW,
    versionId: versionRow.id,
    metadata: { reviewerUserId: actor.userId },
  });

  return redactEstimateForRole(estimateToPublic(getEstimateRow(estimateId), versionRow), actor.role);
}

const DECISION_TO_STATUS = {
  [ReviewDecision.APPROVED]: EstimateStatus.APPROVED,
  [ReviewDecision.REJECTED]: EstimateStatus.REJECTED,
  [ReviewDecision.CHANGES_REQUESTED]: EstimateStatus.CHANGES_REQUESTED,
};
const DECISION_TO_AUDIT_ACTION = {
  [ReviewDecision.APPROVED]: AuditAction.ESTIMATE_APPROVED,
  [ReviewDecision.REJECTED]: AuditAction.ESTIMATE_REJECTED,
  [ReviewDecision.CHANGES_REQUESTED]: AuditAction.ESTIMATE_CHANGES_REQUESTED,
};
const DECISION_TO_NOTIFICATION_TYPE = {
  [ReviewDecision.APPROVED]: NotificationType.ESTIMATE_APPROVED,
  [ReviewDecision.REJECTED]: NotificationType.ESTIMATE_REJECTED,
  [ReviewDecision.CHANGES_REQUESTED]: NotificationType.CHANGES_REQUESTED,
};

/** UNDER_REVIEW -> APPROVED | REJECTED | CHANGES_REQUESTED. reviewedVersion
 * is REQUIRED and must match the estimate's actual current_version — this
 * is the stale-version guard (Part 17): a reviewer's client that has been
 * open a while, or has a second tab, must never be able to silently decide
 * on a version other than the one it displayed. The review record is
 * permanently tied to the exact version_id decided on and is never
 * updated afterward — a later version's review is a NEW row, not an
 * overwrite (Part 3's V1/V2 example). */
export function decideReview({
  estimateId, decision, comments, reviewedVersion, actor,
}) {
  if (!ALL_REVIEW_DECISIONS.includes(decision)) {
    throw new ReviewValidationError(`Unknown decision "${decision}". Must be one of: ${ALL_REVIEW_DECISIONS.join(', ')}.`);
  }
  if (DECISIONS_REQUIRING_COMMENTS.has(decision) && !comments?.trim()) {
    throw new ReviewValidationError(`A comment is required when the decision is "${decision}".`);
  }
  if (reviewedVersion === undefined || reviewedVersion === null) {
    throw new ReviewValidationError('reviewedVersion is required.');
  }

  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  requireReviewerScope(row, actor);
  requireAssignedReviewer(estimateId, actor);

  if (row.status !== EstimateStatus.UNDER_REVIEW) {
    throw new ReviewValidationError(`Cannot decide from status "${row.status}" — review must be started first.`);
  }
  if (Number(reviewedVersion) !== row.current_version) {
    throw new ReviewValidationError(
      `You reviewed version ${reviewedVersion}, but the estimate's current version is now ${row.current_version}. `
      + 'Refresh and review the current version.',
      409,
    );
  }

  const targetStatus = DECISION_TO_STATUS[decision];
  if (!canTransition(row.status, targetStatus)) {
    throw new ReviewValidationError(`Cannot transition from "${row.status}" to "${targetStatus}".`);
  }

  const versionRow = getVersionRow(estimateId, row.current_version);
  const ts = now();

  db.prepare(`
    INSERT INTO estimate_reviews (id, estimate_id, version_id, reviewer_user_id, decision, comments, created_at, updated_at)
    VALUES (@id, @estimateId, @versionId, @reviewerUserId, @decision, @comments, @createdAt, @updatedAt)
  `).run({
    id: randomUUID(),
    estimateId,
    versionId: versionRow.id,
    reviewerUserId: actor.userId,
    decision,
    comments: comments || null,
    createdAt: ts,
    updatedAt: ts,
  });

  if (decision === ReviewDecision.APPROVED) {
    db.prepare('UPDATE estimates SET status = ?, approved_version_id = ?, updated_at = ? WHERE id = ?')
      .run(targetStatus, versionRow.id, ts, estimateId);
  } else {
    db.prepare('UPDATE estimates SET status = ?, updated_at = ? WHERE id = ?')
      .run(targetStatus, ts, estimateId);
  }

  const assignment = getLatestAssignment(estimateId);
  if (assignment) {
    db.prepare('UPDATE reviewer_assignments SET status = ?, completed_at = ? WHERE id = ?')
      .run(AssignmentStatus.COMPLETED, ts, assignment.id);
  }

  writeAudit({
    estimateId,
    action: DECISION_TO_AUDIT_ACTION[decision],
    actor,
    fromStatus: EstimateStatus.UNDER_REVIEW,
    toStatus: targetStatus,
    versionId: versionRow.id,
    reason: comments || null,
  });

  const notificationText = decision === ReviewDecision.APPROVED
    ? `Your estimate "${row.name}" has been approved.`
    : decision === ReviewDecision.REJECTED
      ? `Your estimate "${row.name}" was rejected. Reason: ${comments}`
      : `Reviewer requested changes on estimate "${row.name}": ${comments}`;
  createNotification({
    userId: row.owner_user_id,
    type: DECISION_TO_NOTIFICATION_TYPE[decision],
    estimateId,
    message: notificationText,
  });

  return redactEstimateForRole(estimateToPublic(getEstimateRow(estimateId), versionRow), actor.role);
}

/** Every review ever made for this estimate, across every version — V1's
 * CHANGES_REQUESTED review and V2's APPROVED review are both always
 * returned, never merged or overwritten (Part 3). */
export function listReviews(estimateId, actor) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  const assignment = getLatestAssignment(estimateId);
  const isOwner = row.owner_user_id === actor.userId;
  const isAssignedReviewer = !!assignment && assignment.reviewer_user_id === actor.userId;
  const reviewedByActor = db.prepare(
    'SELECT 1 FROM estimate_reviews WHERE estimate_id = ? AND reviewer_user_id = ? LIMIT 1',
  ).get(estimateId, actor.userId);
  if (!isOwner && !isAssignedReviewer && !reviewedByActor && actor.role !== 'admin') {
    throw new EstimateAccessError();
  }

  const rows = db.prepare('SELECT * FROM estimate_reviews WHERE estimate_id = ? ORDER BY created_at ASC').all(estimateId);
  return rows.map((r) => {
    const versionRow = getVersionRowById(r.version_id);
    return {
      id: r.id,
      estimateId: r.estimate_id,
      versionId: r.version_id,
      version: versionRow ? versionRow.version : null,
      reviewerUserId: r.reviewer_user_id,
      decision: r.decision,
      comments: r.comments,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

// ── Reviewer ping (Part 13) ─────────────────────────────────────────────────

const PING_DEBOUNCE_MS = 5 * 60 * 1000; // simplest possible rate limit

/** Owner-only. Verifies a reviewer is actually assigned, then creates a
 * notification + audit event — never an approval action of any kind. */
export function pingReviewer({ estimateId, actor }) {
  const row = requireEstimate(estimateId, actor);
  const assignment = getLatestAssignment(estimateId);
  if (!assignment) {
    throw new ReviewValidationError('No reviewer is assigned to this estimate yet.', 404);
  }

  const lastPing = db.prepare(`
    SELECT created_at FROM estimate_audit_events
    WHERE estimate_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1
  `).get(estimateId, AuditAction.REVIEWER_PINGED);
  if (lastPing && Date.now() - new Date(lastPing.created_at).getTime() < PING_DEBOUNCE_MS) {
    throw new ReviewValidationError('You already pinged the reviewer recently. Please wait before pinging again.', 429);
  }

  createNotification({
    userId: assignment.reviewer_user_id,
    type: NotificationType.REVIEWER_PINGED,
    estimateId,
    message: `${actor.name} is waiting on your review of estimate "${row.name}".`,
  });
  writeAudit({
    estimateId, action: AuditAction.REVIEWER_PINGED, actor, versionId: assignment.version_id,
  });

  return { pinged: true, reviewerUserId: assignment.reviewer_user_id };
}
