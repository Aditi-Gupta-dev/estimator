/**
 * Estimate persistence business logic — shared by both entry points into
 * this data (see index.js): the cookie-authenticated /api/estimates* routes
 * (browser) and the INTERNAL_API_KEY-authenticated /internal/estimates*
 * routes (EVA, which has no session of its own). Both call these exact
 * functions so there is one implementation of "what create/update/save
 * actually do", not two.
 *
 * Reuses, rather than reimplements:
 *  - applyChanges() from scenarioRunner.js for the validated change
 *    vocabulary (same one run_estimate_scenario/update_estimate use).
 *  - calculateEstimate() from authoritativeEstimate.js for the actual
 *    effort/cost/ML pipeline.
 *  - computeEstimateHealth() from the frontend's estimatorIntelligence.js
 *    for the health snapshot stored alongside each version.
 */
import { randomUUID } from 'crypto';
import db from './estimatesDb.js';
import { applyChanges } from './scenarioRunner.js';
import { calculateEstimate } from './authoritativeEstimate.js';
import { canTransition, EstimateStatus } from './estimateStatus.js';
import { redactBottomUpForRole, redactEstimateForRole, redactVersionForRole } from './rateCardRedaction.js';
import { computeEstimateHealth } from '../../../frontend/calibre-app/src/lib/estimatorIntelligence.js';

export class EstimateAccessError extends Error {
  constructor(message = 'You do not have access to this estimate.') {
    super(message);
    this.name = 'EstimateAccessError';
    this.status = 403;
  }
}

export class EstimateNotFoundError extends Error {
  constructor(message = 'Estimate not found.') {
    super(message);
    this.name = 'EstimateNotFoundError';
    this.status = 404;
  }
}

export class EstimateInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EstimateInputError';
    this.status = 400;
  }
}

export function now() {
  return new Date().toISOString();
}

function healthSnapshot(inputs, scored) {
  return computeEstimateHealth({
    bottomUp: scored.bottomUp,
    ml: scored.ml,
    similarProjects: scored.similarProjects,
    coverage: scored.coverage,
    sectionA: inputs.sectionA,
    overallComplexity: inputs.overallComplexity,
  });
}

export function getEstimateRow(estimateId) {
  return db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
}

export function getVersionRow(estimateId, version) {
  return db.prepare('SELECT * FROM estimate_versions WHERE estimate_id = ? AND version = ?').get(estimateId, version);
}

export function getVersionRowById(versionId) {
  return db.prepare('SELECT * FROM estimate_versions WHERE id = ?').get(versionId);
}

/** Owner or admin only — ESTIMATE_SAVE grants "you may create/save
 * estimates in general", not "you may touch this specific one". Used to
 * guard every MUTATION (save/submit/resubmit/ping) — a reviewer must never
 * be able to touch an estimate they don't own via this gate. */
export function requireEstimate(estimateId, actor) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  if (row.owner_user_id !== actor.userId && actor.role !== 'admin') {
    throw new EstimateAccessError();
  }
  return row;
}

/** Owner, admin, or ANYONE ever assigned as reviewer (current or past) may
 * VIEW — deliberately broader than requireEstimate, and deliberately
 * READ-ONLY call sites use it (history, version detail, comparison). Part
 * 15/16 requires the Reviewer/Super role to see version history and
 * comparisons for estimates assigned to them, which they don't own. */
export function requireEstimateViewAccess(estimateId, actor) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  if (row.owner_user_id === actor.userId || actor.role === 'admin') return row;
  const everAssigned = db.prepare(
    'SELECT 1 FROM reviewer_assignments WHERE estimate_id = ? AND reviewer_user_id = ? LIMIT 1',
  ).get(estimateId, actor.userId);
  if (!everAssigned) throw new EstimateAccessError();
  return row;
}

/** versionId/metadata are optional structured context (Phase 3 Part 7/14) —
 * e.g. which version was under review, which reviewer was assigned. Kept as
 * one generic JSON column rather than a new single-purpose column per event
 * kind (see estimatesDb.js's COLUMN_MIGRATIONS comment). */
export function writeAudit({
  estimateId, action, actor, fromStatus = null, toStatus = null, reason = null,
  versionId = null, metadata = null,
}) {
  db.prepare(`
    INSERT INTO estimate_audit_events
      (id, estimate_id, action, actor_user_id, actor_name, actor_role, from_status, to_status, reason,
       version_id, metadata_json, created_at)
    VALUES (@id, @estimateId, @action, @actorUserId, @actorName, @actorRole, @fromStatus, @toStatus, @reason,
       @versionId, @metadataJson, @createdAt)
  `).run({
    id: randomUUID(),
    estimateId,
    action,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    fromStatus,
    toStatus,
    reason,
    versionId,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
    createdAt: now(),
  });
}

export function versionToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    inputs: JSON.parse(row.inputs_json),
    bottomUp: row.bottom_up_json ? JSON.parse(row.bottom_up_json) : null,
    ml: row.ml_json ? JSON.parse(row.ml_json) : null,
    health: row.health_json ? JSON.parse(row.health_json) : null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    previousVersionId: row.previous_version_id ?? null,
    changeReason: row.change_reason ?? null,
  };
}

export function estimateToPublic(row, latestVersionRow) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    businessUnit: row.business_unit,
    name: row.name,
    status: row.status,
    currentVersion: row.current_version,
    approvedVersionId: row.approved_version_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersion: versionToPublic(latestVersionRow),
  };
}

/** previousVersionId is computed automatically (the row for version-1 on
 * the same estimate, or null for version 1) rather than requiring every
 * caller to pass it — it is fully derivable from (estimateId, version) and
 * the UNIQUE(estimate_id, version) constraint, so there is never ambiguity
 * to get wrong. changeReason is optional and currently only populated by
 * resubmitEstimate() (reviewService.js) — the original create/save/update
 * flows pass none, same as before this phase. */
export function insertVersion({
  estimateId, version, inputs, scored, actor, changeReason = null,
}) {
  const health = healthSnapshot(inputs, scored);
  const previous = version > 1 ? getVersionRow(estimateId, version - 1) : null;
  db.prepare(`
    INSERT INTO estimate_versions
      (id, estimate_id, version, inputs_json, bottom_up_json, ml_json, health_json, created_by_user_id, created_at,
       previous_version_id, change_reason)
    VALUES (@id, @estimateId, @version, @inputsJson, @bottomUpJson, @mlJson, @healthJson, @createdByUserId, @createdAt,
       @previousVersionId, @changeReason)
  `).run({
    id: randomUUID(),
    estimateId,
    version,
    inputsJson: JSON.stringify(inputs),
    bottomUpJson: JSON.stringify(scored.bottomUp),
    mlJson: JSON.stringify(scored.ml),
    healthJson: JSON.stringify(health),
    createdByUserId: actor.userId,
    createdAt: now(),
    previousVersionId: previous ? previous.id : null,
    changeReason,
  });
  return getVersionRow(estimateId, version);
}

/** actor = { userId, name, role } — always derived server-side (session
 * user or, for the /internal path, the verified role forwarded by the
 * /api/eva proxy), never taken at face value from a request body. */
export async function createEstimate({
  name, businessUnit, inputs, actor,
}, estimatorUrl) {
  if (!inputs?.sectionA || !inputs?.overrides) {
    throw new EstimateInputError('inputs.sectionA and inputs.overrides are required.');
  }
  const scored = await calculateEstimate(inputs, estimatorUrl);
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO estimates (id, owner_user_id, business_unit, name, status, current_version, created_at, updated_at)
    VALUES (@id, @ownerUserId, @businessUnit, @name, @status, 1, @createdAt, @updatedAt)
  `).run({
    id,
    ownerUserId: actor.userId,
    businessUnit: businessUnit || null,
    name: name || 'Untitled estimate',
    status: EstimateStatus.DRAFT,
    createdAt: ts,
    updatedAt: ts,
  });
  const versionRow = insertVersion({
    estimateId: id, version: 1, inputs, scored, actor,
  });
  writeAudit({
    estimateId: id, action: 'create', actor, toStatus: EstimateStatus.DRAFT,
  });
  return redactEstimateForRole(estimateToPublic(getEstimateRow(id), versionRow), actor.role);
}

export function getEstimate(estimateId, actor) {
  const row = requireEstimate(estimateId, actor);
  return redactEstimateForRole(estimateToPublic(row, getVersionRow(estimateId, row.current_version)), actor.role);
}

export function listEstimates(actor) {
  const rows = actor.role === 'admin'
    ? db.prepare('SELECT * FROM estimates ORDER BY updated_at DESC').all()
    : db.prepare('SELECT * FROM estimates WHERE owner_user_id = ? ORDER BY updated_at DESC').all(actor.userId);
  return rows.map((row) => redactEstimateForRole(estimateToPublic(row, getVersionRow(row.id, row.current_version)), actor.role));
}

export async function proposeChanges(estimateId, changes, actor, estimatorUrl) {
  const row = requireEstimate(estimateId, actor);
  const latest = getVersionRow(estimateId, row.current_version);
  const baseInputs = JSON.parse(latest.inputs_json);
  const nextInputs = applyChanges(baseInputs, changes || {});
  const scored = await calculateEstimate(nextInputs, estimatorUrl);
  return { row, nextInputs, scored };
}

/** Computes and returns a proposed new version WITHOUT writing it — the
 * "show impact before persisting" half of the confirm-before-mutate flow. */
export async function updateEstimate({ estimateId, changes, actor }, estimatorUrl) {
  const { row, nextInputs, scored } = await proposeChanges(estimateId, changes, actor, estimatorUrl);
  return {
    estimateId,
    currentVersion: row.current_version,
    persisted: false,
    proposedInputs: nextInputs,
    bottomUp: redactBottomUpForRole(scored.bottomUp, actor.role),
    ml: scored.ml,
    coverage: scored.coverage,
  };
}

/** Actually persists a new version. Only meant to be called after the
 * caller (EVA or the UI) has shown the update_estimate proposal and the
 * user has confirmed it — this function itself performs no confirmation
 * check of its own, by design: that judgment call belongs to the caller
 * that has the conversation/UI context, not to the persistence layer. */
export async function saveEstimate({ estimateId, changes, actor }, estimatorUrl) {
  const { row, nextInputs, scored } = await proposeChanges(estimateId, changes, actor, estimatorUrl);
  const nextVersion = row.current_version + 1;
  const versionRow = insertVersion({
    estimateId, version: nextVersion, inputs: nextInputs, scored, actor,
  });
  db.prepare('UPDATE estimates SET current_version = ?, updated_at = ? WHERE id = ?')
    .run(nextVersion, now(), estimateId);
  writeAudit({
    estimateId, action: 'save_version', actor, fromStatus: row.status, toStatus: row.status,
  });
  return redactEstimateForRole(estimateToPublic(getEstimateRow(estimateId), versionRow), actor.role);
}

export function getEstimateHistory(estimateId, actor) {
  requireEstimateViewAccess(estimateId, actor);
  const versions = db.prepare('SELECT * FROM estimate_versions WHERE estimate_id = ? ORDER BY version ASC').all(estimateId);
  return versions.map((row) => redactVersionForRole(versionToPublic(row), actor.role));
}

/** Owner or admin only — same access rule as every other estimate view.
 * Closes the gap flagged in the Phase 2 audit report: estimate_audit_events
 * was write-only (rows were created correctly for every mutation, but
 * nothing ever read them back). Mirrors the existing GET /api/knowledge/audit
 * pattern already used for Knowledge Hub governance events. */
export function getEstimateAuditEvents(estimateId, actor) {
  requireEstimate(estimateId, actor);
  const rows = db.prepare('SELECT * FROM estimate_audit_events WHERE estimate_id = ? ORDER BY created_at ASC').all(estimateId);
  return rows.map((r) => ({
    id: r.id,
    estimateId: r.estimate_id,
    action: r.action,
    actorUserId: r.actor_user_id,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    reason: r.reason,
    versionId: r.version_id,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null,
    createdAt: r.created_at,
  }));
}

export function getEstimateVersion(estimateId, version, actor) {
  requireEstimateViewAccess(estimateId, actor);
  const row = getVersionRow(estimateId, Number(version));
  if (!row) throw new EstimateNotFoundError(`Version ${version} was not found.`);
  return redactVersionForRole(versionToPublic(row), actor.role);
}

export function compareEstimateVersions(estimateId, versionA, versionB, actor) {
  requireEstimateViewAccess(estimateId, actor);
  const a = redactVersionForRole(versionToPublic(getVersionRow(estimateId, Number(versionA))), actor.role);
  const b = redactVersionForRole(versionToPublic(getVersionRow(estimateId, Number(versionB))), actor.role);
  if (!a || !b) throw new EstimateNotFoundError('One or both versions were not found.');
  return {
    estimateId,
    versionA: a,
    versionB: b,
    delta: {
      effortDays: (b.bottomUp?.totalWithContingency ?? 0) - (a.bottomUp?.totalWithContingency ?? 0),
      cost: (b.bottomUp?.totalCost ?? 0) - (a.bottomUp?.totalCost ?? 0),
      fte: (b.bottomUp?.totalAvgFte ?? 0) - (a.bottomUp?.totalAvgFte ?? 0),
      deviationPct: (b.ml?.predictedDeviationPct ?? 0) - (a.ml?.predictedDeviationPct ?? 0),
      riskBandChanged: a.ml?.riskBand !== b.ml?.riskBand,
    },
  };
}

export async function cloneEstimate(estimateId, actor, estimatorUrl) {
  const row = requireEstimate(estimateId, actor);
  const latest = getVersionRow(estimateId, row.current_version);
  const inputs = JSON.parse(latest.inputs_json);
  const cloned = await createEstimate({
    name: `${row.name} (copy)`,
    businessUnit: row.business_unit,
    inputs,
    actor,
  }, estimatorUrl);
  writeAudit({
    estimateId: cloned.id, action: 'clone', actor, reason: `cloned from ${estimateId}`,
  });
  return cloned;
}

/** Workflow transitions. Authorization is enforced at the route layer
 * (requireCapability(ESTIMATE_APPROVE)) rather than by ownership here,
 * deliberately: approving/rejecting someone else's submitted estimate is
 * the entire point of a review workflow, so an ownership check would break
 * it. Mirrors documents_route.py's patch_document, whose real gate is also
 * the caller's capability, not ownership of the document being reviewed. */
export function setEstimateStatus({
  estimateId, targetStatus, reason, actor,
}) {
  const row = getEstimateRow(estimateId);
  if (!row) throw new EstimateNotFoundError();
  if (!canTransition(row.status, targetStatus)) {
    const err = new Error(`Cannot transition from '${row.status}' to '${targetStatus}'.`);
    err.status = 422;
    throw err;
  }
  db.prepare('UPDATE estimates SET status = ?, updated_at = ? WHERE id = ?')
    .run(targetStatus, now(), estimateId);
  writeAudit({
    estimateId, action: 'status_change', actor, fromStatus: row.status, toStatus: targetStatus, reason,
  });
  return redactEstimateForRole(
    estimateToPublic(getEstimateRow(estimateId), getVersionRow(estimateId, row.current_version)),
    actor.role,
  );
}
