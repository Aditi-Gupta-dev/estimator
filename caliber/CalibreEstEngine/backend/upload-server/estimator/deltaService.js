/**
 * Version-to-version AI delta analysis (Phase 5) — orchestrates the
 * pipeline described in the phase spec:
 *
 *   version created -> persist -> delta_analyses row (PENDING) -> trigger
 *   -> deterministic comparison (deltaEngine.js, synchronous, authoritative)
 *   -> LLM interpretation (eva_service's /internal/delta-analysis, called
 *      with a rate-card-redacted payload) -> persist result (COMPLETED/FAILED)
 *
 * Deliberately does NOT import estimatesService.js's saveEstimate/
 * resubmitEstimate, nor is it imported BY them — index.js's route handlers
 * call this AFTER those functions succeed (see /api/estimates/:id PATCH and
 * /api/estimates/:id/resubmit). That keeps this a leaf module (imports FROM
 * estimatesService/projectService, never imported by them) so there is no
 * circular dependency, and keeps "version was just created" and "maybe
 * analyze it" as two separate, individually-testable steps.
 */
import { randomUUID } from 'crypto';
import db from './estimatesDb.js';
import { DeltaStatus } from './deltaTypes.js';
import { AuditAction, NotificationType } from './reviewTypes.js';
import { compareEstimateDelta } from './deltaEngine.js';
import { redactDeltaForRole } from './rateCardRedaction.js';
import {
  getEstimateRow, getVersionRowById, versionToPublic, writeAudit, now, requireEstimateViewAccess,
} from './estimatesService.js';
import { requireProjectAccess } from './projectService.js';
import { createNotification } from './notifications.js';

export class DeltaNotFoundError extends Error {
  constructor(message = 'Delta analysis not found.') {
    super(message);
    this.name = 'DeltaNotFoundError';
    this.status = 404;
  }
}

export class DeltaValidationError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'DeltaValidationError';
    this.status = status;
  }
}

function getDeltaRow(id) {
  return db.prepare('SELECT * FROM delta_analyses WHERE id = ?').get(id);
}

function findExistingDelta(estimateId, previousVersionId, currentVersionId) {
  return db.prepare(
    'SELECT * FROM delta_analyses WHERE estimate_id = ? AND previous_version_id = ? AND current_version_id = ?',
  ).get(estimateId, previousVersionId, currentVersionId);
}

function findProjectForEstimate(estimateId) {
  return db.prepare(
    "SELECT * FROM projects WHERE estimate_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
  ).get(estimateId);
}

function deltaToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    estimateId: row.estimate_id,
    projectId: row.project_id,
    previousVersionId: row.previous_version_id,
    currentVersionId: row.current_version_id,
    status: row.status,
    deterministicDelta: row.deterministic_delta_json ? JSON.parse(row.deterministic_delta_json) : null,
    aiAnalysis: row.ai_analysis_json ? JSON.parse(row.ai_analysis_json) : null,
    errorMessage: row.error_message,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function redactDeltaRecordForRole(delta, role) {
  if (!delta) return delta;
  return { ...delta, deterministicDelta: redactDeltaForRole(delta.deterministicDelta, role) };
}

/** Part 5 — server verifies the pair is genuinely sequential before
 * treating it as "the" automatic delta for a version. Historical/arbitrary
 * comparisons remain possible via the pre-existing compareEstimateVersions
 * (Phase 1/3), which this does not touch or replace. */
function validateVersionPair(estimateId, previousVersionRow, currentVersionRow) {
  if (!previousVersionRow || !currentVersionRow) {
    throw new DeltaValidationError('Both versions must exist to compute a delta.', 404);
  }
  if (previousVersionRow.estimate_id !== estimateId || currentVersionRow.estimate_id !== estimateId) {
    throw new DeltaValidationError('Both versions must belong to the same estimate.');
  }
  if (currentVersionRow.previous_version_id !== previousVersionRow.id) {
    throw new DeltaValidationError(
      'The given versions are not sequential — currentVersion.previousVersionId does not match previousVersion.id.',
    );
  }
}

/** Called by index.js right after a version > 1 is persisted (saveEstimate
 * or reviewService.resubmitEstimate). Idempotent (Part 18): a duplicate
 * trigger for the same (estimate, previous, current) pair returns the
 * existing row instead of creating a second one or re-running analysis.
 * Returns immediately — the actual LLM call happens on a later tick
 * (setImmediate), never blocking the caller's HTTP response (Part 7). */
export function triggerDeltaAnalysis({
  estimateId, previousVersionId, currentVersionId, actor,
}, evaUrl, internalApiKey) {
  const previousVersionRow = getVersionRowById(previousVersionId);
  const currentVersionRow = getVersionRowById(currentVersionId);
  validateVersionPair(estimateId, previousVersionRow, currentVersionRow);

  const existing = findExistingDelta(estimateId, previousVersionId, currentVersionId);
  if (existing) return deltaToPublic(existing);

  const estimateRow = getEstimateRow(estimateId);
  const project = findProjectForEstimate(estimateId);
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO delta_analyses
      (id, estimate_id, project_id, previous_version_id, current_version_id, status,
       created_by_user_id, created_at, updated_at)
    VALUES (@id, @estimateId, @projectId, @previousVersionId, @currentVersionId, @status,
       @createdByUserId, @createdAt, @updatedAt)
  `).run({
    id,
    estimateId,
    projectId: project ? project.id : null,
    previousVersionId,
    currentVersionId,
    status: DeltaStatus.PENDING,
    createdByUserId: actor.userId,
    createdAt: ts,
    updatedAt: ts,
  });

  writeAudit({
    estimateId,
    projectId: project ? project.id : null,
    action: AuditAction.DELTA_ANALYSIS_REQUESTED,
    actor,
    versionId: currentVersionId,
    metadata: { deltaAnalysisId: id, previousVersionId, currentVersionId },
  });

  // Fire-and-forget — the estimate/version write this is reacting to has
  // already committed and its HTTP response is already on its way back.
  setImmediate(() => {
    processDeltaAnalysis(id, evaUrl, internalApiKey).catch((err) => {
      // processDeltaAnalysis itself catches and persists failures; this is
      // only a last-resort net for something going wrong OUTSIDE that
      // try/catch (e.g. the DB write for FAILED status itself throwing).
      console.error(`Delta analysis ${id} crashed outside its own error handling:`, err.message);
    });
  });

  return deltaToPublic(getDeltaRow(id));
}

/** The actual pipeline: deterministic compare (always succeeds — pure
 * function over data already in this DB) -> redact -> LLM interpretation
 * (may fail) -> persist. A failure here NEVER touches the estimate/version
 * rows themselves (Part 18) — only this delta_analyses row's own status. */
export async function processDeltaAnalysis(deltaId, evaUrl, internalApiKey, { isRetry = false } = {}) {
  const row = getDeltaRow(deltaId);
  if (!row) return;

  db.prepare('UPDATE delta_analyses SET status = ?, updated_at = ? WHERE id = ?')
    .run(DeltaStatus.RUNNING, now(), deltaId);

  const estimateRow = getEstimateRow(row.estimate_id);
  const previousVersion = versionToPublic(getVersionRowById(row.previous_version_id));
  const currentVersion = versionToPublic(getVersionRowById(row.current_version_id));
  const project = row.project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id) : null;

  // The ONLY numeric authority in this pipeline — computed once, stored
  // unredacted (redaction happens per-viewer at the API boundary), never
  // recomputed or second-guessed by the LLM.
  const deterministicDelta = compareEstimateDelta(previousVersion, currentVersion);

  const actor = { userId: row.created_by_user_id, name: 'system', role: 'admin' };

  try {
    // Part 3 — redaction happens BEFORE LLM context construction, using the
    // lowest-privilege role unconditionally. This is a persisted, shared
    // artifact potentially read by the estimator themselves later, so the
    // AI's own generated text must never be ABLE to contain a rate figure,
    // regardless of who eventually reads it.
    const llmSafeDelta = redactDeltaForRole(deterministicDelta, 'estimator');

    const resp = await fetch(`${evaUrl}/internal/delta-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': internalApiKey },
      body: JSON.stringify({
        deterministicDelta: llmSafeDelta,
        estimateName: estimateRow?.name,
        industry: currentVersion.inputs?.industry,
        overallComplexity: currentVersion.inputs?.overallComplexity,
        businessUnit: estimateRow?.business_unit,
        changeReason: currentVersion.changeReason,
        projectName: project?.name,
        projectKey: project?.project_key,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `AI analysis service returned HTTP ${resp.status}`);
    }
    const aiAnalysis = await resp.json();

    db.prepare(`
      UPDATE delta_analyses
      SET status = ?, deterministic_delta_json = ?, ai_analysis_json = ?, error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(DeltaStatus.COMPLETED, JSON.stringify(deterministicDelta), JSON.stringify(aiAnalysis), now(), deltaId);

    writeAudit({
      estimateId: row.estimate_id,
      projectId: row.project_id,
      action: AuditAction.DELTA_ANALYSIS_COMPLETED,
      actor,
      versionId: row.current_version_id,
      metadata: { deltaAnalysisId: deltaId },
    });

    if (estimateRow) {
      createNotification({
        userId: estimateRow.owner_user_id,
        type: NotificationType.DELTA_ANALYSIS_COMPLETED,
        estimateId: row.estimate_id,
        projectId: row.project_id,
        message: `AI delta analysis is ready for "${estimateRow.name}" (V${previousVersion.version} → V${currentVersion.version}).`,
      });
      // Project owner is currently always the same person as the estimate
      // owner (see projectService.createProjectFromEstimate) — this guards
      // the day that stops being true (e.g. a future project-transfer
      // feature) rather than assuming it forever.
      if (project && project.owner_user_id !== estimateRow.owner_user_id) {
        createNotification({
          userId: project.owner_user_id,
          type: NotificationType.DELTA_ANALYSIS_COMPLETED,
          estimateId: row.estimate_id,
          projectId: row.project_id,
          message: `AI delta analysis is ready for project "${project.name}" (V${previousVersion.version} → V${currentVersion.version}).`,
        });
      }
    }
  } catch (err) {
    // Deterministic delta is still stored even on AI failure — the
    // deterministic numbers are useful on their own and were never in
    // doubt; only the AI interpretation half failed (Part 18).
    db.prepare(`
      UPDATE delta_analyses
      SET status = ?, deterministic_delta_json = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(DeltaStatus.FAILED, JSON.stringify(deterministicDelta), String(err.message).slice(0, 500), now(), deltaId);

    writeAudit({
      estimateId: row.estimate_id,
      projectId: row.project_id,
      action: AuditAction.DELTA_ANALYSIS_FAILED,
      actor,
      versionId: row.current_version_id,
      reason: String(err.message).slice(0, 500),
      metadata: { deltaAnalysisId: deltaId },
    });

    // Part 16 — useful once, not on every retry: a first-time failure is
    // worth surfacing; repeatedly re-notifying on manual retry attempts
    // would just be noise.
    if (!isRetry && estimateRow) {
      createNotification({
        userId: estimateRow.owner_user_id,
        type: NotificationType.DELTA_ANALYSIS_FAILED,
        estimateId: row.estimate_id,
        projectId: row.project_id,
        message: `AI delta analysis could not complete for "${estimateRow.name}" (V${previousVersion.version} → V${currentVersion.version}). The version itself was saved normally.`,
      });
    }
  }
}

// ── Reads (Part 14) ──────────────────────────────────────────────────────────

export function getDelta(deltaId, actor) {
  const row = getDeltaRow(deltaId);
  if (!row) throw new DeltaNotFoundError();
  requireEstimateViewAccess(row.estimate_id, actor);
  return redactDeltaRecordForRole(deltaToPublic(row), actor.role);
}

export function listDeltasForEstimate(estimateId, actor) {
  requireEstimateViewAccess(estimateId, actor);
  const rows = db.prepare('SELECT * FROM delta_analyses WHERE estimate_id = ? ORDER BY created_at ASC').all(estimateId);
  return rows.map((r) => redactDeltaRecordForRole(deltaToPublic(r), actor.role));
}

export function getDeltaForVersion(estimateId, versionId, actor) {
  requireEstimateViewAccess(estimateId, actor);
  const row = db.prepare('SELECT * FROM delta_analyses WHERE estimate_id = ? AND current_version_id = ?').get(estimateId, versionId);
  if (!row) return null;
  return redactDeltaRecordForRole(deltaToPublic(row), actor.role);
}

export function listDeltasForProject(projectId, actor) {
  requireProjectAccess(projectId, actor);
  const rows = db.prepare('SELECT * FROM delta_analyses WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
  return rows.map((r) => redactDeltaRecordForRole(deltaToPublic(r), actor.role));
}

/** Part 18 — retry. Only from FAILED, never creates a second row for the
 * same pair (this reuses/updates the existing one), and never re-notifies
 * on a repeated failure. */
export function retryDeltaAnalysis(deltaId, actor, evaUrl, internalApiKey) {
  const row = getDeltaRow(deltaId);
  if (!row) throw new DeltaNotFoundError();
  requireEstimateViewAccess(row.estimate_id, actor);
  if (row.status !== DeltaStatus.FAILED) {
    throw new DeltaValidationError(`Cannot retry a delta analysis with status "${row.status}" — only FAILED analyses may be retried.`);
  }
  db.prepare('UPDATE delta_analyses SET status = ?, error_message = NULL, updated_at = ? WHERE id = ?')
    .run(DeltaStatus.PENDING, now(), deltaId);
  setImmediate(() => {
    processDeltaAnalysis(deltaId, evaUrl, internalApiKey, { isRetry: true }).catch((err) => {
      console.error(`Delta analysis retry ${deltaId} crashed outside its own error handling:`, err.message);
    });
  });
  return redactDeltaRecordForRole(deltaToPublic(getDeltaRow(deltaId)), actor.role);
}
