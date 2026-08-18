/**
 * Project baseline/tracking API (Phase 4) — thin fetch wrappers for
 * upload-server's /api/projects* routes. Same conventions as
 * estimatesApi.js: hardcoded base, credentials:'include', assertOk().
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

/** Idempotent — a repeated call for the same estimate returns the existing
 * project (created:false) rather than a duplicate. */
export async function createProjectFromEstimate(estimateId, { name, description, domain }) {
  const { res, data } = await send('POST', `/projects/from-estimate/${estimateId}`, { name, description, domain });
  assertOk(res, data, 'Failed to create project');
  return { project: data.project, created: data.created };
}

export async function listProjects() {
  const { res, data } = await get('/projects');
  assertOk(res, data, 'Failed to load projects');
  return data.projects;
}

export async function getProject(id) {
  const { res, data } = await get(`/projects/${id}`);
  assertOk(res, data, 'Failed to load project');
  return data.project;
}

export async function getProjectBaseline(id) {
  const { res, data } = await get(`/projects/${id}/baseline`);
  assertOk(res, data, 'Failed to load project baseline');
  return data.baseline;
}

export async function updateProjectMetadata(id, { name, description, domain }) {
  const { res, data } = await send('PATCH', `/projects/${id}`, { name, description, domain });
  assertOk(res, data, 'Failed to update project');
  return data.project;
}

/** status: 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled'. */
export async function setProjectStatus(id, status) {
  const { res, data } = await send('PATCH', `/projects/${id}/status`, { status });
  assertOk(res, data, 'Failed to change project status');
  return data.project;
}

export async function addProjectUpdate(id, {
  updateType, title, description, status, metadata, requiresEstimateReview,
}) {
  const { res, data } = await send('POST', `/projects/${id}/updates`, {
    updateType, title, description, status, metadata, requiresEstimateReview,
  });
  assertOk(res, data, 'Failed to add project update');
  return data.update;
}

export async function listProjectUpdates(id) {
  const { res, data } = await get(`/projects/${id}/updates`);
  assertOk(res, data, 'Failed to load project updates');
  return data.updates;
}
