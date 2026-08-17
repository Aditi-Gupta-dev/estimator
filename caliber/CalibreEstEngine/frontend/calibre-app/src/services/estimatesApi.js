/**
 * Estimate persistence + review/approval lifecycle API — thin fetch
 * wrappers for upload-server's /api/estimates*, /api/review-queue, and
 * /api/notifications* routes. Same conventions as authApi.js/documentsApi.js:
 * hardcoded base, credentials:'include', and documentsApi.js's assertOk()
 * pattern (business-logic failures come back with a real non-2xx status
 * from these routes, but checking data.success too costs nothing and stays
 * consistent with the rest of this file's siblings).
 */
const API_BASE = 'http://localhost:3001/api';

async function parseJsonSafe(response) {
  return response.json().catch(() => ({}));
}

function assertOk(res, data, fallbackMessage) {
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `${fallbackMessage} (HTTP ${res.status})`);
  }
}

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const data = await parseJsonSafe(res);
  return { res, data };
}

async function send(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await parseJsonSafe(res);
  return { res, data };
}

// ── Estimates (CRUD) ─────────────────────────────────────────────────────────

export async function listEstimates() {
  const { res, data } = await get('/estimates');
  assertOk(res, data, 'Failed to load estimates');
  return data.estimates;
}

export async function getEstimate(id) {
  const { res, data } = await get(`/estimates/${id}`);
  assertOk(res, data, 'Failed to load estimate');
  return data.estimate;
}

export async function createEstimate({ name, businessUnit, inputs }) {
  const { res, data } = await send('POST', '/estimates', { name, businessUnit, inputs });
  assertOk(res, data, 'Failed to create estimate');
  return data.estimate;
}

export async function getEstimateHistory(id) {
  const { res, data } = await get(`/estimates/${id}/history`);
  assertOk(res, data, 'Failed to load estimate history');
  return data.versions;
}

export async function getEstimateAudit(id) {
  const { res, data } = await get(`/estimates/${id}/audit`);
  assertOk(res, data, 'Failed to load estimate audit trail');
  return data.events;
}

// ── Review / approval lifecycle (Phase 3) ────────────────────────────────────

export async function submitEstimate(id) {
  const { res, data } = await send('POST', `/estimates/${id}/submit`);
  assertOk(res, data, 'Failed to submit estimate for review');
  return data.estimate;
}

/** changes: same closed vocabulary as scenario execution (durationMonthsDelta,
 * moduleEffortMultiplier, etc.) — pass {} for "no input changes, just a new
 * change reason", though in practice a resubmission usually has both. */
export async function resubmitEstimate(id, { changes, changeReason }) {
  const { res, data } = await send('POST', `/estimates/${id}/resubmit`, { changes, changeReason });
  assertOk(res, data, 'Failed to resubmit estimate');
  return data.estimate;
}

export async function pingReviewer(id) {
  const { res, data } = await send('POST', `/estimates/${id}/ping-reviewer`);
  assertOk(res, data, 'Failed to ping reviewer');
  return data;
}

export async function assignReviewer(id, reviewerUserId) {
  const { res, data } = await send('POST', `/estimates/${id}/assign-reviewer`, { reviewerUserId });
  assertOk(res, data, 'Failed to assign reviewer');
  return data.assignment;
}

/** Returns null (not an error) if no reviewer has been assigned yet. */
export async function getAssignment(id) {
  const { res, data } = await get(`/estimates/${id}/assignment`);
  assertOk(res, data, 'Failed to load reviewer assignment');
  return data.assignment;
}

export async function listReviews(id) {
  const { res, data } = await get(`/estimates/${id}/reviews`);
  assertOk(res, data, 'Failed to load reviews');
  return data.reviews;
}

export async function startReview(id) {
  const { res, data } = await send('POST', `/estimates/${id}/review/start`);
  assertOk(res, data, 'Failed to start review');
  return data.estimate;
}

/** decision: 'approved' | 'rejected' | 'changes_requested'. reviewedVersion
 * is REQUIRED — the version number the reviewer's screen is showing right
 * now, so a stale/cached view can never silently decide on the wrong
 * version (server rejects a mismatch with a "refresh and try again" error). */
export async function decideReview(id, { decision, comments, reviewedVersion }) {
  const { res, data } = await send('POST', `/estimates/${id}/review/decision`, { decision, comments, reviewedVersion });
  assertOk(res, data, 'Failed to submit review decision');
  return data.estimate;
}

/** The current user's review queue — assigned-to-me for a reviewer,
 * everything for admin. Each entry is { assignment, estimate }. */
export async function listReviewQueue() {
  const { res, data } = await get('/review-queue');
  assertOk(res, data, 'Failed to load review queue');
  return data.queue;
}

// ── In-app notifications ─────────────────────────────────────────────────────

export async function listNotifications({ unreadOnly = false } = {}) {
  const { res, data } = await get(`/notifications${unreadOnly ? '?unread=true' : ''}`);
  assertOk(res, data, 'Failed to load notifications');
  return data.notifications;
}

export async function markNotificationRead(id) {
  const { res, data } = await send('PATCH', `/notifications/${id}/read`);
  assertOk(res, data, 'Failed to mark notification read');
  return data.notification;
}
