/**
 * Approved-estimate -> project baseline -> project tracking (Phase 4).
 * Mirrors reviewService.js's shape: a separate orchestration module on top
 * of the same persistence layer (estimatesDb.js), reusing estimatesService's
 * exported helpers (getEstimateRow, getVersionRowById, writeAudit) and
 * notifications.js's shared notification functions — no second audit
 * system, no second notification table, no new database.
 */
import { randomUUID } from 'crypto';
import db from './estimatesDb.js';
import { CAPABILITIES, roleCan } from '../../../frontend/calibre-app/src/constants/capabilities.js';
import { EstimateStatus } from './estimateStatus.js';
import { ProjectStatus, canTransition } from './projectStatus.js';
import { AuditAction, NotificationType } from './reviewTypes.js';
import {
  getEstimateRow, getVersionRowById, writeAudit, now,
} from './estimatesService.js';
import { redactVersionForRole, redactProjectUpdateForRole } from './rateCardRedaction.js';
import { createNotification } from './notifications.js';

export class ProjectNotFoundError extends Error {
  constructor(message = 'Project not found.') {
    super(message);
    this.name = 'ProjectNotFoundError';
    this.status = 404;
  }
}

export class ProjectAccessError extends Error {
  constructor(message = 'You do not have access to this project.') {
    super(message);
    this.name = 'ProjectAccessError';
    this.status = 403;
  }
}

export class ProjectValidationError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'ProjectValidationError';
    this.status = status;
  }
}

// ── Shape helpers ────────────────────────────────────────────────────────────

function projectToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectKey: row.project_key,
    name: row.name,
    description: row.description,
    estimateId: row.estimate_id,
    baselineEstimateVersionId: row.baseline_estimate_version_id,
    currentEstimateVersionId: row.current_estimate_version_id,
    ownerUserId: row.owner_user_id,
    unit: row.unit,
    domain: row.domain,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function updateToPublic(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updateType: row.update_type,
    title: row.title,
    description: row.description,
    status: row.status,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    requiresEstimateReview: !!row.requires_estimate_review,
  };
}

export function getProjectRow(projectId) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
}

/** Admin: global. Super: unit-scoped (project.unit === actor.unit). Owner
 * (the estimate's original owner — see createProjectFromEstimate): always.
 * Everyone else: denied. Server-side filtering, never frontend-only (Part
 * 11) — this same check backs both getProject and listProjects. */
function canAccessProject(row, actor) {
  if (actor.role === 'admin') return true;
  if (row.owner_user_id === actor.userId) return true;
  if (actor.role === 'super' && row.unit && actor.unit === row.unit) return true;
  return false;
}

export function requireProjectAccess(projectId, actor) {
  const row = getProjectRow(projectId);
  if (!row) throw new ProjectNotFoundError();
  if (!canAccessProject(row, actor)) throw new ProjectAccessError();
  return row;
}

function nextProjectKey() {
  const { c } = db.prepare('SELECT COUNT(*) c FROM projects').get();
  return `PRJ-${String(c + 1).padStart(5, '0')}`;
}

function getLatestAssignmentForEstimate(estimateId) {
  return db.prepare(
    'SELECT * FROM reviewer_assignments WHERE estimate_id = ? ORDER BY assigned_at DESC LIMIT 1',
  ).get(estimateId);
}

// ── Part 3/5 — Create project from an approved estimate ─────────────────────

/** The server determines baseline_estimate_version_id — it is never taken
 * from the request body (Part 5/18.12). Idempotency (Part 5): a second call
 * for the same estimate returns the existing non-cancelled project rather
 * than creating a duplicate or erroring — safe against a repeated click. */
export function createProjectFromEstimate({
  estimateId, name, description, domain, actor,
}) {
  if (!roleCan(actor.role, CAPABILITIES.PROJECT_CREATE)) {
    throw new ProjectAccessError('You do not have permission to create projects.');
  }

  const estimateRow = getEstimateRow(estimateId);
  if (!estimateRow) throw new ProjectValidationError('Estimate not found.', 404);
  if (estimateRow.status !== EstimateStatus.APPROVED) {
    throw new ProjectValidationError(`Cannot create a project from an estimate with status "${estimateRow.status}" — it must be approved.`, 409);
  }
  if (!estimateRow.approved_version_id) {
    throw new ProjectValidationError('Estimate has no approved version on record.', 409);
  }
  const approvedVersion = getVersionRowById(estimateRow.approved_version_id);
  if (!approvedVersion || approvedVersion.estimate_id !== estimateId) {
    throw new ProjectValidationError('Approved version does not belong to this estimate.', 409);
  }

  // Unit scope (Part 4): super may only baseline estimates within their own
  // unit, mirroring the reviewer-assignment unit check. Admin is exempt.
  if (actor.role !== 'admin' && estimateRow.business_unit && actor.unit !== estimateRow.business_unit) {
    throw new ProjectAccessError('You do not have authority to create a project for this business unit.');
  }

  const existing = db.prepare(
    "SELECT * FROM projects WHERE estimate_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1",
  ).get(estimateId, ProjectStatus.CANCELLED);
  if (existing) {
    return { project: projectToPublic(existing), created: false };
  }

  const id = randomUUID();
  const ts = now();
  const row = {
    id,
    projectKey: nextProjectKey(),
    name: name?.trim() || `${estimateRow.name} — Project`,
    description: description || null,
    estimateId,
    baselineEstimateVersionId: estimateRow.approved_version_id,
    currentEstimateVersionId: estimateRow.approved_version_id,
    ownerUserId: estimateRow.owner_user_id,
    unit: estimateRow.business_unit,
    domain: domain || null,
    status: ProjectStatus.PLANNED,
    createdAt: ts,
    updatedAt: ts,
  };
  db.prepare(`
    INSERT INTO projects
      (id, project_key, name, description, estimate_id, baseline_estimate_version_id,
       current_estimate_version_id, owner_user_id, unit, domain, status, created_at, updated_at)
    VALUES (@id, @projectKey, @name, @description, @estimateId, @baselineEstimateVersionId,
       @currentEstimateVersionId, @ownerUserId, @unit, @domain, @status, @createdAt, @updatedAt)
  `).run(row);

  writeAudit({
    estimateId,
    projectId: id,
    action: AuditAction.PROJECT_CREATED,
    actor,
    versionId: estimateRow.approved_version_id,
    metadata: { projectKey: row.projectKey, projectName: row.name },
  });

  if (estimateRow.owner_user_id !== actor.userId) {
    createNotification({
      userId: estimateRow.owner_user_id,
      type: NotificationType.PROJECT_CREATED,
      estimateId,
      projectId: id,
      message: `A project ("${row.projectKey}") was created from your approved estimate "${estimateRow.name}".`,
    });
  }

  return { project: projectToPublic(getProjectRow(id)), created: true };
}

// ── Part 10 — read APIs ──────────────────────────────────────────────────────

export function getProject(projectId, actor) {
  const row = requireProjectAccess(projectId, actor);
  return projectToPublic(row);
}

/** Admin: all projects. Super: unit-scoped. Everyone else: owned only. */
export function listProjects(actor) {
  const rows = actor.role === 'admin'
    ? db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
    : actor.role === 'super'
      ? db.prepare('SELECT * FROM projects WHERE unit = ? ORDER BY updated_at DESC').all(actor.unit)
      : db.prepare('SELECT * FROM projects WHERE owner_user_id = ? ORDER BY updated_at DESC').all(actor.userId);
  return rows.map(projectToPublic);
}

/** Baseline detail (Part 15): the immutable approved version this project
 * was built from, plus who approved it and when — sourced from the
 * existing estimate_reviews record, never re-derived or guessed. */
export function getProjectBaseline(projectId, actor) {
  const row = requireProjectAccess(projectId, actor);
  const versionRow = getVersionRowById(row.baseline_estimate_version_id);
  const approvalReview = db.prepare(
    "SELECT * FROM estimate_reviews WHERE version_id = ? AND decision = 'approved' ORDER BY created_at DESC LIMIT 1",
  ).get(row.baseline_estimate_version_id);
  return {
    estimateId: row.estimate_id,
    baselineEstimateVersionId: row.baseline_estimate_version_id,
    currentEstimateVersionId: row.current_estimate_version_id,
    version: redactVersionForRole(versionRow ? {
      id: versionRow.id,
      version: versionRow.version,
      inputs: JSON.parse(versionRow.inputs_json),
      bottomUp: versionRow.bottom_up_json ? JSON.parse(versionRow.bottom_up_json) : null,
      ml: versionRow.ml_json ? JSON.parse(versionRow.ml_json) : null,
      health: versionRow.health_json ? JSON.parse(versionRow.health_json) : null,
      createdAt: versionRow.created_at,
    } : null, actor.role),
    approvedByUserId: approvalReview?.reviewer_user_id ?? null,
    approvedAt: approvalReview?.created_at ?? null,
  };
}

// ── Part 10 — mutations ──────────────────────────────────────────────────────

export function updateProjectMetadata(projectId, { name, description, domain }, actor) {
  const row = requireProjectAccess(projectId, actor);
  const next = {
    name: name?.trim() || row.name,
    description: description !== undefined ? description : row.description,
    domain: domain !== undefined ? domain : row.domain,
    updatedAt: now(),
  };
  db.prepare('UPDATE projects SET name = ?, description = ?, domain = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.description, next.domain, next.updatedAt, projectId);

  writeAudit({
    estimateId: row.estimate_id, projectId, action: AuditAction.PROJECT_UPDATED, actor,
  });
  return projectToPublic(getProjectRow(projectId));
}

/** Part 14: exactly the 6 required transitions, server-enforced. Tracks
 * started_at / completed_at as a byproduct — never user-settable directly. */
export function setProjectStatus(projectId, targetStatus, actor) {
  const row = requireProjectAccess(projectId, actor);
  if (!canTransition(row.status, targetStatus)) {
    throw new ProjectValidationError(`Cannot transition from "${row.status}" to "${targetStatus}".`);
  }

  const ts = now();
  const startedAt = (targetStatus === ProjectStatus.ACTIVE && !row.started_at) ? ts : row.started_at;
  const completedAt = targetStatus === ProjectStatus.COMPLETED ? ts : row.completed_at;
  db.prepare('UPDATE projects SET status = ?, updated_at = ?, started_at = ?, completed_at = ? WHERE id = ?')
    .run(targetStatus, ts, startedAt, completedAt, projectId);

  const action = targetStatus === ProjectStatus.COMPLETED
    ? AuditAction.PROJECT_COMPLETED
    : targetStatus === ProjectStatus.CANCELLED
      ? AuditAction.PROJECT_CANCELLED
      : AuditAction.PROJECT_STATUS_CHANGED;
  writeAudit({
    estimateId: row.estimate_id, projectId, action, actor, fromStatus: row.status, toStatus: targetStatus,
  });

  if (row.owner_user_id !== actor.userId) {
    createNotification({
      userId: row.owner_user_id,
      type: NotificationType.PROJECT_STATUS_CHANGED,
      estimateId: row.estimate_id,
      projectId,
      message: `Project "${row.project_key}" status changed to ${targetStatus}.`,
    });
  }

  return projectToPublic(getProjectRow(projectId));
}

// ── Part 6/7/9 — project updates ─────────────────────────────────────────────

export function addProjectUpdate(projectId, {
  updateType, title, description, status, metadata, requiresEstimateReview,
}, actor) {
  const row = requireProjectAccess(projectId, actor);
  if (!title?.trim()) throw new ProjectValidationError('title is required.');
  if (!updateType?.trim()) throw new ProjectValidationError('updateType is required.');

  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO project_updates
      (id, project_id, created_by, created_at, update_type, title, description, status, metadata_json, requires_estimate_review)
    VALUES (@id, @projectId, @createdBy, @createdAt, @updateType, @title, @description, @status, @metadataJson, @requiresEstimateReview)
  `).run({
    id,
    projectId,
    createdBy: actor.userId,
    createdAt: ts,
    updateType,
    title: title.trim(),
    description: description || null,
    status: status || null,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
    requiresEstimateReview: requiresEstimateReview ? 1 : 0,
  });
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(ts, projectId);

  writeAudit({
    estimateId: row.estimate_id,
    projectId,
    action: AuditAction.PROJECT_UPDATE_ADDED,
    actor,
    metadata: { updateId: id, updateType },
  });

  // Part 9: a persisted SIGNAL that the estimate may need revision — this
  // does NOT create an estimate version itself; that's a human/estimator
  // decision, consumed later by the (not-yet-built) delta/version workflow.
  if (requiresEstimateReview) {
    writeAudit({
      estimateId: row.estimate_id,
      projectId,
      action: AuditAction.ESTIMATE_REVIEW_SIGNAL_CREATED,
      actor,
      reason: title.trim(),
      metadata: { updateId: id },
    });
    const assignment = getLatestAssignmentForEstimate(row.estimate_id);
    const responsibleUserId = assignment?.reviewer_user_id ?? null;
    if (responsibleUserId) {
      createNotification({
        userId: responsibleUserId,
        type: NotificationType.ESTIMATE_REVIEW_SIGNAL,
        estimateId: row.estimate_id,
        projectId,
        message: `Project "${row.project_key}" update flags a possible estimate change: "${title.trim()}"`,
      });
    }
  }

  return redactProjectUpdateForRole(updateToPublic(
    db.prepare('SELECT * FROM project_updates WHERE id = ?').get(id),
  ), actor.role);
}

export function listProjectUpdates(projectId, actor) {
  requireProjectAccess(projectId, actor);
  const rows = db.prepare('SELECT * FROM project_updates WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
  return rows.map((r) => redactProjectUpdateForRole(updateToPublic(r), actor.role));
}
