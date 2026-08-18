/**
 * AI-interpreted version delta API (Phase 5) — thin fetch wrappers for
 * upload-server's /api/estimates/:id/deltas*, /api/projects/:id/deltas,
 * and /api/deltas/:id* routes. Same conventions as estimatesApi.js.
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

export async function listDeltasForEstimate(estimateId) {
  const { res, data } = await get(`/estimates/${estimateId}/deltas`);
  assertOk(res, data, 'Failed to load delta analyses');
  return data.deltas;
}

/** Returns null (not an error) if no automatic delta exists for this version
 * (e.g. it's version 1, or the version wasn't created via the tracked path). */
export async function getDeltaForVersion(estimateId, versionId) {
  const { res, data } = await get(`/estimates/${estimateId}/versions/${versionId}/delta`);
  assertOk(res, data, 'Failed to load delta analysis');
  return data.delta;
}

export async function listDeltasForProject(projectId) {
  const { res, data } = await get(`/projects/${projectId}/deltas`);
  assertOk(res, data, 'Failed to load project delta history');
  return data.deltas;
}

export async function getDelta(deltaId) {
  const { res, data } = await get(`/deltas/${deltaId}`);
  assertOk(res, data, 'Failed to load delta analysis');
  return data.delta;
}

export async function retryDelta(deltaId) {
  const res = await fetch(`${API_BASE}/deltas/${deltaId}/retry`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
  });
  const data = await parseJsonSafe(res);
  assertOk(res, data, 'Failed to retry delta analysis');
  return data.delta;
}
